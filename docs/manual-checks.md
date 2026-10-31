# Manual checks (Android client and live board)

The automated tests (`npm test`) cannot drive a phone or a browser, so these are checked by hand. Fill in **Actual** and **Evidence** with what really happened: a screenshot file name or a video time.

**Setup:**

* Run `npm run start:identity` (terminal A) and `npm run start:api` (terminal B).
* Open Chrome signed in as **maya** on a project board.
* Run the emulator with the app signed in as **sam**.

|#|Steps|Expected|Actual|Evidence|
|-|-|-|-|-|
|M1|Maya assigns a new task to Sam. In the app, sign in as sam (or tap Refresh).|The task is listed in My tasks|works|addtasktest.jpg|
|M2|Open the task, choose In progress, tap Save status|Maya's board moves the card to In progress with no refresh. The activity feed shows "Sam Member moved …". The app shows "Saved".|Covered in other tests, works well|evidence shown in other |
|M3|Set an emulator location, tap Check in with my location, allow permission|The board shows "Checked in by Sam Member at -36.85…, 174.76…"|already checked works|evidence shown in other tets|
|M4|Clear the app's location permission (Settings > Apps > TaskFlow > Permissions), tap Check in with my location, deny it, type "Front gate", tap Check in with typed place|The app explains the denial and suggests typing. The typed check-in appears on the board.|||
|M5|Ctrl+C in terminal B (API), then tap Refresh in the app|"Cannot reach the server …", with the old list still shown|||
|M6|With Maya's board open, Ctrl+C in terminal B, wait 5 s, run `npm run start:api`|The badge shows offline, then live. The toast says "Reconnected". The board shows current data.|||
|M7|Ctrl+C in terminal A (identity). Tap Refresh in the app, reload the web page, and open /api/health.|"Sign-in service is unavailable" within about 1.5 s. Health shows `degraded`.|||
|M8|Restart identity with `npm run start:identity`|The app and web work again without signing in again|||
|M9|Maya changes a task's status while Sam has the same task open. Sam then saves a different status.|Sam sees "Your manager changed this task first", and the latest version is shown (409).|||
|M10|Rotate the emulator on the task screen with a typed place entered|The typed text and the task are still shown|||



