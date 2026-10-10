// Keeps this device in step with Supabase, so the iPhone, the Mac and the
// home-screen widgets all show the same board.
//
// Every sync downloads the saved board, merges it with this device's copy
// (store.mergeRemote), and uploads the result along with a small widget summary.

import * as S from './store.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const STORAGE_KEY = 'plannerboard:sync';
const listeners = new Set();

let saved = read();
let status = { state: saved.session ? 'idle' : 'off', message: '', at: saved.lastSync || 0 };
let running = null;
let again = false;
let timer = null;

function read() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function write() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

function setStatus(state, message = '') {
  status = { state, message, at: state === 'ok' ? Date.now() : status.at };
  listeners.forEach((fn) => fn(status));
}

export const onStatus = (fn) => listeners.add(fn);
export const getStatus = () => status;

/* ---------- Project settings ---------- */

export function project() {
  // Accept the URL with or without a trailing /rest/v1/, as Supabase shows both.
  const url = (SUPABASE_URL || saved.url || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  return { url, key: SUPABASE_KEY || saved.key || '' };
}

export const builtInProject = () => !!(SUPABASE_URL && SUPABASE_KEY);
export const isConfigured = () => !!(project().url && project().key);
export const isSignedIn = () => !!saved.session;
export const email = () => saved.session?.email || '';
export const widgetKey = () => saved.widgetKey || '';

export function setProject(url, key) {
  url = url.trim();
  if (url && !/^https?:\/\//.test(url)) url = `https://${url}`;
  saved = { url, key: key.trim() };
  write();
  setStatus('off');
}

/* ---------- Requests ---------- */

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const { url, key } = project();
  let res;
  try {
    res = await fetch(url + path, {
      method,
      headers: {
        apikey: key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('You’re offline. Changes will sync when you’re back online.'), { offline: true });
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.msg || data?.message || data?.error_description || data?.error || `Request failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return data;
}

function keepSession(data, fallbackEmail) {
  saved.session = {
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + (data.expires_in || 3600) * 1000,
    userId: data.user?.id,
    email: data.user?.email || fallbackEmail,
  };
  write();
}

// A valid access token, refreshed when it's about to expire.
async function token() {
  const s = saved.session;
  if (!s) throw new Error('Signed out');
  if (Date.now() < s.expires - 60000) return s.access;
  try {
    keepSession(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh } }), s.email);
  } catch (e) {
    if (!e.offline) signOutLocally('Your session expired. Sign in again to keep syncing.');
    throw e;
  }
  return saved.session.access;
}

/* ---------- Accounts ---------- */

export async function signIn(emailAddress, password) {
  const data = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: emailAddress, password } });
  keepSession(data, emailAddress);
  await syncNow();
}

export async function signUp(emailAddress, password) {
  const data = await call('/auth/v1/signup', { method: 'POST', body: { email: emailAddress, password } });
  if (!data?.access_token) {
    // Email confirmation is switched on for the project.
    return { needsConfirm: true };
  }
  keepSession(data, emailAddress);
  await syncNow();
  return { needsConfirm: false };
}

function signOutLocally(message = '') {
  delete saved.session;
  delete saved.widgetKey;
  delete saved.lastSync;
  write();
  setStatus('off', message);
}

export async function signOut() {
  const s = saved.session;
  signOutLocally();
  if (s) call('/auth/v1/logout', { method: 'POST', token: s.access }).catch(() => {});
}

/* ---------- Syncing ---------- */

async function runSync() {
  const access = await token();
  const userId = saved.session.userId;

  const rows = await call(`/rest/v1/boards?select=data,widget_key&user_id=eq.${userId}`, { token: access });
  if (rows?.[0]?.data) S.mergeRemote(rows[0].data);

  await call('/rest/v1/boards', {
    method: 'POST',
    token: access,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { user_id: userId, data: S.getState(), widget: S.widgetSnapshot(), updated_at: new Date().toISOString() },
  });

  if (!rows?.[0]?.widget_key) {
    const after = await call(`/rest/v1/boards?select=widget_key&user_id=eq.${userId}`, { token: access });
    saved.widgetKey = after?.[0]?.widget_key || '';
  } else {
    saved.widgetKey = rows[0].widget_key;
  }
  saved.lastSync = Date.now();
  write();
}

export async function syncNow() {
  if (!isConfigured() || !isSignedIn()) return;
  if (running) {
    again = true;
    return running;
  }
  setStatus('syncing');
  running = runSync()
    .then(() => setStatus('ok'))
    .catch((e) => saved.session && setStatus(e.offline ? 'offline' : 'error', e.message))
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        syncNow();
      }
    });
  return running;
}

// Upload shortly after an edit, so a burst of taps becomes one sync.
function soon() {
  clearTimeout(timer);
  timer = setTimeout(syncNow, 1200);
}

export function start() {
  // Signed in or out in another tab of the app.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    saved = read();
    setStatus(saved.session ? 'idle' : 'off');
  });
  S.subscribe((info) => !info?.remote && isSignedIn() && soon());
  document.addEventListener('visibilitychange', () => !document.hidden && syncNow());
  window.addEventListener('online', syncNow);
  setInterval(() => !document.hidden && syncNow(), 60000);
  syncNow();
}
