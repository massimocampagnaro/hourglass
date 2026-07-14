# Hourglass

A minimal, configurable hourglass timer — use it standalone or as a Pomodoro-style focus/break timer.

Preview: https://massimocampagnaro.github.io/hourglass

## Embedding

Drop just the hourglass and the time readout into another page as a transparent, borderless widget without header, footer or buttons:

<p align="center">
    <img height="300" alt="hourglass" src="https://github.com/user-attachments/assets/dac5d41f-6c5d-419b-aacd-16a25fec3ff8" />
</p>


```html
<iframe
    src="https://massimocampagnaro.github.io/hourglass/embed/?minutes=5&autostart=1"
    style="width: 100%; max-width: 280px; aspect-ratio: 9/11; border: none;">
</iframe>
```

`9/11` renders the widget at (close to) its full size; just set a width (or a height) and `aspect-ratio` derives the other one.

Query params (all optional):

- `minutes`: starting duration in minutes, 1–180 (default 5)
- `autostart`: `1` or `true` to start counting down immediately (default off)
- `theme`: `light` for embedding on a light page (darkens the time text; the hourglass itself is unchanged). Default is the dark theme above.
- `sound`: `1` to play a chime when the timer finishes (default off — silent unless asked for)
- `keepsand`: `1` to make flipping pour the actual sand across instead of resetting it (default off — flip always starts the next run fresh)

More params (more colors, etc.) may be added later; unset ones just fall back to their defaults, so existing embed links keep working.

## How it works

The glass silhouette is generated from a single smooth width-profile function (rim → shoulder → neck), sampled into an SVG path. The sand fill is derived from that same function, so the sand always sits flush against the glass walls. Sand levels are computed from the actual cross-sectional area of the bulb (not just a linear height), so the surface drops and the pile grows at a physically plausible, non-linear rate. A lightweight canvas layer draws the individual falling grains on top of the SVG.

Built with vanilla HTML, CSS, and JavaScript — no frameworks, no dependencies.

## Roadmap

- [x] **Phase 1:** a single, configurable hourglass. 
- [ ] **Phase 2:** multiple hourglasses side by side with presets (5 / 25 / 30 min + custom) for the Pomodoro method.
- [ ] **Phase 3:** automatic mode (sound + auto-start of the next timer, alternating focus/break) vs. manual mode.

## License

[MIT](LICENSE) © 2026 Massimo Campagnaro
