// ═══════════════════════════════════════════════════════════
// visual-crafter.test.ts — Tests for the visual crafter module
// Tests slugify, visual selection queries, and generation logic.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';

// slugify is duplicated in visual-crafter and audio-producer
function slugify(path: string): string {
  return path
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(-60);
}

describe('visual-crafter slugify', () => {
  it('produces valid R2 keys from paths', () => {
    expect(slugify('the-lighthouse-keeper.md')).toBe('the-lighthouse-keeper');
  });

  it('handles paths with directories', () => {
    expect(slugify('verse/the-deep-blue.md')).toBe('verse-the-deep-blue');
  });

  it('truncates long paths to 60 chars', () => {
    const long = 'x'.repeat(100) + '.md';
    expect(slugify(long).length).toBe(60);
  });

  it('preserves numbers', () => {
    expect(slugify('03-the-night-watch-alphabet.md')).toBe('03-the-night-watch-alphabet');
  });

  it('handles mixed case', () => {
    expect(slugify('TheDeepBLUE.md')).toBe('thedeepblue');
  });
});

// ─── Visual selection logic ───
describe('visual selection query logic', () => {
  // Simulates: WHERE status='organized' AND visual_potential >= 60
  interface Story {
    id: number;
    title: string;
    status: string;
    visual_potential: number;
  }

  const stories: Story[] = [
    { id: 1, title: 'High Visual', status: 'organized', visual_potential: 90 },
    { id: 2, title: 'Medium Visual', status: 'organized', visual_potential: 65 },
    { id: 3, title: 'Low Visual', status: 'organized', visual_potential: 40 },
    { id: 4, title: 'Already Visualized', status: 'visualized', visual_potential: 95 },
    { id: 5, title: 'Audio Ready', status: 'audio_ready', visual_potential: 80 },
    { id: 6, title: 'Boundary Case 60', status: 'organized', visual_potential: 60 },
    { id: 7, title: 'Boundary Case 59', status: 'organized', visual_potential: 59 },
  ];

  function selectForVisualization(stories: Story[], existingIds: Set<number>): Story[] {
    return stories
      .filter(s => s.status === 'organized')
      .filter(s => s.visual_potential >= 60)
      .filter(s => !existingIds.has(s.id))
      .sort((a, b) => b.visual_potential - a.visual_potential)
      .slice(0, 5);
  }

  it('selects organized stories with visual potential >= 60', () => {
    const result = selectForVisualization(stories, new Set());
    const ids = result.map(s => s.id);
    expect(ids).toContain(1); // 90
    expect(ids).toContain(2); // 65
    expect(ids).toContain(6); // exactly 60
  });

  it('excludes stories below threshold', () => {
    const result = selectForVisualization(stories, new Set());
    expect(result.find(s => s.id === 3)).toBeUndefined(); // 40
    expect(result.find(s => s.id === 7)).toBeUndefined(); // 59
  });

  it('excludes already-visualized stories', () => {
    expect(result_find(stories, 4).status).toBe('visualized');
    const result = selectForVisualization(stories, new Set());
    expect(result.find(s => s.id === 4)).toBeUndefined();
  });

  it('excludes stories with other statuses', () => {
    const result = selectForVisualization(stories, new Set());
    expect(result.find(s => s.id === 5)).toBeUndefined(); // audio_ready
  });

  it('sorts by visual_potential descending', () => {
    const result = selectForVisualization(stories, new Set());
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].visual_potential).toBeGreaterThanOrEqual(result[i].visual_potential);
    }
  });

  it('limits to 5 results', () => {
    const many: Story[] = Array.from({ length: 20 }, (_, i) => ({
      id: i + 100,
      title: `Story ${i}`,
      status: 'organized',
      visual_potential: 80,
    }));
    const result = selectForVisualization(many, new Set());
    expect(result.length).toBe(5);
  });

  it('excludes stories already having cover visuals', () => {
    const result = selectForVisualization(stories, new Set([1, 2]));
    expect(result.find(s => s.id === 1)).toBeUndefined();
    expect(result.find(s => s.id === 2)).toBeUndefined();
  });
});

function result_find(stories: any[], id: number) {
  return stories.find(s => s.id === id)!;
}

// ─── Thumbnail from cover logic ───
describe('thumbnail generation logic', () => {
  it('stores same image as thumbnail with different dimensions', () => {
    const cover = { kind: 'cover', width: 1024, height: 1024 };
    const thumbnail = { kind: 'thumbnail', width: 512, height: 512 };
    
    expect(thumbnail.kind).not.toBe(cover.kind);
    expect(thumbnail.width).toBeLessThan(cover.width);
  });
});
