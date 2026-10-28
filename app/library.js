/* Library management: importing material, browser-side alignment, the timeline/blank editor, content packs. */
(function () {
'use strict';
const { $, $$, esc, ICON, clock, toast, openDialog, download, importFile, emptyCard, viewHead, sectionName } = LT;
const C = ListeningCore, MAX_BLANKS = LTSection.MAX_BLANKS, newId = LTSection.newId;
const fmt = t => Number.isFinite(t) ? `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}` : '--';
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// ---------- Audio decoding ----------
async function decodeMono16k(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('这个浏览器不支持音频解码（OfflineAudioContext）。');
  const ctx = new Ctx(1, 16000, 16000);
  const decoded = await new Promise((resolve, reject) => { const p = ctx.decodeAudioData(buf, resolve, e => reject(new Error('无法解码这个音频文件，请换成 mp3、m4a 或 wav。'))); if (p?.catch) p.catch(() => { }); });
  let samples;
  if (decoded.sampleRate === 16000) {
    samples = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) { const d = decoded.getChannelData(c); for (let i = 0; i < d.length; i++) samples[i] += d[i] / decoded.numberOfChannels; }
  } else {
    // Some browsers keep the file's own rate: resample with a second offline context.
    const len = Math.ceil(decoded.duration * 16000), off = new Ctx(1, len, 16000), src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start(); samples = (await off.startRendering()).getChannelData(0);
  }
  return { samples, duration: samples.length / 16000 };
}
function peaksOf(samples) {
  const hop = 160, n = Math.ceil(samples.length / hop), out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { let m = 0; for (let k = i * hop, e = Math.min(samples.length, k + hop); k < e; k++) { const v = Math.abs(samples[k]); if (v > m) m = v; } out[i] = Math.min(255, Math.round(Math.sqrt(m) * 255)); }
  return out;
}

// ---------- Alignment worker ----------
let worker = null;
function runWorker(type, samples, extra, onProgress) {
  return new Promise((resolve, reject) => {
    if (!window.Worker || !window.WebAssembly) { reject(new Error('这个浏览器不支持 Web Worker 或 WebAssembly，无法运行语音模型。')); return; }
    if (location.protocol === 'file:') { reject(new Error('请通过网址打开本网站（GitHub Pages，或运行 start-mac.command / start-windows.bat），直接双击 index.html 时浏览器不允许运行语音模型。')); return; }
    worker ||= new Worker('app/align/worker.js');
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress?.(data.fraction, data.label);
      else if (data.type === 'done') resolve(data);
      else if (data.type === 'error') reject(new Error(data.message));
    };
    worker.onerror = e => { worker.terminate(); worker = null; reject(new Error('语音程序出错：' + (e.message || '未知错误'))); };
    const copy = samples.slice();
    worker.postMessage({ type, samples: copy, ...extra }, [copy.buffer]);
  });
}
const runAlignment = (samples, sentences, onProgress) => runWorker('align', samples, { sentences }, onProgress);
let dictionary = null;
async function loadDictionary() {
  if (dictionary) return dictionary;
  try { const r = await fetch('data/dictionary.txt'); dictionary = new Set((await r.text()).split('\n').filter(Boolean)); } catch { dictionary = null; }
  return dictionary;
}

// ---------- Section helpers (shared with the Node tools in app/section.js) ----------
const { buildSection, applyAlignment, needsCheck, blankId, setBlanks, blankCount, withNewId, nextSentenceId, cleanForStore } = LTSection;
const autoBlanks = (sec, max = MAX_BLANKS, avoid = null) => LTSection.autoBlanks(sec, LT.coreWords, max, avoid);
async function storeSection(sec, audio) { if (audio) await LTDb.putSectionWithAudio(cleanForStore(sec), { id: sec.id, ...audio }); else await LTDb.putSection(cleanForStore(sec)); }
function collections() { return [...new Set(LT.sections.map(s => s.collection).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true })); }

// ---------- Library view ----------
async function renderLibrary() {
  const groups = C.groupSections(LT.sections), est = await LTDb.estimate();
  const rows = g => g.sections.map(s => {
    const total = s.sentences.length, flagged = s.sentences.filter(q => needsCheck(s.timings?.[q.sentenceId])).length, blanks = blankCount(s), aligned = s.sentences.every(q => C.validTiming(s.timings?.[q.sentenceId]));
    return `<tr><td><strong>${esc(s.title)}</strong><div class="muted-line">${total} 句 · ${s.duration ? clock(s.duration) : '时长未知'} · ${blanks} 个挖空</div></td><td>${!aligned ? '<span class="tag warn-tag">未对齐</span>' : flagged ? `<span class="tag warn-tag">${flagged} 句待检查</span>` : '<span class="tag ok-tag">已对齐</span>'}</td><td class="lib-actions"><button class="tool-button" data-lib="practice" data-id="${s.id}">${ICON('headphones')}练习</button><button class="tool-button" data-lib="edit" data-id="${s.id}">${ICON('edit')}校对</button><button class="tool-button" data-lib="export" data-id="${s.id}">${ICON('download')}导出</button><button class="tool-button delete-button" data-lib="delete" data-id="${s.id}">${ICON('trash')}</button></td></tr>`;
  }).join('');
  $('#other-view').innerHTML = `<div data-lib-root>${viewHead('题库管理', '题库里的音频和原文只保存在这个浏览器里。换设备或清理浏览器数据之前，请先导出内容包。', `<div class="dialog-actions" style="margin:0"><button class="primary" data-lib="new">${ICON('plus')}导入新材料</button><button class="tool-button" data-lib="import-pack">${ICON('upload')}导入内容包</button>${LT.sections.length ? `<button class="tool-button" data-lib="export-all">${ICON('download')}导出全部</button>` : ''}</div>`)}
  ${LT.sections.length ? groups.map(g => `<section class="lib-group"><div class="lib-group-head"><h2>${esc(g.name)}</h2><span class="muted-line">${g.sections.length} 节</span><button class="link-button" data-lib="export-group" data-group="${esc(g.name)}">导出这一组</button></div><div class="table-wrap"><table class="lib-table"><tbody>${rows(g)}</tbody></table></div></section>`).join('') : emptyCard('library', '题库还是空的', '导入一段音频和对应的英文原文，或者先加载示例看看效果。', `<div class="dialog-actions" style="justify-content:center"><button class="primary" data-lib="new">${ICON('plus')}导入新材料</button><button data-lib="sample">加载示例</button></div>`)}
  <p class="fine-print">${est?.usage ? `本网站在这个浏览器里已使用约 ${kb(est.usage)}${est.quota ? `，可用上限约 ${kb(est.quota)}` : ''}。` : ''}对齐模型（约 46 MB）第一次对齐时下载；自动识别原文用的模型（约 160 MB）只在第一次使用“只有音频”时下载。都缓存在浏览器里，之后可以离线使用。</p></div>`;
}

