// App state: airlines (subjects), flights (tasks), settings, and profile.
// Saved in localStorage; every change goes through commit(), which also tells
// the sync layer (sync.js) that there's something to upload.

import * as D from './dates.js';

const STORAGE_KEY = 'plannerboard:v1';

export const LIVERIES = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#EA580C', '#475569'];

export const LEVELS = { HL: 'Higher Level', SL: 'Standard Level' };

export const TURBULENCE = { 1: 'Smooth', 2: 'Choppy', 3: 'Heavy' };

export const MODES = {
  hardest: { label: 'Hardest first', hint: 'Toughest flights take off while you are fresh.' },
  warmup: { label: 'Warm-up', hint: 'One easy flight to get going, then the hardest, then easier ones.' },
  due: { label: 'Due soonest', hint: 'Closest deadline departs first.' },
};

let state;
const listeners = new Set();

const now = () => Date.now();

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + now().toString(36);
}

function defaults() {
  return {
    version: 2,
    subjects: [],
    tasks: [],
    dayOrder: {},
    settings: { capacity: 5, mode: 'hardest', startTime: '', sound: false, theme: 'auto' },
    profile: { name: '', callsign: '', base: '', year: '', aircraft: '', motto: '', photo: null },
    deleted: {}, // id -> when it was deleted, so deletions sync too
    meta: { settingsAt: 0, profileAt: 0, orderAt: 0 }, // last edit times, for merging
  };
}

// Pilot ranks, earned by departed flights. Stripes match airline epaulettes.
export const RANKS = [
  { min: 0, title: 'Cadet', stripes: 1 },
  { min: 10, title: 'Second Officer', stripes: 2 },
  { min: 50, title: 'First Officer', stripes: 3 },
  { min: 150, title: 'Captain', stripes: 4 },
];

export function rankOf(flights) {
  const i = RANKS.findLastIndex((r) => flights >= r.min);
  return { ...RANKS[i], next: RANKS[i + 1] || null };
}

const SEED_SUBJECTS = [
  { code: 'PHY', name: 'Physics', level: 'HL', gate: 'H1' },
  { code: 'GER', name: 'German B', level: 'HL', gate: 'H2' },
  { code: 'CSC', name: 'Computer Science', level: 'HL', gate: 'H3' },
  { code: 'MAA', name: 'Maths AA', level: 'SL', gate: 'S1' },
  { code: 'ECO', name: 'Economics', level: 'SL', gate: 'S2' },
  { code: 'ENG', name: 'English L&L', level: 'SL', gate: 'S3' },
];

export function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    // Version 1 was the preview build with placeholder classes, so start fresh.
    state = raw && raw.version >= 2 ? { ...defaults(), ...raw } : defaults();
  } catch {
    state = defaults();
  }
  state.settings = { ...defaults().settings, ...state.settings };
  state.profile = { ...defaults().profile, ...state.profile };
  state.deleted = state.deleted || {};
  state.meta = { ...defaults().meta, ...state.meta };
  if (!state.subjects.length) {
    // Fixed ids so a fresh device's airlines match the ones already in the cloud.
    state.subjects = SEED_SUBJECTS.map((s, i) => ({ id: `seed-${s.code.toLowerCase()}`, ...s, color: LIVERIES[i], counter: 100, updatedAt: 0 }));
  }
  rollover();
  persist();
  return state;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Could not save', e);
  }
}

function commit(info = {}) {
  persist();
  listeners.forEach((fn) => fn(info));
}

// Another tab or window of the app saved a change: pick it up instead of
// overwriting it with our older copy next time we save.
export function reloadFromDisk() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || raw.version < 2) return;
    state = {
      ...defaults(),
      ...raw,
      settings: { ...defaults().settings, ...raw.settings },
      profile: { ...defaults().profile, ...raw.profile },
      meta: { ...defaults().meta, ...raw.meta },
      deleted: raw.deleted || {},
    };
    listeners.forEach((fn) => fn({ remote: true }));
  } catch {
    // Half-written or unreadable: keep what we have.
  }
}

export const STORAGE = STORAGE_KEY;

export const subscribe = (fn) => listeners.add(fn);
export const getState = () => state;
export const settings = () => state.settings;

// Unfinished flights from earlier days roll forward to today and count as delayed.
function rollover() {
  const today = D.todayKey();
  let changed = false;
  for (const t of state.tasks) {
    if (!t.done && t.day && t.day < today) {
      t.day = today;
      t.delayed = (t.delayed || 0) + 1;
      t.updatedAt = now();
      changed = true;
    }
  }
  for (const k of Object.keys(state.dayOrder)) {
    if (k < today) delete state.dayOrder[k];
  }
  return changed;
}

