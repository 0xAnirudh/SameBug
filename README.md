# samebug

**Paste an error, find out how many other people hit the same bug.**

A snippet and log sharing service whose interesting half is the stack-trace
fingerprinter: it parses a traceback, strips everything that varies between two
occurrences of the same bug, and hashes what's left — so the same error posted
by two different people, from two different machines, with different absolute
paths and shifted line numbers, groups into one.

> Status: **in progress.** See [docs/plan.html](docs/plan.html) for the phase plan.

---

## Running it locally

Needs Node 22+, a MongoDB and a Redis. Docker is optional — MongoDB Atlas and a
`brew install redis` work fine, and the tests need neither.

```bash
cp .env.example .env     # fill in MONGO_URI, REDIS_URL and two JWT secrets
npm install
npm run indexes:sync     # autoIndex is off; indexes are an explicit step
```

Generate the secrets rather than inventing them:

```bash
openssl rand -base64 48
```

Then run the two processes in separate terminals:

```bash
npm run dev
```

```bash
npm run dev:web
```

- Client — <http://localhost:5273> (Vite proxies `/api` to the API, so the
  browser sees one origin and the refresh cookie behaves as it will in production)
- API — <http://localhost:4100>

**In VS Code**, `.vscode/launch.json` ships a compound config: pick
**Full stack (API + Web)** from the Run and Debug panel and both start with
breakpoints attached.

If you prefer containers for the databases:

```bash
npm run infra:up
```

### Tests

No Docker and no running database — `mongodb-memory-server` starts a real
MongoDB in-process. A local Redis is needed for the Redis suite only.

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

Read path under a skewed (80/20) access distribution against 8,000 seeded
pastes (39 MB, avg 5 KB/doc). Two runs of the **same script on the same
machine against the same data**; the only variable is `CACHE_ENABLED`.
Warm-up is excluded from the reported metrics by the script itself.

| Metric | No cache | With Redis | Change |
| --- | --- | --- | --- |
| p50 | 33.4 ms | 16.3 ms | **−51%** |
| p95 | 93.1 ms | 39.7 ms | **−57%** |
| p99 | 220.5 ms | 62.8 ms | **−72%** |
| req/sec | 2,438 | 5,214 | **+114%** |
| error rate | 0.00% | 0.00% | — |
| cache hit rate | n/a | 99.96% | — |
| Mongo queries/sec | 2,869 | 43.8 | **−98.5%** |
| Mongo queries total | 519,922 | 8,006 | — |

8,006 queries is one per distinct slug — every paste was read from Mongo
exactly once and served from Redis after that.

### Buffered view counters, measured separately

A Mongo write on every page view puts the write path on the hot read path.
This is its own experiment: cache on in both runs, only `VIEW_BUFFER_ENABLED`
changes.

| Metric | Write per view | Buffered in Redis | Change |
| --- | --- | --- | --- |
| p50 | 21.9 ms | 18.8 ms | −14% |
| p95 | 52.5 ms | 38.8 ms | −26% |
| p99 | 98.0 ms | 57.4 ms | **−41%** |
| req/sec | 3,584 | 4,873 | **+36%** |
| Mongo writes/sec | 3,712 | 16.5 | **−99.6%** |
| Mongo writes total | 674,560 | 3,000 | — |

Two experiments rather than one, because "we added Redis and it got faster"
does not say which part did the work.

### Why every dependency is here

- **Read cache** — paste reads were 220 ms at p99 against Mongo; 63 ms cached,
  at a 99.96% hit rate on this dataset.
- **Buffered counters** — a write per view is 3,712 Mongo writes/sec at 3,600
  req/s; buffering makes it 16.5.
- **Trending sorted set** — `ZINCRBY`/`ZREVRANGE` is O(log N) write and
  O(log N + M) read; from Mongo it is an aggregation with a sort over a
  collection that only grows.
- **Rate limiter** — anonymous creation is an open write endpoint, and the
  check-and-increment has to be atomic, which is why it is a Lua script.

Raw k6 output for every run: [`bench/results/`](bench/results/).

### Where it breaks

Clean through 500 concurrent users at 0% errors; it starts shedding requests
between 500 and 1000. The API logs **zero** application errors throughout, so
the failures are at the connection layer — most likely the OS accept queue,
which is 128 on this machine. Full analysis, including the caveat that the load
generator shared the laptop with everything it was measuring, is in
[docs/failure-modes.md](docs/failure-modes.md).

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
