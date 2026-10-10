// PlannerBoard widget for Scriptable (free on the App Store).
// Copy this from PlannerBoard → Profile → Sync → "Copy widget script" so the
// three values below come pre-filled, then paste it into a new Scriptable script.
//
// Home Screen: small (next departure), medium (today's board), large (board + deadlines).
// Lock Screen: rectangular (next flight), circular (today's progress), inline (one line).

const SUPABASE_URL = '__SUPABASE_URL__';
const SUPABASE_KEY = '__SUPABASE_KEY__';
const WIDGET_KEY = '__WIDGET_KEY__';
const APP_URL = '__APP_URL__';

const QINGDAO = { lat: 36.0671, lng: 120.3826 };
const CACHE = 'plannerboard-widget.json';

/* ---------- Data ---------- */

async function loadFeed() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.cacheDirectory(), CACHE);
  try {
    const req = new Request(`${SUPABASE_URL}/rest/v1/rpc/widget_feed`);
    req.method = 'POST';
    req.headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
    req.body = JSON.stringify({ key: WIDGET_KEY });
    req.timeoutInterval = 10;
    const feed = await req.loadJSON();
    if (feed && Array.isArray(feed.flights)) {
      fm.writeString(path, JSON.stringify(feed));
      return { feed, offline: false };
    }
    if (feed && feed.message) throw new Error(feed.message);
  } catch (e) {
    // Fall back to the last board we saw.
  }
  if (fm.fileExists(path)) return { feed: JSON.parse(fm.readString(path)), offline: true };
  return { feed: null, offline: true };
}

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const diffDays = (a, b) => Math.round((parseKey(a) - parseKey(b)) / 86400000);
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const boardDate = (k) => {
  const d = parseKey(k);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
};

function dueText(due, today) {
  if (!due) return '';
  const n = diffDays(due, today);
  if (n < 0) return 'Overdue';
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  const d = parseKey(due);
  return `Due ${DOW[d.getDay()][0]}${DOW[d.getDay()].slice(1).toLowerCase()} ${d.getDate()}`;
}

