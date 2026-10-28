/*
 * Local storage in IndexedDB. Everything stays in this browser: sections (text, timings, blanks), audio files,
 * and the practice record. Nothing is uploaded anywhere.
 *   sections: {id, title, collection, order, sentences, timings, ...}
 *   audio:    {id, blob, name, type}
 *   meta:     {key, value}   e.g. key "state" holds the practice record
 */
(function (root) {
  'use strict';
  const NAME = 'listening-trainer', VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('这个浏览器不支持 IndexedDB，无法保存题库。')); return; }
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sections')) db.createObjectStore('sections', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => db.close(); resolve(db); };
      req.onerror = () => reject(req.error || new Error('无法打开本地数据库。'));
      req.onblocked = () => reject(new Error('本地数据库被另一个标签页占用，请关闭其他标签页后刷新。'));
    });
    return dbPromise;
  }
  function tx(stores, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode); let result;
      t.oncomplete = () => resolve(result); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('写入被中止（可能是存储空间不足）。'));
      result = fn(...[].concat(stores).map(s => t.objectStore(s)));
    }));
  }
  const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

  const api = {
    open,
    async listSections() { const db = await open(); return req(db.transaction('sections').objectStore('sections').getAll()); },
    async getSection(id) { const db = await open(); return req(db.transaction('sections').objectStore('sections').get(id)); },
    putSection(section) { return tx('sections', 'readwrite', s => { s.put({ ...section, updatedAt: Date.now() }); }); },
    putSectionWithAudio(section, audio) { return tx(['sections', 'audio'], 'readwrite', (s, a) => { a.put(audio); s.put({ ...section, updatedAt: Date.now() }); }); },
    deleteSection(id) { return tx(['sections', 'audio'], 'readwrite', (s, a) => { s.delete(id); a.delete(id); }); },
    async getAudio(id) { const db = await open(); return req(db.transaction('audio').objectStore('audio').get(id)); },
    async getMeta(key) { const db = await open(); const row = await req(db.transaction('meta').objectStore('meta').get(key)); return row ? row.value : undefined; },
    setMeta(key, value) { return tx('meta', 'readwrite', m => { m.put({ key, value }); }); },
    async persist() { try { return await navigator.storage?.persist?.(); } catch { return false; } },
    async estimate() { try { return await navigator.storage?.estimate?.(); } catch { return null; } }
  };
  root.LTDb = api;
})(typeof self !== 'undefined' ? self : globalThis);
