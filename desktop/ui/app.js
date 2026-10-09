// Пинакес: книжная полка
const DEF_DIR = { added: 'desc', read: 'desc', progress: 'desc', author: 'asc', title: 'asc' };   // «естественный» порядок для каждой сортировки
const SORT_TEXT = {
  added: { desc: 'сначала новые', asc: 'сначала старые' },
  read: { desc: 'недавно читал сверху', asc: 'давно не открывал сверху' },
  progress: { desc: 'больше прочитано сверху', asc: 'меньше прочитано сверху' },
  author: { asc: 'авторы А → Я', desc: 'авторы Я → А' },
  title: { asc: 'названия А → Я', desc: 'названия Я → А' },
};
const S = { books: [], q: '', sort: localStorage.getItem('pin_sort') || 'added', dir: localStorage.getItem('pin_dir') || '', root: null, busy: false };
if (!SORT_TEXT[S.sort]) S.sort = 'added';
if (S.dir !== 'asc' && S.dir !== 'desc') S.dir = DEF_DIR[S.sort];
const pct = b => Math.max(0, Math.min(100, Math.round(((b.progress && b.progress.percent) || 0) * 100)));
if (/Mac/i.test(navigator.platform) || /Mac OS/i.test(navigator.userAgent)) document.body.classList.add('mac');
$('#sort').value = S.sort;

const surname = a => {
  const f = (a || '').split(/[;,]/)[0].trim();
  if (!f || / и /.test(f)) return f;                 // «Ильф и Петров» оставляем целиком
  const w = f.split(/\s+/); return w.length > 1 ? w[w.length - 1] : f;   // «Лев Толстой» → «Толстой»
};
const prefFmt = b => { const p = b.progress && b.progress.fmt; if (p && b.formats[p]) return p; return ORDER.find(f => b.formats[f]) || Object.keys(b.formats)[0]; };

async function load() {
  const r = await pin.getRoot(); S.root = r;
  if (!r.root || !r.exists) { S.books = []; render(); return; }
  S.books = await pin.listBooks(); render(); smpStart();
}

function sorted() {
  const q = norm(S.q);
  let l = S.books.filter(b => !q || norm(b.title + ' ' + b.author).includes(q));
  // сравнение «по возрастанию»; для «по убыванию» список разворачивается
  const by = {
    added: (a, b) => a.added - b.added,
    read: (a, b) => (a.lastRead || 0) - (b.lastRead || 0) || a.added - b.added,
    progress: (a, b) => pct(a) - pct(b) || (a.lastRead || 0) - (b.lastRead || 0),
    author: (a, b) => (a.author || 'яяя').localeCompare(b.author || 'яяя', 'ru') || a.title.localeCompare(b.title, 'ru'),
    title: (a, b) => a.title.localeCompare(b.title, 'ru'),
  };
  l.sort(by[S.sort]);
  return S.dir === 'desc' ? l.reverse() : l;
}

function dims(b) {
  const h = hash(b.id || b.title);
  const H = 196 + (h % 7) * 11;
  let W = b.pages ? 34 + Math.min(26, Math.round(Math.sqrt(b.pages) * 1.25)) : 38 + ((h >> 5) % 20);
  W += (h >> 9) % 5 - 2;
  return { W: Math.max(34, Math.min(64, W)), H };
}

function mkBook(b, i) {
  const { W, H } = dims(b), c = colorFor(b);
  const d = document.createElement('div'); d.className = 'book';
  const authH = b.author ? Math.min(0.34 * H, 11 * surname(b.author).length * 0.9 + 8) : 0;     // сколько места займёт автор
  const room = H - 62 - authH - (pct(b) ? 16 : 0);                                                                  // что остаётся под название
  const fsT = Math.max(11, Math.min(20, W * 0.36, Math.floor(room / (Math.max(4, b.title.length) * 0.56))));
  d.style.cssText = `--w:${W}px;--h:${H}px;--c:${c};--fs:${fsT}px;animation-delay:${Math.min(i, 40) * 14}ms`;
  const fm = ORDER.filter(f => b.formats[f]);
  const pc = pct(b), done = pc >= 97;
  d.innerHTML = `<div class="b3d">
      ${pc ? `<div class="ribbon ${done ? 'done' : ''}"></div>` : ''}
      <div class="face front">${pc ? `<div class="spct ${done ? 'done' : ''}">${done ? '100%' : pc + '%'}</div><div class="sgauge"><i style="height:${pc}%"></i></div>` : ''}<div class="stitle">${esc(b.title)}</div>${b.author ? `<div class="sauth">${esc(surname(b.author))}</div>` : ''}</div>
      <div class="face cover">${b.coverUrl ? `<img src="${esc(b.thumbUrl || b.coverUrl)}" alt="" decoding="async">` : `<div class="gen"><b>${esc(b.title)}</b><i>${esc(surname(b.author))}</i></div>`}</div>
    </div>
    <div class="tip"><b>${esc(b.title)}</b>${b.author ? `<span class="au">${esc(b.author)}</span>` : ''}<div class="fmts">${fm.map(f => `<span class="chip">${f.toUpperCase()}</span>`).join('')}</div>${pc ? `<div class="pbar"><i style="width:${pc}%"></i></div><span class="au">${pc >= 97 ? 'Прочитано' : 'Прочитано ' + pc + '%'}</span>` : ''}</div>`;
  d.onclick = () => openDetail(b.id, d);
  // подсказка не должна уезжать за край окна (крайние книги слева и справа)
  d._drop = () => { const sh = d.closest('.shelf'); if (sh) sh.classList.remove('up'); d.classList.remove('hover'); };
  d._lift = () => {
    const sh = d.closest('.shelf'); if (sh) sh.classList.add('up');          // полка с выехавшей книгой поднимается над остальными
    const tip = $('.tip', d);
    tip.style.transition = 'none'; tip.style.setProperty('--tx', '0px');      // меряем без анимации перехода
    const r = tip.getBoundingClientRect(), vw = document.documentElement.clientWidth, m = 12;
    let dx = 0; if (r.left < m) dx = m - r.left; else if (r.right > vw - m) dx = vw - m - r.right;
    tip.style.setProperty('--tx', Math.round(dx) + 'px');
    requestAnimationFrame(() => { tip.style.transition = ''; });
  };
  d.addEventListener('mouseleave', () => { if (!d.classList.contains('hover')) d._drop(); });
  d.addEventListener('mouseenter', () => d._lift());
  d.dataset.w = W;
  return d;
}

