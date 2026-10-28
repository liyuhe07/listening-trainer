const test = require('node:test'), assert = require('node:assert');
const I = require('../app/itn.js');
const t = s => I.normalize(s).text;
test('money, time, dates, years, percentages', () => {
  assert.equal(t("It's thirty five pounds."), "It's £35.");
  assert.equal(t('That will be twelve pounds fifty, please.'), 'That will be £12.50, please.');
  assert.equal(t('It costs fifty pence.'), 'It costs 50p.');
  assert.equal(t('It cost one hundred fifty euros.'), 'It cost 150 euros.');
  assert.equal(t('Starts at ten am on the seventeenth of March.'), 'Starts at 10 a.m. on the 17th of March.');
  assert.equal(t('Meet at nine thirty am.'), 'Meet at 9.30 a.m.');
  assert.equal(t('The coach leaves at eleven thirty.'), 'The coach leaves at 11.30.');
  assert.equal(t('Built in nineteen eighty five, rebuilt in twenty twenty two.'), 'Built in 1985, rebuilt in 2022.');
  assert.equal(t('About fifty percent agreed; prices rose three per cent.'), 'About 50% agreed; prices rose 3%.');
  assert.equal(t('In the twenty first century.'), 'In the 21st century.');
});
test('phone numbers and codes', () => {
  assert.equal(t('It is oh seven nine four six, three one eight, two oh five.'), 'It is 07946 318 205.');
  assert.equal(t('Call double oh four four seven seven one two.'), 'Call 00447712.');
});
test('small numbers and ordinary words stay as words', () => {
  assert.equal(t('We need two volunteers, one of them said so.'), 'We need two volunteers, one of them said so.');
  assert.equal(t('There were hundreds of them, one by one.'), 'There were hundreds of them, one by one.');
  assert.equal(t('About a hundred people came.'), 'About a hundred people came.');
  assert.equal(t('It lasts forty five minutes and is fifteen kilometres away.'), 'It lasts 45 minutes and is 15 kilometres away.');
});
test('British spelling and change positions', () => {
  const r = I.normalize('We emphasize good behavior in the program. Is it okay?');
  assert.equal(r.text, 'We emphasise good behaviour in the programme. Is it OK?');
  for (const c of r.changes) assert.equal(r.text.slice(c.start, c.end), c.to);
  assert.equal(I.normalize('Check the size and prize.').text, 'Check the size and prize.');
  assert.equal(I.normalize('We emphasize it.', { british: false }).text, 'We emphasize it.');
});
