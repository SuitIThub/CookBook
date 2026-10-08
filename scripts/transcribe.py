"""Speech-to-text for the reel import (src/lib/reelImport.server.ts).

    python transcribe.py <audio.wav> [model]

Prints the transcript to stdout. Runs locally on the CPU with faster-whisper
(int8); the model ("small" by default, ~500 MB) is downloaded on first use and
cached. The language is detected automatically.

The input is the 16 kHz mono PCM WAV the server extracts with ffmpeg; it is
read with the standard library instead of faster-whisper's PyAV decoder, whose
API breaks between PyAV releases.
"""
import sys
import wave

import numpy as np
from faster_whisper import WhisperModel


def read_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as wav:
        if wav.getsampwidth() != 2 or wav.getnchannels() != 1 or wav.getframerate() != 16000:
            raise SystemExit("expected 16 kHz mono 16-bit WAV (ffmpeg -ac 1 -ar 16000)")
        frames = wav.readframes(wav.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # the server reads UTF-8 (Windows consoles default to cp1252)
    if len(sys.argv) < 2:
        print("usage: transcribe.py <audio.wav> [model]", file=sys.stderr)
        sys.exit(2)
    audio = read_wav(sys.argv[1])
    model_name = sys.argv[2] if len(sys.argv) > 2 else "small"
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(audio, vad_filter=True, beam_size=1)
    print(" ".join(segment.text.strip() for segment in segments).strip())


if __name__ == "__main__":
    main()
