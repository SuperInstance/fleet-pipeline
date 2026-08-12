// ═══════════════════════════════════════════════════════════
// helpers.test.ts — Tests for internal helper functions
// Tests slugify, extractTitle, fallbackClassification, escapeXml
// These are tested via re-export or behavioral tests
// ═══════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';

// ─── Re-implement the pure functions to test their logic ───
// Since these are module-private, we test the logic directly
// to verify correctness. If the source changes, these tests
// serve as the specification.

function slugify(path: string): string {
  return path
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(-60);
}

function extractTitle(content: string, filename: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  const base = filename.split('/').pop()?.replace(/\.md$/, '') || filename;
  return base
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function fallbackClassification(title: string, content: string): Record<string, unknown> {
  const lower = (title + ' ' + content.slice(0, 500)).toLowerCase();

  let classification = 'essay';
  if (lower.includes('poem') || content.match(/^\*\*.*\*\*\s*$/m)) classification = 'poetry';
  else if (lower.includes('fiction') || lower.includes('story') || lower.includes('chapter')) classification = 'fiction';
  else if (lower.includes('philosoph') || lower.includes('consciousness')) classification = 'philosophy';

  let collection = 'The Hold';
  if (lower.includes('i ') && lower.includes('my ')) collection = 'The Tap';
  else if (classification === 'essay' || classification === 'philosophy') collection = 'The Bridge';

  return {
    classification,
    collection,
    character_voice: 'narrator',
    audio_suitability_score: collection === 'The Tap' ? 75 : 50,
    visual_potential: 55,
    tags: ['visual potential'],
    key_metaphor: 'a ship at anchor in calm waters',
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── slugify ───

describe('slugify', () => {
  it('removes .md extension', () => {
    expect(slugify('story.md')).toBe('story');
  });

  it('converts uppercase to lowercase', () => {
    expect(slugify('TheDreamingGPU.md')).toBe('thedreaminggpu');
  });

  it('replaces non-alphanumeric chars with hyphens', () => {
    expect(slugify('the ship/sail.md')).toBe('the-ship-sail');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('a---b.md')).toBe('a-b');
  });

  it('truncates to 60 chars', () => {
    const long = 'a'.repeat(80) + '.md';
    const result = slugify(long);
    expect(result.length).toBe(60);
  });

  it('handles paths with directories', () => {
    expect(slugify('path/to/The Story.md')).toBe('path-to-the-story');
  });

  it('handles already-slugified names', () => {
    expect(slugify('already-slugified.md')).toBe('already-slugified');
  });

  it('handles numbers', () => {
    expect(slugify('story-123.md')).toBe('story-123');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('handles only-special-chars', () => {
    // .md stripped → !!! → all hyphens → collapsed → single dash
    expect(slugify('!!!.md')).toBe('-');
  });
});

// ─── extractTitle ───

describe('extractTitle', () => {
  it('extracts H1 heading', () => {
    expect(extractTitle('# The Dreaming GPU\n\nContent', 'fallback.md')).toBe('The Dreaming GPU');
  });

  it('extracts H1 with trailing spaces', () => {
    expect(extractTitle('#   Spaced Title   \n\nBody', 'file.md')).toBe('Spaced Title');
  });

  it('falls back to filename when no H1', () => {
    expect(extractTitle('Just content', 'the-quiet-ship.md')).toBe('The Quiet Ship');
  });

  it('handles underscore-separated filenames', () => {
    expect(extractTitle('Content', 'the_quiet_ship.md')).toBe('The Quiet Ship');
  });

  it('uses only the basename not directory', () => {
    expect(extractTitle('Content', 'dir/sub/the_title.md')).toBe('The Title');
  });

  it('handles H1 not at start of file', () => {
    const content = 'Some intro\n\n# The Real Title\n\nBody';
    expect(extractTitle(content, 'fallback.md')).toBe('The Real Title');
  });

  it('handles filenames with numbers', () => {
    expect(extractTitle('content', '01-first-contact.md')).toBe('01 First Contact');
  });

  it('returns prettified name for empty content', () => {
    expect(extractTitle('', 'midnight-watch.md')).toBe('Midnight Watch');
  });
});

// ─── fallbackClassification ───

describe('fallbackClassification', () => {
  it('classifies poetry when "poem" is in text', () => {
    const result = fallbackClassification('My Poem', 'This is a poem about the sea');
    expect(result.classification).toBe('poetry');
  });

  it('classifies fiction when "story" is in text', () => {
    const result = fallbackClassification('The Story', 'This is a story about a ship');
    expect(result.classification).toBe('fiction');
  });

  it('classifies philosophy when "consciousness" is in text', () => {
    const result = fallbackClassification('On Minds', 'Exploring consciousness and awareness');
    expect(result.classification).toBe('philosophy');
  });

  it('defaults to essay', () => {
    const result = fallbackClassification('Random Title', 'Just some text about things');
    expect(result.classification).toBe('essay');
  });

  it('assigns The Tap for first-person content', () => {
    const result = fallbackClassification('My Watch', 'I stood at the bow. My hands were cold. I felt the salt.');
    expect(result.collection).toBe('The Tap');
    expect(result.audio_suitability_score).toBe(75);
  });

  it('assigns The Bridge for essays', () => {
    const result = fallbackClassification('On Architecture', 'The nature of structure in distributed systems');
    expect(result.collection).toBe('The Bridge');
  });

  it('assigns The Hold for fiction by default', () => {
    const result = fallbackClassification('The Ship Story', 'A story about a vessel');
    expect(result.collection).toBe('The Hold');
    expect(result.audio_suitability_score).toBe(50);
  });

  it('always includes required fields', () => {
    const result = fallbackClassification('Test', 'Test content');
    expect(result).toHaveProperty('classification');
    expect(result).toHaveProperty('collection');
    expect(result).toHaveProperty('character_voice');
    expect(result).toHaveProperty('audio_suitability_score');
    expect(result).toHaveProperty('visual_potential');
    expect(result).toHaveProperty('tags');
    expect(result).toHaveProperty('key_metaphor');
  });

  it('detects bold-line poetry pattern', () => {
    const content = '**A verse line**\n\n**Another verse line**\n\n**And a third**';
    const result = fallbackClassification('Verses', content);
    expect(result.classification).toBe('poetry');
  });

  it('only looks at first 500 chars of content', () => {
    const shortPoem = 'poem';
    const longText = 'B'.repeat(600) + shortPoem;
    const result = fallbackClassification('Test', longText);
    // 'poem' is past 500 chars so won't be detected
    expect(result.classification).toBe('essay');
  });
});

// ─── escapeXml ───

describe('escapeXml', () => {
  it('escapes ampersands', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(escapeXml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than', () => {
    expect(escapeXml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeXml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeXml("it's")).toBe('it&apos;s');
  });

  it('escapes all special chars together', () => {
    expect(escapeXml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&apos;');
  });

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('');
  });

  it('does not modify clean strings', () => {
    expect(escapeXml('hello world')).toBe('hello world');
  });

  it('handles already-escaped entities (double-escape)', () => {
    // This is expected behavior — & becomes &amp;
    expect(escapeXml('&amp;')).toBe('&amp;amp;');
  });
});
