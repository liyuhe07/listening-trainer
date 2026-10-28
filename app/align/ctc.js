/*
 * CTC forced alignment of a whole transcript against one recording.
 *
 * The transcript is turned into a chain of states: sentence gaps, word tokens (BPE pieces), optional blanks
 * between pieces, and soft gaps between words. A single Viterbi pass over the model's log-probabilities finds the
 * best path through the chain. Speech that is not in the transcript (the test introduction, "now turn to part 2",
 * the reading pauses) is absorbed by the sentence gaps, so the transcript does not need to start where the
 * recording starts. Numbers and other unpredictable words are wildcards that match any speech.
 *
 * Emissions are passed in compact form: a Float32Array of T rows x C columns where column 0 is the blank,
 * column 1 the best non-blank log-probability of that frame, and the remaining columns the vocabulary ids listed
 * in `columns` (see compactColumns).
 */
(function (root) {
  'use strict';
  const BLANK = 0, TOK = 1, WILD = 2, GAP = 3, WGAP = 4, EDGE = 5;
  const NEG = -1e30;

  /**
   * Splits "▁" + word into vocabulary pieces the way the model's SentencePiece (unigram) tokenizer would.
   * Piece scores are not shipped with the model, but unigram vocabularies are ordered by score, so the rank is used:
   * score = -log(rank) - 2 per piece. This reproduces the model's own segmentation for 99.8% of words.
   * vocab: Map piece -> id (ids in vocabulary order).
   */
  function tokenize(word, vocab) {
    const s = '▁' + word, n = s.length, best = new Float64Array(n + 1).fill(-Infinity), from = new Int32Array(n + 1), id = new Int32Array(n + 1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      for (let j = i + 1; j <= Math.min(n, i + 24); j++) {
        const v = vocab.get(s.slice(i, j));
        if (v === undefined) continue;
        const sc = best[i] - Math.log(v + 2) - 2;
        if (sc > best[j]) { best[j] = sc; from[j] = i; id[j] = v; }
      }
    }
    if (best[n] === -Infinity) return null;
    const out = []; for (let j = n; j > 0; j = from[j]) out.push(id[j]);
    return out.reverse();
  }

  /** Builds the state chain. words: [{s, text|null}] in transcript order (from LTText.words). */
  function buildChain(words, vocab) {
    const kind = [], tok = [], word = [];
    const push = (k, t, w) => { kind.push(k); tok.push(t); word.push(w); };
    push(EDGE, -1, -1);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (i > 0) push(words[i - 1].s !== w.s ? GAP : WGAP, -1, -1);
      const pieces = w.text === null ? null : tokenize(w.text, vocab);
      if (!pieces) { push(WILD, -1, i); continue; }
      pieces.forEach((p, k) => { if (k) push(BLANK, -1, -1); push(TOK, p, i); });
    }
    push(EDGE, -1, -1);
    return { kind: Uint8Array.from(kind), tok: Int32Array.from(tok), word: Int32Array.from(word) };
  }

  /** The vocabulary ids a chain needs, as compact columns (2 + index). */
  function compactColumns(chain) {
    const ids = [...new Set(Array.from(chain.tok).filter(t => t >= 0))].sort((a, b) => a - b);
    return { ids, index: new Map(ids.map((id, i) => [id, i + 2])), width: ids.length + 2 };
  }

  /** Appends compact rows for one chunk of full log-probs (rows x V) to a growing list. */
  function compactRows(logp, rows, V, blankId, columns) {
    const C = columns.width, out = new Float32Array(rows * C);
    for (let t = 0; t < rows; t++) {
      const o = t * V; let best = NEG;
      for (let v = 0; v < V; v++) if (v !== blankId && logp[o + v] > best) best = logp[o + v];
      out[t * C] = logp[o + blankId]; out[t * C + 1] = best;
      for (let k = 0; k < columns.ids.length; k++) out[t * C + 2 + k] = logp[o + columns.ids[k]];
    }
    return out;
  }

  /**
   * Viterbi through the chain. em: compact emissions (T x C). Returns per-state first/last frame and per-frame
   * information needed for confidence.
   */
  function viterbi(em, T, C, chain, columns, opt = {}) {
    const penEdge = opt.edgePenalty ?? 0.1, penGap = opt.gapPenalty ?? 0.5, penWord = opt.wordGapPenalty ?? 3, penWild = opt.wildPenalty ?? 0.2;
    const { kind, tok } = chain, S = kind.length;
    const col = new Int32Array(S); for (let j = 0; j < S; j++) col[j] = kind[j] === TOK ? columns.index.get(tok[j]) : 0;
    const canSkip = new Uint8Array(S);
    for (let j = 2; j < S; j++) {
      const mid = kind[j - 1];
      canSkip[j] = (mid === BLANK || mid === GAP || mid === WGAP || mid === EDGE) && !(kind[j] === TOK && kind[j - 2] === TOK && tok[j] === tok[j - 2]) ? 1 : 0;
    }
    if (T * S > 2.4e9) throw new Error('录音太长或原文太长，请分段导入（每段建议 15 分钟以内）。');
    const bp = new Uint8Array(Math.ceil(T * S / 4));
    let prev = new Float32Array(S).fill(NEG), cur = new Float32Array(S);
    const emit = (r, j) => {
      switch (kind[j]) {
        case TOK: return em[r + col[j]];
        case BLANK: return em[r];
        case WILD: return Math.max(em[r], em[r + 1]) - penWild;
        case GAP: return Math.max(em[r], em[r + 1] - penGap);
        case EDGE: return Math.max(em[r], em[r + 1] - penEdge);
        default: return Math.max(em[r], em[r + 1] - penWord);
      }
    };
    prev[0] = emit(0, 0); if (S > 1) prev[1] = emit(0, 1);
    for (let t = 1; t < T; t++) {
      const r = t * C, base = t * S;
      // A state can only be reached if it is at most 2t+1 states in; and must leave room to finish (not enforced).
      const jmax = Math.min(S - 1, 2 * t + 1);
      for (let j = 0; j <= jmax; j++) {
        let best = prev[j], b = 0;
        if (j >= 1 && prev[j - 1] > best) { best = prev[j - 1]; b = 1; }
        if (canSkip[j] && prev[j - 2] > best) { best = prev[j - 2]; b = 2; }
        if (best <= NEG) { cur[j] = NEG; continue; }
        cur[j] = best + emit(r, j);
        const idx = base + j; bp[idx >> 2] |= b << ((idx & 3) << 1);
      }
      for (let j = jmax + 1; j < S; j++) cur[j] = NEG;
      const tmp = prev; prev = cur; cur = tmp;
    }
    let j = S - 1;
    if (S > 1 && prev[S - 2] > prev[S - 1]) j = S - 2;
    if (prev[j] <= NEG) throw new Error('无法对齐：录音比原文短太多，或原文与录音不对应。');
    const path = new Int32Array(T);
    for (let t = T - 1; t >= 0; t--) {
      path[t] = j;
      if (t === 0) break;
      const idx = t * S + j, b = (bp[idx >> 2] >> ((idx & 3) << 1)) & 3;
      j -= b;
    }
    const first = new Int32Array(S).fill(-1), last = new Int32Array(S).fill(-1);
    for (let t = 0; t < T; t++) { const s = path[t]; if (first[s] < 0) first[s] = t; last[s] = t; }
    return { path, first, last, score: prev[path[T - 1]] };
  }

  /**
   * Full alignment. Returns word and sentence timings in frames.
   * words: from LTText.words; sentenceCount: number of sentences.
   */
  function alignWords(em, T, chain, columns, words, sentenceCount, frameSec, opt) {
    const C = columns.width, v = viterbi(em, T, C, chain, columns, opt), { kind, word } = chain;
    const wt = words.map(() => ({ start: Infinity, end: -Infinity, peak: [] }));
    for (let j = 0; j < kind.length; j++) {
      const w = word[j]; if (w < 0 || v.first[j] < 0) continue;
      const x = wt[w];
      x.start = Math.min(x.start, v.first[j]); x.end = Math.max(x.end, v.last[j] + 1);
      if (kind[j] === TOK) {
        let peak = NEG; const c = columns.index.get(chain.tok[j]);
        for (let t = v.first[j]; t <= v.last[j]; t++) peak = Math.max(peak, em[t * C + c]);
        x.peak.push(peak);
      } else x.wild = true;
    }
    // Untranscribed speech inside a sentence (word gaps that chose the star branch).
    const starInside = new Float64Array(sentenceCount);
    for (let t = 0; t < T; t++) {
      const s = v.path[t]; if (kind[s] !== WGAP) continue;
      const r = t * C; if (em[r + 1] - (opt?.wordGapPenalty ?? 3) > em[r]) {
        // attribute to the sentence of the next word
        let k = s + 1; while (k < kind.length && word[k] < 0) k++;
        if (k < kind.length) starInside[words[word[k]].s] += frameSec;
      }
    }
    const wordsOut = words.map((w, i) => ({ s: w.s, a: w.a, b: w.b, start: wt[i].start * frameSec, end: wt[i].end * frameSec,
      wild: !!wt[i].wild, conf: wt[i].peak.length ? wt[i].peak.reduce((m, p) => m + Math.exp(p), 0) / wt[i].peak.length : null }));
    const sentences = [];
    for (let s = 0; s < sentenceCount; s++) {
      const ws = wordsOut.filter(w => w.s === s);
      if (!ws.length) { sentences.push(null); continue; }
      const scored = ws.filter(w => w.conf !== null);
      sentences.push({ start: Math.min(...ws.map(w => w.start)), end: Math.max(...ws.map(w => w.end)), words: ws,
        confidence: scored.length ? scored.reduce((m, w) => m + w.conf, 0) / scored.length : 0,
        untranscribed: starInside[s], wildOnly: !scored.length });
    }
    return { words: wordsOut, sentences, score: v.score };
  }

  const api = { tokenize, buildChain, compactColumns, compactRows, viterbi, alignWords, KIND: { BLANK, TOK, WILD, GAP, WGAP, EDGE } };
  root.LTCtc = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
