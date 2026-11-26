/* Simulasi Trainer PLC — pintu depan (login, register, pemuat aplikasi, pencatatan) */
(function () {
  'use strict';
  const CFG = window.PLC_CONFIG || {};
  const $ = q => document.querySelector(q);
  const SESS = 'plc_session';
  let session = null;

  /* ---------- komunikasi dengan Apps Script ---------- */
  async function call(action, data, tries) {
    tries = tries || 3;
    const body = JSON.stringify(Object.assign({ action, token: session && session.token }, data || {}));
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
        const j = await r.json();
        if (!j.ok) {
          if (j.error === 'SESI_HABIS') { sessionExpired(); throw new Error('Sesi berakhir. Silakan masuk lagi.'); }
          const e = new Error(j.error || 'Terjadi kesalahan di server.'); e.server = true; throw e;
        }
        return j;
      } catch (e) {
        last = e;
        if (e.server || /Sesi berakhir/.test(e.message)) throw e;
        await new Promise(res => setTimeout(res, 800 * (i + 1)));
      }
    }
    throw new Error('Server sedang sibuk atau koneksi terputus. Coba lagi sebentar. (' + (last && last.message) + ')');
  }

  /* ---------- tampilan gerbang ---------- */
  function show(which) {
    $('#gate').hidden = which !== 'gate'; $('#loading').hidden = which !== 'loading';
    $('#app').hidden = which !== 'app'; $('#admin').hidden = which !== 'admin';
  }
  function setTab(t) {
    document.querySelectorAll('[data-gtab]').forEach(b => b.classList.toggle('on', b.dataset.gtab === t));
    $('#fLogin').hidden = t !== 'login'; $('#fReg').hidden = t !== 'reg'; $('#gMsg').textContent = '';
  }
  function gmsg(m, ok) { const e = $('#gMsg'); e.textContent = m; e.className = 'gmsg ' + (ok ? 'ok' : 'bad'); }
  function loadingMsg(m) { $('#loadMsg').textContent = m; }
  function busy(form, on) { form.querySelectorAll('button,input').forEach(x => x.disabled = on); }

  /* ---------- penyimpanan progres per akun ---------- */
  const store = { data: {}, timer: null, dirty: false, key: '' };
  function storeInit(nim, serverState) {
    store.key = 'plc_state_' + nim;
    let local = null;
    try { local = JSON.parse(localStorage.getItem(store.key) || 'null'); } catch (e) {}
    store.data = (serverState && typeof serverState === 'object') ? serverState : (local || {});
  }
  const STORE = {
    get: k => (k in store.data ? store.data[k] : null),
    set: (k, v) => {
      store.data[k] = String(v);
      if (!session || session.user.role !== 'mahasiswa') return;
      try { localStorage.setItem(store.key, JSON.stringify(store.data)); } catch (e) {}
      store.dirty = true; clearTimeout(store.timer); store.timer = setTimeout(pushState, 4000);
    }
  };
  async function pushState() {
    if (!store.dirty || !session || session.user.role !== 'mahasiswa') return;
    store.dirty = false;
    try { await call('saveState', { state: store.data, summary: API.getSummary ? API.getSummary() : {} }, 2); }
    catch (e) { store.dirty = true; }
  }

  /* ---------- antrean log ---------- */
  const queue = [];
  let logTimer = null;
  function log(type, d) {
    if (!session || session.user.role !== 'mahasiswa') return;
    queue.push(Object.assign({ type, t: new Date().toISOString() }, d));
    if (queue.length >= 25) flushLog(); else { clearTimeout(logTimer); logTimer = setTimeout(flushLog, 8000); }
  }
  async function flushLog() {
    clearTimeout(logTimer);
    if (!queue.length || !session) return;
    const batch = queue.splice(0, queue.length);
    try { await call('log', { events: batch }, 2); } catch (e) { queue.unshift(...batch); }
  }
  function beacon() {
    if (!session || session.user.role !== 'mahasiswa') return;
    const send = (action, data) => { try { navigator.sendBeacon(CFG.API_URL, new Blob([JSON.stringify(Object.assign({ action, token: session.token }, data))], { type: 'text/plain' })); } catch (e) {} };
    if (queue.length) send('log', { events: queue.splice(0, queue.length) });
    if (store.dirty) { store.dirty = false; send('saveState', { state: store.data, summary: API.getSummary ? API.getSummary() : {} }); }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beacon(); });
  window.addEventListener('pagehide', beacon);

  /* ---------- memuat bundle dari Drive (dengan cache per versi) ---------- */
  async function getVersions() { return call('version'); }
  async function getBundle(part, v) {
    const key = 'plc_bundle_' + part;
    try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && c.v === v) return c.d; } catch (e) {}
    const r = await call('bundle', { part });
    const d = part === 'materi' ? r.materi : r.text;
    try { localStorage.setItem(key, JSON.stringify({ v, d })); } catch (e) {}
    return d;
  }
  function run(code) { (0, Function)(code)(); }

  /* ---------- API untuk aplikasi & dashboard ---------- */
  const API = window.__PLC = {
    call, log, store: STORE,
    get user() { return session && session.user; },
    materi: null,
    logout: async () => { await flushLog(); await pushState(); try { localStorage.removeItem(SESS); } catch (e) {} location.reload(); },
    toDashboard: () => { if (session && session.user.role !== 'mahasiswa') show('admin'); },
    openApp: async () => { await startApp(); },
    flush: async () => { await flushLog(); await pushState(); }
  };

  let versions = null, appStarted = false;
  async function startApp() {
    if (appStarted) { show('app'); return; }
    show('loading'); loadingMsg('Memuat materi…');
    API.materi = await getBundle('materi', versions.materi);
    if (session.user.role === 'mahasiswa') {
      loadingMsg('Memuat progres…');
      let st = null; try { st = (await call('loadState')).state; } catch (e) {}
      storeInit(session.user.id, st);
    } else storeInit('pratinjau_' + session.user.id, null);
    loadingMsg('Memuat simulator…');
    const code = await getBundle('app', versions.app);
    show('app'); run(code); appStarted = true;
  }
  async function startAdmin() {
    show('loading'); loadingMsg('Memuat dashboard…');
    const code = await getBundle('admin', versions.admin);
    show('admin'); run(code);
  }
  async function enter() {
    show('loading'); loadingMsg('Memeriksa versi…');
    try {
      versions = await getVersions();
      if (session.user.role === 'mahasiswa') await startApp(); else await startAdmin();
    } catch (e) {
      show('gate'); setTab('login'); gmsg(e.message);
    }
  }
  function sessionExpired() { try { localStorage.removeItem(SESS); } catch (e) {} session = null; show('gate'); setTab('login'); gmsg('Sesi berakhir. Silakan masuk lagi.'); }

  /* ---------- formulir ---------- */
  function init() {
    if (!CFG.API_URL || /PASTE|ISI/.test(CFG.API_URL)) { show('gate'); gmsg('Alamat server belum diatur. Isi API_URL di config.js (lihat panduan setup).'); return; }
    document.querySelectorAll('[data-gtab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.gtab)));
    $('#fLogin').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target; busy(f, true); gmsg('Memeriksa…', true);
      try {
        const r = await call('login', { id: $('#lId').value.trim(), password: $('#lPw').value });
        session = { token: r.token, user: r.user }; localStorage.setItem(SESS, JSON.stringify(session)); await enter();
      } catch (er) { gmsg(er.message); } finally { busy(f, false); }
    });
    $('#fReg').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target;
      if ($('#rPw').value !== $('#rPw2').value) { gmsg('Konfirmasi password tidak sama.'); return; }
      busy(f, true); gmsg('Mendaftarkan…', true);
      try {
        const r = await call('register', { nama: $('#rNama').value.trim(), nim: $('#rNim').value.trim(), kelas: $('#rKelas').value.trim(), password: $('#rPw').value });
        session = { token: r.token, user: r.user }; localStorage.setItem(SESS, JSON.stringify(session)); await enter();
      } catch (er) { gmsg(er.message); } finally { busy(f, false); }
    });
    try { session = JSON.parse(localStorage.getItem(SESS) || 'null'); } catch (e) { session = null; }
    if (session && session.token) enter(); else { show('gate'); setTab('login'); }
  }
  init();
})();
