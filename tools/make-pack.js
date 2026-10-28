#!/usr/bin/env node
/*
 * Builds a content pack (.zip) on the command line, with the same code the website runs in the browser.
 * Useful for preparing many sections at once on a computer, then importing the pack on the website.
 *
 *   node tools/make-pack.js --out my-pack.zip \
 *        --collection "Book 1 · Test 1" --title "Part 1" --audio part1.mp3 --text part1.txt \
 *        --title "Part 2" --audio part2.mp3 --text part2.txt
 *
 * Without a transcript, use --auto instead of --text: the recording is transcribed (numbers and spelling cleaned up,
 * exam instructions and the replayed example dropped, speakers lettered A, B, …). Proofread such packs on the website.
 *
 * Needs: Node 18+, ffmpeg on PATH, and `npm install` (onnxruntime-node). Options apply to the following sections;
 * every --text or --auto closes one section. Add --no-blanks to skip automatic blanks.
 */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const T = require(ROOT + '/app/transcript.js'), S = require(ROOT + '/app/section.js'), E = require(ROOT + '/app/align/engine.js'), P = require(ROOT + '/app/pack.js');
const { loadModel, loadAsr, loadSpeaker } = require('./node-model.js');
const X = require(ROOT + '/app/align/transcribe.js'), SP = require(ROOT + '/app/align/speakers.js'), PR = require(ROOT + '/app/proofread.js');

function decode(file) {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}
const TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac' };

async function main(argv) {
  const jobs = [], opts = { collection: '', blanks: true }; let out = null, cur = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--out') { out = v; i++; } else if (a === '--collection') { opts.collection = v; i++; } else if (a === '--title') { cur.title = v; i++; }
    else if (a === '--audio') { cur.audio = v; i++; } else if (a === '--text') { cur.text = v; i++; jobs.push({ ...opts, ...cur }); cur = {}; }
    else if (a === '--auto') { jobs.push({ ...opts, ...cur, auto: true }); cur = {}; } else if (a === '--no-blanks') opts.blanks = false;
    else throw new Error('未知参数：' + a);
  }
  if (!out || !jobs.length) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(1); }
  const model = await loadModel(), core = new Set(JSON.parse(fs.readFileSync(ROOT + '/data/wordlist.json')).words), items = [];
  for (const [k, job] of jobs.entries()) {
    if (!job.audio || !job.title) throw new Error('每一节都需要 --title、--audio 和 --text');
    const t0 = Date.now(), samples = decode(job.audio);
    let parsed;
    if (job.auto) {
      const asr = await loadAsr(), voice = await loadSpeaker(), dict = new Set(fs.readFileSync(ROOT + '/data/dictionary.txt', 'utf8').split('\n'));
      const tx = await X.transcribe({ samples, model: asr, tokens: asr.tokens, blankId: asr.blankId });
      const d = await SP.diarize({ samples, spans: tx.sentences, model: voice }); tx.sentences.forEach((q, i) => { q.speaker = d.labels[i]; }); tx.speakers = d.speakers;
      const p = PR.prepare(tx, { dict }), kept = [...new Set(p.rows.filter(r => r.keep).map(r => r.speaker))], names = {};
      if (kept.length > 1) kept.forEach((sp, n) => { names[sp] = String.fromCharCode(65 + n); });
      parsed = PR.build(p.rows, names);
      console.log(`  自动识别：保留 ${parsed.sentences.length} 句，删去 ${p.rows.length - parsed.sentences.length} 句说明/重播，待查词 ${p.rows.filter(r => r.keep).reduce((n, r) => n + r.check.length, 0)} 个`);
    } else { parsed = T.parse(fs.readFileSync(job.text, 'utf8')); parsed.warnings.forEach(w => console.warn('  ⚠', w)); }
    const sec = S.buildSection({ title: job.title, collection: job.collection, order: k + 1, parsed });
    if (job.auto) sec.source = 'auto-transcribed';
    const res = await E.align({ samples, sentences: sec.sentences.map(q => q.text), model, vocab: model.vocab, blankId: model.blankId });
    S.applyAlignment(sec, res, (Date.now() - t0) / 1000);
    if (job.blanks) S.autoBlanks(sec, core);
    const flagged = sec.sentences.filter(q => S.needsCheck(sec.timings[q.sentenceId])).length;
    console.log(`${job.collection} · ${job.title}: ${sec.sentences.length} 句，${S.blankCount(sec)} 个挖空，${flagged} 句待检查，${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
    const ext = path.extname(job.audio).slice(1).toLowerCase(), bytes = fs.readFileSync(job.audio);
    items.push({ section: sec, audio: { blob: new Blob([bytes]), name: path.basename(job.audio), type: TYPES[ext] || 'audio/mpeg' } });
  }
  const blob = await P.exportPack(items);
  fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
  console.log('已写入', out);
}
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { decode };
