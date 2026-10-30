// web/app.js
// TaskFlow web client. Vanilla JS, no build step (approach retained from the A2 client).
// New in A3: sign-in, role-aware views, a live board fed by a WebSocket,
// automatic reconnection that reloads current state over REST, and version checks
// so an older event never overwrites newer data.
//
// Views (hash routes):
//   #/login          sign in
//   #/projects       project list           (manager)
//   #/board/:id      live project board     (manager)
//   #/activity       activity feed          (manager)
//   #/my             my tasks + check-in    (member)

const API_BASE = '/api';
const STORAGE_KEY = 'taskflow.session';

const state = {
  token: null,
  user: null,
  members: [],
  projectId: null,
  tasks: new Map(), // task id -> task (board view)
  socket: null,
  reconnectDelay: 1000,
  reconnectTimer: null,
  everConnected: false,
};

const $ = (id) => document.getElementById(id);

// ---------- session storage (per tab, so two tabs can sign in as different users) ----------

function saveSession() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: state.token, user: state.user })); } catch (e) { /* storage unavailable */ }
}
function loadSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.token = saved.token;
    state.user = saved.user;
  } catch (e) { /* ignore */ }
}
function clearSession() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  state.token = null;
  state.user = null;
}

// ---------- helpers ----------

class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let res;
  try {
    res = await fetch(API_BASE + path, { ...options, headers });
  } catch (err) {
    throw new ApiError(0, 'Cannot reach the server. Check that the API is running.');
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body && body.error) || `Request failed (HTTP ${res.status})`;
    if (res.status === 401 && state.token && path !== '/login') {
      signOut('Your session has ended. Please sign in again.');
    }
    throw new ApiError(res.status, message, body);
  }
  return body;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// SQLite datetime('now') is UTC without a zone marker.
function fmtTime(sqlTime) {
  if (!sqlTime) return '';
  const d = new Date(sqlTime.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 5000);
}

function setBanner(message) {
  $('banner').textContent = message || '';
  $('banner').hidden = !message;
}

function setStatus(text) { $('status-line').textContent = text; }

function memberName(id) {
  if (!id) return 'Unassigned';
  const m = state.members.find((u) => u.id === id);
  return m ? m.display_name : `User ${id}`;
}

function describeCheckin(c) {
  if (!c) return '';
  const where = c.kind === 'gps'
    ? `${Number(c.latitude).toFixed(4)}, ${Number(c.longitude).toFixed(4)}`
    : `"${c.place}" (typed)`;
  return `Checked in by ${c.user_name} at ${where} · ${fmtTime(c.created_at)}`;
}

// ---------- routing ----------

const VIEWS = ['login', 'projects', 'board', 'mytasks', 'activity'];

function showView(name) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
}

function renderNav() {
  const nav = $('nav');
  if (!state.user) { nav.hidden = true; $('session').hidden = true; return; }
  nav.hidden = false;
  $('session').hidden = false;
  $('whoami').textContent = `${state.user.display_name} (${state.user.role})`;
  nav.innerHTML = state.user.role === 'manager'
    ? '<a href="#/projects" data-view="projects">Projects</a><a href="#/activity" data-view="activity">Activity</a>'
    : '<a href="#/my" data-view="mytasks">My tasks</a>';
}

async function route() {
  const hash = location.hash || '';
  if (!state.user) {
    showView('login');
    return;
  }
  const isManager = state.user.role === 'manager';
  const boardMatch = hash.match(/^#\/board\/(\d+)$/);

  if (isManager && boardMatch) {
    state.projectId = Number(boardMatch[1]);
    showView('board');
    await loadBoard();
  } else if (isManager && hash === '#/activity') {
    state.projectId = null;
    showView('activity');
    await loadActivity();
  } else if (isManager) {
    state.projectId = null;
    if (hash !== '#/projects') history.replaceState(null, '', '#/projects');
    showView('projects');
    await loadProjects();
  } else {
    if (hash !== '#/my') history.replaceState(null, '', '#/my');
    showView('mytasks');
    await loadMyTasks();
  }
}

window.addEventListener('hashchange', route);

// ---------- sign in / out ----------

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  if (!username || !password) return showError($('login-error'), 'Enter a username and password.');
  try {
    const reply = await api('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    state.token = reply.token;
    state.user = reply.user;
    saveSession();
    $('login-password').value = '';
    await afterSignIn();
    location.hash = state.user.role === 'manager' ? '#/projects' : '#/my';
    route();
  } catch (err) {
    showError($('login-error'), err.message);
  }
});

$('logout-btn').addEventListener('click', () => signOut());

