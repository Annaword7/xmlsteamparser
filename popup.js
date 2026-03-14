(function () {
'use strict';

const STORE_URL  = 'https://chromewebstore.google.com/detail/xml-stream-parser/PLACEHOLDER_ID/reviews';
const STRIPE_URL = 'https://buy.stripe.com/28E8wPerZ2YibS34gFcEw01';

// ═══════════════════════════════════════════════════════════════════
// i18n
// ═══════════════════════════════════════════════════════════════════
let T = {};       // current translations
let LANG = 'en';
const LOCALES = {};

async function loadLocale(lang) {
  if (LOCALES[lang]) return LOCALES[lang];
  try {
    const r = await fetch(`lang/${lang}.json`);
    LOCALES[lang] = await r.json();
  } catch { LOCALES[lang] = LOCALES['en'] || {}; }
  return LOCALES[lang];
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (T[key] !== undefined) el.textContent = T[key];
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (T[key] !== undefined) el.innerHTML = T[key];
  });
}

async function setLang(lang) {
  LANG = lang;
  T = await loadLocale(lang);
  applyI18n();
  document.getElementById('langSel').value = lang;
  try { chrome.runtime.sendMessage({ action: 'setLang', lang }); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// Telegram helper
// ═══════════════════════════════════════════════════════════════════
function tg(text) {
  try { chrome.runtime.sendMessage({ action: 'sendTelegram', text }); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// Toast
// ═══════════════════════════════════════════════════════════════════
function showToast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 3000);
}

// ═══════════════════════════════════════════════════════════════════
// DOM refs
// ═══════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const dropzone = $('dropzone'), fileInput = $('fileInput');
const fileInfo = $('fileInfo'), fileName = $('fileName'), fileSize = $('fileSize');
const queryPanel = $('queryPanel'), btnParse = $('btnParse'), btnReset = $('btnReset');
const progressSection = $('progressSection'), progressFill = $('progressFill');
const progressBytes = $('progressBytes'), progressPercent = $('progressPercent');
const results = $('results'), statGrid = $('statGrid'), topTags = $('topTags');
const treeView = $('treeView'), matchCard = $('matchCard'), matchCount = $('matchCount');
const matchBody = $('matchBody'), statusBar = $('statusBar');
const elapsedTime = $('elapsedTime'), throughputEl = $('throughput');
const previewOverlay = $('previewOverlay'), previewTag = $('previewTag');
const previewCounter = $('previewCounter'), previewCode = $('previewCode');
const previewPrev = $('previewPrev'), previewNext = $('previewNext');
const previewNavInfo = $('previewNavInfo');
const hintCard = $('hintCard'), hintToggle = $('hintToggle'), hintBody = $('hintBody');
const hintCode = $('hintCode'), hintDesc = $('hintDesc');

let selectedFile = null, worker = null, sampleInfo = {};
let previewSamples = [], previewIndex = 0, previewCurrentTag = '';

// ═══════════════════════════════════════════════════════════════════
// Supporter
// ═══════════════════════════════════════════════════════════════════
function applySupporter() {
  document.body.classList.add('supporter');
  $('supporterBadge').style.display = 'inline-flex';
}
function checkSupporter() {
  try {
    chrome.runtime.sendMessage({ action: 'getSupporter' }, r => {
      if (r && r.supporter) applySupporter();
    });
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// Language selector
// ═══════════════════════════════════════════════════════════════════
$('langSel').addEventListener('change', e => setLang(e.target.value));

// ═══════════════════════════════════════════════════════════════════
// File selection & parsing (same as before)
// ═══════════════════════════════════════════════════════════════════
fileInput.addEventListener('change', e => { if (e.target.files.length) selectFile(e.target.files[0]); });
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('dragover'); if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]); });

function selectFile(file) {
  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  fileInfo.classList.add('visible');
  queryPanel.classList.add('visible');
  btnParse.disabled = false;
  btnReset.style.display = 'none';
  results.classList.remove('visible');
  statusBar.classList.remove('visible');
  progressSection.classList.remove('visible');
  matchCard.style.display = 'none';
  matchBody.innerHTML = '';
  sampleInfo = {};
}

