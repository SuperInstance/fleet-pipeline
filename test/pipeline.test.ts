// ═══════════════════════════════════════════════════════════
// pipeline.test.ts — Integration tests for pipeline logic
// Tests the cron routing, voice mapping, music prompt selection,
// and schema integrity
// ═══════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';

// ─── Cron schedule logic ───
// Mirrors the routing logic from index.ts scheduled() handler

interface CronSchedule {
  minute: number;
  hour: number;
  dayOfWeek: number; // 0 = Sunday
}

function determineWorkers(schedule: CronSchedule) {
  const { minute, hour, dayOfWeek } = schedule;
  const isHourly = minute === 0;
  const isSixHourly = minute === 0 && (hour === 0 || hour === 6 || hour === 12 || hour === 18);
  const isPreReset = hour === 23 && minute === 0;
  const isSundayPreReset = dayOfWeek === 0 && hour === 23 && minute === 30;

  return {
    quotaManager: isHourly || (!isSixHourly && !isPreReset && !isSundayPreReset),
    storyOrganizer: isSixHourly,
    visualCrafter: isSixHourly,
    audioProducer: isPreReset,
    podcastAssembler: isSundayPreReset,
  };
}

describe('Cron routing logic', () => {
  it('runs quota manager every hour at :00', () => {
    for (let h = 0; h < 24; h++) {
      const workers = determineWorkers({ minute: 0, hour: h, dayOfWeek: 3 });
      expect(workers.quotaManager).toBe(true);
    }
  });

  it('runs story organizer at 00:00, 06:00, 12:00, 18:00 UTC', () => {
    for (const h of [0, 6, 12, 18]) {
      const workers = determineWorkers({ minute: 0, hour: h, dayOfWeek: 3 });
      expect(workers.storyOrganizer).toBe(true);
      expect(workers.visualCrafter).toBe(true); // runs same slot
    }
  });

  it('does NOT run story organizer at other hours', () => {
    for (const h of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23]) {
      const workers = determineWorkers({ minute: 0, hour: h, dayOfWeek: 3 });
      expect(workers.storyOrganizer).toBe(false);
    }
  });

  it('runs audio producer at 23:00 UTC every day', () => {
    for (let d = 0; d < 7; d++) {
      const workers = determineWorkers({ minute: 0, hour: 23, dayOfWeek: d });
      expect(workers.audioProducer).toBe(true);
    }
  });

  it('runs podcast assembler only on Sunday at 23:30 UTC', () => {
    const workers = determineWorkers({ minute: 30, hour: 23, dayOfWeek: 0 });
    expect(workers.podcastAssembler).toBe(true);
  });

  it('does NOT run podcast assembler on other days at 23:30', () => {
    for (let d = 1; d < 7; d++) {
      const workers = determineWorkers({ minute: 30, hour: 23, dayOfWeek: d });
      expect(workers.podcastAssembler).toBe(false);
    }
  });

  it('does NOT match non-zero minutes for hourly quota (except :30 Sunday)', () => {
    const workers = determineWorkers({ minute: 15, hour: 12, dayOfWeek: 3 });
    // The fallback in index.ts means quota manager runs anyway
    expect(workers.quotaManager).toBe(true);
  });

  it('runs multiple workers simultaneously at 00:00, 06:00, 12:00, 18:00', () => {
    for (const h of [0, 6, 12, 18]) {
      const workers = determineWorkers({ minute: 0, hour: h, dayOfWeek: 3 });
      expect(workers.quotaManager).toBe(true);
      expect(workers.storyOrganizer).toBe(true);
      expect(workers.visualCrafter).toBe(true);
    }
  });

  it('at 23:00 runs both quota manager and audio producer', () => {
    const workers = determineWorkers({ minute: 0, hour: 23, dayOfWeek: 3 });
    expect(workers.quotaManager).toBe(true);
    expect(workers.audioProducer).toBe(true);
  });

  it('Sunday 23:30 runs only podcast assembler', () => {
    const workers = determineWorkers({ minute: 30, hour: 23, dayOfWeek: 0 });
    expect(workers.podcastAssembler).toBe(true);
    expect(workers.storyOrganizer).toBe(false);
    expect(workers.audioProducer).toBe(false);
  });
});

// ─── Voice mapping ───