function render() {
  const shelves = $('#shelves'), state = $('#state'), list = sorted();
  shelves.innerHTML = ''; state.classList.add('hide');
  const missing = !S.root || !S.root.root || !S.root.exists;
  $('#count').textContent = missing ? '' : (S.q ? `Найдено: ${list.length} из ${S.books.length}` : `Книг на полке: ${S.books.length}`) + ' · ' + SORT_TEXT[S.sort][S.dir];
  $('#dir').textContent = S.dir === 'desc' ? '↓' : '↑';
  $('#dir').title = 'Порядок: ' + SORT_TEXT[S.sort][S.dir] + '. Нажмите, чтобы поменять';
  // ряды
  const width = Math.max(300, shelves.clientWidth - 32 - 80);   // справа запас: соседи раздвигаются при выезде книги
  const rows = []; let row = [], used = 0;
  list.forEach((b, i) => { const w = dims(b).W + 3; if (used + w > width && row.length) { rows.push(row); row = []; used = 0; } row.push([b, i]); used += w; });
  if (row.length) rows.push(row);
  const total = Math.max(3, rows.length);
  for (let r = 0; r < total; r++) {
    const s = document.createElement('div'); s.className = 'shelf';
    s.innerHTML = '<div class="back"></div><div class="board"></div>';
    (rows[r] || []).forEach(([b, i]) => $('.back', s).appendChild(mkBook(b, i)));
    shelves.appendChild(s);
  }
  // обложки на торце декодируем заранее, чтобы первое наведение не подлагивало
  (window.requestIdleCallback || setTimeout)(() => $$('.cover img').forEach(i => i.decode && i.decode().catch(() => {})));
  if (missing) {
    state.innerHTML = `<h2>Полка не найдена</h2><p>Не удаётся открыть папку с книгами. Проверьте, что диск подключён, и нажмите «Повторить», либо выберите другую папку.</p><button class="btn gold" id="retry">Повторить</button> <button class="btn ghost" id="pick">Выбрать папку…</button>`;
    state.classList.remove('hide'); $('#retry').onclick = load; $('#pick').onclick = chooseRoot;
  } else if (!S.books.length) {
    state.innerHTML = `<h2>Полка пока пуста</h2><p>Добавьте книги: EPUB, FB2 или PDF. Можно просто перетащить файлы в окно.</p><button class="btn gold" id="first">Добавить первую книгу</button>`;
    state.classList.remove('hide'); $('#first').onclick = addBooks;
  } else if (!list.length) {
    state.innerHTML = `<h2>Ничего не найдено</h2><p>Попробуйте другое слово.</p>`; state.classList.remove('hide');
  }
}

async function chooseRoot() { const r = await pin.chooseRoot(); if (r) load(); }

// ---------- добавление ----------
async function importPaths(paths) {
  if (S.busy || !paths.length) return; S.busy = true;
  let added = 0, merged = 0, dup = 0; const fails = [], dupNames = [];
  for (let i = 0; i < paths.length; i++) {
    const name = paths[i].split(/[\\/]/).pop();
    toast(`Ставлю на полку ${i + 1} из ${paths.length}: ${name}`, 60000);
    try {
      const p = await prepareBook(paths[i]);
      const same = await pin.findByHash(p.sha);                       // тот же файл уже на полке (даже если название меняли)
      if (same) { dup++; dupNames.push(same.title); continue; }
      const ex = S.books.find(b => sameBook(b, p.meta));
      if (ex) {
        if (ex.formats[p.ext]) { dup++; dupNames.push(ex.title + ' (другой файл того же формата)'); continue; }
        const nb = await pin.addFormat({ id: ex.id, ext: p.ext, bytes: p.bytes, cover: p.cover, meta: p.meta });
        S.books[S.books.indexOf(ex)] = nb; merged++;
      } else {
        const nb = await pin.createBook({ meta: p.meta, ext: p.ext, bytes: p.bytes, cover: p.cover });
        S.books.push(nb); added++;
      }
    } catch (e) { fails.push(`${name}: ${e.message || e}`); }
  }
  S.busy = false; render();
  const parts = [];
  if (added) parts.push(`добавлено: ${added}`); if (merged) parts.push(`новый формат к существующей книге: ${merged}`); if (dup) { const u = [...new Set(dupNames)]; parts.push(`уже на полке, не добавлял: ${dup}` + (u.length ? ` («${u.slice(0, 2).join('», «')}»${u.length > 2 ? ' и др.' : ''})` : '')); }
  if (fails.length) parts.push(`не удалось: ${fails.length} (${fails[0]})`);
  toast(parts.join(' · ') || 'Ничего не добавлено', 7000);
}
async function addBooks() { const p = await pin.pickBooks(); if (p.length) importPaths(p); }

