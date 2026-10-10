import * as S from './store.js';
import * as D from './dates.js';
import { flapHTML, hydrate, forget, setSound } from './flap.js';
import { icon } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const view = $('#view');
const sheet = $('#sheet');

const ui = {
  route: 'daily',
  clock: {},
  openDay: null,
  today: D.todayKey(),
  minute: '',
  sheet: null,
};

const ROUTES = {
  daily: { label: 'Daily', icon: 'takeoff', render: daily },
  weekly: { label: 'Weekly', icon: 'week', render: weekly },
  profile: { label: 'Profile', icon: 'user', render: profile },
};

/* ---------- Small helpers ---------- */

const subj = (t) => S.subjectById(t.subjectId) || { code: 'XXX', name: 'Unknown', color: '#888', gate: '' };
const mins = (m) => (!m ? '—' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

function dueText(k, short = false) {
  if (!k) return '';
  const n = D.diffDays(k, D.todayKey());
  if (n < 0) return 'Overdue';
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  return short ? `Due ${D.dow(k)[0]}${D.dow(k).slice(1).toLowerCase()} ${D.dayNum(k)}` : `Due ${D.shortDate(k)}`;
}

function since(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const nowText = () => {
  const d = new Date();
  return `${D.pad(d.getHours())}:${D.pad(d.getMinutes())}`;
};
const clockOf = (ms) => {
  const d = new Date(ms);
  return D.clock(d.getHours() * 60 + d.getMinutes());
};

const dots = (n) =>
  `<span class="turb" title="${S.TURBULENCE[n]} turbulence">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

let toastTimer;
function toast(msg, ic = 'check') {
  const el = $('#toast');
  el.innerHTML = `<span class="toast-ic">${icon(ic)}</span><span>${esc(msg)}</span>`;
  // Restart the entrance even if a toast is already showing.
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// Play a dialog's exit animation, then close it.
function closeAnimated(d) {
  return new Promise((resolve) => {
    if (!d.open) return resolve();
    d.classList.add('closing');
    const finish = () => {
      clearTimeout(timer);
      d.removeEventListener('animationend', onEnd);
      if (d.classList.contains('closing')) {
        d.classList.remove('closing');
        d.close();
      }
      resolve();
    };
    const onEnd = (e) => e.target === d && finish();
    const timer = setTimeout(finish, 360);
    d.addEventListener('animationend', onEnd);
  });
}

// In-app replacement for confirm() and alert(), which some browsers and
// home-screen apps silently block.
function ask({ title, message = '', confirm = 'OK', cancel = 'Cancel', danger = false }) {
  const d = $('#ask');
  d.innerHTML = `
    <div class="ask-inner">
      <h3>${esc(title)}</h3>
      ${message ? `<p>${esc(message)}</p>` : ''}
      <div class="ask-actions">
        ${cancel ? `<button class="btn" value="no">${esc(cancel)}</button>` : ''}
        <button class="btn primary ${danger ? 'destructive' : ''}" value="yes">${esc(confirm)}</button>
      </div>
    </div>`;
  return new Promise((resolve) => {
    const done = (yes) => closeAnimated(d).then(() => resolve(yes));
    d.onclick = (e) => {
      const b = e.target.closest('button');
      if (b) done(b.value === 'yes');
      else if (e.target === d) done(false);
    };
    d.oncancel = (e) => {
      e.preventDefault();
      done(false);
    };
    d.showModal();
    $('.primary', d).focus();
  });
}

const tell = (title, message) => ask({ title, message, cancel: null });

/* ---------- Shell ---------- */

function renderNav() {
  $('#tabs').innerHTML =
    '<span class="tab-pill" aria-hidden="true"></span>' +
    Object.entries(ROUTES)
      .map(([k, r]) => `<a href="#/${k}" data-nav="${k}">${icon(r.icon)}<span>${r.label}</span></a>`)
      .join('');
}

// Slide the glass pill under the active tab, stretching a little mid-way like a droplet.
function movePill(animate = true) {
  const pill = $('.tab-pill');
  const a = $(`[data-nav="${ui.route}"]`);
  if (!pill || !a) return;
  const to = { x: a.offsetLeft, w: a.offsetWidth, h: a.offsetHeight, y: a.offsetTop };
  const from = pill.dataset.x ? { x: +pill.dataset.x, w: +pill.dataset.w } : null;
  Object.assign(pill.style, { width: `${to.w}px`, height: `${to.h}px`, top: `${to.y}px`, transform: `translateX(${to.x}px)` });
  pill.dataset.x = to.x;
  pill.dataset.w = to.w;
  if (!animate || !from || from.x === to.x || reduceMotion.matches) return;
  const mid = (from.x + to.x) / 2;
  pill.animate(
    [
      { transform: `translateX(${from.x}px)`, width: `${from.w}px` },
      { transform: `translateX(${mid - Math.abs(to.x - from.x) * 0.1}px) scaleY(0.88)`, width: `${(from.w + to.w) / 2 + Math.abs(to.x - from.x) * 0.2}px`, offset: 0.45 },
      { transform: `translateX(${to.x}px)`, width: `${to.w}px` },
    ],
    { duration: 520, easing: 'cubic-bezier(0.3, 1.25, 0.5, 1)' },
  );
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function render({ fresh = false } = {}) {
  if (fresh) forget();
  view.innerHTML = ROUTES[ui.route].render();
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === ui.route));
  hydrate(view, { animateNew: true });
  flipClockTiles();
  if (fresh) {
    // Ease the new screen in.
    view.classList.remove('enter');
    void view.offsetWidth;
    view.classList.add('enter');
    movePill();
  }
}

function route() {
  const r = location.hash.replace(/^#\/?/, '');
  ui.route = ROUTES[r] ? r : 'daily';
  render({ fresh: true });
  window.scrollTo(0, 0);
}

function tickClock() {
  const txt = nowText();
  if (txt === ui.minute) return;
  ui.minute = txt;
  if (D.todayKey() !== ui.today) {
    ui.today = D.todayKey();
    S.checkRollover();
    render({ fresh: true });
  } else if (ui.route === 'daily') {
    render(); // the clock and estimated times live on the board
  }
}

/* ---------- Daily: the departures board ---------- */

function daily() {
  const today = D.todayKey();
  const { pending, done } = S.flightsForDay(today);
  const times = S.etds(pending, today);
  const rows = [...pending.map((t, i) => boardRow(t, i, times?.[i])), ...done.map((t) => boardRow(t, -1))].join('');
  const block = pending.reduce((sum, t) => sum + (t.minutes || 0), 0);
  const summary = rows
    ? [`${plural(pending.length, 'flight')} to go`, block ? `${mins(block)} block time` : '', done.length ? `${done.length} departed` : '']
        .filter(Boolean)
        .join(' · ')
    : 'Nothing scheduled yet';

  return `
  <header class="dep-head">
    <div>
      <p class="eyebrow">${D.boardDate(today)}</p>
      <h1>Departures</h1>
      <p class="summary">${summary}</p>
    </div>
    ${flipClock()}
  </header>

  <section class="board" aria-label="Today's departures">
    ${
      rows
        ? `<div class="frow fhead" aria-hidden="true"><span>${times ? 'ETD' : 'Seq'}</span><span>Flight</span><span>Destination</span><span>Status</span></div>${rows}`
        : `<div class="board-empty">
            ${flapHTML('No departures today', 'b-empty')}
            <p>Add a flight with + or plan the week ahead.</p>
            <div class="btns">
              <a class="btn" href="#/weekly">${icon('week')}Plan the week</a>
              ${S.getState().tasks.length ? '' : `<button class="btn ghost" data-act="demo">Load demo flights</button>`}
            </div>
          </div>`
    }
  </section>`;
}

function flipClock() {
  const [h, m] = nowText().split(':');
  return `
  <div class="fclock" role="img" aria-label="Time ${h}:${m}">
    <span class="ftile" data-part="h">${flapHTML(h, 'clock-h')}</span>
    <span class="ftile" data-part="m">${flapHTML(m, 'clock-m')}</span>
  </div>`;
}

// Drop the top flap on a clock tile whose number just changed.
function flipClockTiles() {
  view.querySelectorAll('.ftile').forEach((tile) => {
    const { part } = tile.dataset;
    const value = tile.firstElementChild.dataset.text;
    if (ui.clock[part] && ui.clock[part] !== value) tile.classList.add('flip');
    ui.clock[part] = value;
  });
}

function boardRow(t, i, etd) {
  const s = subj(t);
  const st = S.statusOf(t);
  const seq = t.done ? clockOf(t.doneAt) : etd != null ? D.clock(etd) : D.pad(i + 1);
  const sub = [s.name, `Gate ${s.gate || '—'}`, t.minutes ? mins(t.minutes) : ''].filter(Boolean).join(' · ');
  const note = t.boardingAt ? `Started ${since(t.boardingAt)}` : t.done ? '' : dueText(t.due);
  return `
  <button class="frow ${t.done ? 'is-done' : ''} ${t.boardingAt ? 'is-boarding' : ''}" data-act="open" data-id="${t.id}" style="--livery:${s.color};--i:${Math.max(i, 0) + (t.done ? 8 : 0)}">
    <span class="f-seq">${flapHTML(seq, `seq-${t.id}`)}</span>
    <span class="f-code">${flapHTML(S.flightNo(t), `fl-${t.id}`, { tiles: true })}</span>
    <span class="f-main"><span class="f-dest">${esc(t.title)}</span><span class="f-sub">${esc(sub)}</span></span>
    <span class="f-status"><span class="status ${st.tone}">${flapHTML(st.label, `st-${t.id}`)}</span></span>
    <span class="f-note">${note}</span>
  </button>`;
}

/* ---------- Weekly: the next seven days ---------- */

// The whole week fits on one screen: each day shows only its flight numbers.
// Tap a day to open its full list.
function weekly() {
  const today = D.todayKey();
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(today, i));
  if (!days.includes(ui.openDay)) ui.openDay = null;
  return `
  <header class="page-head">
    <div>
      <h1>Weekly</h1>
      <p class="summary">Next 7 days · ${D.shortDate(days[0]).slice(4)} – ${D.shortDate(days[6]).slice(4)}</p>
    </div>
    <button class="btn sm" data-act="auto-week">${icon('wand')}Auto-dispatch</button>
  </header>
  ${hangarStrip(S.hangar())}
  <div class="week">
    ${days.map((k, i) => dayCell(k, today, i)).join('')}
    ${ui.openDay ? dayPanel(ui.openDay, today, days.indexOf(ui.openDay)) : ''}
  </div>
  ${ui.openDay ? '' : '<p class="week-hint">Tap a day to see and arrange its flights.</p>'}`;
}

function meterHTML(used) {
  const cap = S.settings().capacity;
  const dots = Array.from({ length: Math.max(cap, used) }, (_, i) => `<i class="${i < used ? (i < cap ? 'on' : 'over') : ''}"></i>`).join('');
  return `<span class="meter" title="${used} of ${cap} flights">${dots}</span>`;
}

const dayName = (k, today) => (k === today ? 'Today' : D.dow(k)[0] + D.dow(k).slice(1).toLowerCase());

function dayCell(k, today, i) {
  const { pending, done } = S.flightsForDay(k);
  const dues = S.getState().tasks.filter((t) => t.due === k && !t.done).length;
  const open = ui.openDay === k;
  const chips = [...pending, ...done]
    .map(
      (t) =>
        `<span class="wchip ${t.done ? 'is-done' : ''} ${t.boardingAt ? 'is-boarding' : ''}" style="--livery:${subj(t).color}">${S.flightNo(t)}</span>`,
    )
    .join('');
  return `
  <button class="wday ${k === today ? 'is-today' : ''} ${open ? 'is-open' : ''} drop" data-act="open-day" data-day="${k}" style="order:${i * 2}" aria-expanded="${open}">
    <span class="wday-head">
      <span class="wday-dow">${dayName(k, today)}</span><span class="wday-num">${D.dayNum(k)}</span>
      ${meterHTML(pending.length + done.length)}
    </span>
    <span class="wchips">${chips || '<span class="wfree">Free</span>'}</span>
    ${dues ? `<span class="wdue">${icon('flag')}${dues} due</span>` : ''}
  </button>`;
}

function dayPanel(k, today, idx) {
  const { pending, done } = S.flightsForDay(k);
  const dues = S.getState().tasks.filter((t) => t.due === k && !t.done);
  const used = pending.length + done.length;
  return `
  <section class="wpanel drop" data-day="${k}" style="--slot:${idx * 2 + 1}">
    <header class="wpanel-head">
      <div>
        <h2>${D.relDay(k)}</h2>
        <p class="summary">${k === today || D.diffDays(k, today) === 1 ? `${D.shortDate(k)} · ` : ''}${plural(used, 'flight')} of ${S.settings().capacity}</p>
      </div>
      <button class="icon-btn" data-act="open-day" data-day="${k}" aria-label="Close day">${icon('x')}</button>
    </header>
    ${dues.length ? `<div class="wday-dues">${dues.map((t) => `<button class="due-tag" data-act="open" data-id="${t.id}" style="--livery:${subj(t).color}">${icon('flag')}${S.flightNo(t)} due</button>`).join('')}</div>` : ''}
    <div class="wlist">
      ${pending.map((t, i) => weekRow(t, { day: k, i, count: pending.length })).join('')}
      ${done.map((t) => weekRow(t)).join('')}
    </div>
    ${used > S.settings().capacity ? '<p class="warn-text">Runway congested. Divert a flight to a lighter day.</p>' : ''}
    <div class="btns">
      <button class="btn sm" data-act="add" data-day="${k}">${icon('plus')}Add flight</button>
      ${S.isManualOrder(k) ? `<button class="btn sm ghost" data-act="auto-day" data-day="${k}">${icon('wand')}Auto-order</button>` : ''}
    </div>
  </section>`;
}

function hangarStrip(list) {
  return `
  <section class="hangar drop" data-day="">
    <div class="hangar-head">
      ${icon('hangar')}<strong>Hangar</strong><span class="count">${list.length}</span>
      <span class="hangar-hint">${list.length ? 'Tap or drag a flight onto a day' : 'Flights without a day land here'}</span>
      <button class="icon-btn" data-act="add" data-day="" aria-label="Add to hangar">${icon('plus')}</button>
    </div>
    ${
      list.length
        ? `<div class="hangar-list">${list
            .map(
              (t) => `<button class="hchip" draggable="true" data-act="open" data-id="${t.id}" style="--livery:${subj(t).color}">
                <span class="code">${S.flightNo(t)}</span><span class="hchip-title">${esc(t.title)}</span>
                ${t.due ? `<span class="hchip-due">${dueText(t.due, true)}</span>` : ''}
              </button>`,
            )
            .join('')}</div>`
        : ''
    }
  </section>`;
}

function weekRow(t, { day, i = 0, count = 0 } = {}) {
  const s = subj(t);
  const afterDue = !t.done && t.due && t.day && t.day > t.due;
  const reorder =
    day && count > 1
      ? `<span class="reorder">
          <button class="icon-btn xs ${i === 0 ? 'hide' : ''}" data-act="move" data-dir="-1" data-id="${t.id}" data-day="${day}" aria-label="Move earlier">${icon('up')}</button>
          <button class="icon-btn xs ${i === count - 1 ? 'hide' : ''}" data-act="move" data-dir="1" data-id="${t.id}" data-day="${day}" aria-label="Move later">${icon('down')}</button>
        </span>`
      : '';
  return `
  <div class="wrow ${t.done ? 'is-done' : ''} ${t.boardingAt ? 'is-boarding' : ''}" draggable="${!t.done}" data-id="${t.id}" style="--livery:${s.color}">
    <button class="wrow-main" data-act="open" data-id="${t.id}">
      <span class="wrow-top"><span class="code">${S.flightNo(t)}</span>${afterDue ? '<span class="badge stop">After deadline</span>' : ''}</span>
      <span class="wrow-title">${esc(t.title)}</span>
      <span class="wrow-meta">${dots(t.difficulty)}${t.minutes ? ` ${mins(t.minutes)}` : ''}</span>
    </button>
    ${reorder}
  </div>`;
}

/* ---------- Profile: logbook and settings ---------- */

function crewCard(stats) {
  const p = S.profile();
  const rank = S.rankOf(stats.total);
  const pct = rank.next ? Math.round((100 * (stats.total - rank.min)) / (rank.next.min - rank.min)) : 100;
  return `
  <section class="crew">
    <div class="crew-top">
      <span class="kicker">Crew ID</span>
      <button class="btn sm ghost" data-act="edit-profile">${icon('edit')}Edit</button>
    </div>
    <div class="crew-main">
      ${avatarHTML(p)}
      <div class="crew-id">
        <h2>${esc(p.name || 'Your name')}</h2>
        <p>${p.callsign ? `“${esc(p.callsign)}” · ` : ''}${rank.title}</p>
        <span class="stripes" title="${rank.title}">${[0, 1, 2, 3].map((i) => `<i class="${i < rank.stripes ? 'on' : ''}"></i>`).join('')}</span>
      </div>
    </div>
    <dl class="crew-grid">
      <div><dt>Home base</dt><dd class="base">${esc(p.base || '—')}</dd></div>
      <div><dt>Programme</dt><dd>${esc(p.year || '—')}</dd></div>
      <div><dt>Favourite aircraft</dt><dd>${esc(p.aircraft || '—')}</dd></div>
    </dl>
    ${p.motto ? `<p class="motto">“${esc(p.motto)}”</p>` : ''}
    <div class="rank-progress">
      <div class="bar"><i style="width:${pct}%"></i></div>
      <small>${rank.next ? `${plural(rank.next.min - stats.total, 'more flight')} to ${rank.next.title}` : 'Highest rank reached'}</small>
    </div>
    ${p.name ? '' : `<button class="btn primary" data-act="edit-profile">Set up your crew ID</button>`}
  </section>`;
}

function avatarHTML(p, cls = '') {
  const initials = (p.name || '').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
  return `<span class="avatar ${cls}">${p.photo ? `<img src="${p.photo}" alt="">` : initials ? esc(initials) : icon('user')}</span>`;
}

function appearancePanel(st) {
  const T = window.PlannerTheme;
  const { rise, set } = T.sunTimes(new Date());
  const options = { auto: 'Qingdao sun', light: 'Light', dark: 'Dark' };
  return `
    <section class="panel">
      <h2 class="panel-title">Appearance</h2>
      <div class="seg">${Object.entries(options)
        .map(([k, l]) => `<label><input type="radio" name="theme" value="${k}" data-setting="theme" ${st.theme === k ? 'checked' : ''}><span>${l}</span></label>`)
        .join('')}</div>
      <p class="hint sun-hint">${icon('sun')}Light from sunrise ${T.qingdaoTime(rise)} to sunset ${T.qingdaoTime(set)}, Qingdao time. Dark at night.</p>
    </section>`;
}

function profileSheet() {
  const p = S.profile();
  const field = (name, label, placeholder, extra = '') =>
    `<label class="field"><span>${label}</span><input name="${name}" value="${esc(p[name])}" placeholder="${placeholder}" autocomplete="off" ${extra}></label>`;
  return `
  <form class="sheet-inner" data-form="profile">
    <header class="sheet-head">
      <h2>Edit crew ID</h2>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close">${icon('x')}</button>
    </header>
    <div class="avatar-edit">
      <span id="avatarPreview">${avatarHTML(p, 'lg')}</span>
      <div class="btns">
        <label class="btn sm">${icon('upload')}Choose photo<input type="file" id="photoInput" accept="image/*" hidden></label>
        <button type="button" class="btn sm ghost danger" data-act="photo-remove" ${p.photo ? '' : 'hidden'}>Remove</button>
      </div>
    </div>
    ${field('name', 'Name', 'Your name')}
    <div class="two">
      ${field('callsign', 'Callsign', 'Maverick', 'maxlength="20"')}
      ${field('base', 'Home base', 'ZRH', 'maxlength="4" autocapitalize="characters"')}
    </div>
    ${field('year', 'Programme', 'IB DP1 · Class of 2027')}
    ${field('aircraft', 'Favourite aircraft', 'A350-1000')}
    ${field('motto', 'Motto', 'Blue skies', 'maxlength="60"')}
    <footer class="sheet-actions"><button class="btn primary" type="submit">Save</button></footer>
  </form>`;
}

// Square-crop and shrink a photo so it fits comfortably in storage.
async function squarePhoto(file) {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const c = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
  return c.toDataURL('image/jpeg', 0.85);
}

function profile() {
  const st = S.settings();
  const stats = S.stats();
  const subjects = S.getState().subjects;
  const group = (lvl) => subjects.filter((s) => (s.level || 'SL') === lvl);

  return `
  <div class="profile">
    <header class="page-head"><h1>Profile</h1></header>
    ${crewCard(stats)}
    <section class="panel logbook">
      <div class="streak">
        <div class="streak-n">${flapHTML(String(stats.streak).padStart(2, '0'), 'streak', { tiles: true })}</div>
        <div><strong>Day streak</strong><small>Days in a row with at least one departure.</small></div>
      </div>
      <div class="stat-grid">
        <div class="stat"><span class="stat-n">${stats.week}</span><span class="stat-l">Departed this week</span></div>
        <div class="stat"><span class="stat-n">${stats.onTime == null ? '—' : `${stats.onTime}%`}</span><span class="stat-l">On time, last 30 days</span></div>
        <div class="stat"><span class="stat-n">${stats.hours}</span><span class="stat-l">Hours flown</span></div>
        <div class="stat"><span class="stat-n">${stats.total}</span><span class="stat-l">Total flights</span></div>
      </div>
    </section>

    <section class="panel">
      <h2 class="panel-title">Airlines</h2>
      ${Object.entries(S.LEVELS)
        .map(([lvl, name]) =>
          group(lvl).length
            ? `<h3 class="group">${name}</h3>
          <ul class="alist">${group(lvl)
            .map(
              (s) => `<li><button class="arow" data-act="subject" data-id="${s.id}" style="--livery:${s.color}">
                <span class="code">${esc(s.code)}</span><span class="name">${esc(s.name)}</span>
                <span class="muted">Gate ${esc(s.gate || '—')}</span>${icon('right')}
              </button></li>`,
            )
            .join('')}</ul>`
            : '',
        )
        .join('')}
      <button class="btn ghost sm" data-act="subject">${icon('plus')}Add airline</button>
    </section>

    <section class="panel">
      <h2 class="panel-title">Auto-dispatch order</h2>
      <div class="modes">
        ${Object.entries(S.MODES)
          .map(
            ([k, m]) => `<label class="mode">
              <input type="radio" name="mode" value="${k}" data-setting="mode" ${st.mode === k ? 'checked' : ''}>
              <span><strong>${m.label}</strong><small>${m.hint}</small></span>
            </label>`,
          )
          .join('')}
      </div>
      <p class="hint">Whatever you pick, flights due today or tomorrow board first. You can reorder a day by hand on the Weekly screen.</p>
    </section>

    <section class="panel">
      <h2 class="panel-title">Runway</h2>
      <div class="field-row">
        <div><strong>Daily capacity</strong><small>Flights per day, like the lines in a planner.</small></div>
        <div class="stepper">
          <button data-act="cap" data-n="-1" aria-label="Fewer">−</button><span>${st.capacity}</span><button data-act="cap" data-n="1" aria-label="More">+</button>
        </div>
      </div>
      <div class="field-row">
        <div><strong>Homework starts</strong><small>Optional. Shows estimated departure times on the board.</small></div>
        <div class="inline">
          <input type="time" value="${st.startTime}" data-setting="startTime" aria-label="Homework start time">
          ${st.startTime ? `<button class="icon-btn" data-act="clear-start" aria-label="Clear start time">${icon('x')}</button>` : ''}
        </div>
      </div>
      <div class="field-row">
        <div><strong>Flap sound</strong><small>Soft clicks when the board changes.</small></div>
        <label class="switch"><input type="checkbox" data-setting="sound" ${st.sound ? 'checked' : ''}><span></span></label>
      </div>
    </section>

    ${appearancePanel(st)}

    <section class="panel">
      <h2 class="panel-title">Backup</h2>
      <p class="hint">Flights are saved on this device. Export a backup now and then, or to move your flights to another device.</p>
      <div class="btns">
        <button class="btn" data-act="export">${icon('download')}Export</button>
        <button class="btn" data-act="import">${icon('upload')}Import</button>
        <button class="btn ghost" data-act="demo">Load demo flights</button>
        <button class="btn ghost danger" data-act="reset">${icon('trash')}Erase everything</button>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </div>
    </section>
  </div>`;
}

/* ---------- Sheets ---------- */

function openSheet(s) {
  ui.sheet = s;
  renderSheet();
  sheet.classList.remove('closing');
  if (!sheet.open) sheet.showModal();
  if (s.type !== 'detail') $('input[autofocus]', sheet)?.focus();
}

function closeSheet() {
  ui.sheet = null;
  closeAnimated(sheet);
}

function renderSheet() {
  const s = ui.sheet;
  if (!s) return;
  if (s.type === 'detail' && !S.taskById(s.id)) return closeSheet();
  sheet.innerHTML = { detail: detailSheet, form: formSheet, subject: subjectSheet, profile: profileSheet }[s.type](s);
  hydrate(sheet, { animateNew: true });
}

function detailSheet({ id }) {
  const t = S.taskById(id);
  const s = subj(t);
  const st = S.statusOf(t);
  const today = D.todayKey();
  const choices = [['', 'Hangar'], ...Array.from({ length: 7 }, (_, i) => {
    const k = D.addDays(today, i);
    return [k, i < 2 ? D.relDay(k) : D.dow(k)[0] + D.dow(k).slice(1).toLowerCase()];
  })];
  const afterDue = !t.done && t.due && t.day && t.day > t.due;
  const order = t.day && !t.done ? S.flightsForDay(t.day).pending.map((x) => x.id) : [];
  const pos = order.indexOf(t.id);

  const [act, ic, label] = t.done
    ? ['done', 'undo', 'Return to gate']
    : t.boardingAt
      ? ['done', 'check', 'Mark departed']
      : ['board', 'takeoff', 'Start boarding'];
  const second = t.done
    ? ''
    : t.boardingAt
      ? `<button class="btn" data-act="unboard" data-id="${t.id}">Stop boarding</button>`
      : `<button class="btn" data-act="done" data-id="${t.id}">${icon('check')}Mark departed</button>`;

  return `
  <div class="sheet-inner" style="--livery:${s.color}">
    <header class="sheet-head">
      <span class="airline"><i class="dot"></i>${esc(s.name)}</span>
      <button class="icon-btn" data-act="close" aria-label="Close">${icon('x')}</button>
    </header>

    <article class="ticket">
      <div class="ticket-top">
        <div class="ticket-row">
          <div class="pass-flight">${flapHTML(S.flightNo(t), `sheet-${t.id}`, { tiles: true })}</div>
          <span class="status ${st.tone}">${flapHTML(st.label, `sheet-st-${t.id}`)}</span>
        </div>
        <h2 class="sheet-title">${esc(t.title)}</h2>
        ${t.boardingAt ? `<p class="muted">Boarding started ${since(t.boardingAt)}</p>` : ''}
      </div>
      <dl class="pass-grid">
        <div><dt>Day</dt><dd>${t.day ? D.relDay(t.day) : 'Hangar'}</dd></div>
        <div><dt>Gate</dt><dd>${esc(s.gate || '—')}</dd></div>
        <div><dt>Deadline</dt><dd>${t.due ? D.relDay(t.due) : '—'}</dd></div>
        <div><dt>Block</dt><dd>${mins(t.minutes)}</dd></div>
        <div><dt>Turbulence</dt><dd>${dots(t.difficulty)}</dd></div>
        <div><dt>Seq</dt><dd>${pos >= 0 ? `${pos + 1} of ${order.length}` : '—'}</dd></div>
      </dl>
      <div class="perf"></div>
      <div class="ticket-foot">${barcode(S.flightNo(t) + t.id)}<span>${S.flightNo(t)}</span></div>
    </article>

    ${t.delayed && !t.done ? `<p class="note warn">Delayed ${plural(t.delayed, 'time')}.</p>` : ''}
    ${afterDue ? `<p class="note stop">Scheduled after its deadline (${D.shortDate(t.due)}).</p>` : ''}

    <div class="sheet-actions">
      <button class="btn primary" data-act="${act}" data-id="${t.id}">${icon(ic)}${label}</button>
      ${second}
    </div>

    ${
      t.done
        ? ''
        : `<section>
      <h4>Departure day</h4>
      <div class="chips">${choices
        .map(([k, l]) => `<button class="chip-btn ${(t.day || '') === k ? 'on' : ''}" data-act="reschedule" data-id="${t.id}" data-day="${k}">${l}</button>`)
        .join('')}</div>
      ${
        order.length > 1
          ? `<div class="btns order">
          <button class="btn sm" data-act="move" data-dir="-1" data-id="${t.id}" data-day="${t.day}" ${pos === 0 ? 'hidden' : ''}>${icon('up')}Earlier</button>
          <button class="btn sm" data-act="move" data-dir="1" data-id="${t.id}" data-day="${t.day}" ${pos === order.length - 1 ? 'hidden' : ''}>${icon('down')}Later</button>
        </div>`
          : ''
      }
    </section>`
    }

    <section>
      <h4>Pre-flight checklist</h4>
      <ul class="checklist">
        ${t.checklist
          .map(
            (c) => `<li><label class="check">
              <input type="checkbox" data-act="check" data-id="${t.id}" data-cid="${c.id}" ${c.done ? 'checked' : ''}>
              <span>${esc(c.text)}</span></label>
              <button class="icon-btn xs" data-act="check-del" data-id="${t.id}" data-cid="${c.id}" aria-label="Remove step">${icon('x')}</button></li>`,
          )
          .join('')}
      </ul>
      <form class="inline" data-form="check" data-id="${t.id}">
        <input name="text" placeholder="Add a step" autocomplete="off" aria-label="New checklist step">
        <button class="btn sm">Add</button>
      </form>
    </section>

    ${t.notes ? `<section><h4>Notes</h4><p class="notes">${esc(t.notes)}</p></section>` : ''}

    <footer class="sheet-foot">
      ${t.done ? '' : `<button class="btn ghost sm" data-act="delay" data-id="${t.id}">${icon('later')}Delay a day</button>`}
      <button class="btn ghost sm" data-act="edit" data-id="${t.id}">${icon('edit')}Edit</button>
      <button class="btn ghost sm danger" data-act="delete" data-id="${t.id}">${icon('trash')}Cancel flight</button>
    </footer>
  </div>`;
}

// A decorative barcode, stable for each flight.
function barcode(seed) {
  let h = 7;
  const bars = [];
  for (let i = 0; i < 46; i++) {
    h = (h * 31 + seed.charCodeAt(i % seed.length)) % 9973;
    bars.push(`<i style="width:${1 + (h % 3)}px;margin-right:${1 + ((h >> 2) % 3)}px"></i>`);
  }
  return `<span class="barcode" aria-hidden="true">${bars.join('')}</span>`;
}

function formSheet({ id, day, due }) {
  const t = id ? S.taskById(id) : null;
  const subjects = S.getState().subjects;
  const today = D.todayKey();
  const tomorrow = D.addDays(today, 1);
  const cur = t ? t.day : day;
  const choice = !cur ? 'hangar' : cur === today ? 'today' : cur === tomorrow ? 'tomorrow' : 'date';
  const radio = (name, value, label, checked, cls = 'chip') =>
    `<label class="${cls}"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;

  return `
  <form class="sheet-inner" data-form="task" ${id ? `data-id="${id}"` : ''}>
    <header class="sheet-head">
      <h2>${t ? 'Edit flight' : 'New flight'}</h2>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close">${icon('x')}</button>
    </header>

    <label class="field"><span>Destination</span>
      <input name="title" maxlength="80" placeholder="Calc problem set 4" value="${esc(t?.title)}" autocomplete="off" ${t ? '' : 'autofocus'}>
      <small class="error" hidden>Give the flight a destination.</small>
    </label>

    <fieldset class="field"><legend>Airline</legend>
      <div class="chips">${subjects
        .map(
          (s, i) =>
            `<label class="chip livery" style="--livery:${s.color}"><input type="radio" name="subjectId" value="${s.id}" ${(t ? t.subjectId === s.id : i === 0) ? 'checked' : ''}><span><i class="dot"></i>${esc(s.name)}</span></label>`,
        )
        .join('')}</div>
    </fieldset>

    <fieldset class="field"><legend>Departure day</legend>
      <div class="chips">
        ${radio('day', 'hangar', 'Hangar', choice === 'hangar')}
        ${radio('day', 'today', 'Today', choice === 'today')}
        ${radio('day', 'tomorrow', 'Tomorrow', choice === 'tomorrow')}
        <label class="chip date"><input type="radio" name="day" value="date" ${choice === 'date' ? 'checked' : ''}>
          <input type="date" name="dayDate" min="${today}" value="${choice === 'date' ? cur : ''}" aria-label="Other day"></label>
      </div>
    </fieldset>

    <label class="field"><span>Deadline</span>
      <input type="date" name="due" value="${t?.due || due || ''}">
    </label>

    <fieldset class="field"><legend>Turbulence (how hard)</legend>
      <div class="seg">${[1, 2, 3].map((n) => radio('difficulty', n, `${dots(n)}${S.TURBULENCE[n]}`, (t?.difficulty ?? 2) === n, '')).join('')}</div>
    </fieldset>

    <fieldset class="field"><legend>Block time (how long)</legend>
      <div class="chips">
        ${radio('minutes', '', 'Not sure', !t?.minutes)}
        ${[15, 30, 45, 60, 90, 120].map((m) => radio('minutes', m, mins(m), t?.minutes === m)).join('')}
      </div>
    </fieldset>

    <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(t?.notes)}</textarea></label>

    <footer class="sheet-actions">
      <button class="btn primary" type="submit">${t ? 'Save' : `${icon('takeoff')}Add flight`}</button>
    </footer>
  </form>`;
}

function subjectSheet({ id }) {
  const all = S.getState().subjects;
  const s = id ? S.subjectById(id) : { code: '', name: '', level: 'SL', gate: '', color: S.LIVERIES[all.length % S.LIVERIES.length] };
  return `
  <form class="sheet-inner" data-form="subject" ${id ? `data-id="${id}"` : ''}>
    <header class="sheet-head">
      <h2>${id ? 'Edit airline' : 'New airline'}</h2>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close">${icon('x')}</button>
    </header>
    <label class="field"><span>Class name</span><input name="name" value="${esc(s.name)}" placeholder="Chemistry" autocomplete="off" ${id ? '' : 'autofocus'}></label>
    <div class="two">
      <label class="field"><span>Code</span><input name="code" value="${esc(s.code)}" placeholder="CHM" maxlength="4" autocapitalize="characters" autocomplete="off"></label>
      <label class="field"><span>Gate</span><input name="gate" value="${esc(s.gate)}" placeholder="B2" maxlength="4" autocapitalize="characters" autocomplete="off"></label>
    </div>
    <fieldset class="field"><legend>Level</legend>
      <div class="seg two-up">${Object.entries(S.LEVELS)
        .map(([k, l]) => `<label><input type="radio" name="level" value="${k}" ${(s.level || 'SL') === k ? 'checked' : ''}><span>${l}</span></label>`)
        .join('')}</div>
    </fieldset>
    <fieldset class="field"><legend>Colour</legend>
      <div class="chips">${S.LIVERIES.map(
        (c) => `<label class="swatch-pick" style="--livery:${c}"><input type="radio" name="color" value="${c}" ${s.color === c ? 'checked' : ''} aria-label="${c}"><span></span></label>`,
      ).join('')}</div>
    </fieldset>
    <footer class="sheet-actions">
      <button class="btn primary" type="submit">Save</button>
      ${id ? `<button type="button" class="btn ghost danger" data-act="subject-delete" data-id="${id}">${icon('trash')}Delete</button>` : ''}
    </footer>
  </form>`;
}

/* ---------- Events ---------- */

function addContext(el) {
  // The + button picks a sensible default for the screen you're on.
  if ('day' in el.dataset) return { day: el.dataset.day || null, due: el.dataset.due };
  if (ui.route === 'weekly') return { day: null };
  return { day: D.todayKey() };
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;
  const day = el.dataset.day || null;
  const today = D.todayKey();

  switch (act) {
    case 'add':
      openSheet({ type: 'form', ...addContext(el) });
      break;
    case 'open':
      openSheet({ type: 'detail', id });
      break;
    case 'board':
      S.startBoarding(id);
      toast(`${S.flightNo(S.taskById(id))} now boarding`, 'takeoff');
      break;
    case 'unboard':
      S.stopBoarding(id);
      break;
    case 'done': {
      const wasDone = S.taskById(id).done;
      S.toggleDone(id);
      toast(wasDone ? `${S.flightNo(S.taskById(id))} returned to gate` : `${S.flightNo(S.taskById(id))} departed`, wasDone ? 'undo' : 'takeoff');
      break;
    }
    case 'delay':
      S.delayTask(id);
      toast(`${S.flightNo(S.taskById(id))} delayed to ${D.relDay(S.taskById(id).day).toLowerCase()}`, 'clock');
      break;
    case 'reschedule':
      S.updateTask(id, { day });
      break;
    case 'edit':
      openSheet({ type: 'form', id });
      break;
    case 'delete': {
      const t = S.taskById(id);
      const no = S.flightNo(t);
      ask({
        title: `Cancel flight ${no}?`,
        message: `“${t.title}” will be removed from your planner. This can’t be undone.`,
        confirm: 'Cancel flight',
        cancel: 'Keep flight',
        danger: true,
      }).then((yes) => {
        if (!yes) return;
        closeSheet();
        S.deleteTask(id);
        toast(`${no} cancelled`, 'trash');
      });
      break;
    }
    case 'move':
      S.moveInDay(day, id, Number(el.dataset.dir));
      break;
    case 'auto-day':
      S.autoOrderDay(day);
      break;
    case 'auto-week': {
      const n = S.autoAssignWeek(today);
      if (n) toast(`${plural(n, 'flight')} dispatched`, 'wand');
      else tell('Nothing to dispatch', 'Auto-dispatch places hangar flights that are due in the next 10 days.');
      break;
    }
    case 'open-day':
      ui.openDay = ui.openDay === day ? null : day;
      render();
      break;
    case 'edit-profile':
      openSheet({ type: 'profile' });
      break;
    case 'photo-remove':
      S.setProfile({ photo: null });
      $('#avatarPreview').innerHTML = avatarHTML(S.profile(), 'lg');
      el.hidden = true;
      break;
    case 'close':
      closeSheet();
      break;
    case 'subject':
      openSheet({ type: 'subject', id });
      break;
    case 'subject-delete':
      if (!S.deleteSubject(id)) tell('This airline still has flights', 'Move or cancel its flights first, then delete it.');
      else closeSheet();
      break;
    case 'check':
      S.toggleCheck(id, el.dataset.cid);
      break;
    case 'check-del':
      S.removeCheck(id, el.dataset.cid);
      break;
    case 'cap':
      S.setSetting('capacity', Math.min(12, Math.max(1, S.settings().capacity + Number(el.dataset.n))));
      break;
    case 'clear-start':
      S.setSetting('startTime', '');
      break;
    case 'export': {
      const blob = new Blob([S.exportData()], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `plannerboard-${today}.json` });
      a.click();
      URL.revokeObjectURL(a.href);
      break;
    }
    case 'import':
      $('#importFile').click();
      break;
    case 'demo':
      S.loadDemo();
      location.hash = '#/daily';
      toast('Demo flights loaded', 'takeoff');
      break;
    case 'reset':
      ask({
        title: 'Erase everything?',
        message: 'All flights, airlines, and your crew ID on this device will be deleted. This can’t be undone.',
        confirm: 'Erase',
        danger: true,
      }).then((yes) => yes && (S.resetAll(), toast('Everything erased', 'trash')));
      break;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.setting) {
    const v = t.type === 'checkbox' ? t.checked : t.value;
    S.setSetting(t.dataset.setting, v);
    if (t.dataset.setting === 'sound') setSound(v);
    if (t.dataset.setting === 'theme') window.PlannerTheme.apply();
  }
  if (t.id === 'photoInput' && t.files[0]) {
    squarePhoto(t.files[0])
      .then((photo) => {
        S.setProfile({ photo });
        $('#avatarPreview').innerHTML = avatarHTML(S.profile(), 'lg');
        $('[data-act="photo-remove"]', sheet).hidden = false;
      })
      .catch(() => tell('That photo couldn’t be read', 'Try a JPEG or PNG instead.'));
  }
  if (t.id === 'importFile' && t.files[0]) {
    t.files[0].text().then((txt) => {
      try {
        S.importData(txt);
        toast('Backup imported');
      } catch {
        tell('That file isn’t a PlannerBoard backup', 'Choose a .json file exported from Profile → Backup.');
      }
    });
    t.value = '';
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.name === 'dayDate' && t.value) t.form.elements.day.value = 'date';
  if (t.name === 'title') t.form.querySelector('.error').hidden = true;
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!form.dataset.form) return;
  e.preventDefault();
  const f = new FormData(form);
  const id = form.dataset.id;

  if (form.dataset.form === 'task') {
    const title = (f.get('title') || '').trim();
    if (!title) {
      form.querySelector('.error').hidden = false;
      form.elements.title.focus();
      return;
    }
    const today = D.todayKey();
    const choice = f.get('day');
    let day = { hangar: null, today, tomorrow: D.addDays(today, 1) }[choice];
    if (choice === 'date') day = f.get('dayDate') || null;
    if (day && day < today) day = today;
    const data = {
      subjectId: f.get('subjectId'),
      title,
      day,
      due: f.get('due') || null,
      difficulty: f.get('difficulty') || 2,
      minutes: f.get('minutes') || null,
      notes: f.get('notes') || '',
    };
    if (id) {
      S.updateTask(id, data);
      openSheet({ type: 'detail', id });
    } else {
      const t = S.addTask(data);
      closeSheet();
      toast(`${S.flightNo(t)} ${day ? `scheduled for ${D.relDay(day).toLowerCase()}` : 'parked in the hangar'}`, 'plus');
    }
  } else if (form.dataset.form === 'subject') {
    S.saveSubject({ id, code: f.get('code') || '', name: f.get('name') || '', level: f.get('level') || 'SL', gate: f.get('gate') || '', color: f.get('color') });
    closeSheet();
  } else if (form.dataset.form === 'profile') {
    const get = (k) => (f.get(k) || '').trim();
    S.setProfile({ name: get('name'), callsign: get('callsign'), base: get('base').toUpperCase(), year: get('year'), aircraft: get('aircraft'), motto: get('motto') });
    closeSheet();
    toast('Crew ID saved', 'user');
  } else if (form.dataset.form === 'check') {
    S.addCheck(id, f.get('text') || '');
    $('input[name="text"]', sheet)?.focus();
  }
});

