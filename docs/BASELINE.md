# Assessment 2 baseline and what changed

**Selected A2 project:** TaskFlow by Liam Wiggill (ID 23205218), COMP713 Individual Project, Option A.
**Baseline version:** [A2 repository URL and final A2 commit hash].

**What the baseline was:**

- one Express server (`server/`) with SQLite tables `projects` and `tasks`
- a vanilla-JS browser client (`cilent/`)
- no users and no live updates

## Retained (moved, behaviour kept)

| A2 file | A3 file | Kept |
|---|---|---|
| `server/schema.sql` | `api-service/schema.sql` | `projects` and `tasks` tables, status CHECK, cascade delete |
| `server/db.js` | `api-service/db.js` | synchronous SQLite access, schema on start, foreign keys on |
| `server/routes/projects.js` | `api-service/routes/projects.js` | project CRUD, validation messages, 400/404 handling |
| `server/routes/tasks.js` | `api-service/routes/tasks.js` | task list/create/update/delete, status validation |
| `server/server.js` | `api-service/server.js` | Express app, static client, 404 and 500 handlers |
| `cilent/style.css` | `web/style.css` | palette, panels, list styles |
| `cilent/app.js` | `web/app.js` | `api()` fetch helper, `escapeHtml`, project list rendering approach |

## Revised

| Area | Change |
|---|---|
| Tasks table | Added `assignee_id`, `version` and `updated_at`. `db.js` upgrades an existing A2 database by adding the columns. |
| Projects and tasks routes | Sign-in is required, and create/update/delete are manager-only. Members may change only the status of their own tasks. Ids must be positive integers. |
| `PUT /api/tasks/:id` | Optional `expectedVersion`, with a 409 conflict reply. The update runs in a transaction with the activity entry. |
| Database library | A2 used `better-sqlite3`. It failed to build on Node 26 (no prebuilt binary, and its C++ code doesn't compile against Node 26's V8), so A3 uses Node's built-in `node:sqlite` with a small `transaction()` helper. The SQL and queries are unchanged. |
| Server | Malformed JSON gives 400 (A2 gave 500). Identity failures give 503. Health reports the identity status. |
| Static client path | A2's server served `../client` but the folder was named `cilent`, so the page did not load from the server. The client now lives in `web/` and the path is correct. |
| Web client | Role-aware, with 5 views (A2 had one page). |

## Added in A3

| Area | Files |
|---|---|
| gRPC contract | `proto/identity.proto` |
| Identity service (users, sessions, password hashing) | `identity-service/` |
| gRPC client with deadline and fast reconnect | `api-service/identityClient.js` |
| Auth middleware and roles | `api-service/auth.js` |
| Check-ins (GPS or typed place) | `api-service/routes/checkins.js`, `checkins` table |
| Activity log | `api-service/activity.js`, `activity` table, `GET /api/activity` |
| Login, me, users | `api-service/routes/account.js` |
| WebSocket live updates | `api-service/live.js` |
| Web: login, live board, my tasks, activity, reconnection | `web/` |
| Android app (3 screens, location with manual fallback) | `android/` |
| Automated tests, response-time test, seed, start script | `tests/`, `scripts/` |
