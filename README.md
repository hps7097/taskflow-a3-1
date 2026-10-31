# TaskFlow A3: web and Android task tracker with a gRPC identity service

COMP713 Distributed and Mobile Systems, Assessment 3.
Liam Wiggill (ID 23205218), working alone with the teacher's agreement.

- **Repository:** https://github.com/hps7097/taskflow-a3-1)
- **Final version:** taskflow-a3-1
- **Starting point:** Liam Wiggill's Assessment 2 TaskFlow (Express + SQLite + browser client). See [docs/BASELINE.md](docs/BASELINE.md) for what was retained, revised and added.
- **Advanced integration:** Path A (two services and gRPC).
- **Bonus:** WebSocket live updates and a response-time test.

A manager plans work in the web app and assigns tasks to team members. Members work their tasks on an Android phone (or the web): they change the status and check in with their location. The manager's web board updates immediately.

## Architecture

```
Browser (web/) ----\  REST + WebSocket (port 3000)
                    >--> API service ---- gRPC (proto/identity.proto, port 50051) ----> Identity service
Android app -------/     api-service/taskflow.db                                        identity-service/identity.db
                         projects, tasks, checkins, activity                            users, sessions
```

| Component | Folder | Responsibility | Owns |
|---|---|---|---|
| Identity service | `identity-service/` | Passwords, sign-in tokens, user list (gRPC server) | `identity.db`: users, sessions |
| API service | `api-service/` | REST API, roles, projects, tasks, check-ins, activity, WebSocket, serves the web client | `taskflow.db`: projects, tasks, checkins, activity |
| Web client | `web/` | Sign in, projects, live board, my tasks, activity | nothing (calls the API) |
| Android app | `android/` | Sign in, my tasks, status change, location check-in | nothing (calls the API) |
| Contract | `proto/identity.proto` | `Login`, `ValidateToken`, `ListUsers` | |

The API never opens `identity.db`, and there are no foreign keys between the two databases. Every authenticated request makes a `ValidateToken` gRPC call with a 1.5 s deadline. If the identity service is down or slow, the API answers `503 Sign-in service is unavailable` instead of hanging.

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Node.js | 22.13 or newer: 22, 24 or 26 (tested on 22.23 and 26.13) | both backend services, tests, response-time test |
| npm | comes with Node | installing dependencies |
| Chrome, Edge or Firefox | current | web client |
| Android Studio | Koala (2024.1) or newer, with Android SDK 34 | building and running the Android app |
| Android emulator | Pixel 7 image, API 34 | running the app (or a real phone, see below) |

No database server is needed. Both services use SQLite through Node's built-in `node:sqlite` module, so nothing is compiled during `npm install`, and the database files are created on first start.

## Setup and start

```bash
npm install          # installs express, ws, @grpc/grpc-js, @grpc/proto-loader, cors
npm start            # starts the identity service, then the API service, in one terminal
```

Expected output:

```
[identity] Identity service (gRPC) listening on 50051
[api] TaskFlow API listening at http://localhost:3000
```

Open http://localhost:3000 in a browser.

**Optional sample data** (needs the services running): open a second terminal and run `npm run seed`. It adds 2 projects and 4 tasks: three for Sam, one for Priya.

**Separate terminals** (needed to stop one service for the failure checks):

```bash
npm run start:identity   # terminal A
npm run start:api        # terminal B
```

**Start again from empty:** stop both services, then run `npm run reset-db`.

### Android app

1. In Android Studio choose **File > Open** and select the `android` folder (not the repository root).
2. Wait for Gradle sync to finish. The first sync downloads Gradle 8.7 and the Android build tools. If Android Studio offers to install SDK platform 34, accept.
3. Create an emulator if you don't have one: **Tools > Device Manager > +**, Pixel 7, API 34.
4. Make sure the backend is running (`npm start`), then press **Run**.
5. Sign in as `sam` / `member123`.

The app calls `http://10.0.2.2:3000`, which is your computer as seen from the emulator. For a real phone on the same Wi-Fi network:

1. Change `BASE_URL` in `android/app/build.gradle.kts` to your computer's address, for example `http://192.168.1.20:3000`.
2. Add that address as a `<domain>` in `android/app/src/main/res/xml/network_security_config.xml`.

3. there is also an already a completed version of this porcess in the android folderr

## Ports and environment variables

All values have defaults, so nothing needs setting for marking. The full list is in [.env.example](.env.example).