const mins = (m) => (!m ? '' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

// Same rules as the app: on time until you board it, then departed.
function statusOf(f, today) {
  if (f.done) return { label: 'DEPARTED', tone: 'done' };
  if (f.boarding) return { label: 'BOARDING', tone: 'board' };
  if (f.due && f.due < today) return { label: 'LATE', tone: 'stop' };
  if (f.delayed || f.day < today) return { label: 'DELAYED', tone: 'warn' };
  return { label: 'ON TIME', tone: 'ok' };
}

// Today's board from the summary, even if the app hasn't been opened yet today.
function todayBoard(feed, today) {
  const flights = feed.flights || [];
  const carried = flights.filter((f) => !f.done && f.day < today);
  const todays = flights.filter((f) => f.day === today && !f.done).sort((a, b) => a.seq - b.seq);
  let pending = [...carried, ...todays];
  const boarding = pending.find((f) => f.boarding);
  if (boarding) pending = [boarding, ...pending.filter((f) => f !== boarding)];
  const done = feed.day === today ? flights.filter((f) => f.day === today && f.done) : [];
  return { pending, done };
}

/* ---------- Look ---------- */

// Light while the sun is up in Qingdao, dark at night, like the app.
function sunTimes(date) {
  const rad = Math.PI / 180;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const J0 = 0.0009;
  const toDays = (d) => d.valueOf() / 86400000 - 0.5 + J1970 - J2000;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * 86400000);
  const lw = rad * -QINGDAO.lng;
  const phi = rad * QINGDAO.lat;
  const n = Math.round(toDays(date) - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397));
  const transit = (x) => J2000 + x + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const noon = transit(ds);
  const w = Math.acos((Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  const set = transit(J0 + (w + lw) / (2 * Math.PI) + n);
  return { rise: fromJulian(noon - (set - noon)), set: fromJulian(set) };
}

function palette(feed) {
  const now = new Date();
  const { rise, set } = sunTimes(now);
  const pref = feed?.theme || 'auto';
  const dark = pref === 'dark' || (pref === 'auto' && !(now >= rise && now < set));
  const c = (hex, a = 1) => new Color(hex, a);
  return dark
    ? {
        dark, bg: c('#000000'), soft: c('#1c1c1e'), ink: c('#f5f5f7'), ink2: c('#a1a1a6'), ink3: c('#6e6e73'),
        tile: c('#2c2c2e'), tileInk: c('#ffffff'), line: c('#232325'),
        ok: [c('#4cd97b'), c('#30d158', 0.15)], warn: [c('#ffb340'), c('#ff9f0a', 0.16)], stop: [c('#ff6961'), c('#ff453a', 0.16)],
        board: [c('#0a0a0a'), c('#f5f5f7')], done: [c('#6e6e73'), c('#1c1c1e')],
      }
    : {
        dark, bg: c('#ffffff'), soft: c('#f5f5f5'), ink: c('#0a0a0a'), ink2: c('#6b6b6b'), ink3: c('#a3a3a3'),
        tile: c('#0a0a0a'), tileInk: c('#ffffff'), line: c('#ececec'),
        ok: [c('#0f7b4f'), c('#e6f5ee')], warn: [c('#b25b00'), c('#fdf0df')], stop: [c('#d92d20'), c('#fdecea')],
        board: [c('#ffffff'), c('#0a0a0a')], done: [c('#a3a3a3'), c('#f5f5f5')],
      };
}

// When the look should next change: the next sunrise or sunset in Qingdao.
function nextSunChange() {
  const now = new Date();
  const times = [];
  for (const offset of [0, 1]) {
    const { rise, set } = sunTimes(new Date(now.getTime() + offset * 86400000));
    times.push(rise, set);
  }
  return times.filter((t) => t > now).sort((a, b) => a - b)[0];
}

const mono = (size, weight = 'bold') =>
  weight === 'bold' ? Font.boldMonospacedSystemFont(size) : weight === 'semibold' ? Font.semiboldMonospacedSystemFont(size) : Font.mediumMonospacedSystemFont(size);

function text(stack, value, font, color, opts = {}) {
  const t = stack.addText(value);
  t.font = font;
  t.textColor = color;
  t.lineLimit = opts.lines || 1;
  t.minimumScaleFactor = opts.scale || 0.8;
  return t;
}

// Flight code as split-flap tiles with the subject colour on the left.
function tiles(stack, code, P, size = 13, color) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = Math.max(1, Math.round(size / 8));
  const bar = row.addStack();
  bar.size = new Size(3, Math.round(size * 1.45));
  bar.backgroundColor = new Color(color);
  bar.cornerRadius = 1;
  for (const ch of code) {
    const cell = row.addStack();
    cell.size = new Size(Math.round(size * 0.95), Math.round(size * 1.45));
    cell.backgroundColor = P.tile;
    cell.cornerRadius = 3;
    cell.centerAlignContent();
    const t = cell.addText(ch);
    t.font = mono(size);
    t.textColor = P.tileInk;
  }
}

function chip(stack, code, P, color, size = 10) {
  const c = stack.addStack();
  c.backgroundColor = P.tile;
  c.cornerRadius = 4;
  c.setPadding(2, 4, 2, 5);
  c.layoutHorizontally();
  c.centerAlignContent();
  c.spacing = 4;
  const bar = c.addStack();
  bar.size = new Size(2, size + 2);
  bar.backgroundColor = new Color(color);
  text(c, code, mono(size), P.tileInk);
  return c;
}

function pill(stack, status, P, size = 9) {
  const [fg, bg] = P[status.tone];
  const p = stack.addStack();
  p.backgroundColor = bg;
  p.cornerRadius = 4;
  p.setPadding(2, 5, 2, 5);
  text(p, status.label, mono(size), fg, { scale: 0.7 });
  return p;
}

