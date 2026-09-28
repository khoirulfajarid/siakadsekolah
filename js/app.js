/* =====================================================================
   SIAKAD SISWA — app.js : login, shell (sidebar/topbar/bottom-nav),
   sesi 8 jam, bootstrap SWR, prefetch saat idle, akun & password.
   ===================================================================== */
'use strict';

var MENU = {
  guru: [
    { sec: 'Panel Guru' },
    { p: 'dashboard', t: 'Dashboard', i: 'layout-dashboard' },
    { p: 'siswa', t: 'Data Siswa', i: 'users' },
    { p: 'jadwal', t: 'Jadwal Pelajaran', i: 'calendar-days' },
    { p: 'absensi', t: 'Absensi', i: 'scan-line' },
    { p: 'materi', t: 'Materi', i: 'book-open' },
    { p: 'penilaian', t: 'Penilaian', i: 'clipboard-pen-line' },
    { p: 'laporan', t: 'Laporan', i: 'chart-line' },
    { sec: 'Komunikasi & Data' },
    { p: 'notifikasi', t: 'WhatsApp & Notifikasi', i: 'message-circle' },
    { p: 'crm', t: 'CRM Kontak', i: 'contact' },
    { p: 'migrasi', t: 'Migrasi Data', i: 'database-zap' },
    { p: 'pengaturan', t: 'Pengaturan', i: 'settings' }
  ],
  siswa: [
    { sec: 'Navigasi Siswa' },
    { p: 'dashboard', t: 'Beranda', i: 'house' },
    { p: 'absensi', t: 'Absensi Saya', i: 'map-pin-check' },
    { p: 'materi', t: 'Materi Pelajaran', i: 'book-open' },
    { p: 'nilai', t: 'Nilai Saya', i: 'award' },
    { p: 'jadwal', t: 'Jadwal', i: 'calendar-days' },
    { p: 'akun', t: 'Akun Saya', i: 'user-round-cog' }
  ]
};
var BOTTOM = {
  guru: [['dashboard', 'Beranda', 'layout-dashboard'], ['absensi', 'Absensi', 'scan-line'], ['penilaian', 'Nilai', 'clipboard-pen-line'], ['materi', 'Materi', 'book-open'], ['_menu', 'Menu', 'layout-grid']],
  siswa: [['dashboard', 'Beranda', 'house'], ['absensi', 'Absensi', 'map-pin-check'], ['materi', 'Materi', 'book-open'], ['nilai', 'Nilai', 'award'], ['jadwal', 'Jadwal', 'calendar-days']]
};
var LOGO = 'assets/logo.svg';

// ---------------------------------------------------------------- Sesi
function saveSession() { Store.set('session', { token: AppState.token, role: AppState.role, email: AppState.email, nama: AppState.nama, ref: AppState.ref, exp: AppState.exp }); }
function loadSession() { var s = Store.get('session', null); if (s && s.exp > Date.now() && s.token) { Object.assign(AppState, s); return true; } return false; }
window.onSessionExpired = function () {
  if (!AppState.token) return;
  Store.del('session'); AppState.token = '';
  toast('Sesi Anda berakhir. Silakan login kembali.', 'warn');
  showLogin();
};
function logout() {
  Store.del('session'); Store.clearUser(AppState.email);
  AppState = Object.assign(AppState, { token: '', role: '', email: '', nama: '', ref: '', boot: null });
  location.hash = '';
  showLogin();
}

// ---------------------------------------------------------------- Bootstrap data (SWR)
var _bootFlight = null;
function bootAction() { return AppState.role === 'guru' ? 'guru.bootstrap' : 'siswa.bootstrap'; }
function refreshBoot(force) {
  if (_bootFlight && !force) return _bootFlight;
  _bootFlight = swr('boot', bootAction(), {}, function (data, fromCache) {
    var first = !AppState.boot;
    AppState.boot = data;
    if (first) { renderShellMeta(); route(); }
    else { renderShellMeta(); markAllDirty(true); }
  }, { fresh: 60000, force: !!force, silent: !!AppState.boot, onError: function (res) { if (!AppState.boot) $('#content').innerHTML = errorBox(res.message, 'refreshBoot(true)'); } })
    .finally(function () { _bootFlight = null; });
  return _bootFlight;
}
/** Dipanggil setelah aksi tulis berhasil: segarkan bootstrap di latar */
function afterWrite() { return refreshBoot(true); }
function cfg(k, d) { var c = (AppState.boot && AppState.boot.cfg) || {}; return c[k] === undefined || c[k] === '' ? d : c[k]; }

