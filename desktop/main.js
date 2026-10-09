// Пинакес: моя книжная полка. Главный процесс: окно и работа с файлами (книги лежат в папке полки на диске).
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

const SHELF_DIR = '3. Пинакес — моя книжная полка';
const LIB_DIR = 'Александрийская библиотека';
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox'); // Ubuntu 24+: без этого окно может не открыться
let win;
// язык диалогов ОС: интерфейс сообщает выбранный язык
let LANG = 'ru';
const EN_MAIN = {"Папка для книжной полки": "Folder for the bookshelf", "Добавить книги на полку": "Add books to the shelf", "Книги (EPUB, FB2, PDF)": "Books (EPUB, FB2, PDF)", "Все файлы": "All files", "Куда сохранить книгу": "Where to save the book", "Сохранить сюда": "Save here", "Куда выгрузить книги": "Where to export the books", "Выгрузить сюда": "Export here"};
const L = s => LANG === 'en' && EN_MAIN[s] || s;
ipcMain.handle('setLang', (_e, l) => { LANG = l === 'en' ? 'en' : 'ru'; return true; });

// ---------- где лежит полка ----------
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const writeCfg = c => { try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c)); } catch {} };

function volumeRoots() {
  try {
    if (process.platform === 'darwin') return fs.readdirSync('/Volumes').map(n => path.join('/Volumes', n));
    if (process.platform === 'win32') return 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => l + ':\\');
    const u = os.userInfo().username, out = [];
    for (const b of [`/media/${u}`, `/run/media/${u}`, '/mnt']) { try { fs.readdirSync(b).forEach(n => out.push(path.join(b, n))); } catch {} }
    return out;
  } catch { return []; }
}

function findShelf() {
  if (process.env.PINAKES_ROOT) return process.env.PINAKES_ROOT;
  // 3) папка, выбранная вручную
  const c = readCfg();
  return c.root && fs.existsSync(c.root) ? c.root : path.join(app.getPath('documents'), 'Пинакес', 'Книги');
}

let ROOT = null;
const root = () => ROOT || (ROOT = findShelf());
const ensureRoot = () => { const r = root(); if (r) fs.mkdirSync(r, { recursive: true }); return r; };

// ---------- книги ----------
const safe = s => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110) || 'Без названия';
const bookDir = id => { const r = root(); if (!r) return null; for (const n of fs.readdirSync(r)) { const p = path.join(r, n); if (!n.startsWith('.') && fs.existsSync(path.join(p, 'book.json'))) { try { if (JSON.parse(fs.readFileSync(path.join(p, 'book.json'), 'utf8')).id === id) return p; } catch {} } } return null; };
const readBook = dir => { const m = JSON.parse(fs.readFileSync(path.join(dir, 'book.json'), 'utf8')); m.dir = dir; return m; };
const writeBook = (dir, m) => { const { dir: _d, coverUrl: _c, thumbUrl: _t, ...rest } = m; fs.writeFileSync(path.join(dir, 'book.json'), JSON.stringify(rest, null, 1)); };
// Для полки нужна маленькая копия обложки: большая картинка на 3D-грани тормозит анимацию и съедает память
function ensureThumb(dir, m) {
  if (!m.cover) return null;
  const t = path.join(dir, 'cover-s.jpg');
  try {
    if (fs.existsSync(t)) return t;
    const img = nativeImage.createFromPath(path.join(dir, m.cover));
    if (img.isEmpty()) return null;
    const h = img.getSize().height;
    if (h <= 520) return null;                       // уже маленькая: используем как есть
    fs.writeFileSync(t, img.resize({ height: 520, quality: 'best' }).toJPEG(86));
    return t;
  } catch { return null; }
}
const withCover = m => {
  const v = '?v=' + (m.coverV || 0);
  m.coverUrl = m.cover ? pathToFileURL(path.join(m.dir, m.cover)).href + v : null;
  const t = ensureThumb(m.dir, m);
  m.thumbUrl = t ? pathToFileURL(t).href + v : m.coverUrl;
  return m;
};

function listBooks() {
  const r = root();
  if (!r || !fs.existsSync(r)) return [];
  const out = [];
  for (const n of fs.readdirSync(r)) {
    if (n.startsWith('.')) continue;
    const dir = path.join(r, n);
    try { if (fs.existsSync(path.join(dir, 'book.json'))) out.push(withCover(readBook(dir))); } catch {}
  }
  return out;
}

function uniqueDir(base) {
  let d = path.join(root(), safe(base)), n = 2;
  while (fs.existsSync(d)) d = path.join(root(), `${safe(base)} (${n++})`);
  return d;
}

function putFormat(dir, m, ext, bytes, title) {
  const file = `${safe(title)}.${ext}`;
  const buf = Buffer.from(bytes);
  fs.writeFileSync(path.join(dir, file), buf);
  m.formats = m.formats || {};
  m.formats[ext] = { file, size: buf.length, sha: sha256(buf) };
}

