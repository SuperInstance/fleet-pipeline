// ═══════════════════════════════════════════════════════════
// story-organizer.test.ts — Tests for the story organizer module
// Tests title extraction, fallback classification, and the
// logic that turns GitHub commits into D1 stories.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';

// ─── extractTitle logic ───
function extractTitle(content: string, filename: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  const base = filename.split('/').pop()?.replace(/\.md$/, '') || filename;
  return base
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

describe('extractTitle', () => {
  it('extracts title from H1 heading', () => {
    expect(extractTitle('# My Great Story\n\nContent', 'file.md')).toBe('My Great Story');
  });

  it('handles H1 with leading/trailing whitespace in content', () => {
    expect(extractTitle('\n\n# The Lighthouse\n\nBody', 'f.md')).toBe('The Lighthouse');
  });

  it('falls back to filename when no H1', () => {
    expect(extractTitle('Just some content', 'the-fish-story.md')).toBe('The Fish Story');
  });

  it('handles underscores in filename', () => {
    expect(extractTitle('content', 'the_deep_blue.md')).toBe('The Deep Blue');
  });

  it('handles nested path in filename', () => {
    expect(extractTitle('content', 'stories/fiction/my-tale.md')).toBe('My Tale');
  });

  it('handles filename with no extension', () => {
    expect(extractTitle('content', 'the-story')).toBe('The Story');
  });

  it('handles empty content', () => {
    expect(extractTitle('', 'fallback-title.md')).toBe('Fallback Title');
  });

  it('does not pick up H2 or H3 as title', () => {
    const content = '## Not the title\n### Also not\n# THE title';
    expect(extractTitle(content, 'f.md')).toBe('THE title');
  });

  it('handles H1 with special characters', () => {
    expect(extractTitle('# The Ship & The Sea', 'f.md')).toBe('The Ship & The Sea');
  });

  it('handles single-word H1', () => {
    expect(extractTitle('# Fish', 'f.md')).toBe('Fish');
  });

  it('handles filename with numbers', () => {
    expect(extractTitle('no heading', 'the-3-am-watch.md')).toBe('The 3 Am Watch');
  });

  it('handles filename that is just a word', () => {
    expect(extractTitle('content', 'fish.md')).toBe('Fish');
  });
});

// ─── fallbackClassification logic ───
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

describe('fallbackClassification', () => {
  it('classifies as essay by default', () => {
    const result = fallbackClassification('Random Title', 'Some content about things');
    expect(result.classification).toBe('essay');
    expect(result.collection).toBe('The Bridge');
  });

  it('classifies as poetry when "poem" is mentioned', () => {
    const result = fallbackClassification('My Poem', 'This is a poem about the sea');
    expect(result.classification).toBe('poetry');
  });

  it('classifies as poetry when bold lines detected', () => {
    const result = fallbackClassification('Title', '**A verse line**\nMore text');
    expect(result.classification).toBe('poetry');
  });

  it('classifies as fiction when "story" is mentioned', () => {
    const result = fallbackClassification('The Story', 'A story about a fish');
    expect(result.classification).toBe('fiction');
  });

  it('classifies as fiction when "chapter" is mentioned', () => {
    const result = fallbackClassification('Chapter 1', 'The beginning');
    expect(result.classification).toBe('fiction');
  });

  it('classifies as philosophy when "consciousness" is mentioned', () => {
    const result = fallbackClassification('On Consciousness', 'Thinking about thinking');
    expect(result.classification).toBe('philosophy');
    expect(result.collection).toBe('The Bridge');
  });

  it('assigns to The Tap for first-person writing', () => {
    const result = fallbackClassification('My Day', 'I went to the dock and I saw my ship');
    expect(result.collection).toBe('The Tap');
    expect(result.audio_suitability_score).toBe(75);
  });

  it('assigns to The Hold for fiction', () => {
    const result = fallbackClassification('A Story', 'This is a story about a fish');
    expect(result.collection).toBe('The Hold');
    expect(result.audio_suitability_score).toBe(50);
  });

  it('always includes default metaphor', () => {
    const result = fallbackClassification('Title', 'Content');
    expect(result.key_metaphor).toBe('a ship at anchor in calm waters');
  });

  it('always includes visual potential tag', () => {
    const result = fallbackClassification('Title', 'Content');
    expect(result.tags).toContain('visual potential');
  });

  it('checks only first 500 chars of content', () => {
    const long = 'A'.repeat(500) + ' poem about the sea';
    const result = fallbackClassification('Title', long);
    // "poem" is past char 500, should NOT be classified as poetry
    expect(result.classification).not.toBe('poetry');
  });
});
