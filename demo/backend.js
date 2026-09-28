/* MODE DEMO: salinan backend Apps Script (backend/*.gs) yang dijalankan di browser. Dibuat otomatis oleh tools/build.js. */
// ==== Kode.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA — Backend REST API (Google Apps Script)
 *  File 1/5 : Kode.gs  — konfigurasi, router, auth, database, cache, setup
 *
 *  Arsitektur : GAS sebagai pure REST API (ContentService JSON).
 *               Frontend statis (GitHub Pages) memanggil via fetch().
 *  Performa   : gas-instant-ux-pro (login = bootstrap, cache berlapis,
 *               memo per eksekusi, antrean log, idempotensi reqId, lock singkat).
 *  File lain  : Akademik.gs, Migrasi.gs, Notifikasi.gs, CRM.gs
 * =====================================================================
 */

// ---------------------------------------------------------------------
// 1. KONFIGURASI
// ---------------------------------------------------------------------
var APP = {
  NAME: 'SIAKAD SISWA',
  VERSION: '2.0.0',
  TZ: 'Asia/Jakarta',
  SCHEMA_VERSION: 1,
  TOKEN_TTL_MS: 8 * 3600 * 1000,       // PRD US-01: sesi 8 jam
  REMEMBER_TTL_MS: 7 * 24 * 3600 * 1000, // "Ingat saya" = 7 hari
  SLOW_MS: 3000,
  DEMO_PASSWORD_GURU: 'guru123',
  DEMO_PASSWORD_SISWA: 'siswa123'
};

var PROPS = PropertiesService.getScriptProperties();

/** ID environment dibaca dari Script Properties (diisi setupAppEnvironment) */
var CONFIG = {
  get SPREADSHEET_ID() { return PROPS.getProperty('SPREADSHEET_ID'); },
  get ROOT_FOLDER_ID() { return PROPS.getProperty('ROOT_FOLDER_ID'); },
  get MATERI_FOLDER()  { return PROPS.getProperty('MATERI_FOLDER'); },
  get SELFIE_FOLDER()  { return PROPS.getProperty('SELFIE_FOLDER'); },
  get ASET_FOLDER()    { return PROPS.getProperty('ASET_FOLDER'); },
  get EXPORTS_FOLDER() { return PROPS.getProperty('EXPORTS_FOLDER'); }
};

/** Skema database. Semua kolom diformat teks '@' agar 0 di depan & tanggal tidak berubah. */
var SCHEMA = {
  Config:        { key: 'key', cols: ['key', 'value', 'keterangan'] },
  Users:         { key: 'user_id', prefix: 'USR', cols: ['user_id', 'nama', 'email', 'password_hash', 'salt', 'role', 'ref_id', 'kelas_id', 'status_aktif', 'wajib_ganti_sandi', 'last_login', 'dibuat_pada'] },
  Siswa:         { key: 'NIS', cols: ['NIS', 'NISN', 'nama_lengkap', 'jenis_kelamin', 'kelas_id', 'jenjang', 'barcode_id', 'email', 'no_wa', 'nama_ortu', 'no_wa_ortu', 'tempat_lahir', 'tanggal_lahir', 'alamat', 'foto_profil_url', 'tahun_masuk', 'status', 'StatusWA', 'CekWAAt', 'dibuat_pada'] },
  Guru:          { key: 'NUPTK', cols: ['NUPTK', 'nama_lengkap', 'email', 'no_wa', 'mata_pelajaran', 'jabatan', 'foto_profil_url', 'status', 'StatusWA', 'CekWAAt', 'dibuat_pada'] },
  Kelas:         { key: 'kelas_id', prefix: 'KLS', cols: ['kelas_id', 'nama_kelas', 'jenjang', 'tingkat', 'wali_kelas_id', 'tahun_ajaran'] },
  Mapel:         { key: 'mapel_id', prefix: 'MPL', cols: ['mapel_id', 'nama', 'kode', 'kelompok', 'jenjang'] },
  Jadwal:        { key: 'jadwal_id', prefix: 'JDW', cols: ['jadwal_id', 'kelas_id', 'mata_pelajaran', 'guru_id', 'hari', 'jam_mulai', 'jam_selesai', 'ruang'] },
  Absensi:       { key: 'absensi_id', prefix: 'ABS', cols: ['absensi_id', 'NIS', 'kelas_id', 'tanggal', 'jam', 'status', 'metode', 'latitude', 'longitude', 'jarak_m', 'foto_selfie_id', 'keterangan', 'terlambat', 'dicatat_oleh', 'dibuat_pada'] },
  Materi:        { key: 'materi_id', prefix: 'MTR', cols: ['materi_id', 'judul', 'deskripsi', 'mata_pelajaran', 'kelas_id', 'guru_id', 'tipe', 'url_konten', 'drive_file_id', 'ukuran', 'durasi', 'tanggal_upload', 'status'] },
  MateriAkses:   { key: 'akses_id', prefix: 'AKS', cols: ['akses_id', 'materi_id', 'NIS', 'waktu'] },
  Nilai:         { key: 'nilai_id', prefix: 'NIL', cols: ['nilai_id', 'NIS', 'kelas_id', 'mata_pelajaran', 'guru_id', 'semester', 'tahun_ajaran', 'nilai_harian', 'nilai_uts', 'nilai_uas', 'nilai_akhir', 'predikat', 'catatan', 'diperbarui_pada'] },
  Pengumuman:    { key: 'pengumuman_id', prefix: 'PNG', cols: ['pengumuman_id', 'judul', 'isi', 'kategori', 'tanggal', 'oleh', 'status'] },
  Logs:          { key: 'log_id', cols: ['log_id', 'timestamp', 'email', 'role', 'action', 'detail', 'target'] },
  // --- Modul Notifikasi & CRM (gas-notifikasi-wa-crm) ---
  AntrianNotif:  { key: 'AntrianID', prefix: 'ANT', cols: ['AntrianID', 'Kanal', 'Tujuan', 'NamaPenerima', 'Subjek', 'Pesan', 'Event', 'RefID', 'BlastID', 'Status', 'Percobaan', 'Respon', 'DibuatPada', 'DikirimPada'] },
  BlastWA:       { key: 'BlastID', prefix: 'BLW', cols: ['BlastID', 'Judul', 'Pesan', 'Sasaran', 'Total', 'Terkirim', 'Gagal', 'UkuranBatch', 'JedaDetik', 'Status', 'DibuatOleh', 'Tanggal', 'SelesaiPada'] },
  CRM_Kontak:    { key: 'KontakID', prefix: 'KTK', cols: ['KontakID', 'Nama', 'Email', 'NoWA', 'Segmen', 'Sumber', 'RefID', 'Tag', 'StatusWA', 'CekWAAt', 'EmailValid', 'OptOut', 'Catatan', 'JumlahPesan', 'TerakhirDihubungi', 'Info', 'DibuatPada', 'DiperbaruiPada'] },
  CRM_Interaksi: { key: 'InteraksiID', prefix: 'INT', cols: ['InteraksiID', 'KontakID', 'Kanal', 'Arah', 'Ringkasan', 'RefID', 'Oleh', 'Tanggal'] }
};

/** Kolom angka — dikembalikan sebagai Number saat dibaca */
var NUMERIC_COLS = { nilai_harian: 1, nilai_uts: 1, nilai_uas: 1, nilai_akhir: 1, jarak_m: 1, latitude: 1, longitude: 1, Percobaan: 1, Total: 1, Terkirim: 1, Gagal: 1, UkuranBatch: 1, JumlahPesan: 1, ukuran: 1 };

/** Seed pengaturan (key, value, keterangan). Ditambah idempoten oleh setup/upgrade. */
var CONFIG_SEED = [
  ['NAMA_SEKOLAH', 'SMA Negeri Unggulan Indonesia', 'Nama sekolah'],
  ['ALAMAT_SEKOLAH', 'Jl. Pendidikan No. 1, Jakarta', 'Alamat sekolah'],
  ['LOGO_URL', '', 'URL logo sekolah (kosong = logo bawaan)'],
  ['LAT_SEKOLAH', '-6.2088', 'Latitude titik pusat sekolah'],
  ['LNG_SEKOLAH', '106.8456', 'Longitude titik pusat sekolah'],
  ['RADIUS_M', '100', 'Radius absensi (meter)'],
  ['GPS_WAJIB_SCAN', 'YA', 'YA/TIDAK — validasi GPS guru saat scan barcode'],
  ['JAM_MASUK', '07:15', 'Batas jam masuk (lewat = terlambat)'],
  ['JAM_PULANG', '14:30', 'Jam pulang'],
  ['AUTO_ALPHA_JAM', '', 'Jam otomatis menandai Alpha (kosong = nonaktif), contoh 10:00'],
  ['TAHUN_AJARAN', '2026/2027', 'Tahun ajaran aktif'],
  ['SEMESTER', 'Ganjil', 'Semester aktif (Ganjil/Genap)'],
  ['SEMESTER_MULAI', '2026-07-13', 'Tanggal mulai semester (yyyy-MM-dd)'],
  ['SEMESTER_SELESAI', '2026-12-19', 'Tanggal akhir semester (yyyy-MM-dd)'],
  ['KKM', '70', 'Batas tuntas (PRD: Tuntas >= 70)'],
  ['BOBOT_HARIAN', '40', 'Bobot nilai harian (%)'],
  ['BOBOT_UTS', '30', 'Bobot nilai UTS (%)'],
  ['BOBOT_UAS', '30', 'Bobot nilai UAS (%)'],
  ['BATAS_KEHADIRAN', '75', 'Batas % kehadiran (di bawah = perlu perhatian)'],
  ['EMAIL_DOMAIN_SISWA', 'siswa.sch.id', 'Domain email otomatis akun siswa'],
  ['MATERI_MAKS_MB', '20', 'Batas ukuran upload materi (MB)'],
  // --- notifikasi (gas-notifikasi-wa-crm) ---
  ['NOTIF_WA_AKTIF', 'TIDAK', 'YA/TIDAK — saklar utama WhatsApp (Fonnte)'],
  ['NOTIF_EMAIL_AKTIF', 'TIDAK', 'YA/TIDAK — saklar utama Email'],
  ['NOTIF_MATRIKS', '', 'JSON matriks event x kanal (diatur dari menu)'],
  ['WA_BATCH_DEFAULT', '20', 'Ukuran batch blast (10/20/50)'],
  ['WA_JEDA_DETIK', '5', 'Jeda antarpesan, boleh acak "3-8"'],
  ['WA_DETEKSI_OTOMATIS', 'YA', 'Cek otomatis nomor kontak baru terdaftar WA'],
  ['EMAIL_NAMA_PENGIRIM', 'SIAKAD SISWA', 'Nama pengirim email'],
  ['APP_URL', '', 'URL app untuk {link} — terisi otomatis saat guru login'],
  ['CRM_SYNC_MENIT', '30', 'Interval sinkron otomatis CRM (menit)']
];

// ---------------------------------------------------------------------
// 2. ENTRY POINTS
// ---------------------------------------------------------------------
function doGet(e) {
  resetMemo_();
  var p = (e && e.parameter) || {};
  var res;
  try {
    if (p.action === 'config.public') res = apiConfigPublic({}, {});
    else res = ok_({ app: APP.NAME, version: APP.VERSION, time: nowIso_(), ready: !!CONFIG.SPREADSHEET_ID }, 'pong');
  } catch (err) { res = fail_(err.message); }
  return json_(res);
}

/** Reset memo per eksekusi (di GAS asli tiap request sudah bersih; penting untuk mode demo) */
function resetMemo_() { _ROWS = {}; _SETTINGS = null; _ABS_IDX = null; _IN_LOCK = false; }

function doPost(e) {
  resetMemo_();
  var t0 = Date.now(), body = {}, res;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    res = dispatch_(body);
  } catch (err) {
    res = fail_(err && err.message ? err.message : String(err));
  }
  res.ms = Date.now() - t0;
  if (res.ms > APP.SLOW_MS) { try { queueLog_(['', 'SYSTEM', 'SLOW', (body.action || '') + ' ' + res.ms + 'ms', '']); } catch (x) {} }
  return json_(res);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function ok_(data, message) { return { success: true, message: message || 'OK', data: data === undefined ? null : data }; }
function fail_(message, data) { return { success: false, message: message || 'Terjadi kesalahan.', data: data || null }; }

// ---------------------------------------------------------------------
// 3. ROUTER — auth: public | any | guru | siswa ; write: pakai lock + idempotensi
// ---------------------------------------------------------------------
var _ROUTES = null;
function routes_() {
  if (_ROUTES) return _ROUTES;
  var R = {};
  function add(name, fn, auth, write) { R[name] = { fn: fn, auth: auth, write: !!write }; }
  // --- publik ---
  add('ping', function () { return ok_({ time: nowIso_(), version: APP.VERSION }); }, 'public');
  add('config.public', apiConfigPublic, 'public');
  add('login', apiLogin, 'public');
  add('auth.forgot', apiForgot, 'public');
  add('auth.resetConfirm', apiResetConfirm, 'public', true);
  // --- semua user login ---
  add('me.password', apiChangePassword, 'any', true);
  add('batch', apiBatch, 'any');
  // --- siswa ---
  add('siswa.bootstrap', apiSiswaBootstrap, 'siswa');
  add('absensi.self', apiAbsenSelf, 'siswa', true);
  add('materi.view', apiMateriView, 'any');
  // --- guru (super admin) ---
  add('guru.bootstrap', apiGuruBootstrap, 'guru');
  add('siswa.save', apiSiswaSave, 'guru', true);
  add('siswa.delete', apiSiswaDelete, 'guru', true);
  add('siswa.resetPassword', apiSiswaResetPassword, 'guru', true);
  add('siswa.bulk', apiSiswaBulk, 'guru', true);
  add('guru.save', apiGuruSave, 'guru', true);
  add('guru.delete', apiGuruDelete, 'guru', true);
  add('master.save', apiMasterSave, 'guru', true);
  add('master.delete', apiMasterDelete, 'guru', true);
  add('config.get', apiConfigGet, 'guru');
  add('config.save', apiConfigSave, 'guru', true);
  add('absensi.scan', apiAbsenScan, 'guru', true);
  add('absensi.manual', apiAbsenManual, 'guru', true);
  add('absensi.finalize', apiAbsenFinalize, 'guru', true);
  add('absensi.list', apiAbsenList, 'guru');
  add('absensi.foto', apiAbsenFoto, 'guru');
  add('materi.save', apiMateriSave, 'guru', true);
  add('materi.delete', apiMateriDelete, 'guru', true);
  add('nilai.list', apiNilaiList, 'guru');
  add('nilai.saveBatch', apiNilaiSaveBatch, 'guru', true);
  add('laporan.export', apiLaporanExport, 'guru', true);
  add('logs.list', apiLogsList, 'guru');
  add('demo.clear', apiDemoClear, 'guru', true);
  // --- migrasi (gas-migrasi-database) ---
  add('migrasi.scan', apiMigrasiScan, 'guru');
  add('migrasi.run', apiMigrasiRun, 'guru', true);
  add('migrasi.csv', apiMigrasiCsv, 'guru', true);
  // --- notifikasi (gas-notifikasi-wa-crm) ---
  add('notif.config', svcNotifConfig, 'guru');
  add('notif.configSave', svcNotifConfigSave, 'guru', true);
  add('notif.queue', svcNotifQueue, 'guru');
  add('notif.processNow', svcNotifProcessNow, 'guru');
  add('notif.retry', svcNotifRetry, 'guru', true);
  add('wa.device', svcWaDevice, 'guru');
  add('wa.test', svcWaTest, 'guru');
  add('email.test', svcEmailTest, 'guru');
  add('wa.validate', svcWaValidate, 'guru');
  add('wa.audience', svcWaAudience, 'guru');
  add('wa.blastCreate', svcWaBlastCreate, 'guru', true);
  add('wa.blastList', svcWaBlastList, 'guru');
  add('wa.blastProcess', svcWaBlastProcess, 'guru');
  add('wa.blastStop', svcWaBlastStop, 'guru', true);
  // --- CRM ---
  add('crm.list', svcCrmList, 'guru');
  add('crm.stats', svcCrmStats, 'guru');
  add('crm.detail', svcCrmDetail, 'guru');
  add('crm.sync', svcCrmSync, 'guru', true);
  add('crm.save', svcCrmSave, 'guru', true);
  add('crm.bulk', svcCrmBulk, 'guru', true);
  add('crm.interaksi', svcCrmInteraksi, 'guru', true);
  add('crm.import', svcCrmImport, 'guru', true);
  add('crm.merge', svcCrmMerge, 'guru', true);
  add('crm.export', svcCrmExport, 'guru');
  return (_ROUTES = R);
}

/** Aksi yang diaudit ke Logs (lewat antrean) */
var AUDIT_ACTIONS = /^(siswa\.(save|delete|resetPassword|bulk)|guru\.(save|delete)|master\.(save|delete)|config\.save|materi\.(save|delete)|nilai\.saveBatch|absensi\.(manual|finalize)|migrasi\.(run|csv)|notif\.configSave|wa\.(blastCreate|blastStop)|crm\.(bulk|merge|import|export)|laporan\.export|demo\.clear)$/;

function authorized_(route, ctx) {
  if (route.auth === 'public') return true;
  if (!ctx.session) return false;
  if (route.auth === 'any') return true;
  return ctx.session.role === route.auth;
}

function dispatch_(body) {
  var r = routes_()[body.action];
  if (!r) return fail_('Aksi tidak dikenal: ' + body.action);
  if (r.auth !== 'public' && !CONFIG.SPREADSHEET_ID) return fail_('Server belum di-setup. Jalankan setupAppEnvironment() di editor Apps Script.');
  var ctx = { session: r.auth === 'public' ? null : verifyToken_(body.token), reqId: String(body.reqId || ''), after: [], action: body.action };
  if (!authorized_(r, ctx)) return fail_(ctx.session ? 'Akses ditolak untuk peran Anda.' : 'Sesi berakhir, silakan login ulang.', { code: ctx.session ? 'FORBIDDEN' : 'AUTH' });
  var data = body.data || {};
  var res;
  if (!r.write) {
    res = r.fn(ctx, data);
  } else {
    res = withLock_(function () {
      var c = CacheService.getScriptCache(), k = ctx.reqId && ('idem_' + ctx.reqId);
      var hit = k && c.get(k);
      if (hit) return JSON.parse(hit);                          // permintaan ulang → hasil sama
      var out = r.fn(ctx, data);
      if (k && out.success) { var s = JSON.stringify(out); if (s.length < 90000) c.put(k, s, 21600); }
      return out;
    });
  }
  if (res && res.success && AUDIT_ACTIONS.test(body.action) && ctx.session) {
    queueLog_([ctx.session.email, ctx.session.role, body.action, auditDetail_(body.action, data), '']);
  }
  ctx.after.forEach(function (fn) { try { fn(); } catch (e) { console.error('after: ' + e.message); } });  // di luar lock
  return res;
}

function auditDetail_(action, d) {
  var o = {};
  ['NIS', 'NUPTK', 'sheet', 'id', 'materi_id', 'kelas_id', 'mata_pelajaran', 'judul', 'aksi', 'blastId'].forEach(function (k) { if (d[k] !== undefined) o[k] = d[k]; });
  if (d.data && d.data.NIS) o.NIS = d.data.NIS;
  if (d.rows && d.rows.length) o.rows = d.rows.length;
  return JSON.stringify(o).substring(0, 400);
}

var _IN_LOCK = false;
function withLock_(fn) {
  if (_IN_LOCK) return fn();                               // sudah memegang lock (panggilan bersarang)
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return fail_('Server sedang sibuk, coba lagi sebentar.', { retryable: true });
  _IN_LOCK = true;
  try { return fn(); }
  finally { _IN_LOCK = false; flushPendingWrites_(); lock.releaseLock(); }
}
/** Bagikan file "siapa saja yang punya link" — bisa ditolak kebijakan domain Workspace, maka tidak fatal */
function shareLink_(f) { try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { console.warn('setSharing ditolak: ' + e.message); } return f; }
function flushPendingWrites_() { try { SpreadsheetApp.flush(); } catch (e) {} }

function apiBatch(ctx, d) {
  var out = {};
  (d.calls || []).slice(0, 8).forEach(function (c) {
    var r = routes_()[c.action];
    if (!r || r.write || c.action === 'batch' || !authorized_(r, ctx)) { out[c.action] = fail_('Tidak diizinkan dalam batch.'); return; }
    try { out[c.action] = r.fn(ctx, c.data || {}); } catch (e) { out[c.action] = fail_(e.message); }
  });
  return ok_(out);
}

// ---------------------------------------------------------------------
// 4. AUTENTIKASI — token HMAC stateless (tidak memenuhi Script Properties)
// ---------------------------------------------------------------------
function secret_() {
  var s = PROPS.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); PROPS.setProperty('TOKEN_SECRET', s); }
  return s;
}
function b64u_(bytesOrStr) { return Utilities.base64EncodeWebSafe(bytesOrStr).replace(/=+$/, ''); }
function sign_(s) { return b64u_(Utilities.computeHmacSha256Signature(s, secret_())); }
function signToken_(p) {
  var body = b64u_(Utilities.newBlob(JSON.stringify(p)).getBytes());
  return body + '.' + sign_(body);
}
function verifyToken_(t) {
  try {
    var parts = String(t || '').split('.');
    if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) return null;
    var b = parts[0]; while (b.length % 4) b += '=';
    var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b)).getDataAsString());
    if (!p.x || p.x < Date.now()) return null;
    var rev = Number(CacheService.getScriptCache().get('rev_' + p.e) || PROPS.getProperty('REV_' + p.e) || 0);
    if (p.i < rev) return null;
    return { email: p.e, role: p.r, ref: p.f, uid: p.u, exp: p.x };
  } catch (e) { return null; }
}
function revokeAll_(email) {
  var t = String(Date.now());
  PROPS.setProperty('REV_' + email, t);
  CacheService.getScriptCache().put('rev_' + email, t, 21600);
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) { var v = (b + 256) % 256; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}
function sha256Bytes_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8); }
function hashPassword_(pw, salt) { return bytesToHex_(sha256Bytes_(String(salt || '') + String(pw))); }
/** Cocokkan hash hex (format app ini) atau base64 (format app lama bila berbeda) */
function verifyPassword_(pw, user) {
  var stored = String(user.password_hash || '').trim();
  if (!stored) return false;
  var bytes = sha256Bytes_(String(user.salt || '') + String(pw));
  return stored.toLowerCase() === bytesToHex_(bytes) || stored === Utilities.base64Encode(bytes);
}
function randomPassword_(n) {
  var chars = 'abcdefghjkmnpqrstuvwxyz23456789', s = '';
  var u = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  for (var i = 0; i < (n || 8); i++) s += chars[parseInt(u.substr(i * 2, 2), 16) % chars.length];
  return s;
}
function newSalt_() { return Utilities.getUuid().replace(/-/g, '').substring(0, 16); }

function apiConfigPublic(ctx, d) {
  var ready = !!CONFIG.SPREADSHEET_ID;
  var cfg = ready ? settings_() : {};
  return ok_({
    ready: ready, version: APP.VERSION,
    namaSekolah: cfg.NAMA_SEKOLAH || APP.NAME, logo: cfg.LOGO_URL || '',
    demo: ready && PROPS.getProperty('DEMO_SEEDED') === '1'
  });
}

function apiLogin(ctx, d) {
  var id = String(d.id || '').trim().toLowerCase(), pw = String(d.password || '');
  if (!id || !pw) return fail_('Email/NIS dan password wajib diisi.');
  var cache = CacheService.getScriptCache(), fk = 'fail_' + id.replace(/[^a-z0-9@._-]/g, '');
  var fails = Number(cache.get(fk) || 0);
  if (fails >= 5) return fail_('Terlalu banyak percobaan gagal. Coba lagi dalam 10 menit.');
  var u = findUser_(id);
  if (!u || !verifyPassword_(pw, u)) {
    cache.put(fk, String(fails + 1), 600);
    return fail_('Email atau password salah.');
  }
  if (String(u.status_aktif).toUpperCase() !== 'YA') return fail_('Akun belum aktif / dinonaktifkan. Hubungi guru atau admin sekolah.');
  if (d.role && d.role !== u.role) return fail_('Akun ini terdaftar sebagai ' + (u.role === 'guru' ? 'Guru / Admin' : 'Siswa') + '. Pilih tab yang sesuai.');
  cache.remove(fk);
  var now = Date.now();
  var token = signToken_({ e: lower_(u.email), r: u.role, f: String(u.ref_id), u: u.user_id, i: now, x: now + (d.remember ? APP.REMEMBER_TTL_MS : APP.TOKEN_TTL_MS) });
  touchLastLogin_(u);
  if (u.role === 'guru' && d.appUrl && !setting_('APP_URL', '')) { try { withLock_(function () { saveSettings_({ APP_URL: String(d.appUrl).split('#')[0] }); return ok_(); }); } catch (e) {} }
  queueLog_([lower_(u.email), u.role, 'LOGIN', '', '']);
  var sess = { email: lower_(u.email), role: u.role, ref: String(u.ref_id), uid: u.user_id };
  var fakeCtx = { session: sess };
  var boot = u.role === 'guru' ? apiGuruBootstrap(fakeCtx, {}).data : apiSiswaBootstrap(fakeCtx, {}).data;
  return ok_({
    token: token, role: u.role, email: lower_(u.email), nama: u.nama, ref: String(u.ref_id),
    wajibGantiSandi: String(u.wajib_ganti_sandi).toUpperCase() === 'YA',
    exp: now + (d.remember ? APP.REMEMBER_TTL_MS : APP.TOKEN_TTL_MS),
    boot: boot                                          // login = bootstrap (1 panggilan)
  }, 'Selamat datang, ' + u.nama + '!');
}

function findUser_(id) {
  id = String(id || '').trim().toLowerCase();
  var users = DB.all('Users');
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (lower_(u.email) === id || lower_(u.ref_id) === id) return u;
  }
  return null;
}
function touchLastLogin_(u) {
  if (Date.now() - new Date(u.last_login || 0).getTime() > 6 * 3600e3) {
    try { withLock_(function () { DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, last_login: nowIso_() }]); return ok_(); }); } catch (e) {}
  }
}

function apiChangePassword(ctx, d) {
  var u = findUser_(ctx.session.email);
  if (!u) return fail_('Akun tidak ditemukan.');
  if (!verifyPassword_(String(d.lama || ''), u)) return fail_('Password lama salah.');
  var baru = String(d.baru || '');
  if (baru.length < 6) return fail_('Password baru minimal 6 karakter.');
  var salt = newSalt_();
  DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, password_hash: hashPassword_(baru, salt), salt: salt, wajib_ganti_sandi: 'TIDAK' }]);
  revokeAll_(lower_(u.email));
  var now = Date.now() + 1;
  var token = signToken_({ e: lower_(u.email), r: u.role, f: String(u.ref_id), u: u.user_id, i: now, x: now + APP.TOKEN_TTL_MS });
  return ok_({ token: token, exp: now + APP.TOKEN_TTL_MS }, 'Password berhasil diganti. Perangkat lain otomatis keluar.');
}

/** Lupa password: kirim kode 6 digit ke WA/Email terdaftar (butuh modul notifikasi aktif) */
function apiForgot(ctx, d) {
  var u = findUser_(d.id);
  var generic = 'Jika akun ditemukan dan kontak terdaftar, kode reset telah dikirim via WhatsApp/Email. Bila tidak menerima, hubungi wali kelas / admin.';
  if (!u) return ok_({ sent: false }, generic);
  var c = CacheService.getScriptCache(), rk = 'rst_' + lower_(u.email);
  if (c.get(rk + '_t')) return ok_({ sent: false }, 'Kode sudah dikirim. Tunggu 2 menit sebelum meminta lagi.');
  var kode = String(100000 + (parseInt(Utilities.getUuid().replace(/-/g, '').substring(0, 8), 16) % 900000));
  c.put(rk, kode, 900); c.put(rk + '_t', '1', 120);
  var kontak = kontakUser_(u);
  var n = withLock_(function () { return ok_(kirimNotif_('RESET_SANDI', kontak, { kode: kode }, u.user_id)); }).data;
  return ok_({ sent: n > 0 }, n > 0 ? generic : 'Notifikasi belum aktif di sekolah ini. Hubungi wali kelas / admin untuk reset password.');
}
function apiResetConfirm(ctx, d) {
  var u = findUser_(d.id);
  if (!u) return fail_('Kode tidak valid atau kedaluwarsa.');
  var c = CacheService.getScriptCache(), rk = 'rst_' + lower_(u.email);
  if (!c.get(rk) || c.get(rk) !== String(d.kode || '').trim()) return fail_('Kode tidak valid atau kedaluwarsa.');
  var baru = String(d.baru || '');
  if (baru.length < 6) return fail_('Password baru minimal 6 karakter.');
  var salt = newSalt_();
  DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, password_hash: hashPassword_(baru, salt), salt: salt, wajib_ganti_sandi: 'TIDAK' }]);
  c.remove(rk); revokeAll_(lower_(u.email));
  return ok_(null, 'Password berhasil direset. Silakan login.');
}
/** Kontak notifikasi untuk seorang user: siswa → WA orang tua + email siswa; guru → WA + email guru */
function kontakUser_(u) {
  if (u.role === 'siswa') {
    var s = DB.find('Siswa', 'NIS', u.ref_id) || {};
    return { nama: s.nama_lengkap || u.nama, hp: s.no_wa_ortu || s.no_wa, email: s.email || u.email };
  }
  var g = DB.find('Guru', 'NUPTK', u.ref_id) || {};
  return { nama: g.nama_lengkap || u.nama, hp: g.no_wa, email: g.email || u.email };
}

