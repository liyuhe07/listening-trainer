/*
 * Alignment engine: audio samples + transcript sentences -> sentence and word timings.
 * Runs in a Web Worker (onnxruntime-web) and in Node (onnxruntime-node, used by the tests and the benchmark).
 *
 *   1. 80-bin filterbank of the whole recording (LTFbank).
 *   2. The CTC model runs on 30 s windows with 4 s of context on each side; only the middle of each window is kept.
 *   3. One Viterbi pass aligns the whole transcript (LTCtc), skipping untranscribed speech.
 *   4. Sentence edges are moved onto the actual speech onset / offset using the signal energy, then padded.
 */
(function (root) {
  'use strict';
  const F = root.LTFbank || (typeof require === 'function' && require('./fbank.js'));
  const X = root.LTText || (typeof require === 'function' && require('./text.js'));
  const K = root.LTCtc || (typeof require === 'function' && require('./ctc.js'));
  const SUB = 4, FRAME_SEC = 0.04, WIN = 3000, CTX = 400; // filterbank frames (10 ms): 30 s window, 4 s context

  /** Short-time energy in dB, 10 ms hop. */
  function energyDb(samples) {
    const hop = 160, n = Math.floor(samples.length / hop), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let e = 0; const o = i * hop;
      for (let k = 0; k < 400 && o + k < samples.length; k++) { const v = samples[o + k]; e += v * v; }
      out[i] = 10 * Math.log10(e / 400 + 1e-12);
    }
    return out;
  }
  function percentile(arr, p) { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; }

  /**
   * Moves each sentence start back to the speech onset and its end forward to the offset, within limits, then pads.
   * spans: [{start, end}] from the CTC path (token spikes). Returns new [{start, end}].
   */
  function refineBoundaries(spans, energy, duration, opt = {}) {
    const back = opt.maxBack ?? 0.4, fwd = opt.maxForward ?? 0.6, lead = opt.lead ?? 0.08, tail = opt.tail ?? 0.15;
    const at = t => energy[Math.max(0, Math.min(energy.length - 1, Math.round(t * 100)))];
    const out = spans.map(s => s && { start: s.start, end: s.end });
    for (const s of out) {
      if (!s) continue;
      // Threshold from the surroundings (3 s each side), so background music or noise does not count as speech.
      const lo = Math.max(0, Math.round((s.start - 3) * 100)), hi = Math.min(energy.length, Math.round((s.end + 3) * 100));
      const local = energy.subarray(lo, Math.max(lo + 1, hi)), floor = percentile(local, 0.1), loud = percentile(local, 0.9);
      const thr = floor + Math.max(6, 0.35 * (loud - floor));
      let a = s.start, dip = 0;
      for (let t = s.start - 0.01; t >= s.start - back; t -= 0.01) { if (at(t) >= thr) { a = t; dip = 0; } else if ((dip += 0.01) > 0.06) break; }
      let b = s.end; dip = 0;
      for (let t = s.end; t <= s.end + fwd; t += 0.01) { if (at(t) >= thr) { b = t + 0.01; dip = 0; } else if ((dip += 0.01) > 0.08) break; }
      s.start = Math.max(0, a - lead); s.end = Math.min(duration, b + tail);
    }
    // Neighbours must not overlap: meet in the middle, but never cut into either sentence's own speech.
    let p = -1;
    out.forEach((s, i) => {
      if (!s) return;
      if (p >= 0 && s.start < out[p].end) {
        const cut = Math.max(spans[p].end, Math.min(spans[i].start, (out[p].end + s.start) / 2));
        out[p].end = cut; s.start = cut;
      }
      p = i;
    });
    return out;
  }

  /**
   * samples: Float32Array 16 kHz mono. sentences: array of strings. model: {run(feats Float32Array(80*L), L) -> {data, rows, V}},
   * vocab: Map piece -> id, blankId. onProgress(fraction, label).
   */
  async function align({ samples, sentences, model, vocab, blankId, onProgress = () => {}, options = {} }) {
    const duration = samples.length / F.SR;
    const words = X.words(sentences);
    if (!words.length) throw new Error('原文中没有可对齐的英文单词。');
    const chain = K.buildChain(words, vocab), columns = K.compactColumns(chain), C = columns.width;
    onProgress(0.02, '计算声学特征');
    const feats = F.fbank(samples), Tf = feats.frames, T = Math.ceil(Tf / SUB);
    const em = new Float32Array(T * C);
    const hop = WIN - 2 * CTX;
    for (let s = 0; s < Tf; s += hop) {
      const a = Math.max(0, s - CTX), b = Math.min(Tf, s + hop + CTX);
      const out = await model.run(F.normalizedChunk(feats, a, b), b - a);
      const keepA = Math.floor((s - a) / SUB), keepB = Math.min(out.rows, keepA + Math.ceil((Math.min(Tf, s + hop) - s) / SUB));
      const rowStart = Math.floor(s / SUB), n = Math.min(keepB - keepA, T - rowStart);
      if (n > 0) em.set(K.compactRows(out.data.subarray(keepA * out.V, (keepA + n) * out.V), n, out.V, blankId, columns), rowStart * C);
      onProgress(0.05 + 0.85 * Math.min(1, (s + hop) / Tf), '识别语音');
    }
    onProgress(0.92, '对齐原文');
    const res = K.alignWords(em, T, chain, columns, words, sentences.length, FRAME_SEC, options);
    const energy = energyDb(samples);
    const refined = refineBoundaries(res.sentences.map(r => r && { start: r.start, end: r.end }), energy, duration, options);
    onProgress(1, '完成');
    return {
      duration,
      sentences: res.sentences.map((r, i) => r && {
        start: +refined[i].start.toFixed(3), end: +refined[i].end.toFixed(3),
        speechStart: +r.start.toFixed(3), speechEnd: +r.end.toFixed(3),
        confidence: +r.confidence.toFixed(3), untranscribed: +r.untranscribed.toFixed(2), wildOnly: r.wildOnly,
        words: r.words.map(w => ({ a: w.a, b: w.b, start: +w.start.toFixed(3), end: +w.end.toFixed(3), conf: w.conf === null ? null : +w.conf.toFixed(3) }))
      })
    };
  }

  const api = { align, refineBoundaries, energyDb };
  root.LTEngine = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