export function checkRollover() {
  if (rollover()) commit();
}

/* ---------- Airlines (subjects) ---------- */

export const subjectById = (id) => state.subjects.find((s) => s.id === id);

export function saveSubject({ id, code, name, level, gate, color }) {
  code = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'XXX';
  const fields = { code, name: name.trim() || code, level, gate: gate.trim().toUpperCase().slice(0, 4), color };
  if (id) Object.assign(subjectById(id), fields, { updatedAt: now() });
  else state.subjects.push({ id: uid(), ...fields, counter: 100, updatedAt: now() });
  commit();
}

export const subjectInUse = (id) => state.tasks.some((t) => t.subjectId === id);

export function deleteSubject(id) {
  if (subjectInUse(id)) return false;
  state.subjects = state.subjects.filter((s) => s.id !== id);
  state.deleted[id] = now();
  commit();
  return true;
}

/* ---------- Flights (tasks) ---------- */

export const taskById = (id) => state.tasks.find((t) => t.id === id);

export function flightNo(t) {
  const s = subjectById(t.subjectId);
  return `${s ? s.code : 'XXX'}${t.num}`;
}

export function addTask({ subjectId, title, day, due, difficulty, minutes, notes }) {
  const s = subjectById(subjectId);
  s.counter = (s.counter || 100) + 1;
  s.updatedAt = now();
  const t = {
    id: uid(),
    subjectId,
    num: s.counter,
    title: title.trim(),
    day: day || null,
    due: due || null,
    difficulty: Number(difficulty) || 2,
    minutes: Number(minutes) || null, // block time is optional
    boardingAt: null,
    notes: notes || '',
    checklist: [],
    done: false,
    doneAt: null,
    delayed: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  state.tasks.push(t);
  commit();
  return t;
}

function dropFromOrder(t) {
  const list = t.day && state.dayOrder[t.day];
  if (list) {
    state.dayOrder[t.day] = list.filter((id) => id !== t.id);
    state.meta.orderAt = now();
  }
}

export function updateTask(id, patch) {
  const t = taskById(id);
  if (!t) return;
  if ('day' in patch && patch.day !== t.day) {
    dropFromOrder(t);
    if (!('delayed' in patch)) patch.delayed = 0;
  }
  if ('difficulty' in patch) patch.difficulty = Number(patch.difficulty);
  if ('minutes' in patch) patch.minutes = Number(patch.minutes) || null;
  Object.assign(t, patch, { updatedAt: now() });
  commit();
}

// Push a flight back one day (from today at the earliest).
export function delayTask(id) {
  const t = taskById(id);
  const today = D.todayKey();
  const from = t.day && t.day > today ? t.day : today;
  updateTask(id, { day: D.addDays(from, 1), delayed: (t.delayed || 0) + 1 });
}

// Boarding = you're working on it now. Only one flight boards at a time.
export function startBoarding(id) {
  for (const t of state.tasks) if (t.boardingAt && t.id !== id) t.boardingAt = null;
  const t = taskById(id);
  const today = D.todayKey();
  const patch = { boardingAt: now() };
  if (t.day !== today) patch.day = today;
  updateTask(id, patch);
}

export function stopBoarding(id) {
  updateTask(id, { boardingAt: null });
}

export function toggleDone(id) {
  const t = taskById(id);
  if (t.done) {
    updateTask(id, { done: false, doneAt: null, boardingAt: null });
  } else {
    // Finishing early or from the hangar counts as departing today.
    const today = D.todayKey();
    const day = !t.day || t.day > today ? today : t.day;
    updateTask(id, { done: true, doneAt: now(), boardingAt: null, day, delayed: t.delayed });
  }
}

export function deleteTask(id) {
  const t = taskById(id);
  if (!t) return;
  dropFromOrder(t);
  state.tasks = state.tasks.filter((x) => x.id !== id);
  state.deleted[id] = now();
  commit();
}

export function addCheck(id, text) {
  const t = taskById(id);
  if (!text.trim()) return;
  t.checklist.push({ id: uid(), text: text.trim(), done: false });
  updateTask(id, {});
}

export function toggleCheck(id, cid) {
  const c = taskById(id).checklist.find((c) => c.id === cid);
  c.done = !c.done;
  updateTask(id, {});
}

export function removeCheck(id, cid) {
  const t = taskById(id);
  t.checklist = t.checklist.filter((c) => c.id !== cid);
  updateTask(id, {});
}

/* ---------- Sequencing (auto-dispatch) ---------- */

function autoSort(list, dayKey) {
  const mode = state.settings.mode;
  const dueIn = (t) => (t.due ? D.diffDays(t.due, dayKey) : 999);
  // Anything due by tomorrow jumps the queue, whatever the mode.
  const urgent = (t) => (dueIn(t) <= 1 ? 0 : 1);
  const byHard = (a, b) =>
    urgent(a) - urgent(b) || b.difficulty - a.difficulty || dueIn(a) - dueIn(b) || b.minutes - a.minutes || a.createdAt - b.createdAt;
  const byDue = (a, b) => dueIn(a) - dueIn(b) || b.difficulty - a.difficulty || a.createdAt - b.createdAt;

  const sorted = [...list].sort(mode === 'due' ? byDue : byHard);
  if (mode === 'warmup' && sorted.length >= 3) {
    const easiest = sorted.reduce((e, t) =>
      t.difficulty < e.difficulty || (t.difficulty === e.difficulty && t.minutes < e.minutes) ? t : e,
    );
    if (easiest.difficulty < sorted[0].difficulty) {
      sorted.splice(sorted.indexOf(easiest), 1);
      sorted.unshift(easiest);
    }
  }
  return sorted;
}

// A day's flights: pending in departure order, then departed by time.
export function flightsForDay(dayKey) {
  const all = state.tasks.filter((t) => t.day === dayKey);
  const pending = all.filter((t) => !t.done);
  const manual = state.dayOrder[dayKey];
  let ordered;
  if (manual) {
    const pos = new Map(manual.map((id, i) => [id, i]));
    const known = pending.filter((t) => pos.has(t.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id));
    ordered = [...known, ...autoSort(pending.filter((t) => !pos.has(t.id)), dayKey)];
  } else {
    ordered = autoSort(pending, dayKey);
  }
  // A flight that's boarding always sits at the top.
  const boarding = ordered.find((t) => t.boardingAt);
  if (boarding) ordered = [boarding, ...ordered.filter((t) => t !== boarding)];
  const done = all.filter((t) => t.done).sort((a, b) => a.doneAt - b.doneAt);
  return { pending: ordered, done };
}

export const isManualOrder = (dayKey) => !!state.dayOrder[dayKey];

export function moveInDay(dayKey, id, dir) {
  const ids = flightsForDay(dayKey).pending.map((t) => t.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  state.dayOrder[dayKey] = ids;
  state.meta.orderAt = now();
  commit();
}

// Drag and drop: put a flight on a day, optionally just before another flight.
export function placeTask(id, dayKey, beforeId) {
  const t = taskById(id);
  if (t.done) return;
  if (t.day !== dayKey) {
    dropFromOrder(t);
    Object.assign(t, { day: dayKey, delayed: 0, updatedAt: now() });
  }
  if (dayKey && beforeId && beforeId !== id) {
    const ids = flightsForDay(dayKey).pending.map((x) => x.id).filter((x) => x !== id);
    ids.splice(Math.max(0, ids.indexOf(beforeId)), 0, id);
    state.dayOrder[dayKey] = ids;
    state.meta.orderAt = now();
  }
  commit();
}

export function autoOrderDay(dayKey) {
  delete state.dayOrder[dayKey];
  state.meta.orderAt = now();
  commit();
}

export function hangar() {
  return state.tasks
    .filter((t) => !t.day && !t.done)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt);
}

// Spread hangar flights due soon across this week's open days, before their deadline.
export function autoAssignWeek(weekStart) {
  const today = D.todayKey();
  const days = D.weekDays(weekStart).filter((k) => k >= today);
  if (!days.length) return 0;
  const horizon = D.addDays(days[days.length - 1], 3);
  const cap = state.settings.capacity;
  const load = Object.fromEntries(days.map((k) => [k, state.tasks.filter((t) => t.day === k && !t.done).length]));
  let placed = 0;

  for (const t of hangar()) {
    if (!t.due || t.due > horizon) continue;
    let options = days.filter((k) => k < t.due);
    if (!options.length) options = days.filter((k) => k <= t.due);
    if (!options.length) options = [days[0]]; // already late: today
    const open = options.filter((k) => load[k] < cap);
    if (!open.length) continue;
    const k = open.reduce((a, b) => (load[b] < load[a] ? b : a));
    Object.assign(t, { day: k, updatedAt: now() });
    load[k]++;
    placed++;
  }
  if (placed) commit();
  return placed;
}

/* ---------- Board status ---------- */

// Everything is on time until you start it (boarding) or finish it (departed).
// Flights pushed back a day show as delayed; past their deadline, late.
export function statusOf(t) {
  const today = D.todayKey();
  if (t.done) return { label: 'DEPARTED', tone: 'done' };
  if (t.boardingAt) return { label: 'BOARDING', tone: 'board' };
  if (!t.day) return { label: 'IN HANGAR', tone: 'muted' };
  if (t.due && t.due < today) return { label: 'LATE', tone: 'stop' };
  if (t.delayed) return { label: 'DELAYED', tone: 'warn' };
  return { label: 'ON TIME', tone: 'ok' };
}

// Estimated departure times, if a start time is set.
export function etds(pending, dayKey) {
  const start = state.settings.startTime;
  if (!start) return null;
  const [h, m] = start.split(':').map(Number);
  let t = h * 60 + m;
  if (dayKey === D.todayKey()) t = Math.max(t, Math.ceil(D.nowMinutes() / 5) * 5);
  return pending.map((task) => {
    const v = t;
    t += task.minutes || 30; // unknown block time: assume half an hour
    return v;
  });
}

export function upcomingDeadlines(days = 14) {
  const today = D.todayKey();
  const end = D.addDays(today, days);
  return state.tasks
    .filter((t) => !t.done && t.due && t.due <= end)
    .sort((a, b) => a.due.localeCompare(b.due) || b.difficulty - a.difficulty);
}

export function stats() {
  const today = D.todayKey();
  const ws = D.startOfWeek(today);
  const we = D.addDays(ws, 6);
  const doneDay = (t) => D.keyOf(new Date(t.doneAt));
  const done = state.tasks.filter((t) => t.done && t.doneAt);
  const week = done.filter((t) => doneDay(t) >= ws && doneDay(t) <= we).length;

  const withDue = done.filter((t) => t.due && doneDay(t) >= D.addDays(today, -30));
  const onTime = withDue.length ? Math.round((100 * withDue.filter((t) => doneDay(t) <= t.due).length) / withDue.length) : null;

  const days = new Set(done.map(doneDay));
  let streak = 0;
  let k = days.has(today) ? today : D.addDays(today, -1);
  while (days.has(k)) {
    streak++;
    k = D.addDays(k, -1);
  }
  const minutes = done.reduce((sum, t) => sum + (t.minutes || 0), 0);
  return { week, onTime, streak, total: done.length, hours: Math.round(minutes / 6) / 10 };
}

/* ---------- Settings, backup, demo ---------- */

export const profile = () => state.profile;

export function setProfile(patch) {
  Object.assign(state.profile, patch);
  state.meta.profileAt = now();
  commit();
}

export function setSetting(key, value) {
  state.settings[key] = value;
  state.meta.settingsAt = now();
  commit();
}

export const exportData = () => JSON.stringify(state, null, 2);

export function importData(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.subjects) || !Array.isArray(data.tasks)) throw new Error('Not a PlannerBoard backup');
  state = { ...defaults(), ...data, settings: { ...defaults().settings, ...data.settings }, profile: { ...defaults().profile, ...data.profile } };
  rollover();
  commit();
}

