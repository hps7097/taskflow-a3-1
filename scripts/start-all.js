// scripts/start-all.js
// Starts the identity service, then the API service, in one terminal (npm start).
// Ctrl+C stops both. To stop just one service (for failure tests) run them in two
// terminals with npm run start:identity and npm run start:api instead.

const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const children = [];

function run(name, script) {
  const child = spawn(process.execPath, [path.join(root, script)], { cwd: root, env: process.env });
  const prefix = (chunk) => chunk.toString().split('\n').filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  child.stdout.on('data', (d) => process.stdout.write(prefix(d)));
  child.stderr.on('data', (d) => process.stderr.write(prefix(d)));
  child.on('exit', (code) => console.log(`[${name}] exited with code ${code}`));
  children.push(child);
}

run('identity', 'identity-service/server.js');
setTimeout(() => run('api', 'api-service/server.js'), 400);

function stop() {
  for (const c of children) c.kill('SIGINT');
  setTimeout(() => process.exit(0), 1200);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