// ---------------------------------------------------------------- Boot aplikasi
async function bootApp() {
  if (DEMO) DemoServer.ready().catch(function (e) { toast(e.message, 'bad'); });
  else warmUpServer();
  if (loadSession()) {
    var c = Store.get(userKey('boot'), null);
    if (c) AppState.boot = c.data;
    showApp();
  } else showLogin();
  var sp = $('#splash'); if (sp) { sp.style.opacity = 0; setTimeout(function () { sp.remove(); }, 200); }
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 120000) { warmUpServer(); if (AppState.token) refreshBoot(); }
  });
}
document.addEventListener('DOMContentLoaded', bootApp);

// ---------------------------------------------------------------- Login
var loginRole = 'siswa';
function showLogin() {
  document.body.style.overflow = '';
  var root = $('#root');
  root.innerHTML = '<div class="login-wrap"><form class="login-card" id="loginForm" autocomplete="on" novalidate>' +
    '<div class="login-logo"><div><img src="' + LOGO + '" alt="Logo sekolah" id="loginLogo"></div></div>' +
    '<h1 class="login-title" id="loginSchool">SIAKAD SISWA</h1>' +
    '<div class="login-sub">Sistem Informasi Akademik Siswa – Login Akses</div><hr>' +
    '<div class="seg" role="tablist"><button type="button" data-role="siswa" role="tab">Siswa</button><button type="button" data-role="guru" role="tab">Guru / Admin</button></div>' +
    '<div class="field mt24"><label for="lgId" id="lgIdLbl">Email / NIS</label><div class="inp-ic lg">' + ic('user') + '<input class="inp" id="lgId" name="id" autocomplete="username" required></div></div>' +
    '<div class="field mt16"><label for="lgPw">Password</label><div class="inp-ic lg">' + ic('lock') + '<input class="inp" id="lgPw" name="password" type="password" autocomplete="current-password" placeholder="Masukkan kata sandi akun" required><button type="button" class="eye" aria-label="Tampilkan password">' + ic('eye') + '</button></div></div>' +
    '<div class="row between mt16"><label class="chk"><input type="checkbox" name="remember" id="lgRemember"> Ingat saya</label><a href="#" id="lgForgot" class="small b" style="text-decoration:none">Lupa Password?</a></div>' +
    '<div id="lgErr" class="note bad mt16" hidden></div>' +
    '<button class="btn btn-dark btn-lg btn-block mt16" id="lgBtn" type="submit">MASUK KE SISTEM ' + ic('arrow-right') + '</button>' +
    '<div class="demo-box" id="demoBox" hidden>' + ic('info') + '<div><div>Akses Demo Akun:</div><div><b>Guru:</b> <button type="button" data-demo="guru">guru@sekolah.sch.id</button> / guru123</div><div><b>Siswa:</b> <button type="button" data-demo="siswa">siswa@sekolah.sch.id</button> / siswa123</div></div></div>' +
    '<div class="login-foot">© ' + new Date().getFullYear() + ' SIAKAD SISWA | All Rights Reserved<div class="xs">v' + esc(CFG.VERSION || '2.0') + ' — Google Apps Script Edition' + (DEMO ? ' • Mode Demo' : '') + '</div></div>' +
    '</form></div>';
  var f = $('#loginForm');
  function setRole(r) {
    loginRole = r;
    $$('.seg button', f).forEach(function (b) { b.classList.toggle('on', b.dataset.role === r); b.setAttribute('aria-selected', b.dataset.role === r); });
    $('#lgIdLbl').textContent = r === 'guru' ? 'Email / NUPTK' : 'Email / NIS';
    $('#lgId').placeholder = r === 'guru' ? 'Masukkan email guru atau NUPTK' : 'Masukkan Email atau NIS (contoh: 20230101)';
  }
  setRole(Store.get('lastRole', 'siswa'));
  $$('.seg button', f).forEach(function (b) { b.onclick = function () { setRole(b.dataset.role); }; });
  $('.eye', f).onclick = function () { var p = $('#lgPw'); p.type = p.type === 'password' ? 'text' : 'password'; this.innerHTML = ic(p.type === 'password' ? 'eye' : 'eye-off'); };
  $('#lgForgot').onclick = function (e) { e.preventDefault(); forgotFlow($('#lgId').value); };
  $$('[data-demo]', f).forEach(function (b) { b.onclick = function () { setRole(b.dataset.demo); $('#lgId').value = b.textContent; $('#lgPw').value = b.dataset.demo === 'guru' ? 'guru123' : 'siswa123'; $('#lgPw').focus(); }; });
  var remembered = Store.get('lastId', ''); if (remembered) { $('#lgId').value = remembered; $('#lgRemember').checked = true; }
  f.onsubmit = async function (e) {
    e.preventDefault();
    var id = $('#lgId').value.trim(), pw = $('#lgPw').value, btn = $('#lgBtn'), err = $('#lgErr');
    err.hidden = true;
    if (!id || !pw) { err.hidden = false; err.innerHTML = ic('circle-alert') + '<div>Email/NIS dan password wajib diisi.</div>'; return; }
    btnBusy(btn, true);
    var res = await api('login', { id: id, password: pw, role: loginRole, remember: $('#lgRemember').checked, appUrl: DEMO ? '' : location.origin + location.pathname });
    btnBusy(btn, false);
    if (!res.success) { err.hidden = false; err.innerHTML = ic('circle-alert') + '<div>' + esc(res.message) + '</div>'; $('#lgPw').select(); return; }
    Store.set('lastRole', loginRole);
    if ($('#lgRemember').checked) Store.set('lastId', id); else Store.del('lastId');
    var d = res.data;
    Object.assign(AppState, { token: d.token, role: d.role, email: d.email, nama: d.nama, ref: d.ref, exp: d.exp, boot: d.boot });
    saveSession();
    Store.set(userKey('boot'), { t: Date.now(), h: hashStr(JSON.stringify(d.boot)), data: d.boot });
    location.hash = '#/dashboard';
    showApp();
    toast(res.message, 'ok');
    if (d.wajibGantiSandi) setTimeout(function () { gantiPassword(true); }, 400);
  };
  // info publik sekolah (logo & nama) — cache dulu
  var pub = Store.get('public', null);
  function applyPub(p) { if (!p) return; if (p.namaSekolah) $('#loginSchool').textContent = 'SIAKAD SISWA'; if (p.logo) $('#loginLogo').src = p.logo; $('#demoBox').hidden = !(DEMO || p.demo); $('#loginLogo').alt = p.namaSekolah || 'Logo'; }
  applyPub(pub);
  if (DEMO) $('#demoBox').hidden = false;
  api('config.public', {}).then(function (r) { if (r.success) { Store.set('public', r.data); if ($('#loginForm')) applyPub(r.data); } });
}

