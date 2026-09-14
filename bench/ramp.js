import http from 'k6/http';
import { Trend, Rate } from 'k6/metrics';

/**
 * Finds the ceiling. Not a pass/fail test — the output is the load level at
 * which something gives, and what gave.
 *
 *   k6 run -e BASE=http://localhost:4100 bench/ramp.js
 */
export const options = {
  stages: [
    { duration: '30s', target: 200 },
    { duration: '45s', target: 500 },
    { duration: '45s', target: 1000 },
    { duration: '45s', target: 2000 },
    { duration: '45s', target: 3000 },
    { duration: '15s', target: 0 },
  ],
  // No thresholds: this run is expected to degrade. Aborting on the first
  // breach would hide the thing being looked for.
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
};

const SLUGS = JSON.parse(open('./slugs.json'));
const HOT = Math.floor(SLUGS.length * 0.2);

const byStage = {};
for (const vus of [200, 500, 1000, 2000, 3000]) {
  byStage[vus] = {
    duration: new Trend(`dur_at_${vus}vu`, true),
    failed: new Rate(`failed_at_${vus}vu`),
  };
}

function currentTarget(elapsedMs) {
  const s = elapsedMs / 1000;
  if (s < 30) return null; // ramp-in, not a steady level
  if (s < 75) return 200;
  if (s < 120) return 500;
  if (s < 165) return 1000;
  if (s < 210) return 2000;
  if (s < 225) return 3000;
  return null;
}

export function setup() {
  return { startedAt: Date.now() };
}

export default function (data) {
  const slug = SLUGS[Math.floor(Math.random() * (Math.random() < 0.8 ? HOT : SLUGS.length))];
  const res = http.get(`${__ENV.BASE}/api/pastes/${slug}`, { timeout: '10s' });

  const level = currentTarget(Date.now() - data.startedAt);
  if (!level) return;

  byStage[level].duration.add(res.timings.duration);
  byStage[level].failed.add(res.status !== 200);
}
