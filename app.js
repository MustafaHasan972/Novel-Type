'use strict';

/* ================= Application state ================= */
const STORE_KEY = 'novelType:v1';
// Dead keys (e.g. US-International layouts) report key "Dead"; map them back to the character.
const DEAD = { Quote: ["'", '"'], Backquote: ['`', '~'], Digit6: ['6', '^'] };
const THEME_KEY = 'novelType:theme';
const MSG_NOTEXT = 'No readable text was found in this book.';

const S = {
  state: 'upload',   // upload | loading | ready | typing | results
  doc: null,         // { name, pages, text, words }
  target: [],        // code points of the extracted text
  chars: [],         // one span per code point
  marks: null,       // 0 untyped, 1 correct, 2 incorrect
  idx: 0, attempts: 0, errors: 0, correctNow: 0,
  start: 0, timer: 0, lineH: 0, ws: 0, we: 0, vl: 0, snap: false, follow: false, partial: false, from: 0, to: 0, pos0: 0, spent: 0, keyStat: {}, sig: -1, goalHit: false, goalCh: -1, clearArmed: 0,
  charX: new Float32Array(0), charY: new Float32Array(0), charW: new Float32Array(0), charH: new Float32Array(0), menuSelected: -1, navPct: -1
};

/* ================= DOM references ================= */
const $ = (s) => document.querySelector(s);
const el = {
  file: $('#file'), drop: $('#drop'), err: $('#err'), best: $('#best'),
  loadMsg: $('#load-msg'), bar: $('#bar'), info: $('#info'),
  wpm: $('#s-wpm'), acc: $('#s-acc'), errors: $('#s-err'), time: $('#s-time'), prog: $('#s-prog'),
  area: $('#area'), cFrom: $('#c-from'), cTo: $('#c-to'), viewport: $('#viewport'), sel: $('#sel'), pause: $('#btn-pause'), words: $('#words'), caret: $('#caret'), cap: $('#cap'),
  hist: $('#hist'), lib: $('#lib-list'), chap: $('#chap'), search: $('#search'), q: $('#q'), qList: $('#q-list'), toc: $('#toc'), tocList: $('#toc-list'), settings: $('#settings'), toast: $('#toast'), hBest: $('#h-best'), hList: $('#h-list'), hClear: $('#h-clear'), chapterPicker: $('#chapter-picker'), chapterButton: $('#read-chapter-button'), chapterMenu: $('#read-chapter-menu'), chapterPrev: $('#chapter-prev'), chapterNext: $('#chapter-next'), readerProgress: $('#reader-progress'), readerProgressBar: $('#reader-progress-bar')
};
const IS_READER_PAGE = document.body.dataset.page === 'reader';
const readerUrl = (id) => `reader.html?book=${encodeURIComponent(id)}`;
async function goHome() {
  if (S.doc && S.set.view === 'read') { clearTimeout(S.rt); saveBook(); }
  else saveProgress();
  await saveBook();
  window.location.href = 'index.html';
}

/* ================= Local storage ================= */
const blankData = () => ({ results: [], bestWpm: 0, bestAcc: 0, completed: 0, booksDone: 0, keys: {}, totals: { words: 0, ms: 0, best: 0, bestAcc: 0, longest: 0, chapters: 0, sessions: 0 } });
const store = {
  load() {
    try { return Object.assign(blankData(), JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); }
    catch { return blankData(); }
  },
  save(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch { /* storage unavailable */ } }
};

/* ================= Library storage (IndexedDB) ================= */
const MAX_BYTES = 250 * 1024 * 1024;
let DB = null;
function openDb() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
    const r = indexedDB.open('novelType', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath: 'id' });
    };
    r.onblocked = () => rej(new Error('IndexedDB upgrade blocked by another open Novel Type tab'));
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); if (DB === db) DB = null; };
      res((DB = db));
    };
    r.onerror = () => rej(r.error);
  });
}
const idb = (stores, mode, fn) => new Promise((res, rej) => {
  if (!DB) return rej(new Error('Library storage is not available'));
  const t = DB.transaction(stores, mode);
  const r = fn(t);
  t.oncomplete = () => res(r && r.result);
  t.onerror = t.onabort = () => rej(t.error);
});
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));

// Book text lives in its own store, so listing the library never loads whole novels.
function saveBook() {
  if (!S.doc || !DB) return;
  const { text, pageStarts, name, ...meta } = S.doc;
  return idb('books', 'readwrite', (t) => t.objectStore('books').put(meta)).catch(() => toast('Could not save progress in this browser.'));
}
function saveProgress() {
  const live = S.state === 'typing' || S.state === 'paused' || (S.state === 'results' && S.partial);
  if (!S.doc || !live || S.idx <= S.from || S.idx >= S.to) return;
  S.doc.progress = { from: S.from, to: S.to, pos: S.idx };
  S.doc.pos = S.idx;
  saveBook();
}
// Adds a finished/abandoned session to the book's lifetime statistics.
function commitSession(res) {
  const st = S.doc.stats, ch = S.doc.chapters;
  st.sessions++;
  st.ms += res.elapsedTime;
  st.correct += res.correctCharacters;
  st.attempts += S.attempts;
  st.errors += S.errors;
  st.words += res.wordCount;
  st.best = Math.max(st.best, res.wpm);
  saveBook();
  const d = store.load(), T = d.totals;
  T.sessions++;
  T.words += res.wordCount;
  T.ms += res.elapsedTime;
  T.best = Math.max(T.best, res.wpm);
  T.longest = Math.max(T.longest, res.elapsedTime);
  if (res.totalCharacters >= 500) T.bestAcc = Math.max(T.bestAcc, res.accuracy);
  if (ch.length) T.chapters += Math.max(0, chapterAt(ch, S.idx) - chapterAt(ch, S.pos0));
  for (const k in S.keyStat) { const a = d.keys[k] || (d.keys[k] = [0, 0]); a[0] += S.keyStat[k][0]; a[1] += S.keyStat[k][1]; }
  S.keyStat = {};
  store.save(d);
}

/* ================= UI helpers ================= */
const tick = () => new Promise((r) => setTimeout(r));
const fmt1 = (n) => String(+n.toFixed(1));
function fmtTime(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600);
  const p = (n) => String(n).padStart(2, '0');
  return (h ? h + ':' : '') + p(Math.floor(s / 60) % 60) + ':' + p(s % 60);
}
function setState(s) {
  S.state = s;
  S.follow = s === 'typing';
  document.body.dataset.state = s;
  if (s !== 'ready' && s !== 'typing' && s !== 'paused') {
    document.body.classList.remove('focus');
    $('#btn-focus').setAttribute('aria-pressed', 'false');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  if (s !== 'typing') { clearTimeout(S.blindT); document.body.classList.remove('blind'); }
  el.pause.textContent = s === 'paused' ? 'Resume' : 'Pause';
  if (s === 'ready' || s === 'typing' || s === 'paused') focusCap();
}
function focusCap() {
  if (mobileTypingRestricted()) { el.cap.blur(); return; }
  el.cap.focus({ preventScroll: true });
}
function mobileTypingRestricted() {
  return matchMedia('(max-width: 700px), (hover: none) and (pointer: coarse)').matches;
}
function switchMobileToReading() {
  if (!mobileTypingRestricted() || S.set?.view !== 'type') return;
  const position = S.doc?.pos ?? S.idx;
  if (S.state === 'typing') pause();
  S.set.view = 'read';
  applySettings();
  syncSettingsUI();
  if (S.doc) {
    selectReadChapter(Math.max(0, chapterAt(S.doc.chapters, position)), position);
    if (S.state === 'paused') setState('ready');
  }
}
function showError(msg) { el.err.textContent = msg; }
function setProgress(pct, msg) { el.bar.style.width = pct + '%'; el.loadMsg.textContent = msg; }
function refreshBest() {
  const d = store.load();
  el.best.textContent = d.completed
    ? `Best ${fmt1(d.bestWpm)} wpm · ${fmt1(d.bestAcc)}% accuracy · ${d.completed} completed`
    : '';
}

/* ================= Text normalization ================= */
const LIGATURES = ['ff', 'fi', 'fl', 'ffi', 'ffl'];
function normalize(text) {
  return text
    .replace(/[\uFB00-\uFB04]/g, (c) => LIGATURES[c.charCodeAt(0) - 0xFB00])
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
function countWords(text) {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/* ================= EPUB processing ================= */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'SVG', 'IMG', 'AUDIO', 'VIDEO', 'NAV', 'RT']);
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'ASIDE', 'PRE', 'TR', 'TABLE', 'FIGURE', 'FIGCAPTION', 'DT', 'DD', 'HR', 'BODY']);
const normPath = (p) => { const out = []; for (const seg of p.split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); } return out.join('/'); };
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const safeDecode = (x) => { try { return decodeURIComponent(x); } catch { return x; } };

// Turns one XHTML chapter file into paragraphs (text only: markup never reaches the reader).
function htmlToParagraphs(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const paras = [];
  let cur = '';
  const flush = () => { const t = normalize(cur.replace(/\s+/g, ' ')); if (t) paras.push(t); cur = ''; };
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { cur += c.nodeValue; continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName;
      if (SKIP_TAGS.has(tag) || (tag === 'SUP' && /^\W*\d+\W*$/.test(c.textContent))) continue;
      if (tag === 'BR') { flush(); continue; }
      const block = BLOCK_TAGS.has(tag);
      if (block) flush();
      walk(c);
      if (block) flush();
    }
  };
  walk(doc.body);
  flush();
  const hd = doc.body.querySelector('h1,h2,h3');
  const heading = hd ? normalize(hd.textContent.replace(/\s+/g, ' ')) : '';
  return { paras, heading: heading.length <= 120 ? heading : '' };
}

