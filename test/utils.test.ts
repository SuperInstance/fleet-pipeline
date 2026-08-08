import { describe, it, expect } from 'vitest';
import {
  decideProductionMode,
  r2Key,
  buildClassificationPrompt,
  buildAudioAdaptationPrompt,
  buildVisualPrompt,
  jsonResponse,
  type ProductionMode,
} from '../src/utils';

// ─── decideProductionMode ───

describe('decideProductionMode', () => {
  it('returns idle when users are active', () => {
    expect(decideProductionMode(0.9, 15, true)).toBe('idle');
    expect(decideProductionMode(0.3, 23, true)).toBe('idle');
    expect(decideProductionMode(1.0, 0, true)).toBe('idle');
  });

  it('returns burst when quota is high and near reset', () => {
    expect(decideProductionMode(0.8, 23, false)).toBe('burst');
    expect(decideProductionMode(0.9, 0, false)).toBe('burst');
    expect(decideProductionMode(0.75, 22, false)).toBe('burst');
    expect(decideProductionMode(0.95, 1, false)).toBe('burst');
  });

  it('returns light when quota is moderate', () => {
    expect(decideProductionMode(0.6, 12, false)).toBe('light');
    expect(decideProductionMode(0.55, 10, false)).toBe('light');
  });

  it('returns idle when quota is low', () => {
    expect(decideProductionMode(0.2, 12, false)).toBe('idle');
    expect(decideProductionMode(0.1, 15, false)).toBe('idle');
    expect(decideProductionMode(0.0, 10, false)).toBe('idle');
  });

  it('does not burst outside reset window even with high quota', () => {
    expect(decideProductionMode(0.9, 12, false)).toBe('light');
    expect(decideProductionMode(0.95, 5, false)).toBe('light');
  });

  it('returns idle at exactly 0.5 quota (strict greater-than)', () => {
    // The code uses > not >=, so exactly 0.5 falls through to idle
    expect(decideProductionMode(0.5, 10, false)).toBe('idle');
  });

  it('returns light at exactly 0.7 quota at reset window (strict greater-than)', () => {
    // The code uses > not >=, so exactly 0.7 doesn't trigger burst
    expect(decideProductionMode(0.7, 23, false)).toBe('light');
  });

  it('user traffic overrides everything', () => {
    // Even with high quota near reset, users active = idle
    expect(decideProductionMode(0.95, 23, true)).toBe('idle');
  });
});

// ─── r2Key ───