// ---------------------------------------------------------------------
// 5. DATABASE — memo per eksekusi, batch setValues, semua kolom teks
// ---------------------------------------------------------------------
var _SS = null, _ROWS = {}, _SETTINGS = null;
function getSS_() { return _SS || (_SS = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)); }
function getSheet_(name) {
  var sh = getSS_().getSheetByName(name);
  if (!sh) {                                               // upgrade aditif: sheet baru dibuat otomatis
    if (!SCHEMA[name]) throw new Error('Sheet tidak dikenal: ' + name);
    sh = createSheet_(getSS_(), name);
  }
  return sh;
}
function createSheet_(ss, name) {
  var cols = SCHEMA[name].cols, sh = ss.insertSheet(name);
  sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#1E3A5F').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}

function normCell_(col, v) {
  if (v instanceof Date) {
    if (/tanggal$|^tanggal/.test(col)) return Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd');
    if (/^jam/.test(col)) return Utilities.formatDate(v, APP.TZ, 'HH:mm');
    return v.toISOString();
  }
  if (NUMERIC_COLS[col]) return v === '' || v === null ? '' : Number(v);
  if (/^(no_wa|no_wa_ortu|NoWA)$/.test(col)) return hp08_(v);
  if (v === null || v === undefined) return '';
  return typeof v === 'number' ? String(v) : v;
}

var DB = {
  all: function (name) {
    if (_ROWS[name]) return _ROWS[name];
    var sh = getSheet_(name), v = sh.getDataRange().getValues();
    var h = v[0].map(String), out = [];
    for (var r = 1; r < v.length; r++) {
      if (v[r].join('') === '') continue;
      var o = {};
      for (var i = 0; i < h.length; i++) if (h[i]) o[h[i]] = normCell_(h[i], v[r][i]);
      out.push(o);
    }
    return (_ROWS[name] = out);
  },
  find: function (name, col, val) {
    var s = String(val), rows = DB.all(name);
    for (var i = 0; i < rows.length; i++) if (String(rows[i][col]) === s) return rows[i];
    return null;
  },
  headers_: function (sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); },
  /** Tambah banyak baris: 1× setValues */
  appendBatch: function (name, objs) {
    if (!objs || !objs.length) return 0;
    var sh = getSheet_(name), h = DB.headers_(sh);
    var rows = objs.map(function (o) { return h.map(function (k) { var v = o[k]; return v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }); });
    var start = sh.getLastRow() + 1, need = start + rows.length - 1, max = sh.getMaxRows();
    if (need > max) {
      sh.insertRowsAfter(max, need - max + 100);
      sh.getRange(max + 1, 1, need - max + 100, h.length).setNumberFormat('@');
    }
    sh.getRange(start, 1, rows.length, h.length).setValues(rows);
    delete _ROWS[name];
    return rows.length;
  },
  /** Ubah banyak baris (patches = [{keyCol: id, kolom: nilai}]) → 1 blok kontigu */
  updateBatch: function (name, keyCol, patches) {
    if (!patches || !patches.length) return 0;
    var sh = getSheet_(name), v = sh.getDataRange().getValues(), h = v[0].map(String), ki = h.indexOf(keyCol);
    var map = {}; patches.forEach(function (p) { map[String(p[keyCol])] = Object.assign(map[String(p[keyCol])] || {}, p); });
    var min = Infinity, max = -1, n = 0;
    for (var i = 1; i < v.length; i++) {
      var p = map[String(v[i][ki])]; if (!p) continue;
      Object.keys(p).forEach(function (k) { var c = h.indexOf(k); if (c > -1 && k !== keyCol) v[i][c] = p[k] === null || p[k] === undefined ? '' : (typeof p[k] === 'object' ? JSON.stringify(p[k]) : String(p[k])); });
      min = Math.min(min, i); max = Math.max(max, i); n++;
    }
    if (max > -1) sh.getRange(min + 1, 1, max - min + 1, h.length).setValues(v.slice(min, max + 1));
    delete _ROWS[name];
    return n;
  },
  /** Hapus baris dengan kunci tertentu: filter di memori, tulis ulang blok, bersihkan sisa */
  deleteWhere: function (name, keyCol, keys) {
    var set = {}; (keys || []).forEach(function (k) { set[String(k)] = 1; });
    var sh = getSheet_(name), v = sh.getDataRange().getValues(), h = v[0], ki = h.map(String).indexOf(keyCol);
    var keep = [v[0]], removed = 0;
    for (var i = 1; i < v.length; i++) { if (set[String(v[i][ki])]) removed++; else keep.push(v[i]); }
    if (!removed) return 0;
    sh.getRange(1, 1, keep.length, h.length).setValues(keep);
    sh.getRange(keep.length + 1, 1, removed, h.length).clearContent();
    delete _ROWS[name];
    return removed;
  },
  /** Upsert berdasarkan fungsi kunci; mengembalikan {inserted, updated} */
  upsert: function (name, keyFn, objs) {
    var idx = {}, keyCol = SCHEMA[name].key;
    DB.all(name).forEach(function (r) { idx[keyFn(r)] = r; });
    var ins = [], upd = [];
    objs.forEach(function (o) {
      var ex = idx[keyFn(o)];
      if (ex) upd.push(Object.assign({}, o, (function () { var t = {}; t[keyCol] = ex[keyCol]; return t; })()));
      else ins.push(o);
    });
    if (ins.length && SCHEMA[name].prefix) {
      var need = ins.filter(function (o) { return !o[keyCol]; });
      var ids = reserveIds_(name, need.length);
      need.forEach(function (o, i) { o[keyCol] = ids[i]; });
    }
    DB.appendBatch(name, ins);
    DB.updateBatch(name, keyCol, upd);
    return { inserted: ins.length, updated: upd.length, rows: ins.concat(upd) };
  }
};
function invalidateRows_(name) { delete _ROWS[name]; }

/** ID berurutan tanpa pemotongan (high-water mark di Properties): ABS000001 */
function reserveIds_(name, n) {
  if (!n) return [];
  var prefix = SCHEMA[name].prefix, k = 'SEQ_' + name;
  var cur = Number(PROPS.getProperty(k) || 0);
  if (!cur) {                                            // inisialisasi dari data yang ada
    DB.all(name).forEach(function (r) { var m = String(r[SCHEMA[name].key] || '').match(/(\d+)$/); if (m) cur = Math.max(cur, Number(m[1])); });
  }
  var out = [];
  for (var i = 1; i <= n; i++) { var num = String(cur + i); out.push(prefix + (num.length < 6 ? ('000000' + num).slice(-6) : num)); }
  PROPS.setProperty(k, String(cur + n));
  return out;
}

// ---------------------------------------------------------------------
// 6. PENGATURAN (sheet Config)
// ---------------------------------------------------------------------
function settings_() {
  if (_SETTINGS) return _SETTINGS;
  var c = CacheX.get('cfg_' + ver_('master'));
  if (c) return (_SETTINGS = c);
  var o = {};
  CONFIG_SEED.forEach(function (s) { o[s[0]] = s[1]; });
  DB.all('Config').forEach(function (r) { if (r.key) o[r.key] = String(r.value); });
  CacheX.put('cfg_' + ver_('master'), o, 3600);
  return (_SETTINGS = o);
}
function setting_(k, d) { var v = settings_()[k]; return v === undefined || v === '' ? d : v; }
function saveSettings_(pairs) {
  var rows = DB.all('Config'), have = {}, upd = [], ins = [];
  rows.forEach(function (r) { have[r.key] = 1; });
  Object.keys(pairs).forEach(function (k) {
    var v = pairs[k] === null || pairs[k] === undefined ? '' : String(pairs[k]);
    if (have[k]) upd.push({ key: k, value: v }); else ins.push({ key: k, value: v, keterangan: '' });
  });
  DB.updateBatch('Config', 'key', upd);
  DB.appendBatch('Config', ins);
  _SETTINGS = null;
  bump_('master');
}

// ---------------------------------------------------------------------
// 7. CACHE BERLAPIS — chunk > 50 KB, invalidasi berbasis versi
// ---------------------------------------------------------------------
var CacheX = {
  SZ: 50000,
  c: function () { return CacheService.getScriptCache(); },
  get: function (key) {
    try {
      var c = this.c(), head = c.get(key);
      if (head == null) return null;
      if (head.indexOf('__chunks:') !== 0) return JSON.parse(head);
      var n = +head.slice(9), keys = [];
      for (var i = 0; i < n; i++) keys.push(key + '#' + i);
      var parts = c.getAll(keys), s = '';
      for (var j = 0; j < n; j++) { if (parts[keys[j]] == null) return null; s += parts[keys[j]]; }
      return JSON.parse(s);
    } catch (e) { return null; }
  },
  put: function (key, val, ttl) {
    try {
      var s = JSON.stringify(val), c = this.c();
      if (s.length <= this.SZ) return c.put(key, s, ttl);
      var n = Math.ceil(s.length / this.SZ); if (n > 20) return;
      var m = {}; for (var i = 0; i < n; i++) m[key + '#' + i] = s.substr(i * this.SZ, this.SZ);
      c.putAll(m, ttl); c.put(key, '__chunks:' + n, ttl);
    } catch (e) { /* cache opsional */ }
  }
};
function ver_(scope) {
  var c = CacheService.getScriptCache(), k = 'ver_' + scope, v = c.get(k);
  if (!v) { v = PROPS.getProperty(k) || String(Date.now()); c.put(k, v, 21600); }
  return v;
}
function bump_(scope) {
  var v = String(Date.now()) + Math.floor(Math.random() * 1000);
  CacheService.getScriptCache().put('ver_' + scope, v, 21600);
  PROPS.setProperty('ver_' + scope, v);
  if (scope === 'master') _SETTINGS = null;
}
function cached_(key, ttl, build) { var v = CacheX.get(key); if (v !== null) return v; var d = build(); CacheX.put(key, d, ttl); return d; }

// ---------------------------------------------------------------------
// 8. LOG — antrean cache, di-flush trigger (jalur baca tidak menulis)
// ---------------------------------------------------------------------
function queueLog_(row) {
  var full = [Utilities.getUuid(), nowIso_()].concat(row);
  var lock = _IN_LOCK ? null : LockService.getScriptLock();
  if (lock && !lock.tryLock(300)) { try { DB.appendBatch('Logs', [rowToLog_(full)]); } catch (e) {} return; }
  try {
    var c = CacheService.getScriptCache(), q = JSON.parse(c.get('logq') || '[]');
    q.push(full);
    if (q.length >= 100) { DB.appendBatch('Logs', q.map(rowToLog_)); c.remove('logq'); }
    else c.put('logq', JSON.stringify(q), 21600);
  } finally { if (lock) lock.releaseLock(); }
}
function rowToLog_(r) { return { log_id: r[0], timestamp: r[1], email: r[2], role: r[3], action: r[4], detail: r[5], target: r[6] }; }
function flushLogs_() {
  var c = CacheService.getScriptCache(), q = JSON.parse(c.get('logq') || '[]');
  if (q.length) { DB.appendBatch('Logs', q.map(rowToLog_)); c.remove('logq'); }
  var v = JSON.parse(c.get('viewq') || '[]');
  if (v.length) { flushMateriViews_(v); c.remove('viewq'); }
}
function apiLogsList(ctx, d) {
  var sh = getSheet_('Logs'), last = sh.getLastRow(), n = Math.min(300, Math.max(0, last - 1));
  var rows = [];
  if (n > 0) {
    var h = SCHEMA.Logs.cols, v = sh.getRange(last - n + 1, 1, n, h.length).getValues();
    rows = v.map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i] instanceof Date ? r[i].toISOString() : r[i]; }); return o; });
  }
  var q = JSON.parse(CacheService.getScriptCache().get('logq') || '[]').map(rowToLog_);
  return ok_(rows.concat(q).reverse().slice(0, 300));
}

// ---------------------------------------------------------------------
// 9. UTILITAS
// ---------------------------------------------------------------------
function nowIso_() { return Utilities.formatDate(new Date(), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function today_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'); }
function timeNow_() { return Utilities.formatDate(new Date(), APP.TZ, 'HH:mm:ss'); }
function lower_(s) { return String(s || '').trim().toLowerCase(); }
function num_(v, d) { var n = Number(v); return v === '' || v === null || isNaN(n) ? (d === undefined ? 0 : d) : n; }
function round1_(n) { return Math.round(n * 10) / 10; }
function hp08_(v) {
  var s = String(v == null ? '' : v).trim().replace(/\.0+$/, '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
  if (!s) return '';
  if (s.indexOf('62') === 0) s = '0' + s.substring(2); else if (s.indexOf('8') === 0) s = '0' + s;
  return s;
}
function hp62_(v) { var s = hp08_(v); return s ? (s[0] === '0' ? '62' + s.substring(1) : s) : ''; }
function hpValid_(v) { return /^08\d{8,12}$/.test(hp08_(v)); }
function emailValid_(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()); }
function isiTemplate_(tpl, v) { return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? '' : String(v[k]); }); }
function haversine_(lat1, lon1, lat2, lon2) {
  var R = 6371000, toR = Math.PI / 180;
  var dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function slug_(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, ''); }
function driveFolder_(id) { return DriveApp.getFolderById(id); }
function saveBase64File_(folderId, name, mime, b64) {
  var bytes = Utilities.base64Decode(String(b64).replace(/^data:[^,]+,/, ''));
  var blob = Utilities.newBlob(bytes, mime, name);
  var f = driveFolder_(folderId).createFile(blob);
  return f;
}

// ---------------------------------------------------------------------
// 10. TRIGGER — satu pekerja per menit: flush log, notifikasi, auto-alpha, CRM
// ---------------------------------------------------------------------
function pekerjaMenit() {
  resetMemo_();
  try { withLock_(function () { flushLogs_(); autoAlphaCek_(); return ok_(); }); } catch (e) { console.error('pekerja: ' + e.message); }
  try { prosesAntrianNotif({}); } catch (e2) { console.error('notif: ' + e2.message); }
}
function pasangTrigger() {
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('pekerjaMenit') === -1) ScriptApp.newTrigger('pekerjaMenit').timeBased().everyMinutes(1).create();
  Logger.log('✅ Trigger pekerjaMenit aktif (1 menit).');
  return true;
}

// ---------------------------------------------------------------------
// 11. SETUP — jalankan SEKALI dari editor
// ---------------------------------------------------------------------
function setupAppEnvironment() {
  if (PROPS.getProperty('SPREADSHEET_ID')) {
    Logger.log('⚠️ Setup sudah pernah dijalankan. Spreadsheet: ' + PROPS.getProperty('SPREADSHEET_ID'));
    Logger.log('   Untuk upgrade skema jalankan upgradeSchema(). Untuk memulai ulang hapus Script Properties dulu.');
    return;
  }
  Logger.log('🚀 Memulai setup ' + APP.NAME + '...');
  var root = DriveApp.createFolder('📁 ' + APP.NAME);
  var fMateri = root.createFolder('SIAKAD_MATERI');
  var fSelfie = root.createFolder('SIAKAD_FOTO_SELFIE');
  var fAset = root.createFolder('SIAKAD_ASET');
  var fExport = root.createFolder('SIAKAD_EXPORTS');
  var ss = SpreadsheetApp.create('🗃️ Database — ' + APP.NAME);
  DriveApp.getFileById(ss.getId()).moveTo(root);
  PROPS.setProperties({
    SPREADSHEET_ID: ss.getId(), ROOT_FOLDER_ID: root.getId(), MATERI_FOLDER: fMateri.getId(),
    SELFIE_FOLDER: fSelfie.getId(), ASET_FOLDER: fAset.getId(), EXPORTS_FOLDER: fExport.getId(),
    SCHEMA_VERSION: String(APP.SCHEMA_VERSION)
  });
  _SS = ss;
  var first = ss.getSheets()[0];
  Object.keys(SCHEMA).forEach(function (name) { createSheet_(ss, name); });
  ss.deleteSheet(first);
  // Config + catatan environment
  DB.appendBatch('Config', CONFIG_SEED.map(function (r) { return { key: r[0], value: r[1], keterangan: r[2] }; }).concat([
    { key: 'ENV_ROOT_FOLDER_ID', value: root.getId(), keterangan: 'ID folder root Drive' },
    { key: 'ENV_SPREADSHEET_ID', value: ss.getId(), keterangan: 'ID spreadsheet ini' },
    { key: 'ENV_CREATED_AT', value: nowIso_(), keterangan: 'Tanggal setup' }
  ]));
  seedDemo_();
  secret_();
  pasangTrigger();
  Logger.log('✅ Setup selesai!');
  Logger.log('   Spreadsheet : ' + ss.getUrl());
  Logger.log('   Drive Folder: ' + root.getUrl());
  Logger.log('   Login demo  : guru@sekolah.sch.id / ' + APP.DEMO_PASSWORD_GURU + '  •  siswa@sekolah.sch.id / ' + APP.DEMO_PASSWORD_SISWA);
  Logger.log('   ⚠️ Segera ganti password akun demo atau hapus data contoh dari menu Pengaturan.');
}

/** Upgrade aditif: sheet & kolom baru ditambahkan tanpa menyentuh data lama */
function upgradeSchema() {
  var ss = getSS_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { createSheet_(ss, name); Logger.log('+ sheet ' + name); return; }
    var h = DB.headers_(sh), miss = SCHEMA[name].cols.filter(function (c) { return h.indexOf(c) === -1; });
    if (miss.length) {
      var start = h.length + 1;
      sh.getRange(1, start, sh.getMaxRows(), miss.length).setNumberFormat('@');
      sh.getRange(1, start, 1, miss.length).setValues([miss]).setFontWeight('bold').setBackground('#1E3A5F').setFontColor('#ffffff');
      Logger.log('+ kolom ' + name + ': ' + miss.join(', '));
    }
  });
  var have = {}; DB.all('Config').forEach(function (r) { have[r.key] = 1; });
  DB.appendBatch('Config', CONFIG_SEED.filter(function (r) { return !have[r[0]]; }).map(function (r) { return { key: r[0], value: r[1], keterangan: r[2] }; }));
  PROPS.setProperty('SCHEMA_VERSION', String(APP.SCHEMA_VERSION));
  bump_('master'); bump_('absen'); bump_('nilai');
  pasangTrigger();
  Logger.log('✅ Upgrade skema selesai.');
}

;
// ==== Akademik.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA — File 2/5 : Akademik.gs
 *  Bootstrap per peran, data induk, jadwal, absensi (barcode/selfie/GPS),
 *  materi (Drive/YouTube), penilaian, laporan, data contoh.
 * =====================================================================
 */

var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// ---------------------------------------------------------------------
// A. BOOTSTRAP — satu panggilan untuk satu layar (cache per versi)
// ---------------------------------------------------------------------
function versKey_() { return ver_('master') + '_' + ver_('absen') + '_' + ver_('nilai') + '_' + today_(); }

function publicCfg_() {
  var c = settings_(), o = {};
  ['NAMA_SEKOLAH', 'ALAMAT_SEKOLAH', 'LOGO_URL', 'LAT_SEKOLAH', 'LNG_SEKOLAH', 'RADIUS_M', 'GPS_WAJIB_SCAN', 'JAM_MASUK', 'JAM_PULANG',
    'TAHUN_AJARAN', 'SEMESTER', 'SEMESTER_MULAI', 'SEMESTER_SELESAI', 'KKM', 'BOBOT_HARIAN', 'BOBOT_UTS', 'BOBOT_UAS', 'BATAS_KEHADIRAN',
    'MATERI_MAKS_MB', 'AUTO_ALPHA_JAM', 'EMAIL_DOMAIN_SISWA'].forEach(function (k) { o[k] = c[k]; });
  o.demo = PROPS.getProperty('DEMO_SEEDED') === '1';
  o.today = today_();
  o.now = nowIso_();
  return o;
}

function siswaPublic_(s) {
  return { NIS: s.NIS, NISN: s.NISN, nama_lengkap: s.nama_lengkap, jenis_kelamin: s.jenis_kelamin, kelas_id: s.kelas_id, jenjang: s.jenjang,
    barcode_id: s.barcode_id, email: s.email, no_wa: s.no_wa, nama_ortu: s.nama_ortu, no_wa_ortu: s.no_wa_ortu, tempat_lahir: s.tempat_lahir,
    tanggal_lahir: s.tanggal_lahir, alamat: s.alamat, foto_profil_url: s.foto_profil_url, tahun_masuk: s.tahun_masuk, status: s.status, StatusWA: s.StatusWA };
}

/** Indeks absensi semester berjalan: hari efektif per kelas + rekap per siswa (memo & cache) */
var _ABS_IDX = null;
function absenIndex_() {
  if (_ABS_IDX) return _ABS_IDX;
  var key = 'absidx_' + ver_('absen') + '_' + ver_('master') + '_' + today_();
  var c = CacheX.get(key);
  if (c) return (_ABS_IDX = c);
  var mulai = setting_('SEMESTER_MULAI', '2000-01-01'), selesai = setting_('SEMESTER_SELESAI', '2999-12-31'), tdy = today_();
  var batasAkhir = selesai < tdy ? selesai : tdy;
  var hariKelas = {}, rekap = {}, daily = {};
  var siswa = DB.all('Siswa'), kelasOf = {};
  siswa.forEach(function (s) { kelasOf[s.NIS] = s.kelas_id; });
  DB.all('Absensi').forEach(function (a) {
    var t = String(a.tanggal);
    if (t < mulai || t > batasAkhir) return;
    var k = a.kelas_id || kelasOf[a.NIS] || '-';
    (hariKelas[k] = hariKelas[k] || {})[t] = 1;
    var r = rekap[a.NIS] = rekap[a.NIS] || { H: 0, I: 0, S: 0, A: 0, T: 0, n: 0 };
    var st = String(a.status || '').charAt(0).toUpperCase();
    if (r[st] !== undefined) r[st]++;
    if (st === 'H' && String(a.terlambat).toUpperCase() === 'YA') r.T++;
    r.n++;
    var d = daily[t] = daily[t] || { H: 0, I: 0, S: 0, A: 0 };
    if (d[st] !== undefined) d[st]++;
  });
  var hk = {}; Object.keys(hariKelas).forEach(function (k) { hk[k] = Object.keys(hariKelas[k]).sort(); });
  var out = {};
  siswa.forEach(function (s) {
    var r = rekap[s.NIS] || { H: 0, I: 0, S: 0, A: 0, T: 0, n: 0 };
    var hari = (hk[s.kelas_id] || []).length;
    var tanpaKet = Math.max(0, hari - r.n);
    out[s.NIS] = { H: r.H, I: r.I, S: r.S, A: r.A + tanpaKet, T: r.T, hari: hari, persen: hari ? round1_(r.H / hari * 100) : null };
  });
  var res = { rekap: out, daily: daily, hariKelas: hk, mulai: mulai };
  CacheX.put(key, res, 900);
  return (_ABS_IDX = res);
}

/** Tren kehadiran: 7 hari terakhir (harian) + 12 pekan (mingguan) */
function trendKehadiran_(idx, totalSiswa) {
  var hariIni = new Date(today_() + 'T00:00:00+07:00'), harian = [], pekan = {};
  for (var i = 6; i >= 0; i--) {
    var d = new Date(hariIni.getTime() - i * 864e5), t = Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd'), r = idx.daily[t];
    var tot = r ? r.H + r.I + r.S + r.A : 0;
    harian.push({ tanggal: t, hari: HARI[Number(Utilities.formatDate(d, APP.TZ, 'u')) % 7], H: r ? r.H : 0, I: r ? r.I : 0, S: r ? r.S : 0, A: r ? r.A : 0, persen: r && totalSiswa ? round1_(r.H / totalSiswa * 100) : null });
  }
  Object.keys(idx.daily).forEach(function (t) {
    var d = new Date(t + 'T00:00:00+07:00'), senin = new Date(d.getTime() - ((Number(Utilities.formatDate(d, APP.TZ, 'u')) + 6) % 7) * 864e5);
    var k = Utilities.formatDate(senin, APP.TZ, 'yyyy-MM-dd'), r = idx.daily[t], p = pekan[k] = pekan[k] || { H: 0, tot: 0, hari: 0, I: 0, S: 0, A: 0 };
    p.H += r.H; p.I += r.I; p.S += r.S; p.A += r.A; p.hari++;
  });
  var mingguan = Object.keys(pekan).sort().slice(-12).map(function (k, i) {
    var p = pekan[k], denom = totalSiswa * p.hari;
    return { pekan: k, label: 'Pekan ' + (i + 1), persen: denom ? round1_(p.H / denom * 100) : null, H: p.H, I: p.I, S: p.S, A: p.A };
  });
  return { harian: harian, mingguan: mingguan };
}

function predikat_(n) {
  var kkm = num_(setting_('KKM', 70), 70);
  if (n === '' || n === null || isNaN(n)) return '';
  if (n >= 90) return 'A';
  if (n >= 80) return 'B';
  if (n >= kkm) return 'C';
  return 'D';
}
function hitungAkhir_(h, u, a) {
  if (h === '' || u === '' || a === '') return '';
  var bh = num_(setting_('BOBOT_HARIAN', 40)), bu = num_(setting_('BOBOT_UTS', 30)), ba = num_(setting_('BOBOT_UAS', 30));
  var tot = bh + bu + ba || 100;
  return round1_((num_(h) * bh + num_(u) * bu + num_(a) * ba) / tot);
}
function nilaiAktif_() {
  var ta = setting_('TAHUN_AJARAN', ''), sem = setting_('SEMESTER', '');
  return DB.all('Nilai').filter(function (n) { return String(n.tahun_ajaran) === ta && String(n.semester) === sem; });
}

function apiGuruBootstrap(ctx, d) {
  var data = cached_('bootG_' + versKey_(), 600, buildGuruBootstrap_);
  var me = null;
  (data.guru || []).forEach(function (g) { if (String(g.NUPTK) === String(ctx.session.ref)) me = g; });
  return ok_(Object.assign({}, data, { me: me || { nama_lengkap: ctx.session.email, email: ctx.session.email }, role: 'guru' }));
}

function buildGuruBootstrap_() {
  var cfg = publicCfg_(), tdy = cfg.today;
  var siswa = DB.all('Siswa').map(siswaPublic_);
  var aktif = siswa.filter(function (s) { return String(s.status || 'Aktif') === 'Aktif'; });
  var akunMap = {}; DB.all('Users').forEach(function (u) { if (u.role === 'siswa') akunMap[u.ref_id] = { status: u.status_aktif, last: u.last_login }; });
  siswa.forEach(function (s) { var a = akunMap[s.NIS]; s.akun = a ? a.status : ''; s.last_login = a ? a.last : ''; });
  var idx = absenIndex_();
  var absHariIni = DB.all('Absensi').filter(function (a) { return String(a.tanggal) === tdy; });
  var cnt = { H: 0, I: 0, S: 0, A: 0 };
  absHariIni.forEach(function (a) { var st = String(a.status).charAt(0).toUpperCase(); if (cnt[st] !== undefined) cnt[st]++; });
  var nilai = nilaiAktif_();
  var aksesCount = {};
  DB.all('MateriAkses').forEach(function (a) { aksesCount[a.materi_id] = (aksesCount[a.materi_id] || 0) + 1; });
  var materi = DB.all('Materi').filter(function (m) { return m.status !== 'Dihapus'; }).map(function (m) { return Object.assign({}, m, { akses: aksesCount[m.materi_id] || 0 }); });
  var batas = num_(setting_('BATAS_KEHADIRAN', 75));
  var perhatian = aktif.filter(function (s) { var r = idx.rekap[s.NIS]; return r && r.persen !== null && r.persen < batas; })
    .map(function (s) { var r = idx.rekap[s.NIS]; return { NIS: s.NIS, nama: s.nama_lengkap, kelas_id: s.kelas_id, persen: r.persen, absen: r.hari - r.H }; })
    .sort(function (a, b) { return a.persen - b.persen; });
  var rataKelas = {}, sumK = {};
  nilai.forEach(function (n) { if (n.nilai_akhir === '') return; var s = sumK[n.kelas_id] = sumK[n.kelas_id] || [0, 0]; s[0] += num_(n.nilai_akhir); s[1]++; });
  Object.keys(sumK).forEach(function (k) { rataKelas[k] = round1_(sumK[k][0] / sumK[k][1]); });
  var allN = nilai.filter(function (n) { return n.nilai_akhir !== ''; });
  var rata = allN.length ? round1_(allN.reduce(function (a, n) { return a + num_(n.nilai_akhir); }, 0) / allN.length) : null;
  return {
    cfg: cfg,
    kelas: DB.all('Kelas'), mapel: DB.all('Mapel'), guru: DB.all('Guru'), jadwal: DB.all('Jadwal'),
    siswa: siswa, materi: materi, nilai: nilai,
    pengumuman: DB.all('Pengumuman').filter(function (p) { return p.status !== 'Arsip'; }).sort(function (a, b) { return String(b.tanggal).localeCompare(String(a.tanggal)); }),
    absensiHariIni: absHariIni,
    rekapAbsen: idx.rekap, hariKelas: idx.hariKelas,
    trend: trendKehadiran_(idx, aktif.length),
    stats: {
      totalSiswa: aktif.length, L: aktif.filter(function (s) { return s.jenis_kelamin === 'L'; }).length,
      hadirHariIni: cnt.H, izinHariIni: cnt.I, sakitHariIni: cnt.S, alphaHariIni: cnt.A,
      persenHariIni: aktif.length ? round1_(cnt.H / aktif.length * 100) : 0,
      materiAktif: materi.length, rataNilai: rata, rataKelas: rataKelas,
      akunBelumAktif: siswa.filter(function (s) { return s.akun !== 'YA'; }).length
    },
    perhatian: perhatian
  };
}

