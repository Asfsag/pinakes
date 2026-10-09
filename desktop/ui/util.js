// Общие помощники
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// «Достоевский Фёдор» и «Фёдор Достоевский» — один автор: слова сортируем, одиночные инициалы отбрасываем
const normAuthor = a => norm(a).split(' ').filter(w => w.length > 1).sort().join(' ');
const bookKey = (author, title) => normAuthor(author) + '|' + norm(title);
// Одна и та же книга. Названия: без скобок («Этюд в багровых тонах (и)»), допускается серия перед названием («Ведьмак. Перекресток воронов»),
// опечатка в 1–2 буквы у длинных названий, числа (тома) должны совпадать. Авторы: слова одного целиком входят в другого с поправкой на написание
// («Дойль» = «Дойл», «Абнетт Дэн» ⊂ «Дэн Абнетт, Майк Ли…»); автор, указанный в скобках в названии, тоже считается. Пустой автор подходит только к точному названию.
const lev = (a, b, max) => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let mn = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < mn) mn = cur[j]; }
    if (mn > max) return max + 1; prev = cur;
  }
  return prev[b.length];
};
const parens = t => [...String(t || '').matchAll(/[(\[]([^)\]]*)[)\]]/g)].map(m => m[1]);
const titleForms = t => {
  const base = String(t || '').replace(/[(\[][^)\]]*[)\]]/g, ' ');
  const forms = new Set([norm(base)]);
  const parts = base.split(/[.:—–]\s+|\s[-—–]\s/).map(x => x.trim()).filter(Boolean);
  for (let i = 1; i < parts.length; i++) {   // «Серия. Название» → «Название», но не отбрасываем номер тома («Том 12»)
    if (/(^|[\s.])(том|книга|кн|часть|ч|выпуск|vol|volume|book|part)\.?\s*[\divx]+/i.test(parts.slice(0, i).join(' '))) break;
    const f = norm(parts.slice(i).join(' ')); if (f.length >= 10 && f.split(' ').length >= 2) forms.add(f);
  }
  const vol = base.match(/^(.*?(?:том|книга|часть|vol\.?|volume|book)\s*\d+)/i);   // «Серия. Том 5. Подзаголовок» ≈ «Серия. Том 5»
  const fv = vol ? norm(vol[1]) : '';
  forms.delete(''); return { forms: [...forms], vol: fv && !forms.has(fv) ? fv : '' };
};
const digitsOf = s => (s.match(/\d+/g) || []).join(',');
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && lev(a, b, 2) <= 2) || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2);
const authorSets = b => { const out = []; const w = authorWords(b.author); if (w.size) out.push(w); for (const p of parens(b.title)) { const x = authorWords(p); if (x.size >= 2) out.push(x); } return out; };
const authorWords = a => new Set(normAuthor(a).split(' ').filter(Boolean));
const setsCompatible = (x, y) => { const [s, l] = x.size <= y.size ? [x, y] : [y, x]; return [...s].every(w => [...l].some(v => sameWord(w, v))); };
const sameBook = (a, b) => {
  const A = titleForms(a.title), B = titleForms(b.title), ta = A.forms, tb = B.forms;
  const exact = ta.some(x => tb.includes(x)) || (A.vol && tb.includes(A.vol)) || (B.vol && ta.includes(B.vol));   // «Том 5. Подзаголовок» ≈ «Том 5», но два разных подзаголовка одного номера — разные книги
  const fuzzy = !exact && ta.some(x => tb.some(y => x.length >= 12 && y.length >= 12 && digitsOf(x) === digitsOf(y) && lev(x, y, 2) <= 2));
  if (!exact && !fuzzy) return false;
  const sa = authorSets(a), sb = authorSets(b);
  if (!sa.length || !sb.length) return exact;
  return sa.some(x => sb.some(y => setsCompatible(x, y)));
};
const fmtSize = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' ГБ' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' МБ' : Math.max(1, Math.round(n / 1e3)) + ' КБ';
const ORDER = ['epub', 'fb2', 'pdf'];
const PALETTE = ['#6b2b2b', '#2d4a3a', '#2a3b5f', '#7a5a1e', '#4d2f55', '#1f4b52', '#5d3a24', '#3f3f6b', '#6a3347', '#37533b', '#5a4a2a', '#2f4f5f'];
const colorFor = b => b.color || PALETTE[hash(b.id || b.title) % PALETTE.length];

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = v => Math.round(255 * v).toString(16).padStart(2, '0');
  return '#' + x(f(0)) + x(f(8)) + x(f(4));
}

