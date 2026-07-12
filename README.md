# Hourglass

A minimal, configurable hourglass timer — use it standalone or as a Pomodoro-style focus/break timer.

Preview: https://massimocampagnaro.github.io/hourglass

## Embedding

Drop just the hourglass and the time readout into another page as a transparent, borderless widget without header, footer or buttons:

```html
<iframe
    src="https://massimocampagnaro.github.io/hourglass/embed/?minutes=25&autostart=1"
    width="280" height="380"
    style="border: none; overflow: hidden;">
</iframe>
```

Query params (both optional):

- `minutes` — starting duration in minutes, 1–180 (default 5)
- `autostart` — `1` or `true` to start counting down immediately (default off)

The widget scales with width/height given to the iframe. More params (colors, etc.) may be added later; unset ones just fall back to their defaults.

## How it works

The glass silhouette is generated from a single smooth width-profile function (rim → shoulder → neck), sampled into an SVG path. The sand fill is derived from that same function, so the sand always sits flush against the glass walls. Sand levels are computed from the actual cross-sectional area of the bulb (not just a linear height), so the surface drops and the pile grows at a physically plausible, non-linear rate. A lightweight canvas layer draws the individual falling grains on top of the SVG.

Built with vanilla HTML, CSS, and JavaScript — no frameworks, no dependencies.

## Roadmap

- [x] **Phase 1 (this):** a single, configurable hourglass. 
- [ ] **Phase 2:** multiple hourglasses side by side with presets (5 / 25 / 30 min + custom) for the Pomodoro method.
- [ ] **Phase 3:** automatic mode (sound + auto-start of the next timer, alternating focus/break) vs. manual mode.
