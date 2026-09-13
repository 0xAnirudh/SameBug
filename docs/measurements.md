# Measurements

Numbers measured on this project, with the conditions that produced them.
Anything quoted in the README or in an interview should appear here first.

Machine: Apple M1, macOS. Node 24. Unless stated otherwise, MongoDB is Atlas
M0 (shared tier) and Redis is local.

---

## bcrypt cost factor

Password hashing is deliberately slow. Cost 12 was chosen as the current
sensible default; the point of measuring is to know what it costs.

| Case                     | Time   |
| ------------------------ | ------ |
| 1 hash @ cost 12         | 372 ms |
| 8 concurrent hashes      | 743 ms |

**Why 8 concurrent is 2× and not 8×:** bcrypt's async API runs on libuv's
threadpool, which defaults to **4 threads**. Eight hashes run as two batches of
four. The implication is that a burst of simultaneous logins occupies the
threadpool and stalls other work that needs it — `fs`, DNS, zlib — even though
the event loop itself is free.

Mitigations if it ever mattered: raise `UV_THREADPOOL_SIZE`, move hashing to a
worker, or rate-limit the login endpoint. The rate limit is the one this
project actually does (phase 6).

---

## Atlas connection

| Case                            | Time   |
| ------------------------------- | ------ |
| Cold `mongoose.connect` + ping   | 515 ms |

Shared-tier latency, measured from a laptop. This is why the load test runs
against a local MongoDB and not Atlas: the free tier is shared and throttled,
so benchmarking it measures someone else's noise.

---

## Index verification

`node --env-file=.env apps/api/scripts/explain.js` seeds 500 pastes, runs
`explain("executionStats")` on all four read queries and asserts every one is
index-only. Full output: [explain-output.txt](explain-output.txt).

All four now report `IXSCAN`, no `COLLSCAN`, no `SORT`, and `keysExamined`
equal to `nReturned`.

### The one that was wrong

"My pastes" was doing an **in-memory sort**:

| | Before | After |
| --- | --- | --- |
| stages | `SORT <- FETCH <- IXSCAN` | `LIMIT <- FETCH <- IXSCAN` |
| keysExamined | 167 | 20 |
| nReturned | 20 | 20 |

The index was `{ authorId: 1, createdAt: -1 }`, but cursor pagination
tie-breaks on `_id` so the query sorts by `{ createdAt: -1, _id: -1 }`. Mongo
could satisfy the first sort field from the index and had to finish the rest in
memory. Extending the key to `{ authorId: 1, createdAt: -1, _id: -1 }` gives a
total order and the SORT stage disappears.

The tell is `keysExamined` well above `nReturned` — the index was being walked
past the rows that were actually wanted.

Note: Atlas is running **MongoDB 8**, which reports `EXPRESS_IXSCAN` for its
single-document fast path rather than `IXSCAN`.

---

## Grouping accuracy

`npm test -- grouping` evaluates all C(22,2) = 231 pairs from the labelled
fixture corpus.

```
pairs 231  TP 11  FP 0  FN 0  TN 220
precision 100.0%  recall 100.0%
```

Verified end to end through the running API as well: posting all 22 fixtures
produced exactly 13 distinct fingerprints for 13 labelled groups, with no group
split across two fingerprints and no two groups merged.

Caveat worth stating out loud: the corpus is synthetic-but-realistic, not
harvested from production traffic. It covers the shapes that break naive
parsers — chained Python tracebacks, ESM `file://` frames, Windows drive
letters, `at async` / `at new X` call sites, crashes with no application frame
at all — but 100% here means "no known failure in this corpus".

---

## Read path

_Phase 6. Table lives in the README._
