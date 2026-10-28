/* Practice app: library tree, blind listening, dictation, review, mistakes, vocabulary, index, statistics. */
(function () {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)], C = ListeningCore;
const ICON = name => `<svg class="icon"><use href="#i-${name}"/></svg>`;
const DAY = 86400000, WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const emptyState = () => ({ schemaVersion: 1, attempts: {}, errors: {}, stars: {}, trouble: {}, vocabulary: {}, speeds: {}, blind: {}, completed: {}, replays: {}, blankRevisions: {}, resume: {}, logs: [] });
let state = emptyState(), sections = [], sectionId = null, mode = 'blind', view = 'home', weakOnly = false, currentId = null, pauseIds = [], pauseIndex = -1, blindNote = '', autoStop = false, a = null, b = null, stopAt = null, loop = false, audioFailed = false, practiceStart = Date.now(), pendingSeek = null, pauseReason = null, reviewToken = Date.now(), lastWall = null, lastSaved = 0, toastTimer = null, audioUrl = null, audioFor = null;
let followParagraph = false, lastParagraph = null, coreWords = new Set(), wordSource = null;
const audio = $('#audio'), views = {};

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x])); }
function dateKey(t = Date.now()) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function clock(t) { t = Math.max(0, Number(t) || 0); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }
function toast(msg, html = false) { clearTimeout(toastTimer); const t = $('#toast'); if (html) t.innerHTML = msg; else t.textContent = msg; t.hidden = false; t.classList.remove('toast-in'); void t.offsetWidth; t.classList.add('toast-in'); toastTimer = setTimeout(() => t.hidden = true, html ? 6000 : 4000); }
const VIEW_NAMES = { listen: '精听练习', review: '今日复习', mistakes: '错题本', vocab: '生词本', index: '考点索引', stats: '学习统计', library: '题库管理', import: '导入新材料', edit: '校对' };
function emptyCard(icon, title, text = '', action = '') { return `<div class="empty"><span class="empty-icon">${ICON(icon)}</span><h2>${title}</h2>${text ? `<p>${text}</p>` : ''}${action}</div>`; }
function sectionName(s) { return s ? `${s.collection ? s.collection + ' · ' : ''}${s.title}` : ''; }
function sentenceNo(q) { return q.n ?? 0; }
function source(sec, q) { return `${sectionName(sec)} · 句 ${Number(sentenceNo(q))}`; }
function openDrawer() { document.body.classList.add('drawer-open'); $('#drawer-backdrop').hidden = false; $('#menu-toggle').setAttribute('aria-expanded', 'true'); }
function closeDrawer() { if (!document.body.classList.contains('drawer-open')) return; document.body.classList.remove('drawer-open'); $('#drawer-backdrop').hidden = true; $('#menu-toggle').setAttribute('aria-expanded', 'false'); }
function storageError(msg) { $('#storage-alert').hidden = false; $('#storage-alert').textContent = msg; }

// ---------- Saving (IndexedDB, debounced) ----------
let saveTimer = null, saving = Promise.resolve();
function save(now = false) {
  clearTimeout(saveTimer);
  const run = () => { saving = saving.then(() => LTDb.setMeta('state', state)).catch(e => storageError('学习记录保存失败（' + (e?.message || e) + '）。请先用“备份学习记录”导出。')); };
  if (now) run(); else saveTimer = setTimeout(run, 400);
}
function noteResume(position) { const s = section(); if (!s) return; state.resume = { sectionId: s.id, mode, position: Math.max(0, Number(position ?? (audioFor === s.id ? audio.currentTime : 0)) || 0), updatedAt: new Date().toISOString() }; }

// ---------- Section data ----------
function section() { return sections.find(s => s.id === sectionId) || null; }
function findSentence(id) { for (const sec of sections) { const sentence = sec.sentences.find(q => q.sentenceId === id); if (sentence) return { sec, sentence }; } return null; }
function timing(id, sec = section()) { const t = sec?.timings?.[id]; return C.validTiming(t) ? t : null; }
function timingsOf(sec = section()) { return sec.sentences.map(q => timing(q.sentenceId, sec)); }
function hasTimeline(sec = section()) { return !!sec && C.timelineReady(timingsOf(sec)); }
function paragraphs() { return C.groupParagraphs(section().sentences); }
function currentParagraph() { return paragraphs().find(p => p.sentences.some(q => q.sentenceId === currentId)); }
function activeBlanks(q) { return q.blanks || []; }
function allBlanks(sec = section()) { return sec ? sec.sentences.flatMap(q => activeBlanks(q)) : []; }
function lookupBlank(id) { for (const sec of sections) for (const q of sec.sentences) { const blank = activeBlanks(q).find(b => b.id === id); if (blank) return { sec, sentence: q, blank }; } return null; }
function dueErrors() { return Object.values(state.errors).filter(e => !e.review?.retired && (e.review?.due || Infinity) <= Date.now() && lookupBlank(e.blankId)); }

// A new blank selection makes the old answers meaningless: clear that section's practice records once.
function applyBlankRevisions(announce) {
  const cleared = [];
  for (const s of sections) {
    const rev = s.blankRevision || 'none';
    if (state.blankRevisions[s.id] === undefined) { state.blankRevisions[s.id] = rev; continue; }
    if (state.blankRevisions[s.id] !== rev) { if (C.clearSectionPractice(state, s.id, true)) cleared.push(s); state.blankRevisions[s.id] = rev; }
  }
  if (cleared.length) { save(); if (announce) toast(`${cleared.map(s => s.title).join('、')} 的挖空已更新，旧作答已清空（生词和标星保留）。`); }
}

function prepare(list) { const out = list.filter(s => Array.isArray(s.sentences)); for (const s of out) s.sentences.forEach((q, i) => { q.n = i + 1; }); return out; }
async function reloadSections(keepId = sectionId) {
  sections = prepare(await LTDb.listSections());
  applyBlankRevisions(true);
  if (!sections.some(s => s.id === keepId)) { sectionId = sections[0]?.id || null; audioFor = null; }
  updateChrome();
}

function updateChrome() {
  const bs = allBlanks(), attempts = bs.map(b => state.attempts[b.id]).filter(Boolean), score = C.score(attempts);
  $('#progress').textContent = `${attempts.length} / ${bs.length} 空`; $('#progress-fill').style.width = `${bs.length ? attempts.length / bs.length * 100 : 0}%`;
  $('#accuracy').textContent = score.total ? `${Math.round(score.rate * 100)}%` : '—';
  $('#error-count').textContent = attempts.filter(a => a.status === 'wrong').length;
  const due = dueErrors().length, words = Object.keys(state.vocabulary).length; $('#due-nav').textContent = due; $('#due-nav').hidden = !due; $('#vocab-nav').textContent = words; $('#vocab-nav').hidden = !words;
  renderTree();
}
function renderTree() {
  const groups = C.groupSections(sections), opened = new Set($$('#tree details[open]').map(el => el.dataset.group)), current = section();
  $('#library-count').textContent = sections.length ? `${groups.length} 组 · ${sections.length} 节` : '';
  if (!sections.length) { $('#tree').innerHTML = `<p class="tree-empty">题库还是空的。<br><button class="link-button" data-action="import-new">导入第一段材料</button> 或 <button class="link-button" data-action="load-sample">加载示例</button></p>`; return; }
  $('#tree').innerHTML = groups.map(g => `<details data-group="${esc(g.name)}" ${current && (current.collection || '未分组') === g.name || opened.has(g.name) ? 'open' : ''}><summary class="tree-book"><svg class="icon chevron"><use href="#i-chevron"/></svg><span class="tree-name">${esc(g.name)}</span>${testCountMarkup(g.sections)}</summary>${g.sections.map(s => {
    const blanks = allBlanks(s), progress = C.sectionProgress(blanks, state.attempts), done = blanks.filter(b => state.attempts[b.id]).length;
    return `<button class="tree-section ${s.id === sectionId ? 'selected' : ''}" data-section="${s.id}"><span>${esc(s.title)}</span>${progressRing(blanks.length ? done / blanks.length : 0, progress)}</button>`;
  }).join('')}</details>`).join('');
}
function progressRing(ratio, progress) { const c = 2 * Math.PI * 6, len = Math.max(0, Math.min(1, ratio)) * c; return `<svg class="pring ${progress.status}" viewBox="0 0 16 16" role="img" aria-label="${progress.label}"><title>${progress.label}${ratio > 0 && ratio < 1 ? ` · ${Math.round(ratio * 100)}%` : ''}</title><circle class="pt" cx="8" cy="8" r="6"/>${len > 0 ? `<circle class="pf" cx="8" cy="8" r="6" stroke-dasharray="${len.toFixed(2)} ${c.toFixed(2)}"/>` : ''}</svg>`; }
function testCountMarkup(list) { const started = list.filter(s => allBlanks(s).some(b => state.attempts[b.id])).length; return started ? `<span class="tree-count">${started}/${list.length}</span>` : ''; }

async function loadAudio(sec) {
  if (audioFor === sec.id && audio.src) return;
  pauseReason = 'switch'; audio.pause(); audioFailed = false; audioFor = sec.id;
  if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  const row = await LTDb.getAudio(sec.id).catch(() => null);
  if (audioFor !== sec.id) return;
  if (!row?.blob) { audio.removeAttribute('src'); audio.load(); audio.dispatchEvent(new Event('error')); return; }
  audioUrl = URL.createObjectURL(row.blob); audio.src = audioUrl;
  audio.playbackRate = state.speeds[sec.id] || 1; $('#speed').value = Number(audio.playbackRate).toFixed(1);
}