async function parseEpub(file, progress) {
  const zip = await JSZip.loadAsync(file);
  const read = async (path) => { const f = zip.file(path); if (!f) throw new Error('missing ' + path); return f.async('string'); };
  const xml = (str) => new DOMParser().parseFromString(str, 'application/xml');
  const enc = zip.file('META-INF/encryption.xml');
  if (enc && /xmlenc#aes/i.test(await enc.async('string'))) throw Object.assign(new Error('drm'), { code: 'DRM' });
  const opfPath = xml(await read('META-INF/container.xml')).querySelector('rootfile').getAttribute('full-path');
  const opf = xml(await read(opfPath));
  const base = dirOf(opfPath), items = {};
  opf.querySelectorAll('manifest > item').forEach((i) => {
    items[i.getAttribute('id')] = { path: normPath(base + safeDecode(i.getAttribute('href'))), props: i.getAttribute('properties') || '', type: i.getAttribute('media-type') || '' };
  });
  const spine = [...opf.querySelectorAll('spine > itemref')].map((r) => items[r.getAttribute('idref')]).filter(Boolean);
  if (!spine.length) throw new Error('empty spine');
  const meta = (name) => { const n = opf.querySelector('metadata > ' + name); return n ? n.textContent.trim() : ''; };

  // Chapter titles come from the book's own table of contents (EPUB3 nav or EPUB2 NCX).
  const titles = new Map();
  const addTitle = (from, href, label) => {
    const path = normPath(dirOf(from) + safeDecode(href.split('#')[0]));
    label = label.replace(/\s+/g, ' ').trim();
    if (label && !titles.has(path)) titles.set(path, label);
  };
  try {
    const navItem = Object.values(items).find((i) => /\bnav\b/.test(i.props));
    if (navItem) {
      const d = new DOMParser().parseFromString(await read(navItem.path), 'text/html');
      const nav = [...d.querySelectorAll('nav')].find((n) => /toc/.test(n.getAttribute('epub:type') || '')) || d.querySelector('nav');
      if (nav) nav.querySelectorAll('a[href]').forEach((a) => addTitle(navItem.path, a.getAttribute('href'), a.textContent));
    }
    if (!titles.size) {
      const ncx = Object.values(items).find((i) => /dtbncx/.test(i.type));
      if (ncx) xml(await read(ncx.path)).querySelectorAll('navPoint').forEach((p) => {
        const ct = p.querySelector('content'), lb = p.querySelector('navLabel > text');
        if (ct && lb) addTitle(ncx.path, ct.getAttribute('src'), lb.textContent);
      });
    }
  } catch { /* titles are optional */ }

  const secs = [];
  for (let i = 0; i < spine.length; i++) {
    progress((i / spine.length) * 100, `Reading section ${i + 1} of ${spine.length}…`);
    if (i % 4 === 0) await tick();
    if (!/html|xml/.test(spine[i].type)) continue;
    let html = '';
    try { html = await read(spine[i].path); } catch { continue; }
    const { paras, heading } = htmlToParagraphs(html);
    if (paras.length) secs.push({ title: titles.get(spine[i].path) || heading || '', paras });
  }
  // Untitled files continue the previous chapter when the book has a usable contents list.
  const merge = secs.filter((x) => x.title).length >= 2;
  let text = '', len = 0;
  const chapters = [];
  for (const sec of secs) {
    if (!merge || sec.title || !chapters.length) chapters.push({ title: sec.title || `Section ${chapters.length + 1}`, start: len + (len ? 1 : 0) });
    for (const p of sec.paras) { const sep = len ? '\n' : ''; text += sep + p; len += sep.length + Array.from(p).length; }
  }
  return { title: meta('title'), author: meta('creator'), text, len, chapters };
}

/* ================= PDF processing ================= */
// Older browsers lack Promise.withResolvers, which PDF.js relies on.
if (!Promise.withResolvers) Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// PDF.js is loaded from ./vendor/pdfjs first (works offline), then from a CDN. Opening the page
// straight from disk (file://) blocks local modules, so the CDN copy is what makes that case work.
const PDFJS_VERSION = '4.4.168';
const PDFJS_SOURCES = [
  { base: new URL('./vendor/pdfjs/', document.currentScript?.src || document.baseURI).href, local: true },
  { base: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`, local: false }
];
let PDFJS_ACTIVE = PDFJS_SOURCES[0];
let pdfJsPromise;
async function loadPdfJsFrom(src) {
  const lib = await import(`${src.base}legacy/build/pdf.min.mjs`);
  let worker = `${src.base}legacy/build/pdf.worker.min.mjs`;
  if (!src.local) { // browsers refuse cross-origin workers, so run a same-origin copy
    try {
      const r = await fetch(worker);
      if (!r.ok) throw new Error('worker ' + r.status);
      worker = URL.createObjectURL(new Blob([await r.text()], { type: 'text/javascript' }));
    } catch { /* PDF.js falls back to running without a separate worker */ }
  }
  lib.GlobalWorkerOptions.workerSrc = worker;
  return lib;
}
function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = (async () => {
      let last;
      for (const src of PDFJS_SOURCES) {
        try { const lib = await loadPdfJsFrom(src); PDFJS_ACTIVE = src; return lib; }
        catch (e) { last = e; console.warn('PDF.js failed to load from', src.base, e); }
      }
      throw Object.assign(new Error(last?.message || 'PDF engine unavailable'), { code: 'PDF_ENGINE' });
    })().catch((err) => { pdfJsPromise = null; throw err; });
  }
  return pdfJsPromise;
}

let jszipPromise;
function ensureJsZip() {
  if (window.JSZip) return Promise.resolve();
  if (!jszipPromise) {
    const urls = ['./vendor/jszip.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'];
    jszipPromise = new Promise((res, rej) => {
      const next = () => {
        const u = urls.shift();
        if (!u) return rej(new Error('JSZip unavailable'));
        const sc = document.createElement('script');
        sc.src = u; sc.onload = () => (window.JSZip ? res() : next()); sc.onerror = () => { sc.remove(); next(); };
        document.head.appendChild(sc);
      };
      next();
    }).catch((e) => { jszipPromise = null; throw e; });
  }
  return jszipPromise;
}

// Reassemble PDF.js text fragments into lines (with coordinates) using their page positions.
function pdfPageLines(items) {
  const fragments = items.filter((item) => item.str && item.str.trim()).map((item) => ({
    text: item.str, x: item.transform?.[4] ?? 0, y: item.transform?.[5] ?? 0,
    width: item.width || 0, height: Math.abs(item.height || item.transform?.[3] || 10), end: !!item.hasEOL
  })).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const part of fragments) {
    let line = lines[lines.length - 1];
    const tolerance = Math.max(2, Math.min(8, part.height * 0.35));
    if (!line || Math.abs(line.y - part.y) > tolerance || line.end) {
      line = { y: part.y, height: part.height, end: false, parts: [] };
      lines.push(line);
    }
    line.parts.push(part);
    line.end = part.end;
  }
  return lines.map((line) => {
    line.parts.sort((a, b) => a.x - b.x);
    let value = '', last = null;
    for (const part of line.parts) {
      if (last) {
        const gap = part.x - (last.x + last.width);
        if (gap > Math.max(1.5, Math.min(last.height, part.height) * 0.18) && !/\s$/.test(value) && !/^\s/.test(part.text)) value += ' ';
      }
      value += part.text;
      last = part;
    }
    const a = line.parts[0], z = line.parts[line.parts.length - 1];
    return { text: value.trim(), x: a.x, right: z.x + z.width, y: line.y, height: line.height };
  }).filter((l) => l.text);
}

// Drops page numbers and running headers/footers (lines repeated at the page edges on many pages).
function stripRunningLines(pages) {
  const key = (l) => l.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  const edges = (lines) => lines.map((l, i) => (i < 2 || i >= lines.length - 2 ? l : null));
  const counts = new Map();
  for (const p of pages) for (const k of new Set(edges(p.lines).filter(Boolean).map(key))) counts.set(k, (counts.get(k) || 0) + 1);
  const min = Math.max(3, Math.ceil(pages.length * 0.4));
  const repeated = pages.length >= 4 ? new Set([...counts].filter(([, c]) => c >= min).map(([k]) => k)) : new Set();
  const lonePage = /^(page\s+)?\d{1,4}$/i;
  for (const p of pages) {
    const n = p.lines.length;
    p.lines = p.lines.filter((l, i) => {
      const edge = i < 2 || i >= n - 2;
      if (!edge) return true;
      if (repeated.has(key(l))) return false;
      return !((i === 0 || i === n - 1) && lonePage.test(l.text));
    });
  }
  return pages;
}

function joinPdfLines(a, b) {
  if (/[A-Za-z\u00C0-\u024F]-$/.test(a) && /^[a-z\u00DF-\u00FF]/.test(b)) return a.slice(0, -1) + b;
  return a + ' ' + b;
}

// Turns wrapped lines back into paragraphs: a new one starts after a larger vertical gap, or after
// a sentence end followed by a short line or an indent.
function linesToParagraphs(lines) {
  if (!lines.length) return [];
  const gaps = [];
  for (let i = 1; i < lines.length; i++) { const g = lines[i - 1].y - lines[i].y; if (g > 0) gaps.push(g); }
  gaps.sort((a, b) => a - b);
  const pitch = gaps.length ? gaps[gaps.length >> 1] : lines[0].height * 1.2;
  let left = Infinity, right = -Infinity;
  for (const l of lines) { if (l.x < left) left = l.x; if (l.right > right) right = l.right; }
  const width = Math.max(1, right - left);
  const paras = [];
  let cur = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1], l = lines[i];
    const ended = /[.!?:;"'\u201D\u2019)\]]$/.test(prev.text);
    const shortPrev = prev.right < right - width * 0.15;
    const indent = l.x > left + Math.max(l.height * 0.8, 8);
    if (prev.y - l.y > pitch * 1.5 || (ended && (shortPrev || indent))) { paras.push(cur); cur = l.text; }
    else cur = joinPdfLines(cur, l.text);
  }
  paras.push(cur);
  return paras;
}

async function parsePdf(file, progress) {
  const lib = await getPdfJs();
  const pdfLoadingTask = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true,
    cMapUrl: `${PDFJS_ACTIVE.base}cmaps/`, cMapPacked: true, iccUrl: `${PDFJS_ACTIVE.base}iccs/`,
    standardFontDataUrl: `${PDFJS_ACTIVE.base}standard_fonts/`, wasmUrl: `${PDFJS_ACTIVE.base}wasm/`
  });
  const pdf = await pdfLoadingTask.promise;
  try {
    const pageTexts = [], pageStarts = [], rawPages = [];
    let text = '', len = 0;
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      progress((pageNo - 1) / pdf.numPages * 100, `Extracting PDF page ${pageNo} of ${pdf.numPages}…`);
      if (pageNo % 3 === 1) await tick();
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      rawPages.push({ page: pageNo, lines: pdfPageLines(content.items) });
      page.cleanup();
    }
    stripRunningLines(rawPages);
    let tail = '';
    for (const p of rawPages) {
      const paras = linesToParagraphs(p.lines).map(normalize).filter(Boolean);
      if (!paras.length) continue;
      if (len) { // a sentence that runs across a page break stays one paragraph
        const sep = tail && !/[.!?:"')\]]$/.test(tail) && /^[a-z]/.test(paras[0]) ? ' ' : '\n';
        text += sep; len++;
      }
      const pageText = paras.join('\n');
      pageStarts.push({ page: p.page, start: len });
      pageTexts.push({ page: p.page, start: len, text: pageText });
      text += pageText;
      len += Array.from(pageText).length;
      tail = paras[paras.length - 1];
    }
    if (Array.from(text).length < 50) throw Object.assign(new Error('No selectable text found'), { code: 'NO_TEXT' });

    // Use embedded PDF bookmarks as chapter boundaries when available. Without them,
    // keep the whole PDF as one chapter so a long document does not create a huge menu.
    const chapters = [];
    try {
      const outline = await pdf.getOutline();
      const entries = [];
      const flatten = (nodes) => { for (const node of nodes || []) { if (node.title && node.dest) entries.push(node); flatten(node.items); } };
      flatten(outline);
      for (const node of entries) {
        try {
          const dest = typeof node.dest === 'string' ? await pdf.getDestination(node.dest) : node.dest;
          if (!dest?.[0]) continue;
          const page = await pdf.getPageIndex(dest[0]) + 1;
          const point = pageTexts.find((p) => p.page >= page);
          if (point) chapters.push({ title: normalize(node.title), start: point.start, page });
        } catch { /* Ignore malformed or unsupported PDF bookmarks. */ }
      }
    } catch { /* PDF bookmarks are optional. */ }
    chapters.sort((a, b) => a.start - b.start);
    const uniqueChapters = chapters.filter((c, i) => c.title && (!i || c.start !== chapters[i - 1].start));
    if (uniqueChapters.length) uniqueChapters[0].start = 0;
    else uniqueChapters.push({ title: 'PDF', start: 0 });
    progress(100, 'PDF ready…');
    const metadata = await pdf.getMetadata().catch(() => null);
    const info = metadata?.info || {};
    return { title: info.Title || '', author: info.Author || '', text, len: Array.from(text).length, chapters: uniqueChapters, pageStarts, pageCount: pdf.numPages };
  } finally {
    // Destroy the loading task; PDFDocumentProxy does not expose destroy().
    try { await pdfLoadingTask.destroy?.(); } catch { /* Parsed content remains usable. */ }
  }
}

function chapterAt(ch, i) {
  let lo = 0, hi = ch.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ch[m].start <= i) lo = m; else hi = m - 1; }
  return ch[0].start <= i ? lo : -1;
}

// Where the story really begins: the prologue if there is one, otherwise chapter one,
// otherwise the first substantial section that is not front matter.
const PROLOGUE_RE = /^(prologue|prelude|prolog)\b/i;
const FIRST_RE = /^(?:(?:chapter|part|book)\s+(?:1|one|i)\b|(?:1|one|i)[.:)]?$)/i;
const FRONT_RE = /^(cover|title|half[- ]?title|copyright|dedication|epigraph|contents|table of contents|toc|acknowledg|about the (author|publisher)|also by|other books|by the same|praise|map|preface|foreword|introduction|list of|note|author.?s note|front matter|newsletter|imprint|colophon|frontispiece|reviews|endorsements)/i;
const BACK_RE = /^(acknowledg|about the (author|publisher)|also by|other books|by the same|appendix|glossary|afterword|notes|credits|copyright|newsletter|sample|excerpt|preview|reading group|discussion|permissions|bibliography|index)/i;
function detectStory(ch, n) {
  if (!ch.length) return { start: 0, end: n };
  const size = (i) => (ch[i + 1] ? ch[i + 1].start : n) - ch[i].start;
  const near = (i) => i < 40;
  let k = ch.findIndex((c, i) => near(i) && PROLOGUE_RE.test(c.title) && size(i) > 200);
  if (k < 0) k = ch.findIndex((c, i) => near(i) && FIRST_RE.test(c.title));
  if (k < 0) k = ch.findIndex((c, i) => !FRONT_RE.test(c.title) && size(i) > 1500);
  k = Math.max(k, 0);
  let e = ch.length;
  while (e > k + 1 && BACK_RE.test(ch[e - 1].title)) e--;
  return { start: ch[k].start, end: e < ch.length ? ch[e].start - 1 : n };
}

const PENDING_KEY = 'novelType:pending';
const readPending = () => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}'); } catch { return {}; } };
const writePending = (o) => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(o)); } catch { /* ignore */ } };
const fp = (b) => `${b.title}|${b.chars}`;

/* ================= Upload handling ================= */
async function handleFile(file) {
  if (!file || S.state === 'loading') return;
  showError('');
  const isEpub = /\.epub$/i.test(file.name) || file.type === 'application/epub+zip';
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  if (!isEpub && !isPdf) return showError('Please upload an EPUB or PDF file.');
  if (file.size > MAX_BYTES) return showError('This file is too large to process in the browser.');
  if (isEpub) { try { await ensureJsZip(); } catch { return showError('The EPUB reader could not load. Check your connection and reload the page.'); } }
  setState('loading');
  setProgress(0, isPdf ? 'Opening PDF…' : 'Opening EPUB…');
  try {
    const r = isPdf ? await parsePdf(file, setProgress) : await parseEpub(file, setProgress);
    if (r.text.length < 50) { setState('upload'); return showError(MSG_NOTEXT); }
    const story = detectStory(r.chapters, r.len);
    const title = r.title || file.name.replace(/\.(epub|pdf)$/i, '');
    const book = {
      id: newId(), title, author: r.author, filename: file.name, words: countWords(r.text), chars: r.len,
      format: isPdf ? 'pdf' : 'epub', pageCount: r.pageCount || null,
      importedAt: Date.now(), lastOpened: Date.now(), pos: 0, progress: null, chapters: r.chapters, bookmarks: [],
      storyStart: story.start, storyEnd: story.end, stats: { sessions: 0, ms: 0, correct: 0, attempts: 0, errors: 0, words: 0, best: 0 }
    };
    const pend = readPending(), key = fp(book);
    if (pend[key]) { Object.assign(book, pend[key]); delete pend[key]; writePending(pend); }
    try { await idb(['books', 'texts'], 'readwrite', (t) => { t.objectStore('books').put(book); t.objectStore('texts').put({ id: book.id, text: r.text, pageStarts: r.pageStarts || [] }); }); }
    catch { toast('Could not save this book to your library, so your progress will not be remembered.'); }
    window.location.href = readerUrl(book.id);
    return;
  } catch (err) {
    console.error(err);
    setState('upload');
    const message = err?.code === 'DRM' ? 'This EPUB is DRM-protected and cannot be read here.'
      : err?.code === 'NO_TEXT' ? 'This PDF has no selectable text. Scanned PDFs need OCR before they can be read.'
        : err?.name === 'PasswordException' ? 'This PDF is password-protected.'
          : err?.code === 'PDF_ENGINE' ? (location.protocol === 'file:' ? 'The PDF reader could not load from a local file. Connect to the internet, or serve this folder over http (for example: python -m http.server) with the vendor/pdfjs folder included.' : 'The PDF reader could not load. Check your connection, or include the vendor/pdfjs folder next to this app, then reload.')
            : isPdf ? `PDF import failed: ${err?.message || 'the PDF could not be parsed.'}`
              : 'This EPUB could not be read. It may be corrupted.';
    showError(message);
  }
}

function loadText(doc) {
  doc.bookmarks = doc.bookmarks || [];
  S.doc = doc;
  S.set.view = doc.format === 'pdf' || mobileTypingRestricted() ? 'read' : (S.pref || 'type');
  applySettings();
  syncSettingsUI();
  S.target = Array.from(doc.text);
  S.lower = null;
  S.keyStat = {};
  const n = S.target.length, start = doc.storyStart || 0, end = doc.storyEnd || n;
  let sv = doc.progress;
  if (!sv && doc.pos > 0 && doc.pos < end - 50) sv = { from: doc.pos, to: end, pos: doc.pos };
  const ok = sv && sv.from >= 0 && sv.from <= sv.pos && sv.pos < sv.to && sv.to <= n;
  Object.assign(S, { from: ok ? sv.from : start, to: ok ? sv.to : end, pos0: ok ? sv.pos : start, spent: 0, partial: false, lastSave: 0 });
  el.info.textContent = doc.name + (doc.author ? ' — ' + doc.author : '');
  fillChapterSelects();
  setState('ready');
  S.lineH = parseFloat(getComputedStyle(el.words).lineHeight) || 44;
  resetRun();
  syncRange();
  if (IS_READER_PAGE && S.set.view === 'read') {
    const pos = doc.progress?.pos ?? doc.pos ?? S.pos0;
    selectReadChapter(Math.max(0, chapterAt(S.doc.chapters, pos)), pos);
  }
}

/* ================= Typing engine ================= */
/* Only a small window of the text is in the DOM at any time, so long PDFs stay fast. */
const WINDOW = 3000, REBASE_LINE = 28; // keep enough text ready while avoiding frequent large DOM rebuilds

function snapStart(i) { while (i > 0 && S.target[i - 1] !== ' ' && S.target[i - 1] !== '\n') i--; return i; }
function snapEnd(i) { const n = S.target.length; while (i < n && S.target[i] !== ' ' && S.target[i] !== '\n') i++; return i; }
function windowStartFor(i) {
  const context = S.follow ? (Math.floor(visibleLines() / 2) + 3) * 68 : 150;
  return snapStart(Math.max(0, i - context));
}

// Renders target[ws .. ws+WINDOW); vl is the first visible line inside the window.
function renderWindow(ws, vl = 0) {
  const activeEnd = S.set.view === 'read' ? Math.min(S.to, S.target.length) : S.target.length;
  const activeStart = S.set.view === 'read' ? S.from : 0;
  ws = Math.max(activeStart, Math.min(ws, Math.max(activeStart, activeEnd - 1)));
  const we = Math.min(activeEnd, ws + WINDOW);
  const frag = document.createDocumentFragment();
  S.chars = new Array(we - ws);
  for (let i = ws; i < we; i++) {
    const c = S.target[i], sp = document.createElement('span');
    sp.className = (c === ' ' ? 'ch sp' : c === '\n' ? 'ch nl' : 'ch') + (S.set.view !== 'read' && (i < S.from || i >= S.to) ? ' out' : '');
    sp.textContent = c === '\n' ? (S.set.view === 'read' ? '' : '↵') : c;
    if (S.marks[i]) sp.dataset.s = attrOf(S.marks[i]);
    S.chars[i - ws] = sp;
    frag.appendChild(sp);
    if (c === '\n') {
      frag.appendChild(document.createElement('br'));
      if (S.set.view === 'read') frag.appendChild(document.createElement('br'));
    }
  }
  S.ws = ws; S.we = we; S.vl = vl;
  el.words.style.transition = 'none';
  el.caret.style.transition = 'none';
  el.words.replaceChildren(el.caret, frag);
  el.words.style.transform = `translateY(${-vl * S.lineH}px)`;
  void el.words.offsetHeight;
  measureCharGeometry();
  el.words.style.transition = '';
  S.snap = true;
}

function measureCharGeometry() {
  const chars = S.chars;
  if (!chars.length) return;
  if (S.charX.length !== chars.length) {
    S.charX = new Float32Array(chars.length);
    S.charY = new Float32Array(chars.length);
    S.charW = new Float32Array(chars.length);
    S.charH = new Float32Array(chars.length);
  }
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    S.charX[i] = c.offsetLeft;
    S.charY[i] = c.offsetTop;
    S.charW[i] = c.offsetWidth;
    S.charH[i] = c.offsetHeight;
  }
}

const attrOf = (v) => (v === 1 ? 'c' : v === 2 ? (S.set.mode === 'zen' ? 'c' : 'x') : null);
function mark(i, v) {
  const old = S.marks[i];
  if (old === 1) S.correctNow--;
  S.marks[i] = v;
  if (v === 1) S.correctNow++;
  const c = S.chars[i - S.ws];
  if (!c) return;
  const a = attrOf(v);
  if (a) c.dataset.s = a; else c.removeAttribute('data-s');
}

// Index (inside S.chars) of the first character on a visual line.
function lineStart(line) {
  const top = line * S.lineH - 1;
  let lo = 0, hi = S.chars.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (S.charY[m] >= top) hi = m; else lo = m + 1; }
  return lo;
}

function visibleLines() {
  const style = getComputedStyle(el.viewport);
  const usable = el.viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  return Math.max(1, Math.floor(usable / S.lineH));
}
function maxViewLine() {
  const style = getComputedStyle(el.viewport);
  const usable = el.viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  return Math.max(0, Math.ceil((el.words.scrollHeight - usable) / S.lineH));
}

function setView(vl) {
  const activeEnd = S.set.view === 'read' ? Math.min(S.to, S.target.length) : S.target.length;
  if (vl >= REBASE_LINE && S.we < activeEnd) { renderWindow(S.ws + lineStart(vl), 0); return; }
  S.vl = Math.max(0, Math.min(vl, maxViewLine()));
  el.words.style.transform = `translateY(${-S.vl * S.lineH}px)`;
}

// Manual scrolling (ready / paused): one line per step.
function browse(dir) {
  let vl = S.vl + dir;
  if (vl < 0) {
    const activeStart = S.set.view === 'read' ? S.from : 0;
    if (S.ws <= activeStart) return;
    const per = Math.max(20, lineStart(1)), ns = Math.max(activeStart, snapStart(Math.max(activeStart, S.ws - per * 5)));
    renderWindow(ns, Math.max(0, Math.round((S.ws - ns) / per) - 1));
  } else {
    const activeEnd = S.set.view === 'read' ? Math.min(S.to, S.target.length) : S.target.length;
    if (S.we >= activeEnd && vl > maxViewLine()) return;
    setView(vl);
  }
  if (S.set.view === 'read') { // keep the reading position
    const p = S.ws + lineStart(S.vl);
    S.doc.pos = p;
    S.doc.progress = p >= S.from && p < S.to ? { from: S.from, to: S.to, pos: p } : null;
    clearTimeout(S.rt);
    S.rt = setTimeout(saveBook, 800);
    updateStats();
    syncReaderNav();
  }
  placeCaret();
}

function browsePage(dir) {
  const visible = visibleLines();
  for (let i = 0; i < visible; i++) browse(dir);
}

function browseToEnd(end) {
  if (!S.chars.length) return;
  const activeEnd = S.set.view === 'read' ? Math.min(S.to, S.target.length) : S.target.length;
  if (end) {
    if (S.we < activeEnd) renderWindow(snapStart(activeEnd - 1), 0);
    setView(maxViewLine());
  } else {
    if (S.ws > 0) renderWindow(0, 0);
    setView(0);
  }
  if (S.set.view === 'read') {
    const p = S.ws + lineStart(S.vl);
    S.doc.pos = p;
    S.doc.progress = p >= S.from && p < S.to ? { from: S.from, to: S.to, pos: p } : null;
    clearTimeout(S.rt);
    S.rt = setTimeout(saveBook, 800);
    syncReaderNav();
  }
  placeCaret();
}

function moveCaret() {
  const n = S.target.length;
  if (!n) return;
  if (S.follow) { // while typing the view always follows the cursor
    const contextStart = windowStartFor(S.idx);
    if (contextStart < S.ws || (S.idx >= S.we && S.we < n)) renderWindow(contextStart);
    const ci = Math.min(S.idx, S.we - 1) - S.ws;
    const centerOffset = Math.floor(visibleLines() / 2);
    setView(Math.floor(S.charY[ci] / S.lineH) - centerOffset);
    if (S.set.blind > 0) { const sig = S.ws * 100 + S.vl; if (sig !== S.sig) { S.sig = sig; revealBlind(); } }
  }
  placeCaret();
}

function placeCaret() {
  const n = S.target.length, k = S.idx - S.ws, ci = Math.min(k, S.chars.length - 1), st = el.caret.style;
  if (ci < 0 || k < 0 || (k >= S.chars.length && S.we < n)) { st.display = 'none'; return; }
  st.display = '';
  st.left = S.charX[ci] + (S.idx >= n ? S.charW[ci] : 0) + 'px';
  st.top = S.charY[ci] + 'px';
  st.height = S.charH[ci] + 'px';
  if (S.snap) { void el.caret.offsetWidth; st.transition = ''; S.snap = false; }
}

function typeChar(ch) {
  if (S.idx >= S.to) return;
  const exp = S.target[S.idx], ok = ch === exp;
  const ks = S.keyStat[exp] || (S.keyStat[exp] = [0, 0]);
  ks[0]++;
  if (!ok) ks[1]++;
  playKey();
  S.attempts++;
  if (!ok) {
    S.errors++;
    if (S.set.mode === 'strict') { const c = S.chars[S.idx - S.ws]; if (c) c.dataset.s = 'x'; return; }
  }
  mark(S.idx, ok ? 1 : 2);
  S.idx++;
  if (S.idx >= S.to) finish(); else moveCaret();
}

function backspace() {
  if (S.idx <= S.pos0) return;
  S.idx--;
  if (S.idx < S.ws) renderWindow(windowStartFor(S.idx));
  mark(S.idx, 0);
  moveCaret();
}

function backspaceWord() {
  if (S.idx <= S.pos0) return;
  const end = S.idx;
  let start = end;
  while (start > S.pos0 && /\s/u.test(S.target[start - 1])) start--;
  while (start > S.pos0 && !/\s/u.test(S.target[start - 1])) start--;
  if (start === end) return;
  for (let i = end - 1; i >= start; i--) mark(i, 0);
  S.idx = start;
  if (S.idx < S.ws) renderWindow(windowStartFor(S.idx));
  moveCaret();
}

// Starts or resumes the timer; the view snaps back to the cursor.
function resume() {
  S.sig = -1;
  S.start = performance.now();
  clearInterval(S.timer);
  S.timer = setInterval(updateStats, 250);
  setState('typing');
  moveCaret();
}

function pause() {
  if (S.state !== 'typing') return;
  S.spent += performance.now() - S.start;
  S.start = 0;
  clearInterval(S.timer);
  updateStats();
  saveProgress();
  setState('paused');
}

function resetRun(viewAt = S.pos0) {
  clearInterval(S.timer);
  const n = S.target.length;
  Object.assign(S, { idx: S.pos0, attempts: 0, errors: 0, correctNow: 0, start: 0, spent: 0, goalHit: false, sig: -1,
    goalCh: S.doc.chapters.length ? chapterAt(S.doc.chapters, S.pos0) : -1 });
  S.marks = S.marks && S.marks.length === n ? S.marks.fill(0) : new Uint8Array(n);
  renderWindow(snapStart(Math.max(0, Math.min(viewAt, n - 1))));
  updateStats();
  moveCaret();
}

/* ================= Selection (start / end of the typed portion) ================= */
const MIN_SEL = 50;
const labelCache = new WeakMap();
// Short names for the chapter menus: "Chapter 12", or the section's own name for the prologue, parts and front/back matter.
function labelsOf(doc) {
  if (labelCache.has(doc)) return labelCache.get(doc);
  const s = doc.storyStart || 0, e = doc.storyEnd || Infinity, short = (t) => t.split(/\s*[:–—]\s*/)[0].slice(0, 30);
  let n = 0;
  const labs = doc.chapters.map((c) => {
    const t = c.title.trim();
    if (c.start < s || c.start >= e || /^(prologue|prelude|epilogue|afterword|interlude|part|book)\b/i.test(t)) return short(t);
    const m = t.match(/^chapter\s+(\d+)/i);
    n = m ? +m[1] : n + 1;
    return 'Chapter ' + n;
  });
  labelCache.set(doc, labs);
  return labs;
}
function chapterParts(doc, i) {
  const lab = labelsOf(doc)[i], t = doc.chapters[i].title.trim();
  if (t.toLowerCase().startsWith(lab.toLowerCase())) return [lab, t.slice(lab.length).replace(/^[\s:.\-–—]+/, '')];
  return [lab, lab === t ? '' : t];
}
function chapterName(doc, i) { const [a, b] = chapterParts(doc, i); return b ? `${a} · ${b}` : a; }

function fillChapterSelects() {
  const labs = labelsOf(S.doc);
  const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; };
  el.cFrom.replaceChildren(opt(-1, 'Start of book'), ...labs.map((t, i) => opt(i, t)));
  el.cTo.replaceChildren(...labs.map((t, i) => opt(i, t)));
  el.chapterMenu.replaceChildren(...labs.map((t, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chapter-option'; b.setAttribute('role', 'option');
    b.dataset.chapter = i; b.textContent = chapterName(S.doc, i);
    return b;
  }));
  S.menuSelected = -1;
  el.chapterButton.disabled = !labs.length;
  el.cFrom.parentElement.hidden = el.cTo.parentElement.hidden = !labs.length;
  syncReaderNav();
}

function setChapterMenu(open, focusSelected = false) {
  el.chapterMenu.hidden = !open;
  el.chapterButton.setAttribute('aria-expanded', String(open));
  if (!open || !focusSelected) return;
  (el.chapterMenu.querySelector('.chapter-option.selected') || el.chapterMenu.querySelector('.chapter-option'))?.focus();
}

function syncReaderNav() {
  const chapters = S.doc?.chapters || [];
  const i = chapters.length ? Math.max(0, chapterAt(chapters, S.set.view === 'read' ? S.from : S.idx)) : -1;
  const buttonLabel = i >= 0 ? `${chapterName(S.doc, i)} ▾` : 'Whole book';
  if (el.chapterButton.textContent !== buttonLabel) el.chapterButton.textContent = buttonLabel;
  if (S.menuSelected !== i) {
    const previous = el.chapterMenu.children[S.menuSelected];
    if (previous) { previous.setAttribute('aria-selected', 'false'); previous.classList.remove('selected'); }
    const current = el.chapterMenu.children[i];
    if (current) { current.setAttribute('aria-selected', 'true'); current.classList.add('selected'); }
    S.menuSelected = i;
  }
  el.chapterPrev.disabled = i <= 0;
  el.chapterNext.disabled = i < 0 || i >= chapters.length - 1;
  const span = Math.max(1, S.to - S.from);
  const here = S.set.view === 'read' ? (S.doc.pos ?? S.from) : S.idx;
  const atChapterEnd = S.set.view === 'read' && S.we >= Math.min(S.to, S.target.length) && S.vl >= maxViewLine();
  const pct = S.doc ? (atChapterEnd ? 100 : Math.max(0, Math.min(100, Math.floor(((here - S.from) / span) * 100)))) : 0;
  const pctLabel = S.doc ? `${pct}%` : '';
  if (el.readerProgress.textContent !== pctLabel) el.readerProgress.textContent = pctLabel;
  if (S.navPct !== pct) { el.readerProgressBar.style.width = pct + '%'; S.navPct = pct; }
}

function selectReadChapter(i, position) {
  const chapters = S.doc.chapters;
  if (!chapters.length) {
    S.from = S.doc.storyStart || 0;
    S.to = S.doc.storyEnd || S.target.length;
  } else {
    i = Math.max(0, Math.min(chapters.length - 1, i));
    S.from = chapters[i].start;
    S.to = chapters[i + 1] ? chapters[i + 1].start - 1 : S.target.length;
    S.to = Math.max(S.from + 1, S.to);
  }
  S.pos0 = S.from;
  S.idx = position !== undefined && position >= S.from && position < S.to ? position : S.from;
  S.doc.pos = S.idx;
  S.doc.progress = null;
  const at = S.idx;
  resetRun(at);
  if (at > S.from) { S.idx = at; renderWindow(snapStart(at)); }
  placeCaret();
  syncRange();
  syncReaderNav();
  saveBook();
}

function chooseChapter(i) {
  if (!S.doc.chapters.length) return;
  if (S.set.view === 'read') { selectReadChapter(i); return; }
  const chapters = S.doc.chapters;
  i = Math.max(0, Math.min(chapters.length - 1, i));
  S.from = chapters[i].start;
  S.to = chapters[i + 1] ? chapters[i + 1].start - 1 : S.target.length;
  el.cFrom.value = i;
  el.cTo.value = i;
  setState('ready');
  applyRange(S.from);
  saveBook();
  focusCap();
}
function syncRange() {
  const ch = S.doc.chapters, len = S.to - S.from;
  if (ch.length) {
    el.cFrom.value = S.from <= 0 ? -1 : chapterAt(ch, S.from);
    el.cTo.value = Math.max(0, chapterAt(ch, Math.max(S.from, S.to - 1)));
  }
  const story = S.doc.storyStart > 0 && S.from === S.doc.storyStart ? ' · Where the story begins' : '';
  const cont = S.pos0 > S.from ? ` · Continuing at ${Math.floor(((S.pos0 - S.from) / len) * 100)}%` : '';
  el.sel.textContent = `About ${Math.round(len / 5.7).toLocaleString()} words selected${story}${cont}`;
}
function applyChapters() {
  const ch = S.doc.chapters, n = S.target.length;
  const a = +el.cFrom.value, b = Math.max(a, +el.cTo.value);
  S.from = a < 0 ? 0 : ch[a].start;
  S.to = ch[b + 1] ? ch[b + 1].start - 1 : n;
  applyRange(S.from);
  focusCap();
}
function applyRange(viewAt) { S.pos0 = S.from; resetRun(viewAt); syncRange(); }

/* ================= Statistics ================= */
function computeStats(final) {
  const ms = S.spent + (S.start ? performance.now() - S.start : 0);
  // Net WPM: only characters currently correct count, 5 characters = 1 word.
  const wpm = ms >= 1000 || (final && ms > 0) ? S.correctNow / 5 / (Math.max(ms, 1) / 60000) : 0;
  const acc = S.attempts ? ((S.attempts - S.errors) / S.attempts) * 100 : 100;
  return { ms, wpm, acc, prog: ((S.idx - S.from) / (S.to - S.from || 1)) * 100 };
}

function fmtEstimate(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `~${h ? h + 'h ' : ''}${m}m left`;
}
function updateStats() {
  const s = computeStats(false);
  el.wpm.textContent = Math.round(s.wpm);
  el.acc.textContent = fmt1(s.acc) + '%';
  el.errors.textContent = S.errors;
  el.time.textContent = fmtTime(s.ms);
  el.prog.textContent = Math.floor(s.prog) + '%';
  const d = S.doc, n = S.target.length;
  if (!d) return;
  syncReaderNav();
  const at = curPos(), ci = d.chapters.length ? chapterAt(d.chapters, at) : -1, st = d.stats;
  // Estimate from the reader's own lifetime speed; hidden until there is enough data.
  const est = st.ms >= 120000 && st.correct > 0 ? fmtEstimate(((n - at) * (st.ms / 60000)) / st.correct) : '';
  const line = [ci >= 0 ? chapterName(d, ci) : '', `${Math.floor((at / n) * 100)}% of book`, est].filter(Boolean).join(' · ');
  if (el.chap.textContent !== line) el.chap.textContent = line;
  const g = S.set.goal;
  if (g !== 'none' && !S.goalHit && S.state === 'typing') {
    const hit = g === '10m' ? s.ms >= 6e5 : g === '30m' ? s.ms >= 1.8e6 : g === '1000w' ? S.correctNow >= 5000 : ci !== S.goalCh;
    if (hit) { S.goalHit = true; toast('Goal reached. Keep going or take a break.'); }
  }
  if (S.state === 'typing' && performance.now() - S.lastSave > 15000) { S.lastSave = performance.now(); saveProgress(); }
}

/* ================= Results ================= */
function sessionResult() {
  const s = computeStats(true), typed = S.idx - S.pos0;
  return {
    filename: S.doc.name, wpm: +s.wpm.toFixed(1), accuracy: +s.acc.toFixed(1), errors: S.errors,
    elapsedTime: Math.round(s.ms), totalCharacters: typed, correctCharacters: S.correctNow,
    incorrectCharacters: typed - S.correctNow, wordCount: countWords(S.target.slice(S.pos0, S.idx).join('')),
    pages: S.doc.pages, range: [S.from, S.to], progress: s.prog, timestamp: Date.now()
  };
}

function showResults(res, done) {
  S.partial = !done;
  const v = {
    wpm: fmt1(res.wpm), acc: fmt1(res.accuracy) + '%', errors: res.errors, time: fmtTime(res.elapsedTime),
    done: Math.floor(res.progress) + '%', total: res.totalCharacters.toLocaleString(),
    correct: res.correctCharacters.toLocaleString(), incorrect: res.incorrectCharacters.toLocaleString(),
    words: res.wordCount.toLocaleString(), file: res.filename,
    note: done ? (S.to >= (S.doc.storyEnd || S.target.length) ? 'You finished this book.' : '') : 'Session ended early. Your place is saved in your library.'
  };
  document.querySelectorAll('[data-r]').forEach((n) => { n.textContent = v[n.dataset.r]; });
  $('#btn-continue').hidden = done;
  setState('results');
  (done ? $('#btn-retry') : $('#btn-continue')).focus();
}

function finish() {
  clearInterval(S.timer);
  if (S.start) { S.spent += performance.now() - S.start; S.start = 0; }
  const res = sessionResult();
  const d = store.load();
  d.results.unshift(res);
  d.results.length = Math.min(d.results.length, 100);
  d.bestWpm = Math.max(d.bestWpm, res.wpm);
  d.bestAcc = Math.max(d.bestAcc, res.accuracy);
  d.completed++;
  if (S.to >= (S.doc.storyEnd || S.target.length)) d.booksDone++;
  store.save(d);
  S.doc.progress = null;
  S.doc.pos = S.to;
  commitSession(res);
  showResults(res, true);
}

// Leaving mid-test: show the stats so far and remember the place in this PDF.
function leave() {
  clearInterval(S.timer);
  if (S.start) { S.spent += performance.now() - S.start; S.start = 0; }
  saveProgress();
  if (S.attempts === 0) { newPdf(); return; } // nothing typed: no empty session in the statistics
  const res = sessionResult();
  commitSession(res);
  if (res.totalCharacters >= 50) { // abandoned sessions appear in History too
    const d = store.load();
    d.results.unshift(res);
    d.results.length = Math.min(d.results.length, 100);
    store.save(d);
  }
  showResults(res, false);
}

function exitTest() {
  if (S.set.view === 'read') { newPdf(); return; }
  if (S.state === 'typing' || S.state === 'paused') leave();
  else if (S.state !== 'upload' && S.state !== 'loading') newPdf();
}

// Tab mid-session: keep what was typed in the statistics, then start over from where this session began.
function restartSession() {
  clearInterval(S.timer);
  if (S.start) { S.spent += performance.now() - S.start; S.start = 0; }
  if (S.attempts > 0) commitSession(sessionResult());
  resetRun();
  setState('ready');
  syncRange();
}

function retry() {
  if (!S.doc) return;
  S.pos0 = S.from;
  resetRun();
  setState('ready');
  syncRange();
}

function cont() {
  if (!S.doc) return;
  S.pos0 = S.idx;
  resetRun();
  setState('ready');
  syncRange();
}

function newPdf() {
  if (IS_READER_PAGE) { goHome(); return; }
  clearInterval(S.timer);
  if (S.doc && S.set.view === 'read') { clearTimeout(S.rt); saveBook(); }
  Object.assign(S, { doc: null, target: [], chars: [], marks: null, idx: 0, ws: 0, we: 0, start: 0, spent: 0, partial: false, lower: null });
  el.words.replaceChildren(el.caret);
  showError('');
  refreshBest();
  setState('upload');
  renderLibrary();
}

/* ================= History ================= */
function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.textContent = text;
  return n;
}
function achievements(d) {
  const T = d.totals;
  return [['First chapter', T.chapters >= 1], ['10,000 words', T.words >= 10000], ['100 WPM', T.best >= 100],
    ['99% accuracy', T.bestAcc >= 99], ['One-hour session', T.longest >= 3600000], ['First book finished', d.booksDone >= 1]];
}

function renderGraph(res) {
  const pts = res.slice(0, 30).reverse().map((r) => r.wpm), box = $('#h-graph');
  if (pts.length < 2) { box.replaceChildren(); return; }
  const ns = 'http://www.w3.org/2000/svg', W = 600, H = 90, lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 18}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `WPM over your last ${pts.length} finished tests, from ${fmt1(lo)} to ${fmt1(hi)}`);
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - lo) / span) * (H - 10) - 4}`).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'var(--accent)');
  line.setAttribute('stroke-width', '2');
  const cap = document.createElementNS(ns, 'text');
  cap.textContent = `WPM over your last ${pts.length} tests · ${fmt1(lo)} to ${fmt1(hi)}`;
  Object.entries({ x: 0, y: H + 14, fill: 'var(--sub)', 'font-size': 11 }).forEach(([k, v]) => cap.setAttribute(k, v));
  svg.append(line, cap);
  box.replaceChildren(svg);
}

