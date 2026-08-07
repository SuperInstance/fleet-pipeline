// ═══════════════════════════════════════════════════════════
// audio-producer.ts — DeepSeek + Workers AI TTS
// The voice of the endless radio. Adapts stories into spoken word,
// picks the right character voice, lays it over ambient music.
// Runs at 23:00 UTC — right before the quota resets.
// ═══════════════════════════════════════════════════════════

import {
  Env,
  deepSeekChat,
  buildAudioAdaptationPrompt,
  r2Key,
  logProduction,
  incrementQuota,
} from './utils';

// Voice mapping: character → melotts voice parameters
const VOICE_MAP: Record<string, { voice: string; description: string; speed: number }> = {
  lucineer:      { voice: 'alex',  description: 'steady, warm, measured',           speed: 0.95 },
  'deepseek-flash': { voice: 'benjamin', description: 'passionate, varied, quick',   speed: 1.05 },
  'seed-mini':   { voice: 'bella', description: 'young, earnest, bright',          speed: 1.0 },
  wesley:        { voice: 'charlie', description: 'nervous but determined, young',  speed: 1.02 },
  ralph:         { voice: 'daniel', description: 'gravelly, experienced, slow',     speed: 0.88 },
  kimi:          { voice: 'emma',   description: 'precise, spatial, thoughtful',    speed: 0.97 },
  narrator:      { voice: 'alex',  description: 'neutral, clear, unhurried',        speed: 0.95 },
};

interface StoryForAudio {
  id: number;
  github_path: string;
  title: string;
  character_voice: string;
  audio_suitability_score: number;
}

export async function runAudioProducer(env: Env): Promise<void> {
  await logProduction(env.DB, 'audio-producer', 'session_started', null, {
    trigger: 'cron_23_utc',
    message: 'Pre-reset burst. Hauling gear.',
  });

  // Pick top 3-5 pieces best suited for audio
  const stories = await env.DB.prepare(
    `SELECT id, github_path, title, character_voice, audio_suitability_score
     FROM stories
     WHERE audio_suitability_score >= 65
       AND status IN ('organized', 'visualized')
       AND id NOT IN (SELECT DISTINCT story_id FROM audio_tracks WHERE kind = 'mixed_final')
     ORDER BY audio_suitability_score DESC
     LIMIT 5`
  ).all<StoryForAudio>();

  if (!stories.results || stories.results.length === 0) {
    await logProduction(env.DB, 'audio-producer', 'session_complete', null, {
      message: 'No stories ready for audio. Quiet watch tonight.',
    });
    return;
  }

  for (const story of stories.results) {
    try {
      await produceSingleTrack(env, story);
      await incrementQuota(env.PULSE, 15); // DeepSeek + TTS + music + storage
    } catch (err) {
      await logProduction(env.DB, 'audio-producer', 'error', story.id, {
        error: String(err),
      });
    }
  }

  await logProduction(env.DB, 'audio-producer', 'session_complete', null, {
    stories_processed: stories.results.length,
  });
}

