// api-service/routes/tasks.js
// Retained from Assessment 2 (server/routes/tasks.js): list/create tasks in a project,
// update and delete a task, status validation.
// New in A3: assignment to a member (checked with the Identity service over gRPC),
// role rules, optimistic concurrency with "version", activity log and live events.

const express = require('express');
const db = require('../db');
const identity = require('../identityClient');
const activity = require('../activity');
const live = require('../live');
const { requireManager } = require('../auth');

const router = express.Router();
const VALID_STATUSES = ['todo', 'in-progress', 'done'];

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const getTask = db.prepare(`
  SELECT t.*, p.name AS project_name
  FROM tasks t JOIN projects p ON p.id = t.project_id
  WHERE t.id = ?`);

// Returns { ok: true, member } or { ok: false, status, error }. Uses gRPC ListUsers.
async function checkAssignee(assigneeId) {
  if (assigneeId === null) return { ok: true, member: null };
  if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
    return { ok: false, status: 400, error: 'Field "assigneeId" must be a user id or null.' };
  }
  const reply = await identity.listUsers('member');
  const member = reply.users.find((u) => u.id === assigneeId);
  if (!member) return { ok: false, status: 400, error: `User ${assigneeId} is not a team member.` };
  return { ok: true, member };
}

// GET /api/my/tasks - tasks assigned to the signed-in user (used by Android and the web "My tasks" view)
router.get('/my/tasks', (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, p.name AS project_name
    FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.assignee_id = ?
    ORDER BY CASE t.status WHEN 'in-progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, t.id`).all(req.user.id);
  res.json(tasks);
});

// GET /api/projects/:projectId/tasks
router.get('/projects/:projectId/tasks', (req, res) => {
  const projectId = parseId(req.params.projectId);
  if (!projectId) return res.status(400).json({ error: 'Project id must be a positive integer.' });
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    return res.status(404).json({ error: `Project ${projectId} not found.` });
  }
  res.json(db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY id').all(projectId));
});

// GET /api/tasks/:id - one task with its check-ins (members may only read their own)
router.get('/tasks/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Task id must be a positive integer.' });
  const task = getTask.get(id);
  if (!task) return res.status(404).json({ error: `Task ${id} not found.` });
  if (req.user.role !== 'manager' && task.assignee_id !== req.user.id) {
    return res.status(403).json({ error: 'This task is not assigned to you.' });
  }
  const checkins = db.prepare('SELECT * FROM checkins WHERE task_id = ? ORDER BY id DESC LIMIT 20').all(id);
  res.json({ ...task, checkins });
});

