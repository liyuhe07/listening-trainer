// Audio-only path on the synthetic sample dialogue: transcription quality and who-speaks-when.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs');
const { hasFfmpeg, hasOrt, decode } = require('./helpers.js');
const skip = (!hasFfmpeg() && 'ffmpeg not installed') || (!hasOrt() && 'run npm install first');
const words = t => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
function wer(ref, hyp) { const d = Array.from({ length: hyp.length + 1 }, (_, j) => j); for (let i = 1; i <= ref.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= hyp.length; j++) { const tmp = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (ref[i - 1] !== hyp[j - 1])); prev = tmp; } } return d[hyp.length] / ref.length; }
test('transcribes the sample lecture', { skip, timeout: 300000 }, async () => {
  const { loadAsr } = require('../tools/node-model.js'), X = require('../app/align/transcribe.js'), I = require('../app/itn.js');
  const asr = await loadAsr();
  const r = await X.transcribe({ samples: decode(__dirname + '/../samples/lecture.mp3'), model: asr, tokens: asr.tokens, blankId: asr.blankId });
  const text = r.sentences.map(s => I.normalize(s.text).text).join(' '), ref = fs.readFileSync(__dirname + '/../samples/lecture.txt', 'utf8');
  const H = words(text), R = words(ref), start = H.indexOf('today');
  const e = wer(R, H.slice(start));
  assert.ok(e < 0.08, 'word error rate ' + e.toFixed(3));
  assert.ok(r.sentences.every(s => s.end > s.start));
});
test('tells the two sample voices apart', { skip, timeout: 300000 }, async () => {
  const { loadSpeaker } = require('../tools/node-model.js'), S = require('../app/align/speakers.js');
  const truth = JSON.parse(fs.readFileSync(__dirname + '/fixtures/dialogue.truth.json')), spk = await loadSpeaker();
  const voice = ['MAN', 'WOMAN', 'MAN', 'WOMAN', 'MAN', 'WOMAN', 'MAN', 'WOMAN', 'MAN', 'WOMAN', 'MAN', 'WOMAN', 'MAN', 'WOMAN', 'MAN'];
  const d = await S.diarize({ samples: decode(__dirname + '/../samples/dialogue.mp3'), spans: truth, model: spk });
  assert.equal(d.speakers, 2);
  const map = {}; d.labels.forEach((l, i) => { (map[l] ||= {})[voice[i]] = (map[l][voice[i]] || 0) + 1; });
  const correct = Object.values(map).reduce((n, m) => n + Math.max(...Object.values(m)), 0);
  assert.ok(correct / voice.length >= 0.9, `${correct}/${voice.length}`);
});
