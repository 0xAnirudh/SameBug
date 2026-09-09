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

## Read path

_Phase 6. Table lives in the README._
