// FB2 → HTML для чтения
async function fb2ToDom(bytes) {
  const doc = parseXml(await decodeXml(bytes));
  const bin = {};
  doc.querySelectorAll('binary').forEach(b => { bin[b.getAttribute('id')] = `data:${b.getAttribute('content-type') || 'image/jpeg'};base64,${b.textContent.replace(/\s+/g, '')}`; });
  const toc = []; let secN = 0;
  const hrefOf = e => { const a = [...e.attributes].find(a => /href$/.test(a.name)); return a ? a.value : ''; };

  function inline(node, parent) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { parent.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.localName; let el;
      if (t === 'strong') el = document.createElement('b');
      else if (t === 'emphasis') el = document.createElement('i');
      else if (t === 'strikethrough') el = document.createElement('s');
      else if (t === 'sub' || t === 'sup' || t === 'code') el = document.createElement(t);
      else if (t === 'a') { el = document.createElement('a'); const h = hrefOf(n); if (h.startsWith('#')) el.dataset.note = h.slice(1); }
      else if (t === 'image') { el = document.createElement('img'); const s = bin[hrefOf(n).replace(/^#/, '')]; if (s) el.src = s; }
      else el = document.createElement('span');
      inline(n, el); parent.appendChild(el);
    }
  }
  const P = (n, cls) => { const p = document.createElement('p'); if (cls) p.className = cls; inline(n, p); return p; };

  function block(n, parent, depth) {
    const t = n.localName;
    if (t === 'section') {
      const s = document.createElement('section');
      for (const c of n.children) block(c, s, depth + 1);
      parent.appendChild(s);
    } else if (t === 'title') {
      const h = document.createElement(depth <= 1 ? 'h2' : 'h3'); h.id = 'sec' + (secN++);
      h.textContent = [...n.querySelectorAll('p')].map(p => p.textContent.trim()).join(' ');
      if (depth <= 2) toc.push({ id: h.id, label: h.textContent, lvl: depth <= 1 ? 1 : 2 });
      parent.appendChild(h);
    } else if (t === 'subtitle') { const h = document.createElement('h4'); inline(n, h); parent.appendChild(h); }
    else if (t === 'p') parent.appendChild(P(n));
    else if (t === 'empty-line') parent.appendChild(document.createElement('br'));
    else if (t === 'epigraph') { const d = document.createElement('div'); d.className = 'epigraph'; for (const c of n.children) block(c, d, depth); parent.appendChild(d); }
    else if (t === 'cite') { const d = document.createElement('div'); d.className = 'cite'; for (const c of n.children) block(c, d, depth); parent.appendChild(d); }
    else if (t === 'poem') { const d = document.createElement('div'); d.className = 'poem'; for (const c of n.children) block(c, d, depth); parent.appendChild(d); }
    else if (t === 'stanza') { const d = document.createElement('div'); d.className = 'stanza'; for (const c of n.children) block(c, d, depth); parent.appendChild(d); }
    else if (t === 'v') parent.appendChild(P(n, 'ni'));
    else if (t === 'text-author') parent.appendChild(P(n, 'ta'));
    else if (t === 'image') { const img = document.createElement('img'); const s = bin[hrefOf(n).replace(/^#/, '')]; if (s) { img.src = s; parent.appendChild(img); } }
    else if (t === 'table') { const d = document.createElement('div'); inline(n, d); parent.appendChild(d); }
  }

  const root = document.createElement('div'); root.className = 'fb2';
  const ti = doc.querySelector('description > title-info');
  const text = s => ((ti && ti.querySelector(s)) || {}).textContent || '';
  const cp = ti && ti.querySelector('coverpage image');
  if (cp && bin[hrefOf(cp).replace(/^#/, '')]) { const i = document.createElement('img'); i.className = 'cov'; i.src = bin[hrefOf(cp).replace(/^#/, '')]; root.appendChild(i); }
  const h1 = document.createElement('h1'); h1.textContent = text('book-title').trim(); root.appendChild(h1);
  const au = document.createElement('div'); au.className = 'au';
  au.textContent = [...(ti ? ti.querySelectorAll('author') : [])].map(a => ['first-name', 'middle-name', 'last-name'].map(t => (a.querySelector(t) || {}).textContent || '').filter(Boolean).join(' ')).join(', ');
  root.appendChild(au);

  const notes = {};
  doc.querySelectorAll('body').forEach(body => {
    if ((body.getAttribute('name') || '') === 'notes') {
      const wrap = document.createElement('div'); wrap.className = 'notes'; const hh = document.createElement('h3'); hh.textContent = 'Примечания'; wrap.appendChild(hh);
      body.querySelectorAll('section').forEach(s => { const d = document.createElement('div'); d.id = 'note-' + s.getAttribute('id'); for (const c of s.children) block(c, d, 9); notes[s.getAttribute('id')] = d.textContent.trim(); wrap.appendChild(d); });
      root.appendChild(wrap);
    } else for (const c of body.children) block(c, root, 0);
  });
  // сноски по клику
  root.addEventListener('click', e => {
    const a = e.target.closest('a[data-note]'); if (!a) return;
    const el = root.querySelector('#note-' + CSS.escape(a.dataset.note)); if (el) el.scrollIntoView({ block: 'center' });
  });
  return { root, toc };
}
