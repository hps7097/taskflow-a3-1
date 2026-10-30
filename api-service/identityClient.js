// api-service/identityClient.js
// gRPC client for the Identity service. Every call has a deadline so a slow or
// stopped identity service produces a fast, clear error instead of a hung request.

const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// 127.0.0.1 rather than localhost: on Windows "localhost" tries IPv6 (::1) first, the identity
// service listens on IPv4, and each failed attempt takes about 2 s, which is longer than the deadline.
const ADDRESS = process.env.IDENTITY_ADDR || '127.0.0.1:50051';
const DEADLINE_MS = Number(process.env.IDENTITY_DEADLINE_MS || 1500);

const packageDef = protoLoader.loadSync(path.join(__dirname, '..', 'proto', 'identity.proto'), {
  keepCase: true,
  longs: Number,
  defaults: true,
});
const proto = grpc.loadPackageDefinition(packageDef).taskflow.identity;
// Reconnect quickly after the identity service restarts. With gRPC's defaults the
// channel backs off for up to two minutes, so the API kept answering 503 long after
// identity was back (found while writing test 16). The maximum backoff is kept below
// the 1.5 s deadline so a waiting request always sees at least one reconnect attempt.
const client = new proto.Identity(ADDRESS, grpc.credentials.createInsecure(), {
  'grpc.initial_reconnect_backoff_ms': 200,
  'grpc.max_reconnect_backoff_ms': 1000,
});

// Thrown when the identity service cannot answer in time; routes turn it into HTTP 503.
class IdentityUnavailableError extends Error {
  constructor(cause) {
    const reason = cause && cause.code === grpc.status.DEADLINE_EXCEEDED ? 'deadline exceeded' : 'unavailable';
    super(`Identity service ${reason}`);
    this.name = 'IdentityUnavailableError';
    this.grpcCode = cause && cause.code;
  }
}

function call(method, request) {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + DEADLINE_MS);
    // waitForReady: if the channel is reconnecting, wait (up to the deadline) instead of
    // failing at once, so a call made just as identity comes back still succeeds.
    const metadata = new grpc.Metadata({ waitForReady: true });
    client[method](request, metadata, { deadline }, (err, reply) => {
      if (err) {
        console.warn(`[api] gRPC ${method} failed: ${grpc.status[err.code] || err.code} ${err.details || ''}`);
        return reject(new IdentityUnavailableError(err));
      }
      resolve(reply);
    });
  });
}

module.exports = {
  login: (username, password) => call('Login', { username, password }),
  validateToken: (token) => call('ValidateToken', { token }),
  listUsers: (role = '') => call('ListUsers', { role }),
  IdentityUnavailableError,
  DEADLINE_MS,
};
