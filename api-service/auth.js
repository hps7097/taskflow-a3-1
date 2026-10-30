// api-service/auth.js
// Express middleware: every /api route except login and health needs a Bearer token.
// The token is checked with the Identity service over gRPC (ValidateToken).

const identity = require('./identityClient');

function tokenFrom(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

async function requireAuth(req, res, next) {
  const token = tokenFrom(req);
  if (!token) return res.status(401).json({ error: 'Sign in required.' });
  try {
    const reply = await identity.validateToken(token);
    if (!reply.valid) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    req.user = reply.user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireManager(req, res, next) {
  if (req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Only a manager can do this.' });
  }
  next();
}

module.exports = { requireAuth, requireManager, tokenFrom };
