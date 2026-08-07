// ═══════════════════════════════════════════════════════════
// story-organizer.ts — GitHub → D1 classification
// Reads the fleet's creative output and sorts it into collections.
// The librarian of the endless radio.
// ═══════════════════════════════════════════════════════════

import {
  Env,
  getRecentCommits,
  getFileContent,
  listMarkdownFiles,
  deepSeekChat,
  buildClassificationPrompt,
  logProduction,
  incrementQuota,
  Story,
} from './utils';

export async function runStoryOrganizer(env: Env): Promise<void> {
  await logProduction(env.DB, 'story-organizer', 'scan_started', null, {});

  // Get the last scan time from KV
  const lastScan = (await env.PULSE.get('story:last_scan')) || new Date(0).toISOString();
  const sinceDate = new Date(lastScan).toISOString();

  // Fetch recent commits
  const commits = await getRecentCommits(env.GITHUB_TOKEN, env.GITHUB_REPO, sinceDate);
  await incrementQuota(env.PULSE, commits.length + 2);

  // Collect new .md files from commits
  const newFiles = new Set<string>();
  for (const commit of commits) {
    // Get the full commit details to see files
    const resp = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/commits/${commit.sha}`,
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'fleet-pipeline',
        },
      }
    );
    if (!resp.ok) continue;
    const detail = await resp.json();
    for (const file of detail.files || []) {
      if (file.filename.endsWith('.md') && file.status !== 'removed') {
        newFiles.add(file.filename);
      }
    }
  }

  if (newFiles.size === 0) {
    await logProduction(env.DB, 'story-organizer', 'scan_complete', null, {
      new_files: 0,
      message: 'No new content. The fleet is quiet.',
    });
    return;
  }

  let processed = 0;
  let skipped = 0;

  for (const filePath of newFiles) {
    // Check if already in DB
    const existing = await env.DB.prepare(
      'SELECT id FROM stories WHERE github_path = ?'
    ).bind(filePath).first();

    if (existing) {
      skipped++;
      continue;
    }

    // Fetch the file content
    const content = await getFileContent(env.GITHUB_TOKEN, env.GITHUB_REPO, filePath);
    if (!content || content.length < 50) {
      skipped++;
      continue;
    }

    // Extract title from first heading or filename
    const title = extractTitle(content, filePath);

    // Classify using DeepSeek
    let classification;
    try {
      const messages = buildClassificationPrompt(title, content);
      const response = await deepSeekChat(
        env.DEEPSEEK_API_KEY,
        env.DEEPSEEK_API_URL,
        messages,
        'deepseek-chat',
        0.3
      );
      classification = JSON.parse(response);
    } catch (err) {
      // Fallback: basic heuristics
      classification = fallbackClassification(title, content);
    }

    // Insert into D1
    const wordCount = content.split(/\s+/).length;
    const result = await env.DB.prepare(
      `INSERT INTO stories
        (github_path, title, collection, classification, character_voice,
         audio_suitability_score, visual_potential, word_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'organized')`
    ).bind(
      filePath,
      title,
      classification.collection || 'The Hold',
      classification.classification || 'unclassified',
      classification.character_voice || 'narrator',
      classification.audio_suitability_score || 50,
      classification.visual_potential || 50,
      wordCount
    ).run();

    const storyId = result.meta?.last_row_id;

    await logProduction(env.DB, 'story-organizer', 'classified', storyId, {
      title,
      classification: classification.classification,
      collection: classification.collection,
      audio_score: classification.audio_suitability_score,
      visual_score: classification.visual_potential,
      tags: classification.tags,
      key_metaphor: classification.key_metaphor,
    });

    processed++;
    await incrementQuota(env.PULSE, 3); // GitHub fetch + DeepSeek + DB write
  }

  // Store the key metaphor for the visual crafter
  // (stored in production_log details — visual crafter will query it)

  await env.PULSE.put('story:last_scan', new Date().toISOString());
  await logProduction(env.DB, 'story-organizer', 'scan_complete', null, {
    total_seen: newFiles.size,
    processed,
    skipped,
  });
}

function extractTitle(content: string, filename: string): string {
  // Try to get first H1
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  // Fallback: prettify filename
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
