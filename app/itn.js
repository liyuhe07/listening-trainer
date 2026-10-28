/*
 * Clean-up of automatically recognised text, in the style of printed exam transcripts:
 *   - numbers back to digits where a transcript would print them ("thirty five pounds" -> "£35",
 *     "ten am" -> "10 a.m.", "nineteen eighty five" -> "1985", "the seventeenth of March" -> "the 17th of March",
 *     "oh seven nine four six three one eight" -> "07946 318"); small numbers in running text stay as words;
 *   - optional British spelling ("emphasize" -> "emphasise", "behavior" -> "behaviour").
 * Every change is reported with its position in the new text, so the page can highlight it for checking.
 */
(function (root) {
  'use strict';
  const UNITS = { zero: 0, oh: 0, nought: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const SCALES = { hundred: 100, thousand: 1000, million: 1e6, billion: 1e9 };
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
  const MONTHS = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i;
  const MONEY = { pound: '£', pounds: '£', quid: '£', dollar: '$', dollars: '$' };
  const TIME_BEFORE = /^(at|from|until|till|by|around|about|before|after|since|between|and|to)$/;
  const UNIT_WORDS = /^(percent|per|km|kilometres?|kilometers?|metres?|meters?|miles?|kilos?|kilograms?|grams?|litres?|liters?|centimetres?|centimeters?|cm|mm|millimetres?|square|cubic|degrees?|mph|hectares?|acres?|kg|ml|tonnes?|tons?|feet|foot|inches?|yards?|percentage)$/i;
  const isNumWord = w => w in UNITS || w in TENS || w in SCALES || w in ORD || /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)$/.test(w);
  const ordValue = w => { if (w in ORD) return ORD[w]; const m = w.match(/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-?(\w+)$/); return m && m[2] in ORD ? TENS[m[1]] + ORD[m[2]] : null; };
  const suffix = n => (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');

  /** Value of a list of cardinal number words, or null. */
  function cardinal(ws) {
    let total = 0, group = 0, seen = false, last = null;
    for (const w of ws) {
      if (w === 'and') { if (!seen) return null; continue; }
      if (w === 'a') { if (seen) return null; group = 1; last = 'a'; continue; }
      if (w in UNITS && w !== 'oh' && w !== 'nought') { if (last in UNITS || last in TENS && UNITS[w] >= 10 || last in TENS && UNITS[w] === 0) return null; group += UNITS[w]; }
      else if (w in TENS) { if (last in UNITS || last in TENS) return null; group += TENS[w]; }
      else if (w === 'hundred') { if (group >= 100 || last === 'hundred') return null; group = (group || 1) * 100; }
      else if (w in SCALES) { total += (group || 1) * SCALES[w]; group = 0; }
      else return null;
      seen = true; last = w;
    }
    return seen ? total + group : null;
  }
  /** "nineteen eighty five" -> 1985, "twenty twenty two" -> 2022, "nineteen oh five" -> 1905 */
  function year(ws) {
    if (ws.length < 2 || !(ws[0] in UNITS || ws[0] === 'twenty')) return null;
    const head = ws[0] === 'twenty' ? 20 : UNITS[ws[0]]; if (head < 15 || head > 20) return null;
    const rest = ws.slice(1);
    if (rest[0] === 'oh' && rest.length === 2 && UNITS[rest[1]] >= 1 && UNITS[rest[1]] <= 9) return head * 100 + UNITS[rest[1]];
    if (rest[0] === 'hundred' && rest.length === 1) return head * 100;
    const tail = cardinal(rest); if (tail === null || tail < 10 || tail > 99) return null;
    return head * 100 + tail;
  }
  /** Phone numbers and codes: a run of single digits ("oh seven double nine ..."). */
  function digits(ws, min = 4) {
    let out = '';
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if ((w === 'double' || w === 'triple') && ws[i + 1] in UNITS && UNITS[ws[i + 1]] <= 9) { out += String(UNITS[ws[i + 1]]).repeat(w === 'double' ? 2 : 3); i++; continue; }
      if (w in UNITS && UNITS[w] <= 9) { out += UNITS[w]; continue; }
      return null;
    }
    return out.length >= min ? out : null;
  }

  // British spellings for words automatic recognition writes the American way.
  const UK = { color: 'colour', colors: 'colours', colorful: 'colourful', favor: 'favour', favorite: 'favourite', favorites: 'favourites', behavior: 'behaviour', behaviors: 'behaviours', behavioral: 'behavioural', neighbor: 'neighbour', neighbors: 'neighbours', neighborhood: 'neighbourhood', neighborhoods: 'neighbourhoods', honor: 'honour', humor: 'humour', labor: 'labour', flavor: 'flavour', flavors: 'flavours', harbor: 'harbour', rumor: 'rumour', vapor: 'vapour', endeavor: 'endeavour', center: 'centre', centers: 'centres', centered: 'centred', theater: 'theatre', theaters: 'theatres', meter: 'metre', meters: 'metres', kilometer: 'kilometre', kilometers: 'kilometres', centimeter: 'centimetre', centimeters: 'centimetres', liter: 'litre', liters: 'litres', fiber: 'fibre', program: 'programme', programs: 'programmes', analyze: 'analyse', analyzed: 'analysed', analyzing: 'analysing', paralyze: 'paralyse', catalog: 'catalogue', dialog: 'dialogue', gray: 'grey', jewelry: 'jewellery', defense: 'defence', offense: 'offence', enrollment: 'enrolment', fulfill: 'fulfil', aluminum: 'aluminium', mom: 'mum', traveled: 'travelled', traveling: 'travelling', traveler: 'traveller', travelers: 'travellers', canceled: 'cancelled', canceling: 'cancelling', labeled: 'labelled', labeling: 'labelling', modeled: 'modelled', modeling: 'modelling', fueled: 'fuelled', leveled: 'levelled', signaled: 'signalled', counselor: 'counsellor', jeweler: 'jeweller', pajamas: 'pyjamas', okay: 'OK', skeptical: 'sceptical', mold: 'mould', plow: 'plough', cozy: 'cosy', donut: 'doughnut', artifact: 'artefact', artifacts: 'artefacts', aging: 'ageing', judgment: 'judgement', fertilizer: 'fertiliser', fertilizers: 'fertilisers' };
  const IZE_KEEP = new Set(['size', 'sizes', 'sized', 'prize', 'prizes', 'seize', 'seized', 'capsize', 'citizen', 'citizens', 'baize', 'maize', 'downsize', 'downsized']);
  function british(word, dict) {
    const lower = word.toLowerCase(); let uk = UK[lower];
    if (!uk && !IZE_KEEP.has(lower)) { const m = lower.match(/^(.+)(iz|yz)(e|es|ed|ing|ation|ations|er|ers)$/); if (m) { const cand = m[1] + (m[2] === 'iz' ? 'is' : 'ys') + m[3]; if (!dict || dict.has(cand)) uk = cand; } }
    if (!uk) return null;
    if (uk === 'OK') return 'OK';
    return word[0] === word[0].toUpperCase() ? uk[0].toUpperCase() + uk.slice(1) : uk;
  }

  /**
   * text -> {text, changes: [{from, to, start, end}]} (start/end: offsets of `to` in the new text).
   * options: {british: true, dict: Set of known words (for -ise checks)}
   */
  function normalize(text, options = {}) {
    const toks = []; const re = /[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,:]\d+)*|[^A-Za-z\d]+/g; let m;
    while ((m = re.exec(text))) toks.push(m[0]);
    const isWord = t => /^[A-Za-z]/.test(t), low = t => t.toLowerCase().replace('’', "'");
    const out = []; const changes = [];
    const emit = (piece, from) => { out.push({ piece, from }); };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (!isWord(t)) { emit(t); continue; }
      const w = low(t);
      // Collect a run of number words (separated only by spaces, hyphens, or commas inside digit runs).
      if (isNumWord(w) || w === 'a' && /^(hundred|thousand|million)$/i.test(toks[i + 2] || '') && /^ $/.test(toks[i + 1] || '') || w === 'double' || w === 'triple') {
        const words = [], idx = []; let j = i;
        for (;;) {
          const cw = low(toks[j] || '');
          const ok = isNumWord(cw) || cw === 'a' && !words.length || cw === 'and' && words.length && isNumWord(low(toks[j + 2] || '')) || (cw === 'double' || cw === 'triple');
          if (!ok) break;
          // hyphenated "thirty-five" comes as one token
          for (const part of cw.split('-')) words.push(part);
          idx.push(j);
          const sep = toks[j + 1];
          if (sep === ' ' || sep === '-' || sep === ', ' && digits(words.slice(-1)) === null && (low(toks[j] || '') in UNITS)) { if (sep === ', ' && !(low(toks[j + 2] || '') in UNITS || /^(double|triple)$/.test(low(toks[j + 2] || '')))) break; j += 2; continue; }
          break;
        }
        while (words.length && (words.at(-1) === 'and' || words.at(-1) === 'a')) { words.pop(); idx.pop(); }
        if (!words.length) { emit(t); continue; }
        const last = idx.at(-1), next = low(toks[last + 2] || ''), next2 = low(toks[last + 4] || ''), prevWord = low(toks[i - 2] || ''), between = toks[last + 1] || '';
        const original = toks.slice(i, last + 1).join('');
        let rep = null, end = last;
        const ordv = ordValue(words.at(-1));
        const digitRun = digits(words.filter(w => w !== 'and'));
        const yr = year(words);
        if (ordv !== null && words.length <= 2) {
          const n = words.length === 2 ? cardinal(words.slice(0, 1)) + ordv : ordv;
          const dateish = MONTHS.test(next2) && next === 'of' || MONTHS.test(prevWord) || MONTHS.test(next) || /^(century|floor)$/.test(next) && n > 10;
          if (dateish && Number.isFinite(n)) rep = n + suffix(n);
        } else if (digitRun && words.length >= 4 && words.every(w => w in UNITS && UNITS[w] <= 9 || w === 'double' || w === 'triple')) {
          const groups = toks.slice(i, last + 1).join('').split(/,\s*/).map(g => digits(g.toLowerCase().split(/[\s-]+/).filter(Boolean), 1));
          rep = groups.every(g => g) ? groups.join(' ') : digitRun;
        } else if (yr !== null && yr >= 1100 && yr <= 2099 && !(between === ' ' && (next in MONEY || UNIT_WORDS.test(next)))) {
          rep = String(yr);
        } else {
          const n = cardinal(words);
          if (n !== null) {
            const money = between === ' ' && MONEY[next];
            if (money) {
              // "twelve pounds fifty" -> £12.50 ; "fifty pence" handled below
              let cents = null, k = last + 2;
              if (toks[k + 1] === ' ') { const after = []; let q = k + 2; while (q < toks.length && isNumWord(low(toks[q])) && after.length < 2) { after.push(low(toks[q])); if (toks[q + 1] !== ' ') { q++; break; } q += 2; } const c = cardinal(after); if (c !== null && c > 0 && c < 100 && after.length) { cents = c; k = k + 2 + (after.length - 1) * 2; } }
              rep = money + n + (cents !== null ? '.' + String(cents).padStart(2, '0') : ''); end = k;
            } else if (between === ' ' && /^(pence|p)$/.test(next)) { rep = n + 'p'; end = last + 2; }
            else if (between === ' ' && /^(percent)$/.test(next)) { rep = n + '%'; end = last + 2; }
            else if (between === ' ' && next === 'per' && next2 === 'cent') { rep = n + '%'; end = last + 4; }
            else if (between === ' ' && /^(am|pm|a\.m|p\.m)$/.test(next) && n >= 1 && n <= 12) { rep = n + (next[0] === 'a' ? ' a.m.' : ' p.m.'); end = last + 2; }
            else if (words.length === 2 && words[0] in UNITS && cardinal([words[1]]) >= 10 && between === ' ' && /^(am|pm)$/.test(next)) { rep = `${UNITS[words[0]]}.${cardinal([words[1]])} ${next[0] === 'a' ? 'a.m.' : 'p.m.'}`; end = last + 2; }
            else if (words[0] === 'a') rep = null;
            else if (n >= 11 || UNIT_WORDS.test(next) && between === ' ') rep = String(n);
          }
        }
        // "at eleven thirty" -> "at 11.30" (exam transcripts print clock times with a dot)
        if (rep === null && words.length >= 2 && words.length <= 3) {
          const h = cardinal(words.slice(0, 1)), mm = cardinal(words.slice(1));
          if (h >= 1 && h <= 12 && mm >= 10 && mm <= 59 && TIME_BEFORE.test(prevWord) && !(between === ' ' && (MONEY[next] || UNIT_WORDS.test(next) || /^(am|pm)$/.test(next)))) rep = `${h}.${mm}`;
        }
        // Times like "nine thirty am" are two cardinals: try the pair.
        if (rep === null && words.length === 2 && cardinal([words[0]]) !== null && cardinal([words[1]]) >= 10 && /^(am|pm)$/.test(next)) { rep = `${cardinal([words[0]])}.${cardinal([words[1]])} ${next[0] === 'a' ? 'a.m.' : 'p.m.'}`; end = last + 2; }
        if (rep !== null) {
          const from = toks.slice(i, end + 1).join(''); emit(rep, from); i = end;
          // "a.m." already ends with a full stop: don't print the sentence's own one again.
          if (rep.endsWith('.') && /^\./.test(toks[i + 1] || '')) toks[i + 1] = toks[i + 1].slice(1);
          continue;
        }
        emit(original); i = last; continue;
      }
      if (options.british !== false) { const uk = british(t, options.dict); if (uk) { emit(uk, t); continue; } }
      emit(t);
    }
    let s = '';
    for (const o of out) { if (o.from !== undefined && o.from !== o.piece) changes.push({ from: o.from, to: o.piece, start: s.length, end: s.length + o.piece.length }); s += o.piece; }
    return { text: s, changes };
  }

  const api = { normalize, cardinal, year, digits, british };
  root.LTItn = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
