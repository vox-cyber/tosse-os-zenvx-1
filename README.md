# Tosse OS — Web Preview

An interactive, in-browser preview of **Tosse OS**, a Zorin-based desktop concept built around
voice-first control, touch-free hand gestures, accessibility and privacy-by-design.

Live preview: deploy `index.html` to any static host (Render, Netlify, Vercel, Cloudflare Pages,
GitHub Pages). No build step, no bundler, no server code.

- **Publish directory:** `./`
- **Build command:** _(none)_
- **Branch:** `main`

## What you can do in the preview

### New in this drop

- **Eva orb** — a living presence bubble (bottom-right) with idle / listening / thinking / speaking states, wired straight into the voice engine. Click it to open Eva.
- **Pose Lab** — teach Eva *your own* hand signs: capture 3 samples, bind an action, and the sign fires it. Custom poses only match when none of the 11 built-ins fit; samples live in localStorage, on this device only.
- **Routines** — voice macros: one phrase ("cinema mode") runs a chain of commands in order.
- **Real screenshots** — ✌ Victory (or "take a screenshot") captures the actual desktop to a PNG via html2canvas.
- **Offline PWA** — installable; after the first load the whole preview works with no network (service worker + web manifest).

### Permissions at launch

The page asks for the **microphone and camera as soon as it opens** — no button to find first. One
combined `getUserMedia` call fires automatically behind the welcome card, so the browser's own
permission prompt appears immediately and covers both sensors in a single decision. The tracks from
that call are dropped straight away: it exists only to obtain the grant, because MediaPipe's camera
helper has to own its own `getUserMedia`, and the microphone path reopens audio itself.

The card is honest about every outcome:

| State | What you see |
| --- | --- |
| Asking | "Waiting for your permission…", with a line telling you to choose **Allow** |
| Granted | Both rows turn green, the button becomes **Enter the desktop** |
| Blocked | Red rows, **Try again**, and the exact fix — the camera/lock icon in the address bar |
| Still blocked after a retry | A stronger warning that the browser will not ask again by itself |
| No device / in use | "Unavailable", with the suggestion to close whatever is holding the device |
| Served over HTTP | "Needs HTTPS", because browsers refuse sensors on insecure origins |

Two details that matter in practice: browsers that require a user gesture (Safari, iOS) fall back
to the **Allow microphone & camera** button, and a blocked permission holds the asking state
visible for a moment instead of rejecting instantly, so pressing the button never looks dead.

An unfinished setup is asked again on the next visit — never completing it is not a reason to stop
asking. Only an explicit **Continue without them** is remembered, and both sensors can still be
switched on later from the Eva overlay or the Gestures panel. Keyboard and mouse always work.

### Hand tracking

Powered by **MediaPipe Hands** (21 landmarks, full-complexity model) running entirely in the
browser. The pose classifier uses the same math as the `tosse_gestures` daemon: finger extension by
wrist-distance ratio, thumb extension, and a hand-size-normalised pinch, so it behaves the same
whether your hand is near the camera or far from it.

On top of the raw solution:

- **Per-landmark adaptive smoothing** — every joint is filtered with a one-euro-style EMA that
  chases fast motion and damps micro-jitter, *before* classification. Poses stop flickering.
- **Absolute fingertip mapping** — the pointer lives under your index fingertip with no
  accumulation or drift, mapped through an active camera box so you can still reach screen corners.
- **Pinch hysteresis** — enters at 0.27 of hand size, releases at 0.36, so a held pinch never
  chatters on the threshold.
- **Stability gate + cooldown** — a pose has to be meant, not passed through.
- **Live skeleton overlay** on the panel preview, and an optional full-screen camera ghost layer.

| Pose | Action |
| --- | --- |
| ☝ Point | moves the pointer |
| 🤏 Pinch → release | clicks whatever is under the pointer |
| 👌 OK sign | opens the app launcher |
| ✊ Fist | closes every panel |
| ✋ Open palm (held) | freezes the pointer |
| 👆 / 👇 Point up / down | volume |
| ✌ Victory | saves a screenshot (PNG download) |
| 🤘 Horns | opens the gesture panel |
| 👈 👉 Swipe | switches workspace |
| ⌨ Arrow keys + Enter | move & click — no camera needed |

### Voice control

A three-tier engine, because a browser's built-in speech service cannot be trusted to work:

1. **Browser-native `SpeechRecognition`** — used only if it proves it is alive.
2. **On-device Whisper** (`transformers.js`, WebGPU with WASM fallback) — takes over automatically.
   The model is fetched once (~40 MB) and cached; audio never leaves the browser.
