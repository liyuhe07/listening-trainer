/* Section records: building them from a parsed transcript, attaching alignment results and blanks.
   Shared by the browser (library.js) and the Node tools (tools/make-pack.js). */
(function (root) {
  'use strict';
  const B = root.LTBlanks || (typeof require === 'function' && require('./blanks.js'));
  const LOW_CONF = 0.6, MAX_BLANKS = 50;
  const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function buildSection({ id = newId(), title, collection = '', order = 1, parsed }) {
    const sentences = parsed.sentences.map((q, i) => ({ sentenceId: `${id}-${String(i + 1).padStart(3, '0')}`, paragraphId: `${id}-p${q.paragraph}`, speaker: q.speaker, text: q.text, blanks: [] }));
    return { id, title, collection, order, createdAt: Date.now(), sentences, timings: {}, nextSentence: sentences.length + 1, blankRevision: 'none' };
  }
  function applyAlignment(sec, result, seconds) {
    const timings = {}, list = sec.sentences;
    result.sentences.forEach((r, i) => { if (r) timings[list[i].sentenceId] = { start: r.start, end: r.end, speechStart: r.speechStart, speechEnd: r.speechEnd, confidence: r.confidence, untranscribed: r.untranscribed, ...(r.wildOnly ? { wildOnly: true } : {}), words: r.words.map(w => [w.a, w.b, w.start, w.end]) }; });
    // A sentence without alignable words gets the gap between its neighbours and is flagged for checking.
    list.forEach((q, i) => {
      if (timings[q.sentenceId]) return;
      const prev = list.slice(0, i).reverse().map(x => timings[x.sentenceId]).find(Boolean), next = list.slice(i + 1).map(x => timings[x.sentenceId]).find(Boolean);
      const start = prev ? prev.end : Math.max(0, (next?.start ?? 1) - 1), end = next ? Math.max(start + .3, next.start) : Math.min(result.duration, start + 2);
      timings[q.sentenceId] = { start, end, confidence: 0, estimated: true };
    });
    sec.timings = timings; sec.duration = result.duration; sec.alignment = { engine: 'nemo-conformer-ctc-small', at: Date.now(), seconds: Math.round(seconds || 0) };
    return sec;
  }
  const needsCheck = t => !t || !t.checked && (!!t.estimated || t.confidence < LOW_CONF || t.untranscribed > 1 || !!t.wildOnly);
  const blankId = (q, b) => `${q.sentenceId}-${b.start}-${b.end}`;
  function setBlanks(sec, perSentence, how) {
    sec.sentences.forEach((q, i) => { q.blanks = (perSentence[i] || []).filter(b => B.validBlank(q.text, b)).map(b => ({ ...b, id: blankId(q, b) })); });
    sec.blankRevision = how + '-' + Date.now().toString(36);
    return sec;
  }
  function autoBlanks(sec, coreWords, max = MAX_BLANKS, avoid = null) { return setBlanks(sec, B.select(sec.sentences, coreWords, { perSection: max, avoid }), 'auto'); }
  const blankCount = sec => sec.sentences.reduce((n, q) => n + (q.blanks?.length || 0), 0);
  function withNewId(sec, id) {
    const from = sec.id, re = s => typeof s === 'string' && s.startsWith(from + '-') ? id + s.slice(from.length) : s;
    const copy = JSON.parse(JSON.stringify(sec)); copy.id = id; if (sec.peaks) copy.peaks = sec.peaks;
    copy.sentences = copy.sentences.map(q => ({ ...q, sentenceId: re(q.sentenceId), paragraphId: re(q.paragraphId), blanks: (q.blanks || []).map(b => ({ ...b, id: re(b.id) })) }));
    copy.timings = Object.fromEntries(Object.entries(copy.timings || {}).map(([k, v]) => [re(k), v]));
    return copy;
  }
  function nextSentenceId(sec) {
    const used = sec.sentences.map(q => Number(q.sentenceId.slice(sec.id.length + 1)) || 0);
    const n = Math.max(sec.nextSentence || 1, Math.max(0, ...used) + 1);
    sec.nextSentence = n + 1;
    return `${sec.id}-${String(n).padStart(3, '0')}`;
  }
  /** Checks a section coming from a content pack; returns a list of problems (empty = fine). */
  function validate(sec) {
    const p = [], ID = /^[A-Za-z0-9_-]+$/;
    if (!sec || typeof sec !== 'object') return ['不是有效的章节'];
    if (!ID.test(sec.id || '')) p.push('章节 id 无效');
    if (typeof sec.title !== 'string' || !sec.title) p.push('缺少标题');
    if (!Array.isArray(sec.sentences) || !sec.sentences.length) p.push('没有句子');
    const seen = new Set();
    for (const q of sec.sentences || []) {
      if (!ID.test(q.sentenceId || '') || seen.has(q.sentenceId) || !q.sentenceId.startsWith(sec.id + '-')) { p.push('句子 id 无效：' + q.sentenceId); break; }
      seen.add(q.sentenceId);
      if (typeof q.text !== 'string') { p.push('句子文字无效'); break; }
      for (const b of q.blanks || []) if (!B.validBlank(q.text, b) || b.id !== blankId(q, b)) { p.push('挖空与原文不一致：' + q.sentenceId); break; }
    }
    return p;
  }
  function cleanForStore(sec) { return { ...sec, sentences: sec.sentences.map(({ n, ...q }) => q) }; }

  const api = { newId, buildSection, applyAlignment, needsCheck, blankId, setBlanks, autoBlanks, blankCount, withNewId, nextSentenceId, validate, cleanForStore, LOW_CONF, MAX_BLANKS };
  root.LTSection = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
