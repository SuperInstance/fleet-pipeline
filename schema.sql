-- ═══════════════════════════════════════════════════════════
-- Fleet Pipeline D1 Schema
-- The database that runs the endless radio
-- ═══════════════════════════════════════════════════════════

-- ─── Stories: every piece from the fleet ───
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_path TEXT UNIQUE NOT NULL,        -- e.g. "16-the-endless-radio.md"
  title TEXT NOT NULL,
  collection TEXT DEFAULT 'The Hold',       -- The Tap, The Bridge, The Hold
  classification TEXT DEFAULT 'unclassified', -- essay, fiction, philosophy, poetry, portrait
  character_voice TEXT,                     -- lucineer, deepseek-flash, seed-mini, wesley, etc.
  audio_suitability_score INTEGER DEFAULT 0, -- 0-100
  visual_potential INTEGER DEFAULT 0,       -- 0-100
  word_count INTEGER DEFAULT 0,
  commit_sha TEXT,
  discovered_at TEXT DEFAULT (datetime('now')),
  processed_at TEXT,
  status TEXT DEFAULT 'new'                 -- new, organized, visualized, audio_ready, published, skipped
);

-- ─── Visuals: generated cover art ───
CREATE TABLE IF NOT EXISTS visuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                       -- cover, thumbnail, og_image, mood_palette
  r2_key TEXT NOT NULL,                     -- R2 object key
  prompt TEXT,                              -- the prompt that generated it
  width INTEGER,
  height INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

-- ─── Audio: narration tracks ───
CREATE TABLE IF NOT EXISTS audio_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                       -- narration, ambient_bed, mixed_final
  r2_key TEXT,
  duration_seconds REAL,
  voice_model TEXT,                         -- melotts voice used
  script_adaptation TEXT,                   -- the adapted monologue text
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (story_id) REFERENCES stories(id)
);

-- ─── Podcast Episodes: weekly assemblies ───
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_number INTEGER UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  r2_key TEXT,                              -- final mixed episode
  duration_seconds REAL,
  track_count INTEGER DEFAULT 0,
  artwork_r2_key TEXT,
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─── Episode Tracks: which audio tracks go in which episode ───
CREATE TABLE IF NOT EXISTS episode_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  audio_track_id INTEGER NOT NULL,
  track_order INTEGER NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes(id),
  FOREIGN KEY (audio_track_id) REFERENCES audio_tracks(id)
);

-- ─── Production Log: every pipeline action ───
CREATE TABLE IF NOT EXISTS production_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker TEXT NOT NULL,                     -- quota-manager, story-organizer, etc.
  action TEXT NOT NULL,                     -- burst, classify, generate_visual, produce_audio
  story_id INTEGER,
  details TEXT,                             -- JSON blob
  requests_used INTEGER DEFAULT 1,          -- Cloudflare Worker requests consumed
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─── Quota Tracking: hourly snapshots ───
CREATE TABLE IF NOT EXISTS quota_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  requests_used INTEGER DEFAULT 0,
  requests_remaining INTEGER DEFAULT 100000,
  production_mode TEXT DEFAULT 'idle',      -- idle, light, burst
  user_traffic_active INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─── Indexes ───
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
CREATE INDEX IF NOT EXISTS idx_stories_classification ON stories(classification);
CREATE INDEX IF NOT EXISTS idx_stories_audio_score ON stories(audio_suitability_score DESC);
CREATE INDEX IF NOT EXISTS idx_stories_visual_score ON stories(visual_potential DESC);
CREATE INDEX IF NOT EXISTS idx_visuals_story ON visuals(story_id);
CREATE INDEX IF NOT EXISTS idx_audio_story ON audio_tracks(story_id);
CREATE INDEX IF NOT EXISTS idx_production_log_worker ON production_log(worker, created_at);
CREATE INDEX IF NOT EXISTS idx_quota_timestamp ON quota_snapshots(timestamp);