// ---------- карточка книги ----------
function coverHtml(b) { return `<div class="bigcover" style="--c:${colorFor(b)}">${b.coverUrl ? `<img src="${esc(b.coverUrl)}" alt="">` : `<div class="gen"><b>${esc(b.title)}</b><i>${esc(surname(b.author))}</i></div>`}</div>`; }
function openDetail(id, srcEl) {
  const b = S.books.find(x => x.id === id); if (!b) return;
  S.openId = id;
  const fm = ORDER.filter(f => b.formats[f]);
  const pc = b.progress && b.progress.percent ? Math.round(b.progress.percent * 100) : 0;
  const pf = prefFmt(b);
  const phone = innerWidth < 720;
  const sizeLine = fm.map(f => `${f.toUpperCase()} · ${fmtSize(b.formats[f].size)}${b.formats[f].converted ? ' · конвертирован' : ''}`).join('   ');
  const left = `<div class="pgin lp">${coverHtml(b)}<div class="cap">${b.pages ? b.pages + ' стр. · ' : ''}${fm.map(f => f.toUpperCase()).join(' · ')}</div></div>`;
  const right = `<div class="pgin rp">
      ${phone ? coverHtml(b).replace('class="bigcover"', 'class="bigcover mini"') : ''}
      <div class="kicker">Пинакес · книжная полка</div>
      <h2>${esc(b.title)}</h2>
      ${b.author ? `<div class="au">${esc(b.author)}</div>` : ''}
      <div class="rule"><i></i></div>
      <div class="meta">${fm.map(f => `<span class="chip">${f.toUpperCase()}</span><small>${fmtSize(b.formats[f].size)}${b.formats[f].converted ? ' · конвертирован' : ''}</small>`).join(' ')}${b.pages ? `<small>· ${b.pages} стр.</small>` : ''}</div>
      <div class="prog">${pc ? `Прочитано ${pc}%` : 'Ещё не открывали'}<div class="bar"><i style="width:${pc}%"></i></div></div>
      <div class="acts">
        <button class="btn gold" id="dRead">${pc ? 'Продолжить чтение' : 'Читать'}${fm.length > 1 ? ' · ' + pf.toUpperCase() : ''}</button>
        <button class="btn ghost" id="dDl">Скачать…</button>
      </div>
      ${fm.length > 1 ? `<div class="acts">${fm.filter(f => f !== pf).map(f => `<button class="btn ghost" data-f="${f}">Читать в ${f.toUpperCase()}</button>`).join('')}</div>` : ''}
      <div class="acts minor">
        <button class="btn ghost" id="dEdit">Изменить название</button>
        <button class="btn ghost" id="dAdd">Добавить формат</button>
        ${convTarget(b) ? `<button class="btn ghost" id="dConv" title="Пинакес сам сделает недостающий формат из имеющегося">Сделать ${convTarget(b).toUpperCase()} из ${convTarget(b) === 'epub' ? 'FB2' : 'EPUB'}</button>` : ''}
        <button class="btn ghost" id="dFolder">Показать файлы</button>
        <button class="btn danger" id="dDel">Убрать с полки</button>
      </div>
    </div>`;
  mountSpread(left, right, srcEl);
  $('#dRead').onclick = () => readBook(b, pf);
  $$('#dsheet [data-f]').forEach(x => x.onclick = () => readBook(b, x.dataset.f));
  $('#dDl').onclick = () => openDownload(b);
  $('#dEdit').onclick = () => openEdit(b);
  $('#dFolder').onclick = () => pin.reveal(b.id);
  if ($('#dConv')) $('#dConv').onclick = async e => {
    const to = convTarget(b); e.target.disabled = true; e.target.textContent = 'Конвертирую…';
    try { const nb = await fillFormat(b, to); S.books[S.books.findIndex(x => x.id === b.id)] = nb; toast(`Готово: добавлен ${to.toUpperCase()}`); render(); openDetail(b.id); }
    catch (er) { toast('Не удалось сконвертировать: ' + (er.message || er), 8000); e.target.disabled = false; e.target.textContent = 'Сделать ' + to.toUpperCase(); }
  };
  $('#dAdd').onclick = async () => {
    const paths = await pin.pickBooks(); if (!paths.length) return;
    $('#detail').classList.add('hide');
    for (const p of paths) {
      try {
        const pr = await prepareBook(p);
        if (b.formats[pr.ext]) { toast(`Формат ${pr.ext.toUpperCase()} у этой книги уже есть`); continue; }
        const same = await pin.findByHash(pr.sha); if (same) { toast(`Этот файл уже на полке: «${same.title}»`); continue; }
        const nb = await pin.addFormat({ id: b.id, ext: pr.ext, bytes: pr.bytes, cover: pr.cover, meta: pr.meta });
        S.books[S.books.findIndex(x => x.id === b.id)] = nb; toast(`Добавлен формат ${pr.ext.toUpperCase()}`);
      } catch (e) { toast('Не удалось: ' + (e.message || e)); }
    }
    render(); openDetail(b.id);
  };
  let sure = false;
  $('#dDel').onclick = async e => {
    if (!sure) { sure = true; e.target.textContent = 'Точно убрать?'; setTimeout(() => { sure = false; if (e.target) e.target.textContent = 'Убрать с полки'; }, 4000); return; }
    await pin.removeBook(b.id); S.books = S.books.filter(x => x.id !== b.id); $('#detail').classList.add('hide'); render();
    toast('Книга убрана с полки (лежит в папке «.корзина», её можно вернуть вручную)', 6000);
  };
}


