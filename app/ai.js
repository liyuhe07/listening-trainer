/*
 * Optional AI blank selection with the learner's own API key (OpenAI-compatible endpoints such as DeepSeek,
 * Qwen/DashScope, Moonshot, OpenAI, or Anthropic). The request goes straight from the browser to the provider;
 * nothing passes through this project. Every answer is checked to be a literal whole-word span of its sentence.
 */
(function (root) {
  'use strict';
  const B = root.LTBlanks || (typeof require === 'function' && require('./blanks.js'));
  const TYPES = ['名词短语', '动词短语', '重点名词', '重点动词', '形容词与副词', '易混易错', '数字与拼写', '专有名词'];

  function prompt(sentences, perSection) {
    return `You are choosing dictation blanks for an English listening exercise (IELTS level, very hard).
Pick at most ${perSection} blanks for the whole text below, spread across the text, at most 3 per sentence.
Prefer: noun phrases and verb phrases strongly tied to the content (e.g. "birds and insects", "suit all ages"),
long or less common words, words that are easy to misspell or mishear, key nouns and verbs, names and numbers
that a listener must write down. Never choose very common short words on their own.
Each answer must be copied EXACTLY from its sentence (same spelling, case and punctuation inside), must be whole words,
and blanks in one sentence must not overlap.
For each blank give a short analysis in Simplified Chinese (why it is worth practising: spelling trap, collocation,
weak form, linking, etc.). Type must be one of: ${TYPES.join(', ')}.
Reply with JSON only, no prose: {"blanks":[{"n":<sentence number>,"answer":"...","type":"...","analysis":"..."}]}

Text:
${sentences.map((q, i) => `${i + 1}. ${q.text}`).join('\n')}`;
  }

  function parseReply(text) {
    const m = String(text).match(/\{[\s\S]*\}/); if (!m) throw new Error('AI 回复里没有 JSON。');
    const data = JSON.parse(m[0]); if (!Array.isArray(data.blanks)) throw new Error('AI 回复的 JSON 缺少 blanks。');
    return data.blanks;
  }

  /** Validates AI picks against the sentences; returns {perSentence: [[blank]], rejected: [..]} */
  function validate(sentences, picks, perSection = 50) {
    const out = sentences.map(() => []), rejected = [];
    for (const p of picks) {
      const i = Number(p.n) - 1, q = sentences[i], answer = String(p.answer || '').trim();
      if (!q || !answer) { rejected.push({ ...p, reason: '句号不存在' }); continue; }
      let occurrence = 1, span = null;
      while ((span = B.locate(q.text, answer, occurrence)) && out[i].some(b => span.start < b.end && b.start < span.end)) occurrence++;
      if (!span) { rejected.push({ ...p, reason: '原句中找不到这个答案' }); continue; }
      if (out[i].length >= 3 || out.flat().length >= perSection) { rejected.push({ ...p, reason: '超过数量上限' }); continue; }
      out[i].push({ start: span.start, end: span.end, answer, type: TYPES.includes(p.type) ? p.type : '重点词汇', analysis: String(p.analysis || '').slice(0, 200) || 'AI 选词' });
    }
    out.forEach(list => list.sort((a, b) => a.start - b.start));
    return { perSentence: out, rejected };
  }

  /** config: {kind: 'openai'|'anthropic', baseUrl, model, apiKey} */
  async function request(config, content, signal) {
    if (!config.apiKey) throw new Error('请先填写 API Key。');
    if (!config.model) throw new Error('请填写模型名称（以服务商文档为准）。');
    if (config.kind === 'anthropic') {
      const res = await fetch((config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '') + '/v1/messages', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: config.model, max_tokens: 8000, messages: [{ role: 'user', content }] })
      });
      if (!res.ok) throw new Error(`AI 接口错误 ${res.status}：${(await res.text()).slice(0, 300)}`);
      const data = await res.json(); return data.content?.map(c => c.text || '').join('') || '';
    }
    const res = await fetch((config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content }], temperature: 0.2 })
    });
    if (!res.ok) throw new Error(`AI 接口错误 ${res.status}：${(await res.text()).slice(0, 300)}`);
    const data = await res.json(); return data.choices?.[0]?.message?.content || '';
  }

  async function select(sentences, config, { perSection = 50, signal } = {}) {
    const reply = await request(config, prompt(sentences, perSection), signal);
    return validate(sentences, parseReply(reply), perSection);
  }

  const api = { select, prompt, parseReply, validate, TYPES };
  root.LTAi = api; if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
