# Aria Landing Video — Remotion

A 30-second UI walkthrough video for the Aria landing page, built with [Remotion](https://www.remotion.dev/).

## Setup

```bash
cd landing-video
npm install
```

## Preview in Remotion Studio

```bash
npm start
# Opens http://localhost:3000 — scrub through the video frame by frame
```

## Render to MP4

```bash
# Renders and copies to landing/assets/aria-demo.mp4 automatically
npm run render

# Render only (no copy)
npm run build
```

The rendered file lands at `landing/assets/aria-demo.mp4`. The landing page `index.html` auto-detects the file and switches from the placeholder to the video player.

## Scenes

| Time    | Scene           | What it shows                              |
|---------|-----------------|--------------------------------------------|
| 0–3s    | Intro           | Brand mark + tagline on dark               |
| 3–9s    | The Briefing    | Morning brief screen with dropcap + alerts |
| 9–15s   | The Triage      | Inbox list + draft reply panel             |
| 15–21s  | The Calendar    | Week grid + Aria conflict notice           |
| 21–27s  | Ask Aria        | Typing a question → answer + citations     |
| 27–30s  | Outro           | Download CTA on dark                       |

## Customisation

- **Timing**: edit `Root.tsx` — adjust `durationInFrames` and scene `from` values
- **Content**: each scene file in `src/scenes/` is standalone
- **Tokens**: `src/tokens.ts` mirrors `landing/index.html` CSS variables — keep them in sync
- **Resolution**: default 1920×1080 @ 30fps — change in `Root.tsx` Composition props
