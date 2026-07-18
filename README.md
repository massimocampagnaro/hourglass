# Hourglass

A minimal, configurable hourglass timer — use it standalone, side by side with others, or as a Pomodoro-style focus/break timer with an automatic mode that alternates sessions on its own.

Preview: https://massimocampagnaro.github.io/hourglass

## Multiple hourglasses

Click **Add** next to the hourglass row to bring in a second or third one (three is the cap — enough for most non-Pomodoro setups without cluttering the row). A new hourglass opens straight into its setup panel: pick the duration (a preset or any custom number of minutes), an optional short label, one of eight sand colors, and one of three done sounds — everything previews live on the hourglass itself. **Done** locks it in; **Cancel** discards a brand-new card or reverts an edited one. Once locked, a card shows just the hourglass, the time, and four small controls: start/pause, reset, edit (reopens the setup panel), and remove (disabled while only one card remains).

Each hourglass renders at a size proportional to its own duration (a 25-minute glass reads as visibly bigger than a 5-minute one, though never absurdly so — the scaling is deliberately damped) and keeps its own color, sound and countdown fully independent of the others.

### Pomodoro preset

The **Pomodoro** button replaces the current row with exactly two fixed hourglasses — a 25-minute **Focus** (red) and a 5-minute **Break** (green) — and switches on automatic mode. Nothing starts on its own; press play on Focus when you're ready.

### Automatic mode

The **Automatic mode** toggle turns the row into a loop: pressing play on any card starts a sequence there, and each time that card's sand runs out, it plays its done sound and the *next* card in the row resets and starts on its own — cycling through every card, in order, indefinitely, until you pause or reset it. Pressing play on the currently-running card pauses it in place (press again to resume from there); pressing play on a different card jumps the sequence to start fresh from that one instead. With only one hourglass, this just means it restarts itself each time it finishes. Editing and removing cards is disabled while a sequence is running — pause or reset first.

Turn automatic mode off and every card goes back to behaving independently, exactly like in manual mode.

### Shareable links

The address bar always mirrors the current row, so copying it hands over a link that opens back up exactly as configured — no separate "share" button needed.

What actually ends up in the address bar is a single packed `?p=` param — a short positional encoding of every card's duration/color/sound/label plus automatic mode, instead of one query param per field. It's opaque by design (not meant to be hand-edited) but keeps shared links short even with three fully customized hourglasses.

For hand-written or bookmarked links, the verbose param contract below still works exactly as documented — the app reads either form, it just no longer writes the verbose one itself.

With a single hourglass, it stays the same flat, minimal contract as before (and any old link from before Phase 2 still works), plus three new optional params:

- `minutes`: starting duration in minutes, 1–180 (default 5)
- `color`: one of `amber` (default), `ember`, `rose`, `violet`, `azure`, `teal`, `emerald`, `slate`
- `sound`: one of `done` (default), `done2`, `done3` — see [Sounds](#sounds)
- `label`: a short optional caption shown above the hourglass

Params left at their default are simply omitted, so an untouched link looks exactly like `?minutes=5` always has.

With two or three hourglasses, each one's `minutes` / `color` / `sound` / `label` are namespaced by position — `h1_`, `h2_`, `h3_` — e.g.:

```
?h1_minutes=25&h1_color=ember&h1_label=Focus&h2_minutes=5&h2_color=emerald&h2_label=Break&auto=1
```

A color or sound left unset on an indexed hourglass still auto-picks one not already used by another card in the link, the same way clicking **Add** does — only `minutes` is required per card. Any hourglass beyond the third is ignored.

`auto=1` (automatic mode) is independent of all of the above and applies either way.

No link — single or multi-card — ever autostarts a countdown on load (an old `autostart=1` is simply ignored). A browser won't let a page play its own "done" sound or show a notification without a prior click/keypress on that page, so every session here deliberately starts from a Play/Space/F press, which doubles as that unlock. The embed widget below is the exception, for reasons explained there.

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

Note this widget's own `sound` (on/off) is a separate, embed-only contract — it doesn't share meaning with the main app's `sound` param (a sound *choice*) described under [Shareable links](#shareable-links) above; each page defines its own params independently.

Unlike the main app, the embed widget *does* support `autostart` — it's placed on a page precisely to run as part of that page's content, not pressed play on by hand. That reintroduces the same no-gesture problem though: this frame's own `sound=1` chime may be silently blocked by the browser until someone interacts with the widget directly (e.g. flips it). So on completion the widget also does `window.parent.postMessage({ source: 'hourglass-embed', type: 'done' }, '*')` — the host page has almost certainly had *some* interaction by then, so it's a more reliable place to raise an alert (a sound, a toast, whatever fits the host page) than the iframe itself:

```js
window.addEventListener('message', (e) => {
    if (e.data && e.data.source === 'hourglass-embed' && e.data.type === 'done') {
        // e.g. playYourOwnChime() or doSomething();
    }
});
```

## How it works

The glass silhouette is generated from a single smooth width-profile function (rim → shoulder → neck), sampled into an SVG path. The sand fill is derived from that same function, so the sand always sits flush against the glass walls. Sand levels are computed from the actual cross-sectional area of the bulb (not just a linear height), so the surface drops and the pile grows at a physically plausible, non-linear rate. A lightweight canvas layer draws the individual falling grains on top of the SVG. Each hourglass on the page is a fully independent instance — its own SVG, its own gradient ids, its own timer — so several can run side by side with different durations, colors and sounds without interfering with each other.

Built with vanilla HTML, CSS, and JavaScript — no frameworks, no dependencies. `js/hourglass.js` is the rendering/timer engine, `js/cards.js` owns the row of cards and the automatic-mode sequencer, and `js/app.js` wires both up to the page's header controls.

### Sounds

All three selectable sounds ship in the repo: `sounds/done.mp3` (the default), `sounds/done2.mp3` and `sounds/done3.mp3` (used for the Pomodoro preset's Focus/Break, and selectable on any custom card) — small synthesized bell chimes, generated rather than sourced, so there's no licensing question. Replace any of them with your own recording under the same filename to swap the sound; picking a sound whose file happens to be missing just stays silent rather than erroring.

## Roadmap

- [x] **Phase 1:** a single, configurable hourglass.
- [x] **Phase 2:** multiple hourglasses side by side (up to three) with presets (5 / 25 / 30 / 60 min + custom), proportional sizing, per-hourglass color/sound/label, and a one-click Pomodoro preset.
- [x] **Phase 3:** automatic mode — sound + auto-start of the next timer, looping through every hourglass in order until stopped — vs. independent manual mode.

## Development

No build step — open `index.html` directly, or serve the repo root over any static file server.

Tests use [Playwright](https://playwright.dev):

```bash
npm install
npx playwright install chromium
npm test
```

`playwright.config.js` serves the repo with Python's built-in `http.server`, so no other dev-server dependency is needed. One test in `tests/pomodoro-automatic.spec.js` runs two real (non-mocked) 1-minute timers end to end to prove the automatic sequencer actually advances — that one takes about a minute by itself.

## License

[MIT](LICENSE) © 2026 Massimo Campagnaro
