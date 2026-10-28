# NVIDIA Conformer-CTC Small (English), int8 ONNX

- `model.int8.onnx`, `tokens.txt`: from the sherpa-onnx release `asr-models`, archive
  `sherpa-onnx-nemo-ctc-en-conformer-small.tar.bz2` (https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models).
- Original model: NVIDIA NeMo `stt_en_conformer_ctc_small`, CC BY 4.0
  (https://huggingface.co/nvidia/stt_en_conformer_ctc_small). Trained on several thousand hours of English speech
  (LibriSpeech, Fisher, Switchboard, WSJ, National Speech Corpus, VCTK, VoxPopuli, Europarl-ASR, MLS, Common Voice).
- Input: 80-bin Kaldi filterbank, per-feature normalised, shape (1, 80, T); `length` int64. Output: log-probabilities
  (1, T/4, 1025); the last id (1024) is the CTC blank.

- SHA-256 of model.int8.onnx: 66cfde4ce0b6da9e1a4352e58f0c968f87da23070cf229c81ae0d520cddad2a2
