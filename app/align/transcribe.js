/*
 * Automatic transcription for material that has no transcript.
 * Runs a CTC model that outputs punctuation and capitals (NVIDIA Parakeet TDT-CTC 110M, CTC branch, int8 ONNX) over the
 * whole recording in the same 30-second windows the aligner uses, decodes greedily, and turns the result into
 * sentences with times and per-word confidence. The text must be proofread: low-confidence words are marked.
 */
(function (root) {
  'use strict';
  const F = root.LTFbank || (typeof require === 'function' && require('./fbank.js'));
  const WIN = 3000, CTX = 400, UNSURE = 0.45; // measured: below this most words really are misheard; misspellings are caught by the dictionary check

  /** model: {run(feats, L) -> {data, rows, V}}, tokens: array of pieces, blankId, subsampling (8 for Parakeet). */
  async function transcribe({ samples, model, tokens, blankId, subsampling = 8, onProgress = () => { } }) {
    const feats = F.fbank(samples), Tf = feats.frames, frameSec = subsampling * 0.01, hop = WIN - 2 * CTX;
    const ids = [], probs = [];
    onProgress(0.02, '计算声学特征');
    for (let s = 0; s < Tf; s += hop) {
      const a = Math.max(0, s - CTX), b = Math.min(Tf, s + hop + CTX);
      const out = await model.run(F.normalizedChunk(feats, a, b), b - a);
      const keepA = Math.floor((s - a) / subsampling), n = Math.min(out.rows - keepA, Math.ceil((Math.min(Tf, s + hop) - s) / subsampling));
      for (let r = keepA; r < keepA + n; r++) {
        let best = 0, bv = -Infinity; const o = r * out.V;
        for (let v = 0; v < out.V; v++) if (out.data[o + v] > bv) { bv = out.data[o + v]; best = v; }
        ids.push(best); probs.push(Math.exp(bv));
      }
      onProgress(0.05 + 0.9 * Math.min(1, (s + hop) / Tf), '识别语音');
    }
    // Greedy CTC: collapse repeats, drop blanks; keep the frame span and confidence of every emitted piece.
    const pieces = []; let prev = -1;
    for (let t = 0; t < ids.length; t++) {
      const id = ids[t];
      if (id !== blankId && id !== prev) pieces.push({ text: tokens[id], start: t, end: t + 1, conf: probs[t] });
      else if (id !== blankId && pieces.length) { const p = pieces.at(-1); p.end = t + 1; p.conf = Math.max(p.conf, probs[t]); }
      prev = id;
    }
    const words = [];
    for (const p of pieces) {
      if (p.text === '<unk>') continue;
      const starts = p.text.startsWith('▁'), text = p.text.replace(/^▁/, '');
      if (starts || !words.length || /^[A-Z0-9]/.test(text) && /[.?!]$/.test(words.at(-1).text)) words.push({ text, start: p.start, end: p.end, conf: p.conf });
      else { const w = words.at(-1); w.text += text; w.end = p.end; w.conf = Math.min(w.conf, p.conf); }
    }
    // Sentences end at . ? ! ; a long pause also ends a sentence; a longer one starts a new paragraph.
    const sentences = []; let cur = null, paragraph = 0;
    words.forEach((w, i) => {
      const gap = cur ? (w.start - words[i - 1].end) * frameSec : 0;
      if (cur && gap > 2.5) paragraph++;
      if (!cur || gap > 1.2 && cur.words.length > 3) { if (cur) sentences.push(cur); cur = { words: [], paragraph }; }
      cur.words.push(w);
      if (/[.?!]["”’)]*$/.test(w.text)) { sentences.push(cur); cur = null; }
    });
    if (cur) sentences.push(cur);
    onProgress(1, '完成');
    return {
      duration: samples.length / F.SR,
      sentences: sentences.map(s => ({
        text: s.words.map(w => w.text).join(' ').replace(/^[a-z]/, c => c.toUpperCase()), paragraph: s.paragraph,
        start: +(s.words[0].start * frameSec).toFixed(2), end: +(s.words.at(-1).end * frameSec).toFixed(2),
        words: s.words.map(w => [w.text, +w.conf.toFixed(3)]),
        uncertain: s.words.filter(w => w.conf < UNSURE).map(w => w.text.replace(/[^A-Za-z0-9'’-]/g, '')).filter(Boolean)
      }))
    };
  }

  /** Plain text for the import box: one paragraph per block, sentences joined by spaces. */
  function toText(result) {
    const out = []; let p = null;
    for (const s of result.sentences) { if (s.paragraph !== p) { out.push([]); p = s.paragraph; } out.at(-1).push(s.text); }
    return out.map(x => x.join(' ')).join('\n\n');
  }

  const api = { transcribe, toText };
  root.LTTranscribe = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
