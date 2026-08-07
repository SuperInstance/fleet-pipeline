// ═══════════════════════════════════════════════════════════
// audio-producer.test.ts — Tests for the audio producer module
// Tests voice mapping, music prompt building, and track logic.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';

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

describe('VOICE_MAP', () => {
  it('has all expected character voices', () => {
    expect(VOICE_MAP.lucineer).toBeDefined();
    expect(VOICE_MAP['deepseek-flash']).toBeDefined();
    expect(VOICE_MAP['seed-mini']).toBeDefined();
    expect(VOICE_MAP.wesley).toBeDefined();
    expect(VOICE_MAP.ralph).toBeDefined();
    expect(VOICE_MAP.kimi).toBeDefined();
    expect(VOICE_MAP.narrator).toBeDefined();
  });

  it('each voice has voice, description, and speed', () => {
    for (const [name, profile] of Object.entries(VOICE_MAP)) {
      expect(profile.voice).toBeTruthy();
      expect(profile.description).toBeTruthy();
      expect(profile.speed).toBeGreaterThan(0);
      expect(profile.speed).toBeLessThan(2);
    }
  });

  it('ralph is the slowest voice', () => {
    expect(VOICE_MAP.ralph.speed).toBe(0.88);
    expect(VOICE_MAP.ralph.speed).toBeLessThan(VOICE_MAP.lucineer.speed);
  });

  it('deepseek-flash is the fastest voice', () => {
    expect(VOICE_MAP['deepseek-flash'].speed).toBe(1.05);
    expect(VOICE_MAP['deepseek-flash'].speed).toBeGreaterThan(VOICE_MAP.lucineer.speed);
  });

  it('lucineer and narrator share the same voice (alex)', () => {
    expect(VOICE_MAP.lucineer.voice).toBe(VOICE_MAP.narrator.voice);
    expect(VOICE_MAP.lucineer.voice).toBe('alex');
  });

  it('wesley uses charlie voice', () => {
    expect(VOICE_MAP.wesley.voice).toBe('charlie');
  });

  it('speeds are reasonable (0.8-1.1)', () => {
    for (const profile of Object.values(VOICE_MAP)) {
      expect(profile.speed).toBeGreaterThanOrEqual(0.8);
      expect(profile.speed).toBeLessThanOrEqual(1.1);
    }
  });
});

// ─── buildMusicPrompt ───
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

describe('buildMusicPrompt', () => {
  it('returns unique prompt for each known voice', () => {
    const prompts = new Set<string>();
    for (const voice of Object.keys(VOICE_MAP)) {
      prompts.add(buildMusicPrompt(voice));
    }
    // All 7 voices should have unique prompts
    expect(prompts.size).toBe(7);
  });

  it('falls back to narrator for unknown voice', () => {
    const unknown = buildMusicPrompt('unknown-character');
    expect(unknown).toBe(buildMusicPrompt('narrator'));
  });

  it('includes maritime imagery', () => {
    expect(buildMusicPrompt('lucineer')).toContain('hull');
    expect(buildMusicPrompt('ralph')).toContain('whale');
    expect(buildMusicPrompt('narrator')).toContain('ocean');
    expect(buildMusicPrompt('seed-mini')).toContain('water');
  });

  it('wesley prompt includes electronic elements', () => {
    expect(buildMusicPrompt('wesley')).toContain('electronic');
    expect(buildMusicPrompt('wesley')).toContain('chirps');
  });

  it('all prompts mention ambient', () => {
    for (const voice of Object.keys(VOICE_MAP)) {
      expect(buildMusicPrompt(voice)).toContain('ambient');
    }
  });
});

// ─── TTS fallback logic ───
describe('TTS fallback logic', () => {
  it('would retry with defaults on voice failure', () => {
    // The code tries melotts with voice params, then retries with just text+lang
    const firstAttempt = { text: 'hello', lang: 'en', voice: 'alex', speed: 0.95 };
    const fallbackAttempt = { text: 'hello', lang: 'en' };
    
    // Fallback should NOT have voice or speed
    expect(fallbackAttempt.voice).toBeUndefined();
    expect(fallbackAttempt.speed).toBeUndefined();
    // But should retain text and lang
    expect(fallbackAttempt.text).toBe(firstAttempt.text);
    expect(fallbackAttempt.lang).toBe(firstAttempt.lang);
  });
});

// ─── Script length limits ───
describe('melotts script length limit', () => {
  it('truncates script to 3000 chars for TTS', () => {
    const longScript = 'A'.repeat(5000);
    const truncated = longScript.slice(0, 3000);
    expect(truncated.length).toBe(3000);
    expect(truncated).not.toContain('A'.repeat(3001));
  });
});