sheet.addEventListener('click', (e) => {
  if (e.target === sheet) closeSheet();
});
sheet.addEventListener('close', () => (ui.sheet = null));
sheet.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeSheet();
});
window.addEventListener('resize', () => movePill(false));

/* Drag and drop between the hangar and days (Mac / iPad). */
let dragId = null;
document.addEventListener('dragstart', (e) => {
  const card = e.target.closest?.('[draggable="true"][data-id]');
  if (!card) return;
  dragId = card.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  card.classList.add('dragging');
});
document.addEventListener('dragover', (e) => {
  const zone = e.target.closest?.('.drop');
  if (!zone || !dragId) return;
  e.preventDefault();
  document.querySelectorAll('.drop-over').forEach((z) => z !== zone && z.classList.remove('drop-over'));
  zone.classList.add('drop-over');
});
document.addEventListener('drop', (e) => {
  const zone = e.target.closest?.('.drop');
  if (!zone || !dragId) return;
  e.preventDefault();
  const before = e.target.closest('.wrow')?.dataset.id;
  S.placeTask(dragId, zone.dataset.day || null, before);
});
document.addEventListener('dragend', () => {
  dragId = null;
  document.querySelectorAll('.dragging, .drop-over').forEach((x) => x.classList.remove('dragging', 'drop-over'));
});

/* ---------- Start ---------- */

S.load();
renderNav();
S.subscribe(() => {
  render();
  if (ui.sheet?.type === 'detail') renderSheet();
});
window.addEventListener('hashchange', route);
route();
requestAnimationFrame(() => movePill(false));
ui.minute = nowText();
setInterval(tickClock, 5000);
document.addEventListener('visibilitychange', () => !document.hidden && tickClock());

// Audio can only start after a tap.
document.addEventListener('pointerdown', () => S.settings().sound && setSound(true), { once: true });

// Offline support once it's hosted (skipped on localhost so edits show up straight away).
if ('serviceWorker' in navigator && isSecureContext && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('./sw.js');
}
