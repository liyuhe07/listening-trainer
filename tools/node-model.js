// Loads the speech models with onnxruntime-node, exposing the same interfaces the browser worker uses.
const fs = require('fs'), path = require('path');
const ort = require('onnxruntime-node');
const MODELS = path.join(__dirname, '..', 'models');

function modelBytes(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(MODELS, dir, 'manifest.json')));
  return Buffer.concat(m.parts.map(p => fs.readFileSync(path.join(MODELS, dir, p.file))));
}
async function loadCtc(dir) {
  const session = await ort.InferenceSession.create(modelBytes(dir), { intraOpNumThreads: 2 });
  const tokens = fs.readFileSync(path.join(MODELS, dir, 'tokens.txt'), 'utf8').trim().split('\n').map(l => l.split(' ')[0]);
  return {
    tokens, vocab: new Map(tokens.map((t, i) => [t, i])), blankId: tokens.length - 1,
    async run(feats, L) {
      const out = await session.run({ audio_signal: new ort.Tensor('float32', feats, [1, 80, L]), length: new ort.Tensor('int64', BigInt64Array.from([BigInt(L)]), [1]) });
      const t = out[session.outputNames[0]];
      return { data: t.data, rows: t.dims[1], V: t.dims[2] };
    }
  };
}
/** The alignment model (default) — kept for the existing callers. */
const loadModel = () => loadCtc('en-conformer-ctc-small');
const loadAsr = () => loadCtc('en-parakeet-ctc-110m');
async function loadSpeaker() {
  const s = await ort.InferenceSession.create(modelBytes('speaker-campplus-en'), { intraOpNumThreads: 2 });
  const input = s.inputNames[0], output = s.outputNames.at(-1);
  return { async run(x, T) { const o = await s.run({ [input]: new ort.Tensor('float32', x, [1, T, 80]) }); return o[output].data; } };
}
module.exports = { loadModel, loadAsr, loadSpeaker, loadCtc };
