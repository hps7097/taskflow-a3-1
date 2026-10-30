// api-service/routes/account.js
// New in A3: sign-in, current user, the member list, and the activity feed.

const express = require('express');
const db = require('../db');
const identity = require('../identityClient');
const { requireAuth, requireManager } = require('../auth');

const router = express.Router();

// POST /api/login  Body: { username, password }  ->  { token, user }
router.post('/login', async (req, res, next) => {
  const { username, password } = req.body || {};
  if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Fields "username" and "password" are required.' });
  }
  try {
    const reply = await identity.login(username, password);
    if (!reply.ok) return res.status(401).json({ error: reply.error || 'Wrong username or password.' });
    res.json({ token: reply.token, user: reply.user });
  } catch (err) {
    next(err);
  }
});

// GET /api/me
router.get('/me', requireAuth, (req, res) => res.json(req.user));

// GET /api/users?role=member  (manager only: used to fill the assignee list)
router.get('/users', requireAuth, requireManager, async (req, res, next) => {
  const role = req.query.role || '';
  if (role && !['member', 'manager'].includes(role)) {
    return res.status(400).json({ error: 'Query "role" must be member or manager.' });
  }
  try {
    const reply = await identity.listUsers(role);
    res.json(reply.users);
  } catch (err) {
    next(err);
  }
});

// GET /api/activity?projectId=1&limit=50  (manager only)
router.get('/activity', requireAuth, requireManager, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  if (req.query.projectId !== undefined) {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ error: 'Query "projectId" must be a positive integer.' });
    }
    return res.json(db.prepare(`
      SELECT a.*, p.name AS project_name FROM activity a JOIN projects p ON p.id = a.project_id
      WHERE a.project_id = ? ORDER BY a.id DESC LIMIT ?`).all(projectId, limit));
  }
  res.json(db.prepare(`
    SELECT a.*, p.name AS project_name FROM activity a JOIN projects p ON p.id = a.project_id
    ORDER BY a.id DESC LIMIT ?`).all(limit));
});

module.exports = router;
