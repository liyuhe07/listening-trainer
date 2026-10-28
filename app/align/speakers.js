/*
 * Who is speaking: one voice embedding per sentence (3D-Speaker CAM++, English, VoxCeleb), then agglomerative
 * clustering by cosine similarity. Returns a speaker index per sentence. Monologues come out as one speaker.
 */
(function (root) {
  'use strict';
  const F = root.LTFbank || (typeof require === 'function' && require('./fbank.js'));

  /** Embedding of samples[a..b) (seconds). model.run(feats Float32Array(T*80), T) -> Float32Array(dim). */
  async function embed(model, feats, a, b) {
    const fa = Math.max(0, Math.floor(a * 100)), fb = Math.min(feats.frames, Math.ceil(b * 100)), T = fb - fa;
    if (T < 30) return null;
    const x = new Float32Array(T * 80), mean = new Float64Array(80);
    for (let t = 0; t < T; t++) for (let c = 0; c < 80; c++) mean[c] += feats.data[(fa + t) * 80 + c] / T;
    for (let t = 0; t < T; t++) for (let c = 0; c < 80; c++) x[t * 80 + c] = feats.data[(fa + t) * 80 + c] - mean[c];
    const e = await model.run(x, T); let n = 0; for (const v of e) n += v * v; n = Math.sqrt(n) || 1;
    return Float32Array.from(e, v => v / n);
  }
  const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  /**
   * Average-linkage agglomerative clustering. Long segments decide the clusters; short ones (< minDur) join the
   * closest cluster afterwards, because a voice print from under a second of speech is unreliable.
   */
  function cluster(embs, durs, { threshold = 0.35, minDur = 1.2, maxSpeakers = 4 } = {}) {
    const idx = embs.map((e, i) => i).filter(i => embs[i] && durs[i] >= minDur);
    let groups = idx.map(i => ({ members: [i], sum: Float32Array.from(embs[i]) }));
    const centroid = g => { let n = 0; for (const v of g.sum) n += v * v; n = Math.sqrt(n) || 1; return Float32Array.from(g.sum, v => v / n); };
    for (;;) {
      if (groups.length <= 1) break;
      let best = -2, bi = -1, bj = -1;
      const cents = groups.map(centroid);
      for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) { const s = cos(cents[i], cents[j]); if (s > best) { best = s; bi = i; bj = j; } }
      if (best < threshold && groups.length <= maxSpeakers) break;
      const g = groups[bi], h = groups[bj];
      for (let k = 0; k < g.sum.length; k++) g.sum[k] += h.sum[k];
      g.members.push(...h.members); groups.splice(bj, 1);
    }
    // Small clusters (under 8% of the speech) are usually noise or an announcer fragment: merge them away
    // unless they are clearly a different voice.
    const total = idx.reduce((s, i) => s + durs[i], 0), dur = g => g.members.reduce((s, i) => s + durs[i], 0);
    for (;;) {
      const small = groups.filter(g => dur(g) < 0.08 * total).sort((x, y) => dur(x) - dur(y))[0];
      if (!small || groups.length < 2) break;
      const c = centroid(small); let best = -2, into = null;
      for (const g of groups) if (g !== small) { const s = cos(centroid(g), c); if (s > best) { best = s; into = g; } }
      if (best < 0.1) break; // a genuinely different voice that speaks only briefly
      for (let k = 0; k < into.sum.length; k++) into.sum[k] += small.sum[k];
      into.members.push(...small.members); groups.splice(groups.indexOf(small), 1);
    }
    groups.sort((x, y) => y.members.reduce((s, i) => s + durs[i], 0) - x.members.reduce((s, i) => s + durs[i], 0));
    const cents = groups.map(centroid), label = new Int32Array(embs.length).fill(-1);
    groups.forEach((g, k) => g.members.forEach(i => { label[i] = k; }));
    for (let i = 0; i < embs.length; i++) {
      if (label[i] >= 0 || !cents.length) continue;
      if (!embs[i]) continue;
      let best = -2, k = 0; cents.forEach((c, j) => { const s = cos(c, embs[i]); if (s > best) { best = s; k = j; } }); label[i] = k;
    }
    // Sentences without a usable voice print take the label of the previous sentence.
    for (let i = 0; i < label.length; i++) if (label[i] < 0) label[i] = i ? label[i - 1] : 0;
    return { labels: Array.from(label), speakers: groups.length, share: groups.map(g => g.members.reduce((s, i) => s + durs[i], 0) / (total || 1)) };
  }

  /** spans: [{start, end}] in seconds. Returns {labels, speakers}. */
  async function diarize({ samples, spans, model, feats, onProgress = () => { }, options = {} }) {
    feats ||= F.fbank(samples);
    const embs = [], durs = [];
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i]; embs.push(await embed(model, feats, s.start, s.end)); durs.push(s.end - s.start);
      if (i % 5 === 0) onProgress(i / spans.length, '区分说话人');
    }
    return cluster(embs, durs, options);
  }

  const api = { embed, cluster, diarize };
  root.LTSpeakers = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