3. **Typed commands** — always available, never fails.

The important detail: on many Chromium builds and networks, `SpeechRecognition` starts and then
**never fires `onstart`, `onerror` or any result** — a silent death. Nothing in the API reports it.
The engine therefore requires proof of life within 1.8 s, and treats the first genuine error as
final, handing over to the private on-device engine without the user doing anything. A diagnostics
line always states which engine is running and why.

Three more silent-failure classes are closed off:

- **Adaptive voice activity detection.** A fixed loudness threshold never opens on a quiet
  microphone and never closes in a loud room. The gate is now measured against a rolling noise
  floor, and if an utterance ever runs to its 8-second ceiling the floor is lifted instead of
  looping.
- **The "Eva is talking" mute can no longer latch.** Both engines drop audio while Eva speaks,
  and `speechSynthesis` does not reliably fire `onend`, so one failed utterance used to deafen
  voice input permanently. Speaking now carries a hard timeout ceiling and is cleared whenever the
  microphone stops. If you would rather not risk it, **Eva speaks back** can be switched off.
- **Suspended audio contexts are resumed**, since a context created outside a gesture chain can
  start suspended and silently deliver nothing.

### Voice diagnostics

Open the Eva overlay and tap **Voice diagnostics** for a live readout: engine, microphone state,
a real input-level meter with its numeric RMS, audio frame counters, the speech gate and its
current threshold, the last phrase heard and the last error. **Copy diagnostics** puts the whole
thing on the clipboard.

The meter is deliberately independent of the speech engine — it is a time-domain RMS taken straight
off the microphone stream with fast attack and slow release. So it answers one question with no
ambiguity: **if the bar moves while you talk, audio is reaching the page**; if it stays flat, the
problem is the microphone, the browser permission or the OS input device, not the recogniser.

Also included: a live transcript HUD, an optional "hey eva" wake word, an echo guard so Eva
never obeys her own text-to-speech, tolerant parsing (misspellings and verb-less phrases work),
and chained commands such as *"open terminal and then next workspace"*.

Try: `help` · `open terminal` · `enable camera` · `next workspace` · `workspace two` ·
`volume up` · `mute` · `center pointer` · `ghost overlay off` · `wake word on` · `close` ·
`stop listening`

### Desktop and apps

Three workspaces with their own wallpaper themes, a dock, desktop icons, notifications, a live
clock, and MIC / CAM sensor badges shown whenever a sensor is active. <kbd>Escape</kbd> cuts the
camera immediately.

Every launcher entry opens a real draggable window — by click, by voice ("open weather"), or by
gesture pinch. Windows can be focused, moved and closed.

| App | What it actually does |
| --- | --- |
| Calculator | Real arithmetic, keyboard input, divide-by-zero handling |
| Music | Random track, spinning art, running clock and seek bar — playback is simulated, no audio is streamed |
| Weather | Randomised city, conditions, six live stats and a five-day forecast; **Refresh** re-rolls it |
| Terminal | Simulated shell: `help ls pwd whoami uname date echo eva volume gestures clear` |
| Files | Browsable simulated file tree |
| Notes | Editable notepad, saved to your browser only |
| Settings | Volume, workspace, accent colour, wake word and ghost-overlay switches that drive the live preview |
| Accessibility | Larger text, high contrast, reduced motion and underlined controls, applied immediately |
| Focus | Working 25-minute countdown with start / pause / reset |
| Privacy | Live sensor and engine state, plus a button to clear stored preferences |
| Photos | Nine generated frames, click to enlarge |
| Mail | Simulated inbox with a reading pane |
| Browser | Sandboxed preview surface |
| App Store | Illustrative catalogue |
| Studio | Live waveform, driven by the microphone when voice is on |
| Eva / Gestures | Open the assistant overlay and the gesture panel |

## Notes

- Requires **HTTPS** (or `localhost`) for camera and microphone access.
- MediaPipe and the Whisper model load from a CDN, so the first run needs internet.
- Native speech recognition is a Chromium/Edge feature; other browsers fall through to the
  on-device engine or typed commands automatically.
- If voice ever seems dead, the diagnostics panel is the fastest answer: a flat input-level bar
  means no audio is arriving, a moving bar means the microphone is fine and the recogniser is the
  problem.
- `earth.html` is a standalone WebGL globe demo kept in the repo for reference.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The complete preview — markup, styles and engines in one file |
| `earth.html` | Standalone reference demo |
