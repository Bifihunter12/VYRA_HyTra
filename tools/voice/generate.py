"""Record the voice coach's lines with Kokoro (open-source neural TTS, Apache-2.0).

    python -m venv venv && venv/bin/pip install kokoro-onnx soundfile
    # model files: https://github.com/thewh1teagle/kokoro-onnx/releases (kokoro-v1.0.onnx, voices-v1.0.bin)
    node tools/voice/catalog.mjs
    venv/bin/python tools/voice/generate.py <models dir>

Writes audio/voice/<female|male>/<file>.mp3 and audio/voice/manifest.json.
Only lines that are new or whose text changed are recorded again.
"""
import json, os, subprocess, sys, tempfile
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "audio", "voice")
VOICES = {"female": ("af_heart", 1.04), "male": ("am_michael", 1.04)}   # Kokoro voice, speaking speed


def encode(samples, sr, dest):
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        sf.write(tmp.name, samples, sr)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp.name,
                        # trim silence at the start, then (reversed) at the end; pauses inside the line stay
                        "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
                               "silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
                               "loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=0.08",
                        "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "48k", dest], check=True)


def main(models):
    lines = json.load(open(os.path.join(ROOT, "tools", "voice", "catalog.json")))
    man_path = os.path.join(OUT, "manifest.json")
    old = json.load(open(man_path))["lines"] if os.path.exists(man_path) else {}
    k = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
    made = 0
    for key, (model, speed) in VOICES.items():
        os.makedirs(os.path.join(OUT, key), exist_ok=True)
        for line in lines:
            dest = os.path.join(OUT, key, line["file"])
            if os.path.exists(dest) and old.get(line["id"], {}).get("text") == line["text"]:
                continue
            samples, sr = k.create(line["text"], voice=model, speed=speed, lang="en-us")
            encode(samples, sr, dest)
            made += 1
    keep = {l["file"] for l in lines}
    for key in VOICES:                                   # remove recordings of lines that no longer exist
        for f in os.listdir(os.path.join(OUT, key)):
            if f.endswith(".mp3") and f not in keep:
                os.remove(os.path.join(OUT, key, f))
    json.dump({"voices": {k2: v[0] for k2, v in VOICES.items()}, "lines": {l["id"]: {"file": l["file"], "text": l["text"]} for l in lines}},
              open(man_path, "w"), indent=0, sort_keys=True)
    print(f"recorded {made} clips, {len(lines)} lines per voice")


if __name__ == "__main__":
    main(sys.argv[1])
