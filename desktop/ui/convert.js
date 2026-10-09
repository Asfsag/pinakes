// Конвертеры FB2 ⇄ EPUB (работают в окне: JSZip + DOMParser, без внешних программ)
const X = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uuid4 = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const bytesToB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const wrap76 = s => s.replace(/(.{76})/g, '$1\n');

// ============================== FB2 → EPUB ==============================
async function fb2ToEpub(bytes) {
  const doc = parseXml(await decodeXml(bytes));
  if (doc.querySelector('parsererror')) throw new Error('не удалось разобрать FB2');
  const hrefOf = e => { const a = [...e.attributes].find(a => /href$/.test(a.name)); return a ? a.value : ''; };
  const ti = doc.querySelector('description > title-info');
  const txt = s => (((ti && ti.querySelector(s)) || {}).textContent || '').trim();
  const title = txt('book-title') || 'Без названия';
  const authors = [...(ti ? ti.querySelectorAll('author') : [])].map(a => ['first-name', 'middle-name', 'last-name'].map(t => (a.querySelector(t) || {}).textContent || '').map(s => s.trim()).filter(Boolean).join(' ') || ((a.querySelector('nickname') || {}).textContent || '').trim()).filter(Boolean);
  const lang = txt('lang') || 'ru';

  // картинки
  const imgs = {}; let imgN = 0;
  doc.querySelectorAll('binary').forEach(b => {
    const id = b.getAttribute('id'); if (!id) return;
    let mime = (b.getAttribute('content-type') || 'image/jpeg').toLowerCase(); if (mime === 'application/octet-stream') mime = 'image/jpeg';
    const ext = MIME_EXT[mime] || 'jpg'; const bin = atob(b.textContent.replace(/\s+/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    imgs[id] = { name: `img${++imgN}.${ext}`, mime: EXT_MIME[ext] || mime, bytes: u };
  });
  const usedImgs = new Set();
  const imgSrc = n => { const id = hrefOf(n).replace(/^#/, ''); const im = imgs[id]; if (!im) return null; usedImgs.add(id); return 'images/' + im.name; };

  // содержание глав и сноски
  const chapters = []; const idFile = {}; let cur = null; let hN = 0;
  const notes = []; // {id, html}
  const noteIds = new Set();
  doc.querySelectorAll('body[name="notes"] section').forEach(s => { const id = s.getAttribute('id'); if (id) noteIds.add(id); });
  const link = h => { if (!h) return null; if (h.startsWith('#')) { const id = h.slice(1); return noteIds.has(id) ? `notes.xhtml#${id}` : `@@${id}@@`; } return h; };

  function inline(node) {
    let o = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { o += X(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.localName, inner = () => inline(n);
      if (t === 'strong') o += `<strong>${inner()}</strong>`;
      else if (t === 'emphasis') o += `<em>${inner()}</em>`;
      else if (t === 'strikethrough') o += `<s>${inner()}</s>`;
      else if (t === 'sub' || t === 'sup' || t === 'code') o += `<${t}>${inner()}</${t}>`;
      else if (t === 'a') { const h = link(hrefOf(n)); o += h ? `<a href="${X(h)}"${n.getAttribute('type') === 'note' || h.startsWith('notes.xhtml') ? ' epub:type="noteref"' : ''}>${inner()}</a>` : inner(); }
      else if (t === 'image') { const s = imgSrc(n); if (s) o += `<img src="${s}" alt=""/>`; }
      else o += inner();
    }
    return o;
  }
  const P = (n, cls, id) => `<p${cls ? ` class="${cls}"` : ''}${id ? ` id="${X(id)}"` : ''}>${inline(n) || '&#160;'}</p>`;
  const reg = (el) => { const id = el.getAttribute && el.getAttribute('id'); if (id && cur) { idFile[id] = cur.file; return id; } return null; };

  function block(n, depth) {
    const t = n.localName; const id = reg(n);
    const withId = s => id ? `<a id="${X(id)}"></a>${s}` : s;
    if (t === 'section') {
      let o = ''; for (const c of n.children) o += block(c, depth + 1); return withId(`<div class="sec">${o}</div>`);
    }
    if (t === 'title') {
      const lvl = Math.min(6, Math.max(1, depth)); const ps = [...n.children].filter(c => c.localName === 'p').map(p => inline(p)).filter(Boolean);
      const label = ps.length ? ps.join(' ') : X(n.textContent.trim());
      const hid = 'h' + (hN++);
      if (cur && depth <= 2) cur.toc.push({ id: hid, label: n.textContent.replace(/\s+/g, ' ').trim(), lvl: depth });
      return `<h${lvl} id="${hid}">${label}</h${lvl}>`;
    }
    if (t === 'subtitle') return `<p class="subtitle">${inline(n)}</p>`;
    if (t === 'p') return withId(P(n));
    if (t === 'empty-line') return '<p class="empty">&#160;</p>';
    if (t === 'epigraph') { let o = ''; for (const c of n.children) o += block(c, depth); return `<blockquote class="epigraph">${o}</blockquote>`; }
    if (t === 'cite') { let o = ''; for (const c of n.children) o += block(c, depth); return `<blockquote class="cite">${o}</blockquote>`; }
    if (t === 'poem') { let o = ''; for (const c of n.children) o += block(c, depth); return `<div class="poem">${o}</div>`; }
    if (t === 'stanza') { let o = ''; for (const c of n.children) o += block(c, depth); return `<div class="stanza">${o}</div>`; }
    if (t === 'v') return `<p class="v">${inline(n)}</p>`;
    if (t === 'text-author') return `<p class="ta">${inline(n)}</p>`;
    if (t === 'annotation') { let o = ''; for (const c of n.children) o += block(c, depth); return `<div class="annotation">${o}</div>`; }
    if (t === 'image') { const s = imgSrc(n); return s ? `<div class="img"><img src="${s}" alt=""/></div>` : ''; }
    if (t === 'table') {
      let o = '<table>'; n.querySelectorAll('tr').forEach(tr => { o += '<tr>'; [...tr.children].forEach(c => { const tg = c.localName === 'th' ? 'th' : 'td'; o += `<${tg}${c.getAttribute('colspan') ? ` colspan="${X(c.getAttribute('colspan'))}"` : ''}>${inline(c)}</${tg}>`; }); o += '</tr>'; }); return o + '</table>';
    }
    return '';
  }

  // главы: каждая секция верхнего уровня основной части — отдельный файл
  let chN = 0;
  const startCh = label => { cur = { file: `ch${++chN}.xhtml`, label, body: '', toc: [] }; chapters.push(cur); return cur; };
  const mains = [...doc.querySelectorAll('FictionBook > body')].filter(b => (b.getAttribute('name') || '') !== 'notes');
  for (const body of mains) {
    const secs = [...body.children].filter(c => c.localName === 'section');
    const head = [...body.children].filter(c => c.localName !== 'section');
    if (!secs.length) { startCh(title); for (const c of body.children) cur.body += block(c, 1); continue; }
    if (head.length) { startCh('Начало'); for (const c of head) cur.body += c.localName === 'title' ? `<h1>${X(c.textContent.replace(/\s+/g, ' ').trim())}</h1>` : block(c, 1); }
    for (const s of secs) {
      const tt = s.querySelector(':scope > title'); const label = tt ? tt.textContent.replace(/\s+/g, ' ').trim() : '';
      startCh(label || `Часть ${chN + 1}`);
      let o = ''; for (const c of s.children) o += block(c, 1);
      reg(s); cur.body += o;
      cur.label = label || cur.label;
    }
  }
  if (!chapters.length) { startCh(title); cur.body = '<p>&#160;</p>'; }
  // сноски
  doc.querySelectorAll('body[name="notes"] section').forEach(s => {
    const id = s.getAttribute('id'); if (!id) return;
    let o = ''; cur = { file: 'notes.xhtml', toc: [] };
    for (const c of s.children) if (c.localName !== 'title') o += block(c, 9); else o += `<p class="notehead"><b>${X(c.textContent.replace(/\s+/g, ' ').trim())}</b></p>`;
    notes.push(`<div class="note" id="${X(id)}">${o}</div>`);
  });
  const fix = h => h.replace(/@@([^@]+)@@/g, (m, id) => idFile[id] ? `${idFile[id]}#${id}` : '#');

  const cssText = `body{font-family:serif;line-height:1.5;margin:0 4%}h1,h2,h3,h4,h5,h6{text-align:center;font-weight:bold;margin:1.4em 0 .8em;page-break-after:avoid}h1{font-size:1.5em}h2{font-size:1.3em}h3{font-size:1.15em}p{margin:0;text-indent:1.4em;text-align:justify}p.empty{height:1em}p.subtitle{text-indent:0;text-align:center;font-weight:bold;margin:1em 0}p.ta{text-align:right;font-style:italic;text-indent:0}p.v{text-indent:0;margin-left:1.4em}.stanza{margin:.8em 0}.epigraph{margin:1em 0 1em 25%;font-style:italic}.epigraph p,.cite p{text-indent:0}.cite{margin:1em 1.4em}.annotation{margin:1em 0;font-size:.95em}.img{text-align:center;margin:1em 0}img{max-width:100%}.note{margin:.6em 0}.note p{text-indent:0}table{border-collapse:collapse;margin:1em auto}td,th{border:1px solid #888;padding:.2em .5em}a{color:inherit}.cover{text-align:center;margin:0;padding:0}.cover img{max-height:100%}`;
  const page = (ttl, body) => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${X(lang)}" lang="${X(lang)}"><head><meta charset="utf-8"/><title>${X(ttl)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;

  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/style.css', cssText);

  const cp = ti && ti.querySelector('coverpage image'); let coverId = null;
  if (cp) { const id = hrefOf(cp).replace(/^#/, ''); if (imgs[id]) { coverId = id; usedImgs.add(id); } }
  const bookId = 'urn:uuid:' + uuid4();
  const manifest = [], spine = [];
  const addItem = (id, href, mime, props) => manifest.push(`<item id="${id}" href="${href}" media-type="${mime}"${props ? ` properties="${props}"` : ''}/>`);
  addItem('css', 'style.css', 'text/css'); addItem('ncx', 'toc.ncx', 'application/x-dtbncx+xml'); addItem('nav', 'nav.xhtml', 'application/xhtml+xml', 'nav');
  if (coverId) {
    zip.file('OEBPS/cover.xhtml', page(title, `<div class="cover"><img src="images/${imgs[coverId].name}" alt="Обложка"/></div>`));
    addItem('cover', 'cover.xhtml', 'application/xhtml+xml'); spine.push('<itemref idref="cover" linear="yes"/>');
  }
  chapters.forEach((c, i) => { zip.file('OEBPS/' + c.file, page(c.label || title, fix(c.body))); addItem('c' + (i + 1), c.file, 'application/xhtml+xml'); spine.push(`<itemref idref="c${i + 1}"/>`); });
  if (notes.length) { zip.file('OEBPS/notes.xhtml', page('Примечания', fix(`<h2>Примечания</h2>${notes.join('')}`))); addItem('notes', 'notes.xhtml', 'application/xhtml+xml'); spine.push('<itemref idref="notes"/>'); }
  for (const id of usedImgs) { const im = imgs[id]; zip.file('OEBPS/images/' + im.name, im.bytes); addItem('i_' + im.name.replace(/\W/g, '_'), 'images/' + im.name, im.mime, id === coverId ? 'cover-image' : ''); }

  // оглавление: NCX (старые читалки) и nav (EPUB 3)
  const tocItems = []; chapters.forEach(c => tocItems.push({ file: c.file, label: c.label || title, lvl: 1 }));
  let n = 0; const navPoints = tocItems.map(t => `<navPoint id="np${++n}" playOrder="${n}"><navLabel><text>${X(t.label)}</text></navLabel><content src="${t.file}"/></navPoint>`).join('');
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${bookId}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${X(title)}</text></docTitle><navMap>${navPoints}</navMap></ncx>`);
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${X(lang)}"><head><meta charset="utf-8"/><title>Оглавление</title></head><body><nav epub:type="toc" id="toc"><h1>Оглавление</h1><ol>${tocItems.map(t => `<li><a href="${t.file}">${X(t.label)}</a></li>`).join('')}</ol></nav></body></html>`);
  const ann = ti && ti.querySelector('annotation');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:identifier id="bid">${bookId}</dc:identifier><dc:title>${X(title)}</dc:title>${authors.map(a => `<dc:creator>${X(a)}</dc:creator>`).join('')}<dc:language>${X(lang)}</dc:language>${ann ? `<dc:description>${X(ann.textContent.replace(/\s+/g, ' ').trim())}</dc:description>` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>${coverId ? `<meta name="cover" content="i_${imgs[coverId].name.replace(/\W/g, '_')}"/>` : ''}</metadata><manifest>${manifest.join('')}</manifest><spine toc="ncx">${spine.join('')}</spine></package>`);
  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/epub+zip' });
}

// ============================== EPUB → FB2 ==============================
async function epubToFb2(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const cont = zip.file('META-INF/container.xml'); if (!cont) throw new Error('это не EPUB');
  const opfPath = parseXml(await cont.async('string')).querySelector('rootfile').getAttribute('full-path');
  const opf = parseXml(await zip.file(opfPath).async('string'));
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const dc = n => [...opf.getElementsByTagNameNS('*', n)].map(e => e.textContent.trim()).filter(Boolean);
  const items = {}; [...opf.getElementsByTagNameNS('*', 'item')].forEach(i => { items[i.getAttribute('id')] = { href: i.getAttribute('href'), mime: i.getAttribute('media-type') || '', props: i.getAttribute('properties') || '' }; });
  const resolve = (from, rel) => { // относительный путь внутри архива
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
    const parts = (dir + decodeURIComponent(rel.split('#')[0])).split('/'), out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); } return out.join('/');
  };
  const spine = [...opf.getElementsByTagNameNS('*', 'itemref')].map(r => items[r.getAttribute('idref')]).filter(Boolean);
  const title = dc('title')[0] || 'Без названия', lang = dc('language')[0] || 'ru';

  const nameOf = s => { // «Фамилия, Имя» или «Имя Фамилия»
    s = s.trim(); if (!s) return null; let f = '', m = '', l = '';
    if (s.includes(',')) { const [a, b] = s.split(',').map(x => x.trim()); l = a; f = b; }
    else { const w = s.split(/\s+/); if (w.length === 1) return `<nickname>${X(w[0])}</nickname>`; l = w.pop(); f = w.join(' '); }
    return `${f ? `<first-name>${X(f)}</first-name>` : ''}${l ? `<last-name>${X(l)}</last-name>` : ''}`;
  };
  const authors = (dc('creator').length ? dc('creator') : ['Неизвестный автор']).map(a => `<author>${nameOf(a) || '<nickname>?</nickname>'}</author>`).join('');

  // картинки (растровые; SVG в FB2 не поддерживается)
  const bins = []; const imgIds = {}; let imgN = 0;
  const useImg = async path => {
    if (imgIds[path] !== undefined) return imgIds[path];
    const f = zip.file(path) || zip.file(decodeURIComponent(path)); const ext = (path.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
    if (!f || !EXT_MIME[ext] || ext === 'svg') return (imgIds[path] = null);
    const id = `img${++imgN}.${ext === 'jpeg' ? 'jpg' : ext}`; imgIds[path] = id;
    bins.push({ id, mime: EXT_MIME[ext], b64: bytesToB64(await f.async('uint8array')) }); return id;
  };
  // обложка
  let coverPath = null;
  const ci = Object.values(items).find(i => /(^|\s)cover-image(\s|$)/.test(i.props));
  if (ci) coverPath = base + ci.href; else { const meta = [...opf.getElementsByTagNameNS('*', 'meta')].find(m => m.getAttribute('name') === 'cover'); if (meta && items[meta.getAttribute('content')]) coverPath = base + items[meta.getAttribute('content')].href; }
  const coverId = coverPath ? await useImg(coverPath) : null;

  // загрузка документов
  const docs = [];
  for (const it of spine) {
    if (/nav/.test(it.props)) continue;
    const path = base + it.href; const f = zip.file(decodeURIComponent(path)) || zip.file(path); if (!f) continue;
    const s = await f.async('string');
    let d = new DOMParser().parseFromString(s, 'application/xhtml+xml');
    if (d.querySelector('parsererror')) d = new DOMParser().parseFromString(s, 'text/html');
    docs.push({ path, d });
  }
  const isNoteDoc = p => /(^|[\/_-])(foot|end)?notes?(\.|[\/_-])/i.test(p.split('/').pop()) && !/(^|\/)(chapter|ch)/i.test(p);
  // сноски: id → текст
  const noteText = {}; const noteOrder = [];
  const noteEl = el => /(^|\s)(footnote|endnote|rearnote|note)(\s|$)/.test(el.getAttribute('epub:type') || el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '') || el.localName === 'aside';
  for (const { path, d } of docs) {
    const nd = isNoteDoc(path);
    d.querySelectorAll('[id]').forEach(el => {
      if (nd ? ['p', 'div', 'li', 'aside', 'section'].includes(el.localName) : noteEl(el)) {
        const id = el.getAttribute('id'); if (noteText[id] !== undefined) return;
        const t = el.textContent.replace(/\s+/g, ' ').trim().replace(/^[\[\(]?\d+[\]\)]?[.:]?\s*/, ''); if (t) { noteText[id] = t; noteOrder.push(id); }
      }
    });
  }
  const usedNotes = new Set();

  async function inline(node, from) {
    let o = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { o += X(n.nodeValue.replace(/\s+/g, ' ')); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.localName.toLowerCase();
      const inner = () => inline(n, from);
      if (t === 'b' || t === 'strong') { const i = await inner(); o += i.trim() ? `<strong>${i}</strong>` : i; }
      else if (t === 'i' || t === 'em' || t === 'cite' || t === 'dfn') { const i = await inner(); o += i.trim() ? `<emphasis>${i}</emphasis>` : i; }
      else if (t === 's' || t === 'strike' || t === 'del') { const i = await inner(); o += i.trim() ? `<strikethrough>${i}</strikethrough>` : i; }
      else if (t === 'sub' || t === 'sup') { const i = await inner(); o += i.trim() ? `<${t}>${i}</${t}>` : i; }
      else if (t === 'code' || t === 'tt' || t === 'kbd') { const i = await inner(); o += i.trim() ? `<code>${i}</code>` : i; }
      else if (t === 'br') o += '\n';
      else if (t === 'a') {
        const h = n.getAttribute('href') || '';
        const frag = h.includes('#') ? h.split('#')[1] : '';
        if (frag && noteText[frag] !== undefined && !(h.startsWith('#') && n.closest('[id="' + CSS.escape(frag) + '"]'))) { usedNotes.add(frag); o += `<a l:href="#n_${X(frag)}" type="note">${await inner()}</a>`; }
        else if (/^https?:|^mailto:/i.test(h)) o += `<a l:href="${X(h)}">${await inner()}</a>`;
        else o += await inner();
      }
      else if (t === 'img' || t === 'image') {
        const src = n.getAttribute('src') || n.getAttribute('href') || n.getAttribute('xlink:href') || ''; if (!src) continue;
        const id = await useImg(resolve(from, src)); if (id) o += `<image l:href="#${id}"/>`;
      }
      else if (t === 'script' || t === 'style') continue;
      else o += await inner();
    }
    return o;
  }
  // абзац → один или несколько <p> (перенос строки <br> делит абзац)
  const paras = async (el, from, cls) => {
    let s = await inline(el, from); const out = [];
    for (const line of s.split('\n')) { const l = line.replace(/^\s+|\s+$/g, ''); if (l) out.push(`<p>${l}</p>`); }
    return out.join('');
  };
  const onlyImage = async (el, from) => { // абзац с одной картинкой → блок-картинка
    const im = el.querySelectorAll('img, image'); if (im.length !== 1 || el.textContent.trim()) return '';
    const src = im[0].getAttribute('src') || im[0].getAttribute('href') || im[0].getAttribute('xlink:href'); const id = src && await useImg(resolve(from, src)); return id ? `<image l:href="#${id}"/>` : '';
  };

  async function blocks(el, from, st) {
    let o = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t) o += `<p>${X(t)}</p>`; continue; }
      if (n.nodeType !== 1) continue;
      const t = n.localName.toLowerCase();
      if (['script', 'style', 'head', 'nav'].includes(t)) continue;
      if (noteEl(n) && !isNoteDoc(from)) continue;
      if (/^h[1-6]$/.test(t)) {
        const label = n.textContent.replace(/\s+/g, ' ').trim(); if (!label) continue;
        if (!st.titled) { st.titled = true; st.title = label; } else o += `<subtitle>${X(label)}</subtitle>`;
      }
      else if (t === 'p') { o += (await onlyImage(n, from)) || await paras(n, from); }
      else if (t === 'img' || t === 'image' || t === 'svg') { const s = await inline({ childNodes: [n] }, from); if (s) o += s.startsWith('<image') ? s : `<p>${s}</p>`; }
      else if (t === 'blockquote') { const i = await blocks(n, from, { titled: true }); if (i) o += `<cite>${i}</cite>`; }
      else if (t === 'ul' || t === 'ol') { let k = 0; for (const li of n.children) { if (li.localName !== 'li') continue; const s = await paras(li, from); if (s) o += s.replace(/^<p>/, `<p>${t === 'ol' ? ++k + '. ' : '• '}`); } }
      else if (t === 'pre') { for (const l of n.textContent.split('\n')) o += l.trim() ? `<p>${X(l)}</p>` : '<empty-line/>'; }
      else if (t === 'hr') o += '<empty-line/>';
      else if (t === 'table') { let tb = '<table>'; for (const tr of n.querySelectorAll('tr')) { tb += '<tr>'; for (const c of tr.children) { const tg = c.localName === 'th' ? 'th' : 'td'; tb += `<${tg}>${(await inline(c, from)).replace(/\n/g, ' ').trim()}</${tg}>`; } tb += '</tr>'; } o += tb + '</table>'; }
      else if (['div', 'section', 'article', 'body', 'main', 'figure', 'span', 'aside', 'dl', 'dd', 'dt', 'figcaption', 'center', 'font'].includes(t)) {
        const hasBlock = n.querySelector('p,div,h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote,img,pre');
        if (hasBlock) o += await blocks(n, from, st); else { const s = (await onlyImage(n, from)) || await paras(n, from); o += s; }
      }
      else { const s = await paras(n, from); o += s; }
    }
    return o;
  }

  let secs = '';
  for (const { path, d } of docs) {
    if (isNoteDoc(path)) continue;
    const body = d.querySelector('body') || d.documentElement; const st = { titled: false, title: '' };
    const inner = await blocks(body, path, st);
    if (!inner.trim() && !st.title) continue;
    if (inner.replace(/<image [^>]*\/>/g, '').trim() === '' && coverId && /cover|titlepage/i.test(path)) continue; // страница-обложка
    secs += `<section>${st.title ? `<title><p>${X(st.title)}</p></title>` : ''}${inner || '<p> </p>'}</section>`;
  }
  if (!secs) throw new Error('в EPUB не нашлось текста');
  let notesXml = '';
  for (const id of noteOrder) if (usedNotes.has(id)) notesXml += `<section id="n_${X(id)}"><title><p>${X(id.replace(/^\D+/, '') || '*')}</p></title><p>${X(noteText[id])}</p></section>`;
  const desc = dc('description')[0];
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>prose</genre>${authors}<book-title>${X(title)}</book-title>${desc ? `<annotation><p>${X(desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())}</p></annotation>` : ''}<lang>${X(lang.slice(0, 2))}</lang>${coverId ? `<coverpage><image l:href="#${coverId}"/></coverpage>` : ''}</title-info><document-info><author><nickname>Пинакес</nickname></author><program-used>Пинакес</program-used><date value="${new Date().toISOString().slice(0, 10)}">${new Date().toISOString().slice(0, 10)}</date><id>${uuid4()}</id><version>1.0</version></document-info></description><body><title><p>${X(title)}</p></title>${secs}</body>${notesXml ? `<body name="notes"><title><p>Примечания</p></title>${notesXml}</body>` : ''}${bins.map(b => `<binary id="${b.id}" content-type="${b.mime}">\n${wrap76(b.b64)}\n</binary>`).join('')}</FictionBook>`;
  return new TextEncoder().encode(xml);
}

// convertBook: из имеющегося формата книги получить недостающий
async function convertFormat(b, to) {
  const from = to === 'epub' ? 'fb2' : 'epub';
  if (!b.formats[from]) throw new Error('нет исходного формата ' + from.toUpperCase());
  const src = new Uint8Array(await pin.readFormat({ id: b.id, fmt: from }));
  return to === 'epub' ? await fb2ToEpub(src) : await epubToFb2(src);
}
