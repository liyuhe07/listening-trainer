const test = require('node:test'), assert = require('node:assert');
const P = require('../app/proofread.js');
const dict = new Set('good morning what can i do for you want to report a theft my name is now turn part one it costs the hello had some things stolen out of bag yesterday sorry hear that right so ill need take few details start with your'.split(' '));
const s = (text, speaker, uncertain = []) => ({ text, speaker, start: 0, end: 1, paragraph: 0, uncertain });
test('instructions and the replayed example are suggested for deletion', () => {
  const dialogue = [['Good morning.', 0], ['What can I do for you?', 0], ['I want to report a theft.', 1], ['I had some things stolen out of my bag yesterday.', 1], ["I'm sorry to hear that.", 0]];
  const res = { speakers: 3, sentences: [s('CD one, Test two.', 2), s('Now turn to part one.', 2), s('You will hear a woman reporting a theft.', 2), ...dialogue.map(([t, k]) => s(t, k)), s('Her name is Louise.', 2), s('So Louise has been written in the space.', 2), s('Now we shall begin.', 2), ...dialogue.map(([t, k]) => s(t, k)), s('My name is Hartley, a thfet.', 1, ['thfet']), s('It costs thirty five pounds.', 0)] };
  const p = P.prepare(res, { dict });
  assert.deepEqual(p.rows.map(r => r.keep), [false, false, false, false, false, false, false, false, false, false, false, true, true, true, true, true, true, true]);
  assert.equal(p.rows[3].why, 'repeat'); assert.equal(p.rows[0].why, 'instruction'); assert.equal(p.rows[8].why, 'instruction');
  const row = p.rows[16];
  assert.deepEqual(row.check.map(c => [row.text.slice(c.start, c.end), c.why]), [['Hartley', 'name'], ['thfet', 'low']]);
  assert.equal(p.rows[17].text, 'It costs £35.');
  P.revert(p.rows[17], 0); assert.equal(p.rows[17].text, 'It costs thirty five pounds.');
  const built = P.build(p.rows, { 0: 'MAN', 1: 'WOMAN' });
  assert.equal(built.sentences.length, 7); assert.deepEqual(built.speakers, ['MAN', 'WOMAN']);
  assert.equal(built.sentences[2].speaker + ': ' + built.sentences[2].text, 'WOMAN: I want to report a theft.');
});