function apiSiswaBootstrap(ctx, d) {
  var nis = String(ctx.session.ref);
  return ok_(cached_('bootS_' + versKey_() + '_' + nis, 600, function () { return buildSiswaBootstrap_(nis); }));
}

function buildSiswaBootstrap_(nis) {
  var s = DB.find('Siswa', 'NIS', nis);
  if (!s) throw new Error('Data siswa tidak ditemukan untuk akun ini.');
  var cfg = publicCfg_(), tdy = cfg.today, mulai = cfg.SEMESTER_MULAI;
  var kelas = DB.find('Kelas', 'kelas_id', s.kelas_id) || {};
  var guruMap = {}; DB.all('Guru').forEach(function (g) { guruMap[g.NUPTK] = g.nama_lengkap; });
  var riwayat = DB.all('Absensi').filter(function (a) { return String(a.NIS) === nis && String(a.tanggal) >= mulai; })
    .map(function (a) { return { absensi_id: a.absensi_id, tanggal: a.tanggal, jam: a.jam, status: a.status, metode: a.metode, jarak_m: a.jarak_m, terlambat: a.terlambat, keterangan: a.keterangan }; })
    .sort(function (a, b) { return String(b.tanggal + b.jam).localeCompare(String(a.tanggal + a.jam)); });
  var hariIni = riwayat.filter(function (a) { return a.tanggal === tdy; })[0] || null;
  var idx = absenIndex_();
  var viewed = {};
  DB.all('MateriAkses').forEach(function (a) { if (String(a.NIS) === nis) viewed[a.materi_id] = 1; });
  var materi = DB.all('Materi').filter(function (m) { return m.status !== 'Dihapus' && (!m.kelas_id || m.kelas_id === s.kelas_id); })
    .map(function (m) { return Object.assign({}, m, { guru: guruMap[m.guru_id] || '', dibaca: !!viewed[m.materi_id] }); })
    .sort(function (a, b) { return String(b.tanggal_upload).localeCompare(String(a.tanggal_upload)); });
  var jadwal = DB.all('Jadwal').filter(function (j) { return j.kelas_id === s.kelas_id; })
    .map(function (j) { return Object.assign({}, j, { guru: guruMap[j.guru_id] || '' }); });
  var nilaiAll = nilaiAktif_();
  var kelasNilai = nilaiAll.filter(function (n) { return n.kelas_id === s.kelas_id && n.nilai_akhir !== ''; });
  var rataMapel = {}, agg = {};
  kelasNilai.forEach(function (n) { var a = agg[n.mata_pelajaran] = agg[n.mata_pelajaran] || [0, 0]; a[0] += num_(n.nilai_akhir); a[1]++; });
  Object.keys(agg).forEach(function (k) { rataMapel[k] = round1_(agg[k][0] / agg[k][1]); });
  var perSiswa = {};
  kelasNilai.forEach(function (n) { var a = perSiswa[n.NIS] = perSiswa[n.NIS] || [0, 0]; a[0] += num_(n.nilai_akhir); a[1]++; });
  var ranking = Object.keys(perSiswa).map(function (k) { return { NIS: k, rata: perSiswa[k][0] / perSiswa[k][1] }; }).sort(function (a, b) { return b.rata - a.rata; });
  var rank = 0; ranking.forEach(function (r, i) { if (r.NIS === nis) rank = i + 1; });
  var nilai = DB.all('Nilai').filter(function (n) { return String(n.NIS) === nis; })
    .map(function (n) { return Object.assign({}, n, { guru: guruMap[n.guru_id] || '' }); });
  var wali = guruMap[kelas.wali_kelas_id] || '';
  return {
    role: 'siswa', cfg: cfg,
    profil: Object.assign(siswaPublic_(s), { nama_kelas: kelas.nama_kelas || s.kelas_id, wali_kelas: wali }),
    hariIni: hariIni, rekap: idx.rekap[nis] || { H: 0, I: 0, S: 0, A: 0, T: 0, hari: 0, persen: null },
    riwayat: riwayat, jadwal: jadwal, materi: materi, nilai: nilai,
    rataMapel: rataMapel, peringkat: rank, jumlahSiswaKelas: DB.all('Siswa').filter(function (x) { return x.kelas_id === s.kelas_id && (x.status || 'Aktif') === 'Aktif'; }).length,
    mapel: DB.all('Mapel'),
    pengumuman: DB.all('Pengumuman').filter(function (p) { return p.status !== 'Arsip'; }).sort(function (a, b) { return String(b.tanggal).localeCompare(String(a.tanggal)); }).slice(0, 10)
  };
}

// ---------------------------------------------------------------------
// B. DATA INDUK SISWA & GURU
// ---------------------------------------------------------------------
function uniqueEmail_(base, domain, exceptUid) {
  var used = {}; DB.all('Users').forEach(function (u) { if (u.user_id !== exceptUid) used[lower_(u.email)] = 1; });
  var e = base + '@' + domain, i = 2;
  while (used[e]) { e = base + i + '@' + domain; i++; }
  return e;
}

function apiSiswaSave(ctx, d) {
  var x = d.data || {}, isNew = !!d.isNew;
  var nis = String(x.NIS || '').trim();
  if (!/^[0-9A-Za-z.-]{3,20}$/.test(nis)) return fail_('NIS wajib diisi (3–20 karakter, angka/huruf).');
  if (!String(x.nama_lengkap || '').trim()) return fail_('Nama lengkap wajib diisi.');
  if (x.NISN && !/^\d{10}$/.test(String(x.NISN).trim())) return fail_('NISN harus 10 digit angka.');
  var kelas = DB.find('Kelas', 'kelas_id', x.kelas_id);
  if (!kelas) return fail_('Kelas / rombel belum dipilih atau tidak ditemukan.');
  var ada = DB.find('Siswa', 'NIS', nis);
  if (isNew && ada) return fail_('NIS ' + nis + ' sudah terdaftar atas nama ' + ada.nama_lengkap + '.');
  if (!isNew && !ada) return fail_('Data siswa tidak ditemukan.');
  if (x.no_wa_ortu && !hpValid_(x.no_wa_ortu)) return fail_('Nomor WhatsApp orang tua tidak valid (contoh: 0812xxxxxxx).');
  if (x.no_wa && !hpValid_(x.no_wa)) return fail_('Nomor WhatsApp siswa tidak valid.');
  var barcode = String(x.barcode_id || (ada && ada.barcode_id) || ('ID-' + nis)).trim();
  var bentrok = DB.all('Siswa').filter(function (s) { return s.NIS !== nis && String(s.barcode_id).toUpperCase() === barcode.toUpperCase(); })[0];
  if (bentrok) return fail_('Barcode ID sudah dipakai ' + bentrok.nama_lengkap + '.');
  var user = DB.all('Users').filter(function (u) { return u.role === 'siswa' && String(u.ref_id) === nis; })[0];
  var domain = setting_('EMAIL_DOMAIN_SISWA', 'siswa.sch.id');
  var email = lower_(x.email) || (user ? lower_(user.email) : uniqueEmail_(slug_(x.nama_lengkap).split('.').slice(0, 2).join('.') || nis, domain, ''));
  if (!emailValid_(email)) return fail_('Format email tidak valid.');
  var dupe = DB.all('Users').filter(function (u) { return lower_(u.email) === email && (!user || u.user_id !== user.user_id); })[0];
  if (dupe) return fail_('Email ' + email + ' sudah dipakai akun lain.');
  var foto = x.foto_profil_url || (ada && ada.foto_profil_url) || '';
  if (d.foto && d.foto.data) {
    var f = saveBase64File_(CONFIG.ASET_FOLDER, 'FOTO_' + nis + '.jpg', d.foto.mime || 'image/jpeg', d.foto.data);
    shareLink_(f);
    foto = 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w400';
  }
  var row = {
    NIS: nis, NISN: String(x.NISN || '').trim(), nama_lengkap: String(x.nama_lengkap).trim(), jenis_kelamin: x.jenis_kelamin === 'P' ? 'P' : 'L',
    kelas_id: kelas.kelas_id, jenjang: kelas.jenjang, barcode_id: barcode, email: email, no_wa: hp08_(x.no_wa), nama_ortu: x.nama_ortu || '',
    no_wa_ortu: hp08_(x.no_wa_ortu), tempat_lahir: x.tempat_lahir || '', tanggal_lahir: x.tanggal_lahir || '', alamat: x.alamat || '',
    foto_profil_url: foto, tahun_masuk: x.tahun_masuk || setting_('TAHUN_AJARAN', ''), status: x.status || (ada ? ada.status : 'Aktif') || 'Aktif'
  };
  var akun = null;
  if (isNew) {
    row.dibuat_pada = nowIso_(); row.StatusWA = ''; row.CekWAAt = '';
    DB.appendBatch('Siswa', [row]);
  } else {
    if (hp08_(ada.no_wa_ortu) !== row.no_wa_ortu) { row.StatusWA = ''; row.CekWAAt = ''; }
    DB.updateBatch('Siswa', 'NIS', [row]);
  }
  if (!user) {
    var pw = String(d.password || '').trim() || randomPassword_(8), salt = newSalt_();
    DB.appendBatch('Users', [{ user_id: reserveIds_('Users', 1)[0], nama: row.nama_lengkap, email: email, password_hash: hashPassword_(pw, salt), salt: salt,
      role: 'siswa', ref_id: nis, kelas_id: row.kelas_id, status_aktif: d.aktifkan === false ? 'TIDAK' : 'YA', wajib_ganti_sandi: 'YA', last_login: '', dibuat_pada: nowIso_() }]);
    akun = { email: email, password: pw };
    if (d.kirimKredensial) kirimNotif_('AKUN_DIBUAT', { nama: row.nama_lengkap, hp: row.no_wa_ortu || row.no_wa, email: email }, { username: email, sandi: pw, nis: nis }, nis);
  } else {
    var patch = { user_id: user.user_id, nama: row.nama_lengkap, email: email, kelas_id: row.kelas_id };
    if (d.password) { var s2 = newSalt_(); patch.password_hash = hashPassword_(d.password, s2); patch.salt = s2; patch.wajib_ganti_sandi = 'YA'; akun = { email: email, password: d.password }; }
    DB.updateBatch('Users', 'user_id', [patch]);
  }
  bump_('master');
  if (typeof crmUpsertSatu_ === 'function') { try { crmUpsertSatu_('siswa', row); crmUpsertSatu_('ortu', row); } catch (e) {} }
  return ok_({ siswa: siswaPublic_(row), akun: akun }, isNew ? 'Siswa ' + row.nama_lengkap + ' berhasil didaftarkan.' : 'Data siswa diperbarui.');
}

function apiSiswaDelete(ctx, d) {
  var nis = String(d.NIS || '');
  var s = DB.find('Siswa', 'NIS', nis);
  if (!s) return fail_('Siswa tidak ditemukan.');
  DB.deleteWhere('Siswa', 'NIS', [nis]);
  var u = DB.all('Users').filter(function (x) { return x.role === 'siswa' && String(x.ref_id) === nis; });
  if (u.length) DB.deleteWhere('Users', 'user_id', u.map(function (x) { return x.user_id; }));
  bump_('master'); bump_('absen');
  return ok_(null, 'Siswa ' + s.nama_lengkap + ' dihapus. Riwayat absensi & nilai tetap tersimpan.');
}

function apiSiswaResetPassword(ctx, d) {
  var u = DB.all('Users').filter(function (x) { return String(x.ref_id) === String(d.NIS || d.NUPTK) && x.role === (d.NUPTK ? 'guru' : 'siswa'); })[0];
  if (!u) return fail_('Akun tidak ditemukan.');
  var pw = String(d.password || '').trim() || randomPassword_(8), salt = newSalt_();
  DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, password_hash: hashPassword_(pw, salt), salt: salt, wajib_ganti_sandi: 'YA', status_aktif: 'YA' }]);
  revokeAll_(lower_(u.email));
  if (d.kirim) kirimNotif_('RESET_SANDI_ADMIN', kontakUser_(u), { username: u.email, sandi: pw }, u.user_id);
  bump_('master');
  return ok_({ email: u.email, password: pw }, 'Password baru dibuat untuk ' + u.nama + '.');
}

function apiSiswaBulk(ctx, d) {
  var nis = (d.nis || []).map(String), aksi = d.aksi;
  if (!nis.length) return fail_('Belum ada siswa yang dipilih.');
  var set = {}; nis.forEach(function (n) { set[n] = 1; });
  if (aksi === 'aktivasi' || aksi === 'nonaktifkanAkun') {
    var up = DB.all('Users').filter(function (u) { return u.role === 'siswa' && set[u.ref_id]; }).map(function (u) { return { user_id: u.user_id, status_aktif: aksi === 'aktivasi' ? 'YA' : 'TIDAK' }; });
    DB.updateBatch('Users', 'user_id', up);
  } else if (aksi === 'pindahKelas') {
    var k = DB.find('Kelas', 'kelas_id', d.nilai); if (!k) return fail_('Kelas tujuan tidak ditemukan.');
    DB.updateBatch('Siswa', 'NIS', nis.map(function (n) { return { NIS: n, kelas_id: k.kelas_id, jenjang: k.jenjang }; }));
    DB.updateBatch('Users', 'user_id', DB.all('Users').filter(function (u) { return u.role === 'siswa' && set[u.ref_id]; }).map(function (u) { return { user_id: u.user_id, kelas_id: k.kelas_id }; }));
  } else if (aksi === 'status') {
    if (['Aktif', 'Nonaktif', 'Lulus', 'Pindah'].indexOf(d.nilai) === -1) return fail_('Status tidak valid.');
    DB.updateBatch('Siswa', 'NIS', nis.map(function (n) { return { NIS: n, status: d.nilai }; }));
  } else if (aksi === 'hapus') {
    DB.deleteWhere('Siswa', 'NIS', nis);
    DB.deleteWhere('Users', 'user_id', DB.all('Users').filter(function (u) { return u.role === 'siswa' && set[u.ref_id]; }).map(function (u) { return u.user_id; }));
  } else return fail_('Aksi massal tidak dikenal.');
  bump_('master'); bump_('absen');
  return ok_({ n: nis.length }, 'Aksi massal diterapkan ke ' + nis.length + ' siswa.');
}

function apiGuruSave(ctx, d) {
  var x = d.data || {}, isNew = !!d.isNew, id = String(x.NUPTK || '').trim();
  if (!/^[0-9A-Za-z.-]{3,24}$/.test(id)) return fail_('NUPTK / NIP wajib diisi (3–24 karakter).');
  if (!String(x.nama_lengkap || '').trim()) return fail_('Nama guru wajib diisi.');
  var email = lower_(x.email);
  if (!emailValid_(email)) return fail_('Email guru wajib diisi dengan format benar.');
  if (x.no_wa && !hpValid_(x.no_wa)) return fail_('Nomor WhatsApp tidak valid.');
  var ada = DB.find('Guru', 'NUPTK', id);
  if (isNew && ada) return fail_('NUPTK sudah terdaftar.');
  if (!isNew && !ada) return fail_('Guru tidak ditemukan.');
  var user = DB.all('Users').filter(function (u) { return u.role === 'guru' && String(u.ref_id) === id; })[0];
  var dupe = DB.all('Users').filter(function (u) { return lower_(u.email) === email && (!user || u.user_id !== user.user_id); })[0];
  if (dupe) return fail_('Email sudah dipakai akun lain.');
  var row = { NUPTK: id, nama_lengkap: String(x.nama_lengkap).trim(), email: email, no_wa: hp08_(x.no_wa), mata_pelajaran: x.mata_pelajaran || '', jabatan: x.jabatan || 'Guru', foto_profil_url: x.foto_profil_url || '', status: x.status || 'Aktif' };
  if (isNew) { row.dibuat_pada = nowIso_(); DB.appendBatch('Guru', [row]); } else DB.updateBatch('Guru', 'NUPTK', [row]);
  var akun = null;
  if (!user) {
    var pw = String(d.password || '').trim() || randomPassword_(8), salt = newSalt_();
    DB.appendBatch('Users', [{ user_id: reserveIds_('Users', 1)[0], nama: row.nama_lengkap, email: email, password_hash: hashPassword_(pw, salt), salt: salt, role: 'guru', ref_id: id, kelas_id: '', status_aktif: 'YA', wajib_ganti_sandi: 'YA', last_login: '', dibuat_pada: nowIso_() }]);
    akun = { email: email, password: pw };
    if (d.kirimKredensial) kirimNotif_('AKUN_DIBUAT', { nama: row.nama_lengkap, hp: row.no_wa, email: email }, { username: email, sandi: pw, nis: id }, id);
  } else {
    DB.updateBatch('Users', 'user_id', [{ user_id: user.user_id, nama: row.nama_lengkap, email: email, status_aktif: row.status === 'Aktif' ? 'YA' : 'TIDAK' }]);
  }
  bump_('master');
  return ok_({ guru: row, akun: akun }, isNew ? 'Guru ditambahkan.' : 'Data guru diperbarui.');
}

function apiGuruDelete(ctx, d) {
  var id = String(d.NUPTK || '');
  if (id === String(ctx.session.ref)) return fail_('Tidak bisa menghapus akun Anda sendiri.');
  var g = DB.find('Guru', 'NUPTK', id); if (!g) return fail_('Guru tidak ditemukan.');
  var guruLain = DB.all('Users').filter(function (u) { return u.role === 'guru' && u.status_aktif === 'YA' && String(u.ref_id) !== id; });
  if (!guruLain.length) return fail_('Minimal harus ada satu akun guru aktif.');
  DB.deleteWhere('Guru', 'NUPTK', [id]);
  DB.deleteWhere('Users', 'user_id', DB.all('Users').filter(function (u) { return u.role === 'guru' && String(u.ref_id) === id; }).map(function (u) { return u.user_id; }));
  bump_('master');
  return ok_(null, 'Guru ' + g.nama_lengkap + ' dihapus.');
}

// ---------------------------------------------------------------------
// C. MASTER GENERIK: Kelas, Mapel, Jadwal, Pengumuman
// ---------------------------------------------------------------------
var MASTER_SHEETS = { Kelas: 1, Mapel: 1, Jadwal: 1, Pengumuman: 1 };
function toMin_(hhmm) { var p = String(hhmm || '').split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); }

function apiMasterSave(ctx, d) {
  var sheet = d.sheet, x = Object.assign({}, d.row || {});
  if (!MASTER_SHEETS[sheet]) return fail_('Data tidak dikenal.');
  var key = SCHEMA[sheet].key, isNew = !x[key];
  if (sheet === 'Kelas') {
    if (!String(x.nama_kelas || '').trim()) return fail_('Nama kelas wajib diisi.');
    if (['SD', 'SMP', 'SMA'].indexOf(x.jenjang) === -1) return fail_('Jenjang harus SD, SMP, atau SMA.');
    x.tahun_ajaran = x.tahun_ajaran || setting_('TAHUN_AJARAN', '');
  } else if (sheet === 'Mapel') {
    if (!String(x.nama || '').trim()) return fail_('Nama mata pelajaran wajib diisi.');
    var dup = DB.all('Mapel').filter(function (m) { return lower_(m.nama) === lower_(x.nama) && m.mapel_id !== x.mapel_id; })[0];
    if (dup) return fail_('Mata pelajaran sudah ada.');
  } else if (sheet === 'Jadwal') {
    if (!x.kelas_id || !x.mata_pelajaran || !x.hari || !x.jam_mulai || !x.jam_selesai) return fail_('Kelas, mapel, hari, jam mulai & selesai wajib diisi.');
    if (toMin_(x.jam_selesai) <= toMin_(x.jam_mulai)) return fail_('Jam selesai harus setelah jam mulai.');
    var a1 = toMin_(x.jam_mulai), a2 = toMin_(x.jam_selesai);
    var konflik = DB.all('Jadwal').filter(function (j) {
      if (j.jadwal_id === x.jadwal_id || j.hari !== x.hari) return false;
      var overlap = toMin_(j.jam_mulai) < a2 && a1 < toMin_(j.jam_selesai);
      return overlap && (j.kelas_id === x.kelas_id || (x.guru_id && j.guru_id === x.guru_id) || (x.ruang && lower_(j.ruang) === lower_(x.ruang)));
    })[0];
    if (konflik) return fail_('Jadwal bentrok dengan ' + konflik.mata_pelajaran + ' (' + konflik.hari + ' ' + konflik.jam_mulai + '–' + konflik.jam_selesai + ', ' + konflik.kelas_id + (konflik.ruang ? ', ' + konflik.ruang : '') + ').');
  } else if (sheet === 'Pengumuman') {
    if (!String(x.judul || '').trim() || !String(x.isi || '').trim()) return fail_('Judul dan isi pengumuman wajib diisi.');
    x.tanggal = x.tanggal || nowIso_(); x.oleh = x.oleh || ctx.session.email; x.status = x.status || 'Aktif'; x.kategori = x.kategori || 'Akademik';
  }
  var cols = SCHEMA[sheet].cols, row = {};
  cols.forEach(function (c) { if (x[c] !== undefined) row[c] = x[c]; });
  if (isNew) { row[key] = reserveIds_(sheet, 1)[0]; DB.appendBatch(sheet, [row]); }
  else { if (!DB.find(sheet, key, row[key])) return fail_('Data tidak ditemukan.'); DB.updateBatch(sheet, key, [row]); }
  if (sheet === 'Pengumuman' && isNew && d.kirimNotif) {
    var penerima = DB.all('Siswa').filter(function (s) { return (s.status || 'Aktif') === 'Aktif'; }).map(function (s) { return { penerima: { nama: s.nama_lengkap, hp: s.no_wa_ortu || s.no_wa, email: s.email }, vars: { judul: row.judul, isi: row.isi }, refId: row[key] }; });
    kirimNotifBatch_('PENGUMUMAN', penerima);
  }
  bump_('master');
  return ok_(row, 'Data ' + sheet.toLowerCase() + ' tersimpan.');
}

function apiMasterDelete(ctx, d) {
  var sheet = d.sheet; if (!MASTER_SHEETS[sheet]) return fail_('Data tidak dikenal.');
  var key = SCHEMA[sheet].key, id = String(d.id || '');
  if (sheet === 'Kelas' && DB.all('Siswa').some(function (s) { return s.kelas_id === id; })) return fail_('Kelas masih memiliki siswa. Pindahkan siswa terlebih dahulu.');
  var n = DB.deleteWhere(sheet, key, [id]);
  if (!n) return fail_('Data tidak ditemukan.');
  bump_('master');
  return ok_(null, 'Data dihapus.');
}

var CONFIG_EDITABLE = /^(NAMA_SEKOLAH|ALAMAT_SEKOLAH|LOGO_URL|LAT_SEKOLAH|LNG_SEKOLAH|RADIUS_M|GPS_WAJIB_SCAN|JAM_MASUK|JAM_PULANG|AUTO_ALPHA_JAM|TAHUN_AJARAN|SEMESTER|SEMESTER_MULAI|SEMESTER_SELESAI|KKM|BOBOT_HARIAN|BOBOT_UTS|BOBOT_UAS|BATAS_KEHADIRAN|EMAIL_DOMAIN_SISWA|MATERI_MAKS_MB)$/;
function apiConfigGet(ctx, d) {
  var ket = {}; CONFIG_SEED.forEach(function (r) { ket[r[0]] = r[2]; });
  var s = settings_();
  return ok_(Object.keys(s).filter(function (k) { return CONFIG_EDITABLE.test(k); }).map(function (k) { return { key: k, value: s[k], keterangan: ket[k] || '' }; }));
}
function apiConfigSave(ctx, d) {
  var p = d.pairs || {}, clean = {};
  Object.keys(p).forEach(function (k) { if (CONFIG_EDITABLE.test(k)) clean[k] = String(p[k]).trim(); });
  if (clean.LAT_SEKOLAH !== undefined && (isNaN(Number(clean.LAT_SEKOLAH)) || Math.abs(Number(clean.LAT_SEKOLAH)) > 90)) return fail_('Latitude tidak valid.');
  if (clean.LNG_SEKOLAH !== undefined && (isNaN(Number(clean.LNG_SEKOLAH)) || Math.abs(Number(clean.LNG_SEKOLAH)) > 180)) return fail_('Longitude tidak valid.');
  if (clean.RADIUS_M !== undefined && !(Number(clean.RADIUS_M) >= 10 && Number(clean.RADIUS_M) <= 5000)) return fail_('Radius harus 10–5000 meter.');
  var bh = num_(clean.BOBOT_HARIAN !== undefined ? clean.BOBOT_HARIAN : setting_('BOBOT_HARIAN', 40)),
      bu = num_(clean.BOBOT_UTS !== undefined ? clean.BOBOT_UTS : setting_('BOBOT_UTS', 30)),
      ba = num_(clean.BOBOT_UAS !== undefined ? clean.BOBOT_UAS : setting_('BOBOT_UAS', 30));
  if (bh + bu + ba !== 100) return fail_('Total bobot Harian + UTS + UAS harus 100%.');
  ['JAM_MASUK', 'JAM_PULANG', 'AUTO_ALPHA_JAM'].forEach(function (k) { if (clean[k] && !/^\d{2}:\d{2}$/.test(clean[k])) clean[k] = 'X'; });
  if (clean.JAM_MASUK === 'X' || clean.JAM_PULANG === 'X' || clean.AUTO_ALPHA_JAM === 'X') return fail_('Format jam harus HH:mm (contoh 07:15).');
  saveSettings_(clean);
  bump_('absen'); bump_('nilai');
  return ok_(publicCfg_(), 'Pengaturan disimpan.');
}

// ---------------------------------------------------------------------
// D. ABSENSI
// ---------------------------------------------------------------------
function cekLokasi_(lat, lng) {
  var la = Number(lat), lo = Number(lng);
  if (lat === undefined || lat === null || lat === '' || isNaN(la) || isNaN(lo)) return { ok: false, jarak: null, msg: 'Lokasi GPS belum terbaca. Aktifkan izin lokasi di browser.' };
  var jarak = Math.round(haversine_(la, lo, num_(setting_('LAT_SEKOLAH', 0)), num_(setting_('LNG_SEKOLAH', 0))));
  var radius = num_(setting_('RADIUS_M', 100), 100);
  return { ok: jarak <= radius, jarak: jarak, radius: radius, msg: jarak <= radius ? 'Dalam radius (' + jarak + ' m)' : 'Lokasi tidak sesuai area sekolah (' + jarak + ' m dari titik sekolah, maks ' + radius + ' m).' };
}
function terlambat_(jam) { return jam.substring(0, 5) > setting_('JAM_MASUK', '07:15') ? 'YA' : 'TIDAK'; }