btnParse.addEventListener('click', startParsing);

function startParsing() {
  if (!selectedFile) return;
  btnParse.disabled = true;
  btnReset.style.display = 'inline-block';
  progressSection.classList.add('visible');
  results.classList.remove('visible');
  statusBar.classList.remove('visible');
  progressFill.style.width = '0%';
  progressFill.style.background = 'linear-gradient(90deg,var(--accent),var(--green))';
  matchBody.innerHTML = '';
  matchCard.style.display = 'none';
  sampleInfo = {};

  const query = {};
  const tn = $('qTagName').value.trim(), an = $('qAttrName').value.trim();
  const av = $('qAttrValue').value.trim(), tc = $('qTextContains').value.trim();
  if (tn) query.tagName = tn; if (an) query.attrName = an;
  if (av) query.attrValue = av; if (tc) query.textContains = tc;
  const hasQuery = Object.keys(query).length > 0;

  let chunkSize = 8 * 1024 * 1024;
  if (selectedFile.size > 500 * 1024 * 1024) chunkSize = 16 * 1024 * 1024;

  if (worker) worker.terminate();
  worker = new Worker('xml-worker.js');
  worker.onmessage = e => {
    const m = e.data;
    switch (m.type) {
      case 'progress': onProgress(m); break;
      case 'element': onElement(m.element, hasQuery); break;
      case 'structure': onStructure(m.tree); break;
      case 'done': onDone(m); break;
      case 'error': onError(m.message); break;
      case 'samples': onSamplesReceived(m); break;
    }
  };
  worker.onerror = err => onError(err.message || 'Worker error');
  worker.postMessage({ type: 'parse', file: selectedFile, chunkSize, query: hasQuery ? query : null });
}

btnReset.addEventListener('click', () => {
  if (worker) { worker.terminate(); worker = null; }
  selectedFile = null; fileInput.value = '';
  fileInfo.classList.remove('visible'); queryPanel.classList.remove('visible');
  progressSection.classList.remove('visible'); results.classList.remove('visible');
  statusBar.classList.remove('visible'); btnParse.disabled = true; btnReset.style.display = 'none';
  matchCard.style.display = 'none'; matchBody.innerHTML = ''; sampleInfo = {};
  hintCard.classList.remove('visible'); hintBody.classList.remove('open'); hintToggle.classList.remove('open');
  $('qTagName').value = ''; $('qAttrName').value = ''; $('qAttrValue').value = ''; $('qTextContains').value = '';
});

hintToggle.addEventListener('click', () => { hintToggle.classList.toggle('open'); hintBody.classList.toggle('open'); });

// ═══════════════════════════════════════════════════════════════════
// Worker handlers
// ═══════════════════════════════════════════════════════════════════
function onProgress({ bytesRead, totalBytes, percent }) {
  progressFill.style.width = percent + '%';
  progressBytes.textContent = `${formatBytes(bytesRead)} / ${formatBytes(totalBytes)}`;
  progressPercent.textContent = percent + '%';
}

function onElement(element, hasQuery) {
  if (!hasQuery) return;
  matchCard.style.display = 'block';
  matchCount.textContent = matchBody.children.length + 1;
  const row = document.createElement('tr');
  const attrs = Object.entries(element.attributes || {}).map(([k,v]) => `${k}="${v}"`).join(' ');
  row.innerHTML = `<td style="color:var(--accent)">&lt;${esc(element.name)}&gt;</td><td>${esc(attrs).substring(0,80)}</td><td>${esc((element.text||'').substring(0,80))}</td>`;
  matchBody.appendChild(row);
}

function onStructure(tree) {
  treeView.innerHTML = '';
  if (tree && tree.children) tree.children.forEach(c => treeView.appendChild(renderTreeNode(c)));
}

