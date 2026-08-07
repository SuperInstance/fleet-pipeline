// ═══════════════════════════════════════════════════════════
// podcast-assembler.ts — Weekly roundup podcast
// Every Sunday at 23:30 UTC, gathers the week's best audio
// into a single episode. The cast gathers at the bar on the ship.
// ═══════════════════════════════════════════════════════════

import {
  Env,
  deepSeekChat,
  r2Key,
  logProduction,
  incrementQuota,
} from './utils';

export async function runPodcastAssembler(env: Env): Promise<void> {
  await logProduction(env.DB, 'podcast-assembler', 'assembly_started', null, {
    trigger: 'cron_sunday_2330_utc',
  });

  // Get this week's audio-ready stories
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const tracks = await env.DB.prepare(
    `SELECT
       a.id as audio_id, a.r2_key, a.script_adaptation, a.voice_model,
       s.id as story_id, s.title, s.character_voice, s.collection,
       s.github_path
     FROM audio_tracks a
     JOIN stories s ON a.story_id = s.id
     WHERE a.kind = 'narration'
       AND a.created_at >= ?
       AND s.status = 'audio_ready'
     ORDER BY s.audio_suitability_score DESC
     LIMIT 7`
  ).bind(weekAgo).all();

  if (!tracks.results || tracks.results.length < 2) {
    await logProduction(env.DB, 'podcast-assembler', 'assembly_skipped', null, {
      reason: 'Not enough tracks for an episode',
      track_count: tracks.results?.length || 0,
    });
    return;
  }

  // Determine episode number
  const lastEpisode = await env.DB.prepare(
    'SELECT MAX(episode_number) as max_num FROM episodes'
  ).first<{ max_num: number | null }>();
  const episodeNumber = (lastEpisode?.max_num || 0) + 1;

  // Generate episode title and description using DeepSeek
  const titles = tracks.results.map((t: any) => t.title);
  const showNotesResponse = await deepSeekChat(
    env.DEEPSEEK_API_KEY,
    env.DEEPSEEK_API_URL,
    [
      {
        role: 'system',
        content: `You are producing show notes for "The Endless Radio" — a weekly podcast from a creative fleet. Write in a maritime radio style. Return ONLY a JSON object:
{
  "title": "Episode N: [creative title]",
  "description": "2-3 sentence description of this week's episode, mentioning the cast of characters who appear"
}`,
      },
      {
        role: 'user',
        content: `This week's pieces:\n${titles.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}\n\nEpisode number: ${episodeNumber}`,
      },
    ],
    'deepseek-chat',
    0.8
  );

  let showNotes;
  try {
    showNotes = JSON.parse(showNotesResponse);
  } catch {
    showNotes = {
      title: `Episode ${episodeNumber}: The Weekly Haul`,
      description: `This week's catch from the fleet. ${tracks.results.length} pieces, brought together at the bar on the ship that is also a website.`,
    };
  }

  // Generate episode artwork
  let artworkKey: string | null = null;
  try {
    const artPrompt = `Podcast cover art for "${showNotes.title}". Maritime radio aesthetic. A ship's radio room at night, warm dial lights, headphones on a hook, the ocean visible through a porthole. Painterly, moody, atmospheric.`;
    const artResponse = await env.AI.run(
      '@cf/black-forest-labs/flux-1-schnell',
      { prompt: artPrompt, width: 1024, height: 1024 }
    );
    artworkKey = r2Key('podcasts/artwork', `ep${episodeNumber}`, 'png');
    await env.MEDIA.put(artworkKey, await artResponse.arrayBuffer(), {
      httpMetadata: { contentType: 'image/png' },
    });
  } catch {
    // Artwork is nice-to-have
  }

  // Create the episode record
  const episodeResult = await env.DB.prepare(
    `INSERT INTO episodes (episode_number, title, description, artwork_r2_key)
     VALUES (?, ?, ?, ?)`
  ).bind(
    episodeNumber,
    showNotes.title,
    showNotes.description,
    artworkKey
  ).run();

  const episodeId = episodeResult.meta?.last_row_id;

  // Link tracks to episode in order
  for (let i = 0; i < tracks.results.length; i++) {
    const track = tracks.results[i] as any;
    await env.DB.prepare(
      `INSERT INTO episode_tracks (episode_id, audio_track_id, track_order)
       VALUES (?, ?, ?)`
    ).bind(episodeId, track.audio_id, i + 1).run();
  }

  // Generate an intro segment via DeepSeek
  const introScript = await deepSeekChat(
    env.DEEPSEEK_API_KEY,
    env.DEEPSEEK_API_URL,
    [
      {
        role: 'system',
        content: `You are the host of "The Endless Radio," a weekly podcast from a creative fleet on a ship that is also a website. Write a 30-second intro that welcomes listeners, mentions it's episode ${episodeNumber}, and teases the pieces in this week's show. Maritime radio voice. No stage directions — just the words. 50-80 words.`,
      },
      {
        role: 'user',
        content: `This week's pieces:\n${titles.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}`,
      },
    ],
    'deepseek-chat',
    0.9
  );

  // Generate intro narration via melotts
  let introKey: string | null = null;
  try {
    const introTTS = await env.AI.run('@cf/myshell-ai/melotts', {
      text: introScript,
      lang: 'en',
      voice: 'alex',
      speed: 0.95,
      audio_format: 'mp3',
    });
    introKey = r2Key('podcasts/intro', `ep${episodeNumber}`, 'mp3');
    await env.MEDIA.put(introKey, await introTTS.arrayBuffer(), {
      httpMetadata: { contentType: 'audio/mpeg' },
    });
  } catch {
    // TTS might fail — skip intro
  }

  // Update episode with track count
  await env.DB.prepare(
    `UPDATE episodes SET track_count = ? WHERE id = ?`
  ).bind(tracks.results.length, episodeId).run();

  // Mark stories as published
  const storyIds = tracks.results.map((t: any) => t.story_id);
  for (const sid of storyIds) {
    await env.DB.prepare(
      `UPDATE stories SET status = 'published' WHERE id = ?`
    ).bind(sid).run();
  }

  await incrementQuota(env.PULSE, 20);

  await logProduction(env.DB, 'podcast-assembler', 'episode_assembled', null, {
    episode_number: episodeNumber,
    title: showNotes.title,
    track_count: tracks.results.length,
    has_intro: introKey !== null,
    has_artwork: artworkKey !== null,
    cast: [...new Set(tracks.results.map((t: any) => t.character_voice))],
  });
}

