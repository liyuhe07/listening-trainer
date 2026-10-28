# 内容包格式（listening-trainer-pack v1）

内容包是一个普通的 `.zip` 文件，用来在设备之间搬运题库，或者备份题库。

```
listening-pack.json      清单和全部文字数据
audio/<section-id>.mp3   每一节的音频（扩展名跟原文件一致：mp3 / m4a / wav / ogg …）
```

## listening-pack.json

```jsonc
{
  "format": "listening-trainer-pack",
  "version": 1,
  "exportedAt": "2026-10-26T08:00:00.000Z",
  "sections": [
    {
      "id": "smh2k3x1ab",                 // [A-Za-z0-9_-]+，在一个题库里唯一
      "title": "Part 1",
      "collection": "Book 1 · Test 1",    // 侧栏里的分组名，可以为空
      "order": 1,                         // 组内顺序
      "duration": 302.4,                  // 秒
      "audio": "audio/smh2k3x1ab.mp3",    // zip 内路径；没有音频时为 null
      "sentences": [
        {
          "sentenceId": "smh2k3x1ab-001", // 以 "<id>-" 开头，在本节内唯一
          "paragraphId": "smh2k3x1ab-p0", // 同一段的句子共用
          "speaker": "MAN",               // 没有说话人时为 ""
          "text": "Good morning, Riverside Sports Centre.",
          "blanks": [
            {
              "id": "smh2k3x1ab-001-14-38", // "<sentenceId>-<start>-<end>"
              "start": 14, "end": 38,       // text 中的 UTF-16 偏移，[start, end)
              "answer": "Riverside Sports Centre", // 必须等于 text.slice(start, end)，且是完整的词
              "type": "专有名词",
              "analysis": "人名、地名或机构名，按原文拼写"
            }
          ]
        }
      ],
      "timings": {
        "smh2k3x1ab-001": {
          "start": 14.06, "end": 16.92,      // 播放区间（秒），已含少量前后余量，相邻句不重叠
          "speechStart": 14.16, "speechEnd": 16.6, // 模型判断的语音起止
          "confidence": 0.94,                // 0–1，低于 0.6 的句子在校对页标为“待检查”
          "untranscribed": 0,                // 句内原文里没有的语音（秒）
          "checked": true,                   // 用户手动确认或调整过
          "estimated": true,                 // 没有可对齐的词，时间是按前后句估计的
          "words": [[0, 4, 14.16, 14.4]]     // [字符起, 字符止, 秒起, 秒止]
        }
      },
      "blankRevision": "auto-mh2k3x9z",     // 整体重新选词时改变；练习记录据此清空旧作答
      "alignment": { "engine": "nemo-conformer-ctc-small", "at": 1792990000000, "seconds": 31 }
    }
  ]
}
```

导入时会检查：每个挖空都必须原样出现在句子里、而且是完整的词；句子 id 必须以本节 id 开头。不符合的章节会被跳过。

可以用 `node tools/make-pack.js` 在命令行批量生成内容包，然后在网站的“题库管理 → 导入内容包”里导入。
