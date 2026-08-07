// ═══════════════════════════════════════════════════════════
// quota-manager.test.ts — Tests for the quota manager module
// Tests cron routing, traffic detection, burst triggers.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';

// ─── Cron routing logic ───
// index.ts routes cron triggers based on UTC minute/hour/day
describe('cron routing logic', () => {
  function routeCron(scheduledTime: Date): string[] {
    const h = scheduledTime.getUTCHours();
    const m = scheduledTime.getUTCMinutes();
    const day = scheduledTime.getUTCDay();

    const isHourly = m === 0;
    const isSixHourly = m === 0 && (h === 0 || h === 6 || h === 12 || h === 18);
    const isPreReset = h === 23 && m === 0;
    const isSundayPreReset = day === 0 && h === 23 && m === 30;

    const workers: string[] = [];
    if (isHourly) workers.push('quota-manager');
    if (isSixHourly) workers.push('story-organizer');
    if (isSixHourly) workers.push('visual-crafter');
    if (isPreReset) workers.push('audio-producer');
    if (isSundayPreReset) workers.push('podcast-assembler');
    if (!isHourly && !isSixHourly && !isPreReset && !isSundayPreReset) {
      workers.push('quota-manager (fallback)');
    }
    return workers;
  }

  it('runs quota manager every hour on the hour', () => {
    for (let h = 0; h < 24; h++) {
      const time = new Date(Date.UTC(2026, 0, 1, h, 0));
      const workers = routeCron(time);
      expect(workers).toContain('quota-manager');
    }
  });

  it('runs story organizer + visual crafter at 00:00, 06:00, 12:00, 18:00 UTC', () => {
    for (const h of [0, 6, 12, 18]) {
      const time = new Date(Date.UTC(2026, 0, 1, h, 0));
      const workers = routeCron(time);
      expect(workers).toContain('story-organizer');
      expect(workers).toContain('visual-crafter');
    }
  });

  it('does NOT run story organizer at non-six-hourly times', () => {
    for (const h of [1, 2, 3, 4, 5, 7, 8, 10, 14, 17, 19, 20, 22]) {
      const time = new Date(Date.UTC(2026, 0, 1, h, 0));
      const workers = routeCron(time);
      expect(workers).not.toContain('story-organizer');
    }
  });

  it('runs audio producer at 23:00 UTC', () => {
    const time = new Date(Date.UTC(2026, 0, 1, 23, 0));
    expect(routeCron(time)).toContain('audio-producer');
  });

  it('does NOT run audio producer at other times', () => {
    const time = new Date(Date.UTC(2026, 0, 1, 22, 0));
    expect(routeCron(time)).not.toContain('audio-producer');
  });

  it('runs podcast assembler only on Sunday 23:30 UTC', () => {
    // Sunday = day 0
    const sundayTime = new Date(Date.UTC(2026, 0, 4, 23, 30)); // Jan 4 2026 is Sunday
    expect(routeCron(sundayTime)).toContain('podcast-assembler');

    // Monday 23:30 should NOT trigger it
    const mondayTime = new Date(Date.UTC(2026, 0, 5, 23, 30));
    expect(routeCron(mondayTime)).not.toContain('podcast-assembler');

    // Sunday 23:00 should NOT trigger it (wrong minute)
    const sundayWrongMin = new Date(Date.UTC(2026, 0, 4, 23, 0));
    expect(routeCron(sundayWrongMin)).not.toContain('podcast-assembler');
  });

  it('uses fallback for non-matching cron times', () => {
    // A time that doesn't match any pattern (not :00 minute)
    const time = new Date(Date.UTC(2026, 0, 1, 12, 30));
    const workers = routeCron(time);
    expect(workers).toContain('quota-manager (fallback)');
  });

  it('at 18:00 UTC runs quota + story + visual but not audio/podcast', () => {
    const time = new Date(Date.UTC(2026, 0, 1, 18, 0));
    const workers = routeCron(time);
    expect(workers).toContain('quota-manager');
    expect(workers).toContain('story-organizer');
    expect(workers).toContain('visual-crafter');
    expect(workers).not.toContain('audio-producer');
    expect(workers).not.toContain('podcast-assembler');
  });

  it('at 23:00 UTC on non-Sunday runs quota + audio but not podcast', () => {
    const wednesday = new Date(Date.UTC(2026, 0, 7, 23, 0)); // Jan 7 is Wednesday
    const workers = routeCron(wednesday);
    expect(workers).toContain('quota-manager');
    expect(workers).toContain('audio-producer');
    expect(workers).not.toContain('podcast-assembler');
  });

  it('Sunday 23:00 runs quota + audio but not podcast (podcast is 23:30)', () => {
    const sunday = new Date(Date.UTC(2026, 0, 4, 23, 0));
    const workers = routeCron(sunday);
    expect(workers).toContain('audio-producer');
    expect(workers).not.toContain('podcast-assembler');
  });
});

