// ═══════════════════════════════════════════════════════════
// utils.ts — Shared helpers for the fleet pipeline
// ═══════════════════════════════════════════════════════════

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  AI: Ai;
  PULSE: KVNamespace;
  GITHUB_TOKEN: string;
  DEEPSEEK_API_KEY: string;
  GITHUB_REPO: string;
  DEEPSEEK_API_URL: string;
  WIKI_BASE_URL: string;
}

export interface Story {
  id?: number;
  github_path: string;
  title: string;
  collection: string;
  classification: string;
  character_voice: string;
  audio_suitability_score: number;
  visual_potential: number;
  word_count: number;
  commit_sha?: string;
  status: string;
}

// ─── Quota helpers ───

const DAILY_REQUEST_LIMIT = 100_000;

export async function getQuotaUsage(kv: KVNamespace): Promise<{
  used: number;
  remaining: number;
  available: number; // 0.0 - 1.0
}> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `requests:${today}`;
  const raw = await kv.get(key);
  const used = raw ? parseInt(raw, 10) : 0;
  const remaining = Math.max(0, DAILY_REQUEST_LIMIT - used);
  return { used, remaining, available: remaining / DAILY_REQUEST_LIMIT };
}

export async function incrementQuota(kv: KVNamespace, count: number = 1): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `requests:${today}`;
  const raw = await kv.get(key);
  const current = raw ? parseInt(raw, 10) : 0;
  // TTL: expire at next midnight UTC + 1 hour buffer
  const now = new Date();
  const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 1));
  const ttl = Math.floor((nextReset.getTime() - now.getTime()) / 1000);
  await kv.put(key, String(current + count), { expirationTtl: ttl });
}

// ─── Production mode logic ───

export type ProductionMode = 'idle' | 'light' | 'burst';

export function decideProductionMode(
  quotaAvailable: number,
  hourUTC: number,
  userTrafficActive: boolean
): ProductionMode {
  const nearReset = hourUTC >= 22 || hourUTC <= 1;

  if (userTrafficActive) {
    // Users come first — pause production
    return 'idle';
  }

  if (quotaAvailable > 0.7 && nearReset) {
    return 'burst';
  }

  if (quotaAvailable > 0.5) {
    return 'light';
  }

  return 'idle';
}

// ─── GitHub API ───

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { date: string };
  };
  files?: { filename: string; status: string }[];
}

export async function fetchGitHub(
  path: string,
  token: string,
  repo: string
): Promise<Response> {
  return fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'fleet-pipeline',
    },
  });
}

export async function getRecentCommits(
  token: string,
  repo: string,
  since: string
): Promise<GitHubCommit[]> {
  const resp = await fetchGitHub(
    `commits?since=${since}&per_page=50`,
    token,
    repo
  );
  if (!resp.ok) return [];
  return resp.json();
}

export async function getFileContent(
  token: string,
  repo: string,
  path: string,
  ref?: string
): Promise<string | null> {
  const refParam = ref ? `?ref=${ref}` : '';
  const resp = await fetchGitHub(`contents/${path}${refParam}`, token, repo);
  if (!resp.ok) return null;
  const data = await resp.json();
  if (data.encoding === 'base64') {
    return atob(data.content);
  }
  return data.content || null;
}

export async function listMarkdownFiles(
  token: string,
  repo: string
): Promise<{ name: string; path: string }[]> {
  const resp = await fetchGitHub('contents/', token, repo);
  if (!resp.ok) return [];
  const items = await resp.json();
  return items
    .filter((item: any) => item.name.endsWith('.md') && item.type === 'file')
    .map((item: any) => ({ name: item.name, path: item.path }));
}

// ─── DeepSeek API ───

export async function deepSeekChat(
  apiKey: string,
  apiUrl: string,
  messages: { role: string; content: string }[],
  model: string = 'deepseek-chat',
  temperature: number = 0.7
): Promise<string> {
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DeepSeek API error ${resp.status}: ${text}`);
  }

  const data: any = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── R2 helpers ───

export function r2Key(prefix: string, slug: string, ext: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}/${date}/${slug}.${ext}`;
}

// ─── Classification prompt ───

export function buildClassificationPrompt(title: string, content: string): { role: string; content: string }[] {
  const excerpt = content.slice(0, 2000);
  return [
    {
      role: 'system',
      content: `You are a literary editor for a creative fleet's publishing pipeline. Classify creative writing pieces. Respond ONLY with a JSON object — no markdown, no explanation.

Fields:
- "classification": one of "essay", "fiction", "philosophy", "poetry", "portrait", "technical", "journal"
- "collection": one of "The Tap" (monologues, first-person, spoken-word ready), "The Bridge" (essays, philosophy, connecting ideas), "The Hold" (fiction, stories, narrative)
- "character_voice": the primary voice — "lucineer", "deepseek-flash", "seed-mini", "wesley", "ralph", "kimi", "narrator"
- "audio_suitability_score": 0-100 (how well this works as spoken audio)
- "visual_potential": 0-100 (how well this could be illustrated)
- "tags": array of strings from: "great for Tap monologue", "needs full cast", "visual potential", "skip"
- "key_metaphor": a single vivid image for visual generation

Score audio high for: first-person, conversational, emotional, clear narrative arc.
Score visual high for: vivid imagery, strong central metaphor, scenes that could be painted.`,
    },
    {
      role: 'user',
      content: `Title: ${title}\n\nContent:\n${excerpt}`,
    },
  ];
}

// ─── Audio adaptation prompt ───

export function buildAudioAdaptationPrompt(title: string, content: string, voice: string): { role: string; content: string }[] {
  return [
    {
      role: 'system',
      content: `You are adapting a creative piece into a spoken monologue for "The Tap" — a daily radio segment. The voice is ${voice}.

Rules:
- First person, intimate, like someone speaking at a bar on a ship
- 400-600 words when spoken (about 3-4 minutes)
- Keep the core ideas but make them conversational
- Maritime metaphors welcome but don't force them
- Start with a hook — don't explain what you're about to say, just say it
- End with something that lingers
- No stage directions, no "[pause]", no narration cues — just the words to be spoken

Return ONLY the monologue text. No title, no preamble.`,
    },
    {
      role: 'user',
      content: `Adapt this piece for spoken audio:\n\nTitle: ${title}\n\n${content.slice(0, 4000)}`,
    },
  ];
}

// ─── Visual prompt builder ───

export function buildVisualPrompt(metaphor: string, title: string): string {
  return `Literary cover art: ${metaphor}. Title: "${title}". Moody, atmospheric, painterly style. Dark maritime aesthetic with warm accent lighting. No text in the image. High detail, cinematic composition.`;
}

// ─── Logging ───

export async function logProduction(
  db: D1Database,
  worker: string,
  action: string,
  storyId: number | null,
  details: Record<string, unknown>,
  requestsUsed: number = 1
): Promise<void> {
  await db.prepare(
    'INSERT INTO production_log (worker, action, story_id, details, requests_used) VALUES (?, ?, ?, ?, ?)'
  ).bind(worker, action, storyId, JSON.stringify(details), requestsUsed).run();
}

// ─── JSON response helper ───

export function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