function onDone({ stats, matchCount: mc, elapsed, sampleInfo: si, hintSample }) {
  progressFill.style.width = '100%';
  progressPercent.textContent = '100%';
  results.classList.add('visible');
  btnParse.disabled = false;
  sampleInfo = si || {};

  if (hintSample && Object.keys(hintSample.attributes).length > 0) {
    hintCard.classList.add('visible');
    renderHint(hintSample);
  } else { hintCard.classList.remove('visible'); }

  const items = [
    { value: fmtNum(stats.totalElements), label: T.statElements || 'Elements' },
    { value: fmtNum(stats.uniqueTags.length), label: T.statUniqueTags || 'Unique tags' },
    { value: fmtNum(stats.totalAttributes), label: T.statAttributes || 'Attributes' },
    { value: fmtNum(stats.totalTextNodes), label: T.statTextNodes || 'Text nodes' },
    { value: String(stats.maxDepth), label: T.statMaxDepth || 'Max depth' },
    { value: formatBytes(stats.fileSize), label: T.statFileSize || 'File size' },
  ];
  statGrid.innerHTML = items.map(i => `<div class="stat-item"><div class="value">${i.value}</div><div class="label">${i.label}</div></div>`).join('');

  topTags.innerHTML = '';
  (stats.elementsByDepth || []).forEach(({ name, count, depth }) => {
    const div = document.createElement('div');
    div.className = 'tag-item';
    if (depth > 0) div.style.marginLeft = Math.min(depth * 12, 60) + 'px';
    const has = (sampleInfo[name] || 0) > 0;
    div.innerHTML = `<span class="count" style="opacity:.5">${depth}</span> &lt;${esc(name)}&gt;<span class="count">×${fmtNum(count)}</span>`;
    if (has) { div.title = `${T.depth||'Depth'} ${depth}`; div.addEventListener('click', () => openPreview(name)); }
    else { div.style.cursor = 'default'; }
    topTags.appendChild(div);
  });

  if (mc > 0) matchCount.textContent = mc;
  const tp = (stats.fileSize / (elapsed || 1)) / (1024 * 1024);
  statusBar.classList.add('visible');
  elapsedTime.textContent = `${elapsed}с`;
  throughputEl.textContent = `${tp.toFixed(1)} MB/s`;
}

function onError(msg) {
  progressFill.style.background = 'var(--red)';
  progressPercent.textContent = T.error || 'Error';
  progressBytes.textContent = msg;
  btnParse.disabled = false;
}

// ═══════════════════════════════════════════════════════════════════
// Hint rendering
// ═══════════════════════════════════════════════════════════════════
function renderHint(sample) {
  const { name, attributes, selfClosing } = sample;
  const entries = Object.entries(attributes);
  let h = `<span class="hb">&lt;</span><span class="ht" data-hint="${T.hintTooltipTag||'Tag name'}">${esc(name)}</span>`;
  for (const [an, av] of entries) {
    h += ` <span class="ha" data-hint="${T.hintTooltipAttr||'Attr name'}">${esc(an)}</span><span class="hb">=&quot;</span><span class="hv" data-hint="${T.hintTooltipVal||'Attr value'}">${esc(av)}</span><span class="hb">&quot;</span>`;
  }
  h += selfClosing ? `<span class="hb">/&gt;</span>` : `<span class="hb">&gt;</span>...<span class="hb">&lt;/</span><span class="ht" data-hint="${T.hintTooltipClose||'Closing tag'}">${esc(name)}</span><span class="hb">&gt;</span>`;
  hintCode.innerHTML = h;

  let d = `<p style="margin-bottom:6px">${T.hintDescIntro||''}</p>`;
  d += `<p style="margin-bottom:4px"><span style="color:#ff7b93">■</span> <code>${esc(name)}</code> ${T.hintDescTag||''}</p>`;
  if (entries[0]) {
    d += `<p style="margin-bottom:4px"><span style="color:#c4a7ff">■</span> <code>${esc(entries[0][0])}</code> ${T.hintDescAttrName||''}</p>`;
    d += `<p style="margin-bottom:4px"><span style="color:#7dd3a8">■</span> <code>${esc(entries[0][1])}</code> ${T.hintDescAttrValue||''}</p>`;
  }
  if (entries.length > 1) d += `<p style="margin-top:6px;font-size:11px;color:#6b7280">${T.hintDescTip||''}</p>`;
  hintDesc.innerHTML = d;
}

