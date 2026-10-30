-- API service schema. Owned only by the API service (taskflow.db).
-- projects and tasks are retained from Assessment 2; tasks gained assignee_id, version and updated_at.
-- checkins and activity are new in Assessment 3.
-- User ids (assignee_id, user_id, actor_id) refer to users in the identity service. There are
-- deliberately no foreign keys to them: users belong to another service and are reached over gRPC.

CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in-progress', 'done')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    assignee_id INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checkins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    user_name   TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('gps', 'manual')),
    latitude    REAL,
    longitude   REAL,
    accuracy_m  REAL,
    place       TEXT,
    note        TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL,
    task_id     INTEGER,
    actor_id    INTEGER NOT NULL,
    actor_name  TEXT NOT NULL,
    type        TEXT NOT NULL,
    message     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_checkins_task ON checkins(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, id);
