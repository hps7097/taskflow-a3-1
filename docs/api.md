# TaskFlow API reference

Base URL: `http://localhost:3000`. JSON bodies use `Content-Type: application/json`. Errors are always `{ "error": "message" }` (format retained from A2).

Every route except `POST /api/login` and `GET /api/health` needs `Authorization: Bearer <token>`. The API checks the token with the identity service over gRPC on each request.

| Status | Meaning |
|---|---|
| 400 | invalid input, bad id, or malformed JSON |
| 401 | no token, or the token is invalid or expired |
| 403 | wrong role, or the task isn't assigned to you |
| 404 | not found |
| 409 | version conflict (the body includes the current `task`) |
| 503 | identity service unavailable or past its deadline |

## REST operations

| Method | Path | Who | Description | A2? |
|---|---|---|---|---|
| GET | `/api/health` | anyone | API status plus identity status (`ok` or `degraded`, 200 or 503) | revised |
| POST | `/api/login` | anyone | `{username, password}` → `{token, user}` | new |
| GET | `/api/me` | signed in | current user | new |
| GET | `/api/users?role=member` | manager | users from the identity service (for the assignee list) | new |
| GET | `/api/projects` | signed in | projects with `task_count`, `done_count` | retained |
| POST | `/api/projects` | manager | `{name, description}` | retained, now manager-only |
| GET | `/api/projects/:id` | signed in | project with `tasks[]`, each with `latest_checkin` | revised |
| PUT | `/api/projects/:id` | manager | update name or description | retained |
| DELETE | `/api/projects/:id` | manager | cascades to tasks, check-ins and activity | retained |
| GET | `/api/projects/:id/tasks` | signed in | tasks in a project | retained |
| POST | `/api/projects/:id/tasks` | manager | `{title, description?, status?, assigneeId?}` | revised |
| GET | `/api/my/tasks` | signed in | tasks assigned to me, with `project_name` | new |
| GET | `/api/tasks/:id` | manager, or the assignee | task with its last 20 `checkins` | new |
| PUT | `/api/tasks/:id` | manager: all fields; assignee: `status` only | `{title?, description?, status?, assigneeId?, expectedVersion?}` | revised |
| DELETE | `/api/tasks/:id` | manager | delete a task | retained |
| POST | `/api/tasks/:id/checkins` | assignee | `{latitude, longitude, accuracy?}` or `{place}` | new |
| GET | `/api/tasks/:id/checkins` | manager, or the assignee | check-ins, newest first | new |
| GET | `/api/activity?projectId=&limit=` | manager | activity log, newest first | new |

**Concurrency.** Every task has a `version`, which goes up by 1 on each change. If `expectedVersion` is sent and doesn't match, nothing is changed and the reply is `409` with the current task.

## WebSocket

Connect to `ws://localhost:3000/ws?token=<token>`.

- **On connect:** the server sends `{type:"hello", user}`. An invalid token closes the socket with code 4001. If identity is unavailable, it closes with code 1011.
- **Heartbeat:** the server pings every 15 s and drops sockets that don't answer.
- **Who gets events:** managers receive every event. Members receive events for their own tasks.

| Event | Payload | Sent when |
|---|---|---|
| `task.changed` | `{action: "created" \| "updated" \| "deleted", task}` | a task is created, updated, reassigned or deleted |
| `checkin.added` | `{checkin, task}` | a member checks in |

**Reconnection (web client):**

1. The client retries with backoff: 1 s, 2 s, 4 s, up to 10 s.
2. After `hello` it reloads the current view over REST.
3. It ignores any `task.changed` whose `task.version` is lower than the version it already shows.

## gRPC (proto/identity.proto)

| RPC | Caller | Purpose |
|---|---|---|
| `Login(username, password) → {ok, token, user, error}` | `POST /api/login` | check the password and create a session |
| `ValidateToken(token) → {valid, user}` | every authenticated request, and the WebSocket connect | token → user and role |
| `ListUsers(role) → {users}` | assignee validation, `/api/users`, health | the member list |

How the API calls identity:

- Each call has a 1.5 s deadline and uses `waitForReady`.
- The channel's reconnect backoff is capped at 2 s, so the API recovers within about 2 s of identity restarting.
- A failure becomes `IdentityUnavailableError`, which the API turns into HTTP 503.
