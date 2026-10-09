// Android-версия: вместо Electron-моста (preload.js) окно говорит с Kotlin через AndroidBridge.
(function () {
  const B = window.AndroidBridge, ORIGIN = location.origin;
  document.documentElement.classList.add('android');
  document.addEventListener('DOMContentLoaded', () => document.body.classList.add('android'));
  try { if (!localStorage.getItem('pin_fs')) localStorage.setItem('pin_fs', '16'); } catch {}   // на телефоне шрифт мельче, чтобы не рвалось выравнивание
  const call = (n, a) => new Promise((res, rej) => {
    try { const r = JSON.parse(B.call(n, JSON.stringify(a || {}))); if (r && r.error) rej(new Error(r.error)); else res(r.result); } catch (e) { rej(e); }
  });
  const enc = s => encodeURIComponent(s);
  const books = {};   // id → книга (для адресов файлов)
  const wrap = m => {
    if (!m) return m; books[m.id] = m; m.dir = m.dirName;
    const v = '?v=' + (m.coverV || 0), base = ORIGIN + '/shelf/' + enc(m.dirName) + '/';
    m.coverUrl = m.cover ? base + enc(m.cover) + v : null;
    m.thumbUrl = m.thumb ? base + enc(m.thumb) + v : m.coverUrl;
    return m;
  };
  let tmpN = 0;
  const putBytes = async bytes => {   // большой файл → Kotlin кусками по ~384 КБ
    const id = 'u' + Date.now() + '_' + (tmpN++), u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), CH = 384 * 1024;
    for (let i = 0, k = 0; i < u8.length || k === 0; i += CH, k++) {
      let s = ''; const part = u8.subarray(i, i + CH);
      for (let j = 0; j < part.length; j += 0x8000) s += String.fromCharCode.apply(null, part.subarray(j, j + 0x8000));
      await call('chunk', { id, i: k, b64: btoa(s) });
      await new Promise(r => setTimeout(r));   // даём окну перерисоваться
    }
    return id;
  };
  const pickWait = {};
  window.__pickDone = (req, paths) => { const r = pickWait[req]; if (r) { delete pickWait[req]; r(paths); } };
  const fileUrl = (b, fmt) => ORIGIN + '/shelf/' + enc(b.dirName) + '/' + enc(b.formats[fmt].file);
  window.pin = {
    getRoot: async () => ({ root: 'app', exists: true, platform: 'android' }),
    chooseRoot: async () => null,
    listBooks: async () => (await call('list')).map(wrap),
    findByHash: sha => call('findByHash', { sha }),
    pickBooks: () => new Promise(res => { const req = 'p' + Date.now(); pickWait[req] = res; B.pick(req); }),
    readFile: async path => (await fetch(ORIGIN + '/' + path.split('/').map(encodeURIComponent).join('/'))).arrayBuffer(),
    createBook: async ({ meta, ext, bytes, cover }) => wrap(await call('create', { meta, ext, tmp: await putBytes(bytes), cover: cover && cover.bytes ? { tmp: await putBytes(cover.bytes), ext: cover.ext || 'jpg' } : null })),
    addFormat: async ({ id, ext, bytes, cover, meta, converted }) => wrap(await call('addFormat', { id, ext, meta, converted: !!converted, tmp: await putBytes(bytes), cover: cover && cover.bytes ? { tmp: await putBytes(cover.bytes), ext: cover.ext || 'jpg' } : null })),
    readFormat: async ({ id, fmt }) => { const b = books[id]; if (!b || !b.formats[fmt]) throw new Error('Нет такого формата'); return (await fetch(fileUrl(b, fmt))).arrayBuffer(); },
    updateBook: async ({ id, patch }) => wrap(await call('update', { id, patch })),
    removeBook: id => call('remove', { id }),
    mergeBooks: a => call('merge', a),
    exportBook: a => call('exportBook', a),
    exportAll: a => call('exportAll', a),
    reveal: async () => true, revealRoot: async () => true,
    pathForFile: () => null,
  };
  // кнопка «Назад» на телефоне: закрыть читалку / окно / меню; true — если что-то закрыли
  window.__back = () => {
    const vis = id => { const e = document.getElementById(id); return e && !e.classList.contains('hide'); };
    if (vis('reader')) return typeof Reader !== 'undefined' ? Reader.back() : (document.getElementById('rclose').click(), true);
    for (const id of ['edit', 'dl', 'detail', 'menu']) if (vis(id)) { document.getElementById(id).classList.add('hide'); return true; }
    return false;
  };
})();
