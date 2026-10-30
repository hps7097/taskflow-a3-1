// api-service/live.js
// WebSocket server for live updates (path /ws?token=...).
// Event types (see docs/api.md):
//   task.changed   { action: created|updated|deleted, task }
//   checkin.added  { checkin, task }
// Managers receive every event. Members receive events for tasks assigned to them.

const { WebSocketServer } = require('ws');
const identity = require('./identityClient');

let wss = null;

function attach(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', async (socket, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    try {
      const reply = await identity.validateToken(token || '');
      if (!reply.valid) return socket.close(4001, 'Invalid token');
      socket.user = reply.user;
      socket.isAlive = true;
      socket.on('pong', () => { socket.isAlive = true; });
      socket.send(JSON.stringify({ type: 'hello', user: reply.user, time: new Date().toISOString() }));
    } catch (err) {
      socket.close(1011, 'Identity service unavailable');
    }
  });

  // Heartbeat: drop sockets that stop answering so clients notice and reconnect.
  const interval = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }, 15000);
  wss.on('close', () => clearInterval(interval));
  return wss;
}

function broadcast(type, payload, assigneeId) {
  if (!wss) return;
  const message = JSON.stringify({ type, ...payload, time: new Date().toISOString() });
  for (const socket of wss.clients) {
    if (socket.readyState !== 1 || !socket.user) continue;
    if (socket.user.role === 'manager' || (assigneeId && socket.user.id === assigneeId)) {
      socket.send(message);
    }
  }
}

function close() {
  if (!wss) return;
  for (const socket of wss.clients) socket.terminate();
  wss.close();
}

module.exports = { attach, broadcast, close };