function renderKeys(keys) {
  const rows = Object.entries(keys).filter(([k, v]) => /\S/.test(k) && v[0] >= 20 && v[1] > 0)
    .sort((a, b) => b[1][1] / b[1][0] - a[1][1] / a[1][0]).slice(0, 6);
  $('#h-keys').replaceChildren(...(rows.length ? [h('i', '', 'Most mistyped keys'), ...rows.map(([k, v]) => {
    const row = document.createElement('div'), bar = document.createElement('span');
    row.className = 'keyrow';
    bar.style.width = Math.min(100, (v[1] / v[0]) * 400) + '%';
    row.append(h('b', '', k), bar, h('small', '', fmt1((v[1] / v[0]) * 100) + '% missed'));
    return row;
  })] : []));
}

function renderHistory() {
  const d = store.load(), T = d.totals, res = d.results;
  const avg = res.length ? res.reduce((a, r) => a + r.wpm, 0) / res.length : 0;
  const tiles = [[fmt1(d.bestWpm), 'Best WPM'], [fmt1(d.bestAcc) + '%', 'Best accuracy'], [avg ? fmt1(avg) : '–', 'Average WPM'],
    [T.words.toLocaleString(), 'Words typed'], [fmtTime(T.ms), 'Typing time'], [fmtTime(T.longest), 'Longest session'],
    [d.completed, 'Tests finished'], [d.booksDone, 'Books finished']];
  el.hBest.replaceChildren(...tiles.map(([v, l]) => { const div = document.createElement('div'); div.append(h('b', '', v), h('i', '', l)); return div; }));
  renderGraph(res);
  renderKeys(d.keys);
  $('#h-ach').replaceChildren(...achievements(d).map(([n, ok]) => h('span', ok ? 'on' : '', (ok ? '✓ ' : '· ') + n)));
  if (!res.length) { el.hList.replaceChildren(h('li', 'empty', 'Start typing to build your statistics.')); return; }
  el.hList.replaceChildren(...res.map((r) => {
    const li = document.createElement('li');
    li.append(h('span', 'f', r.filename), h('span', 'w', fmt1(r.wpm) + ' WPM'), h('span', 'm', fmt1(r.accuracy) + '%'),
      h('span', 'm', r.errors + ' errors'), h('span', 'd', fmtTime(r.elapsedTime) + ' · ' + new Date(r.timestamp).toLocaleString()));
    return li;
  }));
}

