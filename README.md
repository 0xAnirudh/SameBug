# samebug

**Paste an error, find out how many other people hit the same bug.**

A snippet and log sharing service whose interesting half is the stack-trace
fingerprinter: it parses a traceback, strips everything that varies between two
occurrences of the same bug, and hashes what's left — so the same error posted
by two different people, from two different machines, with different absolute
paths and shifted line numbers, groups into one.

> Status: **in progress.** See [docs/plan.html](docs/plan.html) for the phase plan.

---

## Quickstart

```bash
cp .env.example .env     # then fill in MONGO_URI, REDIS_URL and two JWT secrets
npm install
npm run infra:up         # mongo + redis via docker (skip if you use Atlas / local redis)
npm run dev
curl localhost:4100/health
```

Tests need neither Docker nor a running database — `mongodb-memory-server`
spins up a real MongoDB in-process:

```bash
npm test
```

## Architecture

```
React (Vite)
     |
     v
Express API  <-->  Redis   (cache, view counters, rate limit, trending ZSET)
     |
     v
MongoDB      (pastes, users, fingerprints)
```

One Express process. Redis is a cache and never the source of truth — every
read path falls through to Mongo when it is unavailable, and `/health` reports
`degraded` rather than failing.

## Benchmark

Measured on the read path under a skewed (80/20) access distribution against a
seeded dataset. Both runs use the same binary on the same machine against the
same data; the only variable is `CACHE_ENABLED`.

| Metric         | No cache | With Redis |
| -------------- | -------- | ---------- |
| p50            |          |            |
| p95            |          |            |
| p99            |          |            |
| req/sec        |          |            |
| error rate     |          |            |
| cache hit rate | n/a      |            |
| Mongo ops/sec  |          |            |

_Test config: TBD — machine, dataset size, VUs, duration._
Raw k6 output: [`bench/results/`](bench/results/).

## Layout

```
apps/api      Express service — routes, services, and the fingerprint engine
apps/web      React client (phase 4)
bench         seed script and k6 load tests
docs          plan, architecture notes, benchmark methodology
```

The fingerprint engine lives in `apps/api/src/fingerprint/` and is pure — no
database, no network, no Express. That is what makes it testable against
fixtures.

## Scripts

| Command              | Does                                     |
| -------------------- | ---------------------------------------- |
| `npm run dev`        | API with `--watch`                       |
| `npm test`           | Unit + integration suites                |
| `npm run lint`       | ESLint across the workspace              |
| `npm run infra:up`   | Start Mongo and Redis in Docker          |
| `npm run infra:down` | Stop them                                |
