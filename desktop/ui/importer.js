// Разбор книг при добавлении: название, автор, обложка (EPUB, FB2 в любой кодировке и в zip, PDF)
async function decodeXml(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 300));
  const m = head.match(/encoding=["']([^"']+)["']/i);
  const enc = ((m && m[1]) || 'utf-8').toLowerCase();
  try { return new TextDecoder(enc).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}
const parseXml = t => new DOMParser().parseFromString(t, 'text/xml');
const b64 = s => { const bin = atob(s.replace(/\s+/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const extOfMime = m => /png/.test(m) ? 'png' : /gif/.test(m) ? 'gif' : /webp/.test(m) ? 'webp' : 'jpg';

async function parseFb2(bytes) {
  const doc = parseXml(await decodeXml(bytes));
  if (doc.querySelector('parsererror')) throw new Error('не удалось разобрать FB2');
  const ti = doc.querySelector('description > title-info');
  const text = sel => ((ti && ti.querySelector(sel)) || {}).textContent;
  const names = [...(ti ? ti.querySelectorAll('author') : [])].map(a => ['first-name', 'middle-name', 'last-name'].map(t => (a.querySelector(t) || {}).textContent || '').filter(Boolean).join(' ').trim() || ((a.querySelector('nickname') || {}).textContent || ''));
  let cover = null;
  const img = ti && ti.querySelector('coverpage image');
  if (img) {
    const href = [...img.attributes].find(a => /href$/.test(a.name));
    const id = href && href.value.replace(/^#/, '');
    const bin = id && [...doc.querySelectorAll('binary')].find(b => b.getAttribute('id') === id);
    if (bin) { const mime = bin.getAttribute('content-type') || 'image/jpeg'; cover = { bytes: b64(bin.textContent), ext: extOfMime(mime), mime }; }
  }
  return { title: (text('book-title') || '').trim(), author: names.filter(Boolean).join(', '), lang: (text('lang') || '').trim(), cover };
}

async function parseEpub(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const cont = zip.file('META-INF/container.xml');
  if (!cont) throw new Error('это не EPUB');
  const opfPath = parseXml(await cont.async('string')).querySelector('rootfile').getAttribute('full-path');
  const opf = parseXml(await zip.file(opfPath).async('string'));
  const dc = n => [...opf.getElementsByTagNameNS('*', n)].map(e => e.textContent.trim()).filter(Boolean);
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const items = [...opf.getElementsByTagNameNS('*', 'item')];
  let item = items.find(i => /(^|\s)cover-image(\s|$)/.test(i.getAttribute('properties') || ''));
  if (!item) {
    const meta = [...opf.getElementsByTagNameNS('*', 'meta')].find(m => m.getAttribute('name') === 'cover');
    if (meta) item = items.find(i => i.getAttribute('id') === meta.getAttribute('content'));
  }
  if (!item) item = items.find(i => /^image\//.test(i.getAttribute('media-type') || '') && /cover/i.test((i.getAttribute('id') || '') + (i.getAttribute('href') || '')));
  let cover = null;
  if (item) {
    const f = zip.file(decodeURIComponent(base + item.getAttribute('href'))) || zip.file(base + item.getAttribute('href'));
    if (f) { const mime = item.getAttribute('media-type') || 'image/jpeg'; cover = { bytes: await f.async('uint8array'), ext: extOfMime(mime), mime }; }
  }
  return { title: dc('title')[0] || '', author: dc('creator').join(', '), lang: dc('language')[0] || '', cover };
}

async function parsePdf(bytes) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const md = await doc.getMetadata().catch(() => ({}));
  const info = (md && md.info) || {};
  let cover = null;
  try {
    const page = await doc.getPage(1);
    const v0 = page.getViewport({ scale: 1 }), scale = 460 / v0.width, vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
    cover = { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'jpg', mime: 'image/jpeg' };
  } catch {}
  const pages = doc.numPages; doc.destroy();
  return { title: (info.Title || '').trim(), author: (info.Author || '').trim(), lang: '', cover, pages };
}

const nameParts = file => {
  const base = file.replace(/\.(fb2\.zip|fb2|epub|pdf|zip)$/i, '').replace(/_/g, ' ').trim();
  const m = base.match(/^(.{2,60}?)\s+[-–—]\s+(.+)$/);
  return m ? { author: m[1].trim(), title: m[2].trim() } : { author: '', title: base };
};

// Готовит файл к добавлению: возвращает { ext, bytes, meta, cover }
async function prepareBook(path) {
  const name = path.split(/[\\/]/).pop();
  let ext = (name.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || '';
  let bytes = new Uint8Array(await pin.readFile(path));
  if (ext === 'zip') { // fb2.zip и подобное
    const z = await JSZip.loadAsync(bytes);
    const f = Object.values(z.files).find(f => /\.(fb2|epub|pdf)$/i.test(f.name));
    if (!f) throw new Error('в архиве нет книги (fb2, epub, pdf)');
    ext = f.name.match(/\.([A-Za-z0-9]+)$/)[1].toLowerCase(); bytes = await f.async('uint8array');
  }
  if (!ORDER.includes(ext)) throw new Error('формат .' + ext + ' не поддерживается');
  const m = ext === 'epub' ? await parseEpub(bytes) : ext === 'fb2' ? await parseFb2(bytes) : await parsePdf(bytes);
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  const np = nameParts(name);
  const junk = t => !t || /^(microsoft word|untitled|без названия|document)/i.test(t) || /\.(docx?|indd|tex|pdf)$/i.test(t);
  const title = junk(m.title) ? np.title : m.title;
  const author = m.author || (junk(m.title) ? np.author : '');
  const color = m.cover ? await coverColor(m.cover.bytes, m.cover.mime) : '';
  return { ext, bytes, sha, meta: { title: title || np.title || 'Без названия', author, lang: m.lang, pages: m.pages || 0, color }, cover: m.cover ? { bytes: m.cover.bytes, ext: m.cover.ext } : null };
}
