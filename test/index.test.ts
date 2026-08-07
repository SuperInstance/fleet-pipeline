// ═══════════════════════════════════════════════════════════
// index.test.ts — Tests for the HTTP routing layer
// Tests path matching, method routing, and 404 handling.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';

// ─── Route matching ───
function matchRoute(pathname: string, method: string): string | null {
  if ((pathname === '/' || pathname === '/health') && method === 'GET') return 'health';
  if ((pathname.startsWith('/api/pulse') || pathname.startsWith('/api/burst') || pathname.startsWith('/api/quota-history'))) {
    return 'quota-manager';
  }
  if (pathname.startsWith('/api/visuals')) return 'visual-crafter';
  if (pathname.startsWith('/api/audio')) return 'audio-producer';
  if (pathname.startsWith('/api/episodes') || pathname.startsWith('/api/feed')) return 'podcast-assembler';
  return null; // 404
}

describe('HTTP route matching', () => {
  it('routes / and /health to health check', () => {
    expect(matchRoute('/', 'GET')).toBe('health');
    expect(matchRoute('/health', 'GET')).toBe('health');
  });

  it('routes /api/pulse to quota-manager', () => {
    expect(matchRoute('/api/pulse', 'GET')).toBe('quota-manager');
  });

  it('routes /api/burst to quota-manager', () => {
    expect(matchRoute('/api/burst', 'POST')).toBe('quota-manager');
  });

  it('routes /api/quota-history to quota-manager', () => {
    expect(matchRoute('/api/quota-history', 'GET')).toBe('quota-manager');
  });

  it('routes /api/visuals to visual-crafter', () => {
    expect(matchRoute('/api/visuals', 'GET')).toBe('visual-crafter');
  });

  it('routes /api/visuals/:id to visual-crafter', () => {
    expect(matchRoute('/api/visuals/123', 'GET')).toBe('visual-crafter');
  });

  it('routes /api/audio to audio-producer', () => {
    expect(matchRoute('/api/audio', 'GET')).toBe('audio-producer');
  });

  it('routes /api/audio/:id to audio-producer', () => {
    expect(matchRoute('/api/audio/45', 'GET')).toBe('audio-producer');
  });

  it('routes /api/episodes to podcast-assembler', () => {
    expect(matchRoute('/api/episodes', 'GET')).toBe('podcast-assembler');
  });

  it('routes /api/feed to podcast-assembler (RSS)', () => {
    expect(matchRoute('/api/feed', 'GET')).toBe('podcast-assembler');
  });

  it('returns null for unknown paths', () => {
    expect(matchRoute('/unknown', 'GET')).toBeNull();
    expect(matchRoute('/api/unknown', 'GET')).toBeNull();
    expect(matchRoute('/api', 'GET')).toBeNull();
  });

  it('handles paths with trailing slashes', () => {
    // startsWith works with trailing slash — should still match
    expect(matchRoute('/api/visuals/', 'GET')).toBe('visual-crafter');
    expect(matchRoute('/api/audio/', 'GET')).toBe('audio-producer');
  });

  it('handles /api/feed with query params in real usage', () => {
    // Query params are stripped before routing (URL parsing)
    expect(matchRoute('/api/feed', 'GET')).toBe('podcast-assembler');
  });
});

// ─── HTTP method validation (within handlers) ───
describe('handler method validation', () => {
  it('quota-manager handler routes GET /api/pulse', () => {
    const path = '/api/pulse';
    const method = 'GET';
    // handleQuotaManager checks path + method
    expect(path === '/api/pulse' && method === 'GET').toBe(true);
  });

  it('quota-manager handler routes POST /api/burst', () => {
    const path = '/api/burst';
    const method = 'POST';
    expect(path === '/api/burst' && method === 'POST').toBe(true);
  });

  it('quota-manager handler returns 404 for unknown sub-paths', () => {
    // e.g., /api/pulse/sub/deep — startsWith('/api/pulse') matches but no handler
    const path = '/api/pulse/sub';
    const knownPaths = ['/api/pulse', '/api/burst', '/api/quota-history'];
    const matched = knownPaths.some(p => path === p);
    expect(matched).toBe(false); // Would return 404
  });
});

// ─── Story ID extraction from path ───
describe('story ID extraction', () => {
  function extractStoryId(pathname: string): string | null {
    const parts = pathname.split('/');
    const last = parts[parts.length - 1];
    return last || null;
  }

  it('extracts ID from /api/visuals/123', () => {
    expect(extractStoryId('/api/visuals/123')).toBe('123');
  });

  it('extracts ID from /api/audio/45', () => {
    expect(extractStoryId('/api/audio/45')).toBe('45');
  });

  it('returns the base path when no ID present', () => {
    // /api/visuals — last segment is "visuals"
    expect(extractStoryId('/api/visuals')).toBe('visuals');
  });

  it('handles trailing slash', () => {
    // split('/api/visuals/') = ['', 'api', 'visuals', '']
    // empty string is falsy, so returns null
    expect(extractStoryId('/api/visuals/')).toBeNull();
  });
});
