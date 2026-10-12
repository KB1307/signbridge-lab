# SignBridge Lab

Live page: https://kb1307.github.io/signbridge-lab/

On-device test bench for SignBridge sign-language recognition: camera → MediaPipe Holistic
landmarks → SignBridge features → few-shot recogniser you teach → English captions and speech.
No video leaves the device; taught examples stay in the browser unless exported with consent.

- **Teach**: type a word, sign it 5 times. Then sign it live and see captions.
- **Video**: recognise a recorded clip.
- **Data**: export consented landmark recordings for training.
- **Device**: landmark speed and a speed test of the 4.5M-parameter network shape (random weights).

Run locally with a webcam: `python3 serve.py`, then open http://localhost:8000.

Vendored: MediaPipe Holistic (Apache-2.0), ONNX Runtime Web (MIT), Atkinson Hyperlegible and IBM Plex Mono (OFL-1.1).
