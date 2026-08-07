// ═══════════════════════════════════════════════════════════
// quota-manager.ts — The pulse system
// The brain of the endless radio. Watches the tide of requests
// and decides when to haul gear.
// ═══════════════════════════════════════════════════════════

import {
  Env,
  getQuotaUsage,
  incrementQuota,
  decideProductionMode,
  ProductionMode,
  logProduction,
  jsonResponse,
} from './utils';

export async function handleQuotaManager(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // ─── GET /api/pulse — current quota and production status ───
  if (path === '/api/pulse' && request.method === 'GET') {
    return await getPulse(env);
  }

  // ─── POST /api/burst — manually trigger a production burst ───
  if (path === '/api/burst' && request.method === 'POST') {
    return await triggerBurst(env);
  }

  // ─── GET /api/quota-history — recent quota snapshots ───
  if (path === '/api/quota-history' && request.method === 'GET') {
    return await getQuotaHistory(env);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

// ─── Cron handler — runs every hour ───
export async function runQuotaCron(env: Env): Promise<void> {
  const quota = await getQuotaUsage(env.PULSE);
  const hour = new Date().getUTCHours();

  // Check if users are active (any requests in the last 5 minutes)
  const recentUserTraffic = await checkUserTraffic(env);
  const mode = decideProductionMode(quota.available, hour, recentUserTraffic);

  // Record snapshot
  await env.DB.prepare(
    `INSERT INTO quota_snapshots (timestamp, requests_used, requests_remaining, production_mode, user_traffic_active)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    new Date().toISOString(),
    quota.used,
    quota.remaining,
    mode,
    recentUserTraffic ? 1 : 0
  ).run();

  await logProduction(env.DB, 'quota-manager', `pulse_check:${mode}`, null, {
    quota: quota.available,
    hour_utc: hour,
    user_traffic: recentUserTraffic,
  });

  // Count this cron as 1 request
  await incrementQuota(env.PULSE, 1);

  if (mode === 'burst') {
    await triggerProductionBurst(env);
  } else if (mode === 'light') {
    await triggerLightProduction(env);
  }
}

// ─── The pulse endpoint ───
async function getPulse(env: Env): Promise<Response> {
  const quota = await getQuotaUsage(env.PULSE);
  const hour = new Date().getUTCHours();
  const nearReset = hour >= 22 || hour <= 1;

  // Get latest production stats
  const today = new Date().toISOString().slice(0, 10);
  const stats = await env.DB.prepare(
    `SELECT
       COUNT(CASE WHEN status = 'published' THEN 1 END) as published,
       COUNT(CASE WHEN status = 'audio_ready' THEN 1 END) as audio_ready,
       COUNT(CASE WHEN status = 'new' THEN 1 END) as new_stories,
       COUNT(CASE WHEN status = 'visualized' THEN 1 END) as visualized
     FROM stories
     WHERE discovered_at >= ?`
  ).bind(today).first();

  const recentLogs = await env.DB.prepare(
    `SELECT * FROM production_log WHERE created_at >= ? ORDER BY id DESC LIMIT 20`
  ).bind(today).all();

  return jsonResponse({
    status: 'ok',
    quota: {
      used: quota.used,
      remaining: quota.remaining,
      available_pct: Math.round(quota.available * 100),
      limit: 100_000,
    },
    reset: {
      near_reset: nearReset,
      hour_utc: hour,
      reset_at: '00:00 UTC',
    },
    production: {
      today: stats || {},
      recent_activity: recentLogs.results || [],
    },
    maritime: {
      tide: quota.available > 0.7 ? 'high' : quota.available > 0.4 ? 'medium' : 'low',
      moon: nearReset ? 'pulling hard' : 'drifting',
      forecast: nearReset && quota.available > 0.7
        ? 'Time to haul. The fleet is restless.'
        : quota.available < 0.3
        ? 'Low water. We wait for the turn.'
        : 'Steady current. Light work.',
    },
  });
}

// ─── Manual burst trigger ───
async function triggerBurst(env: Env): Promise<Response> {
  await logProduction(env.DB, 'quota-manager', 'manual_burst', null, {
    triggered_by: 'api',
    timestamp: new Date().toISOString(),
  });

  // In a real deploy, this would dispatch to the other workers
  // For now, we record the intent and let cron pick it up
  await env.PULSE.put('burst:requested', new Date().toISOString(), {
    expirationTtl: 3600,
  });

  return jsonResponse({
    status: 'burst_triggered',
    message: 'Production burst queued. The crew is waking up.',
    timestamp: new Date().toISOString(),
  });
}

// ─── Quota history ───
async function getQuotaHistory(env: Env): Promise<Response> {
  const results = await env.DB.prepare(
    `SELECT * FROM quota_snapshots
     ORDER BY created_at DESC
     LIMIT 168` // 7 days of hourly snapshots
  ).all();

  return jsonResponse({
    history: results.results,
    count: results.results.length,
  });
}

// ─── Check if users are hitting the site ───
async function checkUserTraffic(env: Env): Promise<boolean> {
  // Check Cloudflare Analytics API for recent requests
  // For now: check if there are recent non-cron entries in the KV
  const recentActivity = await env.PULSE.get('last:user:request');
  if (!recentActivity) return false;

  const lastSeen = new Date(recentActivity).getTime();
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return lastSeen > fiveMinutesAgo;
}

// ─── Production burst: go hard before reset ───
async function triggerProductionBurst(env: Env): Promise<void> {
  await logProduction(env.DB, 'quota-manager', 'production_burst', null, {
    quota_available: (await getQuotaUsage(env.PULSE)).available,
    trigger: 'cron_auto',
  });

  // Flag for other workers to see
  await env.PULSE.put('mode:production', 'burst', { expirationTtl: 7200 });

  // The cron triggers in the other workers will see this flag
  // and run their heavy operations
}

// ─── Light production: steady pace ───
async function triggerLightProduction(env: Env): Promise<void> {
  await logProduction(env.DB, 'quota-manager', 'light_production', null, {
    quota_available: (await getQuotaUsage(env.PULSE)).available,
    trigger: 'cron_auto',
  });

  await env.PULSE.put('mode:production', 'light', { expirationTtl: 3600 });
}
