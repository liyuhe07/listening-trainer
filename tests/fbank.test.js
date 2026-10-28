const test = require('node:test'), assert = require('node:assert'), fs = require('fs');
const { fbank } = require('../app/align/fbank.js'), { hasFfmpeg, decode } = require('./helpers.js');
test('filterbank matches kaldi-native-fbank', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, () => {
  const ref = JSON.parse(fs.readFileSync(__dirname + '/fixtures/fbank-reference.json'));
  const x = decode(__dirname + '/../samples/lecture.mp3').subarray(0, 48000), f = fbank(x);
  assert.equal(f.frames, ref.frames);
  let max = 0; for (const [i, row] of Object.entries(ref.rows)) row.forEach((v, c) => { max = Math.max(max, Math.abs(v - f.data[Number(i) * 80 + c])); });
  assert.ok(max < 0.01, 'max difference ' + max);
});
