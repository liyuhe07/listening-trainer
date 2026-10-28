const { execFileSync } = require('child_process');
function hasFfmpeg() { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } }
function decode(file) { const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 }); return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4); }
function hasOrt() { try { require('onnxruntime-node'); return true; } catch { return false; } }
module.exports = { hasFfmpeg, decode, hasOrt };