function saveCover(dir, m, cover) {
  if (!cover || !cover.bytes) return;
  const name = 'cover.' + (cover.ext || 'jpg');
  fs.writeFileSync(path.join(dir, name), Buffer.from(cover.bytes));
  m.cover = name; m.coverV = Date.now();
  try { fs.rmSync(path.join(dir, 'cover-s.jpg'), { force: true }); } catch {}
}

ipcMain.handle('getRoot', () => { const r = root(); try { if (r && !fs.existsSync(r) && fs.existsSync(path.dirname(r))) fs.mkdirSync(r, { recursive: true }); } catch {} return { root: r, exists: !!(r && fs.existsSync(r)), platform: process.platform }; });
ipcMain.handle('chooseRoot', async () => {
  const r = await dialog.showOpenDialog(win, { title: L('Папка для книжной полки'), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const c = readCfg(); c.root = r.filePaths[0]; writeCfg(c); ROOT = r.filePaths[0];
  return ROOT;
});
ipcMain.handle('listBooks', () => listBooks());
// Защита от дублей: тот же файл не добавляем повторно, даже если название правили. У старых книг отпечаток досчитывается при первой проверке.
ipcMain.handle('findByHash', (_e, sha) => {
  for (const b of listBooks()) {
    let changed = false;
    for (const [fmt, f] of Object.entries(b.formats || {})) {
      if (!f.sha) { try { f.sha = sha256(fs.readFileSync(path.join(b.dir, f.file))); changed = true; } catch { continue; } }
      if (f.sha === sha) { if (changed) writeBook(b.dir, b); return { id: b.id, title: b.title, author: b.author, fmt }; }
    }
    if (changed) writeBook(b.dir, b);
  }
  return null;
});
ipcMain.handle('pickBooks', async () => {
  const r = await dialog.showOpenDialog(win, { title: L('Добавить книги на полку'), properties: ['openFile', 'multiSelections'],
    filters: [{ name: L('Книги (EPUB, FB2, PDF)'), extensions: ['epub', 'fb2', 'pdf', 'zip'] }, { name: L('Все файлы'), extensions: ['*'] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('readFile', (_e, p) => fs.readFileSync(p));
ipcMain.handle('createBook', (_e, { meta, ext, bytes, cover }) => {
  if (!ensureRoot()) throw new Error('Папка полки не найдена. Откройте контейнер или выберите папку.');
  const dir = uniqueDir(`${meta.author ? meta.author + ' — ' : ''}${meta.title}`);
  fs.mkdirSync(dir, { recursive: true });
  const m = { id: Math.random().toString(16).slice(2, 10), title: meta.title, author: meta.author || '', lang: meta.lang || '', pages: meta.pages || 0,
    color: meta.color || '', added: Date.now(), formats: {}, cover: null, progress: null };
  putFormat(dir, m, ext, bytes, meta.title);
  saveCover(dir, m, cover);
  writeBook(dir, m); m.dir = dir;
  return withCover(m);
});
ipcMain.handle('addFormat', (_e, { id, ext, bytes, cover, meta, converted }) => {
  const dir = bookDir(id); if (!dir) throw new Error('Книга не найдена');
  const m = readBook(dir);
  putFormat(dir, m, ext, bytes, m.title);
  if (converted) m.formats[ext].converted = true;
  if (!m.cover && cover) { saveCover(dir, m, cover); if (meta && meta.color) m.color = meta.color; }
  if (!m.pages && meta && meta.pages) m.pages = meta.pages;
  writeBook(dir, m);
  return withCover(m);
});
ipcMain.handle('readFormat', (_e, { id, fmt }) => {
  const dir = bookDir(id); if (!dir) throw new Error('Книга не найдена');
  const m = readBook(dir); const f = m.formats[fmt]; if (!f) throw new Error('Нет такого формата');
  return fs.readFileSync(path.join(dir, f.file));
});
ipcMain.handle('updateBook', (_e, { id, patch }) => {
  const dir = bookDir(id); if (!dir) throw new Error('Книга не найдена');
  const m = readBook(dir);
  for (const k of ['title', 'author', 'progress', 'color', 'pages', 'lastRead']) if (k in patch) m[k] = patch[k];
  writeBook(dir, m);
  return withCover(m);
});
ipcMain.handle('removeBook', (_e, id) => {
  const dir = bookDir(id); if (!dir) return false;
  const bin = path.join(root(), '.корзина'); fs.mkdirSync(bin, { recursive: true });
  let to = path.join(bin, path.basename(dir)), n = 2;
  while (fs.existsSync(to)) to = path.join(bin, `${path.basename(dir)} (${n++})`);
  fs.renameSync(dir, to);
  return true;
});
// Склейка двух карточек одной книги: форматы второй переезжают в первую, пустая карточка уходит в корзину
ipcMain.handle('mergeBooks', (_e, { keepId, fromId }) => {
  const dk = bookDir(keepId), df = bookDir(fromId); if (!dk || !df) throw new Error('Книга не найдена');
  const mk = readBook(dk), mf = readBook(df);
  if (Object.keys(mf.formats || {}).some(f => mk.formats[f])) throw new Error('у обеих книг есть один и тот же формат');
  for (const [ext, f] of Object.entries(mf.formats || {})) putFormat(dk, mk, ext, fs.readFileSync(path.join(df, f.file)), mk.title);
  if (!mk.cover && mf.cover) { try { saveCover(dk, mk, { bytes: fs.readFileSync(path.join(df, mf.cover)), ext: path.extname(mf.cover).slice(1) }); if (mf.color) mk.color = mf.color; } catch {} }
  if (!mk.pages && mf.pages) mk.pages = mf.pages;
  if (!mk.author && mf.author) mk.author = mf.author;
  if (mf.progress && (!mk.progress || (mf.progress.percent || 0) > (mk.progress.percent || 0))) { mk.progress = mf.progress; mk.lastRead = mf.lastRead; }
  mk.added = Math.min(mk.added || Infinity, mf.added || Infinity);
  writeBook(dk, mk);
  const bin = path.join(root(), '.корзина'); fs.mkdirSync(bin, { recursive: true });
  let to = path.join(bin, path.basename(df)), n = 2;
  while (fs.existsSync(to)) to = path.join(bin, `${path.basename(df)} (${n++})`);
  fs.renameSync(df, to);
  return true;
});
ipcMain.handle('exportBook', async (_e, { id, formats }) => {
  const dir = bookDir(id); if (!dir) throw new Error('Книга не найдена');
  const m = readBook(dir);
  const r = await dialog.showOpenDialog(win, { title: L('Куда сохранить книгу'), properties: ['openDirectory', 'createDirectory'], buttonLabel: L('Сохранить сюда') });
  if (r.canceled || !r.filePaths[0]) return null;
  const done = [];
  for (const fmt of formats) {
    const f = m.formats[fmt]; if (!f) continue;
    let to = path.join(r.filePaths[0], `${safe((m.author ? m.author + ' — ' : '') + m.title)}.${fmt}`), n = 2;
    while (fs.existsSync(to)) to = path.join(r.filePaths[0], `${safe((m.author ? m.author + ' — ' : '') + m.title)} (${n++}).${fmt}`);
    fs.copyFileSync(path.join(dir, f.file), to);
    done.push(to);
  }
  return { dir: r.filePaths[0], files: done };
});
// Выгрузка всей полки в одном формате (для электронных книг): берём только книги, у которых такой формат есть, другой не подставляем
ipcMain.handle('exportAll', async (_e, { fmt }) => {
  if (!['epub', 'fb2', 'pdf'].includes(fmt)) throw new Error('неизвестный формат');
  const r = await dialog.showOpenDialog(win, { title: L('Куда выгрузить книги'), properties: ['openDirectory', 'createDirectory'], buttonLabel: L('Выгрузить сюда') });
  if (r.canceled || !r.filePaths[0]) return null;
  const out = r.filePaths[0]; let done = 0, skipped = 0; const failed = [];
  for (const b of listBooks()) {
    const f = b.formats && b.formats[fmt]; if (!f) { skipped++; continue; }
    const base = safe((b.author ? b.author + ' — ' : '') + b.title);
    let to = path.join(out, `${base}.${fmt}`), n = 2;
    while (fs.existsSync(to)) to = path.join(out, `${base} (${n++}).${fmt}`);
    try { fs.copyFileSync(path.join(b.dir, f.file), to); done++; } catch (e) { failed.push(b.title); }
  }
  return { dir: out, done, skipped, failed };
});
ipcMain.handle('reveal', (_e, id) => { const d = bookDir(id) || root(); if (d) shell.showItemInFolder(d); return true; });
ipcMain.handle('revealRoot', () => { const r = root(); if (r) shell.openPath(r); return true; });



function create() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 620, backgroundColor: '#0d0906', title: 'Пинакес',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  if (process.env.PIN_SHOT) { // проверка без кликов: снимок окна и выход (PIN_JS — код, PIN_WAIT — пауза в мс)
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      win.webContents.on('console-message', (_e, _l, m) => console.log('CONSOLE:', m));
      if (process.env.PIN_JS) console.log('JS:', await win.webContents.executeJavaScript(process.env.PIN_JS).catch(e => 'ERR ' + e.message));
      setTimeout(async () => { fs.writeFileSync(process.env.PIN_SHOT, (await win.webContents.capturePage()).toPNG()); app.quit(); }, Number(process.env.PIN_WAIT || 1200));
    }, 2500));
  }
}
app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
