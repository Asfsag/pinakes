// Читалка. EPUB и FB2 идут через общий движок со своими страницами (CSS-колонки) и режимами листания:
// «Лист» (бумажный лист), «Лента» (бесконечная прокрутка), «Слайд», «Карточка», «Затухание», «Без анимации». PDF — лента (pdf.js).
// Настройки (режим, тема, шрифт, размер, интервал, поля, выравнивание, яркость) запоминаются, место в книге сохраняется.
const Reader = (() => {
  const el = { root: $('#reader'), stage: $('#stage'), title: $('#rtitle'), toc: $('#toc'), slider: $('#rslider'), pct: $('#rpct'), sheet: $('#rsheet'), dim: $('#rdim') };
  let cur = null;
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const FONTS = {
    classic: ['Классика', 'Georgia,"Times New Roman","DejaVu Serif",serif'],
    garamond: ['Гарамон', '"Cormorant","Cormorant Garamond",Georgia,serif'],
    sans: ['Onest', '"Onest",system-ui,-apple-system,"Segoe UI",sans-serif'],
    system: ['Системный', '-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif'],
  };
  const THEMES = { day: ['День', '#f7f2e8', '#2a2118'], sepia: ['Сепия', '#e9d9b8', '#2b2014'], graphite: ['Графит', '#262a30', '#d2d6dc'], night: ['Ночь', '#120d09', '#cdbf9f'] };
  const MODES = { flip: 'Лист', scroll: 'Лента', slide: 'Слайд', card: 'Карточка', fade: 'Затухание', none: 'Без анимации' };
  const MARGINS = { narrow: 'Узкие', mid: 'Средние', wide: 'Широкие' };
  const DUR = { flip: 640, slide: 300, card: 320, fade: 260, none: 0 };
  const num = (k, d) => { const v = parseFloat(store.get(k, d)); return Number.isFinite(v) ? v : d; };
  const set = { mode: store.get('pin_mode', 'flip'), theme: store.get('pin_theme', 'sepia'), font: store.get('pin_font', 'classic'), fs: num('pin_fs', 19), lh: num('pin_lh', 1.62), mar: store.get('pin_mar', 'mid'), align: store.get('pin_align', 'justify'), dim: num('pin_dim', 0) };
  if (!MODES[set.mode]) set.mode = 'flip'; if (!THEMES[set.theme]) set.theme = 'sepia'; if (!FONTS[set.font]) set.font = 'classic'; if (!MARGINS[set.mar]) set.mar = 'mid';
  let zoom = num('pin_zoom', 1);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const div = c => { const d = document.createElement('div'); d.className = c; return d; };

  function applyVars() {
    Object.keys(THEMES).forEach(t => el.root.classList.toggle('t-' + t, t === set.theme));
    const s = el.root.style; s.setProperty('--fs', set.fs + 'px'); s.setProperty('--lh', String(set.lh)); s.setProperty('--rf', FONTS[set.font][1]); s.setProperty('--ta', set.align === 'justify' ? 'justify' : 'left');
    s.setProperty('--paper', THEMES[set.theme][1]); s.setProperty('--ink', THEMES[set.theme][2]);
    el.dim.style.opacity = String(set.dim / 100);
  }
  function save(k, v) { set[k] = v; store.set('pin_' + k, v); }

  function progress(p) {
    const pc = clamp(p.percent || 0); el.slider.value = Math.round(pc * 1000); el.pct.textContent = p.label || Math.round(pc * 100) + '%';
    if (cur && cur.onProgress) cur.onProgress({ fmt: cur.fmt, ...p, percent: pc });
  }

  async function open(book, fmt, hooks) {
    close(true);
    cur = { book, fmt, onProgress: hooks && hooks.onProgress };
    el.title.textContent = book.title + (book.author ? ' — ' + book.author : '');
    el.stage.innerHTML = '<div class="loading">Открываю…</div>';
    el.toc.classList.add('hide'); el.toc.innerHTML = ''; el.sheet.classList.add('hide'); el.slider.value = 0; el.pct.textContent = '';
    el.root.classList.remove('hide', 'nochrome'); applyVars();
    try {
      const bytes = new Uint8Array(await pin.readFormat({ id: book.id, fmt }));
      if (fmt === 'pdf') await openPdf(bytes);
      else if (fmt === 'fb2') await openText(await fb2ToDom(bytes));
      else {
        try { await openText(await fb2ToDom(await epubToFb2(bytes))); }      // EPUB → общий движок
        catch (e) { console.warn('EPUB через общий движок не вышел, открываю запасным способом', e); await openEpubLegacy(bytes); }
      }
    } catch (e) { el.stage.innerHTML = '<div class="loading">Не удалось открыть: ' + esc(e.message || e) + '</div>'; }
  }

  // ====================== общий движок: EPUB и FB2 ======================
  function buildChunks(root) {
    const MAX = 26000, out = []; let c = { html: '', len: 0 };
    const flush = () => { if (c.html) out.push(c); c = { html: '', len: 0 }; };
    const add = n => { c.html += n.outerHTML; c.len += n.textContent.length + 40; };
    const unit = n => {
      const len = n.textContent.length;
      if (len > MAX && n.children.length > 1 && !/^(TABLE|UL|OL)$/.test(n.tagName)) { for (const ch of n.children) unit(ch); return; }
      if (c.len && c.len + len > MAX) flush();
      add(n);
    };
    for (const n of root.children) {
      if (n.tagName === 'SECTION') { flush(); unit(n); }
      else if (n.classList.contains('notes')) { flush(); add(n); flush(); }
      else add(n);                                                    // обложка, заголовок, автор — на первую страницу
    }
    flush(); return out.length ? out : [{ html: '<p>Пусто</p>', len: 1 }];
  }

  async function openText({ root, toc }) {
    const chunks = buildChunks(root);
    const total = Math.max(1, chunks.reduce((s, c) => s + c.len, 0)); const cum = []; { let a = 0; chunks.forEach((c, i) => { cum[i] = a; a += c.len; }); }
    const idChunk = {}; chunks.forEach((c, i) => { for (const m of c.html.matchAll(/ id="([^"]+)"/g)) if (!(m[1] in idChunk)) idChunk[m[1]] = i; });
    const rd = div('rd'); rd.innerHTML = '<div class="measure"></div><div class="pagebox"></div><div class="scrollbox hide"></div><div class="notepop hide"></div>';
    el.stage.innerHTML = ''; el.stage.appendChild(rd);
    const measure = $('.measure', rd), pb = $('.pagebox', rd), sb = $('.scrollbox', rd), pop = $('.notepop', rd);
    const st = { c: 0, p: 0, pages: 1, W: 0, H: 0, view: null, busy: false, cache: new Map(), mode: '', sumLen: 0, sumPages: 0, counted: new Set() };
    const TOP = 56, BOT = 48;
    const noteText = id => { const n = root.querySelector('#note-' + CSS.escape(id)); return n ? n.textContent.trim() : ''; };
    const gfOf = () => {
      if (st.mode === 'scroll') { const m = sb.scrollHeight - sb.clientHeight; return m > 0 ? clamp(sb.scrollTop / m) : 0; }
      return clamp((cum[st.c] + (st.p / st.pages) * chunks[st.c].len) / total);
    };

    function layout() {
      const sw = el.stage.clientWidth, sh = el.stage.clientHeight;
      st.spread = sw >= 980 && sw / sh > 1.15;                                // на широком экране — разворот из двух страниц
      const big = sw > 700;
      const pad = st.spread ? { narrow: 30, mid: 46, wide: 72 }[set.mar] : big ? { narrow: 17, mid: 36, wide: 64 }[set.mar] : { narrow: 8, mid: 14, wide: 26 }[set.mar];
      st.pw = st.spread ? Math.min(Math.floor((sw - 40) / 2), 700) : big ? Math.min(sw, 780 + pad * 2) : sw;   // страница — на всю ширину на телефоне
      st.W = st.spread ? st.pw * 2 : st.pw; st.H = sh; st.pad = pad;
      st.fw = Math.max(160, st.pw - pad * 2); st.fh = Math.max(240, sh - TOP - BOT);
      pb.style.cssText = `left:${Math.round((sw - st.W) / 2)}px;top:0;width:${st.W}px;height:${st.H}px`;
      sb.style.setProperty('--sx', Math.max(pad, 10) + 'px'); sb.style.setProperty('--sw', Math.min(sw, 780 + pad * 2) + 'px');
      st.cache.clear(); st.counted.clear(); st.sumLen = st.sumPages = 0; measure.innerHTML = '';
    }
    const flowEl = c => { const f = div('tr flow'); f.lang = 'ru'; f.style.cssText = `width:${st.fw}px;height:${st.fh}px;column-width:${st.fw}px`; f.innerHTML = chunks[c].html; return f; };
    function pagesOf(c) {
      if (st.cache.has(c)) return st.cache.get(c);
      const f = flowEl(c); measure.appendChild(f); const n = Math.max(1, Math.ceil((f.scrollWidth - 2) / st.fw)); measure.removeChild(f); st.cache.set(c, n);
      if (chunks[c].len > 4000 && !st.counted.has(c)) { st.counted.add(c); st.sumLen += chunks[c].len; st.sumPages += n; }   // для оценки общего числа страниц
      return n;
    }
    const adj = (pos, dir) => {
      if (!pos) return null; let c = pos.c, p = pos.p + dir; if (p >= 0 && p < pagesOf(c)) return { c, p };
      c += dir; if (c < 0 || c >= chunks.length) return null; const n = pagesOf(c); return { c, p: dir > 0 ? 0 : n - 1 };
    };
    // одна страница (pos == null — пустая); x — левый край внутри рамки; side — у какого края корешок (l/r) для тени разворота
    function pageEl(pos, x, side) {
      const v = div('pv'); v.style.cssText = `left:${x}px;width:${st.pw}px;height:${st.H}px`;
      if (pos) { const k = div(''); k.style.cssText = `position:absolute;left:${st.pad}px;top:${TOP}px;width:${st.fw}px;height:${st.fh}px;overflow:hidden`; const f = flowEl(pos.c); f.style.transform = `translateX(${-pos.p * st.fw}px)`; k.appendChild(f); v.appendChild(k); }
      if (side) { const e = div('edge ' + side); v.appendChild(e); }
      return v;
    }
    function makeView(c, p) {
      const L = { c, p };
      if (!st.spread) return pageEl(L, 0);
      const v = div('pv'); v.style.cssText = `width:${st.W}px;height:${st.H}px`; v.append(pageEl(L, 0, 'r'), pageEl(adj(L, 1), st.pw, 'l')); return v;
    }
    const resetView = v => { v.style.transform = ''; v.style.opacity = ''; v.style.boxShadow = ''; v.style.background = ''; };

    function show(c, p) {
      st.c = clamp(c, 0, chunks.length - 1); st.pages = pagesOf(st.c); st.p = clamp(p, 0, st.pages - 1);
      st.view = makeView(st.c, st.p); pb.style.overflow = ''; pb.replaceChildren(st.view); ui();
    }
    function gotoGF(gf) {
      gf = clamp(gf); if (st.mode === 'scroll') { const m = sb.scrollHeight - sb.clientHeight; sb.scrollTop = gf * m; return; }
      const pos = gf * total; let c = 0; while (c < chunks.length - 1 && cum[c + 1] <= pos) c++;
      const frac = chunks[c].len ? clamp((pos - cum[c]) / chunks[c].len, 0, 0.9999) : 0; const n = pagesOf(c); show(c, Math.floor(frac * n));
    }
    function gotoId(id) {
      const c = idChunk[id]; if (c === undefined) return;
      if (st.mode === 'scroll') { const h = sb.querySelector('#' + CSS.escape(id)); if (h) sb.scrollTop = h.offsetTop - 70; return; }
      const f = flowEl(c); measure.appendChild(f); const e = f.querySelector('#' + CSS.escape(id)); const page = e ? Math.floor(e.offsetLeft / st.fw) : 0; measure.removeChild(f); show(c, page);
    }

    // ---------- интерфейс: ползунок и подпись ----------
    function ui() {
      const gf = gfOf(); let label = Math.round(gf * 100) + '%';
      if (st.mode !== 'scroll') { const avg = (st.sumPages ? st.sumLen / st.sumPages : (st.fw * st.fh) / (0.5 * set.fs * set.fs * set.lh)) || 1, tp = Math.max(1, Math.round(total / avg)); label = `${Math.min(tp, Math.round(gf * tp) + 1)} / ${tp} · ${Math.round(gf * 100)}%`; }
      progress({ percent: gf, label });
    }

    // ---------- перелистывание ----------
    function target(dir) {
      const cur = { c: st.c, p: st.p };
      if (!st.spread) return adj(cur, dir);
      if (dir > 0) { const r = adj(cur, 1); return r && adj(r, 1); }
      const a = adj(cur, -1); return a && (adj(a, -1) || a);       // назад на разворот (две страницы)
    }
    function beginTurn(dir) {
      const t = target(dir); if (!t) return null;
      const W = st.W, H = st.H, mode = set.mode, curV = st.view, T = { t, dir };
      if (mode === 'flip') {
        // Сгиб страницы: лист переворачивается справа налево; на подвёрнутой части — обратная сторона (на развороте — страница с текстом)
        const sp = st.spread, cL = { c: st.c, p: st.p }, cR = sp ? adj(cL, 1) : null, nL = { c: t.c, p: t.p }, nR = sp ? adj(nL, 1) : null, ox = sp ? st.pw : 0;
        let baseL, baseR, fr, bk;
        if (!sp) { baseR = dir > 0 ? t : cL; fr = dir > 0 ? cL : t; bk = null; }
        else if (dir > 0) { baseL = cL; baseR = nR; fr = cR; bk = nL; }
        else { baseL = nL; baseR = cR; fr = nR; bk = cL; }
        const under = div('pv'); under.style.cssText = `width:${W}px;height:${H}px`;
        if (sp) under.append(pageEl(baseL, 0, 'r'), pageEl(baseR, ox, 'l')); else under.appendChild(pageEl(baseR, 0));
        const F = makeFold(st.pw, H, ox, pageEl(fr, 0, sp ? 'l' : null), bk ? pageEl(bk, 0, 'r') : null);
        if (!bk) {                                                  // на одной странице: на обороте листа просвечивает его же текст (зеркально), как у настоящей бумаги
          const gh = div('flap-back ghost'), w = div(''); w.style.cssText = 'position:absolute;inset:0;transform:scaleX(-1)'; w.appendChild(pageEl(dir > 0 ? cL : t, 0)); gh.appendChild(w);
          F.flap.firstChild.insertBefore(gh, F.flap.firstChild.firstChild);
        }
        pb.replaceChildren(under, F.under, F.front, F.flap);
        T.set = pp => F.set(dir > 0 ? pp : 1 - pp, sp);
        T.commit = () => { const v = makeView(t.c, t.p); pb.replaceChildren(v); st.view = v; };
        T.cancel = () => { pb.replaceChildren(curV); st.view = curV; };
      } else if (mode === 'slide') {
        const o = makeView(t.c, t.p); pb.style.overflow = 'hidden'; pb.appendChild(o);
        T.set = p => { if (dir > 0) { curV.style.transform = `translateX(${-p * W}px)`; o.style.transform = `translateX(${(1 - p) * W}px)`; } else { o.style.transform = `translateX(${-(1 - p) * W}px)`; curV.style.transform = `translateX(${p * W}px)`; } };
        T.commit = () => { pb.replaceChildren(o); resetView(o); st.view = o; };
        T.cancel = () => { pb.replaceChildren(curV); resetView(curV); };
      } else if (mode === 'card') {
        const o = makeView(t.c, t.p), top = dir > 0 ? curV : o, bottom = dir > 0 ? o : curV;
        top.style.background = 'var(--paper)'; top.style.boxShadow = '0 0 34px rgba(0,0,0,.55)'; pb.replaceChildren(bottom, top);
        T.set = p => { if (dir > 0) { curV.style.transform = `translateX(${-p * W}px)`; o.style.transform = `scale(${.94 + .06 * p})`; o.style.opacity = String(.55 + .45 * p); } else { o.style.transform = `translateX(${-(1 - p) * W}px)`; curV.style.transform = `scale(${1 - .06 * p})`; curV.style.opacity = String(1 - .45 * p); } };
        T.commit = () => { pb.replaceChildren(o); resetView(o); st.view = o; };
        T.cancel = () => { pb.replaceChildren(curV); resetView(curV); };
      } else {   // fade / none
        const o = makeView(t.c, t.p); o.style.opacity = '0'; o.style.background = 'var(--paper)'; pb.appendChild(o);
        T.set = p => { o.style.opacity = String(p); };
        T.commit = () => { pb.replaceChildren(o); resetView(o); st.view = o; };
        T.cancel = () => { pb.replaceChildren(curV); st.view = curV; };
      }
      T.set(0); return T;
    }
    const ease = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    const tween = (T, a, b, ms) => new Promise(res => {
      if (ms <= 0 || a === b) { T.set(b); res(); return; }
      const t0 = performance.now(); const step = now => { const k = clamp((now - t0) / ms); T.set(a + (b - a) * ease(k)); k < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step);
    });
    function endTurn(T) { st.c = T.t.c; st.p = T.t.p; st.pages = pagesOf(st.c); st.busy = false; pb.style.overflow = ''; ui(); if (el.sheet.classList.contains('hide')) el.root.classList.add('nochrome'); }
    async function go(dir) {
      if (st.busy) return;
      if (st.mode === 'scroll') { sb.scrollBy({ top: dir * sb.clientHeight * 0.88, behavior: 'smooth' }); return; }
      const T = beginTurn(dir); if (!T) { toast(dir > 0 ? 'Это конец книги' : 'Это начало книги', 1600); return; }
      st.busy = true; await tween(T, 0, 1, DUR[set.mode]); T.commit(); endTurn(T);
    }

    // ---------- жесты: свайп, касание краёв, клавиши ----------
    let drag = null;
    const toggleChrome = () => el.root.classList.toggle('nochrome');
    rd.addEventListener('pointerdown', e => {
      if (st.mode === 'scroll' || (e.pointerType === 'mouse' && e.button) || e.target.closest('.notepop')) return;
      pop.classList.add('hide'); drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, T: null, dir: 0, p: 0, lp: 0, lt: performance.now(), v: 0, fail: false, a: e.target };
    });
    rd.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x0;
      if (!drag.T && !drag.fail) {
        if (Math.abs(dx) < 9 || Math.abs(dx) < Math.abs(e.clientY - drag.y0)) return;
        if (st.busy) { drag = null; return; }
        drag.dir = dx < 0 ? 1 : -1; drag.T = beginTurn(drag.dir); if (!drag.T) { drag.fail = true; toast(drag.dir > 0 ? 'Это конец книги' : 'Это начало книги', 1400); return; }
        st.busy = true; try { rd.setPointerCapture(e.pointerId); } catch {}
      }
      if (drag.T) {
        const span = (set.mode === 'flip' ? st.pw : st.W) * (set.mode === 'flip' ? .85 : 1); const p = clamp((drag.dir > 0 ? -dx : dx) / span); const now = performance.now();
        drag.v = (p - drag.lp) / Math.max(1, now - drag.lt); drag.lp = p; drag.lt = now; drag.p = p; drag.T.set(p);
      }
    });
    const release = async e => {
      if (!drag || (e && e.pointerId !== drag.id)) return; const d = drag; drag = null;
      if (d.T) {
        const done = d.p > .3 || d.v > .0016; await tween(d.T, d.p, done ? 1 : 0, Math.max(120, (done ? 1 - d.p : d.p) * DUR[set.mode] * 1.2));
        if (done) { d.T.commit(); endTurn(d.T); } else { d.T.cancel(); st.busy = false; pb.style.overflow = ''; }
      } else if (!d.fail && e) {
        const a = d.a && d.a.closest ? d.a.closest('a[data-note]') : null;
        if (a) { const t = noteText(a.dataset.note); if (t) { pop.textContent = t; pop.classList.remove('hide'); } return; }
        if (!el.sheet.classList.contains('hide') || !el.toc.classList.contains('hide')) { el.sheet.classList.add('hide'); el.toc.classList.add('hide'); return; }
        const r = rd.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
        if (x < .3) go(-1); else if (x > .7) go(1); else toggleChrome();
      }
    };
    rd.addEventListener('pointerup', release); rd.addEventListener('pointercancel', () => release(null));
    let wl = 0; rd.addEventListener('wheel', e => { if (st.mode === 'scroll') return; e.preventDefault(); const n = performance.now(); if (n - wl < 380 || Math.abs(e.deltaY) < 4) return; wl = n; go(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    sb.addEventListener('click', e => {
      const a = e.target.closest('a[data-note]'); if (a) { const t = noteText(a.dataset.note); if (t) { pop.textContent = t; pop.classList.remove('hide'); } return; }
      pop.classList.add('hide'); const r = sb.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      if (x < .22) go(-1); else if (x > .78) go(1); else toggleChrome();
    });
    let stm; sb.addEventListener('scroll', () => { clearTimeout(stm); stm = setTimeout(ui, 100); });

    // ---------- режимы, раскладка ----------
    function enter(gf) {
      st.mode = set.mode; st.busy = false; applyVars(); layout();
      if (st.mode === 'scroll') {
        pb.classList.add('hide'); pb.replaceChildren(); sb.classList.remove('hide'); sb.innerHTML = ''; root.classList.add('tr'); root.lang = 'ru'; sb.appendChild(root);
        const restore = () => { const m = sb.scrollHeight - sb.clientHeight; if (m > 0) sb.scrollTop = gf * m; ui(); }; restore(); setTimeout(restore, 350);
        root.querySelectorAll('img').forEach(i => i.addEventListener('load', restore, { once: true }));
      } else {
        sb.classList.add('hide'); sb.innerHTML = ''; pb.classList.remove('hide'); gotoGF(gf);
      }
    }
    let rt = 0; const relayout = () => { if (st.busy) return; const gf = gfOf(); clearTimeout(rt); rt = setTimeout(() => enter(gf), 90); };

    // ---------- оглавление, управление ----------
    el.toc.innerHTML = ''; toc.forEach(t => { const a = document.createElement('a'); a.textContent = t.label; if (t.lvl > 1) a.className = 'l2'; a.onclick = () => { gotoId(t.id); el.toc.classList.add('hide'); }; el.toc.appendChild(a); });
    cur.relayout = relayout; cur.next = () => go(1); cur.prev = () => go(-1); cur.goto = gf => gotoGF(gf);
    cur.applyTheme = () => applyVars();
    cur.onSettings = k => { if (k === 'mode') { const gf = gfOf(); enter(gf); } else if (['font', 'fs', 'lh', 'mar', 'align'].includes(k)) relayout(); else applyVars(); };
    const ro = new ResizeObserver(() => { if (cur && cur.relayout && Math.abs(el.stage.clientWidth - (st.sw || 0)) + Math.abs(el.stage.clientHeight - (st.sh || 0)) > 2) { st.sw = el.stage.clientWidth; st.sh = el.stage.clientHeight; relayout(); } }); ro.observe(el.stage);
    cur.destroy = () => { try { ro.disconnect(); } catch {} clearTimeout(rt); };

    // стартовая позиция: сохранённая (доля книги), иначе начало
    const pr = cur.book.progress; const start = pr && pr.percent && pr.fmt === cur.fmt ? clamp(pr.percent) : 0;
    st.sw = el.stage.clientWidth; st.sh = el.stage.clientHeight;
    await new Promise(r => requestAnimationFrame(r)); enter(start);
    if (!start) { el.root.classList.remove('nochrome'); }
  }

  // ====================== запасной путь для EPUB: epub.js ======================
  async function openEpubLegacy(bytes) {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); const bk = ePub(ab);
    el.stage.innerHTML = '<div class="epub"><div class="nav l">‹</div><div class="view" id="epubview"></div><div class="nav r">›</div></div>';
    const rend = bk.renderTo($('#epubview'), { width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false }); let ready = false;
    const apply = () => { rend.themes.override('color', THEMES[set.theme][2]); rend.themes.override('background', THEMES[set.theme][1]); rend.themes.override('font-family', FONTS[set.font][1]); rend.themes.override('line-height', String(set.lh)); rend.themes.fontSize(set.fs + 'px'); };
    cur.applyTheme = () => { applyVars(); apply(); }; cur.onSettings = () => { applyVars(); apply(); }; cur.prev = () => rend.prev(); cur.next = () => rend.next();
    rend.hooks.content.register(c => { const d = c.document; if (!d.documentElement.getAttribute('lang')) d.documentElement.setAttribute('lang', 'ru'); const s = d.createElement('style'); s.textContent = 'p{text-align:justify;hyphens:auto} img{max-width:100%!important;height:auto!important} a{color:inherit}'; d.head.appendChild(s); });
    rend.on('relocated', loc => progress({ percent: ready ? bk.locations.percentageFromCfi(loc.start.cfi) : (loc.start.percentage || 0), cfi: loc.start.cfi }));
    $('.nav.l', el.stage).onclick = () => rend.prev(); $('.nav.r', el.stage).onclick = () => rend.next();
    bk.loaded.navigation.then(nav => { el.toc.innerHTML = ''; const walk = (items, l) => items.forEach(it => { const a = document.createElement('a'); a.textContent = (it.label || '').trim(); if (l > 1) a.className = 'l2'; a.onclick = () => { rend.display(it.href); el.toc.classList.add('hide'); }; el.toc.appendChild(a); if (it.subitems) walk(it.subitems, l + 1); }); walk(nav.toc, 1); }).catch(() => {});
    apply(); await rend.display(undefined); apply();
    bk.ready.then(() => bk.locations.generate(1000)).then(() => { ready = true; }).catch(() => {});
    cur.destroy = () => { try { rend.destroy(); bk.destroy(); } catch {} };
  }

  // ====================== PDF ======================
  async function openPdf(bytes) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const sc = div('scroll'); const wrap = div('pdfwrap'); sc.appendChild(wrap);
    el.stage.innerHTML = ''; el.stage.appendChild(sc);
    const p1 = await pdf.getPage(1); const v1 = p1.getViewport({ scale: 1 });
    let pages = [], obs = null, tasks = new Map();
    const build = () => {
      if (obs) obs.disconnect(); tasks.forEach(t => { try { t.cancel(); } catch {} }); tasks.clear(); wrap.innerHTML = ''; pages = [];
      const w = Math.min(sc.clientWidth - 40, 880) * zoom, scale = w / v1.width, h = v1.height * scale;
      obs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) render(e.target); }), { root: sc, rootMargin: '900px 0px' });
      for (let i = 1; i <= pdf.numPages; i++) { const d = div('pdfpage'); d.dataset.n = i; d.style.width = w + 'px'; d.style.height = h + 'px'; wrap.appendChild(d); pages.push(d); obs.observe(d); }
    };
    async function render(d) {
      if (d.dataset.done) return; d.dataset.done = '1';
      const page = await pdf.getPage(+d.dataset.n); const scale = parseFloat(d.style.width) / page.getViewport({ scale: 1 }).width;
      const dpr = Math.min(2, window.devicePixelRatio || 1), vp = page.getViewport({ scale: scale * dpr });
      const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height); d.style.height = (vp.height / dpr) + 'px';
      const t = page.render({ canvasContext: c.getContext('2d'), viewport: vp }); tasks.set(d, t); try { await t.promise; d.appendChild(c); } catch {}
    }
    const curPage = () => { const y = sc.scrollTop + sc.clientHeight / 3; let n = 1; for (const p of pages) { if (p.offsetTop <= y) n = +p.dataset.n; else break; } return n; };
    const goPage = n => { const p = pages[n - 1]; if (p) sc.scrollTop = p.offsetTop - 16; };
    const upd = () => { const n = curPage(); progress({ percent: n / pdf.numPages, page: n, label: `Стр. ${n} из ${pdf.numPages}` }); };
    cur.zoomBy = d => { zoom = clamp(+(zoom + d).toFixed(2), 0.5, 2.4); store.set('pin_zoom', zoom); const pg = curPage(); build(); goPage(pg); };
    cur.applyTheme = () => applyVars(); cur.onSettings = () => applyVars();
    cur.prev = () => sc.scrollBy({ top: -sc.clientHeight * 0.9 }); cur.next = () => sc.scrollBy({ top: sc.clientHeight * 0.9 });
    cur.goto = gf => goPage(Math.max(1, Math.round(gf * pdf.numPages)));
    build(); const pr = cur.book.progress; if (pr && pr.fmt === 'pdf' && pr.page) setTimeout(() => goPage(pr.page), 60);
    let tm; sc.addEventListener('scroll', () => { clearTimeout(tm); tm = setTimeout(upd, 120); }); setTimeout(upd, 150);
    sc.addEventListener('click', e => { const r = sc.getBoundingClientRect(), x = (e.clientX - r.left) / r.width; if (x > .3 && x < .7) el.root.classList.toggle('nochrome'); });
    pdf.getOutline().then(async out => {
      if (!out || !out.length) return; el.toc.innerHTML = '';
      const walk = async (items, l) => { for (const it of items) { const a = document.createElement('a'); a.textContent = it.title; if (l > 1) a.className = 'l2'; a.onclick = async () => { try { const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest; const idx = await pdf.getPageIndex(dest[0]); goPage(idx + 1); } catch {} el.toc.classList.add('hide'); }; el.toc.appendChild(a); if (it.items && it.items.length) await walk(it.items, l + 1); } };
      walk(out, 1);
    }).catch(() => {});
    const onResize = () => build(); window.addEventListener('resize', onResize);
    cur.destroy = () => { window.removeEventListener('resize', onResize); if (obs) obs.disconnect(); tasks.forEach(t => { try { t.cancel(); } catch {} }); try { pdf.destroy(); } catch {} };
  }

  // ====================== настройки чтения ======================
  function buildSheet() {
    const pdf = cur && cur.fmt === 'pdf', chips = (key, obj, val) => Object.entries(obj).map(([k, v]) => `<button class="ch ${val === k ? 'on' : ''}" data-k="${key}" data-v="${k}">${esc(Array.isArray(v) ? v[0] : v)}</button>`).join('');
    const font = Object.entries(FONTS).map(([k, v]) => `<button class="ch ${set.font === k ? 'on' : ''}" data-k="font" data-v="${k}" style="font-family:${v[1].replace(/"/g, '&quot;')}">${v[0]}</button>`).join('');
    const themes = Object.entries(THEMES).map(([k, v]) => `<button data-k="theme" data-v="${k}" class="${set.theme === k ? 'on' : ''}" style="background:${v[1]};color:${v[2]}">${v[0]}</button>`).join('');
    el.sheet.innerHTML = `
      ${pdf ? '' : `<h4>Перелистывание</h4><div class="chips">${chips('mode', MODES, set.mode)}</div>`}
      <h4>Тема</h4><div class="thm">${themes}</div>
      ${pdf ? `<h4>Масштаб</h4><div class="chips"><button class="ch" data-z="-0.15">Меньше</button><button class="ch" data-z="0.15">Больше</button></div>` : `
      <h4>Шрифт</h4><div class="chips">${font}</div>
      <h4>Размер текста</h4><div class="row2"><input type="range" min="13" max="34" step="1" value="${set.fs}" data-r="fs"><span id="v-fs">${set.fs}</span></div>
      <h4>Межстрочный интервал</h4><div class="row2"><input type="range" min="1.2" max="2.2" step="0.05" value="${set.lh}" data-r="lh"><span id="v-lh">${set.lh.toFixed(2)}</span></div>
      <h4>Поля</h4><div class="chips">${chips('mar', MARGINS, set.mar)}</div>
      <h4>Выравнивание</h4><div class="chips">${chips('align', { justify: 'По ширине', left: 'По левому краю' }, set.align)}</div>`}
      <h4>Яркость (затемнение)</h4><div class="row2"><input type="range" min="0" max="60" step="2" value="${set.dim}" data-r="dim"><span id="v-dim">${set.dim}%</span></div>
      <button class="close" id="rsclose">Готово</button>`;
    $$('[data-k]', el.sheet).forEach(b => b.onclick = () => { const k = b.dataset.k, v = b.dataset.v; save(k, v); $$(`[data-k="${k}"]`, el.sheet).forEach(x => x.classList.toggle('on', x.dataset.v === v)); if (cur && cur.onSettings) cur.onSettings(k); else applyVars(); });
    $$('[data-r]', el.sheet).forEach(r => r.oninput = () => {
      const k = r.dataset.r, v = parseFloat(r.value); save(k, v); const lab = $('#v-' + k, el.sheet); if (lab) lab.textContent = k === 'lh' ? v.toFixed(2) : k === 'dim' ? v + '%' : v;
      if (k === 'dim') applyVars(); else if (cur && cur.onSettings) cur.onSettings(k);
    });
    $$('[data-z]', el.sheet).forEach(b => b.onclick = () => cur && cur.zoomBy && cur.zoomBy(parseFloat(b.dataset.z)));
    $('#rsclose', el.sheet).onclick = () => el.sheet.classList.add('hide');
  }

  function close(silent) {
    if (!cur) { if (!silent) el.root.classList.add('hide'); return; }
    try { cur.destroy && cur.destroy(); } catch {}
    cur = null; el.stage.innerHTML = ''; el.sheet.classList.add('hide');
    if (!silent) el.root.classList.add('hide');
  }
  const isOpen = () => !el.root.classList.contains('hide');
  // кнопка «Назад» / Esc: закрывает по очереди настройки, оглавление, читалку; true — если что-то закрыли
  function back() {
    if (!isOpen()) return false;
    if (!el.sheet.classList.contains('hide')) { el.sheet.classList.add('hide'); return true; }
    if (!el.toc.classList.contains('hide')) { el.toc.classList.add('hide'); return true; }
    close(); return true;
  }

  $('#rclose').onclick = () => { close(); };
  $('#rtoc').onclick = () => { el.sheet.classList.add('hide'); if (el.toc.children.length) el.toc.classList.toggle('hide'); else toast('В этой книге нет оглавления'); };
  $('#rset').onclick = () => { el.toc.classList.add('hide'); if (el.sheet.classList.contains('hide')) { buildSheet(); el.sheet.classList.remove('hide'); } else el.sheet.classList.add('hide'); };
  el.slider.addEventListener('input', () => { el.pct.textContent = Math.round(el.slider.value / 10) + '%'; });
  el.slider.addEventListener('change', () => { if (cur && cur.goto) cur.goto(el.slider.value / 1000); });
  document.addEventListener('keydown', e => {
    if (!isOpen() || !cur || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' && !e.shiftKey) { cur.next && cur.next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { cur.prev && cur.prev(); e.preventDefault(); }
  });
  el.stage.addEventListener('click', e => { if (!e.target.closest('#toc')) el.toc.classList.add('hide'); });
  return { open, close, isOpen, back, current: () => cur && cur.book };
})();