// ---------- Import view ----------
let draft = null; // {mode, title, collection, file, parsed, samples, peaks, proof}
function renderImport(prefill = {}) {
  const last = LT.sections.at(-1);
  draft = { mode: 'text', title: '', collection: prefill.collection ?? last?.collection ?? '', file: null, ...prefill };
  $('#other-view').innerHTML = `<div data-lib-root class="import">${viewHead('导入新材料', '一次导入一段录音（例如一套题的一个 Part）。音频和原文都只在你的浏览器里处理，不会上传。')}
  <div class="segmented imp-mode" role="group" aria-label="原文来源"><button data-lib="mode" data-mode="text" class="${draft.mode === 'text' ? 'active' : ''}">${ICON('file')}我有原文</button><button data-lib="mode" data-mode="auto" class="${draft.mode === 'auto' ? 'active' : ''}">${ICON('sparkle')}只有音频，自动识别原文</button></div>
  <div class="import-grid">
   <label class="field"><span>分组</span><input id="imp-collection" list="imp-collections" placeholder="例如：Book 1 · Test 1" value="${esc(draft.collection)}"><datalist id="imp-collections">${collections().map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
   <label class="field"><span>标题</span><input id="imp-title" placeholder="例如：Part 1" value="${esc(draft.title)}"></label>
   <div class="field wide"><span>音频文件</span><div class="file-row"><button class="tool-button" data-lib="pick-audio">${ICON('upload')}选择音频</button><span id="imp-audio-name" class="muted-line">mp3 / m4a / wav，建议 15 分钟以内</span></div></div>
   <div class="field wide" data-when="text"><span>英文原文 <button class="link-button" data-lib="pick-text">从 .txt 文件读取</button></span><textarea id="imp-text" rows="12" spellcheck="false" placeholder="把原文粘贴到这里。&#10;对话可以带说话人，例如：&#10;MAN: Good morning. How can I help you?&#10;WOMAN: Hi. I'd like to ...&#10;空一行表示新的段落。"></textarea></div>
   <div class="field wide" data-when="auto"><span>自动识别</span><div class="auto-note">网站会在你的浏览器里把录音转成带标点的英文原文，并自动区分说话人。识别完先给你校对：可能听错的词、改写过的数字和拼写都会标出来，考试说明和例题重播会建议删除。确认后再对齐、出挖空。<br><b>第一次使用需要下载约 160 MB 的模型</b>（之后缓存在浏览器里，可以离线使用）。8 分钟的录音在电脑上大约需要 1–2 分钟。</div><div class="radio-row"><label><input type="checkbox" id="imp-speakers" checked> 自动区分说话人</label><label><input type="checkbox" id="imp-british" checked> 改成英式拼写（emphasise、programme…）</label></div></div>
   <div class="field wide"><span>挖空</span><div class="radio-row"><label><input type="radio" name="imp-blanks" value="auto" checked> 自动选词（离线规则，之后可以手动调整）</label><label><input type="radio" name="imp-blanks" value="none"> 先不挖空</label></div></div>
  </div>
  <div id="imp-preview" class="imp-preview"></div>
  <div class="dialog-actions"><button class="primary big" data-lib="start-import" id="imp-start" disabled>${ICON('wave')}<span>开始对齐</span></button><button class="tool-button" data-lib="cancel-import">取消</button></div>
  <div id="imp-progress" hidden></div><div id="imp-proof"></div></div>`;
  $('#imp-text').addEventListener('input', previewText);
  for (const id of ['imp-title', 'imp-collection']) $('#' + id).addEventListener('input', checkReady);
  if (prefill.text) { $('#imp-text').value = prefill.text; previewText(); }
  setMode(draft.mode);
}
function setMode(mode) {
  draft.mode = mode;
  $$('[data-lib="mode"]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $$('[data-when]').forEach(el => { el.hidden = el.dataset.when !== mode; });
  $('#imp-preview').hidden = mode !== 'text';
  $('#imp-start span').textContent = mode === 'auto' ? '开始识别' : '开始对齐';
  checkReady();
}
function previewText() {
  const parsed = LTTranscript.parse($('#imp-text').value); draft.parsed = parsed;
  const s = parsed.sentences;
  $('#imp-preview').innerHTML = s.length ? `<div class="alert"><b>${s.length}</b> 句 · ${new Set(s.map(q => q.paragraph)).size} 段${parsed.speakers.length ? ` · 说话人：${parsed.speakers.map(esc).join('、')}` : ''}${parsed.warnings.map(w => `<br>⚠ ${esc(w)}`).join('')}</div><ol class="imp-sentences">${s.slice(0, 8).map(q => `<li>${q.speaker ? `<b>${esc(q.speaker)}</b> ` : ''}${esc(q.text)}</li>`).join('')}${s.length > 8 ? `<li class="muted-line">…… 还有 ${s.length - 8} 句</li>` : ''}</ol>` : '';
  checkReady();
}
function checkReady() { const btn = $('#imp-start'); if (btn) btn.disabled = !(draft.file && $('#imp-title').value.trim() && (draft.mode === 'auto' || draft.parsed?.sentences.length)); }
function lockForm(locked) { $$('#other-view .import-grid input, #other-view textarea, #other-view .import-grid button, #imp-start, [data-lib="mode"]').forEach(el => el.disabled = locked); }
function progressBox(note) {
  const box = $('#imp-progress'); box.hidden = false;
  return (f, label) => { box.innerHTML = `<div class="align-progress"><div class="progress-track big-track"><div class="progress-fill" style="width:${Math.round(f * 100)}%"></div></div><span>${esc(label)} · ${Math.round(f * 100)}%</span></div><p class="muted-line">${note}</p>`; };
}
async function decodeDraft(show) {
  if (draft.samples && draft.decodedFile === draft.file) return;
  show(0, '解码音频');
  const { samples, duration } = await decodeMono16k(draft.file);
  if (duration > 40 * 60) throw new Error('录音超过 40 分钟，请先剪成较短的片段（每段建议 15 分钟以内）。');
  draft.samples = samples; draft.peaks = peaksOf(samples); draft.decodedFile = draft.file;
}
function startImport() { return draft.mode === 'auto' ? startTranscribe() : finishImport(draft.parsed); }
async function finishImport(parsed) {
  const title = $('#imp-title').value.trim(), collection = $('#imp-collection').value.trim(), file = draft.file, how = $('input[name=imp-blanks]:checked').value;
  const id = newId(), order = LT.sections.filter(s => (s.collection || '') === collection).length + 1;
  const sec = buildSection({ id, title, collection, order, parsed });
  if (draft.mode === 'auto') sec.source = 'auto-transcribed';
  lockForm(true); $$('#imp-proof button, #imp-proof [contenteditable], #imp-proof select, #imp-proof input').forEach(el => { el.disabled = true; el.contentEditable = el.isContentEditable ? 'false' : el.contentEditable; });
  const show = progressBox('对齐在你的浏览器里进行，请保持这个页面打开。'), box = $('#imp-progress');
  if (draft.mode === 'auto') box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  try {
    await decodeDraft(show);
    sec.peaks = draft.peaks;
    const t0 = performance.now();
    const res = await runAlignment(draft.samples, sec.sentences.map(q => q.text), show);
    applyAlignment(sec, res.result, (performance.now() - t0) / 1000);
    // In a recognised transcript, words that are still marked as doubtful are never used as answers.
    const avoid = draft.mode === 'auto' && draft.proof ? new Set(draft.proof.rows.filter(r => r.keep).flatMap(r => r.check.filter(c => c.why !== 'name').map(c => r.text.slice(c.start, c.end).toLowerCase()))) : null;
    if (how === 'auto') autoBlanks(sec, MAX_BLANKS, avoid);
    await storeSection(sec, { blob: file, name: file.name, type: file.type || 'audio/mpeg' });
    await LT.reloadSections(id);
    const flagged = sec.sentences.filter(q => needsCheck(sec.timings[q.sentenceId])).length;
    box.innerHTML = `<div class="alert ok"><b>对齐完成</b>：${sec.sentences.length} 句，用时 ${Math.round(res.seconds)} 秒。${flagged ? `有 <b>${flagged}</b> 句置信度较低，建议到校对页试听一下。` : '所有句子的置信度都正常。'}${how === 'auto' ? ` 已自动选出 ${blankCount(sec)} 个挖空。` : ''}</div><div class="dialog-actions"><button class="primary" data-lib="edit" data-id="${id}">${ICON('edit')}去校对</button><button data-lib="practice" data-id="${id}">${ICON('headphones')}直接练习</button><button data-lib="next-import" data-collection="${esc(collection)}" data-title="${esc(title)}" data-mode="${draft.mode}">${ICON('plus')}继续导入同组的下一段</button></div>`;
    stopProofAudio();
  } catch (e) {
    box.innerHTML = `<div class="alert danger-soft"><b>没有完成：</b>${esc(e.message || e)}</div>`;
    lockForm(false); if (draft.proof) renderProof();
  }
}

// ---------- Automatic transcription and proofreading ----------
async function startTranscribe() {
  lockForm(true); $('#imp-proof').innerHTML = '';
  const show = progressBox('识别在你的浏览器里进行，请保持这个页面打开。第一次需要下载模型，之后会快很多。');
  try {
    await decodeDraft(show);
    const res = await runWorker('transcribe', draft.samples, { speakers: $('#imp-speakers').checked }, show);
    const dict = await loadDictionary();
    draft.proof = LTProofread.prepare(res.result, { dict, british: $('#imp-british').checked });
    const n = draft.proof.speakerCount, kept = new Set(draft.proof.rows.filter(r => r.keep).map(r => r.speaker));
    // Speakers are lettered by order of appearance among the kept sentences; a single voice is a monologue.
    draft.names = {}; let letter = 0;
    for (const r of draft.proof.rows) if (r.keep && !(r.speaker in draft.names)) draft.names[r.speaker] = String.fromCharCode(65 + letter++);
    for (let k = 0; k < n; k++) if (!(k in draft.names)) draft.names[k] = String.fromCharCode(65 + letter++);
    draft.monologue = kept.size <= 1;
    draft.proofFilter = 'all';
    $('#imp-progress').hidden = true;
    renderProof();
    $('#imp-proof').scrollIntoView({ block: 'start', behavior: 'smooth' });
    toast(`识别完成，用时 ${Math.round(res.seconds)} 秒。请先校对原文。`);
  } catch (e) {
    $('#imp-progress').innerHTML = `<div class="alert danger-soft"><b>没有完成：</b>${esc(e.message || e)}</div>`; lockForm(false);
  }
}
const WHY = { instruction: '考试说明', repeat: '例题重播（后面会完整再放一遍）' };
function proofRowMarkup(r) {
  const marks = [...r.changes.map((c, k) => ({ ...c, kind: 'change', k })), ...r.check.map(c => ({ ...c, kind: 'check' }))].sort((x, y) => x.start - y.start);
  let pos = 0, html = '';
  for (const m of marks) {
    if (m.start < pos) continue;
    html += esc(r.text.slice(pos, m.start));
    const t = esc(r.text.slice(m.start, m.end));
    html += m.kind === 'change' ? `<mark class="pr-change" data-lib="revert" data-r="${r.i}" data-k="${m.k}" title="自动改写自“${esc(m.from)}”，点一下还原">${t}</mark>`
      : `<span class="pr-check ${m.why}" title="${m.why === 'low' ? '识别把握不大，请听一下' : m.why === 'name' ? '人名、地名等，请核对拼写' : '词典里没有这个词，可能听错了'}">${t}</span>`;
    pos = m.end;
  }
  html += esc(r.text.slice(pos));
  const speakers = Object.keys(draft.names);
  return `<div class="pr-row ${r.keep ? '' : 'dropped'}" data-r="${r.i}">
   <label class="pr-keep" title="${r.keep ? '保留这一句' : '不要这一句'}"><input type="checkbox" data-pr-keep="${r.i}" ${r.keep ? 'checked' : ''}></label>
   <button class="pr-play" data-lib="pr-play" data-r="${r.i}" title="试听 ${fmt(r.start)}">${ICON('play')}</button>
   ${draft.monologue ? '' : `<select class="pr-speaker" data-pr-speaker="${r.i}" aria-label="说话人">${speakers.map(k => `<option value="${k}" ${Number(k) === r.speaker ? 'selected' : ''}>${esc(draft.names[k] || '—')}</option>`).join('')}</select>`}
   <div class="pr-text" contenteditable="${r.keep ? 'true' : 'false'}" spellcheck="false" data-pr-text="${r.i}">${html}</div>
   ${r.why && !r.keep ? `<span class="tag warn-tag pr-why">建议删除：${WHY[r.why] || r.why}</span>` : ''}</div>`;
}
function proofStats() {
  const rows = draft.proof.rows, kept = rows.filter(r => r.keep);
  return { kept: kept.length, dropped: rows.length - kept.length, check: kept.reduce((n, r) => n + r.check.length, 0), changes: kept.reduce((n, r) => n + r.changes.length, 0) };
}
function proofVisible(r) { return draft.proofFilter === 'all' || r.check.length || r.changes.length || !r.keep; }
function renderProof() {
  if (document.activeElement?.matches?.('[data-pr-text]')) { syncProofText(document.activeElement); document.activeElement.blur(); }
  const st = proofStats(), speakers = Object.keys(draft.names).filter(k => draft.proof.rows.some(r => r.keep && r.speaker === Number(k)));
  $('#imp-proof').innerHTML = `<section class="proof"><div class="view-title"><h2>校对识别结果</h2></div>
   <p class="description">识别结果不能保证全对。请重点看标出来的地方：<span class="pr-check low">波浪线</span> 是可能听错的词（点 ${ICON('play')} 试听，直接在句子里改）；<mark class="pr-change">灰底</mark> 是自动改写的数字和拼写（点一下还原）；划掉的句子不会进入练习（勾选框可以改）。</p>
   <div class="pr-stats"><span>保留 <b>${st.kept}</b> 句</span><span>不要 <b>${st.dropped}</b> 句</span><span>待查的词 <b class="${st.check ? 'warn' : ''}">${st.check}</b></span><span>自动改写 <b>${st.changes}</b> 处</span></div>
   <div class="pr-speakers">${draft.monologue ? `<span>说话人：只有一个人（独白）</span><button class="link-button" data-lib="pr-dialogue">其实是对话</button>` : `<span>说话人：</span>${speakers.map(k => `<label class="pr-name"><span class="pr-badge">${draft.proof.rows.filter(r => r.keep && r.speaker === Number(k)).length} 句</span><input data-pr-name="${k}" value="${esc(draft.names[k])}" aria-label="说话人名称" placeholder="例如 MAN"></label>`).join('')}<button class="link-button" data-lib="pr-monologue">其实是独白</button>`}</div>
   <div class="ed-tools"><div class="segments"><button class="${draft.proofFilter === 'all' ? 'selected' : ''}" data-lib="pr-filter" data-filter="all">全部句子</button><button class="${draft.proofFilter === 'check' ? 'selected' : ''}" data-lib="pr-filter" data-filter="check">只看要检查的</button></div></div>
   <div class="pr-list">${proofListMarkup() || emptyCard('check', '没有需要检查的句子')}</div>
   <div class="dialog-actions pr-actions"><button class="primary big" data-lib="pr-confirm">${ICON('check')}原文没问题，开始对齐</button><button class="tool-button" data-lib="pr-restart">重新识别</button><button class="tool-button" data-lib="pr-copy">复制原文</button></div></section>`;
}
// Runs of three or more dropped sentences (the test introduction, the replayed example) are folded away.
function proofListMarkup() {
  const rows = draft.proof.rows.filter(proofVisible), out = [];
  for (let i = 0; i < rows.length;) {
    let j = i; while (j < rows.length && !rows[j].keep) j++;
    if (j - i >= 3) {
      const kinds = [...new Set(rows.slice(i, j).map(r => WHY[r.why] || '已划掉'))].join('、');
      out.push(`<details class="pr-fold" ${draft.open?.[rows[i].i] ? 'open' : ''} data-fold="${rows[i].i}"><summary>${ICON('chevron')}${j - i} 句不进入练习：${esc(kinds)}<span class="muted-line">展开查看</span></summary>${rows.slice(i, j).map(proofRowMarkup).join('')}</details>`);
      i = j;
    } else if (j > i) { out.push(...rows.slice(i, j).map(proofRowMarkup)); i = j; }
    else { out.push(proofRowMarkup(rows[i])); i++; }
  }
  return out.join('');
}
document.addEventListener('toggle', e => { const d = e.target; if (d.matches?.('details[data-fold]') && draft) (draft.open ||= {})[d.dataset.fold] = d.open; }, true);
function syncProofText(el) {
  const r = draft.proof.rows[Number(el.dataset.prText)], text = el.innerText.replace(/\s+/g, ' ').trim();
  if (text === r.text) return;
  r.text = text; r.changes = []; r.check = [];
}
let proofAudio = null, proofUrl = null, proofStop = null;
function playProof(i) {
  const r = draft.proof.rows[i];
  if (!proofAudio) { proofAudio = new Audio(); proofAudio.addEventListener('timeupdate', () => { if (proofStop !== null && proofAudio.currentTime >= proofStop) { proofAudio.pause(); proofStop = null; } }); }
  if (proofUrl?.file !== draft.file) { if (proofUrl) URL.revokeObjectURL(proofUrl.url); proofUrl = { file: draft.file, url: URL.createObjectURL(draft.file) }; proofAudio.src = proofUrl.url; }
  LT.audio.pause();
  proofAudio.currentTime = Math.max(0, r.start - 0.25); proofStop = r.end + 0.35; proofAudio.play().catch(() => toast('浏览器没有开始播放，请再点一次。'));
}
function stopProofAudio() { if (proofAudio) proofAudio.pause(); }
function proofText() {
  const parsed = LTProofread.build(draft.proof.rows, draft.monologue ? {} : draft.names);
  let out = '', prev = null, para = null;
  for (const q of parsed.sentences) { const sep = para === null ? '' : q.paragraph !== para ? '\n\n' : q.speaker !== prev ? '\n' : ' '; out += sep + (q.speaker && (q.speaker !== prev || sep.includes('\n')) ? q.speaker + ': ' : '') + q.text; prev = q.speaker; para = q.paragraph; }
  return out;
}
function confirmProof() {
  $$('[data-pr-text]').forEach(syncProofText);
  if (!draft.monologue) { const names = Object.values(draft.names).filter(Boolean); if (new Set(names).size !== names.length) { toast('两个说话人的名字不能一样。'); return; } }
  const parsed = LTProofread.build(draft.proof.rows, draft.monologue ? {} : draft.names);
  if (!parsed.sentences.length) { toast('没有保留任何句子。'); return; }
  finishImport(parsed);
}
document.addEventListener('change', e => {
  const t = e.target; if (!draft?.proof) return;
  if (t.dataset.prKeep !== undefined) { const r = draft.proof.rows[Number(t.dataset.prKeep)]; $$('[data-pr-text]').forEach(syncProofText); r.keep = t.checked; renderProof(); }
  else if (t.dataset.prSpeaker !== undefined) { draft.proof.rows[Number(t.dataset.prSpeaker)].speaker = Number(t.value); }
  else if (t.dataset.prName !== undefined) {
    draft.names[t.dataset.prName] = t.value.trim().toUpperCase();
    // This change event can come from the blur that removing the page fires: update the labels in place instead of re-rendering.
    $$(`[data-pr-speaker] option[value="${t.dataset.prName}"]`).forEach(o => { o.textContent = draft.names[t.dataset.prName] || '—'; });
  }
});
document.addEventListener('focusout', e => {
  const el = e.target.closest?.('[data-pr-text]'); if (!el || !draft?.proof) return;
  const r = draft.proof.rows[Number(el.dataset.prText)], before = r.text; syncProofText(el);
  // Re-render the edited row after the event: changing the DOM inside a blur that a removal triggered breaks the removal.
  if (r.text !== before) setTimeout(() => { if (el.isConnected && document.activeElement !== el) el.innerHTML = esc(r.text); });
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest?.('[data-pr-text]')) { e.preventDefault(); e.target.blur(); } });
function nextTitle(t) { const m = t.match(/^(.*?)(\d+)(\D*)$/); return m ? m[1] + (Number(m[2]) + 1) + m[3] : ''; }