function catatHadir_(s, metode, lat, lng, jarak, fotoId, oleh, ket) {
  var tdy = today_(), jam = timeNow_();
  var ada = DB.all('Absensi').filter(function (a) { return String(a.NIS) === String(s.NIS) && String(a.tanggal) === tdy; })[0];
  if (ada && String(ada.status) === 'Hadir') return { duplikat: true, row: ada };
  var row = { NIS: s.NIS, kelas_id: s.kelas_id, tanggal: tdy, jam: jam, status: 'Hadir', metode: metode, latitude: lat === undefined ? '' : lat, longitude: lng === undefined ? '' : lng,
    jarak_m: jarak === null || jarak === undefined ? '' : jarak, foto_selfie_id: fotoId || '', keterangan: ket || (ada ? 'Sebelumnya: ' + ada.status : ''), terlambat: terlambat_(jam), dicatat_oleh: oleh, dibuat_pada: nowIso_() };
  if (ada) { row.absensi_id = ada.absensi_id; DB.updateBatch('Absensi', 'absensi_id', [row]); }
  else { row.absensi_id = reserveIds_('Absensi', 1)[0]; DB.appendBatch('Absensi', [row]); }
  bump_('absen');
  kirimNotif_('ABSEN_HADIR', { nama: s.nama_lengkap, hp: s.no_wa_ortu, email: s.email },
    { jam: jam.substring(0, 5), metode: metodeLabel_(metode), tanggal: tanggalIndo_(tdy), status: row.terlambat === 'YA' ? 'Hadir (terlambat)' : 'Hadir tepat waktu' }, row.absensi_id);
  return { duplikat: false, row: row };
}
function metodeLabel_(m) { return { barcode: 'Scan Barcode', selfie: 'Selfie + GPS', lokasi: 'Lokasi GPS', manual: 'Input Guru' }[m] || m; }
function tanggalIndo_(t) {
  var bln = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var p = String(t).split('-'); return Number(p[2]) + ' ' + bln[Number(p[1]) - 1] + ' ' + p[0];
}
function ringkasHariIni_() {
  var tdy = today_(), c = { H: 0, I: 0, S: 0, A: 0 };
  DB.all('Absensi').forEach(function (a) { if (String(a.tanggal) === tdy) { var st = String(a.status).charAt(0).toUpperCase(); if (c[st] !== undefined) c[st]++; } });
  return c;
}

function apiAbsenScan(ctx, d) {
  var kode = String(d.barcode || '').trim();
  if (!kode) return fail_('Barcode kosong.');
  var up = kode.toUpperCase().replace(/-SIAKAD-SECURE$/, '');
  var s = DB.all('Siswa').filter(function (x) { return String(x.barcode_id).toUpperCase() === up || String(x.NIS) === kode || ('ID-' + x.NIS) === up; })[0];
  if (!s) return fail_('Barcode "' + kode + '" tidak terdaftar.', { code: 'NOT_FOUND' });
  if ((s.status || 'Aktif') !== 'Aktif') return fail_(s.nama_lengkap + ' berstatus ' + s.status + '.');
  var lok = { ok: true, jarak: null };
  if (setting_('GPS_WAJIB_SCAN', 'YA') === 'YA') {
    lok = cekLokasi_(d.lat, d.lng);
    if (!lok.ok) return fail_(lok.msg, { code: 'OUT_OF_RANGE', jarak: lok.jarak });
  }
  var r = catatHadir_(s, 'barcode', d.lat, d.lng, lok.jarak, '', ctx.session.email, d.sesi || '');
  var kelas = DB.find('Kelas', 'kelas_id', s.kelas_id) || {};
  return ok_({ duplikat: r.duplikat, row: r.row, siswa: { NIS: s.NIS, nama: s.nama_lengkap, kelas: kelas.nama_kelas || s.kelas_id, foto: s.foto_profil_url }, jarak: lok.jarak, ringkas: ringkasHariIni_() },
    r.duplikat ? s.nama_lengkap + ' sudah tercatat hadir pukul ' + String(r.row.jam).substring(0, 5) + '.' : '✅ ' + s.nama_lengkap + ' berhasil diabsen.');
}

function apiAbsenSelf(ctx, d) {
  var s = DB.find('Siswa', 'NIS', ctx.session.ref);
  if (!s) return fail_('Data siswa tidak ditemukan.');
  var metode = d.metode === 'selfie' ? 'selfie' : 'lokasi';
  var lok = cekLokasi_(d.lat, d.lng);
  if (!lok.ok) return fail_(lok.msg.indexOf('tidak sesuai') > -1 ? 'Anda berada di luar area sekolah (' + lok.jarak + ' m, maks ' + lok.radius + ' m).' : lok.msg, { code: 'OUT_OF_RANGE', jarak: lok.jarak });
  var ada = DB.all('Absensi').filter(function (a) { return String(a.NIS) === String(s.NIS) && String(a.tanggal) === today_() && a.status === 'Hadir'; })[0];
  if (ada) return fail_('Anda sudah absen hari ini pukul ' + String(ada.jam).substring(0, 5) + '.', { code: 'DUPLICATE', row: ada });
  var fotoId = '';
  if (metode === 'selfie') {
    if (!d.foto) return fail_('Foto selfie belum diambil.');
    if (String(d.foto).length > 3 * 1024 * 1024) return fail_('Ukuran foto terlalu besar.');
    var nama = s.NIS + '_' + today_().replace(/-/g, '') + '_' + timeNow_().replace(/:/g, '') + '.jpg';
    fotoId = saveBase64File_(CONFIG.SELFIE_FOLDER, nama, 'image/jpeg', d.foto).getId();
  }
  var r = catatHadir_(s, metode, d.lat, d.lng, lok.jarak, fotoId, s.email || ctx.session.email, '');
  return ok_({ row: r.row, jarak: lok.jarak }, 'Absensi berhasil! Tercatat Hadir pukul ' + String(r.row.jam).substring(0, 5) + ' WIB.');
}

var STATUS_ABSEN = { Hadir: 1, Izin: 1, Sakit: 1, Alpha: 1 };
function apiAbsenManual(ctx, d) {
  var tgl = d.tanggal || today_(), items = d.items || [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return fail_('Tanggal tidak valid.');
  if (tgl > today_()) return fail_('Tidak bisa mengisi absensi untuk tanggal yang akan datang.');
  var sMap = {}; DB.all('Siswa').forEach(function (s) { sMap[s.NIS] = s; });
  var idx = {}; DB.all('Absensi').forEach(function (a) { if (String(a.tanggal) === tgl) idx[a.NIS] = a; });
  var ins = [], upd = [], notif = { Alpha: [], Izin: [], Sakit: [] };
  for (var i = 0; i < items.length; i++) {
    var it = items[i], s = sMap[String(it.NIS)];
    if (!s) return fail_('Siswa ' + it.NIS + ' tidak ditemukan.');
    if (!STATUS_ABSEN[it.status]) return fail_('Status harus Hadir, Izin, Sakit, atau Alpha.');
    var ex = idx[s.NIS];
    var row = { NIS: s.NIS, kelas_id: s.kelas_id, tanggal: tgl, jam: ex && ex.jam ? ex.jam : (tgl === today_() ? timeNow_() : '07:00:00'), status: it.status,
      metode: ex && ex.status === 'Hadir' && it.status === 'Hadir' ? ex.metode : 'manual', keterangan: it.keterangan || '', dicatat_oleh: ctx.session.email,
      terlambat: it.status === 'Hadir' ? (ex && ex.terlambat ? ex.terlambat : 'TIDAK') : '', dibuat_pada: nowIso_() };
    if (ex) { row.absensi_id = ex.absensi_id; upd.push(row); } else ins.push(row);
    if (notif[it.status] && (!ex || ex.status !== it.status)) notif[it.status].push(s);
  }
  var ids = reserveIds_('Absensi', ins.length); ins.forEach(function (r, j) { r.absensi_id = ids[j]; });
  DB.appendBatch('Absensi', ins); DB.updateBatch('Absensi', 'absensi_id', upd);
  bump_('absen');
  var tglI = tanggalIndo_(tgl);
  kirimNotifBatch_('ABSEN_ALPHA', notif.Alpha.map(function (s) { return { penerima: { nama: s.nama_lengkap, hp: s.no_wa_ortu, email: s.email }, vars: { tanggal: tglI }, refId: s.NIS }; }));
  kirimNotifBatch_('ABSEN_IZIN_SAKIT', notif.Izin.concat(notif.Sakit).map(function (s) { return { penerima: { nama: s.nama_lengkap, hp: s.no_wa_ortu, email: s.email }, vars: { tanggal: tglI, status: notif.Izin.indexOf(s) > -1 ? 'Izin' : 'Sakit' }, refId: s.NIS }; }));
  return ok_({ ditambah: ins.length, diperbarui: upd.length, ringkas: ringkasHariIni_() }, 'Absensi ' + (ins.length + upd.length) + ' siswa disimpan.');
}

/** Tandai siswa aktif tanpa catatan pada tanggal tsb sebagai Alpha */
function apiAbsenFinalize(ctx, d) {
  var tgl = d.tanggal || today_();
  var sudah = {}; DB.all('Absensi').forEach(function (a) { if (String(a.tanggal) === tgl) sudah[a.NIS] = 1; });
  var target = DB.all('Siswa').filter(function (s) { return (s.status || 'Aktif') === 'Aktif' && !sudah[s.NIS] && (!d.kelas_id || s.kelas_id === d.kelas_id); });
  if (!target.length) return ok_({ n: 0 }, 'Semua siswa sudah memiliki catatan absensi.');
  return apiAbsenManual(ctx, { tanggal: tgl, items: target.map(function (s) { return { NIS: s.NIS, status: 'Alpha', keterangan: 'Tanpa keterangan (otomatis)' }; }) });
}
function autoAlphaCek_() {
  var jam = setting_('AUTO_ALPHA_JAM', ''); if (!jam) return;
  var tdy = today_(), dow = Number(Utilities.formatDate(new Date(), APP.TZ, 'u'));
  if (dow > 5 || PROPS.getProperty('AUTO_ALPHA_DONE') === tdy || timeNow_().substring(0, 5) < jam) return;
  var adaHadir = DB.all('Absensi').some(function (a) { return String(a.tanggal) === tdy && a.status === 'Hadir'; });
  PROPS.setProperty('AUTO_ALPHA_DONE', tdy);
  if (!adaHadir) return;                                   // hari libur → tidak ditandai
  apiAbsenFinalize({ session: { email: 'SYSTEM', role: 'guru' } }, { tanggal: tdy });
}

function apiAbsenList(ctx, d) {
  var dari = d.dari || today_(), sampai = d.sampai || dari;
  var sMap = {}; DB.all('Siswa').forEach(function (s) { sMap[s.NIS] = s; });
  var rows = DB.all('Absensi').filter(function (a) {
    var t = String(a.tanggal);
    return t >= dari && t <= sampai && (!d.kelas_id || a.kelas_id === d.kelas_id) && (!d.NIS || String(a.NIS) === String(d.NIS));
  }).map(function (a) { var s = sMap[a.NIS] || {}; return Object.assign({}, a, { nama: s.nama_lengkap || '(dihapus)' }); })
    .sort(function (a, b) { return String(b.tanggal + b.jam).localeCompare(String(a.tanggal + a.jam)); });
  return ok_({ rows: rows.slice(0, 5000), total: rows.length, dari: dari, sampai: sampai });
}

function apiAbsenFoto(ctx, d) {
  var a = DB.find('Absensi', 'absensi_id', d.absensi_id);
  if (!a || !a.foto_selfie_id) return fail_('Foto tidak tersedia.');
  var k = 'foto_' + a.foto_selfie_id, c = CacheX.get(k);
  if (c) return ok_(c);
  var b = DriveApp.getFileById(a.foto_selfie_id).getBlob();
  var url = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
  CacheX.put(k, url, 21600);
  return ok_(url);
}

// ---------------------------------------------------------------------
// E. MATERI
// ---------------------------------------------------------------------
function youtubeId_(url) {
  var m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(String(url).trim()) ? String(url).trim() : '');
}
function driveId_(url) { var m = String(url || '').match(/\/d\/([A-Za-z0-9_-]{20,})/) || String(url || '').match(/[?&]id=([A-Za-z0-9_-]{20,})/); return m ? m[1] : ''; }

