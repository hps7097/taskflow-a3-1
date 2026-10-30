# AI use declaration

> Edit this so it describes exactly what you did. The marker can ask you about it.

**Tool:** Claude (Anthropic), used in October 2026.

**What it was used for:**

- Drafting code for the identity service, the gRPC client, the A3 API routes, the WebSocket module, the web client views, the Android app and the automated tests.
- Explaining errors and suggesting fixes.
- Drafting documentation.

**What it was not used for:** choosing the project or the A2 baseline (my own A2 work), or running the system and recording results.

**How I reviewed and tested AI-generated code:**

- I read each file before committing it and changed [list anything you changed].
- I ran `npm test` (17 checks) and `npm run perf` on my own computer. The results are in the report.
- I built and ran the Android app in Android Studio and did manual checks M1 to M10 (docs/manual-checks.md), recording what actually happened.
- Problems found while testing, and how they were fixed:
  - The gRPC client did not recover after the identity service restarted (default reconnect backoff). This was fixed with `waitForReady` and a shorter backoff, and is covered by test 16.
  - On the web "My tasks" view, a live event reloaded the list and wiped text the member had typed. This was fixed by updating only the changed item.
  - [add the Android problems you hit]
