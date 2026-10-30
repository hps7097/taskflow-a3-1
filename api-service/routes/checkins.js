// api-service/routes/checkins.js
// New in A3. A member checks in on a task from the Android app, either with the
// device location (kind "gps") or, if location is denied or unavailable, a typed place ("manual").

const express = require('express');
const db = require('../db');
const activity = require('../activity');
const live = require('../live');

const router = express.Router();

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// POST /api/tasks/:id/checkins
// Body (gps):    { latitude, longitude, accuracy?, note? }
// Body (manual): { place, note? }
router.post('/tasks/:id/checkins', (req, res) => {
  const taskId = parseId(req.params.id);
  if (!taskId) return res.status(400).json({ error: 'Task id must be a positive integer.' });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return res.status(404).json({ error: `Task ${taskId} not found.` });
  if (task.assignee_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only check in on tasks assigned to you.' });
  }

  const { latitude, longitude, accuracy, place, note } = req.body || {};
  const hasCoords = latitude !== undefined || longitude !== undefined;
  let row;

  if (hasCoords) {
    if (!isNum(latitude) || latitude < -90 || latitude > 90) {
      return res.status(400).json({ error: 'Field "latitude" must be a number between -90 and 90.' });
    }
    if (!isNum(longitude) || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'Field "longitude" must be a number between -180 and 180.' });
    }
    if (accuracy !== undefined && accuracy !== null && (!isNum(accuracy) || accuracy < 0)) {
      return res.status(400).json({ error: 'Field "accuracy" must be a non-negative number.' });
    }
    row = { kind: 'gps', latitude, longitude, accuracy_m: isNum(accuracy) ? accuracy : null, place: null };
  } else {
    if (!place || typeof place !== 'string' || !place.trim()) {
      return res.status(400).json({ error: 'Send either latitude and longitude, or a non-empty "place".' });
    }
    if (place.trim().length > 120) {
      return res.status(400).json({ error: 'Field "place" must be 120 characters or fewer.' });
    }
    row = { kind: 'manual', latitude: null, longitude: null, accuracy_m: null, place: place.trim() };
  }
  const noteText = note ? String(note).trim().slice(0, 200) : '';

  const checkin = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO checkins (task_id, user_id, user_name, kind, latitude, longitude, accuracy_m, place, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(taskId, req.user.id, req.user.display_name, row.kind, row.latitude, row.longitude,
        row.accuracy_m, row.place, noteText);
    const where = row.kind === 'gps'
      ? `at ${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`
      : `at "${row.place}" (typed)`;
    activity.record(req.user, task.project_id, taskId, 'checkin.added', `checked in on "${task.title}" ${where}`);
    return db.prepare('SELECT * FROM checkins WHERE id = ?').get(info.lastInsertRowid);
  })();

  live.broadcast('checkin.added', { checkin, task }, task.assignee_id);
  res.status(201).json(checkin);
});

// GET /api/tasks/:id/checkins
router.get('/tasks/:id/checkins', (req, res) => {
  const taskId = parseId(req.params.id);
  if (!taskId) return res.status(400).json({ error: 'Task id must be a positive integer.' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return res.status(404).json({ error: `Task ${taskId} not found.` });
  if (req.user.role !== 'manager' && task.assignee_id !== req.user.id) {
    return res.status(403).json({ error: 'This task is not assigned to you.' });
  }
  res.json(db.prepare('SELECT * FROM checkins WHERE task_id = ? ORDER BY id DESC').all(taskId));
});

module.exports = router;
