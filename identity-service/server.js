// identity-service/server.js
// gRPC Identity service: owns users and sessions (identity.db).
// Implements proto/identity.proto: Login, ValidateToken, ListUsers.

const path = require('path');
const crypto = require('crypto');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { open, hashPassword } = require('./db');

const PORT = process.env.IDENTITY_PORT || 50051;
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
// Optional artificial delay (ms) so the API's gRPC deadline can be demonstrated.
const DELAY_MS = Number(process.env.IDENTITY_DELAY_MS || 0);

const packageDef = protoLoader.loadSync(path.join(__dirname, '..', 'proto', 'identity.proto'), {
  keepCase: true,
  longs: Number,
  defaults: true,
});
const proto = grpc.loadPackageDefinition(packageDef).taskflow.identity;

const db = open();

const q = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  insertSession: db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"),
  sessionUser: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')`),
  allUsers: db.prepare('SELECT id, username, display_name, role FROM users ORDER BY id'),
  usersByRole: db.prepare('SELECT id, username, display_name, role FROM users WHERE role = ? ORDER BY id'),
};

function publicUser(u) {
  return { id: u.id, username: u.username, display_name: u.display_name, role: u.role };
}

function delayed(fn) {
  return (call, callback) => {
    if (DELAY_MS > 0) setTimeout(() => fn(call, callback), DELAY_MS);
    else fn(call, callback);
  };
}

const handlers = {
  Login: delayed((call, callback) => {
    const { username, password } = call.request;
    const user = q.userByName.get(String(username || '').trim().toLowerCase());
    if (!user || hashPassword(String(password || ''), user.password_salt) !== user.password_hash) {
      return callback(null, { ok: false, error: 'Wrong username or password.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    q.insertSession.run(token, user.id, `+${SESSION_HOURS} hours`);
    console.log(`[identity] Login ok: ${user.username}`);
    callback(null, { ok: true, token, user: publicUser(user) });
  }),

  ValidateToken: delayed((call, callback) => {
    const user = q.sessionUser.get(String(call.request.token || ''));
    callback(null, user ? { valid: true, user: publicUser(user) } : { valid: false });
  }),

  ListUsers: delayed((call, callback) => {
    const role = call.request.role;
    const rows = role ? q.usersByRole.all(role) : q.allUsers.all();
    callback(null, { users: rows.map(publicUser) });
  }),
};

const server = new grpc.Server();
server.addService(proto.Identity.service, handlers);
server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) {
    console.error('Identity service failed to start:', err.message);
    process.exit(1);
  }
  console.log(`Identity service (gRPC) listening on ${port}`);
});

function shutdown() {
  server.tryShutdown(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
