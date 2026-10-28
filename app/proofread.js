/*
 * Turns an automatic transcription into rows for the proofreading step:
 *   - numbers and spelling cleaned up (LTItn), every change kept so it can be shown and undone;
 *   - words to check: low recognition confidence, or not in the dictionary (names are marked separately);
 *   - suggested deletions: exam instructions ("Now turn to Part 2", "You have some time to look at questions")
 *     and the first playing of a passage that is played twice (the Part 1 example);
 *   - speakers from the voice clustering.
 * build() turns the confirmed rows into the parsed-transcript shape used by the importer.
 */
(function (root) {
  'use strict';
  const I = root.LTItn || (typeof require === 'function' && require('./itn.js'));
  const T = root.LTTranscript || (typeof require === 'function' && require('./transcript.js'));
  const INSTRUCTION = /\b(you will hear (a|an|some|two|three|four|part|the)\b|you'll hear (a|an|some|two|three)\b|now turn to|turn to (part|section) |look at questions?|answer questions?|listen carefully and answer|listen and answer|that is the end of (part|section|the test|the listening)|this is the end of (part|section|the test)|you now have (half a minute|some time|ten minutes|one minute|a minute)|before you hear the rest|the test is in (four|4)|recording is copyright|published by (the )?(cambridge|university of cambridge)|you have some time to|check your answers|transfer your answers|answer sheet|there will be time for you to|played once only|recordings? will be played|on this occasion only|has been done for you|done as an example|now we shall begin|now we will begin|you should answer the questions|read the instructions|has been written (in|on) the|this is the ielts)/i;
  // Short headings read out by the announcer: "Section one.", "CD two, Test three.", "Practice test 2"
  const HEADING_WORDS = /^(cd|test|tests|section|sections|part|parts|practice|listening|one|two|three|four|five|six|seven|eight|nine|ten|\d+|ielts|and|to)$/i;
  const isHeading = t => { const w = t.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/); return w.length <= 8 && w.every(x => HEADING_WORDS.test(x)) && w.some(x => /^(cd|test|section|part)$/i.test(x)); };
  const WORD = /[A-Za-z][A-Za-z'’]*/g;

  function lemmas(w) { return [w, w.replace(/'s$/, ''), w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y'), w.replace(/ied$/, 'y'), w.replace(/ed$/, ''), w.replace(/ed$/, 'e'), w.replace(/ing$/, ''), w.replace(/ing$/, 'e'), w.replace(/([a-z])\1(ing|ed)$/, '$1'), w.replace(/ly$/, ''), w.replace(/er$/, ''), w.replace(/est$/, ''), w.replace(/n't$/, ''), w.replace(/'(re|ve|ll|d|m)$/, '')]; }
  const known = (w, dict) => !dict || lemmas(w.toLowerCase().replace(/’/g, "'")).some(f => dict.has(f));
  const simple = t => t.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();

  /**
   * Recognition sometimes repeats a few letters inside a word ("questestionnaire", "sururveys", "fooccus").
   * If removing one repeated chunk gives a dictionary word, use it (shown as an automatic change).
   */
  function undouble(word, dict) {
    const w = word.toLowerCase();
    if (!dict || known(w, dict)) return null;
    const found = new Set();
    for (let len = 1; len <= 4; len++) for (let i = 0; i + 2 * len <= w.length; i++) {
      if (w.slice(i, i + len) !== w.slice(i + len, i + 2 * len)) continue;
      const cand = w.slice(0, i + len) + w.slice(i + 2 * len);
      if (known(cand, dict)) found.add(cand);
      // two separate doublings, e.g. "fooccus"
      for (let l2 = 1; l2 <= 2; l2++) for (let k = 0; k + 2 * l2 <= cand.length; k++) if (cand.slice(k, k + l2) === cand.slice(k + l2, k + 2 * l2)) { const c2 = cand.slice(0, k + l2) + cand.slice(k + 2 * l2); if (dict.has(c2)) found.add(c2); }
    }
    // ...or dropped one of a double letter ("programe" -> "programme")
    if (!found.size) for (let i = 1; i < w.length; i++) if (/[a-z]/.test(w[i - 1]) && w[i - 1] !== w[i]) { const cand = w.slice(0, i) + w[i - 1] + w.slice(i); if (dict.has(cand)) found.add(cand); }
    if (!found.size && /[a-z]$/.test(w)) { const cand = w + w.at(-1); if (dict.has(cand)) found.add(cand); }
    if (found.size !== 1) return null;
    const fix = [...found][0];
    return word[0] === word[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
  }
  function fixWords(text, changes, dict) {
    let out = '', pos = 0, m; const re = /[A-Za-z]+/g, extra = [];
    while ((m = re.exec(text))) {
      if (changes.some(c => m.index >= c.start && m.index < c.end)) continue;
      const fix = undouble(m[0], dict); if (!fix) continue;
      out += text.slice(pos, m.index); const start = out.length; out += fix; pos = m.index + m[0].length;
      extra.push({ from: m[0], to: fix, at: m.index, start, end: start + fix.length, delta: fix.length - m[0].length });
    }
    if (!extra.length) return { text, changes };
    out += text.slice(pos);
    const moved = changes.map(c => { const d = extra.filter(x => x.at < c.start).reduce((n, x) => n + x.delta, 0); return { ...c, start: c.start + d, end: c.end + d }; });
    return { text: out, changes: [...moved, ...extra.map(({ from, to, start, end }) => ({ from, to, start, end }))].sort((a, b) => a.start - b.start) };
  }

  /** result: from LTTranscribe (+ speaker per sentence). options: {dict: Set, british: bool} */
  function prepare(result, options = {}) {
    const rows = result.sentences.map((s, i) => {
      const n0 = I.normalize(s.text, { british: options.british !== false, dict: options.dict }), n = fixWords(n0.text, n0.changes, options.dict);
      const low = new Set((s.uncertain || []).map(w => w.toLowerCase()));
      const check = [];
      let m; WORD.lastIndex = 0;
      while ((m = WORD.exec(n.text))) {
        const w = m[0], lw = w.toLowerCase().replace(/’/g, "'");
        if (n.changes.some(c => m.index >= c.start && m.index < c.end)) continue;
        const sentenceStart = !n.text.slice(0, m.index).trim() || /[.?!]\s*$/.test(n.text.slice(0, m.index));
        if (low.has(lw)) check.push({ start: m.index, end: m.index + w.length, why: 'low' });
        else if (!known(w, options.dict)) check.push({ start: m.index, end: m.index + w.length, why: /^[A-Z]/.test(w) && !sentenceStart ? 'name' : 'unknown' });
      }
      return { i, text: n.text, asr: s.text, changes: n.changes, check, speaker: s.speaker ?? 0, start: s.start, end: s.end, paragraph: s.paragraph ?? 0, keep: true, why: '' };
    });
    // Exam instructions.
    for (const r of rows) if (INSTRUCTION.test(r.text) || isHeading(r.text)) { r.keep = false; r.why = 'instruction'; }
    // "The number of bedrooms is four. So four has been written in the space." — the worked answer before it too.
    rows.forEach((r, i) => { if (/has been written (in|on) the/i.test(r.text) && i && rows[i - 1].text.split(' ').length <= 15) { rows[i - 1].keep = false; rows[i - 1].why = 'instruction'; } });
    // The announcer is usually a voice of its own: if most of a speaker's sentences are instructions, suggest all of them.
    const bySpeaker = {};
    for (const r of rows) (bySpeaker[r.speaker] ||= []).push(r);
    for (const list of Object.values(bySpeaker)) if (list.length >= 2 && list.filter(r => r.why === 'instruction').length / list.length >= 0.6) for (const r of list) if (r.keep) { r.keep = false; r.why = 'instruction'; }
    // A passage played twice (the worked example in Part 1 is played, then the conversation starts again from the
    // beginning): find word 8-grams that occur again later, and suggest deleting the sentences of the first playing.
    const W = []; rows.forEach((r, i) => { for (const w of simple(r.text).split(' ').filter(Boolean)) W.push({ w, i }); });
    const N = 8, seen = new Map(), covered = new Uint8Array(W.length);
    for (let p = W.length - N; p >= 0; p--) { const g = W.slice(p, p + N).map(x => x.w).join(' '); if (seen.has(g) && seen.get(g) >= p + N) covered.fill(1, p, p + N); else if (!seen.has(g)) seen.set(g, p); }
    for (let p = 0; p < W.length;) {
      if (!covered[p]) { p++; continue; }
      let q = p; while (q < W.length && covered[q]) q++;
      if (q - p >= 12) {
        const per = {}; for (let k = p; k < q; k++) per[W[k].i] = (per[W[k].i] || 0) + 1;
        for (const [i, n] of Object.entries(per)) { const r = rows[i], total = simple(r.text).split(' ').filter(Boolean).length; if (n / total >= 0.6 && r.keep) { r.keep = false; r.why = 'repeat'; } }
      }
      p = q;
    }
    const speakers = [...new Set(rows.filter(r => r.keep).map(r => r.speaker))];
    return { rows, speakers, speakerCount: result.speakers || speakers.length };
  }

  /** Undo one automatic change in a row (index into row.changes). */
  function revert(row, k) {
    const c = row.changes[k]; if (!c) return row;
    const shift = c.from.length - c.to.length;
    row.text = row.text.slice(0, c.start) + c.from + row.text.slice(c.end);
    row.changes.splice(k, 1);
    for (const o of row.changes) if (o.start > c.start) { o.start += shift; o.end += shift; }
    for (const o of row.check) if (o.start > c.start) { o.start += shift; o.end += shift; }
    return row;
  }

  /** rows -> {sentences: [{speaker, text, paragraph}], speakers, warnings} for buildSection. names: index -> label ('' = none) */
  function build(rows, names) {
    const sentences = rows.filter(r => r.keep && r.text.trim()).map(r => ({ speaker: names[r.speaker] ?? '', text: r.text.trim().replace(/\s+/g, ' '), paragraph: r.paragraph }));
    T.regroup(sentences);
    return { sentences, speakers: [...new Set(sentences.map(q => q.speaker).filter(Boolean))], warnings: [] };
  }

  const api = { prepare, revert, build, undouble, INSTRUCTION };
  root.LTProofread = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