function signOut(message) {
  clearSession();
  disconnectLive();
  renderNav();
  setBanner('');
  location.hash = '#/login';
  showView('login');
  if (message) toast(message);
}

async function afterSignIn() {
  renderNav();
  if (state.user.role === 'manager') {
    try { state.members = await api('/users?role=member'); } catch (err) { state.members = []; }
  }
  connectLive();
}

// ---------- projects (manager) ----------

async function loadProjects() {
  try {
    const projects = await api('/projects');
    const list = $('project-list');
    list.innerHTML = '';
    if (projects.length === 0) {
      list.innerHTML = '<li class="empty-hint">No projects yet. Add one above.</li>';
    }
    for (const p of projects) {
      const li = document.createElement('li');
      li.className = 'project-item';
      li.innerHTML = `
        <div>
          <div>${escapeHtml(p.name)}</div>
          <div class="meta">${p.task_count} task(s), ${p.done_count} done${p.description ? ' · ' + escapeHtml(p.description) : ''}</div>
        </div>
        <button class="icon-btn" title="Delete project">✕</button>`;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.icon-btn')) return;
        location.hash = `#/board/${p.id}`;
      });
      li.querySelector('.icon-btn').addEventListener('click', async () => {
        if (!confirm(`Delete project "${p.name}" and all its tasks?`)) return;
        try { await api(`/projects/${p.id}`, { method: 'DELETE' }); loadProjects(); } catch (err) { toast(err.message); }
      });
      list.appendChild(li);
    }
    setStatus(`Connected — ${projects.length} project(s) loaded.`);
  } catch (err) {
    setStatus(err.message);
    if (err.status === 503 || err.status === 0) setBanner(err.message);
  }
}

$('new-project-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('project-name').value;
  if (!name.trim()) return showError($('project-form-error'), 'Enter a project name.');
  try {
    await api('/projects', { method: 'POST', body: JSON.stringify({ name, description: $('project-description').value }) });
    $('project-name').value = '';
    $('project-description').value = '';
    loadProjects();
  } catch (err) {
    showError($('project-form-error'), err.message);
  }
});

// ---------- board (manager, live) ----------

async function loadBoard() {
  const id = state.projectId;
  try {
    const project = await api(`/projects/${id}`);
    if (state.projectId !== id) return; // user navigated away meanwhile
    $('board-title').textContent = project.name;
    state.tasks = new Map(project.tasks.map((t) => [t.id, t]));
    fillAssigneeSelect();
    renderBoard();
    await loadBoardActivity();
    setBanner('');
    setStatus(`Board loaded at ${new Date().toLocaleTimeString()} — ${project.tasks.length} task(s).`);
  } catch (err) {
    if (err.status === 404) { toast(err.message); location.hash = '#/projects'; return; }
    setStatus(err.message);
    if (err.status === 503 || err.status === 0) setBanner(err.message);
  }
}

function fillAssigneeSelect() {
  const sel = $('task-assignee');
  const current = sel.value;
  sel.innerHTML = '<option value="">Unassigned</option>' +
    state.members.map((m) => `<option value="${m.id}">${escapeHtml(m.display_name)}</option>`).join('');
  sel.value = current;
}

function renderBoard(flashId) {
  for (const col of document.querySelectorAll('#board .column')) {
    const status = col.dataset.status;
    const ul = col.querySelector('ul');
    const tasks = [...state.tasks.values()].filter((t) => t.status === status).sort((a, b) => a.id - b.id);
    col.querySelector('.count').textContent = `(${tasks.length})`;
    ul.innerHTML = tasks.length ? '' : '<li class="empty-hint">Nothing here</li>';
    for (const t of tasks) ul.appendChild(renderCard(t, t.id === flashId));
  }
}