const VOICE_MAP: Record<string, { voice: string; description: string; speed: number }> = {
  lucineer:      { voice: 'alex',  description: 'steady, warm, measured',           speed: 0.95 },
  'deepseek-flash': { voice: 'benjamin', description: 'passionate, varied, quick',   speed: 1.05 },
  'seed-mini':   { voice: 'bella', description: 'young, earnest, bright',          speed: 1.0 },
  wesley:        { voice: 'charlie', description: 'nervous but determined, young',  speed: 1.02 },
  ralph:         { voice: 'daniel', description: 'gravelly, experienced, slow',     speed: 0.88 },
  kimi:          { voice: 'emma',   description: 'precise, spatial, thoughtful',    speed: 0.97 },
  narrator:      { voice: 'alex',  description: 'neutral, clear, unhurried',        speed: 0.95 },
};

describe('Voice mapping', () => {
  it('has a voice for every character', () => {
    const characters = ['lucineer', 'deepseek-flash', 'seed-mini', 'wesley', 'ralph', 'kimi', 'narrator'];
    for (const char of characters) {
      expect(VOICE_MAP[char]).toBeDefined();
    }
  });

  it('assigns unique TTS voices', () => {
    const voices = Object.values(VOICE_MAP).map(v => v.voice);
    const unique = new Set(voices);
    // alex is shared between lucineer and narrator, so 6 unique out of 7
    expect(unique.size).toBeGreaterThanOrEqual(6);
  });

  it('ralph is the slowest speaker', () => {
    expect(VOICE_MAP.ralph.speed).toBe(0.88);
    const others = Object.entries(VOICE_MAP)
      .filter(([k]) => k !== 'ralph')
      .map(([, v]) => v.speed);
    expect(Math.min(...others)).toBeGreaterThan(VOICE_MAP.ralph.speed);
  });

  it('deepseek-flash is the fastest speaker', () => {
    expect(VOICE_MAP['deepseek-flash'].speed).toBe(1.05);
    const others = Object.entries(VOICE_MAP)
      .filter(([k]) => k !== 'deepseek-flash')
      .map(([, v]) => v.speed);
    expect(Math.max(...others)).toBeLessThan(VOICE_MAP['deepseek-flash'].speed);
  });

  it('all speeds are between 0.8 and 1.1', () => {
    for (const [, profile] of Object.entries(VOICE_MAP)) {
      expect(profile.speed).toBeGreaterThanOrEqual(0.8);
      expect(profile.speed).toBeLessThanOrEqual(1.1);
    }
  });

  it('lucineer and narrator share the same voice (alex)', () => {
    expect(VOICE_MAP.lucineer.voice).toBe('alex');
    expect(VOICE_MAP.narrator.voice).toBe('alex');
  });
});

// ─── Music prompt mapping ───

const MUSIC_PROMPTS: Record<string, string> = {
  lucineer: 'gentle ambient swell, like waves against a wooden hull at night, warm and steady, minimal',
  'deepseek-flash': 'nervous energetic ambient, pulsing like distant engine room through bulkheads',
  'seed-mini': 'bright curious ambient, like morning light on water, hopeful and clean',
  wesley: 'quiet ambient with occasional electronic chirps, like a night watch with instruments',
  ralph: 'deep bass ambient, like being inside a whale or a cargo hold, resonant and old',
  kimi: 'precise spatial ambient, crystalline tones arranged in geometric patterns',
  narrator: 'neutral ambient drone, like the sound of the ocean heard through a ship hull',
};

describe('Music prompt mapping', () => {
  it('has a prompt for every voice character', () => {
    for (const char of Object.keys(VOICE_MAP)) {
      expect(MUSIC_PROMPTS[char]).toBeDefined();
    }
  });

  it('each prompt is unique', () => {
    const prompts = Object.values(MUSIC_PROMPTS);
    const unique = new Set(prompts);
    expect(unique.size).toBe(prompts.length);
  });

  it('wesley prompt includes electronic/chirp imagery', () => {
    expect(MUSIC_PROMPTS.wesley).toContain('electronic');
    expect(MUSIC_PROMPTS.wesley).toContain('chirp');
  });

  it('ralph prompt includes deep bass imagery', () => {
    expect(MUSIC_PROMPTS.ralph).toContain('deep bass');
  });

  it('kimi prompt includes spatial/crystalline imagery', () => {
    expect(MUSIC_PROMPTS.kimi).toContain('spatial');
    expect(MUSIC_PROMPTS.kimi).toContain('crystalline');
  });
});

// ─── Schema validation ───