// ---------- разворот книги: открытие карточки ----------
// Корешок «выезжает» с полки, поворачивается лицом, обложка раскрывается, страницы быстро перелистываются — и появляется карточка на странице книги.
// ---------- образцы текста для листов (при открытии книги листаются настоящие страницы книги) ----------
const SMP = 'pin_smp_';
const smpGet = id => { try { return localStorage.getItem(SMP + id) || ''; } catch { return ''; } };
const smpAny = () => { try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(SMP) && localStorage.getItem(k).trim()) return localStorage.getItem(k); } } catch {} return ''; };
async function smpMake(b) {
  const fmt = b.formats.fb2 ? 'fb2' : b.formats.epub ? 'epub' : null; if (!fmt) return '';
  const bytes = new Uint8Array(await pin.readFormat({ id: b.id, fmt }));
  const { root } = await fb2ToDom(fmt === 'fb2' ? bytes : await epubToFb2(bytes));
  const ps = [...root.querySelectorAll('section p')].map(p => p.textContent.replace(/\s+/g, ' ').trim()).filter(t => t.length > 40);
  if (!ps.length) return '';
  let i = Math.floor(ps.length * 0.07), out = ''; while (i < ps.length && out.length < 6000) out += ps[i++] + '\n';
  return out.trim();
}
async function smpWarm() {                               // в простое запоминаем по куску текста у каждой книги
  for (const b of S.books.slice()) {
    if (smpGet(b.id)) continue;
    try { const t = await smpMake(b); if (t) localStorage.setItem(SMP + b.id, t); else localStorage.setItem(SMP + b.id, ' '); } catch {}
    await new Promise(r => setTimeout(r, 1200));
  }
}
let smpStarted = false; const smpStart = () => { if (smpStarted) return; smpStarted = true; setTimeout(smpWarm, 3500); };
// страница из текста: № страницы n берёт свой кусок; размер шрифта подстроен под ширину страницы
function samplePage(text, n, W, H) {
  const d = document.createElement('div'), fs = Math.max(9, W / 27);
  d.style.cssText = `position:absolute;inset:0;overflow:hidden;background:#efe3c3;color:#2b1c0e;font:${fs}px/1.5 Georgia,"Times New Roman",serif;text-align:justify;hyphens:auto;padding:${H * 0.07}px ${W * 0.1}px;box-sizing:border-box`;
  d.lang = 'ru';
  const per = Math.max(400, Math.floor(W * H / (fs * fs * 0.62))), t = (text || '').trim();
  const start = t.length > per ? (n * per) % Math.max(1, t.length - per) : 0;
  const cut = t.slice(start, start + per * 1.3).replace(/^\S*\s/, '');
  d.innerHTML = cut.split('\n').map(x => `<p style="margin:0;text-indent:1.4em">${esc(x)}</p>`).join('');
  return d;
}
let bkAnims = [];
function mountSpread(leftHtml, rightHtml, srcEl) {
  const modal = $('#detail'), st = $('#dsheet'), phone = innerWidth < 720, vw = innerWidth, vh = innerHeight;
  const b = S.books.find(x => x.id === (S.openId || ''));       // обложка для закрытой книги (S.openId ставит вызывающий код ниже)
  const W = phone ? Math.min(vw * 0.94, 560) : Math.min(vw * 0.4, (vh * 0.86) / 1.42, 520), H = phone ? Math.min(vh * 0.88, W * 1.6) : W * 1.42;
  const wasOpen = !modal.classList.contains('hide');
  const animate = !wasOpen && srcEl && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  bkAnims.forEach(a => { try { a.cancel(); } catch {} }); bkAnims = [];
  st.className = 'bkstage' + (phone ? ' single' : ''); st.style.setProperty('--W', W + 'px'); st.style.setProperty('--H', H + 'px');
  const N = 14, hinge = phone ? 0 : W;
  const coverArt = b && b.coverUrl ? `<img src="${esc(b.coverUrl)}" alt="">` : `<div class="gen"><b>${esc(b ? b.title : '')}</b><i>${esc(b ? surname(b.author) : '')}</i></div>`;
  st.innerHTML = `<div class="bk-fly"><div class="bk-pivot">
      <div class="bk-base">${phone ? '' : `<section class="pg left">${cornerHtml()}${leftHtml}</section>`}<section class="pg right">${cornerHtml()}${rightHtml}</section></div>
      ${animate ? `<div class="bk-leaves" style="--paper:#efe3c3"></div>
      <div class="bk-cover" style="left:${hinge}px;transform:translateZ(${(N + 3) * 0.5}px);--c:${b ? colorFor(b) : '#5a2a2a'}"><div class="cf">${coverArt}</div><div class="cb"></div></div>` : ''}
    </div></div>`;
  modal.classList.remove('hide');
  if (!animate) return;
  const fly = $('.bk-fly', st), pivot = $('.bk-pivot', st), cover = $('.bk-cover', st), leavesBox = $('.bk-leaves', st), leftPg = $('.pg.left', st), ins = $$('.pgin', st);
  const sp = (srcEl.querySelector('.front') || srcEl).getBoundingClientRect();
  const dx = sp.left + sp.width / 2 - vw / 2, dy = sp.top + sp.height / 2 - vh / 2, sx = Math.max(0.05, sp.width / W), sy = Math.max(0.1, sp.height / H);
  const shift = phone ? 0 : -W / 2, ease = 'cubic-bezier(.22,.8,.25,1)', T = { fly: 360, open: 400, flip: 320, gap: 68 };
  const opts = (d, delay = 0, e = ease) => ({ duration: d, delay, easing: e, fill: 'both' });
  const push = a => (bkAnims.push(a), a);
  // Прозрачность у слоёв с 3D не анимируем (ломает скрытие обратной стороны): только transform и discrete-visibility.
  // 1) книга выезжает с полки и поворачивается лицом
  push(fly.animate([{ transform: `translate(${dx}px,${dy}px) scale(${sx},${sy}) rotateY(-84deg)` }, { transform: 'none' }], opts(T.fly)));
  // 2) закрытая книга по центру; обложка раскрывается, разворот раздвигается
  const t2 = T.fly + 30;
  if (!phone) push(pivot.animate([{ transform: `translateX(${shift}px)` }, { transform: `translateX(${shift}px)`, offset: t2 / (t2 + T.open) }, { transform: 'translateX(0)' }], opts(t2 + T.open, 0, 'linear')));
  push(cover.animate([{ transform: `rotateY(0deg) translateZ(${(N + 3) * 0.5}px)` }, { transform: `rotateY(-180deg) translateZ(${(N + 3) * 0.5}px)` }], opts(T.open, t2, 'cubic-bezier(.45,.05,.3,1)')));
  if (leftPg) push(leftPg.animate([{ visibility: 'hidden' }, { visibility: 'visible' }], { duration: 1, delay: t2 + T.open * 0.5, fill: 'both', easing: 'steps(1,end)' }));
  // 3) много страниц быстро перелистываются, каждая изгибается на лету
  const t3 = t2 + T.open * 0.65, tEnd = t3 + (N - 1) * T.gap + T.flip;
  // каждый лист — тот же сгиб страницы, что и в читалке: справа налево, подвёрнутая часть изгибается на лету
  const smp = (b && smpGet(b.id).trim()) || smpAny().trim() || 'Страница книги…';
  const folds = Array.from({ length: N }, (_, i) => makeFold(W, H, hinge, samplePage(smp, i * 2, W, H), samplePage(smp, i * 2 + 1, W, H)));
  for (let i = N - 1; i >= 0; i--) leavesBox.append(folds[i].front);          // непереведённые листы: верхний — первый
  folds.forEach(f => leavesBox.append(f.flap));                               // перевёрнутые ложатся стопкой: последний сверху
  const place = (i, tt) => folds[i].set(tt < .5 ? 2 * tt * tt : 1 - Math.pow(-2 * tt + 2, 2) / 2, true);
  const t0 = performance.now(); let raf = 0, finished = false;
  const drive = now => {
    const el = now - t0 - t3; let allDone = true;
    for (let i = 0; i < N; i++) { const tt = Math.min(1, Math.max(0, (el - i * T.gap) / T.flip)); place(i, tt); if (tt < 1) allDone = false; }
    if (!allDone && !finished) raf = requestAnimationFrame(drive);
  };
  raf = requestAnimationFrame(drive);
  const finishLeaves = () => { finished = true; cancelAnimationFrame(raf); folds.forEach((_, i) => place(i, 1)); };
  // 4) листы и обложка убираются, содержимое страниц проявляется
  push(leavesBox.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, delay: tEnd, fill: 'both', easing: 'ease-out' }));
  ins.forEach(el => push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: tEnd, fill: 'both', easing: 'ease-out' })));
  const clean = () => { finishLeaves(); st.classList.add('open'); $$('.bk-leaves,.bk-cover', st).forEach(e => e.remove()); };
  Promise.all(bkAnims.slice().map(a => a.finished)).then(clean).catch(() => {});
  st.onclick = e => { if (!st.classList.contains('open') && e.target.closest('.bk-fly')) { finishLeaves(); bkAnims.forEach(a => { try { a.finish(); } catch {} }); } };
}
function cornerHtml() { return '<span class="cn tl"></span><span class="cn tr"></span><span class="cn bl"></span><span class="cn br"></span>'; }

