// ═══════════════════════════════════════════════════════════
// podcast-assembler.test.ts — Tests for the podcast assembler
// Tests escapeXml, slugify, RSS feed generation logic.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';

// ─── escapeXml ───
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

describe('escapeXml', () => {
  it('escapes ampersands', () => {
    expect(escapeXml('fish & chips')).toBe('fish &amp; chips');
  });

  it('escapes angle brackets', () => {
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeXml('"hello"')).toBe('&quot;hello&quot;');
    expect(escapeXml("it's")).toBe("it&apos;s");
  });

  it('escapes all special chars together', () => {
    expect(escapeXml('<a href="x">&\'test\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&apos;test&apos;&lt;/a&gt;'
    );
  });

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('');
  });

  it('handles string with no special chars', () => {
    expect(escapeXml('plain text')).toBe('plain text');
  });

  it('handles multiple ampersands', () => {
    expect(escapeXml('a & b & c')).toBe('a &amp; b &amp; c');
  });

  it('handles already-escaped entities (double-escape)', () => {
    // The function always escapes, so &amp; becomes &amp;amp;
    expect(escapeXml('&amp;')).toBe('&amp;amp;');
  });
});

// ─── slugify (shared between visual-crafter and audio-producer) ───
function slugify(path: string): string {
  return path
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(-60);
}

describe('slugify', () => {
  it('removes .md extension', () => {
    expect(slugify('story.md')).toBe('story');
  });

  it('lowercases letters', () => {
    // regex strips .md (case-insensitive on the whole string, but .md$ is case-sensitive)
    // .replace(/\.md$/, '') only matches lowercase .md at end
    expect(slugify('MyStory.md')).toBe('mystory');
  });

  it('replaces non-alphanumeric with dashes', () => {
    expect(slugify('the fish story.md')).toBe('the-fish-story');
  });

  it('collapses multiple dashes', () => {
    expect(slugify('a---b.md')).toBe('a-b');
    expect(slugify('a   b.md')).toBe('a-b');
  });

  it('truncates to 60 chars from the end', () => {
    const long = 'a'.repeat(100) + '.md';
    const result = slugify(long);
    expect(result.length).toBe(60);
  });

  it('handles paths with directories', () => {
    expect(slugify('stories/fiction/tale.md')).toBe('stories-fiction-tale');
  });

  it('handles underscores as dashes', () => {
    expect(slugify('the_deep.md')).toBe('the-deep');
  });

  it('handles special characters', () => {
    expect(slugify('the @#$ story.md')).toBe('the-story');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('handles just .md', () => {
    expect(slugify('.md')).toBe('');
  });

  it('handles numbers', () => {
    expect(slugify('story-123.md')).toBe('story-123');
  });
});

// ─── RSS feed structure ───
describe('RSS feed generation logic', () => {
  it('builds valid RSS structure', () => {
    const episodes = [
      { title: 'Ep 1', description: 'First', episode_number: 1, created_at: '2026-01-01T00:00:00Z' },
    ];

    const items = episodes.map((ep: any) => `
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
    expect(xml).toContain('fleet-podcast-1');
    expect(xml).toContain('</rss>');
  });

  it('handles multiple episodes', () => {
    const episodes = [
      { title: 'A', description: 'Desc A', episode_number: 3, created_at: '2026-01-03T00:00:00Z' },
      { title: 'B', description: 'Desc B', episode_number: 2, created_at: '2026-01-02T00:00:00Z' },
      { title: 'C', description: 'Desc C', episode_number: 1, created_at: '2026-01-01T00:00:00Z' },
    ];

    const items = episodes.map((ep: any) => `<item><title>${escapeXml(ep.title)}</title></item>`).join('\n');

    const count = (items.match(/<item>/g) || []).length;
    expect(count).toBe(3);
  });

  it('handles empty episode list', () => {
    const items = [].map(() => '<item></item>').join('\n');
    expect(items).toBe('');
  });

  it('escapes titles in RSS', () => {
    const title = 'The Fish & The Sea';
    const escaped = escapeXml(title);
    expect(escaped).toBe('The Fish &amp; The Sea');
    expect(escaped).not.toContain('& The');
  });
});
