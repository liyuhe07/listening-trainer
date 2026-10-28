"""Builds the synthetic sample recordings in samples/ from samples/source/*.json with Piper TTS.

Usage: python3 tools/make-sample.py <piper-dir> <voices-dir>
  piper-dir:  folder with the piper binary (https://github.com/rhasspy/piper/releases)
  voices-dir: folder with <voice>/<voice>.onnx(.json) (piper v0.0.2 voice archives)
Writes samples/<name>.mp3 and samples/<name>.txt. The introduction is spoken but deliberately not part of the
transcript, so the sample also shows the aligner skipping speech that is not in the text."""
import json, subprocess, sys, tempfile, wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
piper, voices = Path(sys.argv[1]), Path(sys.argv[2])


def say(text, voice, out):
    model = voices / voice / f'{voice}.onnx'
    subprocess.run([str(piper / 'piper'), '--model', str(model), '--output_file', str(out), '--sentence_silence', '0.35'],
                   input=text.encode(), check=True, capture_output=True)
    with wave.open(str(out)) as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1
        return w.readframes(w.getnframes())


def silence(seconds):
    return b'\0\0' * int(16000 * seconds)


for src in sorted((ROOT / 'samples/source').glob('*.json')):
    spec = json.loads(src.read_text())
    with tempfile.TemporaryDirectory() as tmp:
        pcm = silence(0.6) + say(spec['intro'], spec['voices']['intro'], Path(tmp) / 'intro.wav') + silence(2.5)
        lines, last, truth = [], None, []
        for i, turn in enumerate(spec['turns']):
            start = len(pcm) / 32000
            spoken = say(turn.get('say', turn['text']), spec['voices'][turn['speaker']], Path(tmp) / f'{i}.wav')
            truth.append({'text': turn['text'], 'start': round(start, 3), 'end': round(start + len(spoken) / 32000, 3)})
            pcm += spoken + silence(0.7 if turn['speaker'] != last else 0.4)
            label = f"{turn['speaker']}: " if turn['speaker'] and turn['speaker'] != last else ''
            lines.append(('\n' if lines and label else ' ' if lines else '') + label + turn['text'])
            last = turn['speaker']
        pcm += silence(1.2)
        wav = Path(tmp) / 'all.wav'
        with wave.open(str(wav), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(pcm)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(wav), '-ac', '1', '-b:a', '64k', str(ROOT / 'samples' / f'{src.stem}.mp3')], check=True)
    (ROOT / 'samples' / f'{src.stem}.txt').write_text(''.join(lines) + '\n')
    # Where each turn really is in the recording (Piper adds a little silence around speech).
    (ROOT / 'tests' / 'fixtures' / f'{src.stem}.truth.json').write_text(json.dumps(truth, indent=1) + '\n')
    print(src.stem, round(len(pcm) / 32000, 1), 's')