function header(w, title, right, P, size = 15) {
  const h = w.addStack();
  h.layoutHorizontally();
  h.bottomAlignContent();
  text(h, title, Font.boldSystemFont(size), P.ink);
  h.addSpacer();
  text(h, right, mono(9, 'semibold'), P.ink3);
}

function emptyState(w, P, message, sub) {
  w.addSpacer();
  const s = w.addStack();
  s.layoutVertically();
  text(s, message, mono(11), P.ink2, { lines: 2 });
  s.addSpacer(3);
  text(s, sub, Font.systemFont(11), P.ink3, { lines: 2 });
  w.addSpacer();
}

function boardRow(w, f, i, P, today, compact) {
  const r = w.addStack();
  r.layoutHorizontally();
  r.centerAlignContent();
  r.spacing = 8;
  if (f.boarding) {
    r.backgroundColor = P.ink;
    r.cornerRadius = 9;
    r.setPadding(5, 6, 5, 6);
  } else {
    r.setPadding(3, 0, 3, 0);
  }
  const seq = text(r, f.done ? '✓ ' : pad(i + 1), mono(10, 'semibold'), f.boarding ? P.bg : P.ink3);
  seq.textOpacity = f.done ? 0.6 : 1;
  const tileP = f.boarding ? { ...P, tile: P.bg, tileInk: P.ink } : P;
  chip(r, f.code, tileP, f.color, compact ? 9 : 10);
  const mid = r.addStack();
  mid.layoutVertically();
  const t = text(mid, f.title, Font.semiboldSystemFont(compact ? 12 : 13), f.boarding ? P.bg : P.ink);
  if (f.done) t.textOpacity = 0.4;
  if (!compact) {
    const sub = [f.subject, mins(f.minutes)].filter(Boolean).join(' · ');
    if (sub) text(mid, sub, Font.systemFont(10), f.boarding ? P.bg : P.ink2).textOpacity = f.boarding ? 0.65 : 1;
  }
  r.addSpacer();
  pill(r, statusOf(f, today), f.boarding ? { ...P, board: [P.ink, P.bg] } : P, compact ? 8 : 9);
}

/* ---------- Home Screen widgets ---------- */

function small(w, feed, P, today) {
  const { pending, done } = todayBoard(feed, today);
  const next = pending[0];
  const h = w.addStack();
  h.layoutHorizontally();
  text(h, next?.boarding ? 'NOW BOARDING' : 'NEXT DEPARTURE', mono(9, 'semibold'), P.ink3);
  h.addSpacer();
  if (!next) return emptyState(w, P, done.length ? 'ALL FLIGHTS DEPARTED' : 'NO DEPARTURES TODAY', done.length ? 'Nice flying.' : 'Plan your day in PlannerBoard.');
  w.addSpacer(8);
  tiles(w, next.code, P, 14, next.color);
  w.addSpacer(7);
  text(w, next.title, Font.boldSystemFont(15), P.ink, { lines: 2, scale: 0.75 });
  w.addSpacer(2);
  text(w, [next.subject, next.gate && `Gate ${next.gate}`].filter(Boolean).join(' · '), Font.systemFont(11), P.ink2);
  w.addSpacer();
  const f = w.addStack();
  f.layoutHorizontally();
  f.centerAlignContent();
  pill(f, statusOf(next, today), P);
  f.addSpacer();
  const left = pending.length - 1;
  text(f, left > 0 ? `+${left} more` : dueText(next.due, today), Font.mediumSystemFont(10), P.ink2);
}

function medium(w, feed, P, today) {
  const { pending, done } = todayBoard(feed, today);
  header(w, 'Departures', `${boardDate(today)} · ${pending.length} LEFT`, P);
  w.addSpacer(6);
  const rows = [...pending, ...done].slice(0, 3);
  if (!rows.length) return emptyState(w, P, 'NO DEPARTURES TODAY', 'Plan your day in PlannerBoard.');
  rows.forEach((f, i) => boardRow(w, f, i, P, today, false));
  w.addSpacer();
}

