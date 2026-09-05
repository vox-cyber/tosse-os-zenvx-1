# Verification suite

Headless Chromium checks that drive the real page — no mocks of the app itself.

```bash
python3 -m http.server 8899        # serve the repo root
node tests/test-boot.js            # launch permissions: auto-ask, blocked, retry, return visits
node tests/test-gest.js            # 11-pose classifier, pointer mapping, pinch, swipe, skeleton
node tests/test-voice.js           # 23 spoken commands, chaining, echo guard, persistence
node tests/test-voicefix.js        # native engine silent death -> automatic on-device handover
node tests/test-diag.js            # voice diagnostics panel, level meter, speaking latch
node tests/test-apps.js            # every app window and the window manager
node tests/test-extras.js          # Eva orb, custom pose lab, voice routines, screenshots, PWA
```

Each script expects Chromium at `/usr/local/bin/chromium` and Playwright resolvable on
`NODE_PATH`. They launch with `--use-fake-ui-for-media-stream` and
`--use-fake-device-for-media-stream` so the camera and microphone are granted and fed synthetic
input.

Notes for anyone changing them:

- `test-boot.js` simulates a genuine refusal by stubbing `getUserMedia` to reject with
  `NotAllowedError` and `permissions.query` to report `denied` — headless Chromium cannot show a
  real prompt.
- The sandbox used to build this has no speech service, so native `SpeechRecognition` dies
  silently there. That is exactly the failure `test-voicefix.js` exists to cover.
- Gesture tests stop the real camera and inject synthetic 21-landmark hands, so results are
  deterministic rather than dependent on what a webcam sees.
