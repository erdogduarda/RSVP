/* ═══════════════════════════════════════════════════
   FlashRead — RSVP Reader  |  app.js
   ═══════════════════════════════════════════════════ */

'use strict';

// ── PDF.js worker ──────────────────────────────────
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ── Constants ──────────────────────────────────────
const STORAGE_KEY = 'flashread_v2';
const FONT_SIZES  = ['small', 'medium', 'large', 'xlarge'];

const DEFAULTS = {
  wpm:           250,
  fontSize:      'large',
  theme:         'light',
  showORP:       true,
  chunkSize:     1,
  sentencePause: true,
  longWordPause: true,
  savePosition:  true,
};

// ── App state ──────────────────────────────────────
let words          = [];
let index          = 0;
let isPlaying      = false;
let timer          = null;
let fileName       = '';
let settings       = loadSettings();
let isDragging     = false;
let pdfDocRef      = null;
let pageWordRanges = [];

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

// ── DOM helper ─────────────────────────────────────
const el = id => document.getElementById(id);

// ═══════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* quota */ }
}

// ═══════════════════════════════════════════════════
//  DISPLAY
// ═══════════════════════════════════════════════════

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char]);
}

function chunkText(chunk) {
  return chunk.map(token => token.text).join(' ');
}

function renderChunk(chunk) {
  const markup = chunk.map(token =>
    '<span class="word-segment">' + escapeHtml(token.text) + '</span>'
  ).join('<span class="word-gap"> </span>');

  el('partBefore').textContent = '';
  el('partAfter').textContent  = '';
  el('partOrp').innerHTML      = markup || '&nbsp;';

  // No shrinking for long words; font size is now smaller globally
}

function showChunk(chunk) {
  if (!chunk || chunk.length === 0) return;
  renderChunk(chunk);
  el('rsvpWord').animate(
    [
      { opacity: 0.15, transform: 'scaleY(0.93)' },
      { opacity: 1,    transform: 'scaleY(1)' }
    ],
    { duration: 90, easing: 'ease-out', fill: 'forwards' }
  );
}

// ═══════════════════════════════════════════════════
//  PROGRESS / UI
// ═══════════════════════════════════════════════════

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function updateUI(displayIndex = index) {
  const total = words.length;
  if (total === 0) return;

  const safeIndex = Math.max(0, Math.min(displayIndex, total - 1));
  const pct   = (safeIndex / total) * 100;
  const wpm   = settings.wpm;
  const elap  = (safeIndex / wpm) * 60000;
  const totMs = (total  / wpm) * 60000;
  const rem   = totMs - elap;

  el('progressFill').style.width  = pct + '%';
  el('progressThumb').style.left  = pct + '%';
  el('lblElapsed').textContent    = fmt(elap);
  el('lblTotal').textContent      = fmt(totMs);
  el('metaTime').textContent      = fmt(rem) + ' remaining';
  el('metaWords').textContent     = (safeIndex + 1).toLocaleString() + ' / ' + total.toLocaleString() + ' words';
  markCurrentPage(undefined, safeIndex);
}

// ═══════════════════════════════════════════════════
//  RSVP ENGINE
// ═══════════════════════════════════════════════════

