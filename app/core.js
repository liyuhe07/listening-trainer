/* Pure practice logic shared by the app and the tests (no DOM, no storage). */
(function (root) {
  'use strict';
  // British and American spellings are accepted for each other.
  const equivalents = { color: 'colour', colors: 'colours', colored: 'coloured', center: 'centre', centers: 'centres', organize: 'organise', organized: 'organised', organizing: 'organising', organization: 'organisation', organizations: 'organisations', analyze: 'analyse', analyzed: 'analysed', analyzing: 'analysing', behavior: 'behaviour', behaviors: 'behaviours', favor: 'favour', favorite: 'favourite', favorites: 'favourites', labor: 'labour', neighbor: 'neighbour', neighbors: 'neighbours', neighborhood: 'neighbourhood', traveling: 'travelling', traveled: 'travelled', traveler: 'traveller', travelers: 'travellers', canceled: 'cancelled', canceling: 'cancelling', jewelry: 'jewellery', catalog: 'catalogue', catalogs: 'catalogues', program: 'programme', programs: 'programmes', theater: 'theatre', theaters: 'theatres', meter: 'metre', meters: 'metres', liter: 'litre', liters: 'litres', gray: 'grey', defense: 'defence', offense: 'offence', license: 'licence', licenses: 'licences', enrollment: 'enrolment', enroll: 'enrol', fulfill: 'fulfil', fulfillment: 'fulfilment', check: 'cheque', checks: 'cheques', artifact: 'artefact', artifacts: 'artefacts', civilization: 'civilisation', fertilizer: 'fertiliser' };
  const units = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  function numberWords(s) {
    const a = s.split(' ').filter(w => w !== 'and'); if (!a.length) return null;
    let total = 0, group = 0, seen = false, point = false, decimal = '', previous = null, lastScale = Infinity;
    for (const w of a) {
      if (w === 'point') { if (point) return null; point = true; continue; }
      if (point) { if (!(w in units) || units[w] > 9) return null; decimal += units[w]; continue; }
      if (w in units) { if (previous in units && !(units[previous] >= 20 && units[w] > 0 && units[w] < 10)) return null; group += units[w]; seen = true; }
      else if (w === 'hundred') { if (group >= 10 || previous === 'hundred') return null; group = (group || 1) * 100; seen = true; }
      else if (w === 'thousand' || w === 'million') { const scale = w === 'thousand' ? 1000 : 1000000; if (scale >= lastScale) return null; lastScale = scale; total += (group || 1) * scale; group = 0; seen = true; }
      else return null;
      previous = w;
    }
    if (!seen || point && !decimal) return null;
    return String(Number(String(total + group) + (point ? '.' + decimal : '')));
  }
  function normalizeAnswer(value) {
    let s = String(value ?? '').trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[‐‑–−-]/g, ' ').replace(/\s+/g, ' ');
    if (!s) return '';
    s = s.replace(/[£$€¥]/g, '').replace(/(?<=\d),(?=\d)/g, '').replace(/[,;!?"“”.]+$/g, '').replace(/[,;!?"“”]/g, ' ').replace(/\s+/g, ' ').trim();
    const num = s.replace(':', '.'); if (/^\d+(?:\.\d+)?$/.test(num)) return String(Number(num));
    const spelled = numberWords(s); if (spelled !== null) return spelled;
    return s.split(' ').map(w => equivalents[w] || w).join(' ');
  }
  function gradeAnswer(value, answer) {
    const a = normalizeAnswer(value), b = normalizeAnswer(answer); if (!a || !b) return false; if (a === b) return true;
    const time = /^\s*(\d{1,2})[:.](\d{2})\s*$/;
    for (const [t, n] of [[String(value), String(answer)], [String(answer), String(value)]]) {
      const m = t.match(time); if (m && Number(m[1]) < 24 && Number(m[2]) < 60 && /^\d{3,4}$/.test(n.trim()) && Number(n) === Number(m[1] + m[2])) return true;
    }
    return false;
  }
  function validTiming(t, duration = Infinity) {
    return !!t && Number.isFinite(t.start) && Number.isFinite(t.end) && t.start >= 0 && t.end > t.start && t.end <= duration + 0.5;
  }
  /** timings: array parallel to sentences ({start,end}|null). Index of the sentence playing at `time`. */
  function sentenceIndexAt(timings, time) {
    for (let i = 0; i < timings.length; i++) { const t = timings[i]; if (validTiming(t) && time >= t.start && time < t.end) return i; }
    return -1;
  }
  function groupParagraphs(sentences) {
    const groups = [];
    for (const [i, q] of sentences.entries()) {
      const id = q.paragraphId || 'p' + Math.floor(i / 6);
      if (!groups.length || groups.at(-1).id !== id) groups.push({ id, sentences: [] });
      groups.at(-1).sentences.push(q);
    }
    return groups;
  }
  // Blind listening shows the sentence at the playhead (or, in a gap, the one just heard) with one neighbour each side.
  function blindContext(sentences, timings, time) {
    let index = -1; for (let i = 0; i < sentences.length; i++) { const t = timings[i]; if (validTiming(t) && t.start <= time) index = i; }
    return index < 0 ? { index, ids: [] } : { index, ids: sentences.slice(Math.max(0, index - 1), index + 2).map(q => q.sentenceId) };
  }
  function timelineReady(timings) {
    let end = -Infinity; if (!timings.length) return false;
    return timings.every(t => { if (!validTiming(t) || t.start < end - 0.04) return false; end = t.end; return true; });
  }
  // Library tree: collection (free text, e.g. "Book 1 · Test 1") -> sections in their order.
  function groupSections(sections) {
    const groups = new Map();
    for (const s of [...sections].sort((a, b) => (a.collection || '').localeCompare(b.collection || '', 'zh-Hans-CN', { numeric: true }) || (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title, 'en', { numeric: true }))) {
      const key = s.collection || '未分组';
      if (!groups.has(key)) groups.set(key, { name: key, sections: [] });
      groups.get(key).sections.push(s);
    }
    return [...groups.values()];
  }
  // Accuracy counts answered blanks only: empty, skipped or revealed blanks are not scored.
  function score(attempts) { const counted = attempts.filter(a => ['correct', 'wrong'].includes(a?.status)); const correct = counted.filter(a => a.status === 'correct').length; return { correct, total: counted.length, rate: counted.length ? correct / counted.length : 0 }; }
  function sectionProgress(blanks, attempts) {
    const records = blanks.map(b => attempts[b.id]).filter(Boolean), result = score(records);
    if (!records.length) return { status: '', label: '尚未练习' };
    if (!blanks.length || records.length < blanks.length) return { status: 'in-progress', label: '练习中' };
    return result.rate >= .8 ? { status: 'mastered', label: '已掌握' } : result.rate >= .5 ? { status: 'improve', label: '待强化' } : { status: 'redo', label: '需重做' };
  }
  function scheduleReview(previous, correct, now = Date.now()) {
    const intervals = [1, 3, 7, 15], step = previous ? Math.min((previous.step || 0) + 1, 3) : 0, streak = correct ? (previous?.streak || 0) + 1 : 0;
    return { step, streak, due: now + intervals[step] * 86400000, retired: streak >= 2, lastReviewed: now };
  }
  function removeEntries(map, keys) { const removed = {}; for (const k of keys) if (Object.hasOwn(map, k)) { removed[k] = map[k]; delete map[k]; } return removed; }
  function restoreEntries(map, removed) { let n = 0; for (const [k, v] of Object.entries(removed || {})) if (!Object.hasOwn(map, k)) { map[k] = v; n++; } return n; }
  function dismissReview(errors, id, now = Date.now()) { const error = errors[id]; if (!error?.review) return false; error.review = { ...error.review, retired: true, dismissedAt: now }; return true; }
  // Letter-level comparison of a wrong answer with the expected one (display only; grading is unchanged).
  function answerDiff(value, answer) {
    const a = String(value ?? '').trim(), b = String(answer ?? '').trim();
    if (!a) return { mode: 'missing', answer: b };
    const norm = ch => ch.toLowerCase().replace(/[‘’]/g, "'").replace(/[‐‑–−-]/g, ' ');
    const A = [...a], B = [...b], n = A.length, m = B.length;
    if (!m || n * m > 40000) return { mode: 'whole', value: a, answer: b };
    const d = Array.from({ length: n + 1 }, (_, i) => { const row = new Array(m + 1).fill(0); row[0] = i; return row; });
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (norm(A[i - 1]) === norm(B[j - 1]) ? 0 : 1));
    const distance = d[n][m];
    if (distance === 0) return { mode: 'same', answer: b, distance };
    if (distance > Math.max(2, Math.ceil(m * .5))) return { mode: 'whole', value: a, answer: b, distance };
    const ops = []; let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && norm(A[i - 1]) === norm(B[j - 1]) && d[i][j] === d[i - 1][j - 1]) { ops.push({ type: 'same', text: B[j - 1] }); i--; j--; }
      else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) { ops.push({ type: 'wrong', text: A[i - 1], expect: B[j - 1] }); i--; j--; }
      else if (j > 0 && d[i][j] === d[i][j - 1] + 1) { ops.push({ type: 'missing', text: B[j - 1] }); j--; }
      else { ops.push({ type: 'extra', text: A[i - 1] }); i--; }
    }
    ops.reverse(); const merged = [];
    for (const op of ops) { const last = merged.at(-1); if (last && last.type === op.type) { last.text += op.text; if (op.expect !== undefined) last.expect += op.expect; } else merged.push({ ...op }); }
    return { mode: 'letters', ops: merged, distance };
  }
  /**
   * Removes the practice records of one section (used when its blanks change or it is deleted).
   * Sentence ids are "<sectionId>-NNN" and blank ids "<sentenceId>-<start>-<end>", so a prefix identifies them.
   * keepNotes keeps stars and vocabulary (they belong to the text, not to one blank selection).
   */
  function clearSectionPractice(state, sectionId, keepNotes = false) {
    const prefix = sectionId + '-'; let removed = false;
    const owned = id => id.startsWith(prefix);
    if (!keepNotes) for (const [k, v] of Object.entries(state.vocabulary || {})) if (v?.sectionId === sectionId) { delete state.vocabulary[k]; removed = true; }
    for (const key of keepNotes ? ['attempts', 'trouble', 'replays'] : ['attempts', 'trouble', 'replays', 'stars']) for (const id of Object.keys(state[key] || {})) if (owned(id)) { delete state[key][id]; removed = true; }
    for (const [id, e] of Object.entries(state.errors || {})) if (e?.sectionId === sectionId || owned(id)) { delete state.errors[id]; removed = true; }
    for (const key of ['blind', 'completed', 'speeds']) if (state[key] && Object.hasOwn(state[key], sectionId)) { delete state[key][sectionId]; removed = true; }
    if (Array.isArray(state.logs)) { const kept = state.logs.filter(l => l?.sectionId !== sectionId); if (kept.length !== state.logs.length) { state.logs = kept; removed = true; } }
    return removed;
  }
  const api = { normalizeAnswer, gradeAnswer, validTiming, sentenceIndexAt, groupParagraphs, blindContext, timelineReady, groupSections, score, sectionProgress, scheduleReview, removeEntries, restoreEntries, dismissReview, answerDiff, clearSectionPractice };
  root.ListeningCore = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