async function exportData() {
  let books = [], texts = [];
  try {
    [books, texts] = await new Promise((resolve, reject) => {
      const tx = DB.transaction(['books', 'texts'], 'readonly');
      const bookRequest = tx.objectStore('books').getAll();
      const textRequest = tx.objectStore('texts').getAll();
      tx.oncomplete = () => resolve([bookRequest.result || [], textRequest.result || []]);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } catch { toast('Could not read the saved library for export.'); return; }
  // Built from separate pieces so a large library never needs one giant string.
  const parts = [`{"app":"novel-type","version":2,"exportedAt":${Date.now()},"settings":${JSON.stringify({ ...S.set, view: S.pref || S.set.view })},"history":${JSON.stringify(store.load())},"books":${JSON.stringify(books)},"texts":[`];
  texts.forEach((t, i) => { if (i) parts.push(','); parts.push(JSON.stringify(t)); });
  parts.push(']}');
  const blob = new Blob(parts, { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'novel-type-data.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
// Repairs book records from old versions or imported files so the UI never meets a missing field.
function cleanMeta(b) {
  if (!b || typeof b !== 'object') return null;
  const st = b.stats && typeof b.stats === 'object' ? b.stats : {};
  return {
    ...b, id: String(b.id ?? ''), title: String(b.title ?? 'Untitled'), author: String(b.author ?? ''),
    chars: Math.max(1, num(b.chars, 1)), words: num(b.words), pos: Math.max(0, num(b.pos)), lastOpened: num(b.lastOpened, Date.now()),
    chapters: Array.isArray(b.chapters) ? b.chapters.filter((c) => c && typeof c.title === 'string' && Number.isFinite(c.start)).sort((x, y) => x.start - y.start) : [],
    bookmarks: Array.isArray(b.bookmarks) ? b.bookmarks.filter((x) => x && Number.isFinite(x.pos)) : [],
    stats: { sessions: num(st.sessions), ms: num(st.ms), correct: num(st.correct), attempts: num(st.attempts), errors: num(st.errors), words: num(st.words), best: num(st.best) }
  };
}

// Progress, stats and bookmarks are matched to books by title and length; books not yet in the library wait until re-added.
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'novel-type') throw new Error('bad file');
    store.save({ ...blankData(), ...(data.history && typeof data.history === 'object' ? data.history : {}) });
    if (data.settings && typeof data.settings === 'object') { S.set = { ...SET_DEFAULT, ...data.settings }; S.pref = S.set.view; if (mobileTypingRestricted() || S.doc?.format === 'pdf') S.set.view = 'read'; applySettings(); syncSettingsUI(); }
    const existing = DB ? (await idb('books', 'readonly', (t) => t.objectStore('books').getAll())).map(cleanMeta).filter(Boolean) : [];
    const textById = new Map((Array.isArray(data.texts) ? data.texts : []).filter((t) => t && typeof t.text === 'string').map((t) => [t.id, t]));
    const pending = {};
    for (const raw of Array.isArray(data.books) ? data.books : []) {
      const b = cleanMeta(raw);
      if (!b || !b.id) continue;
      const carry = { pos: b.pos, progress: b.progress, stats: b.stats, bookmarks: b.bookmarks || [], lastOpened: b.lastOpened };
      const cur = existing.find((x) => fp(x) === fp(b));
      if (cur) await idb('books', 'readwrite', (t) => t.objectStore('books').put({ ...cur, ...carry }));
      else if (textById.has(b.id)) {
        await idb(['books', 'texts'], 'readwrite', (t) => {
          t.objectStore('books').put(b);
          t.objectStore('texts').put(textById.get(b.id));
        });
      } else pending[fp(b)] = carry;
    }
    writePending(pending);
    renderHistory();
    renderLibrary();
    toast((data.texts?.length ? 'Backup restored, including saved books.' : 'Data imported. Add missing books again to restore their progress.'));
  } catch { toast('That file is not a Novel Type export.'); }
}
function openHistory() { renderHistory(); disarmClear(); openPanel(el.hist); }
function disarmClear() { clearTimeout(S.clearArmed); S.clearArmed = 0; el.hClear.textContent = 'Clear history'; el.hClear.classList.remove('armed'); }
function onClear() {
  if (!S.clearArmed) {
    el.hClear.textContent = 'Click again to confirm';
    el.hClear.classList.add('armed');
    S.clearArmed = setTimeout(disarmClear, 3000);
    return;
  }
  store.save(blankData());
  disarmClear();
  renderHistory();
  refreshBest();
}

/* ================= Theme ================= */
const FONTS = {
  mono: "'JetBrains Mono','Roboto Mono',ui-monospace,Menlo,Consolas,monospace",
  serif: "'Source Serif 4',Georgia,serif",
  merri: "'Merriweather',Georgia,serif",
  atk: "'Atkinson Hyperlegible',system-ui,sans-serif",
  sans: "'Inter',system-ui,sans-serif"
};
const SET_KEY = 'novelType:settings';
const SET_DEFAULT = { theme: 'dark', font: 'serif', size: 1.6, lh: 1.75, ls: 0, w: 100, mode: 'normal', view: 'type', blind: 0, sound: 'off', goal: 'none' };
const SET_IDS = { theme: 'set-theme', font: 'set-font', size: 'set-size', lh: 'set-lh', ls: 'set-ls', w: 'set-w', mode: 'set-mode', view: 'set-view', blind: 'set-blind', sound: 'set-sound', goal: 'set-goal' };

function loadSettings() {
  try {
    const legacy = localStorage.getItem(THEME_KEY);
    const out = { ...SET_DEFAULT, ...(legacy ? { theme: legacy } : {}), ...JSON.parse(localStorage.getItem(SET_KEY) || '{}') };
    if (out.w > 100) out.w = 100; // older versions stored the width in pixels
    return out;
  } catch { return { ...SET_DEFAULT }; }
}
function applySettings() {
  const r = document.documentElement, v = S.set;
  if (S.doc?.format === 'pdf') v.view = 'read';
  r.dataset.theme = v.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : v.theme;
  r.style.setProperty('--fs', v.size + 'rem');
  r.style.setProperty('--lhr', v.lh);
  r.style.setProperty('--ls', v.ls + 'em');
  r.style.setProperty('--w', v.w + '%');
  r.style.setProperty('--reader', FONTS[v.font] || FONTS.mono);
  document.body.dataset.view = v.view;
  document.body.dataset.home = 'radiance';
  const pdfReadOnly = S.doc?.format === 'pdf';
  $('#btn-view').disabled = pdfReadOnly;
  $('#btn-view').textContent = pdfReadOnly ? 'Read only' : v.view === 'read' ? 'Type' : 'Read';
  const viewSetting = document.getElementById('set-view');
  if (viewSetting) viewSetting.disabled = pdfReadOnly;
  try { localStorage.setItem(SET_KEY, JSON.stringify({ ...v, view: S.pref || v.view })); localStorage.setItem(THEME_KEY, r.dataset.theme); } catch { /* ignore */ }
}
function syncSettingsUI() { for (const k in SET_IDS) document.getElementById(SET_IDS[k]).value = S.set[k]; }
function onSettingsInput() {
  const prevView = S.set.view;
  for (const k in SET_IDS) {
    const val = document.getElementById(SET_IDS[k]).value;
    S.set[k] = typeof SET_DEFAULT[k] === 'number' ? +val : val;
  }
  if (S.set.view !== prevView) { S.set.view = prevView; toggleView(); }
  applySettings();
  if (S.doc) { S.lineH = parseFloat(getComputedStyle(el.words).lineHeight) || S.lineH; renderWindow(S.ws); placeCaret(); }
}
function toggleTheme() {
  const order = ['dark', 'light', 'vintage'];
  S.set.theme = order[(order.indexOf(document.documentElement.dataset.theme) + 1) % order.length];
  applySettings();
  syncSettingsUI();
}
async function toggleFocus() {
  const on = document.body.classList.toggle('focus');
  $('#btn-focus').setAttribute('aria-pressed', String(on));
  if (on) {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      toast('Focus mode. Press Esc to exit.');
    } catch {
      toast('Focus mode is on. Fullscreen is unavailable here.');
    }
  } else {
    el.toast.classList.remove('show');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  if (S.doc) focusCap();
}
function toggleView() {
  if (S.doc?.format === 'pdf') {
    S.set.view = 'read';
    applySettings();
    syncSettingsUI();
    toast('PDFs are read-only.');
    return;
  }
  if (mobileTypingRestricted() && S.set.view === 'read') {
    syncSettingsUI();
    toast('This feature is for desktops only.');
    return;
  }
  S.set.view = S.set.view === 'read' ? 'type' : 'read';
  S.pref = S.set.view;
  applySettings();
  syncSettingsUI();
  setState(S.state);
  if (!S.doc) return;
  if (S.set.view === 'type') { jumpTo(S.doc.pos ?? S.from, false); return; }
  if (S.state === 'typing') pause();
  const pos = S.idx;
  selectReadChapter(Math.max(0, chapterAt(S.doc.chapters, pos)), pos);
}

// Blind typing: each new line is shown for a few seconds, then upcoming text is hidden.
function revealBlind() {
  document.body.classList.remove('blind');
  clearTimeout(S.blindT);
  if (S.set.blind > 0) S.blindT = setTimeout(() => document.body.classList.add('blind'), S.set.blind * 1000);
}

let audio = null;
function playKey() {
  const kind = S.set.sound;
  if (kind === 'off') return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audio = audio || new Audio();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const t = audio.currentTime;
    const tone = (freq, type, peak, length, endFreq = freq) => {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + length);
      gain.gain.setValueAtTime(Math.max(.0001, peak), t);
      gain.gain.exponentialRampToValueAtTime(.0001, t + length);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + length);
    };
    if (kind === 'soft') {
      tone(500 + Math.random() * 90, 'sine', .028, .075, 390);
      tone(980, 'sine', .006, .024, 760);
    } else if (kind === 'mech') {
      tone(145 + Math.random() * 45, 'square', .018, .035, 85);
      tone(720 + Math.random() * 160, 'triangle', .012, .018, 260);
    } else if (kind === 'type') {
      tone(1250 + Math.random() * 220, 'triangle', .024, .035, 520);
      tone(260, 'sine', .015, .065, 105);
      tone(1700, 'sine', .008, .016, 960);
    }
  } catch { /* audio is optional; typing continues when the browser blocks it */ }
}

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 4500);
}
function openPanel(d) { if (S.state === 'typing') pause(); d.showModal(); }

