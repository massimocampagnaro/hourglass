# Hourglass

A minimal, configurable hourglass timer — use it standalone or as a Pomodoro-style focus/break timer.

Built with vanilla HTML, CSS, and JavaScript — no frameworks, no dependencies.

## How it works

The glass silhouette is generated from a single smooth width-profile function (rim → shoulder → neck), sampled into an SVG path. The sand fill is derived from that same function, so the sand always sits flush against the glass walls. Sand levels are computed from the actual cross-sectional area of the bulb (not just a linear height), so the surface drops and the pile grows at a physically plausible, non-linear rate. A lightweight canvas layer draws the individual falling grains on top of the SVG.

## Run locally

It's a static site — just open `index.html`, or serve the folder:

```bash
npx serve .
```

## Roadmap

1. **Phase 1 (this):** a single, configurable hourglass with a polished animation.
2. **Phase 2:** multiple hourglasses side by side with presets (5 / 25 / 30 min + custom) for the Pomodoro method.
3. **Phase 3:** automatic mode (sound + auto-start of the next timer, alternating focus/break) vs. manual mode.