// ═══════════════════════════════════════════════════════════════════
// Preview overlay
// ═══════════════════════════════════════════════════════════════════
function openPreview(tagName) {
  if (!worker) return;
  previewCurrentTag = tagName; previewSamples = []; previewIndex = 0;
  previewTag.textContent = `<${tagName}>`;
  previewCounter.textContent = `${sampleInfo[tagName]||'?'} ${T.samples||'samples'}`;
  previewCode.innerHTML = `<div style="color:var(--text-muted);text-align:center;padding:40px">${T.loading||'Loading…'}</div>`;
  previewNavInfo.textContent = '...';
  previewPrev.disabled = true; previewNext.disabled = true;
  previewOverlay.classList.add('visible');
  worker.postMessage({ type: 'get_samples', tagName });
}

function onSamplesReceived({ tagName, samples }) {
  if (tagName !== previewCurrentTag) return;
  previewSamples = samples; previewIndex = 0;
  if (!samples.length) { previewCode.innerHTML = `<div style="color:var(--text-muted);text-align:center;padding:40px">${T.noSamples||''}</div>`; previewNavInfo.textContent = '0 / 0'; return; }
  renderPreviewSample();
}

function renderPreviewSample() {
  previewCode.innerHTML = highlightXml(prettyPrintXml(previewSamples[previewIndex]));
  previewNavInfo.textContent = `${previewIndex+1} / ${previewSamples.length}`;
  previewPrev.disabled = previewIndex === 0;
  previewNext.disabled = previewIndex >= previewSamples.length - 1;
}

$('previewClose').addEventListener('click', () => { previewOverlay.classList.remove('visible'); previewSamples = []; });
previewOverlay.addEventListener('click', e => { if (e.target === previewOverlay) { previewOverlay.classList.remove('visible'); previewSamples = []; }});
previewPrev.addEventListener('click', () => { if (previewIndex > 0) { previewIndex--; renderPreviewSample(); }});
previewNext.addEventListener('click', () => { if (previewIndex < previewSamples.length-1) { previewIndex++; renderPreviewSample(); }});
document.addEventListener('keydown', e => {
  if (!previewOverlay.classList.contains('visible')) return;
  if (e.key === 'Escape') { previewOverlay.classList.remove('visible'); previewSamples = []; }
  if (e.key === 'ArrowLeft' && previewIndex > 0) { previewIndex--; renderPreviewSample(); }
  if (e.key === 'ArrowRight' && previewIndex < previewSamples.length-1) { previewIndex++; renderPreviewSample(); }
});

// ═══════════════════════════════════════════════════════════════════
// Feedback modal
// ═══════════════════════════════════════════════════════════════════
let fbSentiment = '';
$('btnFeedback').addEventListener('click', () => { $('fbStep1').style.display = ''; $('fbStep2').style.display = 'none'; $('fbStep3').style.display = 'none'; $('fbText').value = ''; $('fbOverlay').classList.add('visible'); });
$('fbClose').addEventListener('click', () => $('fbOverlay').classList.remove('visible'));
$('fbOverlay').addEventListener('click', e => { if (e.target === $('fbOverlay')) $('fbOverlay').classList.remove('visible'); });