// POST /api/projects/:projectId/tasks - manager only. Body: { title, description, status, assigneeId }
router.post('/projects/:projectId/tasks', requireManager, async (req, res, next) => {
  try {
    const projectId = parseId(req.params.projectId);
    const { title, description, status } = req.body || {};
    const assigneeId = req.body && req.body.assigneeId !== undefined ? req.body.assigneeId : null;

    if (!projectId) return res.status(400).json({ error: 'Project id must be a positive integer.' });
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: `Project ${projectId} not found.` });
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Field "title" is required and must be a non-empty string.' });
    }
    if (title.trim().length > 120) {
      return res.status(400).json({ error: 'Field "title" must be 120 characters or fewer.' });
    }
    const taskStatus = status || 'todo';
    if (!VALID_STATUSES.includes(taskStatus)) {
      return res.status(400).json({ error: `Field "status" must be one of: ${VALID_STATUSES.join(', ')}.` });
    }
    const check = await checkAssignee(assigneeId);
    if (!check.ok) return res.status(check.status).json({ error: check.error });

    const create = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO tasks (project_id, title, description, status, assignee_id, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))`)
        .run(projectId, title.trim(), description ? String(description).trim() : '', taskStatus, assigneeId);
      const msg = check.member
        ? `created "${title.trim()}" and assigned it to ${check.member.display_name}`
        : `created "${title.trim()}"`;
      activity.record(req.user, projectId, info.lastInsertRowid, 'task.created', msg);
      return getTask.get(info.lastInsertRowid);
    });
    const task = create();
    live.broadcast('task.changed', { action: 'created', task }, task.assignee_id);
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

// PUT /api/tasks/:id
// Manager: may change title, description, status, assigneeId.
// Member: may change only the status of a task assigned to them.
// Optional expectedVersion: if it does not match, 409 with the current task (no lost updates).
router.put('/tasks/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body || {};
    const { title, description, status, expectedVersion } = body;
    if (!id) return res.status(400).json({ error: 'Task id must be a positive integer.' });

    const existing = getTask.get(id);
    if (!existing) return res.status(404).json({ error: `Task ${id} not found.` });

    const isManager = req.user.role === 'manager';
    if (!isManager) {
      if (existing.assignee_id !== req.user.id) {
        return res.status(403).json({ error: 'This task is not assigned to you.' });
      }
      const extra = ['title', 'description', 'assigneeId'].filter((k) => body[k] !== undefined);
      if (extra.length) {
        return res.status(403).json({ error: `Members can only change the status (not ${extra.join(', ')}).` });
      }
    }
    if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
      return res.status(400).json({ error: 'Field "title" must be a non-empty string when provided.' });
    }
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Field "status" must be one of: ${VALID_STATUSES.join(', ')}.` });
    }
    if (expectedVersion !== undefined && !Number.isInteger(expectedVersion)) {
      return res.status(400).json({ error: 'Field "expectedVersion" must be an integer.' });
    }

    let assigneeId = existing.assignee_id;
    let member = null;
    if (body.assigneeId !== undefined) {
      const check = await checkAssignee(body.assigneeId);
      if (!check.ok) return res.status(check.status).json({ error: check.error });
      assigneeId = body.assigneeId;
      member = check.member;
    }

    const update = db.transaction(() => {
      // Re-read inside the transaction so the version check and the write are atomic.
      const current = getTask.get(id);
      if (!current) return { notFound: true };
      if (expectedVersion !== undefined && expectedVersion !== current.version) {
        return { conflict: current };
      }
      const next = {
        title: title !== undefined ? title.trim() : current.title,
        description: description !== undefined ? String(description).trim() : current.description,
        status: status !== undefined ? status : current.status,
      };
      db.prepare(`
        UPDATE tasks SET title = ?, description = ?, status = ?, assignee_id = ?,
                         version = version + 1, updated_at = datetime('now')
        WHERE id = ?`).run(next.title, next.description, next.status, assigneeId, id);

      const changes = [];
      if (next.status !== current.status) changes.push(`moved "${next.title}" from ${current.status} to ${next.status}`);
      if (assigneeId !== current.assignee_id) {
        changes.push(member ? `assigned "${next.title}" to ${member.display_name}` : `unassigned "${next.title}"`);
      }
      if (next.title !== current.title || next.description !== current.description) {
        changes.push(`edited "${next.title}"`);
      }
      if (changes.length) {
        activity.record(req.user, current.project_id, id, 'task.updated', changes.join('; '));
      }
      return { task: getTask.get(id), previousAssignee: current.assignee_id };
    });

    const result = update();
    if (result.notFound) return res.status(404).json({ error: `Task ${id} not found.` });
    if (result.conflict) {
      return res.status(409).json({
        error: 'This task was changed by someone else. The latest version is included; review it and try again.',
        task: result.conflict,
      });
    }
    live.broadcast('task.changed', { action: 'updated', task: result.task }, result.task.assignee_id);
    if (result.previousAssignee && result.previousAssignee !== result.task.assignee_id) {
      // Tell the previous assignee too, so the task disappears from their list.
      live.broadcast('task.changed', { action: 'updated', task: result.task }, result.previousAssignee);
    }
    res.json(result.task);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tasks/:id - manager only
router.delete('/tasks/:id', requireManager, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Task id must be a positive integer.' });
  const existing = getTask.get(id);
  if (!existing) return res.status(404).json({ error: `Task ${id} not found.` });

  db.transaction(() => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    activity.record(req.user, existing.project_id, null, 'task.deleted', `deleted "${existing.title}"`);
  })();
  live.broadcast('task.changed', { action: 'deleted', task: existing }, existing.assignee_id);
  res.status(204).send();
});

module.exports = router;
