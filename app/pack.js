/*
 * Content packs: a .zip with listening-pack.json and the audio files, so a library can be moved between
 * devices (computer -> phone) or kept as a backup. Written uncompressed (audio does not compress);
 * reading also accepts deflate-compressed entries where the browser supports DecompressionStream.
 * See docs/content-pack.md for the format.
 */
(function (root) {
  'use strict';
  const FORMAT = 'listening-trainer-pack', VERSION = 1;
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes, crc = 0) { crc = ~crc >>> 0; for (let i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 255] ^ (crc >>> 8); return ~crc >>> 0; }
  const enc = new TextEncoder(), dec = new TextDecoder();

  /** files: [{name, data: Uint8Array}] -> Blob (zip, stored). */
  function zip(files) {
    const parts = [], central = []; let offset = 0;
    const date = new Date(), dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1), dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
      local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
      parts.push(local.buffer, name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  /** Blob/ArrayBuffer of a zip -> Map name -> Uint8Array */
  async function unzip(input) {
    const buf = new Uint8Array(input instanceof ArrayBuffer ? input : await input.arrayBuffer()), view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let e = buf.length - 22; while (e >= 0 && view.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('不是有效的 zip 文件。');
    const count = view.getUint16(e + 10, true); let p = view.getUint32(e + 16, true); const out = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('zip 目录损坏。');
      const method = view.getUint16(p + 10, true), csize = view.getUint32(p + 20, true), nlen = view.getUint16(p + 28, true), xlen = view.getUint16(p + 30, true), clen = view.getUint16(p + 32, true), local = view.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true), data = buf.subarray(start, start + csize);
      if (method === 0) out.set(name, data);
      else if (method === 8) {
        if (typeof DecompressionStream === 'undefined') throw new Error('这个浏览器不能读取压缩过的 zip，请用本网站导出的内容包。');
        out.set(name, new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
      } else throw new Error('不支持的 zip 压缩方式：' + method);
      p += 46 + nlen + xlen + clen;
    }
    return out;
  }

  const extOf = (name, type) => (String(name).match(/\.([a-z0-9]{2,4})$/i)?.[1] || (/mp4|m4a|aac/.test(type) ? 'm4a' : /wav/.test(type) ? 'wav' : /ogg/.test(type) ? 'ogg' : 'mp3')).toLowerCase();
  const TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac' };

  /** items: [{section, audio: {blob, name, type}}] -> Blob */
  async function exportPack(items, meta = {}) {
    const files = [], sections = [];
    for (const { section, audio } of items) {
      const path = `audio/${section.id}.${extOf(audio?.name, audio?.type)}`;
      const { audioId, peaks, ...rest } = section; // the waveform is recomputed on the device
      sections.push({ ...rest, audio: audio ? path : null });
      if (audio) files.push({ name: path, data: new Uint8Array(await audio.blob.arrayBuffer()) });
    }
    files.unshift({ name: 'listening-pack.json', data: enc.encode(JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), ...meta, sections }, null, 1)) });
    return zip(files);
  }

  /** Returns [{section, audio: {blob, name, type}|null}] */
  async function importPack(blob) {
    const files = await unzip(blob), manifest = files.get('listening-pack.json');
    if (!manifest) throw new Error('zip 里没有 listening-pack.json，不是本网站的内容包。');
    const data = JSON.parse(dec.decode(manifest));
    if (data.format !== FORMAT || !Array.isArray(data.sections)) throw new Error('内容包格式不正确。');
    if (data.version > VERSION) throw new Error('这个内容包来自更新版本的网站，请先更新网站。');
    return data.sections.map(s => {
      const bytes = s.audio && files.get(s.audio), ext = s.audio ? extOf(s.audio) : 'mp3';
      return { section: { ...s, audio: undefined }, audio: bytes ? { blob: new Blob([bytes], { type: TYPES[ext] || 'audio/mpeg' }), name: s.audio.split('/').pop(), type: TYPES[ext] || 'audio/mpeg' } : null };
    });
  }

  const api = { zip, unzip, crc32, exportPack, importPack, FORMAT, VERSION };
  root.LTPack = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
