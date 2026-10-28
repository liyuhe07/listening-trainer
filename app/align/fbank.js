/*
 * Kaldi-compatible 80-bin log-mel filterbank (16 kHz), as expected by the NeMo CTC model exported by sherpa-onnx.
 * Matches kaldi-native-fbank with: dither 0, snip_edges false, povey window, preemph 0.97, remove DC,
 * 25 ms frames / 10 ms shift, 512-point FFT, mel 20 Hz .. Nyquist, power spectrum, natural log.
 * Verified against kaldi-native-fbank in tests/fbank.test.js.
 */
(function (root) {
  'use strict';
  const SR = 16000, FRAME = 400, SHIFT = 160, NFFT = 512, BINS = 80, PREEMPH = 0.97, EPS = 1.1920928955078125e-7;

  const window_ = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) window_[i] = Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1)), 0.85);

  // Mel filterbank (Kaldi MelBanks), stored sparse: for each bin, first FFT index and weights.
  const mel = f => 1127 * Math.log(1 + f / 700);
  const banks = [];
  (function () {
    const lo = mel(20), hi = mel(SR / 2), delta = (hi - lo) / (BINS + 1), half = NFFT / 2;
    for (let b = 0; b < BINS; b++) {
      const left = lo + b * delta, center = left + delta, right = center + delta;
      let first = -1; const w = [];
      for (let i = 0; i < half; i++) {
        const m = mel(i * SR / NFFT);
        if (m > left && m < right) {
          if (first < 0) first = i;
          w.push(m <= center ? (m - left) / (center - left) : (right - m) / (right - center));
        } else if (first >= 0) break;
      }
      banks.push({ first, w: Float64Array.from(w) });
    }
  })();

  // In-place iterative radix-2 complex FFT.
  const rev = new Uint16Array(NFFT), cosT = new Float64Array(NFFT / 2), sinT = new Float64Array(NFFT / 2);
  (function () {
    const bits = Math.log2(NFFT);
    for (let i = 0; i < NFFT; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    for (let i = 0; i < NFFT / 2; i++) { cosT[i] = Math.cos(-2 * Math.PI * i / NFFT); sinT[i] = Math.sin(-2 * Math.PI * i / NFFT); }
  })();
  function fft(re, im) {
    for (let i = 0; i < NFFT; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= NFFT; size <<= 1) {
      const halfSize = size >> 1, step = NFFT / size;
      for (let start = 0; start < NFFT; start += size) {
        for (let k = 0; k < halfSize; k++) {
          const c = cosT[k * step], s = sinT[k * step], a = start + k, b = a + halfSize;
          const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  }

  /** samples: Float32Array in [-1, 1] at 16 kHz. Returns {data: Float32Array(T*80), frames: T}. */
  function fbank(samples) {
    const n = samples.length, T = Math.floor((n + SHIFT / 2) / SHIFT);
    const out = new Float32Array(T * BINS), re = new Float64Array(NFFT), im = new Float64Array(NFFT), buf = new Float64Array(FRAME);
    for (let t = 0; t < T; t++) {
      const first = t * SHIFT + SHIFT / 2 - FRAME / 2;
      let mean = 0;
      for (let i = 0; i < FRAME; i++) {
        let s = first + i;
        while (s < 0 || s >= n) s = s < 0 ? -s - 1 : 2 * n - 1 - s;
        buf[i] = samples[s] * 32768; mean += buf[i];
      }
      mean /= FRAME;
      for (let i = 0; i < FRAME; i++) buf[i] -= mean;
      for (let i = FRAME - 1; i > 0; i--) buf[i] -= PREEMPH * buf[i - 1];
      buf[0] -= PREEMPH * buf[0];
      for (let i = 0; i < FRAME; i++) { re[i] = buf[i] * window_[i]; im[i] = 0; }
      for (let i = FRAME; i < NFFT; i++) { re[i] = 0; im[i] = 0; }
      fft(re, im);
      for (let b = 0; b < BINS; b++) {
        const { first: f, w } = banks[b]; let e = 0;
        for (let k = 0; k < w.length; k++) { const i = f + k; e += w[k] * (re[i] * re[i] + im[i] * im[i]); }
        out[t * BINS + b] = Math.log(Math.max(e, EPS));
      }
    }
    return { data: out, frames: T, bins: BINS };
  }

  /** Per-feature (per mel bin) mean/variance normalisation of frames [a, b), returned as (80, b-a) channel-major. */
  function normalizedChunk(feats, a, b) {
    const L = b - a, out = new Float32Array(BINS * L);
    for (let c = 0; c < BINS; c++) {
      let sum = 0, sq = 0;
      for (let t = a; t < b; t++) { const v = feats.data[t * BINS + c]; sum += v; sq += v * v; }
      const m = sum / L, sd = Math.sqrt(Math.max(0, sq / L - m * m)) + 1e-5;
      for (let t = a; t < b; t++) out[c * L + (t - a)] = (feats.data[t * BINS + c] - m) / sd;
    }
    return out;
  }

  const api = { fbank, normalizedChunk, SR, SHIFT, BINS };
  root.LTFbank = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