$('fbYes').addEventListener('click', () => {
  fbSentiment = 'positive';
  $('fbQuestion').textContent = T.fbPositiveQ || 'What do you like?';
  $('fbStep1').style.display = 'none'; $('fbStep2').style.display = '';
  tg('👍 <b>Positive</b> — likes the extension');
});
$('fbNo').addEventListener('click', () => {
  fbSentiment = 'negative';
  $('fbQuestion').textContent = T.fbNegativeQ || 'What can we improve?';
  $('fbStep1').style.display = 'none'; $('fbStep2').style.display = '';
  tg('👎 <b>Negative</b> — room for improvement');
});
$('fbSend').addEventListener('click', () => {
  const text = $('fbText').value.trim();
  if (!text) { $('fbText').focus(); return; }
  const emoji = fbSentiment === 'positive' ? '💚' : '📝';
  tg(`${emoji} <b>Feedback (${fbSentiment}):</b>\n${text}`);
  $('fbStep2').style.display = 'none'; $('fbStep3').style.display = '';
  setTimeout(() => $('fbOverlay').classList.remove('visible'), 2000);
});

// ═══════════════════════════════════════════════════════════════════
// Rate modal
// ═══════════════════════════════════════════════════════════════════
let selectedStars = 0;
$('btnRate').addEventListener('click', () => {
  selectedStars = 0;
  $('rateStep1').style.display = ''; $('rateStep2').style.display = 'none'; $('rateStep3').style.display = 'none';
  $('rateText').value = '';
  document.querySelectorAll('.star').forEach(s => s.classList.remove('active'));
  $('rateOverlay').classList.add('visible');
});
$('rateClose').addEventListener('click', () => $('rateOverlay').classList.remove('visible'));
$('rateOverlay').addEventListener('click', e => { if (e.target === $('rateOverlay')) $('rateOverlay').classList.remove('visible'); });

document.querySelectorAll('.star').forEach(star => {
  star.addEventListener('click', () => {
    selectedStars = parseInt(star.dataset.v);
    document.querySelectorAll('.star').forEach(s => {
      s.classList.toggle('active', parseInt(s.dataset.v) <= selectedStars);
    });

    setTimeout(() => {
      if (selectedStars === 5) {
        tg(`⭐⭐⭐⭐⭐ <b>5 stars!</b> → redirecting to store`);
        $('rateStep1').style.display = 'none'; $('rateStep3').style.display = '';
        $('rateMsg').textContent = T.rateRedirect || 'Thank you! Redirecting…';
        setTimeout(() => { window.open(STORE_URL, '_blank'); $('rateOverlay').classList.remove('visible'); }, 1500);
      } else {
        $('rateStep1').style.display = 'none'; $('rateStep2').style.display = '';
      }
    }, 400);
  });
});

$('rateSend').addEventListener('click', () => {
  const text = $('rateText').value.trim();
  if (!text) { $('rateText').focus(); return; }
  tg(`${'⭐'.repeat(selectedStars)} <b>Rating: ${selectedStars}/5</b>\n${text}`);
  $('rateStep2').style.display = 'none'; $('rateStep3').style.display = '';
  $('rateMsg').textContent = T.rateThanks || 'Thank you!';
  setTimeout(() => $('rateOverlay').classList.remove('visible'), 2000);
});

// ═══════════════════════════════════════════════════════════════════
// Donate modal
// ═══════════════════════════════════════════════════════════════════
let selectedAmount = '5';
$('btnDonate').addEventListener('click', () => { $('dnThanks').style.display = 'none'; $('dnOverlay').classList.add('visible'); tg('❤️ Donate modal opened'); });
$('dnClose').addEventListener('click', () => $('dnOverlay').classList.remove('visible'));
$('dnOverlay').addEventListener('click', e => { if (e.target === $('dnOverlay')) $('dnOverlay').classList.remove('visible'); });

document.querySelectorAll('.dn-amt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dn-amt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedAmount = btn.dataset.amount;
  });
});

$('dnStripe').addEventListener('click', () => {
  $('dnStripe').href = STRIPE_URL;
  tg(`💳 <b>Donation link clicked</b> — €${selectedAmount}`);
});

$('dnAlready').addEventListener('click', () => {
  try { chrome.runtime.sendMessage({ action: 'setSupporter' }); } catch {}
  applySupporter();
  $('dnThanks').style.display = '';
  tg('🎁 <b>Supporter bonus claimed!</b>');
  showToast(T.dnThanks || 'Thank you! 🎉');
  setTimeout(() => $('dnOverlay').classList.remove('visible'), 2000);
});

