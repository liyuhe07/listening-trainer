const test = require('node:test'), assert = require('node:assert'), fs = require('fs');
const P = require('../app/pack.js'), S = require('../app/section.js');
test('content pack round trip', async () => {
  const sec = { id: 'abc', title: 'T', collection: 'C', sentences: [{ sentenceId: 'abc-001', text: 'Hi there.', blanks: [] }], timings: { 'abc-001': { start: 1, end: 2 } }, peaks: new Uint8Array([1, 2]) };
  const blob = await P.exportPack([{ section: sec, audio: { blob: new Blob([new Uint8Array([9, 8, 7])]), name: 'a.m4a', type: 'audio/mp4' } }]);
  const [item] = await P.importPack(blob);
  assert.equal(item.section.title, 'T'); assert.ok(!('peaks' in item.section)); assert.equal(item.audio.type, 'audio/mp4');
  assert.deepEqual([...new Uint8Array(await item.audio.blob.arrayBuffer())], [9, 8, 7]);
});
test('the bundled sample pack is valid', async () => {
  const items = await P.importPack(new Blob([fs.readFileSync(__dirname + '/../samples/sample-pack.zip')]));
  assert.equal(items.length, 2);
  for (const { section, audio } of items) { assert.deepEqual(S.validate(section), []); assert.ok(audio.blob.size > 100000); }
});
test('renaming a section rewrites every id', () => {
  const sec = { id: 'a', title: 't', sentences: [{ sentenceId: 'a-001', paragraphId: 'a-p0', text: 'Hello world', blanks: [{ id: 'a-001-6-11', start: 6, end: 11, answer: 'world' }] }], timings: { 'a-001': { start: 0, end: 1 } } };
  const b = S.withNewId(sec, 'b');
  assert.equal(b.sentences[0].sentenceId, 'b-001'); assert.equal(b.sentences[0].blanks[0].id, 'b-001-6-11'); assert.ok(b.timings['b-001']);
  assert.deepEqual(S.validate(b), []);
});
