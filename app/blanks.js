/*
 * Automatic dictation blanks (offline, rule based).
 *
 * Aims at what is worth writing down in a listening test: phrases ("birds and insects", "conservation group"),
 * long or less common words, words with spelling traps, names and numbers. Very common short words are never
 * chosen. At most `perSentence` blanks per sentence and `perSection` per section, spread over the whole text.
 * Every blank is a literal span of its sentence: {start, end, answer, type, analysis} with UTF-16 offsets.
 */
(function (root) {
  'use strict';
  const STOP = new Set(('a an the and or but if so as of at by for from in into on onto to with without about above after against along among around before behind below beneath beside between beyond during except inside near off out outside over past since through throughout till toward towards under until up upon via within ' +
    'i me my mine we us our ours you your yours he him his she her hers it its they them their theirs this that these those who whom whose which what when where why how there here ' +
    'am is are was were be been being have has had having do does did doing done can could will would shall should may might must ought ' +
    'not no nor yes yeah oh ok okay well just very really quite too also only even still then than now ever never always often sometimes much many more most some any all each every both either neither few little lot lots ' +
    "one two three four five six seven eight nine ten first second next last other another such same own sure right good great fine thanks thank please sorry hello hi bye mm mmm er erm um uh " +
    "i'm i've i'd i'll you're you've you'd you'll he's she's it's we're we've we'd we'll they're they've they'd they'll that's there's here's what's who's don't doesn't didn't isn't aren't wasn't weren't can't couldn't won't wouldn't shouldn't haven't hasn't hadn't let's " +
    'myself yourself himself herself itself ourselves yourselves themselves whether though although because while unless however therefore probably certainly totally exactly clearly necessarily greatly actually basically usually especially particularly perhaps maybe almost already quite rather instead anyway otherwise ' +
    'get got go goes going went gone come came make made take took say said says tell told know knew think thought see saw look want like need thing things way kind sort bit something anything nothing everything someone anyone people person time year years day days').split(/\s+/));
  const LINKS = new Set(['and', 'or', 'of']);
  const NUMWORD = /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|half|quarter)(-[a-z]+)?$/;
  const TRAPS = [[/([bcdfgklmnprstz])\1/, '双写辅音'], [/ie|ei/, 'ie / ei 顺序'], [/(ance|ence|ant|ent)s?$/, '-ance / -ence 词尾'], [/(able|ible)$/, '-able / -ible 词尾'], [/ough|augh/, 'ough / augh 拼写'], [/^(kn|wr|gn|ps)|mb$|mn$|gh[^aeiou]/, '不发音字母'], [/(tion|sion|cian|ssion)s?$/, '-tion / -sion 词尾'], [/(ise|ize|yse|yze)(d|s)?$/, '-ise / -ize 词尾']];

  function lemmaForms(w) {
    return [w, w.replace(/'s$/, ''), w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y'), w.replace(/ing$/, ''), w.replace(/ing$/, 'e'), w.replace(/ed$/, ''), w.replace(/ed$/, 'e'), w.replace(/ied$/, 'y'), w.replace(/([a-z])\1(?:ing|ed)$/, '$1'), w.replace(/ly$/, ''), w.replace(/ily$/, 'y'), w.replace(/er$/, ''), w.replace(/est$/, '')];
  }
  const isCore = (w, core) => lemmaForms(w).some(f => core.has(f));

  /** Words of a sentence with offsets: [{a, b, raw, w (lowercase), capital, number}] */
  function tokens(text) {
    const out = [], re = /[A-Za-z0-9£$€][A-Za-z0-9'’.,:£$€%-]*[A-Za-z0-9%]|[A-Za-z0-9]/g; let m;
    while ((m = re.exec(text))) {
      let raw = m[0], a = m.index;
      raw = raw.replace(/[.,:]+$/, '');
      const w = raw.toLowerCase().replace(/’/g, "'");
      out.push({ a, b: a + raw.length, raw, w, capital: /^[A-Z][a-z]/.test(raw), number: /\d/.test(raw) || NUMWORD.test(w) });
    }
    return out;
  }

  function wordScore(t, core, first) {
    if (t.number) return /\d/.test(t.raw) && t.raw.length >= 2 ? { score: 2.2, type: '数字与拼写', why: '数字、时间或金额，注意写法' } : null;
    if (STOP.has(t.w) || t.w.length < 4) return null;
    if (t.capital && !first) return { score: 2.6 + Math.min(1.5, (t.w.length - 5) * .3), type: '专有名词', why: '人名、地名或机构名，按原文拼写' };
    let score = 0; const why = [];
    const common = isCore(t.w, core);
    if (!common) { score += 3; why.push('不在常用词表（NGSL/NAWL/TSL）中'); }
    if (t.w.length >= 8) { score += Math.min(3, (t.w.length - 7) * .7); why.push(`${t.w.length} 个字母的长词`); }
    for (const [re, label] of TRAPS) if (re.test(t.w)) { score += .8; why.push('拼写点：' + label); break; }
    if (common && t.w.length < 7) score -= 1.5;
    return score > 0 ? { score, type: common ? (why.some(x => x.startsWith('拼写点')) ? '易混易错' : '重点词汇') : '重点词汇', why: why.join('；') } : null;
  }

  /** Candidate spans for one sentence, best first. */
  function candidates(text, core) {
    const ts = tokens(text), out = [];
    const first = i => i === 0 || /^["“‘(]/.test(text.slice(0, ts[i].a).trim().slice(-1));
    const single = ts.map((t, i) => wordScore(t, core, first(i)));
    single.forEach((s, i) => { if (s) out.push({ a: ts[i].a, b: ts[i].b, score: s.score, type: s.type, analysis: s.why, words: 1 }); });
    // A run of digit groups ("07946 318 205", "9 30") is one answer, not several.
    for (let i = 0; i < ts.length; i++) {
      if (!/\d/.test(ts[i].raw)) continue; let j = i;
      while (ts[j + 1] && /^\d/.test(ts[j + 1].raw) && /^ $/.test(text.slice(ts[j].b, ts[j + 1].a))) j++;
      if (j > i) { for (const c of out) if (c.a >= ts[i].a && c.b <= ts[j].b) c.score = -1; out.push({ a: ts[i].a, b: ts[j].b, score: 3, type: '数字与拼写', analysis: '整串数字（电话、编号等），注意分组和读法', words: j - i + 1 }); i = j; }
    }
    const content = i => ts[i] && !ts[i].number && !STOP.has(ts[i].w) && ts[i].w.length >= 3;
    for (let i = 0; i < ts.length; i++) {
      // X and Y / X of Y: "birds and insects", "lack of funding"
      const ing = k => /ing$/.test(ts[k].w);
      if (content(i) && ts[i + 1] && LINKS.has(ts[i + 1].w) && content(i + 2) && text.slice(ts[i].b, ts[i + 2].a).trim() === ts[i + 1].raw && ing(i) === ing(i + 2) && !(ts[i + 1].w === 'of' && ing(i + 2))) {
        const s = (single[i]?.score || .8) + (single[i + 2]?.score || .8) + 1.2;
        out.push({ a: ts[i].a, b: ts[i + 2].b, score: s, type: '名词短语', analysis: `并列/修饰短语，整体听写（${ts[i + 1].w} 连接两个实词）`, words: 3 });
      }
      // Two or three content words in a row: "conservation group", "public transport system"
      if (content(i) && content(i + 1) && /^\s+$/.test(text.slice(ts[i].b, ts[i + 1].a))) {
        let j = i + 1; if (content(i + 2) && /^\s+$/.test(text.slice(ts[i + 1].b, ts[i + 2].a))) j = i + 2;
        const group = ts.slice(i, j + 1), names = group.every(t => t.capital);
        if (group.some(t => t.capital) && !names) continue;
        let s = 1.4; for (let k = i; k <= j; k++) s += single[k]?.score || .6;
        out.push({ a: ts[i].a, b: ts[j].b, score: s, type: names ? '专有名词' : '短语搭配', analysis: names ? '专有名称，按原文拼写' : '连续实词构成的短语，整体听写', words: j - i + 1 });
      }
    }
    return out.filter(c => c.score > 0).sort((x, y) => y.score - x.score);
  }

  /**
   * sentences: [{text}]; core: Set of common words. Returns array (parallel to sentences) of blank arrays.
   */
  /** avoid: Set of lowercase words that must not be part of a blank (e.g. words recognition was unsure about). */
  function select(sentences, core, { perSection = 50, perSentence = 3, maxRepeat = 2, avoid = null } = {}) {
    const bad = c => avoid && avoid.size && (c.text.toLowerCase().match(/[a-z']+/g) || []).some(w => avoid.has(w));
    const cands = sentences.map(q => candidates(q.text, core).filter(c => !bad({ text: q.text.slice(c.a, c.b) })));
    const chosen = sentences.map(() => []), used = new Map();
    const overlaps = (list, c) => list.some(x => c.a < x.b + 1 && x.a < c.b + 1);
    const answerOf = (i, c) => sentences[i].text.slice(c.a, c.b);
    const take = (i, c) => { chosen[i].push(c); const k = answerOf(i, c).toLowerCase(); used.set(k, (used.get(k) || 0) + 1); };
    const budget = Math.min(perSection, Math.max(1, Math.round(sentences.reduce((n, q) => n + q.text.split(/\s+/).length, 0) / 9)));
    // Pass 1: the best candidate of each sentence, best sentences first. Pass 2: second and third picks.
    for (let pass = 0; pass < perSentence; pass++) {
      const pool = [];
      cands.forEach((list, i) => { const c = list.find(c => !overlaps(chosen[i], c) && (used.get(answerOf(i, c).toLowerCase()) || 0) < maxRepeat); if (c && c.score >= (pass ? 3.2 : 2)) pool.push([i, c]); });
      pool.sort((x, y) => y[1].score - x[1].score);
      for (const [i, c] of pool) { if (chosen.flat().length >= budget) break; if (!overlaps(chosen[i], c)) take(i, c); }
    }
    return chosen.map((list, i) => list.sort((x, y) => x.a - y.a).map(c => ({ start: c.a, end: c.b, answer: answerOf(i, c), type: c.type, analysis: c.analysis })));
  }

  /** Checks that a blank is a whole-word literal span of the text. */
  function validBlank(text, b) {
    if (!b || !Number.isInteger(b.start) || !Number.isInteger(b.end) || b.start < 0 || b.end <= b.start || b.end > text.length) return false;
    if (text.slice(b.start, b.end) !== b.answer || b.answer.trim() !== b.answer) return false;
    const before = text[b.start - 1] || ' ', after = text[b.end] || ' ';
    return !/[A-Za-z0-9'’]/.test(before) && !/[A-Za-z0-9]/.test(after);
  }
  /** Finds the n-th whole-word occurrence of `answer` in text. */
  function locate(text, answer, occurrence = 1) {
    let found = 0, at = text.indexOf(answer);
    while (at >= 0) { if (validBlank(text, { start: at, end: at + answer.length, answer })) { if (++found === occurrence) return { start: at, end: at + answer.length }; } at = text.indexOf(answer, at + 1); }
    return null;
  }

  const api = { select, candidates, tokens, validBlank, locate, STOP };
  root.LTBlanks = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
