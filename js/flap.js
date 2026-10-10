// Split-flap text. Views render flapHTML() with a stable key; after each render,
// hydrate() compares against what that key showed last time and flips only the
// characters that changed.

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const STEP_MS = 55;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

const shown = new Map();
let jobs = [];
let raf = null;
let soundOn = false;

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const glyph = (c) => (c === ' ' ? '&nbsp;' : esc(c));

export function flapHTML(text, key, { tiles = false, len = 0, cls = '' } = {}) {
  let t = String(text ?? '').toUpperCase();
  if (len) t = t.padEnd(len).slice(0, len);
  const cells = [...t].map((c) => `<span class="fc">${glyph(c)}</span>`).join('');
  return `<span class="flap${tiles ? ' tiles' : ''} ${cls}" data-key="${esc(key)}" data-text="${esc(t)}">${cells}</span>`;
}

// Forget what was on screen, so the next hydrate animates everything again.
export function forget(keep = () => false) {
  for (const k of shown.keys()) if (!keep(k)) shown.delete(k);
}

export function hydrate(root, { animateNew = false } = {}) {
  const start = performance.now();
  root.querySelectorAll('.flap[data-key]').forEach((el) => {
    const { key, text } = el.dataset;
    const old = shown.get(key);
    shown.set(key, text);
    if (old === text || (old === undefined && !animateNew) || reduceMotion.matches) return;
    [...el.children].forEach((span, i) => {
      const target = text[i];
      if (old && old[i] === target) return;
      if (target === ' ' && !(old && old[i] && old[i] !== ' ')) return;
      jobs.push({ span, target, next: start + i * 24, steps: 3 + Math.floor(Math.random() * 5), a: false });
    });
  });
  if (jobs.length && !raf) raf = requestAnimationFrame(tick);
}

function tick(t) {
  let flipped = false;
  jobs = jobs.filter((j) => {
    if (!j.span.isConnected) return false;
    if (t < j.next) return true;
    j.steps--;
    const c = j.steps <= 0 ? j.target : CHARSET[Math.floor(Math.random() * CHARSET.length)];
    j.span.innerHTML = glyph(c);
    // Alternate between two identical animations so each step restarts it.
    j.a = !j.a;
    j.span.className = `fc ${j.a ? 'fa' : 'fb'}`;
    j.next = t + STEP_MS;
    flipped = true;
    return j.steps > 0;
  });
  if (flipped && soundOn) click();
  raf = jobs.length ? requestAnimationFrame(tick) : null;
}

/* ---------- Optional clatter ---------- */

let ctx;
let noise;
let lastClick = 0;

export function setSound(on) {
  soundOn = on;
  if (on) {
    ctx ??= new AudioContext();
    ctx.resume();
  }
}

function click() {
  const t = performance.now();
  if (!ctx || t - lastClick < 35) return;
  lastClick = t;
  if (!noise) {
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.018), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 4;
  }
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = noise;
  gain.gain.value = 0.12;
  src.connect(gain).connect(ctx.destination);
  src.start();
}
