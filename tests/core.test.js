const test = require('node:test'), assert = require('node:assert');
const C = require('../app/core.js');
test('grading accepts spelling variants, numbers and times', () => {
  assert.ok(C.gradeAnswer('Colour', 'color'));
  assert.ok(C.gradeAnswer('£62', '62'));
  assert.ok(C.gradeAnswer('sixty two', '62'));
  assert.ok(C.gradeAnswer('7.15', '7:15'));
  assert.ok(C.gradeAnswer('7:15', '715'));
  assert.ok(C.gradeAnswer('birds and insects', 'birds, and insects'));
  assert.ok(!C.gradeAnswer('bird and insect', 'birds and insects'));
  assert.ok(!C.gradeAnswer('', 'x'));
});
test('answer diff shows letters', () => {
  const d = C.answerDiff('questionaire', 'questionnaire');
  assert.equal(d.mode, 'letters'); assert.ok(d.ops.some(o => o.type === 'missing' && o.text === 'n'));
  assert.equal(C.answerDiff('', 'x').mode, 'missing');
});
test('review schedule retires after two correct answers', () => {
  let r = C.scheduleReview(null, false, 0); assert.equal(r.step, 0);
  r = C.scheduleReview(r, true, 0); r = C.scheduleReview(r, true, 0); assert.ok(r.retired);
});
test('blind context finds the sentence at the playhead', () => {
  const s = [{ sentenceId: 'a-1' }, { sentenceId: 'a-2' }, { sentenceId: 'a-3' }], t = [{ start: 1, end: 2 }, { start: 2.5, end: 4 }, { start: 4, end: 6 }];
  assert.deepEqual(C.blindContext(s, t, 2.2), { index: 0, ids: ['a-1', 'a-2'] });
  assert.equal(C.blindContext(s, t, 0.5).index, -1);
  assert.ok(C.timelineReady(t)); assert.ok(!C.timelineReady([t[1], t[0]]));
});
test('clearing a section removes only its records', () => {
  const st = { attempts: { 'x-001-1-3': {}, 'y-001-1-3': {} }, errors: { 'x-001-1-3': { sectionId: 'x' } }, stars: { 'x-001': 1 }, trouble: {}, replays: {}, vocabulary: { k: { sectionId: 'x' } }, blind: { x: {} }, completed: {}, speeds: {}, logs: [{ sectionId: 'x' }, { sectionId: 'y' }] };
  C.clearSectionPractice(st, 'x', true);
  assert.deepEqual(Object.keys(st.attempts), ['y-001-1-3']); assert.ok(st.stars['x-001']); assert.ok(st.vocabulary.k); assert.equal(st.logs.length, 1);
  C.clearSectionPractice(st, 'x'); assert.ok(!st.stars['x-001']); assert.ok(!st.vocabulary.k);
});