function apiMateriSave(ctx, d) {
  var x = d.data || {}, isNew = !x.materi_id;
  if (!String(x.judul || '').trim()) return fail_('Judul materi wajib diisi.');
  if (!x.mata_pelajaran) return fail_('Mata pelajaran wajib dipilih.');
  var tipe = x.tipe === 'video' ? 'video' : 'dokumen';
  var ada = isNew ? null : DB.find('Materi', 'materi_id', x.materi_id);
  if (!isNew && !ada) return fail_('Materi tidak ditemukan.');
  var row = { judul: String(x.judul).trim(), deskripsi: x.deskripsi || '', mata_pelajaran: x.mata_pelajaran, kelas_id: x.kelas_id || '', guru_id: x.guru_id || ctx.session.ref,
    tipe: tipe, url_konten: ada ? ada.url_konten : '', drive_file_id: ada ? ada.drive_file_id : '', ukuran: ada ? ada.ukuran : '', durasi: x.durasi || (ada ? ada.durasi : ''), status: 'Aktif' };
  if (tipe === 'video') {
    var yid = youtubeId_(x.url_konten);
    if (!yid) return fail_('URL YouTube tidak valid. Contoh: https://www.youtube.com/watch?v=XXXXXXXXXXX');
    row.url_konten = 'https://www.youtube.com/embed/' + yid; row.drive_file_id = ''; row.ukuran = '';
  } else if (d.file && d.file.data) {
    var maks = num_(setting_('MATERI_MAKS_MB', 20), 20) * 1024 * 1024;
    var bytesLen = Math.floor(String(d.file.data).replace(/^data:[^,]+,/, '').length * 3 / 4);
    if (bytesLen > maks) return fail_('Ukuran file melebihi ' + setting_('MATERI_MAKS_MB', 20) + ' MB.');
    if (!/\.(pdf|docx?|pptx?|xlsx?)$/i.test(d.file.name || '')) return fail_('Format file harus PDF, Word, PowerPoint, atau Excel.');
    var f = saveBase64File_(CONFIG.MATERI_FOLDER, d.file.name, d.file.mime || 'application/pdf', d.file.data);
    shareLink_(f);
    if (ada && ada.drive_file_id) { try { DriveApp.getFileById(ada.drive_file_id).setTrashed(true); } catch (e) {} }
    row.drive_file_id = f.getId(); row.url_konten = 'https://drive.google.com/file/d/' + f.getId() + '/preview'; row.ukuran = bytesLen;
  } else if (x.url_konten && x.url_konten !== (ada && ada.url_konten)) {
    var did = driveId_(x.url_konten);
    row.url_konten = did ? 'https://drive.google.com/file/d/' + did + '/preview' : String(x.url_konten).trim();
    row.drive_file_id = did || '';
    if (!/^https?:\/\//.test(row.url_konten) && !/^demo\//.test(row.url_konten)) return fail_('Tautan dokumen harus diawali https://');
  } else if (!row.url_konten) return fail_('Unggah file dokumen atau tempel tautan Google Drive.');
  if (isNew) {
    row.materi_id = reserveIds_('Materi', 1)[0]; row.tanggal_upload = nowIso_();
    DB.appendBatch('Materi', [row]);
    if (d.kirimNotif) {
      var guru = DB.find('Guru', 'NUPTK', row.guru_id) || {};
      kirimNotifBatch_('MATERI_BARU', DB.all('Siswa').filter(function (s) { return (s.status || 'Aktif') === 'Aktif' && (!row.kelas_id || s.kelas_id === row.kelas_id); })
        .map(function (s) { return { penerima: { nama: s.nama_lengkap, hp: s.no_wa, email: s.email }, vars: { judul: row.judul, mapel: row.mata_pelajaran, guru: guru.nama_lengkap || '' }, refId: row.materi_id }; }));
    }
  } else { row.materi_id = ada.materi_id; row.tanggal_upload = ada.tanggal_upload; DB.updateBatch('Materi', 'materi_id', [row]); }
  bump_('master');
  return ok_(row, isNew ? 'Materi berhasil diunggah dan langsung tampil di dashboard siswa.' : 'Materi diperbarui.');
}

function apiMateriDelete(ctx, d) {
  var m = DB.find('Materi', 'materi_id', d.materi_id);
  if (!m) return fail_('Materi tidak ditemukan.');
  DB.updateBatch('Materi', 'materi_id', [{ materi_id: m.materi_id, status: 'Dihapus' }]);
  if (m.drive_file_id && d.hapusFile) { try { DriveApp.getFileById(m.drive_file_id).setTrashed(true); } catch (e) {} }
  bump_('master');
  return ok_(null, 'Materi dihapus.');
}

/** Catat akses materi — antrean cache (jalur baca tidak menulis sheet) */
function apiMateriView(ctx, d) {
  if (ctx.session.role !== 'siswa' || !d.materi_id) return ok_(null);
  var k = 'viewed_' + ctx.session.ref + '_' + d.materi_id, c = CacheService.getScriptCache();
  if (c.get(k)) return ok_(null);
  c.put(k, '1', 21600);
  var lock = LockService.getScriptLock();
  if (lock.tryLock(300)) {
    try { var q = JSON.parse(c.get('viewq') || '[]'); q.push([d.materi_id, ctx.session.ref, nowIso_()]); c.put('viewq', JSON.stringify(q), 21600); }
    finally { lock.releaseLock(); }
  }
  return ok_(null);
}
function flushMateriViews_(q) {
  var have = {}; DB.all('MateriAkses').forEach(function (a) { have[a.materi_id + '|' + a.NIS] = 1; });
  var rows = q.filter(function (r) { var k = r[0] + '|' + r[1]; if (have[k]) return false; have[k] = 1; return true; });
  if (!rows.length) return;
  var ids = reserveIds_('MateriAkses', rows.length);
  DB.appendBatch('MateriAkses', rows.map(function (r, i) { return { akses_id: ids[i], materi_id: r[0], NIS: r[1], waktu: r[2] }; }));
  bump_('master');
}

// ---------------------------------------------------------------------
// F. PENILAIAN
// ---------------------------------------------------------------------
function nilaiKey_(n) { return [n.NIS, lower_(n.mata_pelajaran), n.semester, n.tahun_ajaran].join('|'); }

function apiNilaiList(ctx, d) {
  var ta = d.tahun_ajaran || setting_('TAHUN_AJARAN', ''), sem = d.semester || setting_('SEMESTER', '');
  var siswa = DB.all('Siswa').filter(function (s) { return s.kelas_id === d.kelas_id && (s.status || 'Aktif') === 'Aktif'; });
  var idx = {};
  DB.all('Nilai').forEach(function (n) { if (lower_(n.mata_pelajaran) === lower_(d.mata_pelajaran) && n.semester === sem && n.tahun_ajaran === ta) idx[n.NIS] = n; });
  return ok_({
    tahun_ajaran: ta, semester: sem, kelas_id: d.kelas_id, mata_pelajaran: d.mata_pelajaran,
    rows: siswa.sort(function (a, b) { return a.nama_lengkap.localeCompare(b.nama_lengkap); }).map(function (s) {
      var n = idx[s.NIS] || {};
      return { NIS: s.NIS, nama: s.nama_lengkap, foto: s.foto_profil_url, nilai_id: n.nilai_id || '', nilai_harian: n.nilai_harian === undefined ? '' : n.nilai_harian,
        nilai_uts: n.nilai_uts === undefined ? '' : n.nilai_uts, nilai_uas: n.nilai_uas === undefined ? '' : n.nilai_uas, nilai_akhir: n.nilai_akhir === undefined ? '' : n.nilai_akhir,
        predikat: n.predikat || '', catatan: n.catatan || '', diperbarui_pada: n.diperbarui_pada || '' };
    })
  });
}

function apiNilaiSaveBatch(ctx, d) {
  var ta = d.tahun_ajaran || setting_('TAHUN_AJARAN', ''), sem = d.semester || setting_('SEMESTER', '');
  if (!d.kelas_id || !d.mata_pelajaran) return fail_('Kelas dan mata pelajaran wajib dipilih.');
  var sMap = {}; DB.all('Siswa').forEach(function (s) { sMap[s.NIS] = s; });
  var kkm = num_(setting_('KKM', 70), 70), rows = [], remedial = [], terbit = [];
  var lama = {}; DB.all('Nilai').forEach(function (n) { lama[nilaiKey_(n)] = n; });
  for (var i = 0; i < (d.rows || []).length; i++) {
    var r = d.rows[i], s = sMap[String(r.NIS)];
    if (!s) return fail_('Siswa ' + r.NIS + ' tidak ditemukan.');
    var vals = [r.nilai_harian, r.nilai_uts, r.nilai_uas].map(function (v) { return v === '' || v === null || v === undefined ? '' : Number(v); });
    for (var j = 0; j < 3; j++) if (vals[j] !== '' && (isNaN(vals[j]) || vals[j] < 0 || vals[j] > 100)) return fail_('Nilai ' + s.nama_lengkap + ' harus 0–100.');
    var akhir = hitungAkhir_(vals[0], vals[1], vals[2]);
    var row = { NIS: s.NIS, kelas_id: d.kelas_id, mata_pelajaran: d.mata_pelajaran, guru_id: ctx.session.ref, semester: sem, tahun_ajaran: ta,
      nilai_harian: vals[0], nilai_uts: vals[1], nilai_uas: vals[2], nilai_akhir: akhir, predikat: predikat_(akhir), catatan: r.catatan || '', diperbarui_pada: nowIso_() };
    var prev = lama[nilaiKey_(row)];
    if (akhir !== '' && (!prev || String(prev.nilai_akhir) !== String(akhir))) (akhir < kkm ? remedial : terbit).push({ s: s, akhir: akhir });
    rows.push(row);
  }
  var res = DB.upsert('Nilai', nilaiKey_, rows);
  bump_('nilai');
  if (d.kirimNotif) {
    kirimNotifBatch_('NILAI_TERBIT', terbit.map(function (x) { return { penerima: { nama: x.s.nama_lengkap, hp: x.s.no_wa_ortu, email: x.s.email }, vars: { mapel: d.mata_pelajaran, nilai: x.akhir, predikat: predikat_(x.akhir), semester: sem }, refId: x.s.NIS }; }));
    kirimNotifBatch_('REMEDIAL', remedial.map(function (x) { return { penerima: { nama: x.s.nama_lengkap, hp: x.s.no_wa_ortu, email: x.s.email }, vars: { mapel: d.mata_pelajaran, nilai: x.akhir, kkm: kkm }, refId: x.s.NIS }; }));
  }
  return ok_({ inserted: res.inserted, updated: res.updated, rows: res.rows }, 'Nilai ' + rows.length + ' siswa tersimpan ke Sheets.');
}

// ---------------------------------------------------------------------
// G. LAPORAN — ekspor ke Google Sheets (folder SIAKAD_EXPORTS)
// ---------------------------------------------------------------------
function apiLaporanExport(ctx, d) {
  var headers = d.headers || [], rows = d.rows || [];
  if (!headers.length) return fail_('Tidak ada data untuk diekspor.');
  if (rows.length > 20000) return fail_('Data terlalu besar (maks 20.000 baris).');
  var judul = String(d.judul || 'Laporan SIAKAD').substring(0, 90) + ' — ' + Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HH.mm');
  var ss = SpreadsheetApp.create(judul);
  DriveApp.getFileById(ss.getId()).moveTo(driveFolder_(CONFIG.EXPORTS_FOLDER));
  var sh = ss.getSheets()[0];
  sh.setName('Laporan');
  var data = [headers].concat(rows.map(function (r) { return headers.map(function (h, i) { var v = Array.isArray(r) ? r[i] : r[h]; return v === undefined || v === null ? '' : v; }); }));
  sh.getRange(1, 1, data.length, headers.length).setValues(data);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1E3A5F').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return ok_({ url: ss.getUrl(), id: ss.getId(), nama: judul }, 'Laporan diekspor ke Google Sheets.');
}

// ---------------------------------------------------------------------
// H. DATA CONTOH (demo) — dipanggil setupAppEnvironment()
// ---------------------------------------------------------------------
function prng_(seed) { var s = seed % 2147483647; if (s <= 0) s += 2147483646; return function () { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; }; }

function seedDemo_() {
  var rnd = prng_(20260928), now = nowIso_(), tdy = today_();
  var ta = setting_('TAHUN_AJARAN', '2026/2027');
  // Semester dibuat mencakup hari ini agar grafik demo selalu terisi
  var mulaiD = new Date(new Date(tdy + 'T00:00:00+07:00').getTime() - 45 * 864e5);
  var selesaiD = new Date(new Date(tdy + 'T00:00:00+07:00').getTime() + 90 * 864e5);
  saveSettings_({ SEMESTER_MULAI: Utilities.formatDate(mulaiD, APP.TZ, 'yyyy-MM-dd'), SEMESTER_SELESAI: Utilities.formatDate(selesaiD, APP.TZ, 'yyyy-MM-dd') });

  var guru = [
    ['19780215', 'Drs. H. Hartono, M.Si.', 'guru@sekolah.sch.id', '081298443210', 'Biologi', 'Wali Kelas XII IPA 1'],
    ['19680512', 'Drs. H. Mulyadi, M.Pd.', 'mulyadi@sekolah.sch.id', '081311223344', 'Matematika', 'Guru'],
    ['19840215', 'Siti Nurhaliza, S.Si., M.Sc.', 'siti.nurhaliza@sekolah.sch.id', '081322334455', 'Fisika', 'Guru'],
    ['19770821', "Ahmad Rifa'i, M.Pd.", 'ahmad.rifai@sekolah.sch.id', '081333445566', 'Kimia', 'Wali Kelas XI IPA 1'],
    ['19891004', 'Elizabeth Watson, M.A.', 'elizabeth.watson@sekolah.sch.id', '081344556677', 'Bahasa Inggris', 'Guru'],
    ['19730419', 'K.H. Zainuddin, S.Ag.', 'zainuddin@sekolah.sch.id', '081355667788', 'Pendidikan Agama & Budi Pekerti', 'Guru'],
    ['19710311', 'Dra. Endang Sulistowati', 'endang@sekolah.sch.id', '081366778899', 'Bahasa Indonesia', 'Wali Kelas X-A']
  ];
  DB.appendBatch('Guru', guru.map(function (g) { return { NUPTK: g[0], nama_lengkap: g[1], email: g[2], no_wa: g[3], mata_pelajaran: g[4], jabatan: g[5], foto_profil_url: '', status: 'Aktif', StatusWA: '', CekWAAt: '', dibuat_pada: now }; }));

  var kelas = [['KLS000001', 'XII IPA 1', 'SMA', 'XII', '19780215'], ['KLS000002', 'XI IPA 1', 'SMA', 'XI', '19770821'], ['KLS000003', 'X-A', 'SMA', 'X', '19710311'], ['KLS000004', 'IX-B', 'SMP', 'IX', ''], ['KLS000005', 'VI-A', 'SD', 'VI', '']];
  DB.appendBatch('Kelas', kelas.map(function (k) { return { kelas_id: k[0], nama_kelas: k[1], jenjang: k[2], tingkat: k[3], wali_kelas_id: k[4], tahun_ajaran: ta }; }));
  PROPS.setProperty('SEQ_Kelas', '5');

  var mapel = [['Matematika Wajib', 'MAT', 'Wajib'], ['Matematika Peminatan', 'MTP', 'Peminatan'], ['Fisika', 'FIS', 'Peminatan'], ['Kimia', 'KIM', 'Peminatan'], ['Biologi', 'BIO', 'Peminatan'],
    ['Bahasa Indonesia', 'BIN', 'Wajib'], ['Bahasa Inggris', 'BIG', 'Wajib'], ['Pendidikan Agama & Budi Pekerti', 'PAI', 'Wajib'], ['Sejarah Indonesia', 'SEJ', 'Wajib']];
  DB.appendBatch('Mapel', mapel.map(function (m, i) { return { mapel_id: 'MPL' + ('00000' + (i + 1)).slice(-6), nama: m[0], kode: m[1], kelompok: m[2], jenjang: 'SMA' }; }));
  PROPS.setProperty('SEQ_Mapel', String(mapel.length));

  var depan = ['Ahmad', 'Budi', 'Citra', 'Dewi', 'Dimas', 'Eko', 'Farhan', 'Gita', 'Hendra', 'Indah', 'Joko', 'Kartika', 'Lukman', 'Maya', 'Nanda', 'Oki', 'Putri', 'Rian', 'Siti', 'Taufik', 'Umi', 'Vina', 'Wahyu', 'Yuni', 'Zaki',
    'Aulia', 'Bagus', 'Cahya', 'Dinda', 'Fajar', 'Galih', 'Hana', 'Irfan', 'Jihan', 'Kevin', 'Laila', 'Mega', 'Nabila', 'Olivia', 'Pandu', 'Qori', 'Rizky', 'Salsa', 'Tegar', 'Ulfa', 'Vito', 'Wulan', 'Yoga', 'Zahra', 'Arya'];
  var belakang = ['Fauzi', 'Santoso', 'Lestari', 'Anggraini', 'Bagus', 'Prasetyo', 'Pratama', 'Rahmawati', 'Wijaya', 'Permata', 'Susilo', 'Sari', 'Hakim', 'Safitri', 'Putra', 'Saputra', 'Ayu', 'Pratama', 'Rahma', 'Hidayat',
    'Kalsum', 'Oktaviani', 'Nugroho', 'Kurniasih', 'Ramadhan', 'Azzahra', 'Setiawan', 'Kirana', 'Maharani', 'Nugraha', 'Pamungkas', 'Humaira', 'Maulana', 'Nuraini', 'Wibowo', 'Fitriani', 'Utami', 'Syakira', 'Anjani', 'Wicaksono',
    'Amalia', 'Firmansyah', 'Billa', 'Satria', 'Nisa', 'Alfarizi', 'Handayani', 'Adi', 'Khairunnisa', 'Dwipa'];
  var P = { Citra: 1, Dewi: 1, Gita: 1, Indah: 1, Kartika: 1, Maya: 1, Nanda: 1, Putri: 1, Siti: 1, Umi: 1, Vina: 1, Yuni: 1, Aulia: 1, Cahya: 1, Dinda: 1, Hana: 1, Jihan: 1, Laila: 1, Mega: 1, Nabila: 1, Olivia: 1, Qori: 1, Salsa: 1, Ulfa: 1, Wulan: 1, Zahra: 1 };
  var kota = ['Jakarta', 'Bogor', 'Depok', 'Tangerang', 'Bekasi', 'Bandung'];
  var siswa = [], users = [], nisList = [];
  for (var i = 0; i < 50; i++) {
    var k = i < 20 ? kelas[0] : i < 35 ? kelas[1] : kelas[2];
    var angkatan = k[3] === 'XII' ? '2024' : k[3] === 'XI' ? '2025' : '2026';
    var nis = angkatan + ('0000' + (101 + i)).slice(-4);
    if (i === 0) nis = '20230101';
    var nama = depan[i] + ' ' + belakang[i], jk = P[depan[i]] ? 'P' : 'L';
    var email = i === 0 ? 'siswa@sekolah.sch.id' : slug_(nama) + '@siswa.sch.id';
    var wa = '0812' + ('0000000' + Math.floor(rnd() * 9999999)).slice(-7);
    siswa.push({ NIS: nis, NISN: '00' + ('00000000' + Math.floor(58291048 + i * 7)).slice(-8), nama_lengkap: nama, jenis_kelamin: jk, kelas_id: k[0], jenjang: k[2], barcode_id: 'ID-' + nis,
      email: email, no_wa: '', nama_ortu: (jk === 'L' ? 'Bpk. ' : 'Ibu ') + belakang[(i + 7) % 50] + ' ' + depan[(i + 13) % 50], no_wa_ortu: wa, tempat_lahir: kota[i % kota.length],
      tanggal_lahir: (Number(angkatan) - 15) + '-' + ('0' + (1 + i % 12)).slice(-2) + '-' + ('0' + (1 + (i * 3) % 28)).slice(-2), alamat: 'Jl. Contoh No. ' + (i + 1) + ', ' + kota[i % kota.length],
      foto_profil_url: '', tahun_masuk: angkatan, status: 'Aktif', StatusWA: '', CekWAAt: '', dibuat_pada: now });
    nisList.push(nis);
    var salt = newSalt_();
    users.push({ nama: nama, email: email, password_hash: hashPassword_(i === 0 ? APP.DEMO_PASSWORD_SISWA : nis, salt), salt: salt, role: 'siswa', ref_id: nis, kelas_id: k[0],
      status_aktif: i === 6 || i === 41 ? 'TIDAK' : 'YA', wajib_ganti_sandi: i === 0 ? 'TIDAK' : 'YA', last_login: '', dibuat_pada: now });
  }
  siswa[0].nama_lengkap = 'Ahmad Fauzi'; users[0].nama = 'Ahmad Fauzi';
  guru.forEach(function (g, gi) {
    var salt = newSalt_();
    users.unshift({ nama: g[1], email: g[2], password_hash: hashPassword_(APP.DEMO_PASSWORD_GURU, salt), salt: salt, role: 'guru', ref_id: g[0], kelas_id: '', status_aktif: 'YA', wajib_ganti_sandi: gi === 0 ? 'TIDAK' : 'YA', last_login: '', dibuat_pada: now });
  });
  var uids = reserveIds_('Users', users.length);
  users.forEach(function (u, j) { u.user_id = uids[j]; });
  DB.appendBatch('Siswa', siswa);
  DB.appendBatch('Users', users);

  // Jadwal XII IPA 1 & XI IPA 1
  var slot = [['07:15', '08:45'], ['09:00', '10:30'], ['10:45', '12:15'], ['13:00', '14:30']];
  var plan = { KLS000001: [['Matematika Wajib', '19680512', 'R-302'], ['Fisika', '19840215', 'Lab Fisika'], ['Kimia', '19770821', 'Lab Kimia'], ['Bahasa Inggris', '19891004', 'R. Multimedia'], ['Biologi', '19780215', 'Lab Biologi'],
    ['Matematika Peminatan', '19680512', 'R-302'], ['Bahasa Indonesia', '19710311', 'R-302'], ['Pendidikan Agama & Budi Pekerti', '19730419', 'Aula'], ['Sejarah Indonesia', '19710311', 'R-302']],
    KLS000002: [['Kimia', '19770821', 'Lab Kimia'], ['Matematika Wajib', '19680512', 'R-204'], ['Biologi', '19780215', 'Lab Biologi'], ['Bahasa Inggris', '19891004', 'R-204'], ['Fisika', '19840215', 'Lab Fisika']] };
  var jadwal = [], hariList = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
  var busy = {};
  Object.keys(plan).forEach(function (kid, ki) {
    var n = 0;
    hariList.forEach(function (h, hi) {
      slot.forEach(function (sl, si) {
        if (si === 3 && hi === 4) return;
        var m = plan[kid][(n + ki) % plan[kid].length];
        var bk = h + sl[0] + m[1], rk = h + sl[0] + m[2];
        if (busy[bk] || busy[rk]) { n++; m = plan[kid][(n + ki) % plan[kid].length]; bk = h + sl[0] + m[1]; rk = h + sl[0] + m[2]; if (busy[bk] || busy[rk]) return; }
        busy[bk] = busy[rk] = 1;
        jadwal.push({ kelas_id: kid, mata_pelajaran: m[0], guru_id: m[1], hari: h, jam_mulai: sl[0], jam_selesai: sl[1], ruang: m[2] });
        n++;
      });
    });
  });
  var jids = reserveIds_('Jadwal', jadwal.length); jadwal.forEach(function (j, x) { j.jadwal_id = jids[x]; });
  DB.appendBatch('Jadwal', jadwal);

  // Absensi 30 hari sekolah terakhir (Senin–Jumat) + sebagian hari ini
  var abs = [], base = new Date(tdy + 'T00:00:00+07:00'), hari = 0, back = 0;
  var bolos = { 4: 0.28, 5: 0.25, 17: 0.3, 33: 0.24, 44: 0.27 };   // beberapa siswa kehadiran < 75%
  while (hari < 30 && back < 60) {
    back++;
    var dd = new Date(base.getTime() - back * 864e5), dow = Number(Utilities.formatDate(dd, APP.TZ, 'u'));
    if (dow > 5) continue;
    hari++;
    var t = Utilities.formatDate(dd, APP.TZ, 'yyyy-MM-dd');
    siswa.forEach(function (s, si) {
      var r = rnd(), pb = bolos[si] || 0.04, st = r < pb * 0.6 ? 'Alpha' : r < pb * 0.8 ? 'Izin' : r < pb ? 'Sakit' : 'Hadir';
      var menit = 6 * 60 + 45 + Math.floor(rnd() * 40), jam = ('0' + Math.floor(menit / 60)).slice(-2) + ':' + ('0' + (menit % 60)).slice(-2) + ':' + ('0' + Math.floor(rnd() * 60)).slice(-2);
      var met = st !== 'Hadir' ? 'manual' : ['barcode', 'barcode', 'barcode', 'selfie', 'lokasi'][Math.floor(rnd() * 5)];
      abs.push({ NIS: s.NIS, kelas_id: s.kelas_id, tanggal: t, jam: st === 'Hadir' ? jam : '07:00:00', status: st, metode: met, latitude: st === 'Hadir' ? '-6.2089' : '', longitude: st === 'Hadir' ? '106.8457' : '',
        jarak_m: st === 'Hadir' ? String(10 + Math.floor(rnd() * 60)) : '', foto_selfie_id: '', keterangan: st === 'Izin' ? 'Acara keluarga' : st === 'Sakit' ? 'Surat dokter' : '', terlambat: st === 'Hadir' && jam.substring(0, 5) > '07:15' ? 'YA' : st === 'Hadir' ? 'TIDAK' : '',
        dicatat_oleh: met === 'barcode' || met === 'manual' ? 'guru@sekolah.sch.id' : s.email, dibuat_pada: t + 'T' + jam + '+07:00' });
    });
  }
  var dowT = Number(Utilities.formatDate(base, APP.TZ, 'u'));
  if (dowT <= 5) {
    siswa.slice(1, 14).forEach(function (s, si) {
      var jam = '07:' + ('0' + (2 + si * 2)).slice(-2) + ':' + ('0' + Math.floor(rnd() * 60)).slice(-2);
      abs.push({ NIS: s.NIS, kelas_id: s.kelas_id, tanggal: tdy, jam: jam, status: si === 9 ? 'Izin' : 'Hadir', metode: si === 9 ? 'manual' : si % 4 === 0 ? 'selfie' : 'barcode', latitude: '-6.2088', longitude: '106.8456', jarak_m: String(20 + si * 3), foto_selfie_id: '',
        keterangan: si === 9 ? 'Surat Dokter.pdf' : '', terlambat: si === 9 ? '' : 'TIDAK', dicatat_oleh: 'guru@sekolah.sch.id', dibuat_pada: tdy + 'T' + jam + '+07:00' });
    });
  }
  var aids = reserveIds_('Absensi', abs.length); abs.forEach(function (a, x) { a.absensi_id = aids[x]; });
  DB.appendBatch('Absensi', abs);

  // Nilai
  var nilai = [];
  var mapelKelas = { KLS000001: mapel.map(function (m) { return m[0]; }), KLS000002: ['Matematika Wajib', 'Fisika', 'Kimia', 'Biologi', 'Bahasa Inggris'], KLS000003: ['Matematika Wajib', 'Bahasa Indonesia', 'Bahasa Inggris'] };
  var guruMapel = { 'Matematika Wajib': '19680512', 'Matematika Peminatan': '19680512', 'Fisika': '19840215', 'Kimia': '19770821', 'Biologi': '19780215', 'Bahasa Indonesia': '19710311', 'Bahasa Inggris': '19891004', 'Pendidikan Agama & Budi Pekerti': '19730419', 'Sejarah Indonesia': '19710311' };
  var sem = setting_('SEMESTER', 'Ganjil');
  siswa.forEach(function (s, si) {
    var bakat = si === 0 ? 88 : si === 2 ? 93 : (si === 4 || si === 6) ? 64 : 72 + Math.floor(rnd() * 20);
    (mapelKelas[s.kelas_id] || []).forEach(function (mp) {
      var v = function () { return Math.max(40, Math.min(100, Math.round(bakat + (rnd() - 0.5) * 14))); };
      var h = v(), u = v(), a = s.kelas_id === 'KLS000003' && mp === 'Bahasa Indonesia' ? '' : v();
      var akhir = hitungAkhir_(h, u, a);
      nilai.push({ NIS: s.NIS, kelas_id: s.kelas_id, mata_pelajaran: mp, guru_id: guruMapel[mp], semester: sem, tahun_ajaran: ta, nilai_harian: h, nilai_uts: u, nilai_uas: a, nilai_akhir: akhir, predikat: predikat_(akhir),
        catatan: akhir !== '' && akhir >= 90 ? 'Pemahaman sangat baik, pertahankan.' : akhir !== '' && akhir < 70 ? 'Perlu remedial KD utama.' : '', diperbarui_pada: now });
    });
  });
  var nids = reserveIds_('Nilai', nilai.length); nilai.forEach(function (n, x) { n.nilai_id = nids[x]; });
  DB.appendBatch('Nilai', nilai);

  // Materi
  var mt = [
    ['Modul Turunan Fungsi Trigonometri Lanjutan & Penerapannya', 'Pembahasan mendalam konsep turunan kedua fungsi trigonometri, grafik kurva kecepatan sesaat, dan latihan soal persiapan ujian.', 'Matematika Peminatan', 'KLS000001', '19680512', 'dokumen', 'demo/modul-trigonometri.pdf', 2457600, ''],
    ['Eksperimen Efek Fotolistrik & Dualisme Gelombang Partikel', 'Video demonstrasi efek fotolistrik, frekuensi ambang logam, dan interpretasi grafik fungsi kerja foton.', 'Fisika', 'KLS000001', '19840215', 'video', 'https://www.youtube.com/embed/6k_sXYgwMeA', '', '45 Menit'],
    ['Tata Nama Senyawa Benzena & Turunannya (Orto, Meta, Para)', 'Struktur cincin aromatik, reaksi substitusi elektrofilik, serta turunan monosubstitusi dan disubstitusi benzena dalam industri.', 'Kimia', 'KLS000001', '19770821', 'dokumen', 'demo/benzena.pdf', 1887436, ''],
    ['Turunan Fungsi Trigonometri — Video Pembahasan', 'Rumus dasar turunan sin, cos, tan beserta contoh soal bertahap.', 'Matematika Peminatan', 'KLS000001', '19680512', 'video', 'https://www.youtube.com/embed/HC6BNJGKoTk', '', '30 Menit'],
    ['Kumpulan Soal & Pembahasan Limit Menuju Tak Hingga', 'Trik cepat metode rasionalisasi akar sekawan, teorema limit fungsi aljabar, dan bank soal evaluasi mandiri semester ganjil.', 'Matematika Wajib', '', '19680512', 'dokumen', 'demo/limit.pdf', 3250585, ''],
    ['Mekanisme Transpor Membran: Difusi, Osmosis & Endositosis', 'Animasi membran bilayer fosfolipid, transpor aktif primer-sekunder melalui pompa natrium-kalium.', 'Biologi', 'KLS000002', '19780215', 'video', 'https://www.youtube.com/embed/w8CmZzmzh6E', '', '20 Menit']
  ];
  var mids = reserveIds_('Materi', mt.length);
  DB.appendBatch('Materi', mt.map(function (m, x) {
    var tgl = Utilities.formatDate(new Date(base.getTime() - (x * 2 + 1) * 864e5), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return { materi_id: mids[x], judul: m[0], deskripsi: m[1], mata_pelajaran: m[2], kelas_id: m[3], guru_id: m[4], tipe: m[5], url_konten: m[6], drive_file_id: '', ukuran: m[7], durasi: m[8], tanggal_upload: tgl, status: 'Aktif' };
  }));
  var akses = [];
  siswa.slice(0, 20).forEach(function (s, si) { mids.slice(0, 4).forEach(function (m, x) { if (rnd() < 0.6 && !(si === 0 && x > 1)) akses.push({ materi_id: m, NIS: s.NIS, waktu: now }); }); });
  var akids = reserveIds_('MateriAkses', akses.length); akses.forEach(function (a, x) { a.akses_id = akids[x]; });
  DB.appendBatch('MateriAkses', akses);

  // Pengumuman
  var png = [['Jadwal Penilaian Tengah Semester Dirilis', 'Jadwal pelaksanaan Penilaian Tengah Semester Ganjil telah dirilis. Harap siswa mempersiapkan diri dan membawa kartu pelajar ber-barcode.', 'Akademik', 2],
    ['Pendaftaran Lomba Karya Ilmiah Remaja', 'Pendaftaran kompetisi karya ilmiah remaja dan pameran sains dibuka hingga akhir bulan ini. Hubungi wali kelas masing-masing.', 'Event', 5],
    ['Wajib Aktivasi Akun SIAKAD', 'Seluruh siswa wajib login dan mengganti password awal. Absensi mandiri menggunakan selfie/GPS hanya dapat dilakukan di area sekolah.', 'Informasi', 9]];
  var pids = reserveIds_('Pengumuman', png.length);
  DB.appendBatch('Pengumuman', png.map(function (p, x) { return { pengumuman_id: pids[x], judul: p[0], isi: p[1], kategori: p[2], tanggal: Utilities.formatDate(new Date(base.getTime() - p[3] * 864e5), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"), oleh: 'guru@sekolah.sch.id', status: 'Aktif' }; }));

  PROPS.setProperty('DEMO_SEEDED', '1');
  bump_('master'); bump_('absen'); bump_('nilai');
}

/** Hapus data contoh; akun guru yang sedang login dipertahankan */
function apiDemoClear(ctx, d) {
  var me = String(ctx.session.ref);
  ['Siswa', 'Absensi', 'Nilai', 'Materi', 'MateriAkses', 'Jadwal', 'Pengumuman', 'CRM_Kontak', 'CRM_Interaksi', 'AntrianNotif', 'BlastWA'].forEach(function (name) {
    var sh = getSheet_(name), last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
    invalidateRows_(name);
  });
  var keepGuru = DB.all('Guru').filter(function (g) { return String(g.NUPTK) === me; });
  var shG = getSheet_('Guru'); if (shG.getLastRow() > 1) shG.getRange(2, 1, shG.getLastRow() - 1, shG.getLastColumn()).clearContent(); invalidateRows_('Guru');
  DB.appendBatch('Guru', keepGuru);
  var keepU = DB.all('Users').filter(function (u) { return u.role === 'guru' && String(u.ref_id) === me; });
  var shU = getSheet_('Users'); if (shU.getLastRow() > 1) shU.getRange(2, 1, shU.getLastRow() - 1, shU.getLastColumn()).clearContent(); invalidateRows_('Users');
  DB.appendBatch('Users', keepU);
  if (d.hapusKelas) {
    ['Kelas', 'Mapel'].forEach(function (n) { var sh = getSheet_(n); if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent(); invalidateRows_(n); });
  }
  PROPS.setProperty('DEMO_SEEDED', '0');
  PROPS.setProperty('ANTRIAN_MULAI', '2'); PROPS.setProperty('ANTRIAN_ADA', '0');
  bump_('master'); bump_('absen'); bump_('nilai');
  return ok_(null, 'Data contoh dihapus. Sistem siap diisi data sekolah Anda.');
}

;
// ==== Migrasi.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA — File 3/5 : Migrasi.gs  (gas-migrasi-database)
 *  Import data dari spreadsheet app LAMA → app baru.
 *  • App lama HANYA DIBACA (openById), tidak pernah ditulis.
 *  • Baca berdasarkan NAMA header (dengan alias), bukan indeks kolom.
 *  • Idempoten (upsert kunci alami) • Dry-run • Delta sync • Batch 1× tulis/sheet
 *  • Keputusan di app baru tidak ditimpa (kecuali opsi "timpa").
 * =====================================================================
 */

/** Alias nama sheet di app lama */
var MIG_SHEET_ALIAS = {
  Kelas: ['Kelas', 'Data Kelas', 'Rombel', 'Classes'],
  Mapel: ['Mapel', 'Mata Pelajaran', 'MataPelajaran', 'Subjects'],
  Guru: ['Guru', 'Data Guru', 'Teachers', 'Pengajar'],
  Siswa: ['Siswa', 'Data Siswa', 'DataSiswa', 'Students', 'Peserta Didik'],
  Users: ['Users', 'User', 'Akun', 'Login'],
  Jadwal: ['Jadwal', 'Jadwal Pelajaran', 'Schedule'],
  Materi: ['Materi', 'Materi Pembelajaran', 'Materials'],
  Absensi: ['Absensi', 'Presensi', 'Kehadiran', 'Attendance'],
  Nilai: ['Nilai', 'Penilaian', 'Grades', 'Raport'],
  Pengumuman: ['Pengumuman', 'Announcements', 'Informasi'],
  Config: ['Config', 'Pengaturan', 'Settings', 'AppConfig']
};
/** Alias kolom → kolom target (dicocokkan setelah dinormalisasi: huruf kecil tanpa spasi/simbol) */
var MIG_COL_ALIAS = {
  NIS: ['nis', 'nomorinduksiswa', 'noinduk', 'nisn_lokal', 'studentid'],
  NISN: ['nisn'],
  nama_lengkap: ['namalengkap', 'nama', 'namasiswa', 'namaguru', 'fullname', 'name'],
  jenis_kelamin: ['jeniskelamin', 'jk', 'gender', 'lp'],
  kelas_id: ['kelasid', 'kelas', 'rombel', 'idkelas', 'namakelas', 'class'],
  jenjang: ['jenjang', 'tingkatpendidikan', 'level'],
  barcode_id: ['barcodeid', 'barcode', 'kodebarcode', 'qr', 'qrcode'],
  email: ['email', 'emailsiswa', 'emailguru', 'surel'],
  no_wa: ['nowa', 'wa', 'nohp', 'hp', 'whatsapp', 'telepon', 'nohpsiswa', 'nowasiswa'],
  nama_ortu: ['namaortu', 'namaorangtua', 'namawali', 'ortu', 'wali'],
  no_wa_ortu: ['nowaortu', 'hportu', 'nohportu', 'waortu', 'nohpwali', 'nowawali', 'telportu', 'nowhatsapporangtua'],
  tempat_lahir: ['tempatlahir'], tanggal_lahir: ['tanggallahir', 'tgllahir', 'ttl_tanggal'],
  alamat: ['alamat', 'alamatdomisili'], foto_profil_url: ['fotoprofilurl', 'foto', 'fotourl', 'pasfoto'],
  tahun_masuk: ['tahunmasuk', 'angkatan', 'tahunangkatan'], status: ['status', 'statussiswa', 'statusaktif'],
  NUPTK: ['nuptk', 'nip', 'guruid', 'idguru', 'kodeguru'],
  mata_pelajaran: ['matapelajaran', 'mapel', 'subject', 'pelajaran'],
  jabatan: ['jabatan', 'tugastambahan'],
  nama_kelas: ['namakelas', 'kelas', 'rombel', 'nama'], tingkat: ['tingkat', 'grade'], wali_kelas_id: ['walikelasid', 'walikelas', 'wali'], tahun_ajaran: ['tahunajaran', 'ta'],
  nama: ['nama', 'namamapel', 'namalengkap'], kode: ['kode', 'kodemapel'], kelompok: ['kelompok', 'kategori'],
  user_id: ['userid', 'id'], password_hash: ['passwordhash', 'hash', 'password'], salt: ['salt'], role: ['role', 'peran', 'level'], ref_id: ['refid', 'nis', 'nuptk', 'nip', 'noinduk'], status_aktif: ['statusaktif', 'aktif', 'status'],
  jadwal_id: ['jadwalid', 'id'], guru_id: ['guruid', 'nuptk', 'nip', 'idguru', 'guru'], hari: ['hari', 'day'], jam_mulai: ['jammulai', 'mulai', 'start'], jam_selesai: ['jamselesai', 'selesai', 'end'], ruang: ['ruang', 'ruangan', 'room'],
  materi_id: ['materiid', 'id'], judul: ['judul', 'title'], deskripsi: ['deskripsi', 'keterangan', 'description'], tipe: ['tipe', 'jenis', 'type'], url_konten: ['urlkonten', 'url', 'link', 'tautan'], drive_file_id: ['drivefileid', 'fileid'], tanggal_upload: ['tanggalupload', 'tanggal', 'createdat'],
  absensi_id: ['absensiid', 'id'], tanggal: ['tanggal', 'tgl', 'date'], jam: ['jam', 'waktu', 'time'], metode: ['metode', 'method', 'cara'], latitude: ['latitude', 'lat'], longitude: ['longitude', 'lng', 'long', 'lon'], foto_selfie_id: ['fotoselfieurl', 'fotoselfie', 'fotoselfieid', 'selfie'], keterangan: ['keterangan', 'catatan', 'note'],
  nilai_id: ['nilaiid', 'id'], semester: ['semester'], nilai_harian: ['nilaiharian', 'harian', 'tugas'], nilai_uts: ['nilaiuts', 'uts', 'pts'], nilai_uas: ['nilaiuas', 'uas', 'pas'], nilai_akhir: ['nilaiakhir', 'akhir', 'na'], catatan: ['catatan', 'deskripsi'],
  pengumuman_id: ['pengumumanid', 'id'], isi: ['isi', 'konten', 'content'], kategori: ['kategori', 'category'], oleh: ['oleh', 'author', 'penulis']
};

function normKey_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/_/g, ''); }

function openSource_(idOrUrl) {
  var m = String(idOrUrl || '').match(/\/d\/([A-Za-z0-9_-]{20,})/);
  var id = m ? m[1] : String(idOrUrl || '').trim();
  if (!id) throw new Error('Tempel URL atau ID spreadsheet app LAMA.');
  if (id === getSS_().getId()) throw new Error('Itu spreadsheet app baru. Tempel spreadsheet app LAMA.');
  try { return SpreadsheetApp.openById(id); }
  catch (e) { throw new Error('Spreadsheet tidak bisa dibuka. Pastikan ID benar & dimiliki / dibagikan ke akun Google pemilik script ini.'); }
}

/** Baca sheet sumber menjadi objek dengan kolom target (lewat alias). null = sheet tidak ada. */
function readSource_(ss, target) {
  var sh = null, names = MIG_SHEET_ALIAS[target] || [target];
  for (var i = 0; i < names.length && !sh; i++) sh = ss.getSheetByName(names[i]);
  if (!sh) {
    var lowerNames = names.map(normKey_);
    ss.getSheets().forEach(function (s) { if (!sh && lowerNames.indexOf(normKey_(s.getName())) > -1) sh = s; });
  }
  if (!sh) return null;
  var v = sh.getDataRange().getValues(); if (v.length <= 1) return { sheet: sh.getName(), rows: [], headers: v[0] || [] };
  var h = v[0].map(String), hn = h.map(normKey_);
  var cols = SCHEMA[target] ? SCHEMA[target].cols : Object.keys(MIG_COL_ALIAS);
  var peta = {};                                          // kolom target → indeks sumber
  cols.forEach(function (c) {
    var exact = h.indexOf(c); if (exact > -1) { peta[c] = exact; return; }
    var cand = [normKey_(c)].concat(MIG_COL_ALIAS[c] || []);
    for (var j = 0; j < cand.length; j++) { var ix = hn.indexOf(cand[j]); if (ix > -1 && Object.keys(peta).map(function (k) { return peta[k]; }).indexOf(ix) === -1) { peta[c] = ix; return; } }
  });
  var rows = v.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = { _raw: {} }; h.forEach(function (k, i) { o._raw[normKey_(k)] = r[i]; });
    Object.keys(peta).forEach(function (c) { o[c] = r[peta[c]]; });
    return o;
  });
  return { sheet: sh.getName(), rows: rows, headers: h, peta: peta };
}

// ---- Normalisasi nilai ----
function tglIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd');
  var s = String(v || '').trim(); if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}
function jamIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, APP.TZ, 'HH:mm:ss');
  var m = String(v || '').match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] + ':' + (m[3] || '00') : '';
}
function jamHM_(v) { var j = jamIso_(v); return j ? j.substring(0, 5) : ''; }
function statusAbsen_(v) {
  var s = lower_(v);
  if (/^(h|hadir|present|masuk)/.test(s)) return 'Hadir';
  if (/^(i|izin|ijin|permit)/.test(s)) return 'Izin';
  if (/^(s|sakit|sick)/.test(s)) return 'Sakit';
  if (/^(a|alpa|alpha|absent|tanpa)/.test(s)) return 'Alpha';
  return 'Hadir';
}
function jkNorm_(v) { var s = lower_(v); return /^(p|perempuan|f|female|wanita)/.test(s) ? 'P' : 'L'; }
function driveUrlNorm_(v) {
  var id = driveId_(v);
  return id ? 'https://drive.google.com/file/d/' + id + '/preview' : String(v || '').trim();
}
function str_(v) { return v instanceof Date ? Utilities.formatDate(v, APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX") : (v === null || v === undefined ? '' : String(v).trim()); }

/**
 * Upsert batch per skill: target dibaca 1×, digabung di memori, ditulis 1×.
 * plan = { target, key(o), rows[], updatable[], fillBlank?, onlyIfPending?, sortBy? }
 */
function upsertPlan_(plan, dryRun) {
  var sh = getSheet_(plan.target), values = sh.getDataRange().getValues(), h = values[0].map(String);
  var toObj = function (r) { var o = {}; h.forEach(function (k, i) { o[k] = normCell_(k, r[i]); }); return o; };
  var index = {};
  for (var r = 1; r < values.length; r++) { if (values[r].join('') === '') continue; var k0 = plan.key(toObj(values[r])); if (k0) index[k0] = r; }
  var res = { source: plan.rows.length, inserted: 0, updated: 0, skipped: 0 }, newRows = [], seen = {}, dupe = 0;
  var keyCol = SCHEMA[plan.target].key, needIds = [];
  plan.rows.forEach(function (src) {
    var k = plan.key(src);
    if (!k) { res.skipped++; return; }
    if (seen[k]) { res.skipped++; dupe++; return; } seen[k] = true;
    if (index[k] !== undefined) {
      var row = values[index[k]], changed = false;
      var fields = (plan.updatable || []).concat(plan.fillBlank ? h : []);
      fields.forEach(function (f) {
        var i = h.indexOf(f); if (i === -1 || f === keyCol || src[f] === undefined || src[f] === '') return;
        var isUpd = (plan.updatable || []).indexOf(f) > -1;
        if (!isUpd && String(row[i]) !== '') return;           // fillBlank: hanya kolom kosong
        var v = String(src[f]);
        if (String(row[i]) !== v) { row[i] = v; changed = true; }
      });
      changed ? res.updated++ : res.skipped++;
    } else {
      var nr = h.map(function (f) { return src[f] !== undefined && src[f] !== null ? String(src[f]) : ''; });
      if (!nr[h.indexOf(keyCol)] && SCHEMA[plan.target].prefix) needIds.push(newRows.length);
      newRows.push(nr); res.inserted++;
    }
  });
  if (dupe) res.dupe = dupe;
  if (!dryRun && (res.updated || newRows.length)) {
    if (needIds.length) { var ids = reserveIds_(plan.target, needIds.length), ki = h.indexOf(keyCol); needIds.forEach(function (n, j) { newRows[n][ki] = ids[j]; }); }
    var body = values.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) { return r.map(function (c, i) { return c instanceof Date ? normCell_(h[i], c) : c; }); }).concat(newRows);
    if (plan.sortBy) { var si = h.indexOf(plan.sortBy); body.sort(function (a, b) { return String(a[si]).localeCompare(String(b[si])); }); }
    var all = [h].concat(body), max = sh.getMaxRows();
    if (all.length > max) { sh.insertRowsAfter(max, all.length - max + 100); sh.getRange(max + 1, 1, all.length - max + 100, h.length).setNumberFormat('@'); }
    sh.getRange(1, 1, all.length, h.length).setValues(all);
    var sisa = values.length - all.length; if (sisa > 0) sh.getRange(all.length + 1, 1, sisa, h.length).clearContent();
    invalidateRows_(plan.target);
    var pre = SCHEMA[plan.target].prefix;
    if (pre) {                                            // jaga high-water mark ID agar tidak bentrok dengan ID lama
      var kIx = h.indexOf(keyCol), mx = Number(PROPS.getProperty('SEQ_' + plan.target) || 0);
      body.forEach(function (r) { var m = String(r[kIx]).match(new RegExp('^' + pre + '(\\d+)$')); if (m) mx = Math.max(mx, Number(m[1])); });
      PROPS.setProperty('SEQ_' + plan.target, String(mx));
    }
  }
  return res;
}

