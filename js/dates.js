// Dates are stored as local "YYYY-MM-DD" keys so they compare as plain strings.

export const pad = (n) => String(n).padStart(2, '0');

export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayKey = () => keyOf(new Date());

export function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}

// Whole days from b to a (a - b).
export const diffDays = (a, b) => Math.round((parseKey(a) - parseKey(b)) / 86400000);

// Weeks start on Monday.
export function startOfWeek(k) {
  const d = parseKey(k);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return keyOf(d);
}

export const weekDays = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const dow = (k) => DOW[parseKey(k).getDay()];
export const dayNum = (k) => parseKey(k).getDate();

// "FRI 10 OCT" — board style.
export function boardDate(k) {
  const d = parseKey(k);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

// "Fri 10 Oct" — UI style.
export function shortDate(k) {
  const d = parseKey(k);
  const cap = (s) => s[0] + s.slice(1).toLowerCase();
  return `${cap(DOW[d.getDay()])} ${d.getDate()} ${cap(MON[d.getMonth()])}`;
}

// "Today", "Tomorrow", "Yesterday", or a short date.
export function relDay(k) {
  const n = diffDays(k, todayKey());
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return shortDate(k);
}

// "in 3 days", "today", "2 days ago"
export function dueIn(k) {
  const n = diffDays(k, todayKey());
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export const monthTitle = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_LONG[m - 1]} ${y}`;
};

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// Minutes since midnight -> "HH:MM".
export const clock = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

export const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