function forgotFlow(prefill) {
  var m = modal({ title: 'Lupa Password', sub: 'Kode reset dikirim ke WhatsApp orang tua / email terdaftar.', size: 'sm',
    body: '<div id="fg1"><div class="field"><label>Email / NIS / NUPTK</label><input class="inp" name="id" value="' + esc(prefill || '') + '"></div></div>' +
      '<div id="fg2" hidden><div class="note ok" id="fgMsg"></div><div class="field mt16"><label>Kode 6 digit</label><input class="inp mono" name="kode" inputmode="numeric" maxlength="6"></div><div class="field mt12"><label>Password baru</label><input class="inp" name="baru" type="password" minlength="6"></div></div>',
    foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="fgBtn">Kirim Kode</button>' });
  var step = 1;
  $('#fgBtn', m.el).onclick = async function () {
    var btn = this, d = formData(m.el);
    btnBusy(btn, true);
    if (step === 1) {
      var r = await api('auth.forgot', { id: d.id });
      btnBusy(btn, false);
      if (!r.success) return toast(r.message, 'bad');
      if (!r.data.sent) { $('#fg1', m.el).insertAdjacentHTML('beforeend', '<div class="note warn mt12">' + ic('info') + '<div>' + esc(r.message) + '</div></div>'); return; }
      step = 2; $('#fg1', m.el).hidden = true; $('#fg2', m.el).hidden = false; $('#fgMsg', m.el).innerHTML = ic('circle-check') + '<div>' + esc(r.message) + '</div>'; btn.textContent = 'Simpan Password';
    } else {
      var r2 = await api('auth.resetConfirm', { id: d.id, kode: d.kode, baru: d.baru });
      btnBusy(btn, false);
      if (toastRes(r2)) m.close();
    }
  };
}

// ---------------------------------------------------------------- Shell
function showApp() {
  var role = AppState.role, root = $('#root');
  var nav = MENU[role].map(function (m) { return m.sec ? '<div class="side-sec">' + esc(m.sec) + '</div>' : '<a class="nav-a" href="#/' + m.p + '" data-nav="' + m.p + '" title="' + esc(m.t) + '">' + ic(m.i) + '<span>' + esc(m.t) + '</span></a>'; }).join('');
  var bottom = BOTTOM[role].map(function (b) { return '<a href="' + (b[0] === '_menu' ? '#' : '#/' + b[0]) + '" data-bnav="' + b[0] + '">' + ic(b[2]) + '<span>' + b[1] + '</span></a>'; }).join('');
  root.innerHTML = '<div class="shell">' +
    '<aside class="side" aria-label="Navigasi utama"><div class="side-brand"><img class="logo" src="' + LOGO + '" alt=""><div><b>SIAKAD</b><small>' + (role === 'guru' ? 'Siswa Academic' : 'Portal Siswa') + '</small></div></div>' +
    '<nav class="side-nav">' + nav + '</nav>' +
    '<div class="side-user"><span class="av" id="sideAv">' + esc(initials(AppState.nama)) + '</span><div class="grow"><b class="ellipsis" id="sideName">' + esc(AppState.nama) + '</b><small id="sideSub">' + esc((role === 'guru' ? 'NIP. ' : 'NIS. ') + AppState.ref) + '</small></div><button class="btn-ic" id="btnLogout" title="Keluar" aria-label="Keluar">' + ic('log-out') + '</button></div></aside>' +
    '<div class="main">' + (DEMO ? '<div class="demo-ribbon">MODE DEMO<span class="hide-m"> — data contoh tersimpan di browser ini. Isi <span class="kbd">GAS_URL</span> di js/config.js untuk memakai server.</span> <button id="demoReset">Reset data demo</button></div>' : '') +
    '<header class="topbar"><div class="crumb"><img class="logo hide-m" src="' + LOGO + '" alt=""><span class="hide-m">' + (role === 'guru' ? 'Panel Guru' : 'Portal Siswa') + '</span><span class="hide-m muted">/</span><b id="crumbTitle">Dashboard</b></div><div class="sp"></div>' +
    '<button class="btn-ic" id="btnSync" title="Muat ulang data" aria-label="Muat ulang data">' + ic('refresh-cw') + '</button>' +
    '<button class="btn-ic bell" id="btnBell" title="Pengumuman" aria-label="Pengumuman">' + ic('bell') + '<span class="dot" id="bellDot" hidden>0</span></button>' +
    '<button class="me-chip" id="meChip">' + avatar(AppState.nama, '', 'sm') + '<div><b class="ellipsis" style="max-width:160px">' + esc(AppState.nama) + '</b><small>' + (role === 'guru' ? 'Guru Pengampu' : 'Siswa Aktif') + '</small></div></button></header>' +
    '<main class="content" id="content"></main>' +
    '<nav class="bottom-nav" aria-label="Navigasi bawah">' + bottom + '</nav></div></div>';
  $('#btnLogout').onclick = async function () { if (await confirmBox('Keluar dari SIAKAD?', { ok: 'Keluar' })) logout(); };
  $('#meChip').onclick = accountMenu;
  $('#btnBell').onclick = showPengumuman;
  $('#btnSync').onclick = async function () { var b = this; b.querySelector('svg').classList.add('spin'); await refreshBoot(true); b.querySelector('svg').classList.remove('spin'); toast('Data diperbarui.', 'ok'); };
  var bm = $('[data-bnav="_menu"]'); if (bm) bm.onclick = function (e) { e.preventDefault(); moreMenu(); };
  if ($('#demoReset')) $('#demoReset').onclick = async function () { if (await confirmBox('Hapus semua perubahan demo dan kembali ke data contoh awal?', { danger: true, ok: 'Reset' })) { DemoServer.reset(); Store.del('session'); location.hash = ''; location.reload(); } };
  if (AppState.boot) { renderShellMeta(); route(); } else $('#content').innerHTML = skeletonPage();
  refreshBoot();
  if (role === 'guru') prefetchGuru();
}
function skeletonPage() { return '<div class="sk" style="height:60px;max-width:420px"></div><div class="grid g4 mt24">' + '<div class="sk" style="height:140px"></div>'.repeat(4) + '</div><div class="grid g-main mt24"><div class="sk" style="height:320px"></div><div class="sk" style="height:320px"></div></div>'; }
function renderShellMeta() {
  var b = AppState.boot; if (!b) return;
  var me = AppState.role === 'guru' ? b.me : b.profil;
  if (me) {
    var nm = me.nama_lengkap || AppState.nama;
    $('#sideName') && ($('#sideName').textContent = nm);
    var chip = $('#meChip'); if (chip) chip.innerHTML = avatar(nm, me.foto_profil_url, 'sm') + '<div><b class="ellipsis" style="max-width:170px;display:block">' + esc(nm) + '</b><small>' + esc(AppState.role === 'guru' ? (me.jabatan || 'Guru Pengampu') : ('Kelas ' + (me.nama_kelas || '') + ' • NIS ' + me.NIS)) + '</small></div>';
  }
  var seen = Store.get(userKey('annSeen'), 0), baru = (b.pengumuman || []).filter(function (p) { return new Date(p.tanggal).getTime() > seen; }).length;
  var dot = $('#bellDot'); if (dot) { dot.hidden = !baru; dot.textContent = baru; }
}
function setActiveNav(name, def) {
  $$('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.dataset.nav === name); });
  var inBottom = BOTTOM[AppState.role].some(function (b) { return b[0] === name; });
  $$('[data-bnav]').forEach(function (a) { a.classList.toggle('on', a.dataset.bnav === name || (!inBottom && a.dataset.bnav === '_menu')); });
  var item = MENU[AppState.role].filter(function (m) { return m.p === name; })[0];
  if ($('#crumbTitle')) $('#crumbTitle').textContent = item ? item.t : (def.title || '');
}
function moreMenu() {
  var ov = h('<div class="overlay" style="align-items:flex-end;padding:0"></div>');
  var cur = currentRoute().name;
  var sheet = h('<div class="sheet-menu"><div class="grab"></div><div class="gridm">' + MENU[AppState.role].filter(function (m) { return m.p; }).map(function (m) { return '<a href="#/' + m.p + '" class="' + (m.p === cur ? 'on' : '') + '">' + ic(m.i) + esc(m.t) + '</a>'; }).join('') +
    '<a href="#" data-acc>' + ic('user-round-cog') + 'Akun Saya</a><a href="#" data-out>' + ic('log-out') + 'Keluar</a></div></div>');
  function close() { ov.remove(); sheet.remove(); }
  ov.onclick = close;
  sheet.onclick = function (e) { var a = e.target.closest('a'); if (!a) return; if (a.hasAttribute('data-out')) { e.preventDefault(); close(); logout(); return; } if (a.hasAttribute('data-acc')) { e.preventDefault(); close(); accountMenu(); return; } close(); };
  document.body.appendChild(ov); document.body.appendChild(sheet);
}
function accountMenu() {
  if (AppState.role === 'siswa') return go('akun');
  var b = AppState.boot || {}, me = b.me || {};
  var m = modal({ title: 'Akun Saya', size: 'sm',
    body: '<div class="row gap12">' + avatar(me.nama_lengkap || AppState.nama, me.foto_profil_url, 'lg') + '<div><b style="font-size:16px">' + esc(me.nama_lengkap || AppState.nama) + '</b><div class="muted small">' + esc(AppState.email) + '</div><div class="muted small">NIP/NUPTK ' + esc(AppState.ref) + ' • ' + esc(me.mata_pelajaran || '') + '</div></div></div>' +
      '<div class="note mt16">' + ic('clock') + '<div>Sesi berlaku sampai ' + new Date(AppState.exp).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) + '.</div></div>',
    foot: '<button class="btn btn-outline" id="accPw">' + ic('key-round') + 'Ganti Password</button><button class="btn btn-danger" id="accOut">' + ic('log-out') + 'Keluar</button>' });
  $('#accPw', m.el).onclick = function () { m.close(); gantiPassword(false); };
  $('#accOut', m.el).onclick = function () { m.close(); logout(); };
}
function gantiPassword(wajib) {
  var m = modal({ title: wajib ? 'Ganti Password Awal' : 'Ganti Password', sub: wajib ? 'Demi keamanan, ganti password awal Anda sekarang.' : 'Perangkat lain akan otomatis keluar.', size: 'sm', dismiss: !wajib,
    body: '<div class="field"><label>Password lama</label><input class="inp" type="password" name="lama" autocomplete="current-password"></div><div class="field mt12"><label>Password baru</label><input class="inp" type="password" name="baru" autocomplete="new-password" minlength="6"><div class="hint">Minimal 6 karakter.</div></div><div class="field mt12"><label>Ulangi password baru</label><input class="inp" type="password" name="baru2" autocomplete="new-password"></div>',
    foot: (wajib ? '<button class="btn btn-ghost" data-x>Nanti saja</button>' : '<button class="btn btn-outline" data-x>Batal</button>') + '<button class="btn btn-primary" id="pwSave">Simpan</button>' });
  $('#pwSave', m.el).onclick = async function () {
    var d = formData(m.el);
    if (d.baru !== d.baru2) return toast('Ulangi password baru tidak sama.', 'bad');
    btnBusy(this, true);
    var r = await api('me.password', { lama: d.lama, baru: d.baru });
    btnBusy(this, false);
    if (toastRes(r)) { AppState.token = r.data.token; AppState.exp = r.data.exp; saveSession(); m.close(); }
  };
}
function showPengumuman() {
  var list = (AppState.boot && AppState.boot.pengumuman) || [];
  Store.set(userKey('annSeen'), Date.now()); renderShellMeta();
  var m = modal({ title: 'Pengumuman Sekolah', sub: list.length + ' pengumuman aktif', drawer: true,
    body: list.length ? list.map(function (p, i) { return '<div class="ann ' + (i % 2 ? 'amber' : '') + '"><div class="meta"><span>' + relTime(p.tanggal) + '</span><span class="bdg ' + (p.kategori === 'Event' ? 'amber' : 'info') + '">' + esc(String(p.kategori || '').toUpperCase()) + '</span></div><h4>' + esc(p.judul) + '</h4><p style="white-space:pre-line">' + esc(p.isi) + '</p></div>'; }).join('') : emptyHtml('Belum ada pengumuman', '', 'megaphone'),
    foot: AppState.role === 'guru' ? '<button class="btn btn-primary" id="annNew">' + ic('plus') + 'Buat Pengumuman</button>' : '' });
  if ($('#annNew', m.el)) $('#annNew', m.el).onclick = function () { m.close(); editPengumuman(); };
}

/** Prefetch menu admin saat idle — 1 panggilan batch (Prinsip 3) */
function prefetchGuru() {
  var run = function () {
    api('batch', { calls: [{ action: 'notif.config' }, { action: 'crm.stats' }, { action: 'wa.blastList' }, { action: 'config.get' }] }).then(function (res) {
      if (!res.success) return;
      Object.keys(res.data).forEach(function (a) { var r = res.data[a]; if (r.success) Store.set(userKey('a:' + a), { t: Date.now(), h: hashStr(JSON.stringify(r.data)), data: r.data }); });
    });
  };
  (window.requestIdleCallback || function (f) { setTimeout(f, 1500); })(run, { timeout: 4000 });
}
