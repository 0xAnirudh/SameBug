import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

/**
 * Read-path load test.
 *
 * Run it twice with the identical script, dataset and machine, changing only
 * CACHE_ENABLED on the server:
 *
 *   k6 run -e BASE=http://localhost:4100 --summary-export=bench/results/no-cache.json bench/read.js
 *   k6 run -e BASE=http://localhost:4100 --summary-export=bench/results/with-redis.json bench/read.js
 */

export const options = {
  stages: [
    { duration: '30s', target: 50 }, // warm-up — excluded from the metrics below
    { duration: '2m', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'measured_duration': ['p(99)<500'],
    'measured_failed': ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const WARMUP_MS = 30_000;

/**
 * The default http_req_duration covers the warm-up too, where the JIT, the
 * connection pool and the OS page cache are all still settling. These metrics
 * only start recording once that window has passed, so the reported p99 is of
 * a steady-state system.
 */
const measured = new Trend('measured_duration', true);
const measuredFailed = new Rate('measured_failed');
const cacheHit = new Rate('cache_hit_rate');
const measuredReqs = new Counter('measured_requests');

const SLUGS = JSON.parse(open('./slugs.json'));
const HOT_POOL = Math.floor(SLUGS.length * 0.2);

/**
 * Zipfian-ish: 80% of traffic hits 20% of the pastes.
 *
 * Real traffic is skewed — a link gets shared and reopened. Uniform random
 * access would make caching look far worse than it is, and is the first thing
 * an interviewer who knows load testing will ask about.
 */
function pickSlug() {
  const hot = Math.random() < 0.8;
  const pool = hot ? HOT_POOL : SLUGS.length;
  return SLUGS[Math.floor(Math.random() * pool)];
}

export function setup() {
  const res = http.get(`${__ENV.BASE}/health`);
  if (res.status !== 200) throw new Error(`API not healthy: ${res.status}`);

  return { startedAt: Date.now() };
}

export default function (data) {
  const res = http.get(`${__ENV.BASE}/api/pastes/${pickSlug()}`);

  check(res, { 'status 200': (r) => r.status === 200 });

  if (Date.now() - data.startedAt < WARMUP_MS) return;

  measured.add(res.timings.duration);
  measuredFailed.add(res.status !== 200);
  measuredReqs.add(1);

  const cache = res.headers['X-Cache'];
  if (cache === 'HIT' || cache === 'MISS') cacheHit.add(cache === 'HIT');
}