var MIG_URUTAN = ['Kelas', 'Mapel', 'Guru', 'Siswa', 'Users', 'Jadwal', 'Materi', 'Absensi', 'Nilai', 'Pengumuman', 'Config'];

function apiMigrasiScan(ctx, d) {
  var ss = openSource_(d.source), info = {};
  MIG_URUTAN.forEach(function (t) {
    var s = readSource_(ss, t);
    info[t] = s ? { ada: true, sheet: s.sheet, baris: s.rows.length, kolom: s.headers.length, terpetakan: Object.keys(s.peta || {}) } : { ada: false };
  });
  var dry = migrasiJalan_(ss, d, true);
  return ok_({ source: { name: ss.getName(), id: ss.getId() }, sheets: info, report: dry.report, warnings: dry.warnings, dryRun: true });
}

function apiMigrasiRun(ctx, d) {
  var ss = openSource_(d.source);
  var out = migrasiJalan_(ss, d, !!d.dryRun);
  if (!d.dryRun) {
    bump_('master'); bump_('absen'); bump_('nilai');
    PROPS.setProperty('MIGRASI_TERAKHIR', JSON.stringify({ at: nowIso_(), source: ss.getId(), name: ss.getName() }));
    queueLog_([ctx.session.email, 'guru', 'IMPORT_RUN', JSON.stringify(out.report).substring(0, 400), ss.getId()]);
    try { svcCrmSync(ctx, {}); } catch (e) {}
  }
  return ok_({ source: { name: ss.getName(), id: ss.getId() }, dryRun: !!d.dryRun, report: out.report, warnings: out.warnings },
    d.dryRun ? 'Pindai selesai (tidak ada data yang ditulis).' : 'Import selesai.');
}

/** Inti migrasi: master dulu, lalu relasi. */
function migrasiJalan_(ss, d, dryRun) {
  var pilih = d.sheets && d.sheets.length ? d.sheets : ['Kelas', 'Mapel', 'Guru', 'Siswa', 'Users', 'Jadwal', 'Materi', 'Nilai', 'Pengumuman', 'Config'];
  var timpa = !!d.overwrite, report = {}, warnings = [];
  var src = {}; MIG_URUTAN.forEach(function (t) { if (pilih.indexOf(t) > -1 || ['Kelas', 'Siswa', 'Guru'].indexOf(t) > -1) src[t] = readSource_(ss, t); });

  // ---- Resolver kelas: id lama / nama → id baru ----
  var kelasSrcNama = {};
  (src.Kelas ? src.Kelas.rows : []).forEach(function (k) { var nm = str_(k.nama_kelas || k.nama || k.kelas_id); if (k.kelas_id) kelasSrcNama[lower_(k.kelas_id)] = nm; kelasSrcNama[lower_(nm)] = nm; });
  function kelasResolver() {
    var map = {};
    DB.all('Kelas').forEach(function (k) { map[lower_(k.kelas_id)] = k.kelas_id; map[lower_(k.nama_kelas)] = k.kelas_id; });
    return function (v) { var s = lower_(v); if (!s) return ''; if (map[s]) return map[s]; var nm = kelasSrcNama[s]; return nm && map[lower_(nm)] ? map[lower_(nm)] : (dryRun && nm ? 'BARU:' + nm : ''); };
  }
  function run(t, plan) {
    if (pilih.indexOf(t) === -1) return;
    if (!src[t]) { report[t] = { source: 0, inserted: 0, updated: 0, skipped: 0, catatan: 'Sheet tidak ditemukan di app lama' }; return; }
    report[t] = upsertPlan_(plan, dryRun);
    if (report[t].dupe) warnings.push(t + ': ' + report[t].dupe + ' baris ganda di sumber dilewati.');
  }

  // 1. Kelas
  run('Kelas', { target: 'Kelas', key: function (o) { return lower_(o.nama_kelas); }, fillBlank: true, updatable: timpa ? ['jenjang', 'tingkat', 'wali_kelas_id', 'tahun_ajaran'] : [],
    rows: src.Kelas ? src.Kelas.rows.map(function (k) {
      var nm = str_(k.nama_kelas || k.kelas_id), jj = String(k.jenjang || '').toUpperCase();
      var ada = DB.find('Kelas', 'kelas_id', str_(k.kelas_id));
      return { kelas_id: ada ? '' : str_(k.kelas_id), nama_kelas: nm, jenjang: ['SD', 'SMP', 'SMA'].indexOf(jj) > -1 ? jj : (/^(x|xi|xii)\b/i.test(nm) ? 'SMA' : /^(vii|viii|ix)\b/i.test(nm) ? 'SMP' : 'SD'),
        tingkat: str_(k.tingkat), wali_kelas_id: str_(k.wali_kelas_id), tahun_ajaran: str_(k.tahun_ajaran) || setting_('TAHUN_AJARAN', '') };
    }) : [] });
  // Kelas yang hanya disebut di data siswa (tanpa sheet Kelas) → buat otomatis
  if (src.Siswa && pilih.indexOf('Siswa') > -1) {
    var rk = kelasResolver(), baruK = {};
    src.Siswa.rows.forEach(function (s) { var v = str_(s.kelas_id); if (v && !rk(v)) baruK[lower_(v)] = v; });
    var listK = Object.keys(baruK).map(function (k) { return { nama_kelas: baruK[k], jenjang: /^(x|xi|xii)\b/i.test(baruK[k]) ? 'SMA' : /^(vii|viii|ix)\b/i.test(baruK[k]) ? 'SMP' : 'SD', tahun_ajaran: setting_('TAHUN_AJARAN', '') }; });
    if (listK.length) {
      var rK = upsertPlan_({ target: 'Kelas', key: function (o) { return lower_(o.nama_kelas); }, rows: listK }, dryRun);
      warnings.push('Kelas dibuat otomatis dari data siswa: ' + listK.map(function (k) { return k.nama_kelas; }).join(', ') + (dryRun ? ' (akan dibuat)' : ''));
      listK.forEach(function (k) { kelasSrcNama[lower_(k.nama_kelas)] = k.nama_kelas; });
      if (report.Kelas) report.Kelas.inserted += rK.inserted;
    }
  }
  // 2. Mapel
  run('Mapel', { target: 'Mapel', key: function (o) { return lower_(o.nama); }, fillBlank: true, updatable: timpa ? ['kode', 'kelompok'] : [],
    rows: src.Mapel ? src.Mapel.rows.map(function (m) { return { nama: str_(m.nama || m.mata_pelajaran), kode: str_(m.kode), kelompok: str_(m.kelompok) || 'Wajib', jenjang: str_(m.jenjang) }; }) : [] });
  // 3. Guru
  run('Guru', { target: 'Guru', key: function (o) { return lower_(o.NUPTK); }, fillBlank: true, updatable: timpa ? ['nama_lengkap', 'mata_pelajaran', 'jabatan', 'foto_profil_url'] : [],
    rows: src.Guru ? src.Guru.rows.map(function (g) { return { NUPTK: str_(g.NUPTK), nama_lengkap: str_(g.nama_lengkap), email: lower_(g.email), no_wa: hp08_(g.no_wa), mata_pelajaran: str_(g.mata_pelajaran), jabatan: str_(g.jabatan) || 'Guru', foto_profil_url: str_(g.foto_profil_url), status: 'Aktif', dibuat_pada: nowIso_() }; }) : [] });
  // 4. Siswa
  var rkS = kelasResolver(), yatimKelas = 0;
  run('Siswa', { target: 'Siswa', key: function (o) { return lower_(o.NIS); }, fillBlank: true,
    updatable: timpa ? ['nama_lengkap', 'NISN', 'kelas_id', 'jenjang', 'nama_ortu', 'no_wa_ortu', 'alamat', 'foto_profil_url'] : [],
    rows: src.Siswa ? src.Siswa.rows.map(function (s) {
      var nis = str_(s.NIS).replace(/\.0+$/, ''), kid = rkS(s.kelas_id);
      if (s.kelas_id && !kid) yatimKelas++;
      var kel = DB.find('Kelas', 'kelas_id', kid) || {};
      return { NIS: nis, NISN: str_(s.NISN).replace(/\.0+$/, '').replace(/^(\d{8,9})$/, function (x) { return ('00' + x).slice(-10); }), nama_lengkap: str_(s.nama_lengkap), jenis_kelamin: jkNorm_(s.jenis_kelamin),
        kelas_id: kid.indexOf('BARU:') === 0 ? '' : kid, jenjang: str_(s.jenjang) || kel.jenjang || '', barcode_id: str_(s.barcode_id) || ('ID-' + nis), email: lower_(s.email), no_wa: hp08_(s.no_wa),
        nama_ortu: str_(s.nama_ortu), no_wa_ortu: hp08_(s.no_wa_ortu), tempat_lahir: str_(s.tempat_lahir), tanggal_lahir: tglIso_(s.tanggal_lahir), alamat: str_(s.alamat),
        foto_profil_url: /drive\.google\.com/.test(str_(s.foto_profil_url)) && driveId_(s.foto_profil_url) ? 'https://drive.google.com/thumbnail?id=' + driveId_(s.foto_profil_url) + '&sz=w400' : str_(s.foto_profil_url),
        tahun_masuk: str_(s.tahun_masuk), status: /lulus/i.test(str_(s.status)) ? 'Lulus' : /pindah/i.test(str_(s.status)) ? 'Pindah' : /non|tidak|false/i.test(str_(s.status)) ? 'Nonaktif' : 'Aktif', dibuat_pada: nowIso_() };
    }) : [] });
  if (yatimKelas) warnings.push(yatimKelas + ' siswa merujuk kelas yang tidak ditemukan — kolom kelas dikosongkan, atur ulang di menu Data Siswa.');
  if (src.Siswa) { var cnt = {}; src.Siswa.rows.forEach(function (s) { var e = lower_(s.email); if (e) cnt[e] = (cnt[e] || 0) + 1; }); var g2 = Object.keys(cnt).filter(function (e) { return cnt[e] > 1; }); if (g2.length) warnings.push('Email ganda di data siswa lama: ' + g2.slice(0, 5).join(', ') + (g2.length > 5 ? '…' : '')); }

  // 5. Users (akun login) — hash lama dipertahankan bila ada
  if (pilih.indexOf('Users') > -1) {
    var admin = 0, tanpaHash = 0, uRows = [];
    (src.Users ? src.Users.rows : []).forEach(function (u) {
      var role = lower_(u.role);
      if (/admin/.test(role)) { admin++; role = 'guru'; }
      role = /guru|teacher|admin/.test(role) ? 'guru' : 'siswa';
      var hash = str_(u.password_hash), salt = str_(u.salt), ref = str_(u.ref_id || u._raw.nis || u._raw.nuptk).replace(/\.0+$/, '');
      if (!/^[a-f0-9]{64}$/i.test(hash) && !/^[A-Za-z0-9+\/]{43}=$/.test(hash)) { tanpaHash++; salt = newSalt_(); hash = hashPassword_(ref || 'siakad123', salt); }
      uRows.push({ nama: str_(u.nama || u.nama_lengkap), email: lower_(u.email), password_hash: hash, salt: salt, role: role, ref_id: ref, kelas_id: '', status_aktif: /^(tidak|false|0|nonaktif|n)$/i.test(str_(u.status_aktif)) ? 'TIDAK' : 'YA',
        wajib_ganti_sandi: tanpaHash ? 'YA' : 'TIDAK', last_login: '', dibuat_pada: nowIso_() });
    });
    // Akun otomatis untuk siswa/guru yang belum punya akun (password awal = NIS / NUPTK)
    if (d.buatAkun !== false) {
      var punya = {}; DB.all('Users').forEach(function (u) { punya[u.role + ':' + u.ref_id] = 1; }); uRows.forEach(function (u) { punya[u.role + ':' + u.ref_id] = 1; });
      var dom = setting_('EMAIL_DOMAIN_SISWA', 'siswa.sch.id'), dipakai = {}; DB.all('Users').forEach(function (u) { dipakai[lower_(u.email)] = 1; }); uRows.forEach(function (u) { dipakai[u.email] = 1; });
      var auto = 0;
      var sumberSiswa = dryRun && src.Siswa ? src.Siswa.rows.map(function (s) { return { NIS: str_(s.NIS).replace(/\.0+$/, ''), nama_lengkap: str_(s.nama_lengkap), email: lower_(s.email) }; }) : DB.all('Siswa');
      sumberSiswa.forEach(function (s) {
        if (!s.NIS || punya['siswa:' + s.NIS]) return;
        var e = lower_(s.email); if (!e || dipakai[e]) { var base = slug_(s.nama_lengkap).split('.').slice(0, 2).join('.') || s.NIS; e = base + '@' + dom; var i = 2; while (dipakai[e]) { e = base + i + '@' + dom; i++; } }
        dipakai[e] = 1; var sl = newSalt_(); auto++;
        uRows.push({ nama: s.nama_lengkap, email: e, password_hash: hashPassword_(s.NIS, sl), salt: sl, role: 'siswa', ref_id: s.NIS, kelas_id: s.kelas_id || '', status_aktif: 'YA', wajib_ganti_sandi: 'YA', last_login: '', dibuat_pada: nowIso_() });
      });
      if (auto) warnings.push(auto + ' akun siswa dibuat otomatis dengan password awal = NIS (wajib ganti saat login).');
    }
    report.Users = upsertPlan_({ target: 'Users', key: function (o) { return lower_(o.email); }, rows: uRows, updatable: [] }, dryRun);
    if (admin) warnings.push(admin + ' akun Admin lama diimpor sebagai Guru (Super Admin).');
    if (tanpaHash) warnings.push(tanpaHash + ' akun lama tanpa hash SHA-256 yang dikenali → password diatur = NIS/NUPTK (wajib ganti).');
    if (!dryRun) {                                       // sinkronkan kelas_id akun siswa
      var km = {}; DB.all('Siswa').forEach(function (s) { km[s.NIS] = s.kelas_id; });
      DB.updateBatch('Users', 'user_id', DB.all('Users').filter(function (u) { return u.role === 'siswa' && km[u.ref_id] !== undefined && u.kelas_id !== km[u.ref_id]; }).map(function (u) { return { user_id: u.user_id, kelas_id: km[u.ref_id] }; }));
    }
  }
  // 6. Jadwal
  var rkJ = kelasResolver();
  run('Jadwal', { target: 'Jadwal', key: function (o) { return [o.kelas_id, lower_(o.hari), jamHM_(o.jam_mulai), lower_(o.mata_pelajaran)].join('|'); }, fillBlank: true, updatable: timpa ? ['guru_id', 'jam_selesai', 'ruang'] : [],
    rows: src.Jadwal ? src.Jadwal.rows.map(function (j) { return { kelas_id: rkJ(j.kelas_id), mata_pelajaran: str_(j.mata_pelajaran), guru_id: str_(j.guru_id).replace(/\.0+$/, ''), hari: str_(j.hari).replace(/^./, function (c) { return c.toUpperCase(); }), jam_mulai: jamHM_(j.jam_mulai), jam_selesai: jamHM_(j.jam_selesai), ruang: str_(j.ruang) }; })
      .filter(function (j) { if (!j.kelas_id) { warnings.push('Jadwal ' + j.mata_pelajaran + ' ' + j.hari + ' dilewati: kelas tidak ditemukan.'); return false; } return true; }) : [] });
  // 7. Materi — ID file Drive lama tetap valid (akun Google sama)
  var rkM = kelasResolver();
  run('Materi', { target: 'Materi', key: function (o) { return lower_(o.materi_id) || lower_(o.judul); }, fillBlank: true, updatable: timpa ? ['judul', 'deskripsi', 'url_konten'] : [],
    rows: src.Materi ? src.Materi.rows.map(function (m) {
      var url = str_(m.url_konten), tipe = /video|youtube/i.test(str_(m.tipe)) || youtubeId_(url) ? 'video' : 'dokumen';
      var did = str_(m.drive_file_id) || driveId_(url);
      return { materi_id: str_(m.materi_id), judul: str_(m.judul), deskripsi: str_(m.deskripsi), mata_pelajaran: str_(m.mata_pelajaran), kelas_id: rkM(m.kelas_id), guru_id: str_(m.guru_id).replace(/\.0+$/, ''), tipe: tipe,
        url_konten: tipe === 'video' ? 'https://www.youtube.com/embed/' + youtubeId_(url) : (did ? 'https://drive.google.com/file/d/' + did + '/preview' : url), drive_file_id: tipe === 'video' ? '' : did,
        ukuran: '', durasi: '', tanggal_upload: str_(m.tanggal_upload) || nowIso_(), status: 'Aktif' };
    }) : [] });
  // 8. Absensi (opsional, bisa besar) — urut ulang by tanggal
  var nisAda = {}; (dryRun && src.Siswa ? src.Siswa.rows.map(function (s) { return str_(s.NIS).replace(/\.0+$/, ''); }) : []).concat(DB.all('Siswa').map(function (s) { return s.NIS; })).forEach(function (n) { nisAda[n] = 1; });
  var kelasSiswa = {}; DB.all('Siswa').forEach(function (s) { kelasSiswa[s.NIS] = s.kelas_id; });
  if (pilih.indexOf('Absensi') > -1) {
    src.Absensi = src.Absensi || readSource_(ss, 'Absensi');
    var yatimA = 0;
    run('Absensi', { target: 'Absensi', key: function (o) { return String(o.NIS) + '|' + tglIso_(o.tanggal); }, updatable: timpa ? ['status', 'keterangan'] : [], sortBy: 'tanggal',
      rows: src.Absensi ? src.Absensi.rows.map(function (a) {
        var nis = str_(a.NIS).replace(/\.0+$/, ''), st = statusAbsen_(a.status), jam = jamIso_(a.jam);
        return { absensi_id: '', NIS: nis, kelas_id: kelasSiswa[nis] || rkM(a.kelas_id), tanggal: tglIso_(a.tanggal), jam: jam, status: st, metode: lower_(a.metode) || 'manual', latitude: str_(a.latitude), longitude: str_(a.longitude),
          jarak_m: '', foto_selfie_id: driveId_(a.foto_selfie_id) || str_(a.foto_selfie_id), keterangan: str_(a.keterangan), terlambat: st === 'Hadir' && jam && jam.substring(0, 5) > setting_('JAM_MASUK', '07:15') ? 'YA' : st === 'Hadir' ? 'TIDAK' : '', dicatat_oleh: 'IMPORT', dibuat_pada: nowIso_() };
      }).filter(function (a) { if (!nisAda[a.NIS]) { yatimA++; return false; } return !!a.tanggal; }) : [] });
    if (yatimA) warnings.push(yatimA + ' baris absensi dilewati karena NIS tidak ada di data siswa.');
  }
  // 9. Nilai — nilai akhir dihitung ulang bila kosong
  if (pilih.indexOf('Nilai') > -1) {
    var yatimN = 0;
    run('Nilai', { target: 'Nilai', key: nilaiKey_, fillBlank: true, updatable: timpa ? ['nilai_harian', 'nilai_uts', 'nilai_uas', 'nilai_akhir', 'predikat', 'catatan'] : [],
      rows: src.Nilai ? src.Nilai.rows.map(function (n) {
        var nis = str_(n.NIS).replace(/\.0+$/, ''), h = n.nilai_harian === '' ? '' : num_(n.nilai_harian, ''), u = n.nilai_uts === '' ? '' : num_(n.nilai_uts, ''), a = n.nilai_uas === '' ? '' : num_(n.nilai_uas, '');
        var akhir = n.nilai_akhir !== undefined && n.nilai_akhir !== '' ? num_(n.nilai_akhir) : hitungAkhir_(h === undefined ? '' : h, u === undefined ? '' : u, a === undefined ? '' : a);
        return { nilai_id: '', NIS: nis, kelas_id: kelasSiswa[nis] || rkM(n.kelas_id), mata_pelajaran: str_(n.mata_pelajaran), guru_id: str_(n.guru_id).replace(/\.0+$/, ''), semester: str_(n.semester) || setting_('SEMESTER', ''),
          tahun_ajaran: str_(n.tahun_ajaran) || setting_('TAHUN_AJARAN', ''), nilai_harian: h === undefined ? '' : h, nilai_uts: u === undefined ? '' : u, nilai_uas: a === undefined ? '' : a, nilai_akhir: akhir, predikat: predikat_(akhir), catatan: str_(n.catatan), diperbarui_pada: nowIso_() };
      }).filter(function (n) { if (!nisAda[n.NIS]) { yatimN++; return false; } return !!n.mata_pelajaran; }) : [] });
    if (yatimN) warnings.push(yatimN + ' baris nilai dilewati karena NIS tidak ada di data siswa.');
  }
  // 10. Pengumuman
  run('Pengumuman', { target: 'Pengumuman', key: function (o) { return lower_(o.judul) + '|' + String(o.tanggal).substring(0, 10); },
    rows: src.Pengumuman ? src.Pengumuman.rows.map(function (p) { return { judul: str_(p.judul), isi: str_(p.isi), kategori: str_(p.kategori) || 'Informasi', tanggal: str_(p.tanggal) || nowIso_(), oleh: str_(p.oleh) || 'IMPORT', status: 'Aktif' }; }) : [] });
  // 11. Config — salin hanya bila nilai target masih bawaan (seed)
  if (pilih.indexOf('Config') > -1) {
    var cs = readSource_(ss, 'Config'), seed = {}, pairs = {};
    CONFIG_SEED.forEach(function (r) { seed[r[0]] = r[1]; });
    var lama = {};
    if (cs && cs.rows.length) {
      var raw0 = cs.rows[0]._raw;
      if (raw0.key !== undefined && raw0.value !== undefined) cs.rows.forEach(function (r) { lama[normKey_(r._raw.key)] = r._raw.value; });
      else Object.keys(raw0).forEach(function (k) { lama[k] = raw0[k]; });
    }
    var petaCfg = { NAMA_SEKOLAH: ['namasekolah', 'sekolahnama', 'appname', 'namainstitusi'], LAT_SEKOLAH: ['latsekolah', 'latitudesekolah', 'latitude'], LNG_SEKOLAH: ['lngsekolah', 'longitudesekolah', 'longitude'],
      RADIUS_M: ['radiusm', 'radiusabsensimeter', 'radius'], LOGO_URL: ['logourl', 'logo'], ALAMAT_SEKOLAH: ['alamatsekolah', 'alamat'], KKM: ['kkm'] };
    var cfgNow = settings_(), dipakai = [];
    Object.keys(petaCfg).forEach(function (k) {
      var v; petaCfg[k].some(function (a) { if (lama[a] !== undefined && lama[a] !== '') { v = lama[a]; return true; } return false; });
      if (v === undefined) return;
      if ((cfgNow[k] === seed[k] || cfgNow[k] === '' || timpa) && String(cfgNow[k]) !== String(v)) { pairs[k] = str_(v); dipakai.push(k + '=' + str_(v)); }
    });
    report.Config = { source: Object.keys(lama).length, inserted: 0, updated: Object.keys(pairs).length, skipped: 0 };
    if (dipakai.length) warnings.push('Pengaturan lama diterapkan: ' + dipakai.join(', ') + (dryRun ? ' (akan diterapkan)' : ''));
    if (!dryRun && Object.keys(pairs).length) saveSettings_(pairs);
  }
  return { report: report, warnings: warnings };
}

/** Import CSV siswa (data dari luar app) — rows sudah di-parse di browser */
function apiMigrasiCsv(ctx, d) {
  var rows = d.rows || [];
  if (!rows.length) return fail_('CSV kosong.');
  if (rows.length > 3000) return fail_('Maksimal 3.000 baris per import.');
  var kelasMap = {}; DB.all('Kelas').forEach(function (k) { kelasMap[lower_(k.nama_kelas)] = k; kelasMap[lower_(k.kelas_id)] = k; });
  var warnings = [], baruKelas = {};
  var list = rows.map(function (r) {
    var o = {}; Object.keys(r).forEach(function (k) { o[normKey_(k)] = r[k]; });
    var pick = function (col) { var c = [normKey_(col)].concat(MIG_COL_ALIAS[col] || []); for (var i = 0; i < c.length; i++) if (o[c[i]] !== undefined && o[c[i]] !== '') return String(o[c[i]]).trim(); return ''; };
    var kls = pick('kelas_id'), k = kelasMap[lower_(kls)];
    if (kls && !k) baruKelas[lower_(kls)] = kls;
    var nis = pick('NIS');
    return { NIS: nis, NISN: pick('NISN'), nama_lengkap: pick('nama_lengkap'), jenis_kelamin: jkNorm_(pick('jenis_kelamin')), kelas_id: k ? k.kelas_id : kls, jenjang: k ? k.jenjang : '', barcode_id: pick('barcode_id') || ('ID-' + nis),
      email: lower_(pick('email')), no_wa: hp08_(pick('no_wa')), nama_ortu: pick('nama_ortu'), no_wa_ortu: hp08_(pick('no_wa_ortu')), tempat_lahir: pick('tempat_lahir'), tanggal_lahir: tglIso_(pick('tanggal_lahir')),
      alamat: pick('alamat'), foto_profil_url: '', tahun_masuk: pick('tahun_masuk') || setting_('TAHUN_AJARAN', ''), status: 'Aktif', dibuat_pada: nowIso_() };
  }).filter(function (r) { if (!r.NIS || !r.nama_lengkap) { warnings.push('Baris tanpa NIS/nama dilewati.'); return false; } return true; });
  var kb = Object.keys(baruKelas);
  if (kb.length) {
    warnings.push('Kelas baru ' + (d.dryRun ? 'akan dibuat' : 'dibuat') + ': ' + kb.map(function (k) { return baruKelas[k]; }).join(', '));
    if (!d.dryRun) {
      upsertPlan_({ target: 'Kelas', key: function (o) { return lower_(o.nama_kelas); }, rows: kb.map(function (k) { var n = baruKelas[k]; return { nama_kelas: n, jenjang: /^(x|xi|xii)\b/i.test(n) ? 'SMA' : /^(vii|viii|ix)\b/i.test(n) ? 'SMP' : 'SD', tahun_ajaran: setting_('TAHUN_AJARAN', '') }; }) }, false);
      var km = {}; DB.all('Kelas').forEach(function (k) { km[lower_(k.nama_kelas)] = k; });
      list.forEach(function (r) { var k = km[lower_(r.kelas_id)]; if (k) { r.kelas_id = k.kelas_id; r.jenjang = k.jenjang; } });
    }
  }
  var rep = upsertPlan_({ target: 'Siswa', key: function (o) { return lower_(o.NIS); }, rows: list, fillBlank: true, updatable: d.overwrite ? ['nama_lengkap', 'NISN', 'kelas_id', 'jenjang', 'nama_ortu', 'no_wa_ortu', 'alamat'] : [] }, !!d.dryRun);
  var akun = 0;
  if (!d.dryRun && d.buatAkun !== false) {
    var punya = {}; DB.all('Users').forEach(function (u) { if (u.role === 'siswa') punya[u.ref_id] = 1; });
    var dipakai = {}; DB.all('Users').forEach(function (u) { dipakai[lower_(u.email)] = 1; });
    var dom = setting_('EMAIL_DOMAIN_SISWA', 'siswa.sch.id'), baru = [];
    DB.all('Siswa').forEach(function (s) {
      if (punya[s.NIS]) return;
      var e = lower_(s.email); if (!e || dipakai[e]) { var base = slug_(s.nama_lengkap).split('.').slice(0, 2).join('.') || s.NIS; e = base + '@' + dom; var i = 2; while (dipakai[e]) { e = base + i + '@' + dom; i++; } }
      dipakai[e] = 1; var sl = newSalt_();
      baru.push({ nama: s.nama_lengkap, email: e, password_hash: hashPassword_(s.NIS, sl), salt: sl, role: 'siswa', ref_id: s.NIS, kelas_id: s.kelas_id, status_aktif: 'YA', wajib_ganti_sandi: 'YA', last_login: '', dibuat_pada: nowIso_() });
    });
    if (baru.length) { var ids = reserveIds_('Users', baru.length); baru.forEach(function (u, i) { u.user_id = ids[i]; }); DB.appendBatch('Users', baru); akun = baru.length; warnings.push(akun + ' akun siswa dibuat (password awal = NIS).'); }
  }
  if (!d.dryRun) { bump_('master'); try { svcCrmSync(ctx, {}); } catch (e) {} }
  return ok_({ report: { Siswa: rep }, akun: akun, warnings: warnings, dryRun: !!d.dryRun }, d.dryRun ? 'Pindai CSV selesai.' : 'Import CSV selesai.');
}