/* ================= Library ================= */
function ago(t) { const d = Math.floor((Date.now() - t) / 86400000); return d < 1 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; }

function progressBar(pct) {
  const bar = h('span', 'prog', ''), fill = document.createElement('i');
  fill.style.width = pct + '%';
  bar.append(fill);
  return bar;
}

function bookRow(b) {
  const pct = Math.min(100, Math.floor((b.pos / b.chars) * 100) || 0), st = b.stats;
  const wpm = st.ms > 5000 ? Math.round(st.correct / 5 / (st.ms / 60000)) : 0;
  const ci = b.chapters.length ? chapterAt(b.chapters, b.pos) : -1;
  const open = h('button', 'lib-open', '');
  open.append(
    h('b', '', b.title),
    h('span', '', [b.author, ci >= 0 ? chapterName(b, ci) : ''].filter(Boolean).join(' · ')),
    h('span', '', [`${pct}% complete`, wpm ? `${wpm} WPM average` : '', 'Opened ' + ago(b.lastOpened)].filter(Boolean).join(' · ')),
    progressBar(pct)
  );
  open.addEventListener('click', () => { window.location.href = readerUrl(b.id); });
  const del = h('button', 'ghost danger', 'Remove');
  let armed = 0;
  del.addEventListener('click', () => {
    if (!armed) {
      del.textContent = 'Delete book and progress?';
      armed = setTimeout(() => { armed = 0; del.textContent = 'Remove'; }, 3500);
      return;
    }
    clearTimeout(armed);
    idb(['books', 'texts'], 'readwrite', (t) => { t.objectStore('books').delete(b.id); t.objectStore('texts').delete(b.id); }).then(renderLibrary);
  });
  const li = document.createElement('li');
  li.append(open, del);
  return li;
}

