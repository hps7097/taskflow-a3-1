// scripts/seed.js  (npm run seed, with the services running)
// Adds sample data through the API, the same way the clients do:
// two projects and four tasks, three of them assigned to Sam and one to Priya.

const BASE = process.env.API_URL || 'http://localhost:3000';

async function call(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json && json.error}`);
  return json;
}

(async () => {
  const maya = await call('POST', '/api/login', null, { username: 'maya', password: 'manager123' });
  const members = await call('GET', '/api/users?role=member', maya.token);
  const sam = members.find((u) => u.username === 'sam');
  const priya = members.find((u) => u.username === 'priya');

  const office = await call('POST', '/api/projects', maya.token, { name: 'Office fit-out', description: 'Level 3 refurbishment' });
  const site = await call('POST', '/api/projects', maya.token, { name: 'Site inspections', description: 'Weekly safety walk-throughs' });

  await call('POST', `/api/projects/${site.id}/tasks`, maya.token, { title: 'Inspect scaffolding', description: 'North face, levels 1-4', assigneeId: sam.id });
  await call('POST', `/api/projects/${site.id}/tasks`, maya.token, { title: 'Check fire exits', assigneeId: priya.id });
  await call('POST', `/api/projects/${office.id}/tasks`, maya.token, { title: 'Measure meeting room', assigneeId: sam.id });
  await call('POST', `/api/projects/${office.id}/tasks`, maya.token, { title: 'Order carpet samples', assigneeId: sam.id, status: 'in-progress' });

  console.log('Sample data added: 2 projects, 4 tasks (3 for Sam, 1 for Priya).');
})().catch((err) => {
  console.error('Seeding failed:', err.message);
  console.error('Start the services first (npm start), then run npm run seed.');
  process.exit(1);
});