;
// ==== Notifikasi.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA — File 4/5 : Notifikasi.gs  (gas-notifikasi-wa-crm)
 *  WhatsApp (Fonnte) + Email: saklar utama, matriks event, antrean,
 *  prosesor per menit, blast per batch 10/20/50, deteksi nomor WA.
 *  Token Fonnte disimpan di Script Properties — tidak pernah ke browser.
 * =====================================================================
 */

var FONNTE_API = 'https://api.fonnte.com';

/** Registry kejadian yang bisa diaktif/nonaktifkan. Placeholder umum: {nama} {institusi} {link} */
var NOTIF_EVENTS = {
  AKUN_DIBUAT: { label: 'Akun SIAKAD dibuat (kredensial awal)', wa: true, email: true, vars: ['nama', 'username', 'sandi', 'nis', 'link', 'institusi'],
    subjek: 'Akun SIAKAD {nama}',
    pesan: 'Yth. {nama},\nAkun SIAKAD SISWA telah dibuat.\nUsername: *{username}*\nSandi awal: *{sandi}*\nLogin: {link}\nSegera ganti password setelah login pertama.\n— {institusi}' },
  ABSEN_HADIR: { label: 'Siswa tercatat hadir (ke orang tua)', wa: true, email: false, vars: ['nama', 'status', 'tanggal', 'jam', 'metode', 'institusi'],
    subjek: 'Kehadiran {nama} — {tanggal}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nAnanda tercatat *{status}* pada {tanggal} pukul {jam} WIB ({metode}).\n— {institusi}' },
  ABSEN_ALPHA: { label: 'Siswa alpha / tanpa keterangan', wa: true, email: true, vars: ['nama', 'tanggal', 'institusi'],
    subjek: 'Pemberitahuan Ketidakhadiran {nama}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nAnanda tercatat *TIDAK HADIR tanpa keterangan (Alpha)* pada {tanggal}. Mohon konfirmasi kepada wali kelas.\n— {institusi}' },
  ABSEN_IZIN_SAKIT: { label: 'Siswa izin / sakit dicatat', wa: true, email: false, vars: ['nama', 'status', 'tanggal', 'institusi'],
    subjek: 'Status Kehadiran {nama}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nKetidakhadiran Ananda pada {tanggal} tercatat sebagai *{status}*. Terima kasih atas konfirmasinya.\n— {institusi}' },
  NILAI_TERBIT: { label: 'Nilai mata pelajaran terbit', wa: true, email: true, vars: ['nama', 'mapel', 'nilai', 'predikat', 'semester', 'link', 'institusi'],
    subjek: 'Nilai {mapel} — {nama}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nNilai *{mapel}* semester {semester} telah terbit: *{nilai}* (predikat {predikat}).\nCek raport digital: {link}\n— {institusi}' },
  REMEDIAL: { label: 'Nilai di bawah KKM (remedial)', wa: true, email: true, vars: ['nama', 'mapel', 'nilai', 'kkm', 'link', 'institusi'],
    subjek: 'Pemberitahuan Remedial {mapel}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nNilai akhir *{mapel}* Ananda *{nilai}* masih di bawah KKM {kkm}. Ananda dijadwalkan mengikuti remedial; informasi lengkap dari guru mapel.\n— {institusi}' },
  MATERI_BARU: { label: 'Materi pembelajaran baru', wa: false, email: true, vars: ['nama', 'judul', 'mapel', 'guru', 'link', 'institusi'],
    subjek: 'Materi baru: {judul}',
    pesan: 'Halo {nama},\nMateri baru *{judul}* ({mapel}) dari {guru} sudah tersedia di SIAKAD.\nBuka: {link}\n— {institusi}' },
  PENGUMUMAN: { label: 'Pengumuman sekolah', wa: true, email: true, vars: ['nama', 'judul', 'isi', 'institusi'],
    subjek: '{judul}',
    pesan: '📢 *{judul}*\n\n{isi}\n\n— {institusi}' },
  RESET_SANDI: { label: 'Kode reset password (lupa password)', wa: true, email: true, vars: ['nama', 'kode', 'institusi'],
    subjek: 'Kode Reset Password SIAKAD',
    pesan: 'Kode reset password SIAKAD untuk {nama}: *{kode}*\nBerlaku 15 menit. Abaikan bila Anda tidak memintanya.\n— {institusi}' },
  RESET_SANDI_ADMIN: { label: 'Password direset oleh guru/admin', wa: true, email: true, vars: ['nama', 'username', 'sandi', 'link', 'institusi'],
    subjek: 'Password SIAKAD direset',
    pesan: 'Yth. {nama},\nPassword SIAKAD telah direset.\nUsername: *{username}*\nSandi baru: *{sandi}*\nLogin: {link}\n— {institusi}' }
};

// ---------------------------------------------------------------------
// Konfigurasi & matriks
// ---------------------------------------------------------------------
function waAktif_() { return setting_('NOTIF_WA_AKTIF', 'TIDAK') === 'YA' && !!PROPS.getProperty('FONNTE_TOKEN'); }
function emailAktif_() { return setting_('NOTIF_EMAIL_AKTIF', 'TIDAK') === 'YA'; }
function tokenMask_() { var t = PROPS.getProperty('FONNTE_TOKEN') || ''; return t ? t.substring(0, 4) + '••••' + t.substring(t.length - 3) : ''; }

function matriksNotif_() {
  var simpan = {};
  try { simpan = JSON.parse(setting_('NOTIF_MATRIKS', '') || '{}') || {}; } catch (e) {}
  var out = {};
  Object.keys(NOTIF_EVENTS).forEach(function (k) {
    var d = NOTIF_EVENTS[k], s = simpan[k] || {};
    out[k] = { kode: k, label: d.label, vars: d.vars,
      wa: s.wa !== undefined ? !!s.wa : d.wa, email: s.email !== undefined ? !!s.email : d.email,
      subjek: s.subjek || d.subjek, pesan: s.pesan || d.pesan, subjekDefault: d.subjek, pesanDefault: d.pesan };
  });
  return out;
}
function triggerAktif_() { return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'pekerjaMenit'; }); }

function svcNotifConfig(ctx, d) {
  var m = matriksNotif_();
  var quota = 0; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  return ok_({
    waAktif: setting_('NOTIF_WA_AKTIF', 'TIDAK') === 'YA', emailAktif: emailAktif_(), tokenAda: !!PROPS.getProperty('FONNTE_TOKEN'), tokenMask: tokenMask_(),
    batchDefault: Number(setting_('WA_BATCH_DEFAULT', 20)), jeda: setting_('WA_JEDA_DETIK', '5'), deteksiOtomatis: setting_('WA_DETEKSI_OTOMATIS', 'YA') === 'YA',
    namaPengirim: setting_('EMAIL_NAMA_PENGIRIM', APP.NAME), appUrl: setting_('APP_URL', ''), sisaKuotaEmail: quota, trigger: triggerAktif_(),
    matriks: Object.keys(m).map(function (k) { return m[k]; })
  });
}

function svcNotifConfigSave(ctx, d) {
  var pairs = {};
  if (d.token === '__HAPUS__') PROPS.deleteProperty('FONNTE_TOKEN');
  else if (d.token) PROPS.setProperty('FONNTE_TOKEN', String(d.token).trim());
  if (d.waAktif === true && !PROPS.getProperty('FONNTE_TOKEN')) return fail_('Isi token Fonnte terlebih dahulu sebelum mengaktifkan WhatsApp.');
  if (d.waAktif !== undefined) pairs.NOTIF_WA_AKTIF = d.waAktif ? 'YA' : 'TIDAK';
  if (d.emailAktif !== undefined) pairs.NOTIF_EMAIL_AKTIF = d.emailAktif ? 'YA' : 'TIDAK';
  if (d.batchDefault !== undefined) { if ([10, 20, 50].indexOf(Number(d.batchDefault)) === -1) return fail_('Ukuran batch harus 10, 20, atau 50.'); pairs.WA_BATCH_DEFAULT = String(d.batchDefault); }
  if (d.jeda !== undefined) { if (!/^\d{1,3}(-\d{1,3})?$/.test(String(d.jeda))) return fail_('Jeda harus angka (5) atau rentang (3-8).'); pairs.WA_JEDA_DETIK = String(d.jeda); }
  if (d.deteksiOtomatis !== undefined) pairs.WA_DETEKSI_OTOMATIS = d.deteksiOtomatis ? 'YA' : 'TIDAK';
  if (d.namaPengirim !== undefined) pairs.EMAIL_NAMA_PENGIRIM = String(d.namaPengirim).substring(0, 60);
  if (d.appUrl !== undefined) pairs.APP_URL = String(d.appUrl).trim();
  if (d.matriks) {
    var simpan = {};
    (Array.isArray(d.matriks) ? d.matriks : Object.keys(d.matriks).map(function (k) { return Object.assign({ kode: k }, d.matriks[k]); })).forEach(function (m) {
      var def = NOTIF_EVENTS[m.kode]; if (!def) return;
      var s = {};
      if (!!m.wa !== def.wa) s.wa = !!m.wa;
      if (!!m.email !== def.email) s.email = !!m.email;
      if (m.pesan && m.pesan !== def.pesan) s.pesan = String(m.pesan).substring(0, 2000);
      if (m.subjek && m.subjek !== def.subjek) s.subjek = String(m.subjek).substring(0, 200);
      if (Object.keys(s).length) simpan[m.kode] = s;
    });
    pairs.NOTIF_MATRIKS = JSON.stringify(simpan);
  }
  saveSettings_(pairs);
  try { pasangTrigger(); } catch (e) {}
  return svcNotifConfig(ctx, {});
}

// ---------------------------------------------------------------------
// Antrean — satu-satunya pintu kirim notifikasi otomatis (tidak pernah melempar error)
// ---------------------------------------------------------------------
function kirimNotif_(event, penerima, vars, refId) {
  return kirimNotifBatch_(event, [{ penerima: penerima, vars: vars, refId: refId }]);
}

function kirimNotifBatch_(event, daftar) {
  try {
    if (!daftar || !daftar.length) return 0;
    var waOn = waAktif_(), emOn = emailAktif_();
    if (!waOn && !emOn) return 0;
    var m = matriksNotif_()[event];
    if (!m || (!m.wa && !m.email)) return 0;
    var dasar = { institusi: setting_('NAMA_SEKOLAH', APP.NAME), link: setting_('APP_URL', '') };
    var rows = [];
    daftar.forEach(function (d) {
      var p = d.penerima || {}, v = Object.assign({}, dasar, { nama: p.nama || 'Bapak/Ibu' }, d.vars || {});
      if (waOn && m.wa && hpValid_(p.hp)) rows.push(barisAntrian_('WA', hp62_(p.hp), p.nama, '', isiTemplate_(m.pesan, v), event, d.refId, ''));
      if (emOn && m.email && emailValid_(p.email)) rows.push(barisAntrian_('EMAIL', String(p.email).trim(), p.nama, isiTemplate_(m.subjek, v), isiTemplate_(m.pesan, v), event, d.refId, ''));
    });
    if (!rows.length) return 0;
    var ids = reserveIds_('AntrianNotif', rows.length);
    rows.forEach(function (r, i) { r.AntrianID = ids[i]; });
    DB.appendBatch('AntrianNotif', rows);
    if (!PROPS.getProperty('ANTRIAN_MULAI')) PROPS.setProperty('ANTRIAN_MULAI', '2');
    PROPS.setProperty('ANTRIAN_ADA', '1');
    return rows.length;
  } catch (e) { console.error('kirimNotif_ (tidak fatal): ' + e.message); return 0; }
}

function barisAntrian_(kanal, tujuan, nama, subjek, pesan, event, refId, blastId) {
  return { AntrianID: '', Kanal: kanal, Tujuan: tujuan, NamaPenerima: nama || '', Subjek: subjek || '', Pesan: pesan, Event: event || '', RefID: refId || '', BlastID: blastId || '',
    Status: 'Antri', Percobaan: 0, Respon: '', DibuatPada: nowIso_(), DikirimPada: '' };
}

// ---------------------------------------------------------------------
// Fonnte
// ---------------------------------------------------------------------
function fonnte_(path, payload) {
  var token = PROPS.getProperty('FONNTE_TOKEN');
  if (!token) return { status: false, reason: 'Token Fonnte belum diisi.' };
  try {
    var r = UrlFetchApp.fetch(FONNTE_API + path, { method: 'post', headers: { Authorization: token }, payload: payload || {}, muteHttpExceptions: true });
    try { return JSON.parse(r.getContentText()); } catch (e) { return { status: false, reason: r.getContentText().substring(0, 120) }; }
  } catch (e) { return { status: false, reason: 'Koneksi Fonnte gagal: ' + e.message }; }
}

/** 1 request per batch (param `data`); fallback 1 request/pesan paralel (fetchAll) */
function fonnteKirimBanyak_(pesan, jeda) {
  if (!pesan.length) return [];
  var data = pesan.map(function (m) { return { target: m.target, message: m.message, delay: String(jeda || '2'), countryCode: '62' }; });
  var res = fonnte_('/send', { data: JSON.stringify(data) });
  if (res && res.status) return pesan.map(function (m, i) { return { ok: true, respon: 'OK ' + ([].concat(res.id || [])[i] || '') }; });
  var token = PROPS.getProperty('FONNTE_TOKEN');
  if (!token) return pesan.map(function () { return { ok: false, respon: 'Token kosong' }; });
  var resps = UrlFetchApp.fetchAll(pesan.map(function (m) {
    return { url: FONNTE_API + '/send', method: 'post', headers: { Authorization: token }, payload: { target: m.target, message: m.message, countryCode: '62' }, muteHttpExceptions: true };
  }));
  return resps.map(function (r) {
    try { var j = JSON.parse(r.getContentText()); return { ok: !!j.status, respon: j.status ? 'OK' : (j.reason || 'Ditolak') }; }
    catch (e) { return { ok: false, respon: 'HTTP ' + r.getResponseCode() }; }
  });
}

function emailHtml_(subjek, pesan) {
  var esc = String(pesan).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  var body = esc.replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
  return '<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">' +
    '<div style="background:#1E3A5F;color:#fff;padding:16px 20px;font-weight:700">' + setting_('NAMA_SEKOLAH', APP.NAME) + '<div style="font-size:12px;font-weight:400;color:#F5A623">SIAKAD SISWA</div></div>' +
    '<div style="padding:20px;color:#1A1A2E;font-size:14px;line-height:1.6">' + body + '</div>' +
    '<div style="padding:12px 20px;background:#F5F7FA;color:#64748B;font-size:11px">Pesan otomatis dari SIAKAD SISWA. Mohon tidak membalas email ini.</div></div>';
}

// ---------------------------------------------------------------------
// Prosesor antrean (dipanggil pekerjaMenit & tombol manual)
// ---------------------------------------------------------------------
function jedaRata_(j) { var p = String(j || '5').split('-').map(Number); return p.length > 1 ? (p[0] + p[1]) / 2 : p[0]; }