function readBook(b, fmt) {
  $('#detail').classList.add('hide');
  let last = 0;
  Reader.open(b, fmt, { onProgress: p => {
    b.progress = p; b.lastRead = Date.now();
    const now = Date.now(); if (now - last < 1500) return; last = now;
    pin.updateBook({ id: b.id, patch: { progress: p, lastRead: b.lastRead } }).catch(() => {});
  } });
}
$('#rclose').addEventListener('click', () => { const b = Reader.current(); setTimeout(() => { if (S.books.length) { const cb = S.books.find(x => b && x.id === b.id); if (cb) pin.updateBook({ id: cb.id, patch: { progress: cb.progress, lastRead: cb.lastRead } }).catch(() => {}); } render(); }, 0); });

// ---------- скачивание = сохранить копию в выбранную папку ----------
function openDownload(b) {
  const fm = ORDER.filter(f => b.formats[f]);
  $('#dlsheet').innerHTML = `<h3>Скачать книгу</h3><div class="sub">${esc(b.title)}${b.author ? ' — ' + esc(b.author) : ''}<br>Книга будет сохранена копией в папку, которую вы выберете.</div>
    <div class="${fm.length > 1 ? 'opts' : ''}">${fm.length > 1 ? `<div class="sub" style="margin-top:6px">Выберите формат (можно несколько):</div>` + fm.map((f, i) => `<label><input type="checkbox" value="${f}" ${f === prefFmt(b) || (i === 0 && !b.formats[prefFmt(b)]) ? 'checked' : ''}><b>${f.toUpperCase()}</b><small>${fmtSize(b.formats[f].size)}</small></label>`).join('') : `<div class="sub" style="margin-top:8px"><span class="chip">${fm[0].toUpperCase()}</span> &nbsp;${fmtSize(b.formats[fm[0]].size)}</div>`}</div>
    <div class="row"><button class="btn ghost" id="dlCancel">Отмена</button><button class="btn gold" id="dlGo">Выбрать папку и сохранить</button></div>`;
  $('#dl').classList.remove('hide');
  $('#dlCancel').onclick = () => $('#dl').classList.add('hide');
  $('#dlGo').onclick = async () => {
    const sel = fm.length > 1 ? $$('#dlsheet input:checked').map(i => i.value) : [fm[0]];
    if (!sel.length) { toast('Отметьте хотя бы один формат'); return; }
    try {
      const r = await pin.exportBook({ id: b.id, formats: sel });
      if (r) { $('#dl').classList.add('hide'); toast(`Сохранено в «${r.dir}»: ${r.files.map(f => f.split(/[\\/]/).pop()).join(', ')}`, 8000); }
    } catch (e) { toast('Не удалось сохранить: ' + (e.message || e)); }
  };
}
$('#rdl').onclick = () => { const b = Reader.current(); if (b) openDownload(b); };

