# Fleet Pipeline

> *The endless radio — a Cloudflare Workers pipeline that runs on the pulse.*

## What Is This?

Fleet Pipeline is the production pipeline behind the LucidDreamer podcast system. It runs entirely on Cloudflare Workers, using cron triggers and KV storage. No servers, no databases, no infrastructure — just workers and the pulse.

## Architecture

```
Cron Trigger (every 3 min)
    │
    ▼
┌─────────────────────────────────┐
│         Fleet Pipeline          │
│         (this worker)           │
├─────────────────────────────────┤
│  Quota Manager   — rate limiting│
│  Story Organizer — curate AI    │
│  Visual Crafter  — cover art    │
│  Audio Producer  — TTS segments │
│  Podcast Assembler— RSS feed    │
└─────────────────────────────────┘
    │
    ▼
  Cloudflare KV (PULSE namespace)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` or `/health` | Health check + quota status |
| GET | `/api/pulse` | Current pipeline pulse |
| POST | `/api/burst` | Trigger a burst run |
| GET | `/api/quota-history` | Quota usage over time |
| GET | `/api/visuals` | Generated cover art |
| GET | `/api/visuals/:storyId` | Specific story's visuals |
| GET | `/api/audio` | Generated audio segments |
| GET | `/api/audio/:storyId` | Specific story's audio |
| GET | `/api/episodes` | Assembled podcast episodes |
| GET | `/api/feed` | RSS podcast feed |

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy

# Initialize KV namespace
npm run init-db
```

## Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point — routes cron and HTTP |
| `src/quota-manager.ts` | Rate limiting via KV counters |
| `src/story-organizer.ts` | Curates AI writings into episodes |
| `src/visual-crafter.ts` | Generates cover art for stories |
| `src/audio-producer.ts` | TTS audio production |
| `src/podcast-assembler.ts` | Combines audio + visuals into RSS |
| `src/utils.ts` | Shared utilities, Env type, KV helpers |

## License

MIT