// ═══════════════════════════════════════════════════════════════════
// Tree rendering
// ═══════════════════════════════════════════════════════════════════
function renderTreeNode(node) {
  const div = document.createElement('div'); div.className = 'tree-node';
  const label = document.createElement('div'); label.className = 'tree-label';
  const has = (sampleInfo[node.name] || 0) > 0;
  label.innerHTML = `<span class="tag-name" ${has ? 'style="cursor:pointer;text-decoration:underline dotted"' : ''}>&lt;${esc(node.name)}&gt;</span>` +
    (node.count > 0 ? ` <span class="tag-count">×${fmtNum(node.count)}</span>` : '');
  if (has) label.querySelector('.tag-name').addEventListener('click', () => openPreview(node.name));
  div.appendChild(label);
  if (node.children && node.children.length) node.children.forEach(c => div.appendChild(renderTreeNode(c)));
  return div;
}

// ═══════════════════════════════════════════════════════════════════
// XML pretty-print & highlight (unchanged)
// ═══════════════════════════════════════════════════════════════════
function prettyPrintXml(xml) {
  let indent = 0; const lines = [];
  const tokens = xml.replace(/>\s*</g, '>\n<').split('\n');
  for (let t of tokens) {
    t = t.trim(); if (!t) continue;
    if (t.startsWith('</')) { indent = Math.max(0, indent-1); lines.push('  '.repeat(indent)+t); }
    else if (t.startsWith('<') && !t.startsWith('<!') && !t.startsWith('<?')) { lines.push('  '.repeat(indent)+t); if (!t.endsWith('/>') && !t.includes('</')) indent++; }
    else lines.push('  '.repeat(indent)+t);
  }
  return lines.join('\n');
}

function highlightXml(xml) {
  return esc(xml)
    .replace(/&lt;(\w[\w:\-.]*)(\s)(.*?)(\/&gt;)/g, (m,tag,sp,rest) => `<span class="sx-bra">&lt;</span><span class="sx-tag">${tag}</span>${sp}${hlAttr(rest)}<span class="sx-bra">/&gt;</span>`)
    .replace(/&lt;(\w[\w:\-.]*)(\s)(.*?)(&gt;)/g, (m,tag,sp,rest) => `<span class="sx-bra">&lt;</span><span class="sx-tag">${tag}</span>${sp}${hlAttr(rest)}<span class="sx-bra">&gt;</span>`)
    .replace(/&lt;(\w[\w:\-.]*)&gt;/g, '<span class="sx-bra">&lt;</span><span class="sx-tag">$1</span><span class="sx-bra">&gt;</span>')
    .replace(/&lt;\/(\w[\w:\-.]*)&gt;/g, '<span class="sx-bra">&lt;/</span><span class="sx-tag">$1</span><span class="sx-bra">&gt;</span>')
    .replace(/^(\s*)((?!.*<span class="sx-).+)$/gm, (m,ws,text) => `${ws}<span class="sx-txt">${text}</span>`);
}
function hlAttr(s) { return s.replace(/([\w:\-\.]+)(=)(&quot;)(.*?)(&quot;)/g, '<span class="sx-attr">$1</span><span class="sx-bra">$2$3</span><span class="sx-val">$4</span><span class="sx-bra">$5</span>'); }

// ═══════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════
function formatBytes(bytes) {
  if (bytes === 0) return '0';
  const u = T.byteUnits || ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
}
function fmtNum(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return String(n);
}
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ═══════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════
(async function init() {
  // Load saved language or detect from browser
  let lang = 'en';
  try {
    const r = await new Promise(resolve => chrome.runtime.sendMessage({ action: 'getLang' }, resolve));
    if (r && r.lang) lang = r.lang;
    else {
      const bl = navigator.language.split('-')[0];
      if (['en','ru','de','es','fr'].includes(bl)) lang = bl;
    }
  } catch {}
  await setLang(lang);
  checkSupporter();
})();

})();
