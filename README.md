# Chicago Fire FC — Keep It Up Challenge

A lightweight, self-contained tap-to-juggle mini-game built for embedding in the Chicago Fire FC mobile app via a `WebView`. No build step, no external dependencies — plain HTML/CSS/JS.

## Files

```
index.html          Markup + overlays (start / win / lose screens)
css/style.css        All styling, brand colors, responsive/portrait rules
js/game.js           Game loop, physics, hit detection, confetti, audio cues
assets/              (empty — see "Logo asset" below)
```

Everything needed to run the game is these four items. `.claude/` is local preview tooling for this session only and is excluded via `.gitignore` — it doesn't need to ship.

## Gameplay

- Tap anywhere on screen to knock the ball back up as it falls through the on-screen hit zone.
- Each successful hit increases the streak counter and slightly raises ball speed/gravity (harder timing as the streak grows).
- Missing (letting the ball fall past the hit zone without a tap) resets the streak to 0, but play continues — the ball relaunches automatically.
- **Win:** reach a streak of **10** consecutive hits before the **45-second** cap. Triggers confetti + "You Won!" + a **YOUR PRIZE** button linking to:
  `http://www.chicagofirefc.com/app/keepup-prize/`
- **Lose:** timer hits 0 before reaching a streak of 10. Shows "So close! Make it to 10 to win." + a **Try Again** button that fully resets the game.

All thresholds live at the top of `js/game.js` (`WIN_STREAK`, `TIME_CAP`, `GRAVITY_BASE/MAX`, etc.) if these ever need tuning.

## Logo asset

`assets/` is currently empty. The crest in the header is a **placeholder** flame badge built from inline SVG (brand colors, no trademarked artwork) — it is *not* the official Chicago Fire FC crest. Drop the official logo file (SVG preferred) into `assets/` and swap the `<svg class="crest-svg">` block in `index.html` for an `<img>` tag pointing at it before shipping to production.

## Brand colors used

| Token | Hex | Usage |
|---|---|---|
| Fire red | `#FF0000` | primary buttons, accents |
| Fire dark red | `#AA0000` | button shading, ball panels |
| Fire navy | `#171A45` | backgrounds, ball panels |
| Fire black | `#160C26` | base background |
| Fire sky | `#7DCCF0` | HUD accents, crest border, hit-zone tint |

## Deploying via GitHub (for WebView hosting)

1. Push this folder to a GitHub repo.
2. Enable **GitHub Pages** (Settings → Pages → deploy from `main` branch, root).
3. Point the native app's `WebView` at the published Pages URL (e.g. `https://<org>.github.io/<repo>/`).
4. Confirm the app's WebView allows JavaScript and does **not** force a fixed zoom/scale that would fight the game's own viewport lock.

## Native WebView integration notes

- **Portrait-only:** the page shows a "please rotate" overlay in landscape via CSS, but the *native app* should still lock the WebView's host screen to portrait — CSS can't force device orientation.
- **Prize link interception:** the `YOUR PRIZE` button is a real `<a href="http://www.chicagofirefc.com/app/keepup-prize/" target="_blank">`. If the native shell wants to intercept this tap (e.g., to open its own in-app browser or a deep link) instead of letting the WebView navigate, define `window.onPrizeClaim = function(url) { ... }` in the WebView's JS environment *before* the page's own script runs — `game.js` calls it if present, in addition to the normal link behavior.
- **No external network calls** are made by the game itself except the final prize link, so it works fully offline once loaded (useful if the app pre-caches the WebView bundle).
- **Audio:** a few tiny synthesized tap/win sound cues are generated in-browser via the Web Audio API (no audio files to bundle). They initialize on the first tap (satisfies mobile browsers' user-gesture requirement for audio) and fail silently if the WebView's audio permissions are restricted.

## Local preview (optional, for development only)

Any static file server works, e.g. from this folder:

```bash
npx serve .
```

Then open the printed `localhost` URL in a mobile-sized browser window.