async function renderLibrary() {
  let books = [];
  try { books = (await idb('books', 'readonly', (t) => t.objectStore('books').getAll())).map(cleanMeta).filter(Boolean); } catch { /* storage unavailable */ }
  books.sort((a, b) => b.lastOpened - a.lastOpened);
  el.lib.replaceChildren(...books.map(bookRow));
  $('#tag-sub').textContent = books.length ? 'Pick up where you left off, or add another book.' : 'Your library is empty. Upload an EPUB or PDF, choose where the story begins, and read it one keystroke at a time.';
  $('#lib').hidden = !books.length;
  el.drop.classList.toggle('compact', books.length > 0);
  $('#drop .big').textContent = books.length ? 'Add another book' : 'Upload EPUB or PDF';
}

async function openBook(id) {
  if (S.state === 'loading') return;
  setState('loading');
  setProgress(100, 'Opening book…');
  try {
    let [meta, txt] = await Promise.all([
      idb('books', 'readonly', (t) => t.objectStore('books').get(id)),
      idb('texts', 'readonly', (t) => t.objectStore('texts').get(id))
    ]);
    if (!meta || !txt) throw new Error('missing');
    meta = cleanMeta(meta);
    meta.lastOpened = Date.now();
    if (meta.storyStart === undefined) { const st = detectStory(meta.chapters || [], meta.chars); meta.storyStart = st.start; meta.storyEnd = st.end; }
    loadText({ ...meta, name: meta.title, text: txt.text, pageStarts: txt.pageStarts });
    saveBook();
  } catch {
    if (IS_READER_PAGE) { goHome(); return; }
    setState('upload');
    renderLibrary();
    showError('This book could not be opened. It may have been removed.');
  }
}

