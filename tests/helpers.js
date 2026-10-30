// tests/helpers.js
// Starts the real identity and API services on test ports with temporary databases,
// so the tests exercise gRPC, SQLite and WebSocket exactly as in normal use.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-test-'));

const IDENTITY_PORT = 50151;
const API_PORT = 3101;
const BASE = `http://localhost:${API_PORT}`;

const baseEnv = {
  ...process.env,
  IDENTITY_PORT: String(IDENTITY_PORT),
  IDENTITY_ADDR: `127.0.0.1:${IDENTITY_PORT}`,
  IDENTITY_DB: path.join(TMP, 'identity.db'),
  API_DB: path.join(TMP, 'taskflow.db'),
  PORT: String(API_PORT),
};

function start(script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, script)], { env: { ...baseEnv, ...extraEnv } });
    let output = '';
    const timer = setTimeout(() => reject(new Error(`${script} did not start:\n${output}`)), 8000);
    child.stdout.on('data', (d) => {
      output += d;
      if (/listening/i.test(output)) { clearTimeout(timer); resolve(child); }
    });
    child.stderr.on('data', (d) => { output += d; });
    child.on('exit', (code) => { clearTimeout(timer); if (!/listening/i.test(output)) reject(new Error(`${script} exited ${code}:\n${output}`)); });
  });
}

function stop(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM'); // on Windows this ends the process immediately
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  });
}

const startIdentity = (env) => start('identity-service/server.js', env);
const startApi = (env) => start('api-service/server.js', env);

async function http(method, urlPath, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = text; }
  return { status: res.status, body: json };
}

async function login(username, password) {
  const res = await http('POST', '/api/login', { body: { username, password } });
  if (res.status !== 200) throw new Error(`login ${username} failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

// Opens a WebSocket and collects events. waitFor(predicate) resolves with the first matching event.
function openSocket(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${API_PORT}/ws?token=${token}`);
    const events = [];
    const waiters = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      events.push(msg);
      for (const w of [...waiters]) {
        if (w.predicate(msg)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(msg); }
      }
      if (msg.type === 'hello') resolve(api);
    });
    ws.on('error', reject);
    const api = {
      ws,
      events,
      waitFor(predicate, ms = 3000) {
        const found = events.find(predicate);
        if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const w = { predicate, resolve: res, timer: setTimeout(() => rej(new Error('Timed out waiting for WebSocket event')), ms) };
          waiters.push(w);
        });
      },
      close() { ws.close(); },
    };
  });
}

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

module.exports = { startIdentity, startApi, stop, http, login, openSocket, cleanup, BASE };
