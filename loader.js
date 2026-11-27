/* Lab Virtual — pintu depan (login, register, beranda simulator, pemuat aplikasi, pencatatan) */
(function () {
  'use strict';
  const CFG = window.LV_CONFIG || window.PLC_CONFIG || {};
  const $ = q => document.querySelector(q);
  const SESS = 'lv_session';
  let session = null, home = null, simId = null, place = null, placeAt = 0, audited = false;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

  /* ---------- tampilan ---------- */
  const VIEWS = ['gate', 'loading', 'home', 'app', 'admin'];
  function show(w) { VIEWS.forEach(v => { $('#' + v).hidden = v !== w; }); $('#lvbar').hidden = w !== 'app'; }
  function setTab(t) {
    document.querySelectorAll('[data-gtab]').forEach(b => b.classList.toggle('on', b.dataset.gtab === t));
    $('#fLogin').hidden = t !== 'login'; $('#fReg').hidden = t !== 'reg'; $('#gMsg').textContent = '';
  }
  function gmsg(m, ok) { const e = $('#gMsg'); e.textContent = m; e.className = 'gmsg ' + (ok ? 'ok' : 'bad'); }
  function loadingMsg(m) { $('#loadMsg').textContent = m; }
  function busy(form, on) { form.querySelectorAll('button,input').forEach(x => x.disabled = on); }
  const isMhs = () => session && session.user.role === 'mahasiswa';

  /* ---------- penyimpanan progres per akun & per simulator ---------- */
  const store = { data: {}, timer: null, dirty: false, key: '' };
  function storeInit(serverState) {
    store.key = 'lv_state_' + session.user.id + '_' + simId + (isMhs() ? '' : '_pratinjau');
    let local = null;
    try { local = JSON.parse(localStorage.getItem(store.key) || 'null'); } catch (e) {}
    store.data = (serverState && typeof serverState === 'object') ? serverState : (local || {});
  }
  const STORE = {
    get: k => (k in store.data ? store.data[k] : null),
    set: (k, v) => {
      v = String(v); if (store.data[k] === v) return;
      store.data[k] = v;
      try { localStorage.setItem(store.key, JSON.stringify(store.data)); } catch (e) {}
      if (!isMhs()) return;
      store.dirty = true; clearTimeout(store.timer); store.timer = setTimeout(pushState, 4000);
    }
  };
  function summary() {
    let s = {};
    try { s = (API.getSummary && API.getSummary()) || {}; } catch (e) {}
    if (s.progres === undefined && s.b1 !== undefined) s = { progres: `Bagian 1 ${s.b1} · Bagian 2 ${s.b2} · Bagian 3 ${s.b3} · Latihan ${s.latN}`, detail: s.lat || '' };
    return s;
  }
  async function pushState() {
    if (!store.dirty || !isMhs() || !simId) return;
    store.dirty = false;
    try { await call('saveState', { sim: simId, state: store.data, summary: summary() }, 2); }
    catch (e) { store.dirty = true; }
  }

  /* ---------- antrean log ---------- */
  const queue = [];
  let logTimer = null;
  function log(type, d) {
    if (!isMhs() || !simId) return;
    queue.push(Object.assign({ type, t: new Date().toISOString() }, d));
    if (queue.length >= 25) flushLog(); else { clearTimeout(logTimer); logTimer = setTimeout(flushLog, 8000); }
  }
  async function flushLog() {
    clearTimeout(logTimer);
    if (!queue.length || !session || !simId) return;
    const batch = queue.splice(0, queue.length);
    try { await call('log', { sim: simId, events: batch }, 2); } catch (e) { queue.unshift(...batch); }
  }
  function beacon() {
    if (!isMhs() || !simId) return;
    const send = (action, data) => { try { navigator.sendBeacon(CFG.API_URL, new Blob([JSON.stringify(Object.assign({ action, token: session.token, sim: simId }, data))], { type: 'text/plain' })); } catch (e) {} };
    if (queue.length) send('log', { events: queue.splice(0, queue.length) });
    if (store.dirty) { store.dirty = false; send('saveState', { state: store.data, summary: summary() }); }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beacon(); });
  window.addEventListener('pagehide', () => { beacon(); auditBeacon(); });
  /* catatan akses (jam & durasi) untuk semua peran */
  const mins = () => placeAt ? (Date.now() - placeAt) / 60000 : 0;
  function audit(aksi, extra) { if (!session) return Promise.resolve(); return call('audit', Object.assign({ aksi, sim: place && place !== 'DASHBOARD' ? place : '' }, extra || {}), 1).catch(() => {}); }
  function enterPlace(p) { place = p; placeAt = Date.now(); audit(p === 'DASHBOARD' ? 'Buka dashboard' : 'Buka simulator'); }
  async function leavePlace(extra) { if (!place || audited) return; audited = true; await audit(place === 'DASHBOARD' ? 'Keluar dashboard' : 'Keluar simulator', Object.assign({ durasi: mins() }, extra || {})); }
  function auditBeacon() {
    if (!session || audited || !place) return; audited = true;
    try { navigator.sendBeacon(CFG.API_URL, new Blob([JSON.stringify({ action: 'audit', token: session.token, aksi: 'Tutup halaman', sim: place !== 'DASHBOARD' ? place : '', detail: place === 'DASHBOARD' ? 'dashboard' : '', durasi: mins() })], { type: 'text/plain' })); } catch (e) {}
  }

  /* ---------- memuat bundle dari Drive (dengan cache per versi) ---------- */
  async function getBundle(sim, part, v) {
    const key = 'lv_bundle_' + (sim || '') + '_' + part;
    try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && c.v === v) return c.d; } catch (e) {}
    const r = await call('bundle', { sim, part });
    const d = part === 'materi' ? r.materi : r.text;
    try { localStorage.setItem(key, JSON.stringify({ v, d })); } catch (e) {}
    return d;
  }
  function run(code) { (0, Function)(code)(); }

  /* ---------- API untuk aplikasi simulator & dashboard ---------- */
  const API = window.__LV = window.__PLC = {
    call, log, store: STORE,
    get user() { return session && session.user; },
    get sim() { return simId; },
    materi: null, getSummary: null,
    logout: async () => { await flushLog(); await pushState(); await leavePlace(); audited = true; await audit('Logout'); try { localStorage.removeItem(SESS); } catch (e) {} location.hash = ''; location.reload(); },
    toHome: async () => { await flushLog(); await pushState(); await leavePlace(); location.hash = ''; location.reload(); },
    toDashboard: async () => { if (session && !isMhs()) { await flushLog(); await pushState(); await leavePlace(); location.hash = 'dashboard'; location.reload(); } },
    openApp: () => API.toHome(),
    openSim: async id => { await leavePlace(); location.hash = 'sim=' + encodeURIComponent(id); location.reload(); },
    flush: async () => { await flushLog(); await pushState(); }
  };

  /* ---------- beranda: kartu simulator ---------- */
  function drawHome() {
    const u = session.user, sims = home.sims;
    const staff = u.role !== 'mahasiswa';
    $('#home').innerHTML = `<div class="lv">
      <header class="lv-top"><div><p class="kick">Lab Virtual</p><h1>Pilih simulator</h1></div>
        <span class="who">${esc(u.nama)} · ${u.role === 'mahasiswa' ? esc(u.id) + ' · ' + esc(u.kelas) : esc(u.role)}</span>
        ${staff ? '<button type="button" id="hDash" class="pri">Dashboard</button>' : ''}<button type="button" id="hOut">Keluar</button></header>
      <div class="lv-grid">${sims.map(s => `<button type="button" class="lv-card${s.open ? '' : ' off'}" data-sim="${esc(s.id)}" ${s.open ? '' : 'aria-disabled="true"'}>
        <span class="lv-img">${s.gambar ? `<img src="${esc(s.gambar)}" alt="" loading="lazy">` : (s.open ? `<span class="lv-ph">${esc(s.nama.slice(0, 1))}</span>` : '<span class="lv-ph"></span>')}${s.open ? '' : `<span class="lv-lock"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="#fff" stroke-width="2"/><rect x="5" y="11" width="14" height="10" rx="2" fill="#fff"/></svg></span>`}</span>
        <span class="lv-body"><b>${esc(s.nama)}</b><span>${esc(s.ket)}</span><em>${s.open ? 'Masuk' : s.segera ? 'Segera hadir' : (staff ? 'Bukan simulator Anda' : 'Ditutup oleh dosen')}</em></span></button>`).join('')}</div>
      <p class="gnote" id="hMsg" role="status"></p></div>`;
    $('#hOut').addEventListener('click', () => API.logout());
    $('#hDash') && $('#hDash').addEventListener('click', () => API.toDashboard());
    document.querySelectorAll('[data-sim]').forEach(b => b.addEventListener('click', () => {
      const s = sims.find(x => x.id === b.dataset.sim);
      if (!s.open) { $('#hMsg').textContent = s.segera ? `Simulator ${s.nama} sedang disiapkan.` : `Simulator ${s.nama} belum dibuka untuk kelas Anda.`; return; }
      API.openSim(s.id);
    }));
    show('home');
  }

  async function startSim(id) {
    const s = home.sims.find(x => x.id === id);
    if (!s || !s.open) { location.hash = ''; drawHome(); $('#hMsg').textContent = 'Simulator itu tidak bisa dibuka.'; return; }
    simId = s.id;
    $('#lvbar').innerHTML = `<button type="button" id="lvHome">← Lab Virtual</button><b>${esc(s.nama)}</b><span class="who">${esc(session.user.nama)}${isMhs() ? '' : ' · pratinjau ' + esc(session.user.role)}</span>`;
    $('#lvHome').addEventListener('click', () => API.toHome());
    show('loading'); loadingMsg('Memuat materi ' + s.nama + '…');
    API.materi = await getBundle(s.id, 'materi', s.v);
    let st = null;
    if (isMhs()) { loadingMsg('Memuat progres…'); try { st = (await call('loadState', { sim: s.id })).state; } catch (e) {} }
    storeInit(st);
    loadingMsg('Memuat simulator…');
    const code = await getBundle(s.id, 'app', s.v);
    show('app'); run(code); enterPlace(s.id);
  }
  async function startAdmin() {
    show('loading'); loadingMsg('Memuat dashboard…');
    const code = await getBundle('', 'admin', home.adminV);
    show('admin'); run(code); enterPlace('DASHBOARD');
  }
  async function enter() {
    show('loading'); loadingMsg('Memuat daftar simulator…');
    try {
      home = await call('home');
      session.user = home.user; localStorage.setItem(SESS, JSON.stringify(session));
      const h = decodeURIComponent(location.hash.slice(1));
      if (h.startsWith('sim=')) await startSim(h.slice(4));
      else if (h === 'dashboard' && !isMhs()) await startAdmin();
      else drawHome();
    } catch (e) {
      if (session) { show('gate'); setTab('login'); gmsg(e.message); }
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
        session = { token: r.token, user: r.user }; localStorage.setItem(SESS, JSON.stringify(session)); location.hash = ''; await enter();
      } catch (er) { gmsg(er.message); } finally { busy(f, false); }
    });
    $('#fReg').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target;
      if ($('#rPw').value !== $('#rPw2').value) { gmsg('Konfirmasi password tidak sama.'); return; }
      busy(f, true); gmsg('Mendaftarkan…', true);
      try {
        const r = await call('register', { nama: $('#rNama').value.trim(), nim: $('#rNim').value.trim(), kelas: $('#rKelas').value.trim(), password: $('#rPw').value });
        session = { token: r.token, user: r.user }; localStorage.setItem(SESS, JSON.stringify(session)); location.hash = ''; await enter();
      } catch (er) { gmsg(er.message); } finally { busy(f, false); }
    });
    try { session = JSON.parse(localStorage.getItem(SESS) || 'null'); } catch (e) { session = null; }
    if (session && session.token) enter(); else { show('gate'); setTab('login'); }
  }
  init();
})();