function wordDelay(word) {
  const base = 60000 / settings.wpm;
  let mult = 1.0;

  if (settings.longWordPause && word.length > 8) {
    mult += Math.min((word.length - 8) * 0.06, 0.6);
  }

  if (settings.sentencePause) {
    const stripped = word.replace(/["'\u2019\u201d\u00bb\)\]]+$/, '');
    if (/[.!?]$/.test(stripped))   mult += 1.3;
    else if (/[,;:\u2014\u2013]$/.test(stripped)) mult += 0.55;
  }

  return Math.round(base * mult);
}

function step() {
  if (!isPlaying) return;

  if (index >= words.length) {
    pause();
    index = 0;
    showChunk(words.slice(0, settings.chunkSize));
    updateUI();
    return;
  }

  const end   = Math.min(index + settings.chunkSize, words.length);
  const chunk = words.slice(index, end);
  const shownIndex = index;
  showChunk(chunk);
  index = end;
  updateUI(shownIndex);

  if (settings.savePosition && fileName) {
    try { localStorage.setItem('fr_pos_' + fileName, shownIndex); } catch { /* quota */ }
  }

  const delay = wordDelay(chunkText(chunk));
  timer = setTimeout(step, delay);
}

function play() {
  if (words.length === 0) return;
  if (index >= words.length) index = 0;
  isPlaying = true;
  el('btnPlay').textContent = '\u23F8';
  el('btnPlay').classList.add('playing');
  step();
}

function pause() {
  isPlaying = false;
  clearTimeout(timer);
  el('btnPlay').textContent = '\u25B6';
  el('btnPlay').classList.remove('playing');
}

function togglePlay() {
  if (words.length === 0) return;
  isPlaying ? pause() : play();
}

function seek(newIdx) {
  const wasPlaying = isPlaying;
  pause();
  index = Math.max(0, Math.min(newIdx, words.length - 1));
  if (words.length > 0) {
    showChunk(words.slice(index, index + settings.chunkSize));
    updateUI(index);
  }
  if (wasPlaying) play();
}

// ═══════════════════════════════════════════════════
//  TEXT PROCESSING
// ═══════════════════════════════════════════════════

function createToken(text) {
  return { text: text };
}

function tokenizeText(text) {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(createToken);
}

function tokenizePdfItems(items) {
  var tokens = [];
  for (var i = 0; i < items.length; i++) {
    var value = items[i].str.trim();
    if (!value) continue;
    var parts = value.split(/\s+/);
    for (var j = 0; j < parts.length; j++) {
      if (parts[j]) tokens.push(createToken(parts[j]));
    }
  }
  return tokens;
}

function loadIntoReader(rawText, name, preWords) {
  var ws = preWords || tokenizeText(rawText);
  if (ws.length === 0) {
    alert('No readable text found.');
    return;
  }

  words     = ws;
  fileName  = name;
  index     = 0;
  isPlaying = false;
  clearTimeout(timer);

  closePageNav();
  var pageNavBtn = el('btnPageNav');
  if (preWords) {
    pageNavBtn.textContent = '\uD83D\uDCC4 Pages';
    pageNavBtn.classList.remove('hidden');
  } else {
    pageNavBtn.classList.add('hidden');
    pageWordRanges = [];
  }

  if (settings.savePosition && name) {
    try {
      var saved = parseInt(localStorage.getItem('fr_pos_' + name), 10);
      if (saved > 0 && saved < ws.length) index = saved;
    } catch { /* ignore */ }
  }

  el('metaFile').textContent  = name;
  el('metaWords').textContent = '1 / ' + ws.length.toLocaleString() + ' words';
  el('metaTime').textContent  = fmt((ws.length / settings.wpm) * 60000) + ' remaining';

  el('uploadView').classList.add('hidden');
  el('readerView').classList.remove('hidden');

  showChunk(words.slice(index, index + settings.chunkSize));
  updateUI();

  el('btnPlay').textContent = '\u25B6';
  el('btnPlay').classList.remove('playing');
}

// ═══════════════════════════════════════════════════
//  FILE HANDLERS
// ═══════════════════════════════════════════════════

async function handlePDF(file) {
  showLoading('Reading PDF\u2026');
  try {
    var buf = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    pdfDocRef      = pdf;
    pageWordRanges = [];

    var allWords = [];

    for (var p = 1; p <= pdf.numPages; p++) {
      el('loadingMsg').textContent = 'Processing page ' + p + ' of ' + pdf.numPages + '\u2026';
      var page    = await pdf.getPage(p);
      var content = await page.getTextContent();
      var pageItems = content.items
        .filter(function(item) { return item.str && item.str.trim(); })
        .map(function(item, idx) {
          return {
            idx: idx,
            str: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width || 0,
            height: item.height || Math.abs(item.transform[0]) || 0
          };
        });

      var pageWords = tokenizePdfItems(pageItems);
      if (pageWords.length === 0) continue;
      var start = allWords.length;
      allWords.push.apply(allWords, pageWords);
      var end = allWords.length - 1;
      pageWordRanges.push({ start: start, end: Math.max(end, start), pageNum: p });
    }

    hideLoading();
    loadIntoReader('', file.name, allWords);
    el('pnCount').textContent = pdf.numPages + ' pages';
    renderPageThumbnails(pdf);
  } catch (err) {
    hideLoading();
    alert('Could not read PDF: ' + err.message);
  }
}

async function handleTXT(file) {
  showLoading('Reading file\u2026');
  try {
    var text = await file.text();
    hideLoading();
    loadIntoReader(text, file.name);
  } catch (err) {
    hideLoading();
    alert('Could not read file: ' + err.message);
  }
}

function handleFile(file) {
  if (!file) return;
  var ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'pdf')       handlePDF(file);
  else if (ext === 'txt')  handleTXT(file);
  else alert('Please select a .pdf or .txt file.');
}

function showLoading(msg) {
  el('loadingMsg').textContent = msg || 'Loading\u2026';
  el('loadingOverlay').classList.remove('hidden');
}
function hideLoading() {
  el('loadingOverlay').classList.add('hidden');
}

// ═══════════════════════════════════════════════════
//  PAGE NAV
// ═══════════════════════════════════════════════════

function openPageNav() {
  el('pageNavPanel').classList.remove('hidden');
  el('pageNavOverlay').classList.remove('hidden');
  markCurrentPage(true);
}

function closePageNav() {
  el('pageNavPanel').classList.add('hidden');
  el('pageNavOverlay').classList.add('hidden');
}

function markCurrentPage(scroll, wordIndex) {
  if (wordIndex === undefined) wordIndex = index;
  if (pageWordRanges.length === 0) return;

  var curIdx = 0;
  for (var i = 0; i < pageWordRanges.length; i++) {
    if (wordIndex >= pageWordRanges[i].start) curIdx = i;
    else break;
  }

  el('btnPageNav').textContent = '\uD83D\uDCC4 Pg ' + pageWordRanges[curIdx].pageNum + ' / ' + pageWordRanges.length;

  var body = el('pageNavBody');
  body.querySelectorAll('.page-thumb-item').forEach(function(item, i) {
    var active = i === curIdx;
    item.classList.toggle('active', active);
    if (active && scroll) {
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

async function renderPageThumbnails(pdf) {
  var body       = el('pageNavBody');
  body.innerHTML = '';
  var SCALE      = 0.28;

  // Set max for page jump input
  var pnJumpInput = document.getElementById('pnJumpInput');
  if (pnJumpInput) pnJumpInput.max = pageWordRanges.length;

  for (var i = 0; i < pageWordRanges.length; i++) {
    var range = pageWordRanges[i];
    var item  = document.createElement('div');
    item.className       = 'page-thumb-item';
    item.dataset.pageIdx = i;
    item.innerHTML =
      '<div class="page-thumb-placeholder"><div class="thumb-spinner"></div></div>' +
      '<div class="page-thumb-label">Page ' + range.pageNum + '</div>';
    (function(r) {
      item.addEventListener('click', function() {
        seek(r.start);
        closePageNav();
      });
    })(range);
    body.appendChild(item);
  }

  for (var i = 0; i < pageWordRanges.length; i++) {
    try {
      var range    = pageWordRanges[i];
      var page     = await pdf.getPage(range.pageNum);
      var viewport = page.getViewport({ scale: SCALE });
      var canvas   = document.createElement('canvas');
      canvas.width     = viewport.width;
      canvas.height    = viewport.height;
      canvas.className = 'page-thumb-canvas';

      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;

      var itemEl      = body.children[i];
      var placeholder = itemEl.querySelector('.page-thumb-placeholder');
      if (placeholder) itemEl.replaceChild(canvas, placeholder);
    } catch(e) { /* leave placeholder on render error */ }
  }
}

// ═══════════════════════════════════════════════════
//  SPEED
// ═══════════════════════════════════════════════════

function setSpeed(wpm) {
  settings.wpm = Math.max(60, Math.min(1000, Math.round(wpm)));
  el('speedSlider').value   = settings.wpm;
  el('speedLbl').innerHTML  = settings.wpm + ' <small>wpm</small>';
  updateSpeedPresets();
  saveSettings();
  if (words.length > 0) updateUI();
}

function updateSpeedPresets() {
  document.querySelectorAll('.preset-btn').forEach(function(btn) {
    btn.classList.toggle('active', +btn.dataset.wpm === settings.wpm);
  });
}

// ═══════════════════════════════════════════════════
//  SETTINGS APPLY
// ═══════════════════════════════════════════════════

function applyTheme() {
  document.documentElement.setAttribute('data-theme', settings.theme);
  el('themeIcon').textContent = settings.theme === 'dark' ? '\u2600' : '\uD83C\uDF19';
}

function applyFontSize() {
  var box = el('rsvpBox');
  FONT_SIZES.forEach(function(fs) { box.classList.remove('fs-' + fs); });
  box.classList.add('fs-' + settings.fontSize);
}

function setSegActive(ctrlId, val) {
  var ctrl = el(ctrlId);
  if (!ctrl) return;
  ctrl.querySelectorAll('[data-val]').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.val === String(val));
  });
}

function applyAllSettings() {
  applyTheme();
  applyFontSize();
  el('speedSlider').value   = settings.wpm;
  el('speedLbl').innerHTML  = settings.wpm + ' <small>wpm</small>';
  el('toggleORP').checked       = settings.showORP;
  el('toggleSentPause').checked = settings.sentencePause;
  el('toggleLongWord').checked  = settings.longWordPause;
  el('toggleSavePos').checked   = settings.savePosition;
  setSegActive('fontSizeCtrl', settings.fontSize);
  setSegActive('themeCtrl',    settings.theme);
  setSegActive('chunkCtrl',    settings.chunkSize);
  updateSpeedPresets();
}

// ═══════════════════════════════════════════════════
//  SETTINGS PANEL
// ═══════════════════════════════════════════════════

function openSettings() {
  el('settingsPanel').classList.remove('hidden');
  el('settingsOverlay').classList.remove('hidden');
}

function closeSettingsPanel() {
  el('settingsPanel').classList.add('hidden');
  el('settingsOverlay').classList.add('hidden');
}

// ═══════════════════════════════════════════════════
//  PROGRESS BAR DRAG
// ═══════════════════════════════════════════════════

function seekFromClientX(clientX) {
  if (words.length === 0) return;
  var rect = el('progressBar').getBoundingClientRect();
  var pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  seek(Math.round(pct * (words.length - 1)));
}

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════

function init() {
  applyAllSettings();

  // Page number jump
  var pnJumpInput = document.getElementById('pnJumpInput');
  var pnJumpBtn   = document.getElementById('pnJumpBtn');
  function jumpToPage() {
    if (!pnJumpInput || !pnJumpInput.value) return;
    var pageNum = parseInt(pnJumpInput.value, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > pageWordRanges.length) return;
    var range = pageWordRanges[pageNum - 1];
    if (range) {
      seek(range.start);
      closePageNav();
      pnJumpInput.value = '';
    }
  }
  if (pnJumpBtn) pnJumpBtn.addEventListener('click', jumpToPage);
  if (pnJumpInput) pnJumpInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') jumpToPage();
  });

  el('browseBtn').addEventListener('click', function() { el('fileInput').click(); });
  el('fileInput').addEventListener('change', function(e) {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  var dz = el('dropzone');
  dz.addEventListener('dragover',  function(e) { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', function(e) {
    if (!dz.contains(e.relatedTarget)) dz.classList.remove('drag-over');
  });
  dz.addEventListener('drop', function(e) {
    e.preventDefault();
    dz.classList.remove('drag-over');
    var file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  dz.addEventListener('click', function(e) {
    if (!e.target.closest('button')) el('fileInput').click();
  });

  el('loadPasteBtn').addEventListener('click', function() {
    var text = el('pasteText').value.trim();
    if (!text) { alert('Please paste some text first.'); return; }
    loadIntoReader(text, 'Pasted Text');
  });

  el('closeReader').addEventListener('click', function() {
    pause();
    closePageNav();
    el('readerView').classList.add('hidden');
    el('uploadView').classList.remove('hidden');
    el('pasteText').value  = '';
    el('fileInput').value  = '';
    words          = [];
    index          = 0;
    fileName       = '';
    pdfDocRef      = null;
    pageWordRanges = [];
    el('pageNavBody').innerHTML = '';
    el('btnPageNav').classList.add('hidden');
  });

  el('btnPlay').addEventListener('click',    togglePlay);
  el('btnPrev').addEventListener('click',    function() { seek(index - 1); });
  el('btnNext').addEventListener('click',    function() { seek(index + 1); });
  el('btnRewind').addEventListener('click',  function() { seek(index - 10); });
  el('btnForward').addEventListener('click', function() { seek(index + 10); });

  el('speedSlider').addEventListener('input', function(e) { setSpeed(+e.target.value); });
  document.querySelectorAll('.preset-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { setSpeed(+btn.dataset.wpm); });
  });

  var pb = el('progressBar');
  pb.addEventListener('mousedown', function(e) {
    isDragging = true;
    pb.classList.add('dragging');
    seekFromClientX(e.clientX);
  });
  document.addEventListener('mousemove', function(e) {
    if (isDragging) seekFromClientX(e.clientX);
  });
  document.addEventListener('mouseup', function() {
    if (isDragging) { isDragging = false; pb.classList.remove('dragging'); }
  });
  pb.addEventListener('touchstart', function(e) {
    seekFromClientX(e.touches[0].clientX);
  }, { passive: true });
  pb.addEventListener('touchmove', function(e) {
    e.preventDefault();
    seekFromClientX(e.touches[0].clientX);
  }, { passive: false });

  el('themeBtn').addEventListener('click', function() {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    setSegActive('themeCtrl', settings.theme);
    saveSettings();
  });

  el('btnPageNav').addEventListener('click',      openPageNav);
  el('closePageNav').addEventListener('click',    closePageNav);
  el('pageNavOverlay').addEventListener('click',  closePageNav);

  el('settingsBtn').addEventListener('click',     openSettings);
  el('closeSettings').addEventListener('click',   closeSettingsPanel);
  el('settingsOverlay').addEventListener('click', closeSettingsPanel);

  el('fontSizeCtrl').querySelectorAll('[data-val]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      settings.fontSize = btn.dataset.val;
      setSegActive('fontSizeCtrl', settings.fontSize);
      applyFontSize();
      saveSettings();
    });
  });

  el('themeCtrl').querySelectorAll('[data-val]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      settings.theme = btn.dataset.val;
      setSegActive('themeCtrl', settings.theme);
      applyTheme();
      saveSettings();
    });
  });

  el('chunkCtrl').querySelectorAll('[data-val]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      settings.chunkSize = parseInt(btn.dataset.val, 10);
      setSegActive('chunkCtrl', btn.dataset.val);
      saveSettings();
      if (words.length > 0) showChunk(words.slice(index, index + settings.chunkSize));
    });
  });

  el('toggleORP').addEventListener('change', function() {
    settings.showORP = el('toggleORP').checked;
    saveSettings();
    if (words.length > 0) showChunk(words.slice(index, index + settings.chunkSize));
  });

  var toggleMap = {
    toggleSentPause: 'sentencePause',
    toggleLongWord:  'longWordPause',
    toggleSavePos:   'savePosition',
  };
  for (var id in toggleMap) {
    (function(elId, key) {
      el(elId).addEventListener('change', function() {
        settings[key] = el(elId).checked;
        saveSettings();
      });
    })(id, toggleMap[id]);
  }

  document.addEventListener('keydown', function(e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seek(index - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        seek(index + 1);
        break;
      case '[':
        seek(index - 10);
        break;
      case ']':
        seek(index + 10);
        break;
      case '+':
      case '=':
        setSpeed(settings.wpm + 10);
        break;
      case '-':
      case '_':
        setSpeed(settings.wpm - 10);
        break;
      case 'Home':
        e.preventDefault();
        seek(0);
        break;
      case 'End':
        e.preventDefault();
        seek(words.length - 1);
        break;
      case 's':
      case 'S':
        if (el('settingsPanel').classList.contains('hidden')) openSettings();
        else closeSettingsPanel();
        break;
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