function setSection(id, nextView = 'listen') {
  if (!sections.some(s => s.id === id)) return;
  pauseReason = 'switch'; audio.pause(); stopAt = null; a = b = null; loop = false; sectionId = id; mode = 'blind'; view = nextView; weakOnly = false; pauseIds = []; pauseIndex = -1; blindNote = ''; autoStop = false; currentId = null;
  lastParagraph = null; $('#audio-alert').hidden = true; $('.player-main').hidden = false; $('.player-options').hidden = false;
  $('#seek').value = 0; $('#seek').max = 1; $('#current-time').textContent = '00:00'; $('#duration').textContent = '--:--'; $('#play').innerHTML = ICON('play'); $('#play').setAttribute('aria-label', '播放');
  practiceStart = Date.now();
  const current = section();
  loadAudio(current);
  $('#timing-tag').hidden = hasTimeline(current);
  $('#section-title').textContent = current.title; $('#section-collection').textContent = current.collection || 'INTENSIVE LISTENING'; $('#audio-label').textContent = sectionName(current);
  const siblings = sections.filter(s => (s.collection || '') === (current.collection || '')).sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || x.title.localeCompare(y.title, 'en', { numeric: true }));
  $('#section-switch').innerHTML = siblings.length > 1 && siblings.length <= 8 ? siblings.map((s, i) => `<button data-section="${s.id}" class="${s.id === id ? 'selected' : ''}" title="${esc(s.title)}">${i + 1}</button>`).join('') : '';
  updateAB(); renderView(); updateChrome();
}
function renderView() {
  document.body.dataset.view = view;
  $$('.main-nav button').forEach(b => b.classList.toggle('selected', b.dataset.view === view || view === 'import' && b.dataset.view === 'library' || view === 'edit' && b.dataset.view === 'library'));
  const listening = view === 'listen' && !!section();
  $('#listen-view').hidden = !listening; $('#other-view').hidden = listening;
  closeDrawer();
  $('#breadcrumb').textContent = view === 'listen' && section() ? sectionName(section()) : VIEW_NAMES[view] || '';
  if (listening) { document.title = `${section().title} · 精听练习器`; renderPractice(); return; }
  if (view !== 'edit') { pauseReason = 'navigation'; audio.pause(); stopAt = null; }
  document.title = view === 'home' ? '精听练习器' : `${VIEW_NAMES[view] || ''} · 精听练习器`; window.scrollTo(0, 0);
  if (view === 'listen') { $('#other-view').innerHTML = emptyCard('headphones', '还没有可以练习的材料', '先导入一段英语听力音频和对应原文，网站会自动逐句对齐。', `<div class="dialog-actions" style="justify-content:center"><button class="primary" data-action="import-new">${ICON('plus')}导入新材料</button><button data-action="load-sample">加载示例</button></div>`); return; }
  if (views[view]) { views[view](); return; }
  ({ home: renderHome, vocab: renderVocab, mistakes: renderMistakes, review: renderReview, index: renderIndex, stats: renderStats })[view]?.();
}
function go(next) { if (next !== view) { selection.mistakes.clear(); selection.vocab.clear(); lastDeletion = null; } view = next; reviewToken = Date.now(); renderView(); }

