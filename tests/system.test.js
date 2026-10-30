// tests/system.test.js
// 17 automated checks against the running services (npm test).
// Numbers match the test table in the group report (section 4).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let identity;
let api;
let maya; // manager { token, user }
let sam; // member
let priya; // member
let projectId;
let taskId;

before(async () => {
  identity = await h.startIdentity();
  api = await h.startApi();
});

after(async () => {
  await h.stop(api);
  await h.stop(identity);
  h.cleanup();
});

test('01 health reports API and identity service up', async () => {
  const res = await h.http('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.identity, 'up');
});

test('02 valid login returns a token and role (gRPC Login)', async () => {
  maya = await h.login('maya', 'manager123');
  sam = await h.login('sam', 'member123');
  priya = await h.login('priya', 'member123');
  assert.match(maya.token, /^[0-9a-f]{48}$/);
  assert.equal(maya.user.role, 'manager');
  assert.equal(sam.user.role, 'member');
});

test('03 wrong password 401, missing fields 400, malformed JSON 400', async () => {
  const wrong = await h.http('POST', '/api/login', { body: { username: 'maya', password: 'nope' } });
  assert.equal(wrong.status, 401);
  const missing = await h.http('POST', '/api/login', { body: { username: 'maya' } });
  assert.equal(missing.status, 400);
  const res = await fetch(h.BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Request body is not valid JSON.');
});

test('04 missing or invalid token is rejected with 401', async () => {
  assert.equal((await h.http('GET', '/api/projects')).status, 401);
  assert.equal((await h.http('GET', '/api/projects', { token: 'not-a-real-token' })).status, 401);
});

test('05 manager creates a project (retained A2 behaviour); empty name is rejected', async () => {
  const ok = await h.http('POST', '/api/projects', { token: maya.token, body: { name: 'Site visit', description: 'Weekly checks' } });
  assert.equal(ok.status, 201);
  projectId = ok.body.id;
  const empty = await h.http('POST', '/api/projects', { token: maya.token, body: { name: '   ' } });
  assert.equal(empty.status, 400);
  const list = await h.http('GET', '/api/projects', { token: maya.token });
  assert.equal(list.body[0].name, 'Site visit');
});

test('06 member cannot create a project (403)', async () => {
  const res = await h.http('POST', '/api/projects', { token: sam.token, body: { name: 'Mine' } });
  assert.equal(res.status, 403);
});

test('07 workflow 1: manager assigns a task; it appears for Sam only', async () => {
  const res = await h.http('POST', `/api/projects/${projectId}/tasks`, {
    token: maya.token, body: { title: 'Inspect roof', assigneeId: sam.user.id },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.assignee_id, sam.user.id);
  assert.equal(res.body.version, 1);
  taskId = res.body.id;

  const samTasks = await h.http('GET', '/api/my/tasks', { token: sam.token });
  assert.deepEqual(samTasks.body.map((t) => t.id), [taskId]);
  const priyaTasks = await h.http('GET', '/api/my/tasks', { token: priya.token });
  assert.equal(priyaTasks.body.length, 0);
});

test('08 another member cannot change it; a member cannot edit the title (403)', async () => {
  const other = await h.http('PUT', `/api/tasks/${taskId}`, { token: priya.token, body: { status: 'done' } });
  assert.equal(other.status, 403);
  const title = await h.http('PUT', `/api/tasks/${taskId}`, { token: sam.token, body: { title: 'Renamed' } });
  assert.equal(title.status, 403);
});

test('09 workflow 2: member status change reaches the manager over WebSocket', async () => {
  const socket = await h.openSocket(maya.token);
  try {
    const res = await h.http('PUT', `/api/tasks/${taskId}`, { token: sam.token, body: { status: 'in-progress', expectedVersion: 1 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.version, 2);
    const event = await socket.waitFor((m) => m.type === 'task.changed' && m.task.id === taskId && m.task.version === 2);
    assert.equal(event.task.status, 'in-progress');
    const feed = await h.http('GET', `/api/activity?projectId=${projectId}`, { token: maya.token });
    assert.match(feed.body[0].message, /from todo to in-progress/);
    assert.equal(feed.body[0].actor_name, 'Sam Member');
  } finally {
    socket.close();
  }
});

test('10 invalid status 400, unknown task 404, non-numeric id 400', async () => {
  assert.equal((await h.http('PUT', `/api/tasks/${taskId}`, { token: sam.token, body: { status: 'finished' } })).status, 400);
  assert.equal((await h.http('PUT', '/api/tasks/99999', { token: maya.token, body: { status: 'done' } })).status, 404);
  assert.equal((await h.http('PUT', '/api/tasks/abc', { token: maya.token, body: { status: 'done' } })).status, 400);
});

test('11 stale expectedVersion is refused with 409 and the current task', async () => {
  const res = await h.http('PUT', `/api/tasks/${taskId}`, { token: maya.token, body: { status: 'done', expectedVersion: 1 } });
  assert.equal(res.status, 409);
  assert.equal(res.body.task.version, 2);
  assert.equal(res.body.task.status, 'in-progress');
});

test('12 assigning to the manager or an unknown user is refused (checked via gRPC ListUsers)', async () => {
  const toManager = await h.http('PUT', `/api/tasks/${taskId}`, { token: maya.token, body: { assigneeId: maya.user.id } });
  assert.equal(toManager.status, 400);
  const unknown = await h.http('POST', `/api/projects/${projectId}/tasks`, { token: maya.token, body: { title: 'X', assigneeId: 999 } });
  assert.equal(unknown.status, 400);
});

test('13 GPS and typed check-ins are validated, stored and pushed live', async () => {
  const socket = await h.openSocket(maya.token);
  try {
    const badLat = await h.http('POST', `/api/tasks/${taskId}/checkins`, { token: sam.token, body: { latitude: 123, longitude: 174.7 } });
    assert.equal(badLat.status, 400);
    const empty = await h.http('POST', `/api/tasks/${taskId}/checkins`, { token: sam.token, body: { place: '' } });
    assert.equal(empty.status, 400);
    const notMine = await h.http('POST', `/api/tasks/${taskId}/checkins`, { token: priya.token, body: { place: 'Somewhere' } });
    assert.equal(notMine.status, 403);

    const gps = await h.http('POST', `/api/tasks/${taskId}/checkins`, {
      token: sam.token, body: { latitude: -36.8535, longitude: 174.7656, accuracy: 12 },
    });
    assert.equal(gps.status, 201);
    assert.equal(gps.body.kind, 'gps');
    const event = await socket.waitFor((m) => m.type === 'checkin.added' && m.checkin.id === gps.body.id);
    assert.equal(event.checkin.user_name, 'Sam Member');

    const manual = await h.http('POST', `/api/tasks/${taskId}/checkins`, { token: sam.token, body: { place: 'Front gate' } });
    assert.equal(manual.status, 201);
    assert.equal(manual.body.kind, 'manual');

    const project = await h.http('GET', `/api/projects/${projectId}`, { token: maya.token });
    assert.equal(project.body.tasks[0].latest_checkin.place, 'Front gate');
  } finally {
    socket.close();
  }
});

test('14 dropped WebSocket: reconnect restores current state and newer events still arrive', async () => {
  const first = await h.openSocket(maya.token);
  first.ws.terminate(); // simulate a dropped connection

  // A change happens while the manager is disconnected.
  const missed = await h.http('PUT', `/api/tasks/${taskId}`, { token: sam.token, body: { status: 'done' } });
  assert.equal(missed.status, 200);

  // Reconnect: the client reloads state over REST and sees the missed change.
  const second = await h.openSocket(maya.token);
  try {
    const project = await h.http('GET', `/api/projects/${projectId}`, { token: maya.token });
    const restored = project.body.tasks.find((t) => t.id === taskId);
    assert.equal(restored.status, 'done');
    assert.equal(restored.version, missed.body.version);

    // A later change arrives with a higher version, so the client accepts it.
    await h.http('PUT', `/api/tasks/${taskId}`, { token: sam.token, body: { status: 'in-progress' } });
    const event = await second.waitFor((m) => m.type === 'task.changed' && m.task.id === taskId && m.task.version > restored.version);
    assert.equal(event.task.status, 'in-progress');
  } finally {
    second.close();
  }
});

test('15 data survives an API restart (persistence)', async () => {
  await h.stop(api);
  api = await h.startApi();
  const project = await h.http('GET', `/api/projects/${projectId}`, { token: maya.token });
  assert.equal(project.status, 200);
  assert.equal(project.body.tasks[0].title, 'Inspect roof');
  assert.equal(project.body.tasks[0].assignee_id, sam.user.id);
});

test('16 identity service stopped or slow: fast 503, health degraded, recovers on restart', async () => {
  await h.stop(identity);

  const started = Date.now();
  const res = await h.http('GET', '/api/projects', { token: maya.token });
  const elapsed = Date.now() - started;
  assert.equal(res.status, 503);
  assert.match(res.body.error, /Sign-in service is unavailable/);
  assert.ok(elapsed < 2500, `took ${elapsed} ms`);

  const health = await h.http('GET', '/api/health');
  assert.equal(health.status, 503);
  assert.equal(health.body.status, 'degraded');

  // Slow identity service: the 1.5 s gRPC deadline fires instead of hanging.
  identity = await h.startIdentity({ IDENTITY_DELAY_MS: '3000' });
  const slowStart = Date.now();
  const slow = await h.http('GET', '/api/projects', { token: maya.token });
  const slowElapsed = Date.now() - slowStart;
  assert.equal(slow.status, 503);
  assert.ok(slowElapsed >= 1400 && slowElapsed < 2500, `deadline took ${slowElapsed} ms`);
  await h.stop(identity);

  // Normal restart: the API reconnects by itself within a few seconds, and because sessions
  // are stored in identity.db the same token works again (no new sign-in needed).
  identity = await h.startIdentity();
  const restartedAt = Date.now();
  let recovered;
  do {
    recovered = await h.http('GET', '/api/projects', { token: maya.token });
  } while (recovered.status === 503 && Date.now() - restartedAt < 5000);
  const recoveryMs = Date.now() - restartedAt;
  assert.equal(recovered.status, 200, `still ${recovered.status} after ${recoveryMs} ms`);
  console.log(`    identity recovery took ${recoveryMs} ms`);
});

test('17 deleting a project cascades to its tasks; deleting again is 404', async () => {
  const del = await h.http('DELETE', `/api/projects/${projectId}`, { token: maya.token });
  assert.equal(del.status, 204);
  assert.equal((await h.http('GET', `/api/tasks/${taskId}`, { token: maya.token })).status, 404);
  assert.equal((await h.http('GET', '/api/my/tasks', { token: sam.token })).body.length, 0);
  assert.equal((await h.http('DELETE', `/api/projects/${projectId}`, { token: maya.token })).status, 404);
});
