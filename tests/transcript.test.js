const test = require('node:test'), assert = require('node:assert');
const T = require('../app/transcript.js');
test('speakers, paragraphs and sentence splitting', () => {
  const r = T.parse('SECTION 1\nMAN: Good morning. How can I help?\nWOMAN: Hi. I saw Mr. Smith at 9 a.m. on\nMonday. It costs £3.50, doesn\'t it?\n\nPart 2\nToday we look at self-\nregulation. Is it useful? Yes.');
  assert.deepEqual(r.speakers, ['MAN', 'WOMAN']);
  assert.deepEqual(r.sentences.map(q => q.text), ['Good morning.', 'How can I help?', 'Hi.', 'I saw Mr. Smith at 9 a.m. on Monday.', "It costs £3.50, doesn't it?", 'Today we look at selfregulation.', 'Is it useful?', 'Yes.']);
  assert.equal(r.sentences[0].speaker, 'MAN'); assert.equal(r.sentences[5].speaker, '');
  assert.notEqual(r.sentences[4].paragraph, r.sentences[5].paragraph);
});
test('long dialogues are split into readable paragraphs', () => {
  const text = Array.from({ length: 30 }, (_, i) => `${i % 2 ? 'A' : 'B'}: Line ${i}. More ${i}.`).join('\n');
  const r = T.parse(text), sizes = {};
  for (const q of r.sentences) sizes[q.paragraph] = (sizes[q.paragraph] || 0) + 1;
  assert.ok(Object.values(sizes).every(n => n <= 10));
});