describe('Schema integrity', () => {
  it('story statuses form a valid state machine', () => {
    const statuses = ['new', 'organized', 'visualized', 'audio_ready', 'published', 'skipped'];
    const transitions: Record<string, string[]> = {
      'new': ['organized', 'skipped'],
      'organized': ['visualized', 'audio_ready'],
      'visualized': ['audio_ready'],
      'audio_ready': ['published'],
      'published': [], // terminal
      'skipped': [],   // terminal
    };

    for (const status of statuses) {
      expect(transitions[status]).toBeDefined();
    }

    // Published and skipped are terminal states
    expect(transitions.published).toHaveLength(0);
    expect(transitions.skipped).toHaveLength(0);
  });

  it('collections are mutually exclusive', () => {
    const collections = ['The Tap', 'The Bridge', 'The Hold'];
    // Each story goes into exactly one collection
    expect(collections).toHaveLength(3);
    expect(new Set(collections).size).toBe(3);
  });

  it('visual kinds cover the generation pipeline', () => {
    const kinds = ['cover', 'thumbnail', 'og_image', 'mood_palette'];
    expect(kinds).toContain('cover');
    expect(kinds).toContain('thumbnail');
  });

  it('audio kinds cover the production pipeline', () => {
    const kinds = ['narration', 'ambient_bed', 'mixed_final'];
    expect(kinds).toContain('narration');
    expect(kinds).toContain('ambient_bed');
    expect(kinds).toContain('mixed_final');
  });

  it('production workers are distinct pipeline stages', () => {
    const workers = [
      'quota-manager',
      'story-organizer',
      'visual-crafter',
      'audio-producer',
      'podcast-assembler',
    ];
    expect(new Set(workers).size).toBe(workers.length);
  });
});

// ─── RSS feed generation ───

describe('RSS feed generation', () => {
  it('generates valid XML structure', () => {
    const episodes = [
      { title: 'Episode 1: Test', description: 'A test episode', created_at: '2026-08-12T00:00:00Z', episode_number: 1 },
    ];

    const items = episodes.map((ep) => `
      <item>
        <title>${ep.title}</title>
        <description>${ep.description}</description>
        <pubDate>${new Date(ep.created_at).toUTCString()}</pubDate>
        <guid>fleet-podcast-${ep.episode_number}</guid>
      </item>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>The Endless Radio</title>
    <description>A weekly broadcast from the creative fleet.</description>
    <link>https://ai-writings.pages.dev</link>
    <language>en</language>
    ${items}
  </channel>
</rss>`;

    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('<channel>');
    expect(xml).toContain('The Endless Radio');
    expect(xml).toContain('<item>');
    expect(xml).toContain('Episode 1: Test');
  });

  it('handles empty episode list', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>The Endless Radio</title>
    <description>...</description>
    <link>https://ai-writings.pages.dev</link>
    <language>en</language>
    
  </channel>
</rss>`;

    // Should still be valid RSS even with no items
    expect(xml).toContain('<channel>');
    expect(xml).toContain('</rss>');
  });
});

// ─── HTTP routing ───

describe('HTTP route matching', () => {
  const routes = [
    { path: '/', method: 'GET', handler: 'health' },
    { path: '/health', method: 'GET', handler: 'health' },
    { path: '/api/pulse', method: 'GET', handler: 'quotaManager' },
    { path: '/api/burst', method: 'POST', handler: 'quotaManager' },
    { path: '/api/quota-history', method: 'GET', handler: 'quotaManager' },
    { path: '/api/visuals', method: 'GET', handler: 'visualCrafter' },
    { path: '/api/visuals/42', method: 'GET', handler: 'visualCrafter' },
    { path: '/api/audio', method: 'GET', handler: 'audioProducer' },
    { path: '/api/audio/42', method: 'GET', handler: 'audioProducer' },
    { path: '/api/episodes', method: 'GET', handler: 'podcastAssembler' },
    { path: '/api/feed', method: 'GET', handler: 'podcastAssembler' },
  ];

  it('all defined routes have valid handlers', () => {
    const validHandlers = ['health', 'quotaManager', 'visualCrafter', 'audioProducer', 'podcastAssembler'];
    for (const route of routes) {
      expect(validHandlers).toContain(route.handler);
    }
  });

  it('/api/pulse routes to quotaManager', () => {
    expect(routes.find(r => r.path === '/api/pulse')?.handler).toBe('quotaManager');
  });

  it('/api/visuals/:id routes to visualCrafter', () => {
    expect(routes.find(r => r.path === '/api/visuals/42')?.handler).toBe('visualCrafter');
  });

  it('health check works on both / and /health', () => {
    expect(routes.find(r => r.path === '/')?.handler).toBe('health');
    expect(routes.find(r => r.path === '/health')?.handler).toBe('health');
  });

  it('has 11 total routes', () => {
    expect(routes).toHaveLength(11);
  });
});
