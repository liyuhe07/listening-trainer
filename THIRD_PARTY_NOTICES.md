# Third-party notices

| Path | Component | License | Source |
|---|---|---|---|
| `models/en-conformer-ctc-small/` | NVIDIA NeMo `stt_en_conformer_ctc_small`, exported to ONNX and int8-quantized by the sherpa-onnx project | CC BY 4.0 (model); export scripts Apache-2.0 | https://huggingface.co/nvidia/stt_en_conformer_ctc_small · https://github.com/k2-fsa/sherpa-onnx (release `asr-models`, `sherpa-onnx-nemo-ctc-en-conformer-small`) |
| `models/en-parakeet-ctc-110m/` | NVIDIA NeMo `parakeet-tdt_ctc-110m` (CTC branch), exported to ONNX and int8-quantized by sherpa-onnx; stored in three parts | CC BY 4.0 (model); export scripts Apache-2.0 | https://huggingface.co/nvidia/parakeet-tdt_ctc-110m · sherpa-onnx release `asr-models`, `sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8` |
| `models/speaker-campplus-en/` | 3D-Speaker CAM++ speaker embedding model, English (VoxCeleb), `iic/speech_campplus_sv_en_voxceleb_16k`, ONNX export from sherpa-onnx | Apache-2.0 | https://github.com/modelscope/3D-Speaker · sherpa-onnx release `speaker-recongition-models` |
| `data/dictionary.txt` | English word list (about 93,000 words, by frequency) derived from wordfreq 3.1.1 `large_en` | wordfreq data: CC BY-SA 4.0 (code Apache-2.0); see https://github.com/rspeer/wordfreq for sources (Wikipedia, OpenSubtitles, SUBTLEX, Google Books Ngrams, …) | https://github.com/rspeer/wordfreq |
| `vendor/ort/` | ONNX Runtime Web 1.30.0 (`ort.wasm.min.js`, `ort-wasm-simd-threaded.*`) | MIT, © Microsoft Corporation | https://github.com/microsoft/onnxruntime |
| `data/wordlist.json` | New General Service List 1.2, New Academic Word List 1.2, TOEIC Service List 1.2 and NGSL supplementary headwords (Browne, Culligan, Phillips); lowercased, deduplicated and merged | CC BY-SA 4.0 | https://www.newgeneralservicelist.com/ |
| `samples/*.mp3`, `samples/sample-pack.zip` | Synthetic speech generated with Piper TTS (MIT) using the voices `en-gb-alan-low` and `en-gb-southern_english_female-low` from the Piper v0.0.2 voice release | Text: original, CC0. Audio: see note below | https://github.com/rhasspy/piper |

## Attribution for the speech model (CC BY 4.0)

"NVIDIA Conformer-CTC Small (en-US)" by NVIDIA, licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/). Changes: converted to ONNX and quantized to int8 by the
sherpa-onnx project; used unmodified from that release.

## Attribution for the transcription model (CC BY 4.0)

"NVIDIA Parakeet TDT-CTC 110M (en)" by NVIDIA, licensed under CC BY 4.0. Changes: CTC branch exported to ONNX and
quantized to int8 by the sherpa-onnx project; split into three files for hosting, byte-for-byte identical when joined.

## Note on the sample audio

The sample recordings are machine-generated; the texts were written for this project. The Piper voices were
fine-tuned from a base voice whose training data carries a non-commercial license, so treat the sample audio as
suitable for demonstration only. You can replace it with your own recordings: edit `samples/source/*.json`,
run `tools/make-sample.py` (or record the texts yourself), then rebuild `samples/sample-pack.zip` with
`tools/make-pack.js`.
