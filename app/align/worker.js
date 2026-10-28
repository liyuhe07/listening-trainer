/*
 * Speech worker. Two jobs:
 *   align      — audio + transcript sentences -> sentence and word timings (always available, 46 MB model)
 *   transcribe — audio only -> sentences with punctuation, word confidence and speakers (optional, downloads a
 *                132 MB recognition model and a 30 MB voice model the first time)
 * Models are listed in models/<name>/manifest.json; large ones are stored in parts (GitHub allows at most 100 MB per
 * file). Parts are downloaded once, kept in the browser's Cache Storage and checked against the SHA-256 in the manifest.
 */
importScripts('../../vendor/ort/ort.wasm.min.js', 'fbank.js', 'text.js', 'ctc.js', 'engine.js', 'transcribe.js', 'speakers.js');

const MODELS = new URL('../../models/', self.location).href;
const CACHE = 'lt-model-v1';
const sessions = {};

function progress(fraction, label) { self.postMessage({ type: 'progress', fraction, label }); }

async function fetchCached(url, onBytes) {
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); onBytes?.(b.length); return b; } } catch (e) { cache = null; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`模型文件下载失败（${res.status}）：${url}`);
  const reader = res.body?.getReader(); let bytes;
  if (!reader) bytes = new Uint8Array(await res.arrayBuffer());
  else {
    const parts = []; let got = 0, reported = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onBytes?.(value.length); reported += value.length; }
    bytes = new Uint8Array(got); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
  }
  try { if (cache) await cache.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* storage full or private mode */ }
  return bytes;
}

/** Downloads (or reads from cache) every part of a model, joins and verifies it. */
async function modelBytes(dir, label, from, to) {
  const manifest = await (await fetch(MODELS + dir + '/manifest.json')).json();
  const out = new Uint8Array(manifest.size); let offset = 0, done = 0;
  for (const part of manifest.parts) {
    const bytes = await fetchCached(MODELS + dir + '/' + part.file, n => { done += n; progress(from + (to - from) * done / manifest.size, `${label} ${(done / 1048576).toFixed(0)} / ${(manifest.size / 1048576).toFixed(0)} MB（只需下载一次）`); });
    if (bytes.length !== part.size) throw new Error(`模型文件 ${part.file} 大小不对，请刷新后重试。`);
    out.set(bytes, offset); offset += bytes.length;
  }
  if (self.crypto?.subtle) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', out)), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== manifest.sha256) { try { const c = await caches.open(CACHE); for (const p of manifest.parts) await c.delete(MODELS + dir + '/' + p.file); } catch { } throw new Error('模型文件校验失败（下载可能不完整），已清除缓存，请重试。'); }
  }
  return out;
}

async function session(dir, label, from, to) {
  if (sessions[dir]) return sessions[dir];
  ort.env.wasm.wasmPaths = new URL('../../vendor/ort/', self.location).href;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  const p = (async () => {
    const bytes = await modelBytes(dir, label, from, to);
    const s = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    let tokens = null;
    try { const r = await fetch(MODELS + dir + '/tokens.txt'); if (r.ok) tokens = (await r.text()).trim().split('\n').map(l => l.split(' ')[0]); } catch { }
    return { s, tokens };
  })();
  sessions[dir] = p; p.catch(() => { delete sessions[dir]; });
  return p;
}
function ctcModel({ s }) {
  return async (feats, L) => {
    const out = await s.run({ audio_signal: new ort.Tensor('float32', feats, [1, 80, L]), length: new ort.Tensor('int64', BigInt64Array.from([BigInt(L)]), [1]) });
    const t = out[s.outputNames[0]]; return { data: t.data, rows: t.dims[1], V: t.dims[2] };
  };
}

self.onmessage = async ({ data }) => {
  try {
    const t0 = performance.now();
    if (data.type === 'align') {
      const m = await session('en-conformer-ctc-small', '下载对齐模型', 0, 0.02);
      const vocab = new Map(m.tokens.map((t, i) => [t, i]));
      const result = await LTEngine.align({ samples: data.samples, sentences: data.sentences, model: { run: ctcModel(m) }, vocab, blankId: m.tokens.length - 1, onProgress: progress, options: data.options || {} });
      self.postMessage({ type: 'done', result, seconds: (performance.now() - t0) / 1000 });
    } else if (data.type === 'transcribe') {
      const asr = await session('en-parakeet-ctc-110m', '下载识别模型', 0, 0.25);
      const voice = data.speakers === false ? null : await session('speaker-campplus-en', '下载说话人模型', 0.25, 0.3);
      const result = await LTTranscribe.transcribe({ samples: data.samples, model: { run: ctcModel(asr) }, tokens: asr.tokens, blankId: asr.tokens.length - 1, subsampling: 8, onProgress: (f, l) => progress(0.3 + 0.55 * f, l) });
      if (voice && result.sentences.length) {
        const name = voice.s.inputNames[0], outName = voice.s.outputNames.at(-1);
        const model = { async run(x, T) { const o = await voice.s.run({ [name]: new ort.Tensor('float32', x, [1, T, 80]) }); return o[outName].data; } };
        const d = await LTSpeakers.diarize({ samples: data.samples, spans: result.sentences, model, onProgress: (f, l) => progress(0.85 + 0.14 * f, l) });
        result.sentences.forEach((s, i) => { s.speaker = d.labels[i]; });
        result.speakers = d.speakers;
      } else result.speakers = 1;
      progress(1, '完成');
      self.postMessage({ type: 'done', result, seconds: (performance.now() - t0) / 1000 });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: e && e.message || String(e) });
  }
};
