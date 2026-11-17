// Step load test whose summary `pattern-sim calibrate` can read.
//
//   k6 run \
//     -e BASE_URL=http://localhost:3000/api/products \
//     -e RATES=50,100,200 -e STEP=60s \
//     --summary-export=k6-summary.json \
//     tools/k6/step-load.js
//
//   pnpm sim calibrate my-design.json k6-summary.json --out calibrated.json
//
// Each rate runs as its own scenario named `rps<RATE>_<STEP>s` with the
// open-model executor `constant-arrival-rate`: k6 starts RATE requests per
// second whatever the server's latency (closed models with a fixed number of
// VUs slow down with the server and hide overload: coordinated omission).
// One request per iteration, so iterations = requests.
//
// Env:
//   BASE_URL   endpoint to hit (required)
//   RATES      comma-separated request rates, e.g. 50,100,200 (rps)
//   STEP       duration of each step, e.g. 60s (seconds only)
//   GAP        idle time between steps so queues drain, default 15s
//   MAX_VUS    VU cap; if reached k6 drops iterations (reported, pass
//              the same value to `calibrate --max-vus`), default 2000
//   METHOD     GET (default), POST, PUT...
//   BODY       request body (string, sent as-is)
//   HEADERS    JSON object of headers, e.g. '{"Authorization":"Bearer x"}'
//   TIMEOUT    per-request timeout, default 60s (k6 default)

import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) throw new Error('set -e BASE_URL=http://host/path');

const RATES = (__ENV.RATES || '50,100,200')
  .split(',')
  .map((r) => Number(r.trim()))
  .filter((r) => r > 0);
const seconds = (v, d) => {
  const m = /^(\d+)s?$/.exec(String(v ?? d));
  if (!m) throw new Error(`durations are whole seconds, got "${v}"`);
  return Number(m[1]);
};
const STEP = seconds(__ENV.STEP, '60s');
const GAP = seconds(__ENV.GAP, '15s');
const MAX_VUS = Number(__ENV.MAX_VUS || 2000);
const METHOD = (__ENV.METHOD || 'GET').toUpperCase();
const BODY = __ENV.BODY || null;
const HEADERS = __ENV.HEADERS ? JSON.parse(__ENV.HEADERS) : {};
const TIMEOUT = __ENV.TIMEOUT || '60s';

const scenarios = {};
// Thresholds on per-scenario sub-metrics make k6 include them in the
// summary; the conditions themselves always pass.
const thresholds = {};
RATES.forEach((rate, i) => {
  const name = `rps${rate}_${STEP}s`;
  scenarios[name] = {
    executor: 'constant-arrival-rate',
    rate,
    timeUnit: '1s',
    duration: `${STEP}s`,
    preAllocatedVUs: Math.min(MAX_VUS, Math.ceil(rate / 2) + 10),
    maxVUs: MAX_VUS,
    startTime: `${i * (STEP + GAP)}s`,
    gracefulStop: `${Math.max(GAP - 1, 1)}s`,
  };
  const tag = `{scenario:${name}}`;
  thresholds[`http_req_duration${tag}`] = ['max>=0'];
  thresholds[`http_reqs${tag}`] = ['count>=0'];
  thresholds[`http_req_failed${tag}`] = ['rate>=0'];
  thresholds[`iterations${tag}`] = ['count>=0'];
  thresholds[`dropped_iterations${tag}`] = ['count>=0'];
});

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  discardResponseBodies: true,
};

export default function () {
  http.request(METHOD, BASE_URL, BODY, { headers: HEADERS, timeout: TIMEOUT });
}
