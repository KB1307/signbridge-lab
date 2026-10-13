# SignBridge Lab

Live page: https://kb1307.github.io/signbridge-lab/

On-device test bench for SignBridge sign-language recognition: camera → MediaPipe Holistic
landmarks → SignBridge features → few-shot recogniser you teach → English captions and speech.
No video leaves the device; taught examples stay in the browser unless exported with consent.

- **Teach**: type a word, sign it 5 times. Then sign it live and see captions. Suggested words come from
  three lists (Starter 50, Google's 250-sign phone set, WLASL 100); typing a word shows its ASL-LEX coding
  (handshape, location, movement, hands) and the signs it is easily confused with.
  A **demo** shows what to sign: an animated figure drawn from the sign's ASL-LEX coding (hand shape, place,
  movement, repeats, one or two hands, shown like a mirror) with numbered steps, and, once a sign has been
  taught on the device, a replay of the taught example's hand and body movement. While recording, the demo
  plays in a "Copy this" window on the camera. A "Real videos" link opens a video search for the word. The
  diagram does not show palm direction or which way a path goes.
- **Video**: recognise a recorded clip.
- **Data**: export consented landmark recordings for training.
- **Device**: landmark speed and a speed test of the 4.5M-parameter network shape (random weights).

Run locally with a webcam: `python3 serve.py`, then open http://localhost:8000.
Check the sign list and demos: `node tests/lexicon.test.js` (gates L1-L5), `node tests/demo.test.js` (gates D1-D7).

Vendored: MediaPipe Holistic (Apache-2.0), ONNX Runtime Web (MIT), Atkinson Hyperlegible, Bricolage Grotesque and IBM Plex Mono (OFL-1.1).
Sign list (`data/lexicon.json`): ASL-LEX 2.0 phonology and frequency (Sehyr, Caselli, Cohen-Goldberg & Emmorey 2021,
CC BY-NC 4.0, https://asl-lex.org) and WLASL v0.3 video counts (Li et al. 2020, C-UDA). Non-commercial use only.