function prosesAntrianNotif(opsi) {
  opsi = opsi || {};
  if (!opsi.paksa && PROPS.getProperty('ANTRIAN_ADA') !== '1') { deteksiWAOtomatis_(); crmSyncTerjadwal_(); return { info: 'Antrean kosong' }; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { info: 'Prosesor sedang berjalan' };
  var hasil = { wa: 0, email: 0, gagal: 0 };
  try {
    var sh = getSheet_('AntrianNotif'), last = sh.getLastRow();
    var start = Math.max(2, Number(PROPS.getProperty('ANTRIAN_MULAI') || 2));
    if (start > last) { PROPS.setProperty('ANTRIAN_ADA', '0'); return hasil; }
    var h = DB.headers_(sh), C = {}; h.forEach(function (k, i) { C[k] = i; });
    var v = sh.getRange(start, 1, last - start + 1, h.length).getValues();
    var waOn = waAktif_(), emOn = emailAktif_();
    var blasts = {}; DB.all('BlastWA').forEach(function (b) { if (b.Status === 'Berjalan') blasts[b.BlastID] = b; });
    var ambilWA = [], ambilEmail = [], perBlast = {};
    var kuotaEmail = 0; try { kuotaEmail = Math.min(40, MailApp.getRemainingDailyQuota()); } catch (e) {}
    for (var i = 0; i < v.length; i++) {
      var r = v[i]; if (r[C.Status] !== 'Antri') continue;
      var bid = String(r[C.BlastID] || '');
      if (bid) {
        if (!waOn || !blasts[bid] || (opsi.blastId && opsi.blastId !== bid)) continue;
        var arr = perBlast[bid] = perBlast[bid] || [];
        if (arr.length < Number(blasts[bid].UkuranBatch || 20)) arr.push(i);
      } else if (!opsi.hanyaBlast) {
        if (r[C.Kanal] === 'WA' && waOn && ambilWA.length < 30) ambilWA.push(i);
        else if (r[C.Kanal] === 'EMAIL' && emOn && ambilEmail.length < kuotaEmail) ambilEmail.push(i);
      }
    }
    var touched = [], dihubungi = [];
    function tandai(idx, okx, respon) {
      var r = v[idx];
      if (okx) { r[C.Status] = 'Terkirim'; r[C.DikirimPada] = nowIso_(); dihubungi.push(r[C.Tujuan]); }
      else { r[C.Percobaan] = Number(r[C.Percobaan] || 0) + 1; if (r[C.Percobaan] >= 3) { r[C.Status] = 'Gagal'; hasil.gagal++; } }
      r[C.Respon] = String(respon || '').substring(0, 200);
      touched.push(idx);
    }
    if (ambilWA.length) {
      var res = fonnteKirimBanyak_(ambilWA.map(function (i) { return { target: v[i][C.Tujuan], message: v[i][C.Pesan] }; }), setting_('WA_JEDA_DETIK', '5'));
      ambilWA.forEach(function (i, j) { tandai(i, res[j].ok, res[j].respon); if (res[j].ok) hasil.wa++; });
    }
    var statBlast = {};
    Object.keys(perBlast).forEach(function (bid) {
      var idxs = perBlast[bid]; if (!idxs.length) return;
      var res = fonnteKirimBanyak_(idxs.map(function (i) { return { target: v[i][C.Tujuan], message: v[i][C.Pesan] }; }), blasts[bid].JedaDetik || setting_('WA_JEDA_DETIK', '5'));
      var st = statBlast[bid] = { ok: 0, gagal: 0 };
      idxs.forEach(function (i, j) { var before = v[i][C.Status]; tandai(i, res[j].ok, res[j].respon); if (res[j].ok) { st.ok++; hasil.wa++; } else if (v[i][C.Status] === 'Gagal' && before !== 'Gagal') st.gagal++; });
    });
    var nama = setting_('EMAIL_NAMA_PENGIRIM', APP.NAME);
    ambilEmail.forEach(function (i) {
      try { MailApp.sendEmail({ to: v[i][C.Tujuan], subject: v[i][C.Subjek] || nama, body: String(v[i][C.Pesan]).replace(/\*/g, ''), htmlBody: emailHtml_(v[i][C.Subjek], v[i][C.Pesan]), name: nama }); tandai(i, true, 'OK'); hasil.email++; }
      catch (e) { tandai(i, false, e.message); }
    });
    if (touched.length) {
      var mn = Math.min.apply(null, touched), mx = Math.max.apply(null, touched);
      sh.getRange(start + mn, 1, mx - mn + 1, h.length).setValues(v.slice(mn, mx + 1));
      invalidateRows_('AntrianNotif');
    }
    // statistik blast
    var sisaBlast = {};
    v.forEach(function (r) { var b = String(r[C.BlastID] || ''); if (b && r[C.Status] === 'Antri') sisaBlast[b] = (sisaBlast[b] || 0) + 1; });
    var upB = [];
    Object.keys(blasts).forEach(function (bid) {
      var b = blasts[bid], st = statBlast[bid] || { ok: 0, gagal: 0 };
      if (!st.ok && !st.gagal && sisaBlast[bid]) return;
      var p = { BlastID: bid, Terkirim: Number(b.Terkirim || 0) + st.ok, Gagal: Number(b.Gagal || 0) + st.gagal };
      if (!sisaBlast[bid]) { p.Status = 'Selesai'; p.SelesaiPada = nowIso_(); }
      upB.push(p);
    });
    DB.updateBatch('BlastWA', 'BlastID', upB);
    // majukan penunjuk
    var firstAntri = -1;
    for (var k = 0; k < v.length; k++) if (v[k][C.Status] === 'Antri') { firstAntri = k; break; }
    if (firstAntri === -1) { PROPS.setProperty('ANTRIAN_MULAI', String(last + 1)); PROPS.setProperty('ANTRIAN_ADA', '0'); }
    else PROPS.setProperty('ANTRIAN_MULAI', String(start + firstAntri));
    if (dihubungi.length) crmCatatKirim_(dihubungi);
  } finally { lock.releaseLock(); }
  return hasil;
}

// ---------------------------------------------------------------------
// Pemantauan antrean
// ---------------------------------------------------------------------
function tailRows_(name, n) {
  var sh = getSheet_(name), last = sh.getLastRow(); if (last < 2) return [];
  var cnt = Math.min(n, last - 1), h = DB.headers_(sh), v = sh.getRange(last - cnt + 1, 1, cnt, h.length).getValues();
  return v.map(function (r, i) { var o = { _row: last - cnt + 1 + i }; h.forEach(function (k, j) { o[k] = normCell_(k, r[j]); }); return o; });
}

function svcNotifQueue(ctx, d) {
  var rows = tailRows_('AntrianNotif', 3000);
  var ring = { Antri: 0, Terkirim: 0, Gagal: 0, Batal: 0 };
  rows.forEach(function (r) { if (ring[r.Status] !== undefined) ring[r.Status]++; });
  var f = rows.filter(function (r) { return (!d.status || r.Status === d.status) && (!d.kanal || r.Kanal === d.kanal) && (!d.blastId || r.BlastID === d.blastId); });
  return ok_({ rows: f.slice(-300).reverse().map(function (r) { var o = Object.assign({}, r); o.Pesan = String(o.Pesan).substring(0, 240); delete o._row; return o; }), ringkas: ring, waAktif: waAktif_(), emailAktif: emailAktif_() });
}
function svcNotifProcessNow(ctx, d) { var h = prosesAntrianNotif({ paksa: true }); return ok_(h, h.info || ('Diproses: ' + (h.wa || 0) + ' WA, ' + (h.email || 0) + ' email.')); }
function svcNotifRetry(ctx, d) {
  var rows = tailRows_('AntrianNotif', 3000).filter(function (r) { return r.Status === 'Gagal' && (!d.ids || d.ids.indexOf(r.AntrianID) > -1); });
  if (!rows.length) return ok_({ n: 0 }, 'Tidak ada pesan gagal.');
  DB.updateBatch('AntrianNotif', 'AntrianID', rows.map(function (r) { return { AntrianID: r.AntrianID, Status: 'Antri', Percobaan: 0, Respon: 'Diulang' }; }));
  var minRow = Math.min.apply(null, rows.map(function (r) { return r._row; }));
  PROPS.setProperty('ANTRIAN_MULAI', String(Math.min(minRow, Number(PROPS.getProperty('ANTRIAN_MULAI') || minRow))));
  PROPS.setProperty('ANTRIAN_ADA', '1');
  return ok_({ n: rows.length }, rows.length + ' pesan dijadwalkan ulang.');
}

function svcWaDevice(ctx, d) {
  var r = fonnte_('/device', {});
  if (!r || r.status === false) return fail_(r && r.reason ? r.reason : 'Perangkat tidak terbaca.');
  return ok_({ device: r.device, status: r.device_status, paket: r.package, kuota: r.quota, expired: r.expired, nama: r.name });
}
function svcWaTest(ctx, d) {
  if (!hpValid_(d.nomor)) return fail_('Nomor tidak valid (contoh 0812xxxxxxx).');
  var r = fonnte_('/send', { target: hp62_(d.nomor), message: d.pesan || ('✅ Tes notifikasi WhatsApp dari ' + setting_('NAMA_SEKOLAH', APP.NAME) + ' — SIAKAD SISWA berhasil tersambung.'), countryCode: '62' });
  return r && r.status ? ok_(r, 'Pesan tes terkirim ke ' + hp08_(d.nomor) + '.') : fail_('Gagal: ' + (r && r.reason ? r.reason : 'tidak diketahui'));
}
function svcEmailTest(ctx, d) {
  if (!emailValid_(d.email)) return fail_('Email tidak valid.');
  try {
    MailApp.sendEmail({ to: d.email, subject: 'Tes Email SIAKAD SISWA', body: 'Tes email berhasil.', htmlBody: emailHtml_('Tes', '✅ Tes email dari *SIAKAD SISWA* berhasil.\nKonfigurasi email siap digunakan.'), name: setting_('EMAIL_NAMA_PENGIRIM', APP.NAME) });
    return ok_(null, 'Email tes terkirim ke ' + d.email + '.');
  } catch (e) { return fail_('Gagal kirim email: ' + e.message); }
}

// ---------------------------------------------------------------------
// Deteksi nomor WhatsApp (Fonnte /validate, maks 50/panggilan)
// ---------------------------------------------------------------------
function svcWaValidate(ctx, d) {
  var nomor = [], seen = {};
  (d.nomor || []).forEach(function (n) { var h = hp08_(n); if (hpValid_(h) && !seen[h]) { seen[h] = 1; nomor.push(h); } });
  nomor = nomor.slice(0, 50);
  if (!nomor.length) return ok_({ hasil: {} }, 'Tidak ada nomor valid untuk dicek.');
  var r = fonnte_('/validate', { target: nomor.map(hp62_).join(','), countryCode: '62' });
  if (!r || r.status === false) return fail_('Deteksi WA gagal: ' + (r && r.reason ? r.reason : 'fitur validate mungkin tidak tersedia di paket Fonnte Anda.'));
  var hasil = {};
  [].concat(r.registered || []).forEach(function (n) { hasil[hp08_(n)] = 'Terdaftar'; });
  [].concat(r.not_registered || []).forEach(function (n) { hasil[hp08_(n)] = 'Tidak Terdaftar'; });
  withLock_(function () { simpanStatusWA_(hasil); return ok_(); });
  return ok_({ hasil: hasil }, Object.keys(hasil).length + ' nomor dicek.');
}
function simpanStatusWA_(hasil) {
  var now = nowIso_();
  Object.keys(SUMBER_KONTAK).forEach(function (kode) {
    var s = SUMBER_KONTAK[kode]; if (!s.statusWA) return;
    var up = DB.all(s.tabel).filter(function (r) { return hasil[hp08_(r[s.hp])]; }).map(function (r) { var o = {}; o[s.id] = r[s.id]; o.StatusWA = hasil[hp08_(r[s.hp])]; o.CekWAAt = now; return o; });
    DB.updateBatch(s.tabel, s.id, up);
  });
  DB.updateBatch('CRM_Kontak', 'KontakID', DB.all('CRM_Kontak').filter(function (k) { return hasil[hp08_(k.NoWA)]; }).map(function (k) { return { KontakID: k.KontakID, StatusWA: hasil[hp08_(k.NoWA)], CekWAAt: now }; }));
  bump_('master');
}
function deteksiWAOtomatis_() {
  if (setting_('WA_DETEKSI_OTOMATIS', 'YA') !== 'YA' || !PROPS.getProperty('FONNTE_TOKEN')) return;
  var last = Number(PROPS.getProperty('DETEKSI_WA_TERAKHIR') || 0);
  if (Date.now() - last < 10 * 60e3) return;
  PROPS.setProperty('DETEKSI_WA_TERAKHIR', String(Date.now()));
  var nomor = DB.all('CRM_Kontak').filter(function (k) { return !k.StatusWA && hpValid_(k.NoWA) && k.Tag.indexOf('merged') === -1; }).slice(0, 50).map(function (k) { return k.NoWA; });
  if (nomor.length) { try { svcWaValidate({}, { nomor: nomor }); } catch (e) {} }
}

// ---------------------------------------------------------------------
// Blast WhatsApp per batch
// ---------------------------------------------------------------------
function svcWaAudience(ctx, d) {
  var rows = [], kelasNama = {};
  DB.all('Kelas').forEach(function (k) { kelasNama[k.kelas_id] = k.nama_kelas; });
  if (d.sumber === 'manual') {
    String(d.manual || '').split(/\n/).forEach(function (line) {
      var p = line.split('|'); if (!line.trim()) return;
      rows.push({ id: '', nama: (p[1] || '').trim() || 'Bapak/Ibu', hp: hp08_(p[0]), statusWA: '', vars: {}, optOut: false });
    });
  } else {
    DB.all('CRM_Kontak').forEach(function (k) {
      if (String(k.Tag).indexOf('merged') > -1) return;
      if (d.segmen && k.Segmen !== d.segmen) return;
      if (d.tag && String(k.Tag).split(',').map(function (t) { return t.trim(); }).indexOf(d.tag) === -1) return;
      var info = {}; try { info = JSON.parse(k.Info || '{}'); } catch (e) {}
      if (d.kelas_id && info.kelas_id !== d.kelas_id) return;
      if (d.statusWA && (k.StatusWA || 'Belum') !== d.statusWA) return;
      rows.push({ id: k.KontakID, nama: k.Nama, hp: hp08_(k.NoWA), statusWA: k.StatusWA, optOut: k.OptOut === 'YA', segmen: k.Segmen,
        vars: { kelas: kelasNama[info.kelas_id] || '', nis: info.NIS || '', siswa: info.nama_lengkap || '' } });
    });
  }
  var seen = {}, ring = { total: rows.length, valid: 0, tidakValid: 0, ganda: 0, terdaftarWA: 0, tidakTerdaftarWA: 0, optOut: 0 };
  rows.forEach(function (r) {
    r.valid = hpValid_(r.hp);
    r.ganda = r.valid && !!seen[r.hp]; if (r.valid) seen[r.hp] = 1;
    if (!r.valid) ring.tidakValid++; else if (r.ganda) ring.ganda++; else ring.valid++;
    if (r.statusWA === 'Terdaftar') ring.terdaftarWA++; if (r.statusWA === 'Tidak Terdaftar') ring.tidakTerdaftarWA++;
    if (r.optOut) ring.optOut++;
  });
  return ok_({ rows: rows.slice(0, 5000), ringkas: ring });
}

function svcWaBlastCreate(ctx, d) {
  if (!waAktif_()) return fail_('Notifikasi WhatsApp belum aktif. Isi token & nyalakan di tab Konfigurasi.');
  var ukuran = Number(d.ukuranBatch), jeda = String(d.jeda || setting_('WA_JEDA_DETIK', '5'));
  if ([10, 20, 50].indexOf(ukuran) === -1) return fail_('Ukuran batch harus 10, 20, atau 50.');
  if (!/^\d{1,3}(-\d{1,3})?$/.test(jeda)) return fail_('Jeda tidak valid.');
  if (!String(d.pesan || '').trim()) return fail_('Isi pesan masih kosong.');
  var optout = {}; DB.all('CRM_Kontak').forEach(function (k) { if (k.OptOut === 'YA') optout[hp08_(k.NoWA)] = 1; });
  var seen = {}, list = [];
  (d.penerima || []).forEach(function (p) { var h = hp08_(p.hp); if (hpValid_(h) && !seen[h] && !optout[h]) { seen[h] = 1; list.push(p); } });
  if (!list.length) return fail_('Tidak ada penerima valid (setelah membuang nomor ganda, tidak valid, dan opt-out).');
  if (list.length > 5000) return fail_('Maksimal 5.000 penerima per blast.');
  var bid = reserveIds_('BlastWA', 1)[0];
  var dasar = { institusi: setting_('NAMA_SEKOLAH', APP.NAME), link: setting_('APP_URL', '') };
  var rows = list.map(function (p) { return barisAntrian_('WA', hp62_(p.hp), p.nama, '', isiTemplate_(d.pesan, Object.assign({}, dasar, { nama: p.nama || 'Bapak/Ibu' }, p.vars || {})), 'BLAST', p.id || '', bid); });
  var ids = reserveIds_('AntrianNotif', rows.length); rows.forEach(function (r, i) { r.AntrianID = ids[i]; });
  DB.appendBatch('AntrianNotif', rows);
  DB.appendBatch('BlastWA', [{ BlastID: bid, Judul: d.judul || 'Blast ' + today_(), Pesan: d.pesan, Sasaran: d.sasaran || '', Total: rows.length, Terkirim: 0, Gagal: 0, UkuranBatch: ukuran, JedaDetik: jeda, Status: 'Berjalan', DibuatOleh: ctx.session.email, Tanggal: nowIso_(), SelesaiPada: '' }]);
  if (!PROPS.getProperty('ANTRIAN_MULAI')) PROPS.setProperty('ANTRIAN_MULAI', '2');
  PROPS.setProperty('ANTRIAN_ADA', '1');
  return ok_({ blastId: bid, total: rows.length, batch: Math.ceil(rows.length / ukuran) }, 'Blast dibuat: ' + rows.length + ' penerima, ' + Math.ceil(rows.length / ukuran) + ' batch.');
}
function blastInfo_(b) {
  var sisa = Math.max(0, Number(b.Total || 0) - Number(b.Terkirim || 0) - Number(b.Gagal || 0));
  return Object.assign({}, b, { sisa: b.Status === 'Dihentikan' ? 0 : sisa, persen: b.Total ? Math.round((Number(b.Terkirim || 0) + Number(b.Gagal || 0)) / Number(b.Total) * 100) : 0 });
}
function svcWaBlastList(ctx, d) { return ok_(DB.all('BlastWA').slice(-100).reverse().map(blastInfo_)); }
function svcWaBlastProcess(ctx, d) {
  var h = prosesAntrianNotif({ paksa: true, blastId: d.blastId, hanyaBlast: true });
  invalidateRows_('BlastWA');
  var b = DB.find('BlastWA', 'BlastID', d.blastId);
  return ok_({ blast: b ? blastInfo_(b) : null, hasil: h }, h.info || ('Batch terkirim: ' + (h.wa || 0) + ' pesan.'));
}
function svcWaBlastStop(ctx, d) {
  var b = DB.find('BlastWA', 'BlastID', d.blastId); if (!b) return fail_('Blast tidak ditemukan.');
  var rows = tailRows_('AntrianNotif', 6000).filter(function (r) { return r.BlastID === d.blastId && r.Status === 'Antri'; });
  DB.updateBatch('AntrianNotif', 'AntrianID', rows.map(function (r) { return { AntrianID: r.AntrianID, Status: 'Batal', Respon: 'Dihentikan admin' }; }));
  DB.updateBatch('BlastWA', 'BlastID', [{ BlastID: b.BlastID, Status: 'Dihentikan', SelesaiPada: nowIso_() }]);
  return ok_({ dibatalkan: rows.length }, 'Blast dihentikan, ' + rows.length + ' pesan dibatalkan.');
}

;
// ==== CRM.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA — File 5/5 : CRM.gs  (gas-notifikasi-wa-crm, Bagian 7)
 *  CRM Kontak: Nama · Email · WhatsApp dari Siswa, Orang Tua, dan Guru.
 *  CRM_Kontak = materialisasi (sinkron), bukan pengganti tabel asli.
 * =====================================================================
 */

/** Sumber kontak. statusWA = kolom StatusWA di tabel sumber yang merepresentasikan nomor ini. */
var SUMBER_KONTAK = {
  siswa: { tabel: 'Siswa', id: 'NIS', nama: 'nama_lengkap', email: 'email', hp: 'no_wa', segmen: 'Siswa', status: 'status', gender: 'jenis_kelamin', info: ['NIS', 'kelas_id'] },
  ortu:  { tabel: 'Siswa', id: 'NIS', nama: 'nama_ortu', email: '', hp: 'no_wa_ortu', segmen: 'Orang Tua', status: 'status', gender: 'jenis_kelamin', info: ['NIS', 'kelas_id', 'nama_lengkap'], statusWA: true },
  guru:  { tabel: 'Guru', id: 'NUPTK', nama: 'nama_lengkap', email: 'email', hp: 'no_wa', segmen: 'Guru', status: 'status', info: ['mata_pelajaran', 'jabatan'], statusWA: true }
};

function kontakData_(kode, r, now) {
  var s = SUMBER_KONTAK[kode];
  var nama = r[s.nama] || (kode === 'ortu' ? 'Orang Tua ' + (r.nama_lengkap || '') : ''), hp = hp08_(r[s.hp]);
  var email = s.email ? lower_(r[s.email]) : '';
  if (!hp && !email) return null;
  var info = {}; (s.info || []).forEach(function (f) { info[f] = r[f]; });
  if (s.status) info.Status = r[s.status] || 'Aktif';
  if (s.gender) info.JK = r[s.gender];
  return { Nama: nama, Email: email, NoWA: hp, Segmen: s.segmen, Sumber: kode, RefID: String(r[s.id]), EmailValid: email ? (emailValid_(email) ? 'YA' : 'TIDAK') : '',
    StatusWA: s.statusWA ? (r.StatusWA || '') : '', CekWAAt: s.statusWA ? (r.CekWAAt || '') : '', Info: JSON.stringify(info), DiperbaruiPada: now };
}

/** Sinkron semua sumber → CRM_Kontak. Idempoten, batch. */
function svcCrmSync(ctx, d) {
  var lama = DB.all('CRM_Kontak'), idx = {};
  lama.forEach(function (k, i) { idx[k.Sumber + ':' + k.RefID] = i; });
  var baru = [], ubah = [], now = nowIso_();
  Object.keys(SUMBER_KONTAK).forEach(function (kode) {
    var s = SUMBER_KONTAK[kode];
    DB.all(s.tabel).forEach(function (r) {
      var data = kontakData_(kode, r, now); if (!data) return;
      var k = kode + ':' + data.RefID;
      if (idx[k] === undefined) {
        baru.push(Object.assign({ KontakID: '', Tag: '', OptOut: 'TIDAK', Catatan: '', JumlahPesan: 0, TerakhirDihubungi: '', DibuatPada: now }, data));
        idx[k] = -1;
      } else if (idx[k] > -1) {
        var lk = lama[idx[k]];
        var berubah = ['Nama', 'Email', 'NoWA', 'Info'].some(function (f) { return String(lk[f]) !== String(data[f]); }) || (data.StatusWA && data.StatusWA !== lk.StatusWA);
        if (berubah) {
          if (hp08_(lk.NoWA) !== data.NoWA) { data.StatusWA = ''; data.CekWAAt = ''; }
          else if (!data.StatusWA) { delete data.StatusWA; delete data.CekWAAt; }
          ubah.push(Object.assign({ KontakID: lk.KontakID }, data));
        }
      }
    });
  });
  if (baru.length) { var ids = reserveIds_('CRM_Kontak', baru.length); baru.forEach(function (b, i) { b.KontakID = ids[i]; }); DB.appendBatch('CRM_Kontak', baru); }
  if (ubah.length) DB.updateBatch('CRM_Kontak', 'KontakID', ubah);
  PROPS.setProperty('CRM_SYNC_TERAKHIR', String(Date.now()));
  return ok_({ ditambah: baru.length, diperbarui: ubah.length, total: lama.length + baru.length, terakhir: nowIso_() }, 'Sinkron CRM: +' + baru.length + ' baru, ' + ubah.length + ' diperbarui.');
}
function crmSyncTerjadwal_() {
  var menit = num_(setting_('CRM_SYNC_MENIT', 30), 30), last = Number(PROPS.getProperty('CRM_SYNC_TERAKHIR') || 0);
  if (!menit || Date.now() - last < menit * 60e3) return;
  var lock = LockService.getScriptLock(); if (!lock.tryLock(3000)) return;
  try { svcCrmSync({}, {}); } finally { lock.releaseLock(); }
}
/** Dipanggil setelah transaksi penting (siswa baru) agar kontak langsung muncul */
function crmUpsertSatu_(kode, r) {
  var data = kontakData_(kode, r, nowIso_()); if (!data) return;
  var ex = DB.all('CRM_Kontak').filter(function (k) { return k.Sumber === kode && String(k.RefID) === data.RefID; })[0];
  if (ex) { if (hp08_(ex.NoWA) !== data.NoWA) { data.StatusWA = ''; data.CekWAAt = ''; } else { delete data.StatusWA; delete data.CekWAAt; } DB.updateBatch('CRM_Kontak', 'KontakID', [Object.assign({ KontakID: ex.KontakID }, data)]); }
  else DB.appendBatch('CRM_Kontak', [Object.assign({ KontakID: reserveIds_('CRM_Kontak', 1)[0], Tag: '', OptOut: 'TIDAK', Catatan: '', JumlahPesan: 0, TerakhirDihubungi: '', DibuatPada: nowIso_() }, data)]);
}

function crmRows_() {
  var rows = DB.all('CRM_Kontak').filter(function (k) { return String(k.Tag).indexOf('merged') === -1; });
  var cntWA = {}, cntEm = {};
  rows.forEach(function (k) { if (k.NoWA) cntWA[k.NoWA] = (cntWA[k.NoWA] || 0) + 1; if (k.Email) cntEm[k.Email] = (cntEm[k.Email] || 0) + 1; });
  return rows.map(function (k) {
    var o = Object.assign({}, k); try { o.info = JSON.parse(k.Info || '{}'); } catch (e) { o.info = {}; }
    o.duplikat = (k.NoWA && cntWA[k.NoWA] > 1) || (k.Email && cntEm[k.Email] > 1);
    o.waValid = hpValid_(k.NoWA);
    o.bisaDihubungi = o.waValid || k.EmailValid === 'YA';
    return o;
  });
}

function svcCrmList(ctx, d) {
  var q = lower_(d.cari), rows = crmRows_();
  var f = rows.filter(function (k) {
    if (d.segmen && k.Segmen !== d.segmen) return false;
    if (d.sumber && k.Sumber !== d.sumber) return false;
    if (d.kelas_id && k.info.kelas_id !== d.kelas_id) return false;
    if (d.tag && String(k.Tag).split(',').map(function (t) { return t.trim(); }).indexOf(d.tag) === -1) return false;
    if (d.statusWA) { var sw = k.StatusWA || 'Belum'; if (sw !== d.statusWA) return false; }
    if (d.emailValid && k.EmailValid !== d.emailValid) return false;
    if (d.optOut && k.OptOut !== d.optOut) return false;
    if (d.duplikat && !k.duplikat) return false;
    if (d.masalah && k.bisaDihubungi) return false;
    if (q && (lower_(k.Nama) + ' ' + k.Email + ' ' + k.NoWA + ' ' + lower_(k.info.nama_lengkap || '')).indexOf(q) === -1) return false;
    return true;
  }).sort(function (a, b) { return String(a.Nama).localeCompare(String(b.Nama)); });
  var per = Math.min(200, Number(d.per) || 50), hal = Math.max(1, Number(d.halaman) || 1);
  var facet = { segmen: {}, statusWA: {} };
  rows.forEach(function (k) { facet.segmen[k.Segmen] = (facet.segmen[k.Segmen] || 0) + 1; var sw = k.StatusWA || 'Belum'; facet.statusWA[sw] = (facet.statusWA[sw] || 0) + 1; });
  var tags = {}; rows.forEach(function (k) { String(k.Tag || '').split(',').forEach(function (t) { t = t.trim(); if (t) tags[t] = (tags[t] || 0) + 1; }); });
  return ok_({ rows: f.slice((hal - 1) * per, hal * per), total: f.length, halaman: hal, per: per, facet: facet, tags: tags, terakhirSync: Number(PROPS.getProperty('CRM_SYNC_TERAKHIR') || 0) });
}

function svcCrmStats(ctx, d) {
  var rows = crmRows_(), tujuh = Date.now() - 7 * 864e5, tigapuluh = Date.now() - 30 * 864e5;
  var s = { total: rows.length, waValid: 0, terdaftarWA: 0, emailValid: 0, belumCekWA: 0, optOut: 0, duplikat: 0, tidakBisa: 0, baru7: 0, dihubungi30: 0, perSegmen: {} };
  rows.forEach(function (k) {
    if (k.waValid) s.waValid++;
    if (k.StatusWA === 'Terdaftar') s.terdaftarWA++;
    if (k.EmailValid === 'YA') s.emailValid++;
    if (k.waValid && !k.StatusWA) s.belumCekWA++;
    if (k.OptOut === 'YA') s.optOut++;
    if (k.duplikat) s.duplikat++;
    if (!k.bisaDihubungi) s.tidakBisa++;
    if (new Date(k.DibuatPada).getTime() > tujuh) s.baru7++;
    if (k.TerakhirDihubungi && new Date(k.TerakhirDihubungi).getTime() > tigapuluh) s.dihubungi30++;
    s.perSegmen[k.Segmen] = (s.perSegmen[k.Segmen] || 0) + 1;
  });
  s.terakhirSync = Number(PROPS.getProperty('CRM_SYNC_TERAKHIR') || 0);
  return ok_(s);
}

function svcCrmDetail(ctx, d) {
  var k = DB.find('CRM_Kontak', 'KontakID', d.kontakId); if (!k) return fail_('Kontak tidak ditemukan.');
  var o = Object.assign({}, k); try { o.info = JSON.parse(k.Info || '{}'); } catch (e) { o.info = {}; }
  var s = SUMBER_KONTAK[k.Sumber], asli = s ? DB.find(s.tabel, s.id, k.RefID) : null;
  var tujuanWA = hp62_(k.NoWA), em = lower_(k.Email);
  var pesan = tailRows_('AntrianNotif', 3000).filter(function (r) { return (tujuanWA && r.Tujuan === tujuanWA) || (em && lower_(r.Tujuan) === em); }).slice(-50)
    .map(function (r) { return { tipe: 'pesan', kanal: r.Kanal, ringkasan: String(r.Pesan).substring(0, 160), status: r.Status, event: r.Event, tanggal: r.DikirimPada || r.DibuatPada }; });
  var inter = DB.all('CRM_Interaksi').filter(function (i) { return i.KontakID === k.KontakID; }).map(function (i) { return { tipe: 'interaksi', kanal: i.Kanal, ringkasan: i.Ringkasan, oleh: i.Oleh, tanggal: i.Tanggal }; });
  return ok_({ kontak: o, asli: asli ? (asli.password_hash ? null : asli) : null, timeline: pesan.concat(inter).sort(function (a, b) { return String(b.tanggal).localeCompare(String(a.tanggal)); }) });
}

function svcCrmSave(ctx, d) {
  var x = d.kontak || {}, k = DB.find('CRM_Kontak', 'KontakID', x.KontakID); if (!k) return fail_('Kontak tidak ditemukan.');
  if (x.NoWA && !hpValid_(x.NoWA)) return fail_('Nomor WA tidak valid.');
  if (x.Email && !emailValid_(x.Email)) return fail_('Email tidak valid.');
  var patch = { KontakID: k.KontakID, Tag: x.Tag !== undefined ? x.Tag : k.Tag, Catatan: x.Catatan !== undefined ? x.Catatan : k.Catatan, OptOut: x.OptOut !== undefined ? (x.OptOut === 'YA' || x.OptOut === true ? 'YA' : 'TIDAK') : k.OptOut, DiperbaruiPada: nowIso_() };
  var s = SUMBER_KONTAK[k.Sumber], tulisBalik = {};
  ['Nama', 'Email', 'NoWA'].forEach(function (f) {
    if (x[f] === undefined || String(x[f]) === String(k[f])) return;
    patch[f] = f === 'NoWA' ? hp08_(x[f]) : f === 'Email' ? lower_(x[f]) : x[f];
    if (s) { var col = f === 'Nama' ? s.nama : f === 'Email' ? s.email : s.hp; if (col) tulisBalik[col] = patch[f]; }
    if (f === 'NoWA') { patch.StatusWA = ''; patch.CekWAAt = ''; }
    if (f === 'Email') patch.EmailValid = patch.Email ? 'YA' : '';
  });
  DB.updateBatch('CRM_Kontak', 'KontakID', [patch]);
  if (s && Object.keys(tulisBalik).length) {                  // satu sumber kebenaran
    var p2 = Object.assign({}, tulisBalik); p2[s.id] = k.RefID;
    if (tulisBalik[s.hp] !== undefined && s.statusWA) { p2.StatusWA = ''; p2.CekWAAt = ''; }
    DB.updateBatch(s.tabel, s.id, [p2]);
    if (s.tabel === 'Siswa' && tulisBalik.email) {
      var u = DB.all('Users').filter(function (u) { return u.role === 'siswa' && String(u.ref_id) === String(k.RefID); })[0];
      if (u) DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, email: tulisBalik.email }]);
    }
    bump_('master');
  }
  return ok_(null, 'Kontak disimpan.');
}

function svcCrmBulk(ctx, d) {
  var ids = d.ids || [], set = {}; ids.forEach(function (i) { set[i] = 1; });
  var rows = DB.all('CRM_Kontak').filter(function (k) { return set[k.KontakID]; });
  if (!rows.length) return fail_('Belum ada kontak dipilih.');
  var nilai = String(d.nilai || '').trim(), up = [];
  if (d.aksi === 'tag' || d.aksi === 'untag') {
    if (!nilai) return fail_('Nama tag kosong.');
    rows.forEach(function (k) {
      var t = String(k.Tag || '').split(',').map(function (x) { return x.trim(); }).filter(String);
      if (d.aksi === 'tag' && t.indexOf(nilai) === -1) t.push(nilai);
      if (d.aksi === 'untag') t = t.filter(function (x) { return x !== nilai; });
      up.push({ KontakID: k.KontakID, Tag: t.join(', ') });
    });
  } else if (d.aksi === 'optout' || d.aksi === 'optin') {
    rows.forEach(function (k) { up.push({ KontakID: k.KontakID, OptOut: d.aksi === 'optout' ? 'YA' : 'TIDAK' }); });
  } else if (d.aksi === 'hapusManual') {
    var man = rows.filter(function (k) { return k.Sumber === 'manual'; }).map(function (k) { return k.KontakID; });
    DB.deleteWhere('CRM_Kontak', 'KontakID', man);
    return ok_({ n: man.length }, man.length + ' kontak manual dihapus (kontak dari data sekolah tidak ikut terhapus).');
  } else return fail_('Aksi tidak dikenal.');
  DB.updateBatch('CRM_Kontak', 'KontakID', up);
  return ok_({ n: up.length }, 'Diterapkan ke ' + up.length + ' kontak.');
}

function svcCrmInteraksi(ctx, d) {
  var k = DB.find('CRM_Kontak', 'KontakID', d.kontakId); if (!k) return fail_('Kontak tidak ditemukan.');
  if (!String(d.ringkasan || '').trim()) return fail_('Ringkasan interaksi kosong.');
  var row = { InteraksiID: reserveIds_('CRM_Interaksi', 1)[0], KontakID: k.KontakID, Kanal: d.kanal || 'Catatan', Arah: d.arah || 'Keluar', Ringkasan: String(d.ringkasan).substring(0, 1000), RefID: '', Oleh: ctx.session.email, Tanggal: nowIso_() };
  DB.appendBatch('CRM_Interaksi', [row]);
  DB.updateBatch('CRM_Kontak', 'KontakID', [{ KontakID: k.KontakID, TerakhirDihubungi: row.Tanggal }]);
  return ok_(row, 'Interaksi dicatat.');
}

function svcCrmImport(ctx, d) {
  var rows = d.rows || [], now = nowIso_(), have = {}, baru = [], lewati = 0;
  DB.all('CRM_Kontak').forEach(function (k) { if (k.Sumber === 'manual') have[k.RefID] = 1; });
  rows.forEach(function (r) {
    var hp = hp08_(r.wa || r.hp || r.nowa), email = lower_(r.email), key = hp || email;
    if (!key || have[key] || (!hpValid_(hp) && !emailValid_(email))) { lewati++; return; }
    have[key] = 1;
    baru.push({ Nama: r.nama || 'Tanpa Nama', Email: email, NoWA: hp, Segmen: r.segmen || 'Lainnya', Sumber: 'manual', RefID: key, Tag: r.tag || '', StatusWA: '', CekWAAt: '', EmailValid: email ? (emailValid_(email) ? 'YA' : 'TIDAK') : '',
      OptOut: 'TIDAK', Catatan: '', JumlahPesan: 0, TerakhirDihubungi: '', Info: '{}', DibuatPada: now, DiperbaruiPada: now });
  });
  if (baru.length) { var ids = reserveIds_('CRM_Kontak', baru.length); baru.forEach(function (b, i) { b.KontakID = ids[i]; }); DB.appendBatch('CRM_Kontak', baru); }
  return ok_({ ditambah: baru.length, dilewati: lewati }, baru.length + ' kontak diimpor, ' + lewati + ' dilewati (ganda/tidak valid).');
}

function svcCrmMerge(ctx, d) {
  var utama = DB.find('CRM_Kontak', 'KontakID', d.utama); if (!utama) return fail_('Kontak utama tidak ditemukan.');
  var gabung = (d.gabung || []).filter(function (id) { return id !== d.utama; }).map(function (id) { return DB.find('CRM_Kontak', 'KontakID', id); }).filter(Boolean);
  if (!gabung.length) return fail_('Pilih kontak yang akan digabung.');
  var tags = String(utama.Tag || '').split(',').map(function (t) { return t.trim(); }).filter(String), jml = Number(utama.JumlahPesan || 0), cat = utama.Catatan ? [utama.Catatan] : [];
  gabung.forEach(function (g) {
    String(g.Tag || '').split(',').forEach(function (t) { t = t.trim(); if (t && tags.indexOf(t) === -1 && t.indexOf('merged') === -1) tags.push(t); });
    jml += Number(g.JumlahPesan || 0); if (g.Catatan) cat.push(g.Catatan);
  });
  DB.updateBatch('CRM_Kontak', 'KontakID', [{ KontakID: utama.KontakID, Tag: tags.join(', '), JumlahPesan: jml, Catatan: cat.join(' | ').substring(0, 1000), OptOut: gabung.some(function (g) { return g.OptOut === 'YA'; }) || utama.OptOut === 'YA' ? 'YA' : 'TIDAK' }]
    .concat(gabung.map(function (g) { return { KontakID: g.KontakID, Tag: 'merged→' + utama.KontakID }; })));
  return ok_(null, gabung.length + ' kontak digabung ke ' + utama.Nama + '.');
}

function svcCrmExport(ctx, d) {
  var kelasNama = {}; DB.all('Kelas').forEach(function (k) { kelasNama[k.kelas_id] = k.nama_kelas; });
  var out = [], hal = 1;
  while (true) {
    var r = svcCrmList(ctx, Object.assign({}, d, { per: 200, halaman: hal })).data;
    r.rows.forEach(function (k) { out.push([k.Nama, k.Segmen, k.NoWA, k.StatusWA || 'Belum dicek', k.Email, k.EmailValid, kelasNama[k.info.kelas_id] || '', k.Tag, k.OptOut, k.JumlahPesan, k.TerakhirDihubungi]); });
    if (hal * 200 >= r.total) break; hal++;
  }
  queueLog_([ctx.session.email, ctx.session.role, 'crm.export', out.length + ' kontak', '']);
  return ok_({ headers: ['Nama', 'Segmen', 'No WA', 'Status WA', 'Email', 'Email Valid', 'Kelas', 'Tag', 'Opt-out', 'Jumlah Pesan', 'Terakhir Dihubungi'], rows: out, n: out.length });
}

/** Dipanggil prosesor antrean: naikkan JumlahPesan & TerakhirDihubungi (1× updateBatch) */
function crmCatatKirim_(tujuan) {
  var set = {}; tujuan.forEach(function (t) { set[String(t).toLowerCase()] = (set[String(t).toLowerCase()] || 0) + 1; });
  var now = nowIso_();
  var up = DB.all('CRM_Kontak').map(function (k) {
    var n = (set[hp62_(k.NoWA)] || 0) + (k.Email ? (set[lower_(k.Email)] || 0) : 0);
    return n ? { KontakID: k.KontakID, JumlahPesan: Number(k.JumlahPesan || 0) + n, TerakhirDihubungi: now } : null;
  }).filter(Boolean);
  DB.updateBatch('CRM_Kontak', 'KontakID', up);
}
