// Light while the sun is up in Qingdao, China; dark after sunset.
// Loaded as a plain script in <head> so the right theme is set before anything paints.
// Sunrise/sunset maths adapted from SunCalc by Vladimir Agafonkin (BSD-2-Clause).

(function () {
  const QINGDAO = { lat: 36.0671, lng: 120.3826 };
  const STORAGE_KEY = 'plannerboard:v1';

  const rad = Math.PI / 180;
  const DAY_MS = 86400000;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const J0 = 0.0009;
  const OBLIQUITY = rad * 23.4397;

  const toDays = (date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * DAY_MS);
  const meanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
  const eclipticLongitude = (M) =>
    M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * Math.PI) + n;
  const solarTransit = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

  // Sunrise and sunset around the solar noon nearest to `date`.
  function sunTimes(date, lat = QINGDAO.lat, lng = QINGDAO.lng) {
    const lw = rad * -lng;
    const phi = rad * lat;
    const n = Math.round(toDays(date) - J0 - lw / (2 * Math.PI));
    const ds = approxTransit(0, lw, n);
    const M = meanAnomaly(ds);
    const L = eclipticLongitude(M);
    const dec = Math.asin(Math.sin(L) * Math.sin(OBLIQUITY));
    const noon = solarTransit(ds, M, L);
    const w = Math.acos((Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
    const set = solarTransit(approxTransit(w, lw, n), M, L);
    return { rise: fromJulian(noon - (set - noon)), set: fromJulian(set) };
  }

  function isDaylight(now = new Date()) {
    const { rise, set } = sunTimes(now);
    return now >= rise && now < set;
  }

  function preference() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY))?.settings?.theme || 'auto';
    } catch {
      return 'auto';
    }
  }

  function apply() {
    const pref = preference();
    const dark = pref === 'dark' || (pref === 'auto' && !isDaylight());
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#ffffff');
  }

  // Times shown in Qingdao's clock, e.g. "06:12".
  const qingdaoTime = (date) =>
    date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });

  window.PlannerTheme = { apply, sunTimes, isDaylight, qingdaoTime };

  apply();
  setInterval(apply, 60000);
  document.addEventListener('visibilitychange', () => !document.hidden && apply());
})();