| Variable | Default | Service | Meaning |
|---|---|---|---|
| `PORT` | 3000 | API | HTTP and WebSocket port |
| `IDENTITY_ADDR` | 127.0.0.1:50051 | API | where to reach the identity service |
| `IDENTITY_DEADLINE_MS` | 1500 | API | gRPC deadline for every identity call |
| `API_DB` | api-service/taskflow.db | API | API database file |
| `IDENTITY_PORT` | 50051 | Identity | gRPC port |
| `IDENTITY_DB` | identity-service/identity.db | Identity | identity database file |
| `SESSION_HOURS` | 12 | Identity | token lifetime |
| `IDENTITY_DELAY_MS` | 0 | Identity | artificial delay, used to demonstrate the deadline |

There are no secrets. Passwords are stored as salted scrypt hashes.

## Test accounts

Created automatically the first time the identity service starts:

| Username | Password | Role | Use |
|---|---|---|---|
| `maya` | `manager123` | manager | web: projects, board, assignments, activity |
| `sam` | `member123` | member | Android app (or web "My tasks") |
| `priya` | `member123` | member | second member, to show tasks are private |

## Workflows to try

**Workflow 1: assignment (manager → member)**

1. Web: sign in as maya, add a project and open it.
2. Add a task and choose **Sam Member** as the assignee.
3. Android: sign in as sam (or tap **Refresh**). The task is listed. Priya does not see it.

**Workflow 2: progress and check-in (member → manager, live)**

1. Keep maya's board open in the browser.
2. Android: open the task, choose **In progress** and tap **Save status**. The card moves column on maya's board without a refresh, and the activity feed shows the change.
3. Android: tap **Check in with my location**. The board shows "Checked in by Sam Member at …". If you deny location permission, type a place and tap **Check in with typed place** instead.

To set an emulator location: in the emulator's **…** (More) menu choose **Location**, search for a place, then click **Set location**.

**Failure and recovery**

| Do this | What you should see |
|---|---|
| Stop the API (Ctrl+C in terminal B) | Web badge turns **offline**. Android shows "Cannot reach the server…" and keeps the old list. |
| Start the API again | Web badge returns to **live** and the board reloads the latest data. |
| Stop the identity service (terminal A) | Requests return "Sign-in service is unavailable" within about 1.5 s. http://localhost:3000/api/health shows `degraded`. |
| Start identity again | Everything works again with the same sign-in. |
| `IDENTITY_DELAY_MS=3000 npm run start:identity` | The API gives up after its 1.5 s deadline and answers 503. |

## Tests

```bash
npm test        # 17 automated checks (node:test) against the real services
npm run perf    # response-time test (non-functional requirement)
```

`npm test` starts both services on test ports (50151 and 3101) with temporary databases, so it does not touch your data and can run while `npm start` is running. It covers:

- retained A2 behaviour
- sign-in and roles
- both workflows
- invalid input
- conflicts
- WebSocket events and reconnection
- persistence across a restart
- the identity service being down or slow
- cascade delete

The Android client and live board need hand checks, which are listed in [docs/manual-checks.md](docs/manual-checks.md).

**Response-time requirement:** 95% of authenticated `GET /api/projects` requests finish in under 200 ms. Test conditions: 25 projects, 100 tasks, 10 concurrent clients, 500 requests, and each request includes a gRPC token check. A typical result on a laptop is a median of about 20 ms and a p95 of about 35 ms.

## Project layout

```
proto/identity.proto          gRPC contract (Path A)
identity-service/             gRPC server, users and sessions (identity.db)
api-service/                  Express REST API + WebSocket (taskflow.db)
  routes/                     account, projects, tasks, checkins
  identityClient.js           gRPC client with deadline
  live.js                     WebSocket server and events
web/                          browser client (served by the API)
android/                      Android Studio project (Kotlin)
tests/                        automated checks
scripts/                      start-all, seed, perf, reset-db
docs/                         API reference, baseline, manual checks, AI use
```

API reference: [docs/api.md](docs/api.md).

## Known limitations

- No TLS: HTTP, WebSocket and gRPC are all unencrypted. This is acceptable on one machine for marking, but not for real use.
- The Android app does not receive live updates. It reloads when a screen opens, on pull-to-refresh, or when you tap Refresh.
- Every request depends on the identity service, so an identity outage blocks all signed-in use (by design; see the report).
- No self sign-up or user management screen. The three users are seeded.
- On Android 10 and below the app uses the last known location, which can be stale.
- Retained from A2: no pagination, and tasks cannot be moved between projects.
- The Android app is for members only. Managers use the web app.
