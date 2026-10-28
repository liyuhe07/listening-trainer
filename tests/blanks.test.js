const test = require('node:test'), assert = require('node:assert'), fs = require('fs');
const B = require('../app/blanks.js'), S = require('../app/section.js'), T = require('../app/transcript.js');
const core = new Set(JSON.parse(fs.readFileSync(__dirname + '/../data/wordlist.json')).words);
test('automatic blanks are literal, whole-word and within limits', () => {
  const parsed = T.parse(fs.readFileSync(__dirname + '/../samples/dialogue.txt', 'utf8') + '\n' + fs.readFileSync(__dirname + '/../samples/lecture.txt', 'utf8'));
  const sec = S.autoBlanks(S.buildSection({ id: 'test', title: 't', parsed }), core, 12);
  const all = sec.sentences.flatMap(q => q.blanks.map(b => ({ q, b })));
  assert.ok(all.length > 0 && all.length <= 12);
  for (const { q, b } of all) { assert.ok(B.validBlank(q.text, b), b.answer); assert.equal(q.text.slice(b.start, b.end), b.answer); }
  for (const q of sec.sentences) assert.ok(q.blanks.length <= 3);
  assert.deepEqual(S.validate(sec), []);
});
test('phone numbers are one blank', () => {
  const c = B.candidates("Yes, it's 07946 318 205.", core);
  assert.equal("Yes, it's 07946 318 205.".slice(c[0].a, c[0].b), '07946 318 205');
});
test('validBlank rejects partial words', () => {
  assert.ok(!B.validBlank('swimming cap', { start: 0, end: 4, answer: 'swim' }));
  assert.ok(B.validBlank('swimming cap', { start: 0, end: 8, answer: 'swimming' }));
});