function renderCard(t, flash) {
  const li = document.createElement('li');
  li.className = 'card' + (flash ? ' flash' : '');
  li.dataset.id = t.id;
  const memberOptions = state.members.map((m) =>
    `<option value="${m.id}" ${m.id === t.assignee_id ? 'selected' : ''}>${escapeHtml(m.display_name)}</option>`).join('');
  li.innerHTML = `
    <div class="title">${escapeHtml(t.title)}</div>
    ${t.description ? `<div class="meta">${escapeHtml(t.description)}</div>` : ''}
    <div class="row">
      <select data-field="assignee" title="Assignee"><option value="">Unassigned</option>${memberOptions}</select>
      <select data-field="status" title="Status">
        <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To do</option>
        <option value="in-progress" ${t.status === 'in-progress' ? 'selected' : ''}>In progress</option>
        <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
      </select>
      <button class="icon-btn" title="Delete task">✕</button>
    </div>
    ${t.latest_checkin ? `<div class="checkin">📍 ${escapeHtml(describeCheckin(t.latest_checkin))}</div>` : ''}
    <div class="meta">v${t.version}${t.updated_at ? ' · updated ' + fmtTime(t.updated_at) : ''}</div>`;

  li.querySelector('[data-field="status"]').addEventListener('change', (e) =>
    updateTask(t, { status: e.target.value }));
  li.querySelector('[data-field="assignee"]').addEventListener('change', (e) =>
    updateTask(t, { assigneeId: e.target.value ? Number(e.target.value) : null }));
  li.querySelector('.icon-btn').addEventListener('click', async () => {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    try { await api(`/tasks/${t.id}`, { method: 'DELETE' }); } catch (err) { toast(err.message); }
  });
  return li;
}

async function updateTask(t, changes) {
  try {
    const updated = await api(`/tasks/${t.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...changes, expectedVersion: t.version }),
    });
    applyTask(updated);
  } catch (err) {
    if (err.status === 409 && err.body && err.body.task) {
      toast('Someone else changed this task first. Showing the latest version.');
      applyTask(err.body.task);
    } else {
      toast(`Could not update task: ${err.message}`);
      renderBoard();
    }
  }
}

// Apply a task only if it is newer than what we have (events can arrive after a REST reload).
function applyTask(task, flash) {
  const known = state.tasks.get(task.id);
  if (known && task.version < known.version) return false;
  state.tasks.set(task.id, { ...task, latest_checkin: task.latest_checkin !== undefined ? task.latest_checkin : known && known.latest_checkin });
  renderBoard(flash ? task.id : null);
  return true;
}

$('new-task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('task-title').value;
  if (!title.trim()) return showError($('task-form-error'), 'Enter a task title.');
  const assignee = $('task-assignee').value;
  try {
    const task = await api(`/projects/${state.projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title, description: $('task-description').value, assigneeId: assignee ? Number(assignee) : null }),
    });
    $('task-title').value = '';
    $('task-description').value = '';
    applyTask(task);
  } catch (err) {
    showError($('task-form-error'), err.message);
  }
});

async function loadBoardActivity(highlightNewest) {
  if (!state.projectId) return;
  try {
    const items = await api(`/activity?projectId=${state.projectId}&limit=30`);
    renderFeed($('board-activity'), items, highlightNewest, false);
  } catch (err) { /* shown elsewhere */ }
}

// ---------- activity (manager) ----------

async function loadActivity(highlightNewest) {
  try {
    const items = await api('/activity?limit=100');
    renderFeed($('activity-list'), items, highlightNewest, true);
  } catch (err) {
    setStatus(err.message);
  }
}

function renderFeed(el, items, highlightNewest, showProject) {
  el.innerHTML = items.length ? '' : '<li class="empty-hint">No activity yet.</li>';
  items.forEach((a, i) => {
    const li = document.createElement('li');
    if (highlightNewest && i === 0) li.className = 'new';
    li.innerHTML = `<time>${fmtTime(a.created_at)}</time><strong>${escapeHtml(a.actor_name)}</strong> ${escapeHtml(a.message)}` +
      (showProject ? ` <span class="meta">· ${escapeHtml(a.project_name)}</span>` : '');
    el.appendChild(li);
  });
}

// ---------- my tasks (member) ----------

const myTasks = new Map(); // task id -> version currently shown

async function loadMyTasks() {
  const list = $('mytask-list');
  try {
    const tasks = await api('/my/tasks');
    myTasks.clear();
    list.innerHTML = tasks.length ? '' : '<li class="empty-hint">No tasks are assigned to you yet.</li>';
    for (const t of tasks) {
      myTasks.set(t.id, t.version);
      list.appendChild(renderMyTask(t));
    }
    setBanner('');
    setStatus(`Loaded ${tasks.length} task(s) at ${new Date().toLocaleTimeString()}.`);
  } catch (err) {
    setStatus(err.message);
    if (err.status === 503 || err.status === 0) setBanner(`${err.message} Showing the last loaded list.`);
  }
}