// ---------- Editor ----------
let ed = null, edSaveTimer = null, edSel = 0, edFilter = 'all', edPending = null, waveDrag = null, edLastSel = null;
async function openEditor(id) {
  const sec = await LTDb.getSection(id); if (!sec) { toast('这一节已不存在。'); return; }
  ed = structuredClone(sec); ed.sentences.forEach((q, i) => q.n = i + 1); edSel = 0; edFilter = 'all'; edPending = null;
  LT.go('edit');
  await LT.loadAudioFor(LT.sections.find(s => s.id === id) || ed);
  if (!ed.peaks) {
    const row = await LTDb.getAudio(id);
    if (row?.blob) decodeMono16k(row.blob).then(({ samples, duration }) => { if (ed?.id !== id) return; ed.peaks = peaksOf(samples); ed.duration ||= duration; persist(); drawWaves(); }).catch(() => { });
  }
}
function persist(now) {
  clearTimeout(edSaveTimer);
  const run = async () => { const copy = ed; try { await storeSection(copy); await LT.reloadSections(LT.sectionId); } catch (e) { LT.storageError('保存失败：' + (e.message || e)); } };
  if (now) return run(); edSaveTimer = setTimeout(run, 500);
}
function edRows() { return ed.sentences.map((q, i) => ({ q, i, t: ed.timings?.[q.sentenceId] })).filter(r => edFilter === 'all' || needsCheck(r.t)); }
function renderEditor() {
  if (!ed) { LT.go('library'); return; }
  const flagged = ed.sentences.filter(q => needsCheck(ed.timings?.[q.sentenceId])).length, blanks = blankCount(ed);
  $('#other-view').innerHTML = `<div data-lib-root class="editor">
  <div class="view-title"><h1>校对</h1><div class="dialog-actions" style="margin:0"><button class="primary" data-lib="practice" data-id="${ed.id}">${ICON('headphones')}练习这一节</button><button class="tool-button" data-lib="back">返回题库</button></div></div>
  <div class="ed-meta"><label class="field"><span>分组</span><input id="ed-collection" list="ed-collections" value="${esc(ed.collection || '')}"><datalist id="ed-collections">${collections().map(c => `<option value="${esc(c)}">`).join('')}</datalist></label><label class="field"><span>标题</span><input id="ed-title" value="${esc(ed.title)}"></label></div>
  <div class="ed-status"><span>${ed.sentences.length} 句</span><span>${flagged ? `<b class="warn">${flagged}</b> 句待检查` : '没有待检查的句子'}</span><span>挖空 <b>${blanks}</b> / ${MAX_BLANKS}</span>${ed.alignment ? `<span class="muted-line">自动对齐于 ${new Date(ed.alignment.at).toLocaleDateString()}</span>` : ''}</div>
  <div class="ed-tools"><div class="segments"><button class="${edFilter === 'all' ? 'selected' : ''}" data-lib="filter" data-filter="all">全部句子</button><button class="${edFilter === 'check' ? 'selected' : ''}" data-lib="filter" data-filter="check">只看待检查</button></div><span class="tool-gap"></span><button class="tool-button" data-lib="auto-blanks">${ICON('sparkle')}自动选词</button><button class="tool-button" data-lib="ai-blanks">${ICON('sparkle')}AI 选词</button><button class="tool-button" data-lib="clear-blanks">清空挖空</button><button class="tool-button" data-lib="realign">${ICON('wave')}重新对齐</button><button class="tool-button" data-lib="replace-audio">${ICON('upload')}更换音频</button><button class="tool-button" data-lib="edit-text">${ICON('edit')}编辑原文</button></div>
  <div class="ed-player"><button class="play-button small" data-lib="toggle" aria-label="播放/暂停">${ICON(LT.audio.paused ? 'play' : 'pause')}</button><canvas id="ed-overview" height="44"></canvas><span id="ed-time" class="nowrap">00:00</span><label class="chip speed-chip">语速 <select id="ed-speed">${[0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2].map(v => `<option ${Math.abs(LT.audio.playbackRate - v) < .01 ? 'selected' : ''}>${v.toFixed(1)}</option>`).join('')}</select>×</label></div>
  <div class="ed-zoom"><canvas id="ed-zoom" height="96"></canvas><div class="ed-zoom-help">拖动两条竖线调整当前句的起点和终点 · 点击波形从该处播放 · 快捷键：<kbd>空格</kbd>播放/暂停 <kbd>↵</kbd>播放当前句 <kbd>↑</kbd><kbd>↓</kbd>上一句/下一句</div></div>
  <p class="ed-hint">点原文里的单词可以加 / 去掉挖空；按住 Shift 再点同一句里的另一个词，可以把挖空扩成短语。</p>
  <div id="ed-list">${edRowsMarkup()}</div></div>`;
  $('#ed-title').addEventListener('change', e => { ed.title = e.target.value.trim() || ed.title; persist(); });
  $('#ed-collection').addEventListener('change', e => { ed.collection = e.target.value.trim(); persist(); });
  $('#ed-speed').addEventListener('change', e => { LT.audio.playbackRate = Number(e.target.value); });
  setupCanvas($('#ed-overview'), 'overview'); setupCanvas($('#ed-zoom'), 'zoom');
  drawWaves(); requestAnimationFrame(() => document.querySelector(`.ed-row[data-i="${edSel}"]`)?.scrollIntoView({ block: 'nearest' }));
}
function edRowsMarkup() {
  const rows = edRows();
  if (!rows.length) return emptyCard('check', '没有待检查的句子', '所有句子的自动对齐置信度都正常。可以切换到“全部句子”抽查。');
  return rows.map(({ q, i, t }) => {
    const flag = needsCheck(t), conf = t ? Math.round((t.confidence || 0) * 100) : 0;
    return `<article class="ed-row ${i === edSel ? 'selected' : ''} ${flag ? 'flag' : ''}" data-i="${i}">
    <div class="ed-row-head"><button class="ed-num" data-lib="play-row" data-i="${i}" title="播放这一句">${ICON('play')}${i + 1}</button>
     <span class="ed-time">${t ? `${fmt(t.start)} – ${fmt(t.end)}` : '未对齐'}</span>
     ${flag ? `<span class="tag warn-tag" title="${t?.estimated ? '这一句没有能对齐的单词，时间是按前后句估计的' : t?.untranscribed > 1 ? '句中有原文里没有的语音' : '识别置信度较低'}">待检查 ${t?.estimated ? '· 估计' : conf + '%'}</span><button class="link-button" data-lib="mark-ok" data-i="${i}">没问题</button>` : t?.checked ? '<span class="tag ok-tag">已确认</span>' : `<span class="conf">${conf}%</span>`}
     <span class="ed-adjust"><span class="muted-line">起点</span><button data-lib="nudge" data-i="${i}" data-edge="start" data-d="-0.1">−0.1</button><button data-lib="nudge" data-i="${i}" data-edge="start" data-d="0.1">+0.1</button><button data-lib="set-here" data-i="${i}" data-edge="start" title="设为当前播放位置">⤓</button><span class="muted-line">终点</span><button data-lib="nudge" data-i="${i}" data-edge="end" data-d="-0.1">−0.1</button><button data-lib="nudge" data-i="${i}" data-edge="end" data-d="0.1">+0.1</button><button data-lib="set-here" data-i="${i}" data-edge="end" title="设为当前播放位置">⤓</button></span>
     <span class="ed-row-actions"><button data-lib="merge" data-i="${i}" title="与下一句合并">合并↓</button><button data-lib="split" data-i="${i}" title="拆成两句">拆分</button><button data-lib="delete-row" data-i="${i}" title="删除这一句（例如考试说明）">删除</button></span></div>
    <div class="ed-text">${q.speaker ? `<span class="turn-speaker">${esc(q.speaker)}</span>` : ''}${textMarkup(q, i)}</div></article>`;
  }).join('');
}
function textMarkup(q, i) {
  const toks = LTBlanks.tokens(q.text), blanks = q.blanks || []; let pos = 0, out = '';
  const inBlank = (a, b) => blanks.find(x => a >= x.start && b <= x.end);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k], bl = inBlank(t.a, t.b);
    if (bl && bl.start === t.a) { out += esc(q.text.slice(pos, t.a)); out += `<mark class="ed-blank" data-lib="word" data-i="${i}" data-a="${bl.start}" data-b="${bl.end}" title="${esc(bl.type)}：${esc(bl.analysis || '')}">${esc(q.text.slice(bl.start, bl.end))}</mark>`; pos = bl.end; continue; }
    if (bl) continue;
    out += esc(q.text.slice(pos, t.a)) + `<span class="ed-word" data-lib="word" data-i="${i}" data-a="${t.a}" data-b="${t.b}">${esc(t.raw)}</span>`; pos = t.b;
  }
  return out + esc(q.text.slice(pos));
}
function refreshList() { const list = $('#ed-list'); if (!list) return; const y = window.scrollY; list.innerHTML = edRowsMarkup(); window.scrollTo(0, y); const st = $('.ed-status'); if (st) { const flagged = ed.sentences.filter(q => needsCheck(ed.timings?.[q.sentenceId])).length; st.innerHTML = `<span>${ed.sentences.length} 句</span><span>${flagged ? `<b class="warn">${flagged}</b> 句待检查` : '没有待检查的句子'}</span><span>挖空 <b>${blankCount(ed)}</b> / ${MAX_BLANKS}</span>`; } drawWaves(); }
function select(i, scroll = true) { edSel = Math.max(0, Math.min(ed.sentences.length - 1, i)); $$('.ed-row').forEach(r => r.classList.toggle('selected', Number(r.dataset.i) === edSel)); if (scroll) document.querySelector(`.ed-row[data-i="${edSel}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); drawWaves(); }
function setEdge(i, edge, value) {
  const q = ed.sentences[i], t = ed.timings[q.sentenceId] ||= { start: 0, end: 1, confidence: 0 }, dur = LT.audio.duration || ed.duration || Infinity;
  const prev = ed.timings[ed.sentences[i - 1]?.sentenceId], next = ed.timings[ed.sentences[i + 1]?.sentenceId];
  value = Math.round(value * 100) / 100;
  if (edge === 'start') { value = Math.max(0, Math.min(value, t.end - .1)); if (prev && value < prev.end) prev.end = Math.max(prev.start + .1, value); t.start = value; }
  else { value = Math.min(dur, Math.max(value, t.start + .1)); if (next && value > next.start) next.start = Math.min(next.end - .1, value); t.end = value; }
  t.checked = true; delete t.estimated; persist();
}
function toggleBlank(i, a, b, extend) {
  const q = ed.sentences[i]; q.blanks ||= [];
  const hit = q.blanks.findIndex(x => a >= x.start && b <= x.end);
  if (extend && edLastSel?.i === i) {
    const s = Math.min(edLastSel.a, a), e = Math.max(edLastSel.b, b);
    q.blanks = q.blanks.filter(x => x.end <= s || x.start >= e);
    const bl = { start: s, end: e, answer: q.text.slice(s, e), type: '短语搭配', analysis: '手动选择的短语' };
    if (LTBlanks.validBlank(q.text, bl)) q.blanks.push({ ...bl, id: blankId(q, bl) });
    edLastSel = { i, a: s, b: e };
  } else if (hit >= 0) { q.blanks.splice(hit, 1); edLastSel = null; }
  else {
    if (blankCount(ed) >= MAX_BLANKS) { toast(`每节最多 ${MAX_BLANKS} 个挖空。`); return; }
    const bl = { start: a, end: b, answer: q.text.slice(a, b), type: /\d/.test(q.text.slice(a, b)) ? '数字与拼写' : '重点词汇', analysis: '手动选择' };
    q.blanks.push({ ...bl, id: blankId(q, bl) }); edLastSel = { i, a, b };
  }
  q.blanks.sort((x, y) => x.start - y.start); persist(); refreshList();
}

// Waveforms: the whole recording (overview) and the selected sentence (zoom, with draggable edges).
function setupCanvas(cv, kind) {
  const resize = () => { const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1; cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.round((kind === 'zoom' ? 96 : 44) * dpr); drawWaves(); };
  new ResizeObserver(resize).observe(cv);
  const timeAt = e => { const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width; if (kind === 'overview') return x * (LT.audio.duration || ed.duration || 1); const v = zoomWindow(); return v.a + x * (v.b - v.a); };
  cv.addEventListener('pointerdown', e => {
    if (kind === 'overview') { const t = timeAt(e); LT.audio.currentTime = t; const i = ed.sentences.findIndex(q => { const x = ed.timings[q.sentenceId]; return x && t >= x.start && t < x.end; }); if (i >= 0) select(i); return; }
    const t = timeAt(e), q = ed.sentences[edSel], tm = ed.timings[q.sentenceId], v = zoomWindow(), tol = (v.b - v.a) * .02;
    if (tm && Math.abs(t - tm.start) < tol) waveDrag = 'start'; else if (tm && Math.abs(t - tm.end) < tol) waveDrag = 'end';
    else { LT.audio.currentTime = t; LT.audio.play().catch(() => { }); return; }
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    if (kind !== 'zoom') return;
    if (!waveDrag) { const t = timeAt(e), tm = ed.timings[ed.sentences[edSel]?.sentenceId], v = zoomWindow(), tol = (v.b - v.a) * .02; cv.style.cursor = tm && (Math.abs(t - tm.start) < tol || Math.abs(t - tm.end) < tol) ? 'ew-resize' : 'pointer'; return; }
    const tm = ed.timings[ed.sentences[edSel].sentenceId]; tm[waveDrag] = timeAt(e); if (tm.end - tm.start < .1) tm[waveDrag] = waveDrag === 'start' ? tm.end - .1 : tm.start + .1; drawWaves();
  });
  cv.addEventListener('pointerup', () => { if (!waveDrag) return; const tm = ed.timings[ed.sentences[edSel].sentenceId]; setEdge(edSel, waveDrag, tm[waveDrag]); waveDrag = null; refreshList(); });
}
function zoomWindow() { const t = ed.timings?.[ed.sentences[edSel]?.sentenceId], dur = LT.audio.duration || ed.duration || 10; if (!t) return { a: 0, b: Math.min(dur, 10) }; const pad = Math.max(1.2, (t.end - t.start) * .25); return { a: Math.max(0, t.start - pad), b: Math.min(dur, t.end + pad) }; }
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function drawWave(cv, a, b, highlight) {
  if (!cv || !ed) return; const g = cv.getContext('2d'), W = cv.width, H = cv.height, dpr = devicePixelRatio || 1; g.clearRect(0, 0, W, H);
  const peaks = ed.peaks, span = b - a || 1, X = t => (t - a) / span * W;
  // sentence spans
  ed.sentences.forEach((q, i) => { const t = ed.timings?.[q.sentenceId]; if (!t || t.end < a || t.start > b) return; g.fillStyle = i === edSel ? css('--soft-2') : needsCheck(t) ? css('--amber-soft') : (i % 2 ? css('--panel-2') : css('--soft')); g.fillRect(X(t.start), 0, Math.max(1, X(t.end) - X(t.start)), H); });
  if (peaks) {
    g.fillStyle = css('--muted'); const step = Math.max(1, Math.floor(dpr));
    for (let x = 0; x < W; x += step) { const i0 = Math.floor((a + x / W * span) * 100), i1 = Math.max(i0 + 1, Math.floor((a + (x + step) / W * span) * 100)); let m = 0; for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i]; const h = Math.max(1, m / 255 * (H - 6)); g.fillRect(x, (H - h) / 2, step, h); }
  } else { g.fillStyle = css('--muted'); g.font = `${12 * dpr}px sans-serif`; g.fillText('正在生成波形……', 8 * dpr, H / 2); }
  if (highlight) { const t = ed.timings?.[ed.sentences[edSel]?.sentenceId]; if (t) { g.fillStyle = css('--ink'); for (const x of [X(t.start), X(t.end)]) g.fillRect(x - dpr, 0, 2 * dpr, H); g.fillRect(X(t.start) - dpr, 0, 8 * dpr, 4 * dpr); g.fillRect(X(t.end) - 7 * dpr, H - 4 * dpr, 8 * dpr, 4 * dpr); } }
  const now = LT.audio.currentTime; if (now >= a && now <= b) { g.fillStyle = css('--red'); g.fillRect(X(now) - dpr / 2, 0, Math.max(1, dpr), H); }
}
function drawWaves() { if (LT.view !== 'edit' || !ed) return; const dur = LT.audio.duration || ed.duration || 1, v = zoomWindow(); drawWave($('#ed-overview'), 0, dur, false); drawWave($('#ed-zoom'), v.a, v.b, true); const tm = $('#ed-time'); if (tm) tm.textContent = clock(LT.audio.currentTime) + ' / ' + clock(dur); }
LT.onTick = () => { if (LT.view === 'edit' && ed && !LT.audio.paused) drawWaves(); };
LT.onEditorKey = e => {
  if (e.code === 'Space') { e.preventDefault(); LT.audio.paused ? LT.audio.play().catch(() => { }) : LT.audio.pause(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); select(edSel + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); select(edSel - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); playRow(edSel); }
};
LT.audio.addEventListener('play', () => { const b = $('[data-lib="toggle"]'); if (b) b.innerHTML = ICON('pause'); });
LT.audio.addEventListener('pause', () => { const b = $('[data-lib="toggle"]'); if (b) b.innerHTML = ICON('play'); drawWaves(); });
function playRow(i) { const t = ed.timings?.[ed.sentences[i].sentenceId]; if (!t) return; select(i, false); LT.playRange(t.start, t.end); }

async function realign() {
  const row = await LTDb.getAudio(ed.id); if (!row?.blob) { toast('找不到这一节的音频，请先更换音频。'); return; }
  openDialog('重新对齐', `<p>会用当前原文重新计算所有句子的时间轴，你手动调整过的时间会被覆盖。挖空不受影响。</p><div id="re-progress"></div><div class="dialog-actions"><button class="primary" data-lib="realign-go">开始</button><button data-action="close-dialog">取消</button></div>`);
  edPending = async () => {
    const box = $('#re-progress'), show = (f, label) => { box.innerHTML = `<div class="align-progress"><div class="progress-track big-track"><div class="progress-fill" style="width:${Math.round(f * 100)}%"></div></div><span>${esc(label)} · ${Math.round(f * 100)}%</span></div>`; };
    $$('#dialog-body .dialog-actions button').forEach(b => b.disabled = true);
    try { show(0, '解码音频'); const { samples } = await decodeMono16k(row.blob); ed.peaks = peaksOf(samples); const t0 = performance.now(); const res = await runAlignment(samples, ed.sentences.map(q => q.text), show); applyAlignment(ed, res.result, (performance.now() - t0) / 1000); await persist(true); $('#dialog').close(); renderEditor(); toast('已重新对齐。'); }
    catch (e) { box.innerHTML = `<div class="alert danger-soft">${esc(e.message)}</div>`; $$('#dialog-body .dialog-actions button').forEach(b => b.disabled = false); }
  };
}
function editText() {
  const text = ed.sentences.map((q, i) => { const prev = ed.sentences[i - 1]; const sep = !prev ? '' : prev.paragraphId !== q.paragraphId ? '\n\n' : prev.speaker !== q.speaker ? '\n' : ' '; return sep + (q.speaker && prev?.speaker !== q.speaker || q.speaker && sep.includes('\n') ? q.speaker + ': ' : '') + q.text; }).join('');
  openDialog('编辑原文', `<p class="muted-line">改完后会按新原文重新分句并重新对齐；没有改动的句子保留原来的挖空。</p><textarea id="edit-text" rows="16" spellcheck="false" class="wide-text">${esc(text)}</textarea><div class="dialog-actions"><button class="primary" data-lib="edit-text-go">保存并重新对齐</button><button data-action="close-dialog">取消</button></div>`);
  $('#dialog').classList.add('wide-dialog');
}
async function applyTextEdit() {
  const parsed = LTTranscript.parse($('#edit-text').value); if (!parsed.sentences.length) { toast('原文是空的。'); return; }
  const oldByText = new Map(ed.sentences.map(q => [q.text, q])), kept = [];
  for (const p of parsed.sentences) { const old = oldByText.get(p.text); if (old) { oldByText.delete(p.text); kept.push({ ...old, speaker: p.speaker, paragraphId: `${ed.id}-p${p.paragraph}` }); } else kept.push({ fresh: true, speaker: p.speaker, paragraphId: `${ed.id}-p${p.paragraph}`, text: p.text, blanks: [] }); }
  ed.sentences = kept.filter(q => !q.fresh);
  for (const q of kept) if (q.fresh) { delete q.fresh; q.sentenceId = nextSentenceId(ed); }
  ed.sentences = kept; ed.sentences.forEach((q, i) => q.n = i + 1);
  for (const id of Object.keys(ed.timings || {})) if (!ed.sentences.some(q => q.sentenceId === id)) delete ed.timings[id];
  await persist(true); $('#dialog').close(); renderEditor(); await realign(); $('[data-lib="realign-go"]')?.click();
}
function mergeRow(i) {
  const q = ed.sentences[i], next = ed.sentences[i + 1]; if (!next) { toast('已经是最后一句。'); return; }
  const shift = q.text.length + 1, t = ed.timings[q.sentenceId], nt = ed.timings[next.sentenceId];
  q.text += ' ' + next.text; q.blanks = [...(q.blanks || []), ...(next.blanks || []).map(b => ({ ...b, start: b.start + shift, end: b.end + shift }))].map(b => ({ ...b, id: blankId(q, b) }));
  if (t && nt) { t.end = nt.end; t.checked = true; }
  ed.sentences.splice(i + 1, 1); delete ed.timings[next.sentenceId]; ed.sentences.forEach((x, k) => x.n = k + 1); persist(); refreshList(); toast('两句已合并。');
}
function deleteRow(i) {
  const q = ed.sentences[i]; if (ed.sentences.length < 2) { toast('至少要保留一句。'); return; }
  if (!confirm(`删除第 ${i + 1} 句？\n${q.text}`)) return;
  ed.sentences.splice(i, 1); delete ed.timings[q.sentenceId]; ed.sentences.forEach((x, k) => x.n = k + 1);
  edSel = Math.min(edSel, ed.sentences.length - 1); persist(); refreshList(); toast('已删除。');
}
function splitRow(i) {
  const q = ed.sentences[i], t = ed.timings[q.sentenceId], words = [...q.text.matchAll(/\S+/g)]; if (words.length < 2) { toast('这句太短，无法拆分。'); return; }
  openDialog('拆分句子', `<p>点击新句子开始的那个词：</p><p class="split-words">${words.slice(1).map((w, k) => `<button class="chip" data-lib="split-at" data-i="${i}" data-at="${w.index}">${esc(w[0])}</button>`).join(' ')}</p><p class="muted-line">拆分时间取自对齐时的单词时间，之后可以在波形上微调。</p>`);
}
function splitAt(i, cut) {
  const q = ed.sentences[i], t = ed.timings[q.sentenceId]; if (q.blanks?.some(b => b.start < cut && b.end > cut)) { toast('不能从一个挖空短语中间拆开。'); return; }
  const id = nextSentenceId(ed);
  const tail = { sentenceId: id, paragraphId: q.paragraphId, speaker: q.speaker, text: q.text.slice(cut).trim(), blanks: [] }, lead = q.text.slice(cut).length - q.text.slice(cut).trimStart().length;
  tail.blanks = (q.blanks || []).filter(b => b.start >= cut).map(b => ({ ...b, start: b.start - cut - lead, end: b.end - cut - lead })).map(b => ({ ...b, id: blankId(tail, b) }));
  q.blanks = (q.blanks || []).filter(b => b.end <= cut); q.text = q.text.slice(0, cut).trimEnd();
  if (t) { const w = (t.words || []).find(x => x[0] >= cut); const at = w ? w[2] : (t.start + t.end) / 2; ed.timings[id] = { start: Math.max(t.start + .1, at - .05), end: t.end, confidence: t.confidence, checked: true }; t.end = Math.max(t.start + .1, at - .05); t.checked = true; }
  ed.sentences.splice(i + 1, 0, tail); ed.sentences.forEach((x, k) => x.n = k + 1); $('#dialog').close(); persist(); refreshList(); toast('句子已拆分。');
}

// ---------- AI selection settings ----------
function aiConfig() { try { return JSON.parse(localStorage.getItem('lt-ai') || '{}'); } catch { return {}; } }
function openAi() {
  const c = aiConfig();
  openDialog('AI 选词（可选）', `<p>用你自己的 AI 服务账号来选挖空：原文会从你的浏览器直接发给你填写的服务商，不经过本项目。选出的每个答案都会核对是否原样出现在句子里。</p>
  <div class="ai-form"><label class="field"><span>接口类型</span><select id="ai-kind"><option value="openai" ${c.kind !== 'anthropic' ? 'selected' : ''}>OpenAI 兼容（DeepSeek、通义千问、Kimi、OpenAI 等）</option><option value="anthropic" ${c.kind === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option></select></label>
  <label class="field"><span>接口地址</span><input id="ai-base" placeholder="例如 https://api.deepseek.com/v1" value="${esc(c.baseUrl || '')}"></label>
  <label class="field"><span>模型名称</span><input id="ai-model" placeholder="以服务商文档为准" value="${esc(c.model || '')}"></label>
  <label class="field"><span>API Key</span><input id="ai-key" type="password" autocomplete="off" value="${esc(c.apiKey || '')}"></label>
  <label class="check"><input type="checkbox" id="ai-remember" ${c.apiKey ? 'checked' : ''}> 在这个浏览器里记住（保存在本机 localStorage，公共电脑不要勾选）</label></div>
  <div id="ai-status"></div><div class="dialog-actions"><button class="primary" data-lib="ai-go">${ICON('sparkle')}开始选词（替换现有挖空）</button><button data-action="close-dialog">取消</button></div>`);
}
async function runAi() {
  const config = { kind: $('#ai-kind').value, baseUrl: $('#ai-base').value.trim(), model: $('#ai-model').value.trim(), apiKey: $('#ai-key').value.trim() };
  try { if ($('#ai-remember').checked) localStorage.setItem('lt-ai', JSON.stringify(config)); else localStorage.setItem('lt-ai', JSON.stringify({ ...config, apiKey: '' })); } catch { }
  const status = $('#ai-status'); status.innerHTML = '<div class="alert">正在请求 AI，长原文可能需要一两分钟……</div>'; $$('#dialog-body .dialog-actions button').forEach(b => b.disabled = true);
  try {
    const { perSentence, rejected } = await LTAi.select(ed.sentences, config, { perSection: MAX_BLANKS });
    const n = perSentence.flat().length; if (!n) throw new Error('AI 没有返回可用的挖空。');
    setBlanks(ed, perSentence, 'ai'); await persist(true); $('#dialog').close(); refreshList();
    toast(`AI 选出 ${n} 个挖空${rejected.length ? `，另有 ${rejected.length} 个因不在原句中或超出上限被丢弃` : ''}。`);
  } catch (e) { status.innerHTML = `<div class="alert danger-soft">${esc(e.message || e)}</div>`; $$('#dialog-body .dialog-actions button').forEach(b => b.disabled = false); }
}

// ---------- Packs ----------
async function exportSections(list, name) {
  toast('正在打包……');
  const items = []; for (const s of list) { const row = await LTDb.getAudio(s.id); items.push({ section: cleanForStore(s), audio: row || null }); }
  const blob = await LTPack.exportPack(items); download(name.replace(/[\\/:*?"<>|]+/g, '_') + '.zip', blob);
}
function importPackFile() {
  importFile('.zip,application/zip', async file => {
    try {
      const items = await LTPack.importPack(file); let added = 0, replaced = 0, first = null;
      for (const { section, audio } of items) {
        const problems = LTSection.validate(section); if (problems.length) { toast(`跳过一节（${problems[0]}）`); continue; }
        let sec = section;
        if (LT.sections.some(s => s.id === sec.id)) { if (confirm(`题库里已经有“${sectionName(sec)}”。点“确定”覆盖，点“取消”另存一份。`)) replaced++; else { sec = withNewId(sec, newId()); added++; } } else added++;
        await storeSection(sec, audio ? { blob: audio.blob, name: audio.name, type: audio.type } : null); first ||= sec.id;
      }
      await LT.reloadSections(first); toast(`已导入 ${added + replaced} 节${replaced ? `（覆盖 ${replaced} 节）` : ''}。`); LT.go('library');
    } catch (e) { openDialog('无法导入内容包', `<div class="alert danger-soft">${esc(e.message || e)}</div>`); }
  });
}
async function loadSample() {
  try {
    toast('正在加载示例……');
    const res = await fetch('samples/sample-pack.zip'); if (!res.ok) throw new Error('示例文件不存在。');
    const items = await LTPack.importPack(await res.blob());
    for (const { section, audio } of items) await storeSection(section, audio ? { blob: audio.blob, name: audio.name, type: audio.type } : null);
    await LT.reloadSections(items[0].section.id); LT.setSection(items[0].section.id); toast('示例已加入题库。');
  } catch (e) { toast('示例加载失败：' + (e.message || e)); }
}

// ---------- Events ----------
LT.registerView('library', renderLibrary, '题库管理');
LT.registerView('import', () => renderImport(), '导入新材料');
LT.registerView('edit', renderEditor, '校对');
LT.openEditor = openEditor;
LT.onAction = action => { if (action === 'import-new') LT.go('import'); else if (action === 'load-sample') loadSample(); else if (action === 'import-pack') importPackFile(); };
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-lib]'); if (!el || el.matches('[data-lib-root]')) return;
  const act = el.dataset.lib, id = el.dataset.id, i = Number(el.dataset.i);
  switch (act) {
    case 'new': LT.go('import'); break;
    case 'practice': LT.setSection(id); break;
    case 'edit': openEditor(id); break;
    case 'back': LT.go('library'); break;
    case 'export': { const s = LT.sections.find(x => x.id === id); if (s) exportSections([s], sectionName(s)); break; }
    case 'export-group': exportSections(LT.sections.filter(s => (s.collection || '未分组') === el.dataset.group), el.dataset.group); break;
    case 'export-all': exportSections(LT.sections, '精听题库_' + new Date().toISOString().slice(0, 10)); break;
    case 'import-pack': importPackFile(); break;
    case 'sample': loadSample(); break;
    case 'delete': { const s = LT.sections.find(x => x.id === id); if (!s || !confirm(`删除“${sectionName(s)}”？音频、原文和这一节的练习记录都会删除，无法撤销（建议先导出）。`)) break; if (LT.sectionId === id) LT.releaseAudio(); await LTDb.deleteSection(id); LT.clearPractice(id); await LT.reloadSections(); renderLibrary(); toast('已删除。'); break; }
    case 'pick-audio': importFile('audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac', file => { draft.file = file; draft.proof = null; $('#imp-proof').innerHTML = ''; $('#imp-audio-name').textContent = `${file.name} · ${kb(file.size)}`; if (!$('#imp-title').value) $('#imp-title').value = file.name.replace(/\.[^.]+$/, ''); checkReady(); }); break;
    case 'pick-text': importFile('.txt,text/plain', async file => { $('#imp-text').value = await file.text(); previewText(); }); break;
    case 'start-import': startImport(); break;
    case 'cancel-import': stopProofAudio(); draft = null; LT.go('library'); break;
    case 'next-import': renderImport({ collection: el.dataset.collection, title: nextTitle(el.dataset.title || ''), mode: el.dataset.mode || 'text' }); break;
    case 'mode': setMode(el.dataset.mode); break;
    case 'revert': { const r = draft.proof.rows[Number(el.dataset.r)]; $$('[data-pr-text]').forEach(syncProofText); LTProofread.revert(r, Number(el.dataset.k)); renderProof(); break; }
    case 'pr-play': playProof(Number(el.dataset.r)); break;
    case 'pr-filter': $$('[data-pr-text]').forEach(syncProofText); draft.proofFilter = el.dataset.filter; renderProof(); break;
    case 'pr-monologue': $$('[data-pr-text]').forEach(syncProofText); draft.monologue = true; renderProof(); break;
    case 'pr-dialogue': $$('[data-pr-text]').forEach(syncProofText); draft.monologue = false; renderProof(); break;
    case 'pr-confirm': confirmProof(); break;
    case 'pr-restart': draft.proof = null; $('#imp-proof').innerHTML = ''; lockForm(false); startTranscribe(); break;
    case 'pr-copy': $$('[data-pr-text]').forEach(syncProofText); navigator.clipboard?.writeText(proofText()).then(() => toast('原文已复制。'), () => toast('浏览器不允许复制。')); break;
    case 'filter': edFilter = el.dataset.filter; renderEditor(); break;
    case 'toggle': LT.audio.paused ? LT.audio.play().catch(() => { }) : LT.audio.pause(); break;
    case 'play-row': playRow(i); break;
    case 'nudge': { const t = ed.timings[ed.sentences[i].sentenceId]; if (t) { setEdge(i, el.dataset.edge, t[el.dataset.edge] + Number(el.dataset.d)); select(i, false); refreshList(); } break; }
    case 'set-here': setEdge(i, el.dataset.edge, LT.audio.currentTime); select(i, false); refreshList(); break;
    case 'mark-ok': { const t = ed.timings[ed.sentences[i].sentenceId]; if (t) { t.checked = true; persist(); refreshList(); } break; }
    case 'merge': mergeRow(i); break;
    case 'delete-row': deleteRow(i); break;
    case 'split': splitRow(i); break;
    case 'split-at': splitAt(i, Number(el.dataset.at)); break;
    case 'word': select(i, false); toggleBlank(i, Number(el.dataset.a), Number(el.dataset.b), e.shiftKey); break;
    case 'auto-blanks': if (blankCount(ed) && !confirm('自动选词会替换本节现有的挖空（这一节的作答记录也会清空）。继续吗？')) break; autoBlanks(ed); persist(); refreshList(); toast(`已自动选出 ${blankCount(ed)} 个挖空。`); break;
    case 'clear-blanks': if (!confirm('清空本节所有挖空？')) break; setBlanks(ed, [], 'clear'); persist(); refreshList(); break;
    case 'ai-blanks': openAi(); break;
    case 'ai-go': runAi(); break;
    case 'realign': realign(); break;
    case 'realign-go': edPending?.(); break;
    case 'edit-text': editText(); break;
    case 'edit-text-go': applyTextEdit(); break;
    case 'replace-audio': importFile('audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac', async file => { LT.releaseAudio(); await storeSection(ed, { blob: file, name: file.name, type: file.type || 'audio/mpeg' }); ed.peaks = null; await LT.reloadSections(ed.id); openEditor(ed.id); toast('音频已更换。如果和原来的录音不同，请点“重新对齐”。'); }); break;
  }
  if (act !== 'word' && el.closest('.ed-row') && !['play-row', 'merge', 'split', 'delete-row'].includes(act)) select(Number(el.closest('.ed-row').dataset.i), false);
});
document.addEventListener('click', e => { const row = e.target.closest('.ed-row'); if (row && !e.target.closest('button,[data-lib]')) select(Number(row.dataset.i), false); });
})();
