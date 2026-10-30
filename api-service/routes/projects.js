// api-service/routes/projects.js
// Retained from Assessment 2 (server/routes/projects.js).
// Revised in A3: all routes need sign-in; create/update/delete are manager-only;
// the project detail includes its tasks with assignee and version.

const express = require('express');
const db = require('../db');
const { requireManager } = require('../auth');

const router = express.Router();

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/projects - every project with task counts
router.get('/', (req, res) => {
  const projects = db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count
    FROM projects p
    ORDER BY p.created_at DESC, p.id DESC
  `).all();
  res.json(projects);
});

// GET /api/projects/:id - one project with its tasks
router.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Project id must be a positive integer.' });

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) return res.status(404).json({ error: `Project ${id} not found.` });

  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY id').all(id);
  // Latest check-in per task, so the board can show where each task was last checked in.
  const latest = db.prepare(`
    SELECT c.* FROM checkins c
    WHERE c.id IN (SELECT MAX(c2.id) FROM checkins c2 JOIN tasks t ON t.id = c2.task_id
                   WHERE t.project_id = ? GROUP BY c2.task_id)`).all(id);
  const byTask = new Map(latest.map((c) => [c.task_id, c]));
  res.json({ ...project, tasks: tasks.map((t) => ({ ...t, latest_checkin: byTask.get(t.id) || null })) });
});

// POST /api/projects - manager only. Body: { name, description }
router.post('/', requireManager, (req, res) => {
  const { name, description } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Field "name" is required and must be a non-empty string.' });
  }
  if (name.trim().length > 100) {
    return res.status(400).json({ error: 'Field "name" must be 100 characters or fewer.' });
  }
  const info = db.prepare('INSERT INTO projects (name, description) VALUES (?, ?)')
    .run(name.trim(), description ? String(description).trim() : '');
  res.status(201).json(db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/projects/:id - manager only
router.put('/:id', requireManager, (req, res) => {
  const id = parseId(req.params.id);
  const { name, description } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Project id must be a positive integer.' });
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({ error: 'Field "name" must be a non-empty string when provided.' });
  }
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: `Project ${id} not found.` });

  db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?').run(
    name !== undefined ? name.trim() : existing.name,
    description !== undefined ? String(description).trim() : existing.description,
    id
  );
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
});

// DELETE /api/projects/:id - manager only; cascades to tasks, check-ins and activity
router.delete('/:id', requireManager, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Project id must be a positive integer.' });
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: `Project ${id} not found.` });
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  res.status(204).send();
});

module.exports = router;
