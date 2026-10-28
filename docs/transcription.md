# 只有音频时：自动识别原文

导入时选“只有音频，自动识别原文”，网站会在浏览器里完成下面几步，然后让你校对，确认后再走正常的对齐和挖空流程。

## 1. 识别（带标点和大小写）

- 模型：NVIDIA Parakeet TDT-CTC 110M（CC BY 4.0），sherpa-onnx 导出的 CTC 分支，int8，132 MB。
  GitHub 单个文件不能超过 100 MB，所以在 `models/en-parakeet-ctc-110m/` 里切成 3 块（45 + 45 + 42 MB），
  浏览器下载后拼起来，再用 `manifest.json` 里的 SHA-256 校验；只有第一次使用这个功能时才下载，之后在浏览器里缓存。
- 和对齐模型用同一套特征（Kaldi 80 维滤波器组）和同样的 30 秒窗口（两侧各 4 秒上下文），整段录音一次识别，
  不先切成小段——先切段再识别会在段与段的交界处产生乱拼的词。
- 每个词带有识别把握（词片概率的最小值）。

在 4 段商业出版的考试录音（2501 词，与官方原文比对，录音不随项目发布）上：真正识别错的词约 1%
（programme→programe、Tori→Torory、minus→minor 这类）；8 分钟录音在浏览器（单线程 WebAssembly）里约 1.5 分钟。

## 2. 区分说话人

- 模型：3D-Speaker CAM++（英语，VoxCeleb 训练，Apache-2.0），30 MB。每一句算一个声纹向量，按余弦相似度做层次聚类
  （阈值 0.35）；不到 1.2 秒的短句不参与决定有几个人，最后再并到最像的那个人；占总时长不到 8% 的小簇并到最近的簇。
- 在 8 段考试录音（5 段对话、3 段独白，用人工复核过的句子时间）上：说话人数全部判断正确，98.6% 的句子归属正确。
- 结果只用字母 A、B、C 表示，校对时可以改成 MAN、WOMAN 或人名；如果其实是独白，一键改成不显示说话人。

## 3. 清理文字

`app/itn.js`：

| 识别出来 | 改成 |
|---|---|
| thirty five pounds / twelve pounds fifty / fifty pence | £35 / £12.50 / 50p |
| ten am / nine thirty am / at eleven thirty | 10 a.m. / 9.30 a.m. / at 11.30 |
| nineteen eighty five / twenty twenty two | 1985 / 2022 |
| the seventeenth of March / the twenty first century | the 17th of March / the 21st century |
| fifty percent / three per cent | 50% / 3% |
| oh seven nine four six, three one eight | 07946 318 |
| forty five minutes / fifteen kilometres | 45 minutes / 15 kilometres |
| emphasize, behavior, program, okay | emphasise, behaviour, programme, OK（可关闭） |

一到十这样的小数字在普通句子里保持单词（“two volunteers”、“one of them”），和印刷原文的习惯一致。
在上面 4 段录音上，与官方原文在数字写法上的差异从 23 处降到 6 处。

识别偶尔会把词里几个字母重复（questestionnaire、sururveys、fooccus）或少一个双写字母（programe）。
词典里查不到、但去掉重复或补上双写后只有一个词典词能对上时，自动改正（同样灰底显示，可以还原）。

## 整体效果

6 段考试录音（对话和讲座）全程自动处理、不做任何人工修改时，和官方原文的差异：

| | 差异 |
|---|---|
| 识别原样（含考试说明、例题重播） | 14–54% |
| 自动清理后（删说明和重播、数字、拼写、重复字母） | 0.2–2.8%，平均 2.1%（最老的一段录音 6.6%） |

剩下的差异主要是原文里引号、少数数字写法的习惯，以及少量真正听错的词；校对页会把可疑的词标出来。

## 4. 校对页

- **要查的词**：识别把握低的词，以及词典里没有的词（`data/dictionary.txt`，来自 wordfreq，约 9.3 万词）标波浪线；
  句中大写的陌生词按人名、地名处理，标虚线提醒核对拼写。
- **自动改写**：灰底显示，点一下还原成识别原样。
- **建议删除**：考试说明（“You will hear a…”“Now turn to Part 2”“look at questions…”“CD 2, Test 3” 这类标题，
  例题答案说明“So four has been written in the space”和它前面那句）；连续三句以上的删除会折叠起来；播音员通常是单独一个声音，
  这个声音的大部分句子是说明时，它的其余句子也一并建议删除；同一段话前后出现两遍时（Part 1 先放例题、再从头放），删第一遍。
- 每句可以试听、直接改文字、改说话人、勾掉不要。
- 确认后：用原来的对齐模型重新精确对齐；自动选挖空时，仍然带波浪线的词不会被选作答案。