function large(w, feed, P, today) {
  const { pending, done } = todayBoard(feed, today);
  header(w, 'Departures', `${boardDate(today)} · ${pending.length} LEFT`, P, 17);
  w.addSpacer(8);
  const rows = [...pending, ...done].slice(0, 5);
  if (!rows.length) {
    const s = w.addStack();
    s.setPadding(6, 0, 6, 0);
    text(s, done.length ? 'ALL FLIGHTS DEPARTED' : 'NO DEPARTURES TODAY', mono(11), P.ink2);
  }
  rows.forEach((f, i) => boardRow(w, f, i, P, today, false));
  if (pending.length + done.length > rows.length) {
    text(w, `+${pending.length + done.length - rows.length} more today`, Font.mediumSystemFont(10), P.ink3);
  }

  // Tomorrow at a glance, like the Weekly view.
  const next = parseKey(today);
  next.setDate(next.getDate() + 1);
  const tomorrow = (feed.flights || []).filter((f) => f.day === keyOf(next) && !f.done).sort((a, b) => a.seq - b.seq);
  if (tomorrow.length) {
    w.addSpacer(10);
    const t = w.addStack();
    t.layoutHorizontally();
    t.centerAlignContent();
    t.spacing = 5;
    text(t, 'TOMORROW', mono(9, 'semibold'), P.ink3);
    t.addSpacer(2);
    tomorrow.slice(0, 4).forEach((f) => chip(t, f.code, P, f.color, 9));
    if (tomorrow.length > 4) text(t, `+${tomorrow.length - 4}`, Font.mediumSystemFont(10), P.ink3);
  }
  w.addSpacer();

  const line = w.addStack();
  line.size = new Size(0, 1);
  line.backgroundColor = P.line;
  w.addSpacer(8);
  text(w, 'UPCOMING DEADLINES', mono(9, 'semibold'), P.ink3);
  w.addSpacer(5);
  const list = (feed.deadlines || []).filter((d) => d.due >= today).slice(0, 4);
  if (!list.length) text(w, 'Nothing due in the next two weeks.', Font.systemFont(12), P.ink2);
  for (const d of list) {
    const r = w.addStack();
    r.layoutHorizontally();
    r.centerAlignContent();
    r.spacing = 8;
    r.setPadding(2, 0, 2, 0);
    chip(r, d.code, P, d.color, 9);
    text(r, d.title, Font.mediumSystemFont(12), P.ink);
    r.addSpacer();
    const n = diffDays(d.due, today);
    const when = text(r, n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : boardDate(d.due).slice(0, 6), Font.semiboldSystemFont(11), n <= 1 ? P.warn[0] : P.ink2);
    when.rightAlignText();
  }
}

/* ---------- Lock Screen widgets ---------- */

function rectangular(w, feed, today) {
  const { pending, done } = todayBoard(feed, today);
  const next = pending[0];
  if (!next) {
    text(w, '✈︎ PlannerBoard', Font.boldSystemFont(13), Color.white());
    text(w, done.length ? 'All flights departed' : 'No departures today', Font.systemFont(12), Color.white());
    return;
  }
  text(w, `✈︎ ${next.code} · ${statusOf(next, today).label}`, Font.boldMonospacedSystemFont(12), Color.white());
  text(w, next.title, Font.semiboldSystemFont(13), Color.white(), { lines: 1 });
  const bits = [pending.length > 1 ? `${pending.length - 1} more today` : 'Last flight today', dueText(next.due, today)].filter(Boolean);
  text(w, bits.join(' · '), Font.systemFont(11), Color.white()).textOpacity = 0.7;
}