/* ================= Navigation: contents, search, jumping ================= */
// Where the reader is: the cursor while typing, the top of the page while reading.
function curPos() { return S.set.view === 'read' ? (S.doc.pos ?? S.idx) : S.idx; }

function jumpTo(pos, commit = true) {
  if (S.set.view === 'read' && S.doc.chapters.length) {
    const i = Math.max(0, chapterAt(S.doc.chapters, pos));
    selectReadChapter(i, pos);
    return;
  }
  if (commit && S.attempts > 0 && S.set.view !== 'read') {
    if (S.state === 'typing') pause();
    commitSession(sessionResult());
  }
  if (S.to <= pos) S.to = S.doc.storyEnd > pos ? S.doc.storyEnd : S.target.length;
  S.from = snapStart(pos);
  setState('ready');
  applyRange(S.from);
  S.doc.pos = S.from;
  saveBook();
}

function stepChapter(dir) {
  const ch = S.doc.chapters;
  if (!ch.length) return;
  const at = curPos(), ci = chapterAt(ch, at);
  const t = dir > 0 ? ch[ci + 1] : (ci >= 0 && at > ch[ci].start ? ch[ci] : ch[ci - 1]);
  if (t) jumpTo(t.start);
}

function openToc() {
  const d = S.doc, ch = d.chapters, now = ch.length ? chapterAt(ch, curPos()) : -1;
  el.tocList.replaceChildren(...(ch.length ? ch.map((c, i) => {
    const [no, rest] = chapterParts(d, i);
    const b = h('button', 'toc-row', '');
    b.append(h('span', 'ch-no', no), h('span', 'ch-title', rest));
    b.addEventListener('click', () => { el.toc.close(); jumpTo(c.start); });
    const li = document.createElement('li');
    if (i === now) li.className = 'now';
    li.append(b);
    return li;
  }) : [h('li', 'empty', 'No chapters detected in this book.')]));
  renderBookmarks();
  openPanel(el.toc);
  requestAnimationFrame(() => { const n = el.tocList.querySelector('.now'); if (n) n.scrollIntoView({ block: 'center' }); });
}

function renderBookmarks() {
  const bms = S.doc.bookmarks;
  $('#bm-list').replaceChildren(...(bms.length ? bms.map((bm, i) => {
    const ci = S.doc.chapters.length ? chapterAt(S.doc.chapters, bm.pos) : -1;
    const b = h('button', '', '');
    b.append(h('small', '', ci >= 0 ? chapterName(S.doc, ci) + '  ' : ''), document.createTextNode('“' + bm.snippet + '…”'));
    b.addEventListener('click', () => { el.toc.close(); jumpTo(bm.pos); });
    const x = h('button', 'bm-x', '×');
    x.setAttribute('aria-label', 'Remove bookmark');
    x.addEventListener('click', () => { S.doc.bookmarks.splice(i, 1); saveBook(); renderBookmarks(); });
    const li = document.createElement('li');
    li.className = 'bm';
    li.append(b, x);
    return li;
  }) : [h('li', 'empty', 'No bookmarks yet.')]));
}

function addBookmark() {
  const pos = S.set.view === 'read' ? S.ws + lineStart(S.vl) : S.idx;
  S.doc.bookmarks.push({ pos, snippet: S.target.slice(pos, pos + 70).join('').replace(/\n/g, ' '), t: Date.now() });
  saveBook();
  renderBookmarks();
}

function openSearch() { openPanel(el.search); el.q.select(); runSearch(); }

// Lower-casing some characters changes the string length, which would misalign hit positions; those stay as they are.
const foldCase = (t) => t.replace(/\p{Lu}/gu, (c) => { const l = c.toLowerCase(); return l.length === c.length ? l : c; });
function runSearch() {
  const q = foldCase(el.q.value.trim());
  if (q.length < 2) { el.qList.replaceChildren(h('li', 'empty', q ? 'Keep typing…' : 'Search this book.')); return; }
  const lower = S.lower || (S.lower = foldCase(S.doc.text));
  const hits = [];
  for (let i = lower.indexOf(q); i !== -1 && hits.length < 60; i = lower.indexOf(q, i + 1)) hits.push(i);
  if (!hits.length) { el.qList.replaceChildren(h('li', 'empty', 'No matches found.')); return; }
  const flat = S.doc.text.length === S.target.length;
  el.qList.replaceChildren(...hits.map((u) => {
    const cp = flat ? u : Array.from(S.doc.text.slice(0, u)).length;
    const part = (a, b) => S.target.slice(Math.max(0, a), b).join('').replace(/\n/g, ' ');
    const ci = S.doc.chapters.length ? chapterAt(S.doc.chapters, cp) : -1;
    const m = document.createElement('mark');
    m.textContent = part(cp, cp + q.length);
    const b = h('button', '', '');
    b.append(h('small', '', ci >= 0 ? chapterName(S.doc, ci) + '  ' : ''), document.createTextNode('…' + part(cp - 35, cp)), m, document.createTextNode(part(cp + q.length, cp + q.length + 45) + '…'));
    b.addEventListener('click', () => { el.search.close(); jumpTo(cp); });
    const li = document.createElement('li');
    li.append(b);
    return li;
  }));
}