export function resetAll() {
  // Remember what was erased so other synced devices erase it too.
  const deleted = { ...state.deleted };
  for (const x of [...state.tasks, ...state.subjects]) if (!x.id.startsWith('seed-')) deleted[x.id] = now();
  localStorage.removeItem(STORAGE_KEY);
  load();
  state.deleted = deleted;
  state.meta = { settingsAt: now(), profileAt: now(), orderAt: now() };
  commit();
}

export function loadDemo() {
  const today = D.todayKey();
  const d = (n) => D.addDays(today, n);
  const by = (code) => state.subjects.find((s) => s.code === code);
  const demo = [
    ['PHY', 'IA data analysis', d(0), d(1), 3, 60],
    ['GER', 'Vokabeln Kapitel 4', d(0), d(3), 1, 20],
    ['MAA', 'Problem set: integration', d(0), d(2), 3, 45],
    ['ENG', 'Paper 1 practice', d(0), d(6), 2, 45],
    ['ECO', 'Read chapter 8 notes', d(1), d(2), 1, 30],
    ['CSC', 'Pseudocode exercises', d(1), d(5), 2, 30],
    ['PHY', 'Kinematics questions', null, d(4), 2, 45],
    ['ECO', 'IA commentary draft', null, d(11), 3, 90],
    ['MAA', 'Unit test revision', null, d(9), 3, 60],
  ].map(([code, ...rest]) => [by(code), ...rest]);
  for (const [s, title, day, due, difficulty, minutes] of demo) {
    if (s) addTask({ subjectId: s.id, title, day, due, difficulty, minutes });
  }
}