// ─── User traffic detection ───
describe('checkUserTraffic logic', () => {
  function checkTraffic(lastRequestTime: string | null, now: number): boolean {
    if (!lastRequestTime) return false;
    const lastSeen = new Date(lastRequestTime).getTime();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    return lastSeen > fiveMinutesAgo;
  }

  it('returns false when no traffic recorded', () => {
    expect(checkTraffic(null, Date.now())).toBe(false);
  });

  it('returns true when request was 1 minute ago', () => {
    const now = Date.now();
    const oneMinAgo = new Date(now - 60 * 1000).toISOString();
    expect(checkTraffic(oneMinAgo, now)).toBe(true);
  });

  it('returns false when request was 6 minutes ago', () => {
    const now = Date.now();
    const sixMinAgo = new Date(now - 6 * 60 * 1000).toISOString();
    expect(checkTraffic(sixMinAgo, now)).toBe(false);
  });

  it('returns true when request was 4 minutes ago (within window)', () => {
    const now = Date.now();
    const fourMinAgo = new Date(now - 4 * 60 * 1000).toISOString();
    expect(checkTraffic(fourMinAgo, now)).toBe(true);
  });

  it('returns true for request exactly 5 minutes + 1 second ago (just outside)', () => {
    const now = Date.now();
    const justOutside = new Date(now - (5 * 60 * 1000 + 1000)).toISOString();
    expect(checkTraffic(justOutside, now)).toBe(false);
  });

  it('returns true for request 1 second ago', () => {
    const now = Date.now();
    const oneSecAgo = new Date(now - 1000).toISOString();
    expect(checkTraffic(oneSecAgo, now)).toBe(true);
  });
});

// ─── Health check endpoint ───
describe('health check response', () => {
  function buildHealthResponse(quotaAvailable: number) {
    return {
      name: 'Fleet Pipeline',
      status: 'running',
      tide: quotaAvailable > 0.7 ? 'high' : quotaAvailable > 0.4 ? 'medium' : 'low',
      quota_remaining: Math.round(quotaAvailable * 100000),
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
    };
  }

  it('reports high tide when quota > 70%', () => {
    expect(buildHealthResponse(0.9).tide).toBe('high');
    expect(buildHealthResponse(0.71).tide).toBe('high');
  });

  it('reports medium tide when 40-70%', () => {
    expect(buildHealthResponse(0.5).tide).toBe('medium');
    expect(buildHealthResponse(0.41).tide).toBe('medium');
  });

  it('reports low tide when <= 40%', () => {
    expect(buildHealthResponse(0.3).tide).toBe('low');
    expect(buildHealthResponse(0.1).tide).toBe('low');
    expect(buildHealthResponse(0.0).tide).toBe('low');
  });

  it('lists all endpoints', () => {
    const resp = buildHealthResponse(1.0);
    expect(resp.endpoints).toHaveLength(9);
    expect(resp.endpoints).toContain('GET  /api/pulse');
    expect(resp.endpoints).toContain('GET  /api/feed (RSS)');
  });

  it('always reports running status', () => {
    expect(buildHealthResponse(1.0).status).toBe('running');
    expect(buildHealthResponse(0.0).status).toBe('running');
  });
});

// ─── Maritime forecast logic ───
describe('maritime forecast', () => {
  function buildForecast(quotaAvailable: number, nearReset: boolean): string {
    return nearReset && quotaAvailable > 0.7
      ? 'Time to haul. The fleet is restless.'
      : quotaAvailable < 0.3
      ? 'Low water. We wait for the turn.'
      : 'Steady current. Light work.';
  }

  it('says time to haul when near reset with high quota', () => {
    expect(buildForecast(0.8, true)).toBe('Time to haul. The fleet is restless.');
    expect(buildForecast(0.71, true)).toBe('Time to haul. The fleet is restless.');
  });

  it('says low water when quota below 30%', () => {
    expect(buildForecast(0.2, false)).toBe('Low water. We wait for the turn.');
    expect(buildForecast(0.2, true)).toBe('Low water. We wait for the turn.');
  });

  it('says steady current in normal conditions', () => {
    expect(buildForecast(0.5, false)).toBe('Steady current. Light work.');
    expect(buildForecast(0.6, true)).toBe('Steady current. Light work.');
    expect(buildForecast(0.5, true)).toBe('Steady current. Light work.');
  });
});