// Цвет корешка по обложке: берём самые насыщенные пиксели и затемняем, чтобы корешок смотрелся как кожаный переплёт
async function coverColor(bytes, mime) {
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime || 'image/jpeg' }));
    const c = document.createElement('canvas'); c.width = c.height = 28;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bmp, 0, 0, 28, 28);
    const d = x.getImageData(0, 0, 28, 28).data;
    let R = 0, G = 0, B = 0, W = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const w = 0.15 + (mx - mn) / 255 * (mx > 40 ? 1 : 0.2);
      R += r * w; G += g * w; B += b * w; W += w;
    }
    R /= W; G /= W; B /= W;
    const mx = Math.max(R, G, B) / 255, mn = Math.min(R, G, B) / 255, l = (mx + mn) / 2, dd = mx - mn;
    let h = 0, s = dd === 0 ? 0 : dd / (1 - Math.abs(2 * l - 1));
    if (dd) { if (mx === R / 255) h = ((G - B) / 255 / dd) % 6; else if (mx === G / 255) h = (B - R) / 255 / dd + 2; else h = (R - G) / 255 / dd + 4; h *= 60; if (h < 0) h += 360; }
    return hslToHex(h, Math.min(68, Math.max(28, s * 100)), Math.min(34, Math.max(20, l * 100 * 0.62)));
  } catch { return ''; }
}

function toast(msg, ms = 4200) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hide');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hide'), ms);
}

// ---------- сгиб страницы (общий для читалки и открытия книги) ----------
// Страница W×H лежит в общей рамке с левым краем ox. Линия сгиба идёт справа налево; подвёрнутая часть — зеркальное отражение правой части
// (transform-матрица), на ней видна обратная сторона листа: backEl (зеркально, читается как обычная страница) или чистая бумага.
// Возвращает { under, front, flap, set(q) }: q от 0 (лист лежит) до 1 (лист перевёрнут налево).
function makeFold(W, H, ox, frontEl, backEl) {
  const mk = (c, css) => { const d = document.createElement('div'); d.className = c; if (css) d.style.cssText = css; return d; };
  const box = `left:${ox}px;width:${W}px;height:${H}px`;
  const front = mk('fold-front', box + ';background:var(--paper)'); if (frontEl) front.appendChild(frontEl);
  const fsh = mk('fold-fshade'); front.appendChild(fsh);
  const under = mk('fold-ushade', box);
  const flap = mk('fold-flap', box), sheet = mk('flap'), fsd = mk('flap-sh');
  if (backEl) { const m = mk('flap-back'); m.appendChild(backEl); sheet.appendChild(m); }
  sheet.appendChild(fsd); flap.appendChild(sheet);
  const px = v => v.toFixed(1) + 'px', poly = pts => 'polygon(' + pts.map(q => px(q[0]) + ' ' + px(q[1])).join(',') + ')';
  const corners = [[0, 0], [W, 0], [W, H], [0, H]];
  const set = (q, keepEnd) => {
    q = Math.max(0, Math.min(1, q));
    const xf = W * (1 - q), sl = H * 0.075 * Math.sin(Math.PI * q), xt = xf + sl, xb = xf - sl;
    const dx = xb - xt, len = Math.hypot(dx, H), ux = dx / len, uy = H / len;           // направление линии сгиба
    front.style.clipPath = poly([[0, 0], [xt, 0], [xb, H], [0, H]]);
    // нормаль налево (в сторону остающейся страницы) и положение сгиба вдоль неё
    const nx = -uy, ny = ux, ang = Math.atan2(nx, -ny) * 180 / Math.PI;
    const dots = corners.map(c => c[0] * nx + c[1] * ny), s0 = xt * nx - Math.min(...dots);
    fsh.style.background = `linear-gradient(${ang.toFixed(1)}deg,rgba(0,0,0,.24) ${px(s0)},rgba(0,0,0,0) ${px(s0 + 54)})`;
    fsh.style.opacity = String(Math.min(1, q * 6));
    under.style.clipPath = poly([[xt, 0], [W, 0], [W, H], [xb, H]]);
    under.style.background = `linear-gradient(${ang.toFixed(1)}deg,rgba(0,0,0,0) ${px(s0 - 150)},rgba(0,0,0,.09) ${px(s0 - 50)},rgba(0,0,0,.28) ${px(s0)})`;
    under.style.opacity = String(Math.min(1, q * 8) * (1 - Math.max(0, q - .85) / .15));
    // подвёрнутая часть: отражение относительно линии сгиба
    sheet.style.clipPath = poly([[xt, 0], [W, 0], [W, H], [xb, H]]);
    sheet.style.transform = `matrix(${(2 * ux * ux - 1).toFixed(5)},${(2 * ux * uy).toFixed(5)},${(2 * ux * uy).toFixed(5)},${(2 * uy * uy - 1).toFixed(5)},${(2 * xt - 2 * xt * ux * ux).toFixed(3)},${(-2 * xt * ux * uy).toFixed(3)})`;
    const mx = uy, my = -ux, mang = Math.atan2(mx, -my) * 180 / Math.PI;           // нормаль вправо (внутрь подвёрнутой части)
    const md = corners.map(c => c[0] * mx + c[1] * my), m0 = xt * mx - Math.min(...md), span = Math.max(8, W - xf);
    fsd.style.background = `linear-gradient(${mang.toFixed(1)}deg,rgba(0,0,0,.30) ${px(m0)},rgba(255,255,255,.30) ${px(m0 + 7)},rgba(0,0,0,.10) ${px(m0 + 30)},rgba(0,0,0,0) ${px(m0 + span * .55)},rgba(0,0,0,.10) ${px(m0 + span)})`;
    flap.style.opacity = q > 0.002 && (keepEnd || q < 0.998) ? '1' : '0';
  };
  set(0);
  return { under, front, flap, set };
}
