// scripts/perf.js  (npm run perf)
// Non-functional requirement: response time of the home-screen request.
// Target: 95% of authenticated GET /api/projects requests complete in under 200 ms.
// Conditions: 25 projects, 100 tasks, 10 concurrent clients, 500 requests, everything on
// one machine, and each request includes the gRPC ValidateToken call to the identity service.

const h = require('../tests/helpers');

const PROJECTS = 25;
const TASKS = 100;
const CONCURRENCY = 10;
const REQUESTS = 500;
const TARGET_P95_MS = 200;

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

(async () => {
  const identity = await h.startIdentity();
  const api = await h.startApi();
  try {
    const maya = await h.login('maya', 'manager123');
    const sam = await h.login('sam', 'member123');

    console.log(`Seeding ${PROJECTS} projects and ${TASKS} tasks…`);
    const ids = [];
    for (let i = 1; i <= PROJECTS; i++) {
      const res = await h.http('POST', '/api/projects', { token: maya.token, body: { name: `Perf project ${i}` } });
      ids.push(res.body.id);
    }
    for (let i = 1; i <= TASKS; i++) {
      await h.http('POST', `/api/projects/${ids[i % PROJECTS]}/tasks`, {
        token: maya.token, body: { title: `Perf task ${i}`, assigneeId: sam.user.id },
      });
    }

    // Warm-up (opens the gRPC channel and SQLite caches), not counted.
    for (let i = 0; i < 20; i++) await h.http('GET', '/api/projects', { token: maya.token });

    console.log(`Sending ${REQUESTS} requests with ${CONCURRENCY} concurrent clients…`);
    const times = [];
    let errors = 0;
    let next = 0;
    async function worker() {
      while (next < REQUESTS) {
        next++;
        const t0 = process.hrtime.bigint();
        const res = await h.http('GET', '/api/projects', { token: maya.token });
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (res.status !== 200 || res.body.length !== PROJECTS) errors++;
        times.push(ms);
      }
    }
    const wall0 = Date.now();
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const wall = Date.now() - wall0;

    times.sort((a, b) => a - b);
    const median = percentile(times, 50);
    const p95 = percentile(times, 95);
    const max = times[times.length - 1];

    console.log('');
    console.log(`Requests:    ${times.length} (${errors} errors) in ${wall} ms (${Math.round(times.length / (wall / 1000))} req/s)`);
    console.log(`Median:      ${median.toFixed(1)} ms`);
    console.log(`95th pct:    ${p95.toFixed(1)} ms`);
    console.log(`Maximum:     ${max.toFixed(1)} ms`);
    console.log(`Node ${process.version} on ${process.platform} ${process.arch}, ${new Date().toISOString()}`);
    console.log('');
    if (p95 < TARGET_P95_MS && errors === 0) {
      console.log(`PASS: p95 under ${TARGET_P95_MS} ms`);
    } else {
      console.log(`FAIL: p95 ${p95.toFixed(1)} ms (target ${TARGET_P95_MS} ms), errors ${errors}`);
      process.exitCode = 1;
    }
  } finally {
    await h.stop(api);
    await h.stop(identity);
    h.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
