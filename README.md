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

## How grouping works

Two people hit the same bug. Their traces differ in line numbers, absolute
paths, timestamps and object ids, so a naive hash groups nothing at all.

1. **Detect the runtime** — Node and Python are scored against each other; a tie
   or no evidence returns null and the paste is stored as a plain log.
2. **Parse into frames** — `{ file, line, col, function }`.
3. **Normalize the message** — eleven ordered substitutions strip timestamps,
   UUIDs, object ids, addresses, URLs, IPs, emails, paths, quoted literals,
   long digests and finally bare numbers. Order is the design: if the number
   rule ran first it would shred UUIDs before anything could recognise them.
4. **Keep only application frames** — library frames differ between users;
   application frames identify the bug. A `TypeError` thrown inside Express
   tells you nothing.
5. **Hash** `errorType | normalizedMessage | top 3 app frames as basename:function`,
   sha1, first 16 hex characters.

Deliberately **not** in the hash: line numbers (an unrelated edit shifts them),
absolute paths (they differ per machine), columns, timestamps.

```
Cannot read property 'userId' of undefined at index 42
  -> cannot read property <str> of undefined at index <num>
```

### Measured

| | |
| --- | --- |
| Corpus | 22 labelled traces, 13 groups |
| Pairs evaluated | 231 |
| Precision | 100% |
| Recall | 100% |

Every pair is one prediction — do these two group or not — rather than scoring
each trace on its own. Precision and recall are reported separately because the
errors are not equally bad: **a false positive merges two genuinely different
bugs and hides one of them**, while a false negative only shows a duplicate.

> The corpus is hand-written to reproduce shapes seen in the wild (chained
> Python exceptions, ESM `file://` frames, Windows paths, all-vendor crashes),
> not harvested from production. Treat 100% as "no known failure in this
> corpus", not as a general accuracy claim.

### Known limitations

Both are asserted in [`tests/unit/limitations.test.js`](apps/api/tests/unit/limitations.test.js)
so they stay true statements rather than remembered ones.

- **Over-merging.** Two different bugs in the same function whose messages
  differ only inside a quoted literal collide. This is the price of stripping
  literals — without it, every distinct user id would form its own group.
- **Over-splitting.** The hash covers the top three application frames, so the
  same failing line reached from a different caller forms a second group. That
  separates "fails during checkout" from "fails during the nightly import", at
  the cost of splitting one root cause.

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
