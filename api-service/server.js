// api-service/server.js
// TaskFlow API service. Retained from Assessment 2 (server/server.js) and extended:
// sign-in through the gRPC Identity service, role rules, assignments, check-ins,
// an activity log and WebSocket live updates (/ws).

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');

const db = require('./db');
const identity = require('./identityClient');
const live = require('./live');
const { requireAuth } = require('./auth');
const accountRouter = require('./routes/account');
const projectsRouter = require('./routes/projects');
const tasksRouter = require('./routes/tasks');
const checkinsRouter = require('./routes/checkins');

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50kb' }));

// Serve the web client. (The A2 server pointed at ../client but the folder was named
// "cilent", so the page never loaded; fixed in A3 by moving the client to web/.)
app.use(express.static(path.join(__dirname, '..', 'web')));

// Health: reports whether the identity service answers within the deadline.
app.get('/api/health', async (req, res) => {
  const started = Date.now();
  let identityStatus = 'up';
  try {
    await identity.listUsers('manager');
  } catch (err) {
    identityStatus = 'down';
  }
  res.status(identityStatus === 'up' ? 200 : 503).json({
    status: identityStatus === 'up' ? 'ok' : 'degraded',
    api: 'up',
    identity: identityStatus,
    checkedInMs: Date.now() - started,
    time: new Date().toISOString(),
  });
});

app.use('/api', accountRouter); // /login is public; /me, /users, /activity check auth themselves
app.use('/api', requireAuth);    // everything below needs a valid token (one gRPC check per request)
app.use('/api/projects', projectsRouter);
app.use('/api', tasksRouter);
app.use('/api', checkinsRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route.' }));

// Error handler: bad JSON -> 400, identity down -> 503, anything else -> 500.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (err.name === 'IdentityUnavailableError') {
    return res.status(503).json({ error: 'Sign-in service is unavailable. Please try again shortly.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

const server = http.createServer(app);
live.attach(server);
server.listen(PORT, () => {
  console.log(`TaskFlow API listening at http://localhost:${PORT}`);
});

function shutdown() {
  live.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