/* ================= Keyboard handling ================= */
function onKeydown(e) {
  if (document.querySelector('dialog[open]')) return;
  if ((e.target instanceof HTMLInputElement && e.target !== el.cap) || e.target instanceof HTMLSelectElement) return;
  if (!el.chapterMenu.hidden) {
    const options = [...el.chapterMenu.querySelectorAll('.chapter-option')];
    const at = options.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); setChapterMenu(false); el.chapterButton.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, (at < 0 ? 0 : at) + (e.key === 'ArrowDown' ? 1 : -1)));
      options[next]?.focus(); return;
    }
    if (e.key === 'Enter' && at >= 0) { e.preventDefault(); options[at].click(); return; }
  }
  const st = S.state;
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); toggleTheme(); return; }
  const inBook = S.doc && (st === 'ready' || st === 'typing' || st === 'paused');
  if (inBook && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
  if (inBook && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFocus(); return; }
  if (inBook && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); stepChapter(e.key === 'ArrowDown' ? 1 : -1); return; }
  if (st === 'loading') return;
  if (e.key === 'Escape') { e.preventDefault(); if (document.body.classList.contains('focus')) toggleFocus(); else exitTest(); return; }
  if (e.key === 'Tab') {
    if (st !== 'upload' && S.set.view !== 'read') {
      e.preventDefault();
      if (!e.repeat) { if (st === 'typing' || st === 'paused') restartSession(); else if (st === 'results') retry(); }
    }
    return;
  }
  if (st === 'results') { // arrow keys move between Continue / Retry / Library; Enter presses the focused one
    const btns = [$('#btn-continue'), $('#btn-retry'), $('#btn-new')].filter((b) => !b.hidden);
    const at = btns.indexOf(document.activeElement);
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      btns[at < 0 ? (dir > 0 ? 0 : btns.length - 1) : (at + dir + btns.length) % btns.length].focus();
    } else if (e.key === 'Enter' && at < 0 && !e.repeat) {
      e.preventDefault();
      if (S.partial) cont(); else retry();
    }
    return;
  }
  if (st !== 'ready' && st !== 'typing' && st !== 'paused') return;
  if (S.set.view === 'read') { // reading mode: keys scroll, nothing is typed
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'Home') { e.preventDefault(); browseToEnd(false); }
      else if (e.key === 'End') { e.preventDefault(); browseToEnd(true); }
      else if (e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); browsePage(1); }
      else if (e.key === 'PageUp') { e.preventDefault(); browsePage(-1); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); browse(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const chapters = S.doc.chapters || [];
        if (chapters.length) {
          const current = Math.max(0, chapterAt(chapters, curPos()));
          const next = current + (e.key === 'ArrowRight' ? 1 : -1);
          if (next >= 0 && next < chapters.length) chooseChapter(next);
        }
      }
    }
    return;
  }
  if (e.ctrlKey && !e.altKey && e.key === 'Backspace') { e.preventDefault(); backspaceWord(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (st === 'typing') pause(); else if (st === 'paused') resume(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.getModifierState('AltGraph')) return;
  if (e.key === 'Backspace') { e.preventDefault(); backspace(); return; }
  const dead = e.key === 'Dead' || e.key === 'Unidentified' ? DEAD[e.code] : null;
  const ch = e.key === 'Enter' ? '\n' : dead ? dead[e.shiftKey ? 1 : 0] : Array.from(e.key).length === 1 ? e.key : null;
  if (!ch) return;
  e.preventDefault();
  if (document.activeElement !== el.cap) focusCap();
  if (st !== 'typing') resume();
  typeChar(ch);
}

/* ================= Initialization ================= */
function init() {
  S.set = loadSettings();
  S.pref = S.set.view; // the reader's own choice; PDFs and phones override it only temporarily
  if (mobileTypingRestricted()) S.set.view = 'read';
  applySettings();
  syncSettingsUI();
  refreshBest();
  const mobileQuery = matchMedia('(max-width: 700px), (hover: none) and (pointer: coarse)');
  if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', switchMobileToReading);
  else mobileQuery.addListener(switchMobileToReading);

  el.file.addEventListener('change', () => { handleFile(el.file.files[0]); el.file.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => el.drop.addEventListener(t, () => el.drop.classList.remove('over')));
  el.drop.addEventListener('drop', (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });
  ['dragover', 'drop'].forEach((t) => window.addEventListener(t, (e) => e.preventDefault()));

  let suppressTouchClick = false;
  el.area.addEventListener('click', (e) => {
    if (suppressTouchClick) { suppressTouchClick = false; return; }
    if (S.set.view === 'read') {
      const r = el.viewport.getBoundingClientRect();
      browsePage(e.clientX < r.left + r.width * .28 ? -1 : 1);
      return;
    }
    focusCap();
  });
  let touchStart = null, pendingReadScroll = 0, readScrollFrame = 0;
  const syncReadScrollPosition = () => {
    if (S.set.view !== 'read' || !S.doc) return;
    const p = S.ws + lineStart(S.vl);
    S.doc.pos = p;
    S.doc.progress = p >= S.from && p < S.to ? { from: S.from, to: S.to, pos: p } : null;
    clearTimeout(S.rt);
    S.rt = setTimeout(saveBook, 500);
    updateStats();
    syncReaderNav();
  };
  const scrollReadBy = (pixels) => {
    if (!pixels || !S.lineH) return;
    const lines = pixels / S.lineH;
    const next = S.vl + lines;
    if (next < 0 && S.ws > S.from) {
      const remainder = next;
      browse(-1);
      setView(S.vl + remainder);
    } else setView(next);
  };
  const flushReadScroll = () => {
    readScrollFrame = 0;
    const delta = pendingReadScroll;
    pendingReadScroll = 0;
    scrollReadBy(delta);
  };
  const stopReadTouch = () => {
    touchStart = null;
    if (readScrollFrame) { cancelAnimationFrame(readScrollFrame); flushReadScroll(); }
    document.body.classList.remove('read-touch-scrolling');
  };
  el.viewport.addEventListener('touchstart', (e) => {
    if (S.set.view !== 'read' || e.touches.length !== 1) { stopReadTouch(); return; }
    if (readScrollFrame) { cancelAnimationFrame(readScrollFrame); flushReadScroll(); }
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, lastY: e.touches[0].clientY, axis: '' };
  }, { passive: true });
  el.viewport.addEventListener('touchmove', (e) => {
    if (!touchStart || S.set.view !== 'read' || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStart.x, dy = touch.clientY - touchStart.y;
    if (!touchStart.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) touchStart.axis = Math.abs(dy) >= Math.abs(dx) ? 'vertical' : 'horizontal';
    if (!touchStart.axis) return;
    e.preventDefault();
    if (touchStart.axis === 'vertical') {
      document.body.classList.add('read-touch-scrolling');
      pendingReadScroll += touchStart.lastY - touch.clientY;
      if (!readScrollFrame) readScrollFrame = requestAnimationFrame(flushReadScroll);
    }
    touchStart.lastY = touch.clientY;
  }, { passive: false });
  el.viewport.addEventListener('touchend', (e) => {
    if (!touchStart || S.set.view !== 'read') { stopReadTouch(); return; }
    const gesture = touchStart;
    const t = e.changedTouches[0], dx = t.clientX - gesture.x, dy = t.clientY - gesture.y;
    stopReadTouch();
    if (!gesture.axis) return;
    suppressTouchClick = true;
    setTimeout(() => { suppressTouchClick = false; }, 500);
    if (gesture.axis === 'vertical') { syncReadScrollPosition(); return; }
    if (gesture.axis === 'horizontal' && Math.abs(dx) >= 44) {
      const chapters = S.doc?.chapters || [];
      if (chapters.length) {
        const current = Math.max(0, chapterAt(chapters, curPos()));
        const next = current + (dx < 0 ? 1 : -1);
        if (next >= 0 && next < chapters.length) chooseChapter(next);
      }
    }
  }, { passive: true });
  el.viewport.addEventListener('touchcancel', () => { stopReadTouch(); syncReadScrollPosition(); }, { passive: true });
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', () => { if (S.doc && ['ready', 'typing', 'paused'].includes(S.state)) { S.lineH = parseFloat(getComputedStyle(el.words).lineHeight) || S.lineH; measureCharGeometry(); moveCaret(); } });

  $('#btn-theme').addEventListener('click', toggleTheme);
  $('#btn-history').addEventListener('click', openHistory);
  $('#brand').addEventListener('click', (e) => { e.preventDefault(); exitTest(); });
  $('#btn-retry').addEventListener('click', retry);
  $('#btn-new').addEventListener('click', newPdf);
  $('#h-close').addEventListener('click', () => el.hist.close());
  el.hist.addEventListener('click', (e) => { if (e.target === el.hist) el.hist.close(); });
  el.hist.addEventListener('close', () => { disarmClear(); if (['ready', 'typing', 'paused'].includes(S.state)) focusCap(); });
  el.hClear.addEventListener('click', onClear);

  el.pause.addEventListener('click', () => (S.state === 'typing' ? pause() : resume()));
  $('#btn-continue').addEventListener('click', cont);
  $('#btn-reset-range').addEventListener('click', () => { S.from = S.doc.storyStart || 0; S.to = S.doc.storyEnd || S.target.length; applyRange(S.from); focusCap(); });
  $('#btn-whole').addEventListener('click', () => { S.from = 0; S.to = S.target.length; applyRange(0); focusCap(); });
  el.cFrom.addEventListener('change', applyChapters);
  el.cTo.addEventListener('change', applyChapters);
  el.chapterButton.addEventListener('click', () => setChapterMenu(el.chapterMenu.hidden, el.chapterMenu.hidden));
  el.chapterMenu.addEventListener('click', (e) => {
    const option = e.target.closest('.chapter-option');
    if (!option) return;
    chooseChapter(+option.dataset.chapter);
    setChapterMenu(false);
    el.chapterButton.focus();
  });
  document.addEventListener('click', (e) => { if (!el.chapterPicker.contains(e.target)) setChapterMenu(false); });
  el.chapterPrev.addEventListener('click', () => chooseChapter(Math.max(0, chapterAt(S.doc.chapters, curPos()) - 1)));
  el.chapterNext.addEventListener('click', () => chooseChapter(Math.min(S.doc.chapters.length - 1, chapterAt(S.doc.chapters, curPos()) + 1)));

  // Drag over the text to select a portion; click a word to start there; shift+click to end there.
  const drag = { on: false, a: 0, x: 0, y: 0, moved: false, prevTo: 0, timer: 0 };
  const idxOf = (t) => { const sp = t && t.closest && t.closest('.ch'); return sp ? S.ws + S.chars.indexOf(sp) : -1; };
  const viewTop = () => S.ws + lineStart(S.vl);
  const dragTo = (j) => {
    if (!drag.on || j < 0) return;
    if (j !== drag.a) drag.moved = true;
    S.from = snapStart(Math.min(drag.a, j));
    S.to = Math.max(snapEnd(Math.max(drag.a, j) + 1), S.from + 1);
    S.chars.forEach((c, k) => c.classList.toggle('out', S.ws + k < S.from || S.ws + k >= S.to));
    syncRange();
  };
  el.words.addEventListener('mousedown', (e) => {
    if (S.state !== 'ready' || S.set.view === 'read' || e.button !== 0) return;
    const i = idxOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    if (e.shiftKey) { S.to = Math.max(snapEnd(i + 1), S.from + 1); applyRange(viewTop()); return; }
    Object.assign(drag, { on: true, a: i, moved: false, prevTo: S.to, x: e.clientX, y: e.clientY });
    drag.timer = setInterval(() => { // scroll while dragging near the top or bottom edge
      const r = el.viewport.getBoundingClientRect();
      if (drag.y < r.top + 20) browse(-1); else if (drag.y > r.bottom - 20) browse(1); else return;
      const x = Math.min(Math.max(drag.x, r.left + 5), r.right - 5), y = Math.min(Math.max(drag.y, r.top + 5), r.bottom - 5);
      dragTo(idxOf(document.elementFromPoint(x, y)));
    }, 90);
  });
  el.words.addEventListener('mouseover', (e) => dragTo(idxOf(e.target)));
  document.addEventListener('mousemove', (e) => { if (drag.on) { drag.x = e.clientX; drag.y = e.clientY; } });
  document.addEventListener('mouseup', () => {
    if (!drag.on) return;
    drag.on = false;
    clearInterval(drag.timer);
    if (!drag.moved) { S.from = snapStart(drag.a); S.to = drag.prevTo > S.from ? drag.prevTo : S.target.length; }
    applyRange(viewTop());
    focusCap();
  });
  // Scroll the text freely while not typing; typing snaps the view back to the cursor.
  let wheel = 0;
  el.area.addEventListener('wheel', (e) => {
    if (S.state !== 'ready' && S.state !== 'paused') return;
    e.preventDefault();
    wheel = Math.max(-120, Math.min(120, wheel + e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1)));
    while (Math.abs(wheel) >= 40) { browse(wheel > 0 ? 1 : -1); wheel -= Math.sign(wheel) * 40; }
  }, { passive: false });
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.state === 'typing') pause(); });
  window.addEventListener('pagehide', () => {
    if (S.set.view === 'read' && S.doc) { clearTimeout(S.rt); saveBook(); }
    else saveProgress();
  });

  $('#btn-search').addEventListener('click', openSearch);
  $('#btn-toc').addEventListener('click', openToc);
  $('#btn-focus').addEventListener('click', toggleFocus);
  $('#btn-settings').addEventListener('click', () => { syncSettingsUI(); openPanel(el.settings); });
  el.settings.addEventListener('input', onSettingsInput);
  el.settings.addEventListener('change', onSettingsInput);
  let searchTimer = 0;
  el.q.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 150); });
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    d.addEventListener('close', () => { if (S.doc && ['ready', 'typing', 'paused'].includes(S.state)) focusCap(); });
  });
  $('#btn-view').addEventListener('click', toggleView);
  $('#btn-library').addEventListener('click', () => {
    if (S.set.view !== 'read' && ['typing', 'paused'].includes(S.state)) leave();
    else goHome();
  });
  $('#bm-add').addEventListener('click', addBookmark);
  $('#h-export').addEventListener('click', exportData);
  $('#h-import').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

  // Settings tooltips: a small rounded bubble next to the pointer. It fades in gently and out quickly.
  const tip = $('#tip');
  let tipEl = null, tx = 0, ty = 0, raf = 0;
  const tipPlace = () => {
    raf = 0;
    const w = tip.offsetWidth, ht = tip.offsetHeight;
    const x = Math.max(12, Math.min(tx + 14, innerWidth - w - 12));
    const y = ty - ht - 14 < 12 ? ty + 22 : ty - ht - 14;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  };
  const tipShow = (t, e) => {
    tipEl = t;
    tip.replaceChildren(h('b', '', (t.firstChild ? t.firstChild.textContent : '').trim()), document.createTextNode(t.dataset.tip));
    const r = t.getBoundingClientRect();
    tx = e ? e.clientX : r.left + 40;
    ty = e ? e.clientY : r.top;
    tipPlace();
    tip.classList.add('show');
  };
  const tipHide = () => { tipEl = null; tip.classList.remove('show'); };
  el.settings.addEventListener('pointerover', (e) => {
    const t = e.target.closest('.opt[data-tip]');
    if (t && t !== tipEl) tipShow(t, e);
  });
  el.settings.addEventListener('pointermove', (e) => {
    if (!e.target.closest('.opt[data-tip]')) { tipHide(); return; }
    if (tipEl) { tx = e.clientX; ty = e.clientY; if (!raf) raf = requestAnimationFrame(tipPlace); }
  });
  el.settings.addEventListener('pointerout', (e) => {
    const t = e.target.closest('.opt[data-tip]');
    if (t && !t.contains(e.relatedTarget)) tipHide();
  });
  el.settings.addEventListener('focusin', (e) => {
    const t = e.target.closest('label')?.querySelector('.opt[data-tip]');
    if (t && t !== tipEl) tipShow(t, null);
  });
  el.settings.addEventListener('focusout', tipHide);
  el.settings.addEventListener('close', tipHide);

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.set.theme === 'system') applySettings(); });

  setState('upload');
  openDb().then(async () => {
    try { await navigator.storage?.persist?.(); } catch { /* browser may decline durable storage */ }
    await renderLibrary();
    if (!IS_READER_PAGE) return;
    const id = new URLSearchParams(location.search).get('book');
    if (!id) { goHome(); return; }
    openBook(id);
  }).catch(() => {
    toast('Your browser blocked local storage, so your library and progress cannot be saved.');
    if (IS_READER_PAGE) goHome();
  });
}

init();
