/*
 * Turns transcript sentences into the word list the aligner uses.
 * Every word keeps its character offsets in the original sentence, so word times can be mapped back onto the text.
 * Words whose pronunciation cannot be predicted reliably (numbers, symbols, all-capital abbreviations) become
 * wildcards: they must be spoken somewhere in order, but any speech matches them.
 */
(function (root) {
  'use strict';
  const ABBREV = { mr: 'mister', mrs: 'missus', dr: 'doctor', '&': 'and', vs: 'versus', etc: 'etcetera', ok: 'okay', okay: 'okay' };
  const WILD = null;

  function spoken(raw) {
    let w = raw.replace(/[’‘`´]/g, "'").replace(/^'+|'+$/g, '');
    if (!w) return undefined;
    if (/[0-9£$€¥%@#+=]/.test(w)) return WILD;
    const lower = w.toLowerCase().replace(/\.$/, '');
    if (Object.hasOwn(ABBREV, lower)) return ABBREV[lower];
    if (/^[A-Z]{2,}s?$/.test(w.replace(/\./g, '')) && !/^(I|A)$/.test(w)) return WILD; // BBC, UK, IELTS
    if (/^([A-Za-z]\.)+[A-Za-z]\.?$/.test(w)) return WILD;                               // a.m., p.m., e.g.
    const clean = lower.replace(/[^a-z']/g, '');
    if (!clean.replace(/'/g, '')) return undefined;
    return clean;
  }

  /** sentences: array of strings. Returns [{s, a, b, text}] where text is null for a wildcard. */
  function words(sentences) {
    const out = [];
    sentences.forEach((sentence, s) => {
      const re = /[^\s\-–—/]+/g; let m;
      while ((m = re.exec(sentence))) {
        let a = m.index, b = a + m[0].length;
        // Trim punctuation that is not part of the word itself.
        while (a < b && /[("“”'‘’\[{,.;:!?…*]/.test(sentence[a])) a++;
        while (b > a && /[)"“”'‘’\]},.;:!?…*]/.test(sentence[b - 1])) b--;
        if (b <= a) continue;
        const text = spoken(sentence.slice(a, b));
        if (text === undefined) continue;
        out.push({ s, a, b, text });
      }
    });
    return out;
  }

  const api = { words, spoken };
  root.LTText = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
