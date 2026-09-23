# InfectedVoices-Web

Browser studio and `/get` download hub.

**InfectedVoices Core** ([grimvirusoffical-source/InfectedVoices](https://github.com/grimvirusoffical-source/InfectedVoices)) is the feature-parity source. Free, Basic, and Pro, including the once-each 7-day Basic and Pro trials, live in Core. This repository consumes that browser build. It does not fork DSP.

Pinned commit: `2fb04c2ce1ac4e49ea9105207f436b8b6cf1d80d` (Stress CLEAR BAR PASS, Cap PR #3). The pin is `core-pin.json`.

## Routes

| Path | What it serves |
|---|---|
| `/voices` | Core `npm run build:browser` (`browser-dist`), staged by `scripts/sync-core.mjs` |
| `/get` | Core `download/index.html`, with the unprovisioned Windows section kept honest |
| `/download` | The same page as `/get` |

`/get` is the Store-only mobile page: iPhone and iPad from the App Store, Android from Google Play. That page does not offer a raw ipa or aab. Mac is Open web at `/voices`; no Mac `.app` is published. Windows says “Windows installer from Releases when available.” and links “View Windows Releases” to [InfectedVoices-Windows Releases](https://github.com/grimvirusoffical-source/InfectedVoices-Windows/releases/latest). It does not say Signed and it does not show a SHA-256 until that Releases page has a real Authenticode installer.

Refreshing the pin does not cut a Windows Release and does not upload to EAS. Those stay in Core.

## Sync

```bash
node scripts/sync-core.mjs
```

The script checks out Core at the pin (web/browser paths only: `scripts`, `browser-src`, `studio`, `mobile-src`, `vendor`, `download`, `assets`), runs `npm run build:browser`, copies that payload to `voices/`, and copies Core `download/index.html` to `get/index.html` and `download/index.html`. If that Core page still claims a signed Windows build or shows a SHA-256, the sync rewrites only the Windows section to the unprovisioned Releases link. Store-only mobile and the Mac Open web card stay as Core wrote them.

## Serve

```bash
node scripts/serve.mjs
```

Listens on port 8080 (`PORT` overrides). `/voices` redirects to `/voices/` so the studio's relative assets resolve. `/get` and `/download` both return the Core download page. Logged-out `GET /api/me` returns `{ "user": null }` so the studio gate can render. Account connect stays on the Core RedX host.

```bash
node scripts/verify-shell.mjs
```