// ---------- Practice ----------
function wordMarkup(text) { return text.split(/([A-Za-zÀ-ÿ]+(?:[’'][A-Za-z]+)*(?:-[A-Za-z]+)*)/g).map((x, i) => i % 2 ? `<span class="word" data-word="${esc(x)}" title="加入生词本">${esc(x)}</span>` : esc(x)).join(''); }
function sentenceMarkup(q) {
  const bs = activeBlanks(q).slice().sort((a, b) => a.start - b.start); let pos = 0, body = '';
  for (const blank of bs) {
    body += wordMarkup(q.text.slice(pos, blank.start)); const attempt = state.attempts[blank.id]; const value = attempt?.status === 'revealed' ? blank.answer : attempt?.value || '';
    body += `<input class="blank ${esc(attempt?.status || '')}" data-blank="${blank.id}" aria-label="${esc(source(section(), q))} 挖空 ${bs.indexOf(blank) + 1}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="width:${Math.min(460, Math.max(84, blank.answer.length * 10 + 46))}px" value="${esc(value)}" ${attempt?.status === 'revealed' ? 'readonly' : ''} placeholder="${String(bs.indexOf(blank) + 1).padStart(2, '0')}">`; pos = blank.end;
  }
  body += wordMarkup(q.text.slice(pos)); const trouble = state.trouble[q.sentenceId], timed = !!timing(q.sentenceId), n = Number(sentenceNo(q));
  return `<span class="sentence ${trouble ? 'trouble' : ''} ${currentId === q.sentenceId && !audio.paused ? 'playing' : ''}" data-sentence="${q.sentenceId}"><button class="sentence-play" data-play="${q.sentenceId}" title="${timed ? '重听句 ' + n : '暂不支持逐句定位'}" ${audioFailed || !timed ? 'disabled' : ''}>${n}</button><span class="sentence-body">${body}</span><span class="sentence-actions"><button class="star ${state.stars[q.sentenceId] ? 'on' : ''}" data-star="${q.sentenceId}" title="标星句 ${n}（S）" aria-pressed="${!!state.stars[q.sentenceId]}">${ICON('star')}</button><button class="analysis-button" data-analysis="${q.sentenceId}" title="考点解析" aria-label="展开句 ${n} 考点解析">${ICON('bulb')}</button></span></span>`;
}
function renderParagraphs(rows) {
  const ids = new Set(rows.map(q => q.sentenceId)), all = paragraphs(), selected = all.filter(p => p.sentences.some(q => ids.has(q.sentenceId)));
  if (weakOnly) selected.sort((x, y) => Math.min(...x.sentences.filter(q => ids.has(q.sentenceId)).map(q => rows.indexOf(q))) - Math.min(...y.sentences.filter(q => ids.has(q.sentenceId)).map(q => rows.indexOf(q))));
  return selected.map(p => {
    const turns = []; for (const q of p.sentences) { if (!turns.length || turns.at(-1).speaker !== q.speaker) turns.push({ speaker: q.speaker, sentences: [] }); turns.at(-1).sentences.push(q); }
    const index = all.findIndex(g => g.id === p.id) + 1, first = p.sentences[0], last = p.sentences.at(-1), trouble = p.sentences.some(q => state.trouble[q.sentenceId]);
    return `<article class="reading-paragraph ${trouble ? 'has-trouble' : ''}" data-paragraph="${p.id}"><header class="paragraph-header"><strong>第 ${String(index).padStart(2, '0')} 段</strong><span>句 ${Number(sentenceNo(first))}–${Number(sentenceNo(last))}</span>${trouble ? '<span class="label-tag">盲听卡点</span>' : ''}<button data-play-paragraph="${p.id}" ${audioFailed || !p.sentences.every(q => timing(q.sentenceId)) ? 'disabled' : ''}>${ICON('play')}重听本段</button></header><div class="paragraph-text">${turns.map(turn => `<div class="dialogue-turn${turn.speaker ? '' : ' narration'}">${turn.speaker ? `<span class="turn-speaker" title="${esc(turn.speaker)}">${esc(turn.speaker)}</span>` : ''}<div class="turn-text">${turn.sentences.map(sentenceMarkup).join(' ')}</div></div>`).join('')}</div>${p.sentences.map(q => `<div class="feedback" data-feedback="${q.sentenceId}">${feedbackMarkup(q)}</div><div class="analysis" data-analysis-body="${q.sentenceId}" hidden><strong>句 ${Number(sentenceNo(q))}</strong>${activeBlanks(q).length ? activeBlanks(q).map(b => `<p><span class="label-tag">${esc(b.type)}</span> ${esc(b.analysis)}</p>`).join('') : ' 本句保留完整原文，可重听或手动标星。'}</div>`).join('')}</article>`;
  }).join('');
}
function feedbackMarkup(q) {
  return activeBlanks(q).map(b => {
    const attempt = state.attempts[b.id];
    if (['wrong', 'skipped'].includes(attempt?.status)) return `<div class="feedback-row"><span class="feedback-label">你的答案</span><b>${esc(attempt.value || '已跳过')}</b><button class="link-button" data-reveal-one="${b.id}">显示正确答案</button></div>`;
    const e = state.errors[b.id]; if (attempt?.status === 'revealed' && e && attempt.at >= e.lastWrong) return `<div class="feedback-row">${diffMarkup(e.myAnswer, b.answer)}</div>`; return '';
  }).join('');
}
function diffMarkup(value, answer) {
  const d = C.answerDiff(value, answer);
  if (d.mode === 'missing' || d.mode === 'same') return `<span class="diff"><span class="diff-label">正确答案</span><b class="diff-answer">${esc(d.answer)}</b></span>`;
  if (d.mode === 'whole') return `<span class="diff"><s class="diff-yours">${esc(d.value)}</s><svg class="icon diff-arrow"><use href="#i-arrow"/></svg><b class="diff-answer">${esc(d.answer)}</b></span>`;
  return `<span class="diff"><span class="diff-label">拼写</span><span class="diff-letters">${d.ops.map(op => op.type === 'same' ? esc(op.text) : op.type === 'missing' ? `<ins title="漏写">${esc(op.text)}</ins>` : op.type === 'extra' ? `<del title="多写">${esc(op.text)}</del>` : `<del title="写错">${esc(op.text)}</del><ins title="应为">${esc(op.expect)}</ins>`).join('')}</span><span class="diff-legend"><ins>漏</ins><del>多/错</del></span></span>`;
}
function weakSentences() {
  const errors = Object.values(state.errors).filter(e => e.sectionId === sectionId);
  const ids = new Set([...Object.keys(state.stars), ...Object.keys(state.trouble), ...errors.map(e => e.sentenceId)]); let result = section().sentences.filter(q => ids.has(q.sentenceId));
  const errs = id => errors.filter(e => e.sentenceId === id);
  if ($('#weak-sort').value === 'type') result.sort((x, y) => (errs(x.sentenceId)[0]?.type || '').localeCompare(errs(y.sentenceId)[0]?.type || ''));
  else result.sort((x, y) => Math.max(state.stars[y.sentenceId] || 0, state.trouble[y.sentenceId]?.at || 0, ...errs(y.sentenceId).map(e => e.lastWrong)) - Math.max(state.stars[x.sentenceId] || 0, state.trouble[x.sentenceId]?.at || 0, ...errs(x.sentenceId).map(e => e.lastWrong)));
  return result;
}
function blindMarkup() {
  const list = section().sentences;
  return `<div class="blind-lines">${pauseIds.map(id => {
    const index = list.findIndex(q => q.sentenceId === id), q = list[index], n = Number(sentenceNo(q)), timed = !!timing(id);
    return `<div class="blind-line ${index === pauseIndex ? 'current' : ''}" data-sentence="${id}"><button class="sentence-play" data-play="${id}" title="重听句 ${n}" ${audioFailed || !timed ? 'disabled' : ''}>${n}</button><span class="blind-role">${index === pauseIndex ? '当前句' : index < pauseIndex ? '上一句' : '下一句'}</span><span class="blind-text">${q.speaker ? `<span class="turn-speaker">${esc(q.speaker)}</span>` : ''}<span class="sentence-body">${wordMarkup(q.text)}</span></span><button class="star ${state.stars[id] ? 'on' : ''}" data-star="${id}" title="标星句 ${n}" aria-pressed="${!!state.stars[id]}">${ICON('star')}</button></div>`;
  }).join('')}</div>`;
}
function renderPractice() {
  if (!section()) return;
  $('#blind-mode').classList.toggle('active', mode === 'blind'); $('#full-mode').classList.toggle('active', mode === 'full'); $('#practice-heading').hidden = mode === 'blind'; $('#weak-sort').hidden = !weakOnly; $('#practice-heading h2').textContent = weakOnly ? '薄弱段落重练' : '按段精听';
  $('#pause-tools').hidden = mode !== 'blind' || !audio.paused || !pauseIds.length;
  if (mode === 'blind') {
    if (!audio.paused) { $('#sentences').innerHTML = ''; return; }
    if (!pauseIds.length) { $('#sentences').innerHTML = blindNote ? `<div class="blind-note">${esc(blindNote)}</div>` : '<div class="blind-note blind-idle" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>'; return; }
    $('#sentences').innerHTML = blindMarkup();
    const stats = state.blind[sectionId] || {}; $('#pause-metrics').textContent = `已听 ${clock(stats.seconds)} · 暂停 ${stats.pauses || 0} 次`; return;
  }
  const rows = weakOnly ? weakSentences() : section().sentences; $('#sentences').innerHTML = rows.length ? renderParagraphs(rows) : emptyCard('target', '本节暂时没有薄弱段落', '填错、盲听卡住或手动标星的句子会连同所在段落出现在这里。');
}
function isCore(word) {
  const w = word.toLowerCase().replace(/[‘’]/g, "'"); if (coreWords.has(w)) return true;
  return [w.replace(/'s$/, ''), w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y'), w.replace(/ing$/, ''), w.replace(/ing$/, 'e'), w.replace(/ed$/, ''), w.replace(/ed$/, 'e'), w.replace(/ied$/, 'y'), w.replace(/([a-z])\1(?:ing|ed)$/, '$1')].some(v => coreWords.has(v));
}
function addWord(word, q, sec, automatic = false) {
  const w = word.toLowerCase().replace(/[‘’]/g, "'"); if (!w || w.length < 2 || automatic && (isCore(w) || LTBlanks.STOP.has(w))) return;
  const key = w + '|' + q.sentenceId; if (!state.vocabulary[key]) state.vocabulary[key] = { word: w, context: q.text, source: source(sec, q), sentenceId: q.sentenceId, sectionId: sec.id, at: Date.now() };
  if (!automatic) { save(); updateChrome(); toast(`已加入生词本：${w}`); }
}
function collectVocabulary(q, sec) { for (const w of q.text.match(/[A-Za-zÀ-ÿ]+(?:[’'][A-Za-z]+)*(?:-[A-Za-z]+)*/g) || []) addWord(w, q, sec, true); }
function recordError(blank, q, sec, value, status) {
  const old = state.errors[blank.id], now = Date.now(); state.errors[blank.id] = { ...old, blankId: blank.id, sentenceId: q.sentenceId, sectionId: sec.id, answer: blank.answer, myAnswer: value, type: blank.type, context: q.text, source: source(sec, q), times: (old?.times || 0) + 1, lastWrong: now, review: C.scheduleReview(null, false, now) };
  state.logs.push({ at: now, sectionId: sec.id, type: blank.type, status, blankId: blank.id }); collectVocabulary(q, sec);
}
function judgeInput(input, forcedStatus) {
  const hit = lookupBlank(input.dataset.blank); if (!hit) return; const { blank, sentence: q, sec } = hit, old = state.attempts[blank.id]; if (old?.status === 'revealed') return;
  const value = input.value.trim(); if (!value && !forcedStatus) return;
  const status = forcedStatus || (C.gradeAnswer(value, blank.answer) ? 'correct' : 'wrong'); if (old?.value === value && old?.status === status) return;
  state.attempts[blank.id] = { value, status, at: Date.now() }; if (status === 'wrong' || status === 'skipped') recordError(blank, q, sec, value, status); else state.logs.push({ at: Date.now(), sectionId: sec.id, type: blank.type, status, blankId: blank.id });
  if (activeBlanks(q).length && activeBlanks(q).every(b => state.attempts[b.id]?.status === 'correct')) delete state.trouble[q.sentenceId];
  input.className = 'blank ' + status; const feedback = document.querySelector(`[data-feedback="${q.sentenceId}"]`); if (feedback) feedback.innerHTML = feedbackMarkup(q); save(); updateChrome();
}
function showBlind(index) {
  const list = section().sentences; pauseIndex = index; currentId = list[index].sentenceId; blindNote = '';
  pauseIds = list.slice(Math.max(0, index - 1), index + 2).map(q => q.sentenceId); $('#playing-state').textContent = `已暂停 · 句 ${index + 1}`; renderPractice();
}
// Reveal on pause and on a paused seek. Only a pause the listener made counts as a sticking point.
function blindReveal(count) {
  const list = section().sentences;
  if (!hasTimeline()) { pauseIds = []; pauseIndex = -1; blindNote = '本节还没有完整的时间轴，请先在“校对时间轴与挖空”里对齐。'; renderPractice(); return; }
  const found = C.blindContext(list, timingsOf(), audio.currentTime);
  if (found.index < 0) { pauseIds = []; pauseIndex = -1; blindNote = '正文还没有开始（前导部分）。'; $('#playing-state').textContent = '前导部分'; renderPractice(); return; }
  if (count) {
    const info = state.blind[sectionId] || (state.blind[sectionId] = { seconds: 0, pauses: 0, events: [] }), q = list[found.index];
    info.pauses++; info.events.push({ time: audio.currentTime, ids: found.ids, at: Date.now() }); if (info.events.length > 300) info.events.splice(0, info.events.length - 300);
    state.trouble[q.sentenceId] = { at: Date.now(), time: audio.currentTime }; collectVocabulary(q, section()); save(); updateChrome();
  }
  showBlind(found.index);
}
async function play() { if (audioFailed) { toast('音频未能读取，请在题库管理里重新导入这一节的音频。'); return; } stopAt = null; try { await audio.play(); } catch (e) { if (e.name !== 'AbortError') toast('浏览器尚未开始播放，请再点一次播放按钮。'); } }
function togglePlay() { if (audio.paused) play(); else { pauseReason = null; audio.pause(); } }
async function playRange(start, end, id) { audio.currentTime = start; stopAt = end; try { await audio.play(); if (id) { state.replays[id] = (state.replays[id] || 0) + 1; save(); } } catch { toast('音频播放失败，请检查音频文件。'); } }
async function playSentence(id) { const t = timing(id); if (!t) { toast('这一句还没有时间轴。'); return; } currentId = id; await playRange(t.start, t.end, id); }
async function playParagraph(id) { const p = paragraphs().find(p => p.id === id); if (!p) return; const first = timing(p.sentences[0].sentenceId), last = timing(p.sentences.at(-1).sentenceId); if (!first || !last) { toast('本段还没有完整的时间轴。'); return; } currentId = p.sentences[0].sentenceId; await playRange(first.start, last.end, p.sentences[0].sentenceId); }
function updateAB() { $('#set-a').textContent = a === null ? 'A 起点' : `A ${clock(a)}`; $('#set-b').textContent = b === null ? 'B 终点' : `B ${clock(b)}`; $('#clear-ab').hidden = a === null; $('#loop').setAttribute('aria-pressed', String(loop)); $('#set-a').classList.toggle('on', a !== null); $('#set-b').classList.toggle('on', b !== null); }
function revealOne(id) { const hit = lookupBlank(id); if (!hit) return; state.attempts[id] = { value: hit.blank.answer, status: 'revealed', at: Date.now() }; save(); renderPractice(); updateChrome(); }
function setMode(next) { if (view !== 'listen') { view = 'listen'; renderView(); } mode = next; weakOnly = false; $('#weak').setAttribute('aria-pressed', 'false'); noteResume(); pauseIds = []; pauseIndex = -1; blindNote = ''; $('#pause-tools').hidden = true; renderPractice(); }
function movePause(dir) { if (mode !== 'blind' || !audio.paused || pauseIndex < 0) return; showBlind(Math.max(0, Math.min(section().sentences.length - 1, pauseIndex + dir))); }
function download(name, content, type = 'application/json') { const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type })); const el = document.createElement('a'); el.href = url; el.download = name; document.body.append(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
function csvCell(value) { let s = String(value ?? ''); if (/^[=+@-]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }
function csv(rows) { return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'); }
function errorRows(today = false) { return [['日期', '出处', '句子编号', '原文句', '我的答案', '正确答案', '考点类型', '错误次数'], ...Object.values(state.errors).filter(e => !today || dateKey(e.lastWrong) === dateKey()).map(e => [dateKey(e.lastWrong), e.source, e.sentenceId, e.context, e.myAnswer, e.answer, e.type, e.times])]; }
function vocabRows(today = false) { return [['日期', '单词或短语', '原文语境句', '出处'], ...Object.values(state.vocabulary).filter(v => !today || dateKey(v.at) === dateKey()).map(v => [dateKey(v.at), v.word, v.context, v.source])]; }
function exportOptions() {
  openDialog('导出学习记录', `<p>学习记录保存在这个浏览器里。CSV 可以用 Excel、Numbers 或飞书表格打开；完整 JSON 用来在别的浏览器或设备上恢复全部练习进度。导出不会向任何服务器发送数据。</p><div class="dialog-actions"><button data-export="errors" class="primary">${ICON('download')}当日错题 CSV</button><button data-export="vocab">${ICON('download')}当日生词 CSV</button><button data-export="all-errors">${ICON('download')}全部错题 CSV</button><button data-export="json">${ICON('download')}完整 JSON 备份</button></div>`);
}
function submit() {
  $$('#sentences input.blank').forEach(input => judgeInput(input));
  const previousDone = state.completed[sectionId];
  state.completed[sectionId] = Date.now(); save(); updateChrome(); renderPractice();
  openScoreCard(previousDone);
}
function nextSectionId() { const order = C.groupSections(sections).flatMap(g => g.sections.map(s => s.id)), i = order.indexOf(sectionId); return order[i + 1] || null; }
function openScoreCard(previousDone) {
  const sec = section(), blanks = allBlanks(), attempts = blanks.map(b => state.attempts[b.id]).filter(Boolean), result = C.score(attempts), rate = result.total ? result.correct / result.total : 0;
  const count = status => attempts.filter(a => a.status === status).length, wrongTypes = {};
  for (const bl of blanks) if (state.attempts[bl.id]?.status === 'wrong') wrongTypes[bl.type] = (wrongTypes[bl.type] || 0) + 1;
  const topTypes = Object.entries(wrongTypes).sort((x, y) => y[1] - x[1]).slice(0, 3);
  let delta = null; if (previousDone) { const prior = state.logs.filter(l => l.sectionId === sec.id && l.at <= previousDone && l.at > previousDone - 6 * 3600000), ps = C.score(prior); if (ps.total) delta = Math.round(rate * 100) - Math.round(ps.rate * 100); }
  const elapsed = Math.round((Date.now() - practiceStart) / 1000), r = 54, c = 2 * Math.PI * r, pct = Math.round(rate * 100), level = pct >= 80 ? 'good' : pct >= 50 ? 'fair' : 'low';
  openDialog('', `<div class="score-card ${level}"><div class="score-source">${esc(sectionName(sec))}</div><h2 class="score-title">${pct >= 80 ? '漂亮，本节完成' : pct >= 50 ? '本节完成，继续加油' : '本节完成，值得再练一遍'}</h2>
 <div class="score-main"><svg class="score-ring" viewBox="0 0 140 140" aria-hidden="true"><defs><linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--ring-a)"/><stop offset="1" stop-color="var(--ring-b)"/></linearGradient></defs><circle class="ring-track" cx="70" cy="70" r="${r}"/><circle class="ring-value" cx="70" cy="70" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" data-target="${(c * (1 - rate)).toFixed(1)}"/></svg>
 <div class="score-center"><b>${result.total ? pct : '—'}<small>${result.total ? '%' : ''}</small></b><span>正确率</span></div></div>
 <div class="score-stats"><div><b>${count('correct')}</b><span>答对</span></div><div><b>${count('wrong')}</b><span>答错</span></div><div><b>${blanks.length - count('correct') - count('wrong') - count('revealed')}</b><span>未作答</span></div>${count('revealed') ? `<div><b>${count('revealed')}</b><span>看答案</span></div>` : ''}</div>
 <div class="score-meta">${elapsed > 0 && elapsed < 4 * 3600 ? `<span>${ICON('clock')}用时 ${clock(elapsed)}</span>` : ''}${delta === null ? '' : `<span class="delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${ICON(delta > 0 ? 'up' : delta < 0 ? 'down' : 'arrow')}${delta ? `比上次${delta > 0 ? '提高' : '下降'} ${Math.abs(delta)}%` : '和上次持平'}</span>`}</div>
 ${topTypes.length ? `<div class="score-types"><span class="score-types-label">最常错</span>${topTypes.map(([t, n]) => `<span class="tag">${esc(t)} · ${n}</span>`).join('')}</div>` : ''}
 <div class="score-actions">${count('wrong') ? `<button class="primary" data-action="redo-wrong">${ICON('rotate')}只重练错题</button><button data-action="show-mistakes">${ICON('alert')}看错题</button>` : ''}${nextSectionId() ? `<button ${count('wrong') ? '' : 'class="primary"'} data-action="next-section">下一节${ICON('arrow')}</button>` : ''}</div>
 <p class="score-foot">正确率只算已作答的空 · <button class="link-button" data-action="export-options">导出错题与生词</button></p></div>`);
  $('#dialog').classList.add('score-dialog');
  requestAnimationFrame(() => requestAnimationFrame(() => { const ring = $('.ring-value'); if (ring) ring.style.strokeDashoffset = ring.dataset.target; }));
}
function redoWrong() { const ids = allBlanks().filter(bl => ['wrong', 'skipped'].includes(state.attempts[bl.id]?.status)).map(bl => bl.id); for (const id of ids) delete state.attempts[id]; save(); $('#dialog').close(); setMode('full'); updateChrome(); requestAnimationFrame(() => { const first = ids.map(id => document.querySelector(`[data-blank="${id}"]`)).find(Boolean); first?.scrollIntoView({ block: 'center', behavior: 'smooth' }); first?.focus({ preventScroll: true }); }); }
function openDialog(title, html) { $('#dialog').classList.remove('score-dialog', 'wide-dialog'); $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = html; if (!$('#dialog').open) $('#dialog').showModal(); }
function sourceButton(e) { return `<button data-goto="${esc(e.sentenceId)}">${esc(e.source)}</button>`; }
function viewHead(title, desc, action = '') { return `<div class="view-title"><h1>${title}</h1>${action}</div>${desc ? `<p class="description">${desc}</p>` : ''}`; }

// ---------- Home ----------
function dayCounts() { const counts = {}; for (const l of state.logs) { const k = dateKey(l.at); counts[k] = (counts[k] || 0) + 1; } return counts; }
function streakDays(counts) { let n = 0; const t = new Date(); t.setHours(12, 0, 0, 0); if (!counts[dateKey(t)]) t.setDate(t.getDate() - 1); while (counts[dateKey(t)]) { n++; t.setDate(t.getDate() - 1); } return n; }
function weekStart() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
function heatmapMarkup(counts, weeks = 18) {
  const today = new Date(); today.setHours(12, 0, 0, 0); const start = new Date(today); start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7);
  const level = n => !n ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4; let cols = '', months = '', lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    let cells = ''; const first = new Date(start); first.setDate(start.getDate() + w * 7);
    if (first.getMonth() !== lastMonth) { months += `<span style="grid-column:${w + 1}">${first.getMonth() + 1}月</span>`; lastMonth = first.getMonth(); }
    for (let d = 0; d < 7; d++) { const day = new Date(start); day.setDate(start.getDate() + w * 7 + d); const k = dateKey(day), n = counts[k] || 0, future = day > today; cells += `<i class="hm-cell l${future ? 'x' : level(n)}" ${future ? '' : `title="${day.getMonth() + 1}月${day.getDate()}日 · ${n ? `作答 ${n} 空` : '没有练习'}"`}></i>`; }
    cols += `<div class="hm-col">${cells}</div>`;
  }
  return `<div class="heatmap" style="--weeks:${weeks}"><div class="hm-months">${months}</div><div class="hm-days"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div><div class="hm-grid">${cols}</div><div class="hm-legend">少<i class="hm-cell l0"></i><i class="hm-cell l1"></i><i class="hm-cell l2"></i><i class="hm-cell l3"></i><i class="hm-cell l4"></i>多</div></div>`;
}
function renderHome() {
  const now = new Date(), hour = now.getHours(), greet = hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  if (!sections.length) {
    $('#other-view').innerHTML = `<div class="home"><header class="home-head"><h1>${greet}</h1><p>把你自己的英语听力材料放进来，逐句精听。</p></header><div class="home-grid welcome-grid"><article class="home-card resume-card"><div class="card-kicker">${ICON('plus')}开始</div><h2>导入一段听力材料</h2><p class="card-sub">准备好一段音频（mp3 / m4a / wav）和它的英文原文。网站会在你的浏览器里自动把原文逐句对到音频上，再生成听写挖空。音频和原文只保存在本机，不会上传。</p><div class="dialog-actions"><button class="primary big" data-action="import-new">${ICON('plus')}导入新材料</button><button class="tool-button" data-action="load-sample">先看看示例</button><button class="tool-button" data-action="import-pack">${ICON('upload')}导入内容包</button></div></article><article class="home-card"><div class="card-kicker">${ICON('list')}怎么用</div><ol class="steps"><li><b>导入</b>：选音频，粘贴原文（带 MAN: / WOMAN: 这样的说话人也可以）。</li><li><b>对齐</b>：第一次会下载约 46 MB 的识别模型，之后离线可用；一节 5 分钟的录音大约需要半分钟到一分钟。</li><li><b>校对</b>：低置信的句子会标出来，可以试听、微调起止时间、点选挖空词。</li><li><b>练习</b>：盲听时暂停才显示当前句；挖空听写自动判分，错题进入复习。</li></ol></article></div></div>`;
    return;
  }
  const r = state.resume || {}, sec = r.sectionId && sections.find(s => s.id === r.sectionId);
  let resume;
  if (sec) {
    const bs = allBlanks(sec), done = bs.filter(bl => state.attempts[bl.id]).length, pct = bs.length ? Math.round(done / bs.length * 100) : 0, when = r.updatedAt ? new Date(r.updatedAt) : null;
    resume = `<article class="home-card resume-card"><div class="card-kicker">${ICON('headphones')}继续练习</div><h2>${esc(sectionName(sec))}</h2><p class="card-sub">${r.mode === 'full' ? '挖空练习' : '盲听'}${hasTimeline(sec) && r.position > 0 ? ` · 停在 ${clock(r.position)}` : ''}${when ? ` · ${dateKey(when) === dateKey() ? '今天' : dateKey(when) === dateKey(Date.now() - DAY) ? '昨天' : `${when.getMonth() + 1}月${when.getDate()}日`} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : ''}</p><div class="resume-progress"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><span>${done} / ${bs.length} 空</span></div><button class="primary big" data-action="resume">${ICON('play')}继续</button></article>`;
  } else {
    const first = C.groupSections(sections)[0].sections[0];
    resume = `<article class="home-card resume-card"><div class="card-kicker">${ICON('headphones')}开始练习</div><h2>${esc(sectionName(first))}</h2><p class="card-sub">从题库里的第一节开始</p><button class="primary big" data-section="${first.id}">${ICON('play')}开始</button></article>`;
  }
  const due = dueErrors().length, counts = dayCounts(), streak = streakDays(counts), ws = weekStart(), week = Object.values(state.completed).filter(t => t >= ws).length, today = Object.values(state.completed).filter(t => dateKey(t) === dateKey()).length;
  const review = due ? `<article class="home-card review-card-home"><div class="card-kicker">${ICON('calendar')}今日复习</div><div class="big-number">${due}<small>题</small></div><p class="card-sub">到期的错题，答对两次就移出队列</p><button class="primary" data-view="review">开始复习${ICON('arrow')}</button></article>`
    : `<article class="home-card review-card-home done"><div class="card-kicker">${ICON('calendar')}今日复习</div><div class="done-mark">${ICON('check')}</div><p class="card-sub">今天没有到期的复习</p><p class="muted-line">${nextReviewText()}</p></article>`;
  $('#other-view').innerHTML = `<div class="home"><header class="home-head"><h1>${greet}</h1><p>${now.getMonth() + 1}月${now.getDate()}日 · 星期${WEEKDAYS[now.getDay()]}</p></header><div class="home-grid">${resume}${review}
 <article class="home-card heat-card"><div class="card-kicker">${ICON('chart')}练习日历</div><div class="heat-body">${heatmapMarkup(counts, 26)}<div class="heat-stats"><div><span>${ICON('flame')}连续练习</span><b>${streak}<small>天</small></b></div><div><span>本周</span><b>${week}<small>节</small></b></div><div><span>今日已练</span><b>${today}<small>节</small></b></div></div></div></article></div></div>`;
  const hm = $('.heatmap'); if (hm) hm.scrollLeft = hm.scrollWidth;
}

// ---------- Lists ----------
function renderVocab() { const rows = Object.entries(state.vocabulary).sort((x, y) => y[1].at - x[1].at); $('#other-view').innerHTML = viewHead('生词本', '保留单词、原文语境和出处。练习时点一下原文里的单词就能加入；错题句和盲听卡住的句子里，常用词表以外的词会自动收集。', `<button class="tool-button" data-action="vocab-csv">${ICON('download')}导出 CSV</button>`) + (rows.length ? selectBar('vocab') + `<div class="table-wrap select-wrap"><table class="selectable vocab-table"><thead><tr><th class="select-cell"></th><th>单词或短语</th><th>原文语境句</th><th>出处</th></tr></thead><tbody>${rows.map(([key, v]) => `<tr data-select-row="vocab">${selectCell('vocab', key, v.word)}<td><strong>${esc(v.word)}</strong></td><td>${esc(v.context)}</td><td>${sourceButton(v)}</td></tr>`).join('')}</tbody></table></div>` : emptyCard('bookmark', '还没有生词', '点一下练习原文里的单词即可加入。')) + `<p class="fine-print">自动收集时排除常用词：${esc(wordSource?.name || 'NGSL / NAWL / TSL')}，共 ${coreWords.size.toLocaleString()} 项（CC BY-SA 4.0）。它不是官方考试词表。<button class="link-button" data-action="word-license">词表来源与许可</button></p>`; syncSelection('vocab'); }
function renderMistakes() { const rows = Object.values(state.errors).sort((x, y) => y.lastWrong - x.lastWrong); $('#other-view').innerHTML = viewHead('错题本', '记录填错的空（空着提交的不算）。正确答案默认收起。', `<button class="tool-button" data-action="errors-csv">${ICON('download')}导出 CSV</button>`) + (rows.length ? selectBar('mistakes') + `<div class="table-wrap select-wrap"><table class="selectable mistakes-table"><thead><tr><th class="select-cell"></th><th>出处与语境</th><th>我的答案</th><th>正确答案</th><th>考点 / 错误次数</th><th>下次复习</th></tr></thead><tbody>${rows.map(e => `<tr data-select-row="mistakes">${selectCell('mistakes', e.blankId, e.answer)}<td>${sourceButton(e)}<br>${esc(e.context)}</td><td class="answer-cell" data-label="我的答案">${esc(e.myAnswer || '跳过')}</td><td class="answer-cell"><button class="link-button" data-answer-detail="${e.blankId}">${ICON('eye')}显示答案</button></td><td><span class="tag">${esc(e.type)}</span><div class="muted-line">${e.times} 次</div></td><td class="nowrap" data-label="下次复习">${e.review?.retired ? '已移出复习队列' : dateKey(e.review?.due)}</td></tr>`).join('')}</tbody></table></div>` : emptyCard('check', '还没有错题', '从一段盲听开始。')); syncSelection('mistakes'); }
function nextReviewText() { const upcoming = Object.values(state.errors).filter(e => !e.review?.retired && e.review?.due > Date.now()); if (!upcoming.length) return '新错题会在第二天进入复习队列。'; const first = Math.min(...upcoming.map(e => e.review.due)), day = dateKey(first), n = upcoming.filter(e => dateKey(e.review.due) === day).length, diff = Math.round((new Date(day) - new Date(dateKey())) / 86400000); return `下一批 ${n} 题${diff <= 1 ? '明天' : diff === 2 ? '后天' : ` ${+day.slice(5, 7)} 月 ${+day.slice(8)} 日`}到期。`; }
function renderReview() { const rows = dueErrors().sort((x, y) => x.review.due - y.review.due); $('#other-view').innerHTML = viewHead('今日复习', '错题到期后才出现；连续两次复习答对后移出队列。') + (rows.length ? rows.map(e => `<article class="review-card" data-review="${e.blankId}"><div class="source">${esc(e.source)} · ${esc(e.type)} · 已错 ${e.times} 次</div><div class="context">${reviewContext(e)}</div><div class="review-controls"><button class="chip" data-play="${e.sentenceId}">${ICON('play')}重听原句</button><input data-review-input="${e.blankId}" placeholder="输入听到的词" aria-label="复习答案" autocomplete="off" autocapitalize="off" spellcheck="false"><button data-review-submit="${e.blankId}" class="primary">判定</button><button class="chip" data-review-skip="${e.blankId}">跳过</button><button class="delete-button chip" data-review-delete="${e.blankId}" aria-label="删除此复习项">删除</button></div></article>`).join('') : emptyCard('calendar', '今天没有到期复习', nextReviewText())); }
function reviewContext(e) { const hit = lookupBlank(e.blankId); return hit ? esc(hit.sentence.text.slice(0, hit.blank.start)) + ' <strong>________</strong> ' + esc(hit.sentence.text.slice(hit.blank.end)) : esc(e.context); }
function answerReview(id, skip = false) { const e = state.errors[id]; if (!e || e.lastReviewToken === reviewToken) return; const input = $(`[data-review-input="${id}"]`), value = input?.value.trim() || ''; if (!value && !skip) { toast('请输入答案，或选择跳过。'); return; } const correct = !skip && C.gradeAnswer(value, e.answer); e.review = C.scheduleReview(e.review, correct); e.lastReviewToken = reviewToken; if (!correct) { e.times++; e.myAnswer = value; e.lastWrong = Date.now(); } state.logs.push({ at: Date.now(), sectionId: e.sectionId, type: e.type, status: correct ? 'correct' : skip ? 'skipped' : 'wrong', blankId: id }); save(); updateChrome(); renderReview(); if (correct) toast(e.review.retired ? '连续两次答对，已移出复习队列。' : '答对了，下一次复习已安排。'); else toast(`<div class="toast-title">本次${skip ? '跳过' : '未答对'}</div>${diffMarkup(skip ? '' : value, e.answer)}`, true); }
const selection = { mistakes: new Set(), vocab: new Set() }, SELECT_KINDS = { mistakes: { store: 'errors', noun: '错题', unit: '条', render: () => renderMistakes(), note: '它们会同时移出今日复习和薄弱段落；练习记录和学习统计保留。' }, vocab: { store: 'vocabulary', noun: '生词', unit: '个', render: () => renderVocab(), note: '只从生词本移除，原文和练习记录不受影响。' } }; let lastDeletion = null;
function selectBar(kind) { return `<div class="select-bar" data-select-bar="${kind}"><label class="select-all"><input type="checkbox" data-select-all="${kind}"><span>全选</span></label><span class="select-count" data-select-count="${kind}" aria-live="polite"></span><button class="tool-button delete-button" data-bulk-delete="${kind}" disabled>${ICON('trash')}删除所选</button></div>`; }
function selectCell(kind, key, label) { return `<td class="select-cell"><input type="checkbox" data-select-item="${kind}" value="${esc(key)}" ${selection[kind].has(key) ? 'checked' : ''} aria-label="选择 ${esc(label)}"></td>`; }
function syncSelection(kind) { const set = selection[kind], store = state[SELECT_KINDS[kind].store]; for (const k of [...set]) if (!Object.hasOwn(store, k)) set.delete(k); const boxes = $$(`[data-select-item="${kind}"]`), all = $(`[data-select-all="${kind}"]`); if (!all) return; for (const box of boxes) { box.checked = set.has(box.value); box.closest('tr')?.classList.toggle('selected', box.checked); } const n = set.size, total = boxes.length; all.checked = total > 0 && n === total; all.indeterminate = n > 0 && n < total; $(`[data-select-count="${kind}"]`).textContent = n ? `已选 ${n} / ${total}` : `共 ${total} ${SELECT_KINDS[kind].unit}`; $(`[data-bulk-delete="${kind}"]`).disabled = !n; $(`[data-select-bar="${kind}"]`).classList.toggle('active', n > 0); }
function askBulkDelete(kind) { const n = selection[kind].size, k = SELECT_KINDS[kind]; if (!n) return; openDialog(`删除${k.noun}`, `<p>将删除所选 <b>${n}</b> ${k.unit}${k.noun}。${k.note}</p><p class="muted-line">删除后可在提示里撤销；离开本页后无法撤销。</p><div class="dialog-actions"><button class="primary danger-fill" data-confirm-delete="${kind}">${ICON('trash')}删除 ${n} ${k.unit}</button><button data-action="close-dialog">取消</button></div>`); }
function bulkDelete(kind) { const k = SELECT_KINDS[kind], removed = C.removeEntries(state[k.store], [...selection[kind]]), n = Object.keys(removed).length; selection[kind].clear(); $('#dialog').close(); if (!n) return; lastDeletion = { kind, removed }; save(); updateChrome(); k.render(); toast(`已删除 ${n} ${k.unit}${k.noun}<button class="toast-action" data-undo-delete>撤销</button>`, true); }
function undoDeletion() { if (!lastDeletion) return; const { kind, removed } = lastDeletion, k = SELECT_KINDS[kind]; lastDeletion = null; const n = C.restoreEntries(state[k.store], removed); save(); updateChrome(); if (view === kind) k.render(); $('#toast').hidden = true; toast(`已恢复 ${n} ${k.unit}${k.noun}。`); }
function deleteReview(id) { if (!state.errors[id]) return; if (!confirm('确定删除此复习项吗？它会从复习队列移除，错题和作答统计仍会保留。')) return; C.dismissReview(state.errors, id); save(); updateChrome(); renderReview(); toast('已从今日复习移除。'); }
function renderIndex(page = 1) {
  const oldType = $('#index-type')?.value || '', oldSection = $('#index-section')?.value || '', query = $('#index-query')?.value || '';
  const all = []; for (const sec of sections) for (const q of sec.sentences) for (const bl of activeBlanks(q)) all.push({ ...bl, q, sec });
  const types = [...new Set(all.map(x => x.type))].sort();
  const rows = all.filter(x => (!oldType || x.type === oldType) && (!oldSection || x.sec.id === oldSection) && (!query || (x.answer + ' ' + x.analysis + ' ' + x.q.text).toLowerCase().includes(query.toLowerCase())));
  const pageCount = Math.max(1, Math.ceil(rows.length / 100)); page = Math.max(1, Math.min(pageCount, Number(page) || 1));
  const shown = rows.slice((page - 1) * 100, page * 100);
  const pagination = `<div class="filters index-pagination"><span>共 ${rows.length.toLocaleString()} 项 · 第 ${page} / ${pageCount} 页</span><button data-index-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>上一页</button><button data-index-page="${page + 1}" ${page === pageCount ? 'disabled' : ''}>下一页</button></div>`;
  $('#other-view').innerHTML = viewHead('考点索引', '汇总题库里所有挖空词、解析和出处。', `<button class="tool-button" data-action="index-csv">${ICON('download')}导出当前结果</button>`) + `<div class="filters"><label class="filter-search">${ICON('search')}<input id="index-query" placeholder="搜索词或解析" value="${esc(query)}" aria-label="搜索考点"></label><select id="index-type" aria-label="考点类型"><option value="">全部考点类型</option>${types.map(t => `<option ${t === oldType ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><select id="index-section" aria-label="出处"><option value="">全部材料</option>${sections.map(s => `<option value="${s.id}" ${s.id === oldSection ? 'selected' : ''}>${esc(sectionName(s))}</option>`).join('')}</select><button id="index-filter" class="primary">筛选</button></div>` + (rows.length ? pagination + `<div class="table-wrap"><table><thead><tr><th>原文词</th><th>考点</th><th>解析</th><th>出处</th></tr></thead><tbody>${shown.map(x => `<tr><td><strong class="en">${esc(x.answer)}</strong></td><td><span class="tag">${esc(x.type)}</span></td><td>${esc(x.analysis)}</td><td><button data-goto="${x.q.sentenceId}">${esc(source(x.sec, x.q))}</button></td></tr>`).join('')}</tbody></table></div>` + pagination : emptyCard('search', '没有符合条件的考点'));
  $('#other-view').indexRows = rows;
}
function renderStats() {
  const errors = state.logs.filter(l => l.status === 'wrong'), nonzero = rows => rows.filter(x => x[1] > 0).sort((x, y) => y[1] - x[1]);
  const types = [...new Set(errors.map(e => e.type))], byType = nonzero(types.map(type => [type, errors.filter(e => e.type === type).length])), bySection = nonzero(sections.map(s => [s.title, errors.filter(e => e.sectionId === s.id).length])).slice(0, 15);
  const max = Math.max(1, ...byType.map(x => x[1]), ...bySection.map(x => x[1])); const bars = rows => rows.length ? rows.map(([name, n]) => `<div class="bar-row"><span title="${esc(name)}">${esc(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${n / max * 100}%"></div></div><b>${n}</b></div>`).join('') : '<p class="chart-empty">还没有错题记录。</p>';
  const groups = {}; for (const event of state.logs) { const day = dateKey(event.at); (groups[day] || (groups[day] = [])).push(event); } const days = Object.keys(groups).sort().slice(-14), rates = days.map(d => C.score(groups[d]).rate), xs = days.map((d, i) => 45 + (days.length > 1 ? i / (days.length - 1) : .5) * 360), ys = rates.map(r => 205 - r * 165);
  const plot = days.length ? `<svg viewBox="0 0 450 250" role="img" aria-label="每日作答正确率趋势">${[0, .5, 1].map(r => `<line x1="40" x2="425" y1="${205 - r * 165}" y2="${205 - r * 165}" stroke="var(--line)"/><text x="0" y="${209 - r * 165}" fill="var(--muted)" font-size="11">${r * 100}%</text>`).join('')}${xs.length > 1 ? `<polygon class="area" points="${xs[0]},205 ${xs.map((x, i) => x + ',' + ys[i]).join(' ')} ${xs.at(-1)},205"/>` : ''}<polyline fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round" points="${xs.map((x, i) => x + ',' + ys[i]).join(' ')}"/><text class="last-label" x="${Math.min(430, xs.at(-1) + 8)}" y="${ys.at(-1) - 10}" text-anchor="end" font-size="12">${Math.round(rates.at(-1) * 100)}%</text>${xs.map((x, i) => `<circle cx="${x}" cy="${ys[i]}" r="${i === days.length - 1 ? 4.5 : 3}" fill="${i === days.length - 1 ? 'var(--ink)' : 'var(--panel)'}" stroke="var(--ink)" stroke-width="1.6"><title>${days[i]}：${Math.round(rates[i] * 100)}%</title></circle>${(i === 0 || i === days.length - 1) ? `<text x="${x}" y="232" text-anchor="middle" fill="var(--muted)" font-size="11">${days[i].slice(5)}</text>` : ''}`).join('')}</svg>` : emptyCard('chart', '有作答记录后显示趋势');
  const counts = dayCounts(), ws = weekStart(), total = C.score(state.logs);
  $('#other-view').innerHTML = viewHead('学习统计', '正确率按每天的作答记录计算，包含重练；只算作答过的空。') + `<div class="stat-tiles"><div class="stat-tile"><span>今日已练</span><b>${Object.values(state.completed).filter(t => dateKey(t) === dateKey()).length}<small>节</small></b></div><div class="stat-tile"><span>本周</span><b>${Object.values(state.completed).filter(t => t >= ws).length}<small>节</small></b></div><div class="stat-tile"><span>连续练习</span><b>${streakDays(counts)}<small>天</small></b></div><div class="stat-tile"><span>累计正确率</span><b>${total.total ? Math.round(total.rate * 100) : '—'}<small>${total.total ? '%' : ''}</small></b></div></div><div class="stats-grid"><section class="chart-card"><h2>弱项分布</h2><div class="segments"><button class="selected" data-chart-group="type">按考点</button><button data-chart-group="section">按材料</button></div><div id="type-chart">${bars(byType)}</div><div id="section-chart" hidden>${bars(bySection)}</div></section><section class="chart-card"><h2>正确率趋势</h2>${plot}</section></div>`;
}

// ---------- Backup ----------
function validateBackup(data) {
  if (!data || typeof data !== 'object' || data.schemaVersion !== 1 || data.app !== 'listening-trainer') throw Error('不是本网站导出的学习记录备份。');
  const next = emptyState();
  for (const key of Object.keys(next)) {
    if (key === 'schemaVersion' || data[key] === undefined) continue;
    const value = data[key];
    if (key === 'logs') { if (!Array.isArray(value)) throw Error('作答记录格式无效'); next.logs = value.filter(v => v && Number.isFinite(v.at)); continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`备份字段 ${key} 格式无效`);
    if (Object.keys(value).some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) throw Error('备份含有无效键');
    next[key] = value;
  }
  return next;
}
function importFile(accept, onFile) { const input = $('#file-input'); input.value = ''; input.accept = accept; input.onchange = () => { const file = input.files[0]; if (file) onFile(file); }; input.click(); }
function restoreBackup() {
  importFile('application/json,.json', async file => {
    try {
      if (file.size > 100 * 1024 * 1024) throw Error('文件超过 100 MB，不是学习记录备份。');
      const next = validateBackup(JSON.parse(await file.text()));
      if (!confirm('恢复备份会替换当前浏览器里的学习记录（题库不受影响）。继续吗？')) return;
      state = next; applyBlankRevisions(false); save(true); updateChrome(); renderView(); toast('学习记录已恢复。');
    } catch (e) { openDialog('无法恢复', `<div class="alert danger">${esc(e.message)}</div><p>当前学习记录保持不变。</p>`); }
  });
}
function jumpToSentence(id) { const hit = findSentence(id); if (!hit) { toast('这条原句已不在题库里。'); return; } if (hit.sec.id !== sectionId || view !== 'listen') setSection(hit.sec.id); mode = 'full'; weakOnly = false; currentId = hit.sentence.sentenceId; renderView(); requestAnimationFrame(() => document.querySelector(`[data-sentence="${currentId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })); }
function showLicense() { openDialog('常用词表与许可', `<p>${esc(wordSource?.name || 'NGSL / NAWL / TSL')}，共 ${coreWords.size} 项，只用来在自动收集生词、自动选词时排除常用词，不代表官方考试词汇大纲。</p><p>来源：Browne, C., Culligan, B., Phillips, J. — New General Service List Project。按 <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a> 授权；本项目做了小写、去重与合并，未添加释义。</p><p><a href="https://www.newgeneralservicelist.com/" target="_blank" rel="noopener">NGSL 项目官网</a></p>`); }

// ---------- Events ----------
document.addEventListener('click', event => {
  const row = event.target.closest('[data-select-row]'); if (row && !event.target.closest('button,a,input,label')) { const box = row.querySelector('[data-select-item]'); if (box && !getSelection()?.toString()) { box.checked = !box.checked; box.dispatchEvent(new Event('change', { bubbles: true })); } return; }
  const target = event.target.closest('button,[data-word]'); if (!target || target.closest('[data-lib]')) return;
  if (target.dataset.section) { setSection(target.dataset.section); noteResume(0); save(); return; }
  if (target.dataset.view) { go(target.dataset.view); return; }
  if (target.dataset.play) { const hit = findSentence(target.dataset.play); if (hit && hit.sec.id !== sectionId) { const previous = view; setSection(hit.sec.id); view = previous; renderView(); } const id = target.dataset.play; if (audioFor === hit?.sec.id && audio.readyState >= 1) playSentence(id); else audio.addEventListener('loadedmetadata', () => playSentence(id), { once: true }); return; }
  if (target.dataset.playParagraph) { playParagraph(target.dataset.playParagraph); return; }
  if (target.dataset.star) { const id = target.dataset.star; state.stars[id] ? delete state.stars[id] : state.stars[id] = Date.now(); save(); renderPractice(); return; }
  if (target.dataset.analysis) { const body = $(`[data-analysis-body="${target.dataset.analysis}"]`); body.hidden = !body.hidden; return; }
  if (target.dataset.revealOne) { revealOne(target.dataset.revealOne); return; }
  if (target.dataset.word) { const el = target.closest('[data-sentence]'), hit = el && findSentence(el.dataset.sentence); if (hit) addWord(target.dataset.word, hit.sentence, hit.sec); return; }
  if (target.dataset.goto) { jumpToSentence(target.dataset.goto); return; }
  if (target.dataset.searchPage) { renderSearchResults(Number(target.dataset.searchPage)); return; }
  if (target.dataset.indexPage) { renderIndex(Number(target.dataset.indexPage)); return; }
  if (target.dataset.answerDetail) { const e = state.errors[target.dataset.answerDetail]; target.outerHTML = diffMarkup(e.myAnswer, e.answer); return; }
  if (target.dataset.bulkDelete) { askBulkDelete(target.dataset.bulkDelete); return; } if (target.dataset.confirmDelete) { bulkDelete(target.dataset.confirmDelete); return; } if (target.dataset.undoDelete !== undefined) { undoDeletion(); return; }
  if (target.dataset.reviewDelete) { deleteReview(target.dataset.reviewDelete); return; }
  if (target.dataset.reviewSubmit) { answerReview(target.dataset.reviewSubmit); return; }
  if (target.dataset.reviewSkip) { answerReview(target.dataset.reviewSkip, true); return; }
  if (target.dataset.chartGroup) { const type = target.dataset.chartGroup === 'type'; $('#type-chart').hidden = !type; $('#section-chart').hidden = type; $$('[data-chart-group]').forEach(x => x.classList.toggle('selected', x === target)); return; }
  if (target.dataset.export) { const day = dateKey(), kind = target.dataset.export; if (kind === 'errors') download(`错题_${day}.csv`, csv(errorRows(true)), 'text/csv;charset=utf-8'); if (kind === 'all-errors') download(`全部错题_${day}.csv`, csv(errorRows()), 'text/csv;charset=utf-8'); if (kind === 'vocab') download(`生词_${day}.csv`, csv(vocabRows(true)), 'text/csv;charset=utf-8'); if (kind === 'json') download(`学习记录备份_${day}.json`, JSON.stringify({ app: 'listening-trainer', ...state }, null, 1)); return; }
  const action = target.dataset.action;
  if (action) {
    if (action === 'word-license') showLicense();
    else if (action === 'close-dialog') $('#dialog').close();
    else if (action === 'resume') resumePractice();
    else if (action === 'redo-wrong') redoWrong();
    else if (action === 'show-mistakes') { $('#dialog').close(); go('mistakes'); }
    else if (action === 'next-section') { const next = nextSectionId(); $('#dialog').close(); if (next) { setSection(next); noteResume(0); save(); window.scrollTo(0, 0); } }
    else if (action === 'export-options') exportOptions();
    else if (action === 'errors-csv') download('全部错题.csv', csv(errorRows()), 'text/csv;charset=utf-8');
    else if (action === 'vocab-csv') download('生词本.csv', csv(vocabRows()), 'text/csv;charset=utf-8');
    else if (action === 'index-csv') download('考点索引.csv', csv([['原文词', '考点', '解析', '出处'], ...($('#other-view').indexRows || []).map(x => [x.answer, x.type, x.analysis, source(x.sec, x.q)])]), 'text/csv;charset=utf-8');
    else LT.onAction?.(action, target);
    return;
  }
  switch (target.id) {
    case 'play': togglePlay(); break;
    case 'back5': audio.currentTime = Math.max(0, audio.currentTime - 5); stopAt = null; if (mode === 'blind' && audio.paused) blindReveal(false); break;
    case 'set-a': a = audio.currentTime; b = null; updateAB(); break;
    case 'set-b': if (a === null || audio.currentTime <= a + .1) { toast('请先设置 A，再在更靠后的位置设置 B。'); break; } b = audio.currentTime; updateAB(); toast('A–B 复读已开启。'); break;
    case 'clear-ab': a = b = null; updateAB(); break;
    case 'loop': loop = !loop; updateAB(); break;
    case 'blind-mode': setMode('blind'); break;
    case 'full-mode': setMode('full'); break;
    case 'weak': mode = 'full'; weakOnly = !weakOnly; target.setAttribute('aria-pressed', String(weakOnly)); renderPractice(); break;
    case 'follow-paragraph': followParagraph = !followParagraph; target.innerHTML = `${ICON('follow')}跟随段落：${followParagraph ? '开' : '关'}`; target.setAttribute('aria-pressed', String(followParagraph)); break;
    case 'locate-paragraph': { const p = currentParagraph(); if (p) document.querySelector(`[data-paragraph="${p.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); else toast('播放到正文后，可以定位当前段落。'); break; }
    case 'edit-section': LT.openEditor?.(sectionId); break;
    case 'reveal': for (const blank of allBlanks()) state.attempts[blank.id] = { value: blank.answer, status: 'revealed', at: Date.now() }; mode = 'full'; save(); renderPractice(); updateChrome(); break;
    case 'reset': if (confirm('重做本节会清除本节的当前作答。历史错题、生词和复习队列保留。继续吗？')) { for (const bl of allBlanks()) delete state.attempts[bl.id]; delete state.completed[sectionId]; save(); setSection(sectionId); } break;
    case 'submit': submit(); break;
    case 'previous-sentence': movePause(-1); break;
    case 'next-sentence': movePause(1); break;
    case 'backup': download(`学习记录备份_${dateKey()}.json`, JSON.stringify({ app: 'listening-trainer', ...state }, null, 1)); break;
    case 'restore': restoreBackup(); break;
    case 'theme': setTheme(!document.documentElement.classList.contains('dark')); break;
    case 'nav-fold': setNavFolded(!document.body.classList.contains('nav-folded'), true); break;
    case 'menu-toggle': document.body.classList.contains('drawer-open') ? closeDrawer() : openDrawer(); break;
    case 'close-dialog': $('#dialog').close(); break;
    case 'index-filter': renderIndex(); break;
  }
});
document.addEventListener('focusout', e => { if (e.target.matches('input.blank')) judgeInput(e.target); });
document.addEventListener('focusin', e => { const q = e.target.closest('#sentences [data-sentence]'); if (q && mode !== 'blind') currentId = q.dataset.sentence; });
document.addEventListener('change', e => { const t = e.target; if (t.dataset.selectItem) { const set = selection[t.dataset.selectItem]; t.checked ? set.add(t.value) : set.delete(t.value); syncSelection(t.dataset.selectItem); } if (t.dataset.selectAll) { const kind = t.dataset.selectAll, set = selection[kind]; set.clear(); if (t.checked) for (const box of $$(`[data-select-item="${kind}"]`)) set.add(box.value); syncSelection(kind); } });
$('#font-size').addEventListener('change', e => { document.documentElement.style.setProperty('--text-size', e.target.value + 'px'); try { localStorage.setItem('lt-font', e.target.value); } catch { } });
$('#play').addEventListener('click', () => { if (state.resume?.sectionId !== sectionId) noteResume(); });
$('#speed').addEventListener('change', e => { audio.playbackRate = Number(e.target.value); if (sectionId) { state.speeds[sectionId] = audio.playbackRate; save(); } });
$('#weak-sort').addEventListener('change', renderPractice);
function seekTo(e) { stopAt = null; audio.currentTime = Number(e.target.value); $('#current-time').textContent = clock(audio.currentTime); if (mode === 'blind' && view === 'listen' && audio.paused) blindReveal(false); }
$('#seek').addEventListener('input', seekTo); $('#seek').addEventListener('change', seekTo);
function paintSeek() { const seek = $('#seek'), max = Number(seek.max) || 1; seek.style.setProperty('--pct', `${Math.min(100, Number(seek.value) / max * 100)}%`); }
$('#seek').addEventListener('input', paintSeek);
$('#seek').addEventListener('pointermove', e => { const seek = e.currentTarget, box = seek.getBoundingClientRect(), max = Number(seek.max); if (!(max > 1)) return; const x = Math.min(Math.max(0, e.clientX - box.left), box.width), tip = $('#seek-tip'); tip.textContent = clock(x / box.width * max); tip.style.left = `${x}px`; tip.hidden = false; });
$('#seek').addEventListener('pointerleave', () => { $('#seek-tip').hidden = true; });
function setNavFolded(folded, remember = false) { document.body.classList.toggle('nav-folded', folded); const btn = $('#nav-fold'); btn.setAttribute('aria-expanded', String(!folded)); btn.querySelector('span').textContent = folded ? '展开菜单' : '收起菜单'; if (remember) { try { localStorage.setItem('lt-nav-folded', folded ? '1' : '0'); } catch { } } }
function setTheme(dark) { document.documentElement.classList.toggle('dark', dark); $$('meta[name="theme-color"]').forEach(m => { m.content = dark ? '#09090a' : '#ffffff'; m.removeAttribute('media'); }); $('#theme').innerHTML = `${ICON(dark ? 'sun' : 'moon')}<span>${dark ? '浅色' : '深色'}</span>`; try { localStorage.setItem('lt-theme', dark ? 'dark' : 'light'); } catch { } }
function resumePractice() { const r = { ...state.resume }; if (!sections.some(s => s.id === r.sectionId)) return; setSection(r.sectionId); if (r.mode === 'full') setMode('full'); if (hasTimeline() && r.position > 0) pendingSeek = r.position; state.resume = { ...r, updatedAt: new Date().toISOString() }; save(); }
$('#drawer-backdrop').addEventListener('click', closeDrawer);
function renderSearchResults(page = 1) {
  const q = $('#search').value.trim().toLowerCase();
  const hits = q ? sections.flatMap(sec => sec.sentences.filter(s => s.text.toLowerCase().includes(q)).map(sentence => ({ sec, sentence }))) : [];
  const size = 40, total = hits.length, pages = Math.max(1, Math.ceil(total / size)); page = Math.max(1, Math.min(pages, Number(page) || 1));
  const shown = hits.slice((page - 1) * size, page * size);
  const controls = total > size ? `<div class="search-pagination"><span>${total} 条 · ${page}/${pages} 页</span><button data-search-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>上一页</button><button data-search-page="${page + 1}" ${page === pages ? 'disabled' : ''}>下一页</button></div>` : '';
  $('#search-results').innerHTML = total ? controls + shown.map(({ sec, sentence: s }) => `<button class="search-result" data-goto="${s.sentenceId}"><small>${esc(source(sec, s))}</small>${esc(s.text)}</button>`).join('') + controls : '<p class="description">没有匹配原句</p>';
  $('#search-results').scrollTop = 0;
}
$('#search').addEventListener('input', e => { const q = e.target.value.trim(); $('#tree').hidden = !!q; $('#search-results').hidden = !q; if (!q) { $('#search-results').innerHTML = ''; return; } renderSearchResults(); });
audio.addEventListener('loadedmetadata', () => {
  $('#seek').max = audio.duration; $('#duration').textContent = clock(audio.duration); $('#playing-state').textContent = '准备就绪';
  if (pendingSeek !== null) { const at = Math.min(pendingSeek, Math.max(0, audio.duration - 1)); pendingSeek = null; audio.currentTime = at; $('#seek').value = at; $('#current-time').textContent = clock(at); $('#playing-state').textContent = `从 ${clock(at)} 继续`; } paintSeek();
});
audio.addEventListener('play', () => { pauseReason = null; lastWall = performance.now(); $('#play').innerHTML = ICON('pause'); $('#play').setAttribute('aria-label', '暂停'); $('#playing-state').textContent = mode === 'blind' ? '盲听中' : '播放中'; if (mode === 'blind' && view === 'listen') { pauseIds = []; pauseIndex = -1; blindNote = ''; renderPractice(); } });
audio.addEventListener('pause', () => { lastWall = null; $('#play').innerHTML = ICON('play'); $('#play').setAttribute('aria-label', '播放'); if (view === 'listen' && !audio.ended) noteResume(audio.currentTime); $('#playing-state').textContent = '已暂停'; const counted = !autoStop && !audio.ended; autoStop = false; if (pauseReason) { pauseReason = null; return; } if (mode === 'blind' && view === 'listen') blindReveal(counted); save(); });
audio.addEventListener('ended', () => { if (loop) { audio.currentTime = 0; audio.play().catch(() => { }); } else { $('#playing-state').textContent = '本节播放完毕'; save(); } });
audio.addEventListener('error', () => { if (!audioFor) return; audioFailed = true; if (view !== 'listen') return; mode = 'full'; pauseIds = []; $('.player-main').hidden = true; $('.player-options').hidden = true; $('#audio-alert').hidden = false; $('#audio-alert').textContent = '未能读取本节音频，已进入挖空练习。可以在“题库管理”里为这一节重新选择音频文件。'; renderPractice(); });
let lastHighlight = null;
function tick(now) {
  if (!audio.paused && section()) {
    if (view === 'listen' || view === 'edit') { $('#current-time').textContent = clock(audio.currentTime); $('#seek').value = audio.currentTime; paintSeek(); }
    if (view === 'listen' && state.resume?.sectionId === sectionId) state.resume.position = audio.currentTime;
    if (view === 'listen') {
      const list = section().sentences, i = C.sentenceIndexAt(timingsOf(), audio.currentTime), current = i >= 0 ? list[i] : null; if (current) currentId = current.sentenceId;
      if (mode === 'full' && current?.sentenceId !== lastHighlight) {
        $$('.sentence.playing').forEach(e => e.classList.remove('playing')); const el = current && document.querySelector(`#sentences [data-sentence="${current.sentenceId}"]`); el?.classList.add('playing'); const paragraph = el?.closest('.reading-paragraph');
        if (paragraph && paragraph.dataset.paragraph !== lastParagraph) { $$('.reading-paragraph.is-playing').forEach(p => p.classList.remove('is-playing')); paragraph.classList.add('is-playing'); lastParagraph = paragraph.dataset.paragraph; const box = paragraph.getBoundingClientRect(), top = $('#player-panel').getBoundingClientRect().bottom + 12; if (followParagraph && !$('#dialog').open && !document.activeElement.matches('input') && (box.bottom < top || box.top > window.innerHeight - 80)) paragraph.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        lastHighlight = current?.sentenceId;
      }
      if (mode === 'blind' && lastWall) { const info = state.blind[sectionId] || (state.blind[sectionId] = { seconds: 0, pauses: 0, events: [] }); info.seconds += Math.min(1, (now - lastWall) / 1000); if (now - lastSaved > 10000) { save(); lastSaved = now; } }
    }
    lastWall = now;
    if (stopAt !== null && audio.currentTime >= stopAt) { autoStop = true; audio.pause(); stopAt = null; }
    else if (a !== null && b !== null && audio.currentTime >= b) audio.currentTime = a;
  }
  LT.onTick?.();
  requestAnimationFrame(tick);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) { closeDrawer(); return; }
  const editing = e.target.matches('input,textarea,select,[contenteditable="true"]');
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { if (view === 'listen' && section()) { e.preventDefault(); submit(); } return; }
  if (editing) { if (e.target.matches('.blank')) { const inputs = $$('#sentences .blank:not([readonly])'), index = inputs.indexOf(e.target), hit = lookupBlank(e.target.dataset.blank); if (e.key === 'Tab') { const next = inputs[index + (e.shiftKey ? -1 : 1)]; if (next) { e.preventDefault(); judgeInput(e.target); next.focus(); } return; } if (e.code === 'Space' && hit && !/\s/.test(hit.blank.answer)) { e.preventDefault(); judgeInput(e.target); inputs[index + 1]?.focus(); return; } if (e.key === 'Enter') { e.preventDefault(); judgeInput(e.target); } } if (e.key === 'Enter' && e.target.dataset.reviewInput) { e.preventDefault(); answerReview(e.target.dataset.reviewInput); } return; }
  if ($('#dialog').open) return;
  if (view === 'edit') { LT.onEditorKey?.(e); return; }
  if (view !== 'listen' || !section()) return;
  if (e.code === 'Space') { e.preventDefault(); if (mode === 'blind') togglePlay(); else { const inputs = $$('#sentences .blank:not([readonly])'); inputs[0]?.focus(); } }
  else if (e.key.toLowerCase() === 'r') { e.preventDefault(); const p = currentParagraph(); if (p) playParagraph(p.id); }
  else if (e.key.toLowerCase() === 's') { e.preventDefault(); if (currentId) { state.stars[currentId] ? delete state.stars[currentId] : state.stars[currentId] = Date.now(); save(); renderPractice(); } }
  else if (e.key.toLowerCase() === 'd') $('#reveal').click();
  else if (e.key === '[') movePause(-1); else if (e.key === ']') movePause(1);
});
window.addEventListener('pagehide', () => save(true)); document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });
// Phones: a floating round play/pause button that can be dragged anywhere and remembers its place; the timeline stays pinned.
(function floatingPlayer() {
  const fab = $('#float-play'), panel = $('#player-panel'), sentinel = $('#player-sentinel'), vv = window.visualViewport, KEY = 'lt-float-play', SIZE = 56, M = 10;
  let pos = null, drag = null; try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) pos = v; } catch { }
  const area = () => ({ w: vv ? vv.width : innerWidth, h: vv ? vv.height : innerHeight });
  const clamp = p => { const { w, h } = area(); return { x: Math.round(Math.min(Math.max(M, p.x), w - SIZE - M)), y: Math.round(Math.min(Math.max(M + 60, p.y), h - SIZE - M)) }; };
  const current = () => clamp(pos || { x: area().w - SIZE - 16, y: area().h - SIZE - 110 });
  function place() { const p = current(), dx = vv ? vv.offsetLeft : 0, dy = vv ? vv.offsetTop : 0; fab.style.transform = `translate(${p.x + dx}px,${p.y + dy}px)`; const keyboard = vv && vv.height < innerHeight * .8; document.documentElement.style.setProperty('--vv-shift', (keyboard ? Math.max(0, Math.round(vv.offsetTop)) : 0) + 'px'); }
  function sync() { const playing = !audio.paused; fab.innerHTML = ICON(playing ? 'pause' : 'play'); fab.setAttribute('aria-label', playing ? '暂停' : '播放'); }
  fab.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  fab.addEventListener('pointerdown', e => { e.preventDefault(); try { fab.setPointerCapture(e.pointerId); } catch { } const p = current(); drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false }; });
  fab.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy; if (!drag.moved && Math.hypot(dx, dy) < 6) return; drag.moved = true; fab.classList.add('dragging'); pos = clamp({ x: drag.ox + dx, y: drag.oy + dy }); place(); });
  fab.addEventListener('pointerup', e => { if (!drag || e.pointerId !== drag.id) return; const moved = drag.moved; drag = null; fab.classList.remove('dragging'); if (moved) { try { localStorage.setItem(KEY, JSON.stringify(pos)); } catch { } } else togglePlay(); });
  fab.addEventListener('pointercancel', () => { drag = null; fab.classList.remove('dragging'); });
  fab.addEventListener('click', e => { if (e.detail === 0) togglePlay(); });
  for (const name of ['play', 'pause', 'emptied', 'loadstart']) audio.addEventListener(name, sync);
  if (vv) { vv.addEventListener('resize', place); vv.addEventListener('scroll', place); } window.addEventListener('resize', place);
  if ('IntersectionObserver' in window) new IntersectionObserver(([entry]) => panel.classList.toggle('stuck', !entry.isIntersecting && entry.boundingClientRect.top < 80), { rootMargin: '-72px 0px 0px 0px' }).observe(sentinel);
  sync(); place();
})();

// ---------- Shared with library.js ----------
const LT = window.LT = {
  $, $$, esc, ICON, clock, toast, openDialog, download, importFile, emptyCard, viewHead, sectionName,
  get state() { return state; }, get sections() { return sections; }, get sectionId() { return sectionId; }, get view() { return view; }, get coreWords() { return coreWords; }, audio,
  save, reloadSections, setSection, renderView, go, updateChrome, storageError,
  registerView(name, render, title) { views[name] = render; if (title) VIEW_NAMES[name] = title; },
  playRange, clearPractice(id) { C.clearSectionPractice(state, id); delete state.blankRevisions[id]; if (state.resume?.sectionId === id) state.resume = {}; save(); },
  releaseAudio() { pauseReason = 'switch'; audio.pause(); audioFor = null; if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; } audio.removeAttribute('src'); audio.load(); },
  loadAudioFor: loadAudio
};

// ---------- Start ----------
(async function start() {
  try { const f = localStorage.getItem('lt-font'); if (f) { $('#font-size').value = f; document.documentElement.style.setProperty('--text-size', f + 'px'); } } catch { }
  setTheme(document.documentElement.classList.contains('dark'));
  { let folded = true; try { folded = localStorage.getItem('lt-nav-folded') !== '0'; } catch { } setNavFolded(folded); }
  try {
    const [stored, list] = await Promise.all([LTDb.getMeta('state'), LTDb.listSections()]);
    if (stored && stored.schemaVersion === 1) state = { ...emptyState(), ...stored };
    sections = prepare(list);
    LTDb.persist();
  } catch (e) { storageError((e?.message || e) + ' 当前只能浏览，无法保存。'); }
  fetch('data/wordlist.json').then(r => r.json()).then(d => { coreWords = new Set(d.words); wordSource = d.source; }).catch(() => { });
  applyBlankRevisions(false);
  sectionId = state.resume?.sectionId && sections.some(s => s.id === state.resume.sectionId) ? state.resume.sectionId : sections[0]?.id || null;
  updateChrome();
  const hash = location.hash.slice(1);
  view = ['library', 'import'].includes(hash) ? hash : 'home';
  renderView();
  requestAnimationFrame(tick);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
})();
