// Aligns the synthetic samples and checks every speaker turn against where it really is in the recording.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs');
const { hasFfmpeg, hasOrt, decode } = require('./helpers.js');
const T = require('../app/transcript.js'), E = require('../app/align/engine.js'), X = require('../app/align/text.js'), K = require('../app/align/ctc.js');
const skip = (!hasFfmpeg() && 'ffmpeg not installed') || (!hasOrt() && 'run npm install first');
test('tokenizer reproduces the model vocabulary segmentation', () => {
  const vocab = new Map(fs.readFileSync(__dirname + '/../models/en-conformer-ctc-small/tokens.txt', 'utf8').trim().split('\n').map(l => l.split(' ')).map(([t, i]) => [t, Number(i)]));
  const tok = w => K.tokenize(w, vocab).map(i => [...vocab].find(([, v]) => v === i)[0]).join(' ');
  assert.equal(tok('hello'), '▁he ll o'); assert.equal(tok('theory'), '▁the or y');
  assert.deepEqual(X.words(['It costs £62, OK?']).map(w => w.text), ['it', 'costs', null, 'okay']);
});
for (const name of ['dialogue', 'lecture']) {
  test(`alignment of samples/${name}.mp3`, { skip, timeout: 180000 }, async () => {
    const { loadModel } = require('../tools/node-model.js'), model = await loadModel();
    const parsed = T.parse(fs.readFileSync(`${__dirname}/../samples/${name}.txt`, 'utf8')), truth = JSON.parse(fs.readFileSync(`${__dirname}/fixtures/${name}.truth.json`));
    const res = await E.align({ samples: decode(`${__dirname}/../samples/${name}.mp3`), sentences: parsed.sentences.map(q => q.text), model, vocab: model.vocab, blankId: model.blankId });
    for (const turn of truth) {
      const i = parsed.sentences.findIndex(q => turn.text.startsWith(q.text)), got = res.sentences[i];
      assert.ok(got, turn.text);
      assert.ok(Math.abs(got.start - turn.start) < 0.7, `${turn.text.slice(0, 30)}: start ${got.start} vs ${turn.start}`);
    }
    for (let i = 1; i < res.sentences.length; i++) assert.ok(res.sentences[i].start >= res.sentences[i - 1].end - 1e-6, 'sentences overlap');
  });
}