function openEdit(b) {
  $('#esheet').innerHTML = `<h3>Название и автор</h3><label class="sub">Название<input class="txt" id="eT" value="${esc(b.title)}"></label><label class="sub">Автор<input class="txt" id="eA" value="${esc(b.author)}"></label>
    <div class="row"><button class="btn ghost" id="eC">Отмена</button><button class="btn gold" id="eS">Сохранить</button></div>`;
  $('#edit').classList.remove('hide'); $('#eT').focus();
  $('#eC').onclick = () => $('#edit').classList.add('hide');
  $('#eS').onclick = async () => {
    const nb = await pin.updateBook({ id: b.id, patch: { title: $('#eT').value.trim() || b.title, author: $('#eA').value.trim() } });
    S.books[S.books.findIndex(x => x.id === b.id)] = nb; $('#edit').classList.add('hide'); render(); openDetail(b.id);
  };
}


// ---------- телефон: зажать палец и вести по корешкам — книги выдвигаются, как при наведении мыши ----------
(function () {
  const sh = $('#shelves'); let down = null, preview = false, cur = null, timer = 0, mute = false;
  const bookAt = (x, y) => { const e = document.elementFromPoint(x, y); return e && e.closest ? e.closest('.book') : null; };
  const set = b => { if (cur === b) return; if (cur) cur._drop(); cur = b; if (b) { b.classList.add('hover'); b._lift(); } };
  sh.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    down = { x: e.clientX, y: e.clientY }; preview = false; clearTimeout(timer);
    timer = setTimeout(() => { if (down) { preview = true; set(bookAt(down.x, down.y)); } }, 260);          // удержание — предпросмотр
  });
  sh.addEventListener('pointermove', e => {
    if (!down || e.pointerType !== 'touch') return;
    if (!preview && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) { preview = true; clearTimeout(timer); }
    if (preview) set(bookAt(e.clientX, e.clientY));
  });
  const end = () => {
    clearTimeout(timer);
    if (preview) { mute = true; setTimeout(() => { mute = false; }, 380); setTimeout(() => set(null), 520); }   // после предпросмотра книга возвращается, без открытия
    down = null; preview = false;
  };
  sh.addEventListener('pointerup', end); sh.addEventListener('pointercancel', end);
  sh.addEventListener('click', e => { if (mute) { e.stopPropagation(); e.preventDefault(); } }, true);
})();

