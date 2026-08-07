// ═══════════════════════════════════════════════════════════
// visual-crafter.ts — Workers AI image generation
// The fleet's painter. Reads the metaphors and makes them visible.
// ═══════════════════════════════════════════════════════════

import {
  Env,
  buildVisualPrompt,
  r2Key,
  logProduction,
  incrementQuota,
} from './utils';

interface StoryForVisual {
  id: number;
  github_path: string;
  title: string;
  key_metaphor: string | null;
}

export async function runVisualCrafter(env: Env): Promise<void> {
  await logProduction(env.DB, 'visual-crafter', 'session_started', null, {});

  // Find stories with high visual potential that haven't been visualized
  const stories = await env.DB.prepare(
    `SELECT s.id, s.github_path, s.title
     FROM stories s
     WHERE s.status = 'organized'
       AND s.visual_potential >= 60
       AND s.id NOT IN (SELECT DISTINCT story_id FROM visuals WHERE kind = 'cover')
     ORDER BY s.visual_potential DESC
     LIMIT 5`
  ).all<StoryForVisual>();

  if (!stories.results || stories.results.length === 0) {
    await logProduction(env.DB, 'visual-crafter', 'session_complete', null, {
      message: 'No stories need visuals today.',
    });
    return;
  }

  for (const story of stories.results) {
    try {
      // Get the key metaphor from production log
      const metaphorRow = await env.DB.prepare(
        `SELECT details FROM production_log
         WHERE worker = 'story-organizer'
           AND action = 'classified'
           AND story_id = ?
         ORDER BY id DESC LIMIT 1`
      ).bind(story.id).first<{ details: string }>();

      let metaphor = 'a ship at anchor under starlight';
      if (metaphorRow?.details) {
        try {
          const details = JSON.parse(metaphorRow.details);
          if (details.key_metaphor) metaphor = details.key_metaphor;
        } catch {}
      }

      // Generate cover image via FLUX schnell (free on Workers AI)
      const prompt = buildVisualPrompt(metaphor, story.title);
      const coverResponse = await env.AI.run(
        '@cf/black-forest-labs/flux-1-schnell',
        { prompt, width: 1024, height: 1024 }
      );

      // Store the raw image bytes in R2
      const coverKey = r2Key('visuals/cover', slugify(story.github_path), 'png');
      const coverImage = await coverResponse.arrayBuffer();
      await env.MEDIA.put(coverKey, coverImage, {
        httpMetadata: { contentType: 'image/png' },
      });

      // Record in DB
      await env.DB.prepare(
        `INSERT INTO visuals (story_id, kind, r2_key, prompt, width, height)
         VALUES (?, 'cover', ?, ?, 1024, 1024)`
      ).bind(story.id, coverKey, prompt).run();

      // Generate thumbnail (crop center — store same image, mark as thumbnail)
      const thumbKey = r2Key('visuals/thumb', slugify(story.github_path), 'png');
      await env.MEDIA.put(thumbKey, coverImage, {
        httpMetadata: { contentType: 'image/png' },
      });
      await env.DB.prepare(
        `INSERT INTO visuals (story_id, kind, r2_key, prompt, width, height)
         VALUES (?, 'thumbnail', ?, ?, 512, 512)`
      ).bind(story.id, thumbKey, prompt).run();

      // Update story status
      await env.DB.prepare(
        `UPDATE stories SET status = 'visualized', processed_at = ? WHERE id = ?`
      ).bind(new Date().toISOString(), story.id).run();

      await logProduction(env.DB, 'visual-crafter', 'generated', story.id, {
        title: story.title,
        metaphor,
        cover_key: coverKey,
        prompt_preview: prompt.slice(0, 120),
      });

      // Each image generation costs ~3 Worker requests (AI inference counts)
      await incrementQuota(env.PULSE, 6);

    } catch (err) {
      await logProduction(env.DB, 'visual-crafter', 'error', story.id, {
        error: String(err),
      });
    }
  }

  await logProduction(env.DB, 'visual-crafter', 'session_complete', null, {
    stories_visualized: stories.results.length,
  });
}

function slugify(path: string): string {
  return path
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(-60);
}

// ─── API endpoint: GET /api/visuals/:storyId ───
export async function handleVisualCrafter(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/visuals/') && request.method === 'GET') {
    const storyId = url.pathname.split('/').pop();
    const visuals = await env.DB.prepare(
      'SELECT * FROM visuals WHERE story_id = ? ORDER BY created_at DESC'
    ).bind(storyId).all();

    return Response.json({ visuals: visuals.results });
  }

  if (url.pathname === '/api/visuals' && request.method === 'GET') {
    const visuals = await env.DB.prepare(
      `SELECT v.*, s.title as story_title
       FROM visuals v
       JOIN stories s ON v.story_id = s.id
       ORDER BY v.created_at DESC
       LIMIT 50`
    ).all();

    return Response.json({ visuals: visuals.results });
  }

  return new Response('Not found', { status: 404 });
}
