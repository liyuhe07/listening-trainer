/*
 * Turns pasted transcript text into sentences with speakers and paragraphs.
 *
 *   MAN: Good morning. How can I help you?        -> speaker "MAN", two sentences
 *   WOMAN: I'd like to ...                           -> a new speaker turn
 *   (blank line)                                     -> a new paragraph
 *
 * Lines without a speaker label continue the current turn, so text copied from a PDF with hard line breaks is
 * joined back together. Headings such as "SECTION 1" or "Part 2" on their own line are skipped.
 */
(function (root) {
  'use strict';
  const ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'prof', 'mt', 'jr', 'sr', 'etc', 'e.g', 'i.e', 'a.m', 'p.m', 'vs', 'no', 'approx', 'ave', 'rd', 'dept', 'est', 'fig', 'inc', 'ltd', 'co', 'u.k', 'u.s', 'b.a', 'm.a', 'ph.d']);
  const HEADING = /^\s*(section|part|test|questions?|practice test|audioscripts?|transcript)\b[\s\d:.,–—-]*\s*$/i;
  const LABEL = /^\s*([A-Z][A-Z0-9 .'’-]{0,24}|[A-Z][a-z]+(?: [A-Z][a-z]+)?|Speaker \d+|[A-Z])\s*[:：]\s+(?=\S)/;

  function splitSentences(text) {
    const out = [], re = /([.?!…]+)(["”’)\]]*)(\s+)(?=["“‘(\[]?[A-Z0-9£$€])/g;
    let start = 0, m;
    while ((m = re.exec(text))) {
      const end = m.index + m[1].length + m[2].length;
      const before = text.slice(start, m.index), lastWord = (before.match(/([A-Za-z.]+)$/) || [, ''])[1].toLowerCase();
      if (m[1] === '.' && (ABBREV.has(lastWord.replace(/\.$/, '')) || /^[a-z]$/i.test(lastWord) && /\s[A-Z]$|^[A-Z]$/.test(before.slice(-2)))) continue;
      const piece = text.slice(start, end).trim(); if (piece) out.push(piece);
      start = end + m[3].length;
    }
    const tail = text.slice(start).trim(); if (tail) out.push(tail);
    return out;
  }

  /**
   * Long paragraphs are split into readable groups: after about six sentences, at the next change of speaker
   * (dialogue) or straight away (monologue, or a single speaker going on for more than nine sentences).
   * sentences: [{speaker, paragraph}] — paragraph numbers are rewritten in place.
   */
  function regroup(sentences) {
    let p = -1, last = null, run = 0, prevSpeaker = null;
    for (const q of sentences) {
      const turnChange = q.speaker !== prevSpeaker;
      if (q.paragraph !== last || run >= 6 && (turnChange || q.speaker === '') || run >= 10) { p++; run = 0; last = q.paragraph; }
      run++; q.paragraph = p; prevSpeaker = q.speaker;
    }
    return sentences;
  }

  /** Returns {sentences: [{speaker, text, paragraph}], speakers: [...], warnings: [...]}. */
  function parse(raw) {
    const lines = String(raw || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n');
    const turns = []; let paragraph = 0, current = null, warnings = [];
    const add = (speaker, text) => { current = { speaker, text, paragraph }; turns.push(current); };
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { if (current) { paragraph++; current = null; } continue; }
      if (HEADING.test(trimmed)) continue;
      const label = trimmed.match(LABEL);
      if (label) {
        const name = label[1].trim().replace(/\s+/g, ' ');
        add(name, trimmed.slice(label[0].length));
      } else if (current) {
        // PDF line breaks: join, removing an end-of-line hyphenation of a lowercase word.
        current.text = /[a-z]-$/.test(current.text) && /^[a-z]/.test(trimmed) ? current.text.slice(0, -1) + trimmed : current.text + ' ' + trimmed;
      } else add('', trimmed);
    }
    const sentences = [];
    for (const turn of turns) {
      for (const text of splitSentences(turn.text.replace(/\s+/g, ' '))) sentences.push({ speaker: turn.speaker, text, paragraph: turn.paragraph });
    }
    regroup(sentences);
    const speakers = [...new Set(sentences.map(q => q.speaker).filter(Boolean))];
    if (sentences.some(q => q.text.length > 400)) warnings.push('有句子超过 400 个字符，可能缺少句末标点；导入后可在校对页拆分。');
    if (!sentences.length) warnings.push('没有识别到句子。');
    return { sentences, speakers, warnings };
  }

  const api = { parse, splitSentences, regroup };
  root.LTTranscript = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