function renderMyTask(t) {
  const li = document.createElement('li');
  li.className = 'mytask';
  li.innerHTML = `
    <div><strong>${escapeHtml(t.title)}</strong> <span class="meta">· ${escapeHtml(t.project_name)} · v${t.version}</span></div>
    ${t.description ? `<div class="meta">${escapeHtml(t.description)}</div>` : ''}
    <div class="row">
      <select>
        <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To do</option>
        <option value="in-progress" ${t.status === 'in-progress' ? 'selected' : ''}>In progress</option>
        <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
      </select>
      <button class="primary" data-action="save">Save status</button>
    </div>
    <div class="row">
      <input placeholder="Where are you? (typed check-in)" maxlength="120">
      <button class="primary" data-action="checkin">Check in</button>
    </div>`;
  li.querySelector('[data-action="save"]').addEventListener('click', async () => {
    try {
      const updated = await api(`/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ status: li.querySelector('select').value, expectedVersion: t.version }) });
      toast('Status saved.');
      // Replace just this item, so text typed into other tasks is kept.
      myTasks.set(updated.id, updated.version);
      li.replaceWith(renderMyTask(updated));
    } catch (err) {
      toast(err.status === 409 ? 'The manager changed this task first. Reloaded the latest version.' : err.message);
      loadMyTasks();
    }
  });
  li.querySelector('[data-action="checkin"]').addEventListener('click', async () => {
    const place = li.querySelector('input').value;
    if (!place.trim()) return toast('Type where you are first.');
    try {
      await api(`/tasks/${t.id}/checkins`, { method: 'POST', body: JSON.stringify({ place }) });
      li.querySelector('input').value = '';
      toast('Checked in.');
    } catch (err) { toast(err.message); }
  });
  return li;
}

$('mytasks-refresh').addEventListener('click', loadMyTasks);

// ---------- live updates (WebSocket) ----------

function setBadge(kind, text) {
  const badge = $('live-badge');
  badge.className = `badge ${kind}`;
  badge.textContent = text;
}

function connectLive() {
  if (!state.token) return;
  clearTimeout(state.reconnectTimer);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(state.token)}`);
  state.socket = socket;
  setBadge('connecting', 'connecting');

  socket.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.type === 'hello') {
      const wasReconnect = state.everConnected;
      state.everConnected = true;
      state.reconnectDelay = 1000;
      setBadge('live', 'live');
      if (wasReconnect) {
        // Anything could have changed while we were offline: reload the current view over REST.
        toast('Live updates reconnected. Reloading the latest data.');
        route();
      }
      return;
    }
    handleEvent(msg);
  });

  socket.addEventListener('close', (e) => {
    if (state.socket !== socket) return; // replaced or signed out
    state.socket = null;
    if (e.code === 4001) return signOut('Your session has ended. Please sign in again.');
    setBadge('offline', 'offline');
    const delay = state.reconnectDelay;
    state.reconnectDelay = Math.min(state.reconnectDelay * 2, 10000);
    setStatus(`Live updates disconnected. Retrying in ${Math.round(delay / 1000)} s…`);
    state.reconnectTimer = setTimeout(connectLive, delay);
  });
}

function disconnectLive() {
  clearTimeout(state.reconnectTimer);
  const s = state.socket;
  state.socket = null;
  state.everConnected = false;
  if (s) s.close();
  setBadge('offline', 'offline');
}

function handleEvent(msg) {
  const onBoard = !$('view-board').hidden;
  const onActivity = !$('view-activity').hidden;
  const onMine = !$('view-mytasks').hidden;

  if (msg.type === 'task.changed') {
    const t = msg.task;
    if (onBoard && t.project_id === state.projectId) {
      if (msg.action === 'deleted') {
        state.tasks.delete(t.id);
        renderBoard();
      } else {
        applyTask(t, true);
      }
      loadBoardActivity(true);
    }
    if (onMine) {
      // Skip events for changes this page already shows (e.g. our own save).
      const shown = myTasks.get(t.id);
      const stillMine = t.assignee_id === state.user.id && msg.action !== 'deleted';
      if (!(stillMine && shown !== undefined && shown >= t.version)) loadMyTasks();
      if (msg.action === 'created') toast(`New task assigned to you: ${t.title}`);
    }
  }

  if (msg.type === 'checkin.added') {
    const t = msg.task;
    if (onBoard && t.project_id === state.projectId) {
      const known = state.tasks.get(t.id);
      if (known) {
        known.latest_checkin = msg.checkin;
        renderBoard(t.id);
      }
      loadBoardActivity(true);
    }
  }

  if (onActivity) loadActivity(true);
}

// ---------- start ----------

(async function init() {
  loadSession();
  renderNav();
  if (state.token) {
    try {
      state.user = await api('/me');
      saveSession();
      await afterSignIn();
    } catch (err) {
      if (err.status === 401) clearSession();
      else setBanner(`${err.message}`);
    }
  }
  renderNav();
  route();
  setStatus(state.user ? 'Ready.' : 'Please sign in.');
})();
