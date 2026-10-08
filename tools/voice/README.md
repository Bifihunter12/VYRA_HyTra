# Voice coach recordings

The coach's lines are recorded once with [Kokoro](https://github.com/hexgrad/kokoro)
(open-source neural TTS, Apache-2.0) and shipped in `audio/voice/` (female: `af_heart`,
male: an even blend of `am_fenrir` and `am_onyx`). `coach.js` decides what is said and when; lines without a
recording fall back to the device's own voice.

After changing exercises, workouts, benchmarks or coach lines:

```sh
node tools/voice/catalog.mjs                       # list every line → catalog.json
python -m venv venv && venv/bin/pip install kokoro-onnx soundfile
# download kokoro-v1.0.onnx and voices-v1.0.bin from
# https://github.com/thewh1teagle/kokoro-onnx/releases into ./models
venv/bin/python tools/voice/generate.py ./models   # records only new or changed lines
npm test                                           # fails if a line is missing a recording
```
