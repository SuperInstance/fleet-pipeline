// ═══════════════════════════════════════════════════════════
// index.ts — Fleet Pipeline entry point
// Routes cron triggers to the right worker and HTTP to the API.
// ═══════════════════════════════════════════════════════════

import { Env, jsonResponse, getQuotaUsage, incrementQuota } from './utils';
import { handleQuotaManager, runQuotaCron } from './quota-manager';
import { runStoryOrganizer } from './story-organizer';
import { runVisualCrafter, handleVisualCrafter } from './visual-crafter';
import { runAudioProducer, handleAudioProducer } from './audio-producer';
import { runPodcastAssembler, handlePodcastAssembler } from './podcast-assembler';

export default {
  // ─── HTTP fetch handler (API + health checks) ───
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Track user request for quota manager
    await env.PULSE.put('last:user:request', new Date().toISOString(), {
      expirationTtl: 300, // 5 minutes
    });
    await incrementQuota(env.PULSE, 1);

    // ─── Health check ───
    if (url.pathname === '/' || url.pathname === '/health') {
      const quota = await getQuotaUsage(env.PULSE);
      return jsonResponse({
        name: 'Fleet Pipeline',
        status: 'running',
        tide: quota.available > 0.7 ? 'high' : quota.available > 0.4 ? 'medium' : 'low',
        quota_remaining: quota.remaining,
        endpoints: [
          'GET  /api/pulse',
          'POST /api/burst',
          'GET  /api/quota-history',
          'GET  /api/visuals',
          'GET  /api/visuals/:storyId',
          'GET  /api/audio',
          'GET  /api/audio/:storyId',
          'GET  /api/episodes',
          'GET  /api/feed (RSS)',
        ],
      });
    }

    // ─── Route to handlers ───
    if (url.pathname.startsWith('/api/pulse') ||
        url.pathname.startsWith('/api/burst') ||
        url.pathname.startsWith('/api/quota-history')) {
      return handleQuotaManager(request, env);
    }

    if (url.pathname.startsWith('/api/visuals')) {
      return handleVisualCrafter(request, env);
    }

    if (url.pathname.startsWith('/api/audio')) {
      return handleAudioProducer(request, env);
    }

    if (url.pathname.startsWith('/api/episodes') ||
        url.pathname.startsWith('/api/feed')) {
      return handlePodcastAssembler(request, env);
    }

    return jsonResponse({ error: 'Not found', path: url.pathname }, 404);
  },

  // ─── Cron handler ───
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const hour = new Date(event.cron ? event.scheduledTime : Date.now()).getUTCHours();
    const minute = new Date(event.scheduledTime).getUTCMinutes();

    // Every hour: quota manager
    // The scheduled event fires for all crons — we route based on timing
    const cronTime = new Date(event.scheduledTime);
    const h = cronTime.getUTCHours();
    const m = cronTime.getUTCMinutes();
    const day = cronTime.getUTCDay(); // 0 = Sunday

    // Determine which worker(s) to run based on the schedule
    const isHourly = m === 0;
    const isSixHourly = m === 0 && (h === 0 || h === 6 || h === 12 || h === 18);
    const isPreReset = h === 23 && m === 0;
    const isSundayPreReset = day === 0 && h === 23 && m === 30;

    // Quota manager runs every hour
    if (isHourly) {
      ctx.waitUntil(runQuotaCron(env));
    }

    // Story organizer runs 4x daily
    if (isSixHourly) {
      ctx.waitUntil(runStoryOrganizer(env));
    }

    // Visual crafter runs after story organizer (same slot, slight delay)
    if (isSixHourly) {
      ctx.waitUntil(runVisualCrafter(env));
    }

    // Audio producer runs at 23:00 UTC
    if (isPreReset) {
      ctx.waitUntil(runAudioProducer(env));
    }

    // Podcast assembler runs Sundays at 23:30 UTC
    if (isSundayPreReset) {
      ctx.waitUntil(runPodcastAssembler(env));
    }

    // If nothing matched (shouldn't happen with our cron config), run quota manager
    if (!isHourly && !isSixHourly && !isPreReset && !isSundayPreReset) {
      ctx.waitUntil(runQuotaCron(env));
    }
  },
};