function circular(w, feed, today) {
  const { pending, done } = todayBoard(feed, today);
  const total = pending.length + done.length;
  const frac = total ? done.length / total : 0;
  const dc = new DrawContext();
  dc.size = new Size(120, 120);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const c = 60;
  const r = 50;
  dc.setStrokeColor(new Color('#ffffff', 0.25));
  dc.setLineWidth(10);
  dc.strokeEllipse(new Rect(c - r, c - r, r * 2, r * 2));
  if (frac > 0) {
    const p = new Path();
    const steps = Math.max(2, Math.round(80 * frac));
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * frac * i) / steps;
      const pt = new Point(c + r * Math.cos(a), c + r * Math.sin(a));
      if (i === 0) p.move(pt);
      else p.addLine(pt);
    }
    dc.addPath(p);
    dc.setStrokeColor(Color.white());
    dc.setLineWidth(10);
    dc.strokePath();
  }
  dc.setTextAlignedCenter();
  dc.setFont(Font.boldRoundedSystemFont(40));
  dc.setTextColor(Color.white());
  dc.drawTextInRect(String(pending.length), new Rect(0, 24, 120, 50));
  dc.setFont(Font.semiboldSystemFont(14));
  dc.drawTextInRect('LEFT', new Rect(0, 72, 120, 20));
  const img = w.addImage(dc.getImage());
  img.centerAlignImage();
}

function inline(w, feed, today) {
  const { pending, done } = todayBoard(feed, today);
  const next = pending[0];
  const line = next ? `✈︎ ${next.code} ${next.title} · ${pending.length} left` : done.length ? '✈︎ All flights departed' : '✈︎ No departures today';
  text(w, line, Font.systemFont(12), Color.white());
}

/* ---------- Build ---------- */

async function build(family) {
  const { feed, offline } = await loadFeed();
  const today = keyOf(new Date());
  const P = palette(feed);
  const w = new ListWidget();
  w.url = APP_URL;

  const lock = family.startsWith('accessory');
  if (lock) {
    w.setPadding(0, 0, 0, 0);
  } else {
    w.backgroundColor = P.bg;
    w.setPadding(14, 14, 14, 14);
  }

  if (!feed) {
    const msg = WIDGET_KEY.startsWith('__') ? 'Copy the widget script from PlannerBoard → Profile → Sync.' : 'Couldn’t reach PlannerBoard. Check your connection.';
    if (lock) text(w, '✈︎ PlannerBoard', Font.boldSystemFont(12), Color.white());
    else emptyState(w, P, 'PLANNERBOARD', msg);
    return w;
  }

  if (family === 'small') small(w, feed, P, today);
  else if (family === 'large' || family === 'extraLarge') large(w, feed, P, today);
  else if (family === 'accessoryRectangular') rectangular(w, feed, today);
  else if (family === 'accessoryCircular') circular(w, feed, today);
  else if (family === 'accessoryInline') inline(w, feed, today);
  else medium(w, feed, P, today);

  if (offline && !lock) {
    w.addSpacer(2);
    text(w, 'Offline · showing last update', Font.systemFont(8), P.ink3);
  }

  // Refresh every 15 minutes, and right at sunrise or sunset so the look switches on time.
  const soon = new Date(Date.now() + 15 * 60000);
  const sun = nextSunChange();
  w.refreshAfterDate = sun && sun < soon ? sun : soon;
  return w;
}

if (config.runsInWidget) {
  Script.setWidget(await build(config.widgetFamily || 'medium'));
} else {
  // Running inside Scriptable: preview each size.
  const pick = new Alert();
  pick.title = 'Preview PlannerBoard widget';
  ['Small', 'Medium', 'Large', 'Lock Screen: rectangular', 'Lock Screen: circular', 'Lock Screen: inline'].forEach((o) => pick.addAction(o));
  pick.addCancelAction('Done');
  const i = await pick.presentSheet();
  const fams = ['small', 'medium', 'large', 'accessoryRectangular', 'accessoryCircular', 'accessoryInline'];
  if (i >= 0) {
    const w = await build(fams[i]);
    if (i === 0) await w.presentSmall();
    else if (i === 2) await w.presentLarge();
    else if (i === 3) await w.presentAccessoryRectangular();
    else if (i === 4) await w.presentAccessoryCircular();
    else if (i === 5) await w.presentAccessoryInline();
    else await w.presentMedium();
  }
}
Script.complete();
