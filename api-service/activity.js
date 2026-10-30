// api-service/activity.js
// Writes to the activity log. Called inside the same transaction as the change it describes.

const db = require('./db');

const insert = db.prepare(
  'INSERT INTO activity (project_id, task_id, actor_id, actor_name, type, message) VALUES (?, ?, ?, ?, ?, ?)'
);

function record(user, projectId, taskId, type, message) {
  insert.run(projectId, taskId, user.id, user.display_name, type, message);
}

module.exports = { record };