// ---------- события окна ----------
$('#add').onclick = addBooks;
$('#q').oninput = e => { S.q = e.target.value; render(); };
$('#sort').onchange = e => { S.sort = e.target.value; S.dir = DEF_DIR[S.sort]; localStorage.setItem('pin_sort', S.sort); localStorage.setItem('pin_dir', S.dir); render(); };
$('#dir').onclick = () => { S.dir = S.dir === 'desc' ? 'asc' : 'desc'; localStorage.setItem('pin_dir', S.dir); render(); };
$('#more').onclick = e => { e.stopPropagation(); $('#menu').classList.toggle('hide'); };
document.addEventListener('click', () => $('#menu').classList.add('hide'));
// склеить уже стоящие на полке отдельно EPUB/FB2/PDF одной книги
function mergePlan() {
  const left = [...S.books].sort((a, b) => Object.keys(b.formats).length - Object.keys(a.formats).length || (a.author || '').length - (b.author || '').length);
  const plan = [];
  while (left.length) {
    const keep = left.shift(), have = new Set(Object.keys(keep.formats));
    for (let i = 0; i < left.length; i++) {
      const o = left[i], fo = Object.keys(o.formats);
      if (sameBook(keep, o) && fo.every(f => !have.has(f))) { plan.push([keep.id, o.id]); fo.forEach(f => have.add(f)); left.splice(i--, 1); }
    }
  }
  return plan;
}
$('#mMerge').onclick = () => {
  const plan = mergePlan();
  if (!plan.length) { toast('Одинаковых книг в разных форматах не нашлось'); return; }
  const byId = id => S.books.find(b => b.id === id), fmt = b => Object.keys(b.formats).map(f => f.toUpperCase()).join(', ');
  const rows = plan.map(([k, f]) => { const a = byId(k), b = byId(f); return `<div class="mrow"><b>${esc(a.title)}</b><span>${esc(a.author || '—')} · ${fmt(a)}</span><i>⟵ ${esc(b.title)}</i><span>${esc(b.author || '—')} · ${fmt(b)}</span></div>`; }).join('');
  $('#dlsheet').innerHTML = `<h3>Склеить одинаковые книги</h3><div class="sub">Нашлось пар: ${plan.length}. Верхняя (крупная) карточка остаётся, форматы нижней переезжают в неё. Пустая карточка уходит в «.корзина», её можно вернуть.</div><div class="mlist">${rows}</div>
    <div class="row"><button class="btn ghost" id="mCancel">Отмена</button><button class="btn gold" id="mGo">Склеить ${plan.length}</button></div>`;
  $('#dl').classList.remove('hide');
  $('#mCancel').onclick = () => $('#dl').classList.add('hide');
  $('#mGo').onclick = async () => {
    $('#dl').classList.add('hide'); toast(`Склеиваю: ${plan.length}…`, 60000);
    try { for (const [k, f] of plan) await pin.mergeBooks({ keepId: k, fromId: f }); } catch (e) { toast('Не удалось склеить: ' + (e.message || e)); await load(); return; }
    await load(); toast(`Склеено книг: ${plan.length}. Лишние карточки лежат в «.корзина»`, 7000);
  };
};
$('#more').addEventListener('click', () => { const n = mergePlan().length; $('#mMerge').textContent = n ? `Склеить одинаковые книги (${n})` : 'Склеить одинаковые книги'; });
// недостающий формат: FB2 ⇄ EPUB (PDF не конвертируем); возвращает, какой формат можно добавить к этой книге
const convTarget = b => b.formats.fb2 && !b.formats.epub ? 'epub' : b.formats.epub && !b.formats.fb2 ? 'fb2' : null;
async function fillFormat(b, to) {
  const bytes = await convertFormat(b, to);
  return await pin.addFormat({ id: b.id, ext: to, bytes, converted: true });
}
$('#mFill').onclick = () => {
  const need = f => S.books.filter(b => !b.formats[f] && b.formats[f === 'epub' ? 'fb2' : 'epub']).length;
  const none = f => S.books.filter(b => !b.formats[f] && !b.formats[f === 'epub' ? 'fb2' : 'epub']).length;
  const opts = ['epub', 'fb2'].map((f, i) => `<label><input type="radio" name="ff" value="${f}" ${i === (need('fb2') > need('epub') ? 1 : 0) ? 'checked' : ''}><b>${f.toUpperCase()}</b><small>сделать для ${need(f)} книг</small></label>`).join('');
  $('#dlsheet').innerHTML = `<h3>Заполнить недостающие форматы</h3><div class="sub">Пинакес сам сделает недостающий формат из имеющегося (FB2 ⇄ EPUB) и добавит его в карточку книги. Исходный файл остаётся как был. Книги только в PDF пропускаются.</div>
    <div class="opts"><div class="sub" style="margin-top:6px">Какой формат добавить:</div>${opts}</div><div class="sub" id="fInfo" style="margin-top:10px"></div>
    <div class="row"><button class="btn ghost" id="fCancel">Отмена</button><button class="btn gold" id="fGo">Сконвертировать</button></div>`;
  const info = () => { const f = $('#dlsheet input:checked').value, n = need(f); $('#fInfo').textContent = n ? `Будет сконвертировано книг: ${n}` + (none(f) ? ` · без исходного FB2/EPUB, пропущено: ${none(f)}` : '') : 'Нечего конвертировать: у всех книг с исходным форматом такой формат уже есть'; $('#fGo').disabled = !n; };
  $$('#dlsheet input').forEach(i => i.onchange = info); info();
  $('#dl').classList.remove('hide');
  $('#fCancel').onclick = () => $('#dl').classList.add('hide');
  $('#fGo').onclick = async () => {
    const to = $('#dlsheet input:checked').value; $('#dl').classList.add('hide');
    const todo = S.books.filter(b => !b.formats[to] && b.formats[to === 'epub' ? 'fb2' : 'epub']); let ok = 0; const fails = [];
    for (let i = 0; i < todo.length; i++) {
      toast(`Конвертирую ${i + 1} из ${todo.length}: ${todo[i].title}`, 60000);
      try { const nb = await fillFormat(todo[i], to); S.books[S.books.findIndex(x => x.id === todo[i].id)] = nb; ok++; } catch (e) { fails.push(`${todo[i].title}: ${e.message || e}`); }
    }
    render(); toast(`Сконвертировано в ${to.toUpperCase()}: ${ok}` + (fails.length ? ` · не удалось: ${fails.length} (${fails[0]})` : ''), 12000);
  };
};
// выгрузить всю полку в одном формате: книги без этого формата пропускаются, другой формат не подставляется
$('#mAll').onclick = () => {
  const cnt = f => S.books.filter(b => b.formats[f]).length, total = S.books.length;
  if (!total) { toast('На полке пока нет книг'); return; }
  const opts = ['fb2', 'epub'].map((f, i) => `<label><input type="radio" name="xf" value="${f}" ${i === (cnt('epub') > cnt('fb2') ? 1 : 0) ? 'checked' : ''}><b>${f.toUpperCase()}</b><small>есть у ${cnt(f)} из ${total}</small></label>`).join('');
  $('#dlsheet').innerHTML = `<h3>Выгрузить все книги</h3><div class="sub">Все книги нужного формата будут скопированы в выбранную папку: удобно для переноса на электронную книгу. Если у книги такого формата нет, она пропускается, другой формат вместо него не выгружается.</div>
    <div class="opts"><div class="sub" style="margin-top:6px">Формат:</div>${opts}</div>
    <div class="sub" id="xInfo" style="margin-top:10px"></div>
    <div class="row"><button class="btn ghost" id="xCancel">Отмена</button><button class="btn gold" id="xGo">Выбрать папку и выгрузить</button></div>`;
  const info = () => { const f = $('#dlsheet input:checked').value, n = cnt(f); $('#xInfo').textContent = n ? `Будет выгружено: ${n}` + (total - n ? `, пропущено (нет в ${f.toUpperCase()}): ${total - n}` : '') : `Ни у одной книги нет формата ${f.toUpperCase()}: выгружать нечего`; $('#xGo').disabled = !n; };
  $$('#dlsheet input').forEach(i => i.onchange = info); info();
  $('#dl').classList.remove('hide');
  $('#xCancel').onclick = () => $('#dl').classList.add('hide');
  $('#xGo').onclick = async () => {
    const f = $('#dlsheet input:checked').value;
    try {
      const r = await pin.exportAll({ fmt: f }); if (!r) return;
      $('#dl').classList.add('hide');
      toast(`Выгружено ${r.done} (${f.toUpperCase()}) в «${r.dir}»` + (r.skipped ? ` · пропущено без этого формата: ${r.skipped}` : '') + (r.failed.length ? ` · не удалось: ${r.failed.length}` : ''), 10000);
    } catch (e) { toast('Не удалось выгрузить: ' + (e.message || e)); }
  };
};
$('#mOpen').onclick = () => pin.revealRoot();
$('#mRoot').onclick = chooseRoot;
['detail', 'dl', 'edit'].forEach(id => $('#' + id).addEventListener('click', e => { if (e.target.id === id) $('#' + id).classList.add('hide'); }));
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (Reader.isOpen()) { Reader.back(); return; }
  for (const id of ['edit', 'dl', 'detail']) if (!$('#' + id).classList.contains('hide')) { $('#' + id).classList.add('hide'); return; }
});
let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!Reader.isOpen()) render(); }, 160); });
// перетаскивание файлов
let dragN = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragN++; $('#drop').classList.remove('hide'); });
window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragN <= 0) { dragN = 0; $('#drop').classList.add('hide'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#drop').classList.add('hide'); const paths = [...e.dataTransfer.files].map(f => pin.pathForFile(f)).filter(Boolean); importPaths(paths); });

load();