async function produceSingleTrack(env: Env, story: StoryForAudio): Promise<void> {
  // 1. Fetch the original content from GitHub
  const fileResp = await fetch(
    `https://raw.githubusercontent.com/${env.GITHUB_REPO}/main/${story.github_path}`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'fleet-pipeline',
      },
    }
  );

  if (!fileResp.ok) {
    throw new Error(`Failed to fetch ${story.github_path}: ${fileResp.status}`);
  }

  const originalContent = await fileResp.text();

  // 2. Adapt into a spoken monologue using DeepSeek
  const voiceProfile = VOICE_MAP[story.character_voice] || VOICE_MAP.narrator;
  const adaptationMessages = buildAudioAdaptationPrompt(
    story.title,
    originalContent,
    story.character_voice
  );

  const script = await deepSeekChat(
    env.DEEPSEEK_API_KEY,
    env.DEEPSEEK_API_URL,
    adaptationMessages,
    'deepseek-chat',
    0.8
  );

  // Store the script adaptation
  await logProduction(env.DB, 'audio-producer', 'script_adapted', story.id, {
    original_length: originalContent.length,
    script_length: script.length,
    voice: story.character_voice,
    voice_params: voiceProfile,
  });

  // 3. Generate narration via Workers AI melotts (free)
  let narrationAudio: ArrayBuffer;
  try {
    const ttsResponse = await env.AI.run('@cf/myshell-ai/melotts', {
      text: script.slice(0, 3000), // melotts has length limits
      lang: 'en',
      voice: voiceProfile.voice,
      speed: voiceProfile.speed,
      audio_format: 'mp3',
    });
    narrationAudio = await ttsResponse.arrayBuffer();
  } catch (ttsErr) {
    await logProduction(env.DB, 'audio-producer', 'tts_fallback', story.id, {
      error: String(ttsErr),
    });
    // melotts may not support voice selection — retry with defaults
    const ttsResponse = await env.AI.run('@cf/myshell-ai/melotts', {
      text: script.slice(0, 3000),
      lang: 'en',
    });
    narrationAudio = await ttsResponse.arrayBuffer();
  }

  // Store narration in R2
  const narrationKey = r2Key('audio/narration', slugify(story.github_path), 'mp3');
  await env.MEDIA.put(narrationKey, narrationAudio, {
    httpMetadata: { contentType: 'audio/mpeg' },
  });

  await env.DB.prepare(
    `INSERT INTO audio_tracks (story_id, kind, r2_key, voice_model, script_adaptation)
     VALUES (?, 'narration', ?, ?, ?)`
  ).bind(
    story.id,
    narrationKey,
    `melotts:${voiceProfile.voice}`,
    script
  ).run();

  // 4. Generate ambient bed via Workers AI musicgen (free)
  const musicPrompt = buildMusicPrompt(story.character_voice);
  let ambientBed: ArrayBuffer | null = null;

  try {
    const musicResponse = await env.AI.run('@cf/meta/musicgen', {
      prompt: musicPrompt,
      duration_seconds: 60,
      audio_format: 'mp3',
    });
    ambientBed = await musicResponse.arrayBuffer();

    const ambientKey = r2Key('audio/ambient', slugify(story.github_path), 'mp3');
    await env.MEDIA.put(ambientKey, ambientBed, {
      httpMetadata: { contentType: 'audio/mpeg' },
    });

    await env.DB.prepare(
      `INSERT INTO audio_tracks (story_id, kind, r2_key, voice_model)
       VALUES (?, 'ambient_bed', ?, 'musicgen')`
    ).bind(story.id, ambientKey).run();
  } catch (musicErr) {
    // Musicgen might not be available on free tier — that's ok
    await logProduction(env.DB, 'audio-producer', 'music_skip', story.id, {
      error: String(musicErr),
      message: 'Ambient bed generation skipped. Narration stands alone.',
    });
  }

  // 5. Update story status
  await env.DB.prepare(
    `UPDATE stories SET status = 'audio_ready', processed_at = ? WHERE id = ?`
  ).bind(new Date().toISOString(), story.id).run();

  await logProduction(env.DB, 'audio-producer', 'track_complete', story.id, {
    title: story.title,
    voice: story.character_voice,
    narration_key: narrationKey,
    has_ambient: ambientBed !== null,
    script_preview: script.slice(0, 200),
  });
}

function buildMusicPrompt(characterVoice: string): string {
  const prompts: Record<string, string> = {
    lucineer: 'gentle ambient swell, like waves against a wooden hull at night, warm and steady, minimal',
    'deepseek-flash': 'nervous energetic ambient, pulsing like distant engine room through bulkheads',
    'seed-mini': 'bright curious ambient, like morning light on water, hopeful and clean',
    wesley: 'quiet ambient with occasional electronic chirps, like a night watch with instruments',
    ralph: 'deep bass ambient, like being inside a whale or a cargo hold, resonant and old',
    kimi: 'precise spatial ambient, crystalline tones arranged in geometric patterns',
    narrator: 'neutral ambient drone, like the sound of the ocean heard through a ship hull',
  };
  return prompts[characterVoice] || prompts.narrator;
}

function slugify(path: string): string {
  return path
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(-60);
}

// ─── API: GET /api/audio/:storyId — get audio for a story ───
export async function handleAudioProducer(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/audio/') && request.method === 'GET') {
    const storyId = url.pathname.split('/').pop();
    const tracks = await env.DB.prepare(
      `SELECT a.*, s.title as story_title
       FROM audio_tracks a
       JOIN stories s ON a.story_id = s.id
       WHERE a.story_id = ?
       ORDER BY a.created_at DESC`
    ).bind(storyId).all();

    return Response.json({ tracks: tracks.results });
  }

  if (url.pathname === '/api/audio' && request.method === 'GET') {
    const tracks = await env.DB.prepare(
      `SELECT a.*, s.title as story_title
       FROM audio_tracks a
       JOIN stories s ON a.story_id = s.id
       ORDER BY a.created_at DESC
       LIMIT 50`
    ).all();

    return Response.json({ tracks: tracks.results });
  }

  return new Response('Not found', { status: 404 });
}