describe('r2Key', () => {
  it('builds a dated key with prefix, slug, extension', () => {
    const key = r2Key('audio', 'the-lighthouse', 'mp3');
    // Format: prefix/YYYY-MM-DD/slug.ext
    expect(key).toMatch(/^audio\/\d{4}-\d{2}-\d{2}\/the-lighthouse\.mp3$/);
  });

  it('handles different prefixes', () => {
    expect(r2Key('visuals', 'test', 'jpg')).toMatch(/^visuals\//);
    expect(r2Key('stories', 'test', 'json')).toMatch(/^stories\//);
  });

  it('handles different extensions', () => {
    const key = r2Key('media', 'piece', 'wav');
    expect(key).toMatch(/\.wav$/);
  });

  it('uses current date', () => {
    const key = r2Key('test', 'slug', 'txt');
    const today = new Date().toISOString().slice(0, 10);
    expect(key).toContain(today);
  });
});

// ─── buildClassificationPrompt ───

describe('buildClassificationPrompt', () => {
  it('returns a two-message array (system + user)', () => {
    const messages = buildClassificationPrompt('Title', 'Content');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes the title in user message', () => {
    const messages = buildClassificationPrompt('My Great Piece', 'body text');
    expect(messages[1].content).toContain('My Great Piece');
  });

  it('includes the content excerpt in user message', () => {
    const longContent = 'A'.repeat(3000);
    const messages = buildClassificationPrompt('T', longContent);
    // Should be truncated to 2000 chars
    expect(messages[1].content).toContain('A'.repeat(2000));
    expect(messages[1].content.length).toBeLessThan(longContent.length + 100);
  });

  it('mentions the classification types in system message', () => {
    const messages = buildClassificationPrompt('T', 'C');
    expect(messages[0].content).toContain('essay');
    expect(messages[0].content).toContain('fiction');
    expect(messages[0].content).toContain('poetry');
    expect(messages[0].content).toContain('philosophy');
  });

  it('mentions the collections in system message', () => {
    const messages = buildClassificationPrompt('T', 'C');
    expect(messages[0].content).toContain('The Tap');
    expect(messages[0].content).toContain('The Bridge');
    expect(messages[0].content).toContain('The Hold');
  });

  it('mentions audio and visual scoring', () => {
    const messages = buildClassificationPrompt('T', 'C');
    expect(messages[0].content).toContain('audio_suitability_score');
    expect(messages[0].content).toContain('visual_potential');
  });
});

// ─── buildAudioAdaptationPrompt ───

describe('buildAudioAdaptationPrompt', () => {
  it('returns two messages', () => {
    const messages = buildAudioAdaptationPrompt('Title', 'Content', 'wesley');
    expect(messages).toHaveLength(2);
  });

  it('includes the voice in system message', () => {
    const messages = buildAudioAdaptationPrompt('T', 'C', 'deepseek-flash');
    expect(messages[0].content).toContain('deepseek-flash');
  });

  it('includes the content in user message', () => {
    const messages = buildAudioAdaptationPrompt('T', 'body here', 'wesley');
    expect(messages[1].content).toContain('body here');
  });

  it('mentions word count constraint', () => {
    const messages = buildAudioAdaptationPrompt('T', 'C', 'narrator');
    expect(messages[0].content).toMatch(/400.?600/);
  });

  it('mentions first person', () => {
    const messages = buildAudioAdaptationPrompt('T', 'C', 'narrator');
    expect(messages[0].content).toContain('First person');
  });
});

// ─── buildVisualPrompt ───

describe('buildVisualPrompt', () => {
  it('includes the metaphor', () => {
    const prompt = buildVisualPrompt('a lighthouse in fog', 'The Keeper');
    expect(prompt).toContain('a lighthouse in fog');
  });

  it('includes the title', () => {
    const prompt = buildVisualPrompt('metaphor', 'The Last Signal');
    expect(prompt).toContain('The Last Signal');
  });

  it('includes style directives', () => {
    const prompt = buildVisualPrompt('m', 't');
    expect(prompt).toContain('painterly');
    expect(prompt).toContain('maritime');
    expect(prompt).toContain('No text');
  });

  it('requests no text in image', () => {
    const prompt = buildVisualPrompt('m', 't');
    expect(prompt).toContain('No text in the image');
  });
});

// ─── jsonResponse ───

describe('jsonResponse', () => {
  it('returns a Response object', () => {
    const resp = jsonResponse({ status: 'ok' });
    expect(resp).toBeInstanceOf(Response);
  });

  it('defaults to 200 status', () => {
    const resp = jsonResponse({});
    expect(resp.status).toBe(200);
  });

  it('accepts custom status', () => {
    const resp = jsonResponse({ error: 'nope' }, 404);
    expect(resp.status).toBe(404);
  });

  it('sets JSON content type header', () => {
    const resp = jsonResponse({});
    expect(resp.headers.get('Content-Type')).toBe('application/json');
  });

  it('sets CORS headers', () => {
    const resp = jsonResponse({});
    expect(resp.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(resp.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(resp.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('serializes data as JSON', async () => {
    const data = { name: 'test', values: [1, 2, 3] };
    const resp = jsonResponse(data);
    const body = await resp.json();
    expect(body).toEqual(data);
  });

  it('handles null data', async () => {
    const resp = jsonResponse(null);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toBeNull();
  });

  it('handles arrays', async () => {
    const resp = jsonResponse([1, 2, 3]);
    const body = await resp.json();
    expect(body).toEqual([1, 2, 3]);
  });

  it('handles error responses', async () => {
    const resp = jsonResponse({ error: 'Internal error' }, 500);
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error).toBe('Internal error');
  });
});

// ─── ProductionMode type tests ───

describe('ProductionMode', () => {
  it('has three valid modes', () => {
    const modes: ProductionMode[] = ['idle', 'light', 'burst'];
    expect(modes).toHaveLength(3);
  });
});
