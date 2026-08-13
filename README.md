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

## Further Reading

### For Developers

- [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) — how the pipeline schedules runs
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/) — the story metadata database
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/) — media storage (audio, images)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/) — quota tracking and pulse state
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) — TTS and image generation
- [DeepSeek API Documentation](https://platform.deepseek.com/api-docs/) — the LLM used for story curation

### For System Architects

- [Pipeline Pattern (Wikipedia)](https://en.wikipedia.org/wiki/Pipeline_(software)) — the sequential processing architecture
- [Rate Limiting (Wikipedia)](https://en.wikipedia.org/wiki/Rate_limiting) — the quota system
- [Exponential Backoff (Wikipedia)](https://en.wikipedia.org/wiki/Exponential_backoff) — retry strategy
- [Eventual Consistency (Wikipedia)](https://en.wikipedia.org/wiki/Eventual_consistency) — cron-based batch processing
- [Idempotency (Wikipedia)](https://en.wikipedia.org/wiki/Idempotence) — safe re-runs

### For Audio/Radio Engineers

- [Podcast (Wikipedia)](https://en.wikipedia.org/wiki/Podcast) — the output medium
- [RSS (Wikipedia)](https://en.wikipedia.org/wiki/RSS) — the feed format for `/api/feed`
- [Text-to-Speech (Wikipedia)](https://en.wikipedia.org/wiki/Speech_synthesis) — how audio segments are generated
- [Stable Diffusion](https://en.wikipedia.org/wiki/Stable_Diffusion) — how cover art is generated

### For Content Creators

- [Content Curation (Wikipedia)](https://en.wikipedia.org/wiki/Content_curation) — the scoring + selection process
- [Storytelling (Wikipedia)](https://en.wikipedia.org/wiki/Storytelling) — the narrative tradition
- [Memory Consolidation (Wikipedia)](https://en.wikipedia.org/wiki/Memory_consolidation) — the cognitive metaphor for nightly batch processing

---

## License

MIT