/* ---------- Sync support ---------- */

// Fold another device's copy into ours. Flights and airlines merge one by one
// (newest edit wins, deletions stick); settings, profile and day order come
// from whichever side changed them last.
export function mergeRemote(remote) {
  if (!remote || !Array.isArray(remote.tasks) || !Array.isArray(remote.subjects)) return false;
  const before = JSON.stringify(state);

  const deleted = { ...state.deleted };
  for (const [id, at] of Object.entries(remote.deleted || {})) deleted[id] = Math.max(at, deleted[id] || 0);
  const cutoff = now() - 90 * 86400000;
  for (const [id, at] of Object.entries(deleted)) if (at < cutoff) delete deleted[id];

  const mergeList = (mine, theirs) => {
    const byId = new Map();
    for (const x of [...mine, ...theirs]) {
      const cur = byId.get(x.id);
      if (!cur || (x.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(x.id, x);
    }
    return [...byId.values()].filter((x) => !(deleted[x.id] && deleted[x.id] >= (x.updatedAt || 0)));
  };
  state.deleted = deleted;
  state.tasks = mergeList(state.tasks, remote.tasks);
  state.subjects = mergeList(state.subjects, remote.subjects);

  const rm = { settingsAt: 0, profileAt: 0, orderAt: 0, ...remote.meta };
  if (rm.settingsAt > state.meta.settingsAt) {
    state.settings = { ...state.settings, ...remote.settings };
    state.meta.settingsAt = rm.settingsAt;
  }
  if (rm.profileAt > state.meta.profileAt) {
    state.profile = { ...state.profile, ...remote.profile };
    state.meta.profileAt = rm.profileAt;
  }
  if (rm.orderAt > state.meta.orderAt) {
    state.dayOrder = { ...remote.dayOrder };
    state.meta.orderAt = rm.orderAt;
  }

  dedupeSubjects();
  for (const s of state.subjects) {
    const nums = state.tasks.filter((t) => t.subjectId === s.id).map((t) => t.num || 0);
    s.counter = Math.max(s.counter || 100, ...nums);
  }
  rollover();

  const changed = JSON.stringify(state) !== before;
  if (changed) commit({ remote: true });
  return changed;
}

// Two devices that started separately can each have their own "Physics".
// Keep one airline per code and move the flights over to it.
function dedupeSubjects() {
  const byCode = new Map();
  for (const s of state.subjects) {
    const keep = byCode.get(s.code);
    if (!keep) {
      byCode.set(s.code, s);
      continue;
    }
    const used = (x) => state.tasks.some((t) => t.subjectId === x.id);
    const [winner, loser] =
      used(s) && !used(keep) ? [s, keep] : !used(s) && used(keep) ? [keep, s] : (s.updatedAt || 0) > (keep.updatedAt || 0) ? [s, keep] : [keep, s];
    for (const t of state.tasks) {
      if (t.subjectId === loser.id) Object.assign(t, { subjectId: winner.id, updatedAt: now() });
    }
    state.deleted[loser.id] = now();
    byCode.set(s.code, winner);
  }
  state.subjects = state.subjects.filter((s) => byCode.get(s.code) === s);
}

// A small, ready-to-draw summary of the coming week for the home-screen widgets.
export function widgetSnapshot() {
  const today = D.todayKey();
  const flights = [];
  for (let i = 0; i <= 7; i++) {
    const day = D.addDays(today, i);
    const { pending, done } = flightsForDay(day);
    const add = (t, seq) => {
      const s = subjectById(t.subjectId) || {};
      flights.push({
        code: flightNo(t),
        title: t.title,
        subject: s.name || '',
        color: s.color || '#888888',
        gate: s.gate || '',
        day,
        seq,
        due: t.due,
        minutes: t.minutes,
        difficulty: t.difficulty,
        done: t.done,
        doneAt: t.doneAt,
        boarding: !!t.boardingAt,
        delayed: t.delayed || 0,
      });
    };
    pending.forEach((t, seq) => add(t, seq));
    if (i === 0) done.forEach((t) => add(t, 99));
  }
  const deadlines = upcomingDeadlines(14).map((t) => ({
    code: flightNo(t),
    title: t.title,
    due: t.due,
    color: subjectById(t.subjectId)?.color || '#888888',
    scheduled: !!t.day,
  }));
  return {
    v: 1,
    generatedAt: now(),
    day: today,
    name: state.profile.name,
    capacity: state.settings.capacity,
    theme: state.settings.theme,
    flights,
    deadlines,
  };
}
