# Where this breaks

Knowing the limits is the point of this document. "It handles everything fine"
is not an answer anyone believes.

Measured on an Apple M1 MacBook Air (8 cores, 16 GB), with k6, the API, mongod
and Redis all running on that same machine. See [measurements.md](measurements.md)
for the full run configuration.

---

## The ceiling

`bench/ramp.js` walks the load up and records each steady level separately.

| Concurrent VUs | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- |
| 200 | 76 ms | 184 ms | 411 ms | **0.00%** |
| 500 | 165 ms | 317 ms | 559 ms | **0.00%** |
| 1000 | 328 ms | 835 ms | 2.12 s | 1.36% |
| 2000 | 247 ms | 712 ms | 1.45 s | 4.30% |
| 3000 | 294 ms | 686 ms | 925 ms | 6.42% |

**It is clean through 500 concurrent users and starts shedding requests between
500 and 1000.**

Note the latency at 2000 and 3000 is *lower* than at 1000. That is not an
improvement — it is the signature of requests being dropped rather than queued.
The ones that get served are fast because the rest never got in.

## What actually gives first

The API logged **zero** application-level errors across the entire ramp. Nothing
threw. The failures are at the connection layer, before a request ever reaches a
route handler.

The prime suspect is the OS accept queue:

```
$ sysctl -n kern.ipc.somaxconn
128
```

The listen backlog is 128 connections. Once more than that are waiting to be
accepted, the kernel drops them — which a client sees as a refused connection or
a timeout, and which the application never hears about. The observed onset
between 500 and 1000 VUs is consistent with that.

Fixes, in the order I would try them:

1. Raise the backlog (`kern.ipc.somaxconn`, and the `backlog` argument to
   `listen()`). Cheapest, and it moves the wall rather than removing it.
2. Run more than one process. A single Node process is a single core, and this
   box has eight. `cluster` or a process manager in front would multiply
   headroom roughly linearly until something else binds — but see the flusher
   caveat below.
3. Put a real reverse proxy in front to own connection handling and keep-alive,
   so Node only sees accepted requests.

## The honest methodological caveat

k6, the API, mongod and Redis all shared one laptop. Above roughly 1000 VUs the
load generator is itself a heavy CPU consumer and competes with the system it is
measuring. **This ceiling is a property of the whole machine, not of the API in
isolation.** A number from a separate load-generator host would be higher, and I
would not quote this as the application's limit without that separation.

The numbers up to 500 VUs are the trustworthy ones.

## Known structural limits

### The view flusher is a singleton

`jobs/flushViews.js` runs on an interval inside the API process. Run two
instances and both drain the same dirty set. `SPOP` means they would not
double-count, but they would contend, and neither is the obvious owner.

Horizontal scaling therefore needs one of: a leader election, a lock with a
lease, or moving the flusher out into its own single-instance worker. The third
is the one I would pick — it is the least clever.

**This is the single thing that stops the API from being trivially horizontally
scalable**, since everything else in it is stateless.

### Buffered views are lossy on a hard kill

A `SIGTERM` drains the buffer on the way out. A `SIGKILL`, an OOM, or a power
loss drops whatever had not been flushed — up to `VIEW_FLUSH_INTERVAL_MS` worth
of view counts. That is an accepted trade for a view counter and it would not be
for anything that mattered.

### Rate limit memory scales with traffic on the write path

The sliding-window log holds one sorted-set member per request in the window.
At 10 creates/hour that is trivial. It is the reason reads use the fixed-window
counter instead, which is constant memory per key.

### The cache hit rate in the benchmark is optimistic

The benchmark reports 99.96%, but the entire 8000-paste working set fits in
Redis and the run is long enough to warm all of it. A production corpus larger
than the cache, with real TTL expiry and writes invalidating keys, would sit
well below that. **Do not quote 99.96% as a general figure** — quote it as what
this dataset produced under this access pattern.

### Fingerprinting runs inline on create

A pathological paste — a megabyte of near-trace text — is parsed on the request
thread. It is bounded by the 1 MB cap and the parser is linear in line count, so
this has not been a problem, but under write-heavy load the right move is to
push parsing onto a queue and return the slug before it finishes.