// ─── API: GET /api/episodes — list episodes ───
// ─── API: GET /api/feed — RSS-style feed ───
export async function handlePodcastAssembler(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/episodes' && request.method === 'GET') {
    const episodes = await env.DB.prepare(
      `SELECT * FROM episodes ORDER BY episode_number DESC LIMIT 50`
    ).all();

    return Response.json({ episodes: episodes.results });
  }

  if (url.pathname === '/api/feed' && request.method === 'GET') {
    const episodes = await env.DB.prepare(
      `SELECT * FROM episodes ORDER BY episode_number DESC LIMIT 20`
    ).all();

    // Build RSS-style XML feed
    const items = episodes.results.map((ep: any) => `
      <item>
        <title>${escapeXml(ep.title)}</title>
        <description>${escapeXml(ep.description || '')}</description>
        <pubDate>${new Date(ep.created_at).toUTCString()}</pubDate>
        <guid>fleet-podcast-${ep.episode_number}</guid>
      </item>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>The Endless Radio</title>
    <description>A weekly broadcast from the creative fleet. Stories, essays, and monologues from a ship that is also a website.</description>
    <link>${env.WIKI_BASE_URL}</link>
    <language>en</language>
    ${items}
  </channel>
</rss>`;

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return new Response('Not found', { status: 404 });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
