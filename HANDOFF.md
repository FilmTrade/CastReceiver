# HANDOFF.md — CastReceiver

Comprehensive reference for the FilmTrade Chromecast Web Receiver. This document is intended as a full onboarding doc for anyone inheriting this project cold.

---

## 1. Purpose — what this repo actually is

`CastReceiver` is a **Google Cast Web Receiver** (a.k.a. "CAF Receiver" — Cast Application Framework v3) that runs on Chromecast, Google TV, and other Cast-capable devices whenever a FilmTrade sender (the React Native app, the web app, etc.) initiates a cast session.

The entire product is a **static HTML page** — `index.html` + ~40 lines of JavaScript — hosted on **Vercel**, registered with Google's Cast SDK Developer Console as a Custom Receiver, and referenced by its App ID from each sender.

Its single unique job: **play Mux-hosted, Widevine-DRM-protected videos on Chromecast**. Everything else (UI, buffering, scrubbing, captions, idle-state branding) is handled by Google's built-in `<cast-media-player>` custom element.

The codebase is a lightly customized fork of Google's official sample receiver ([google-cast/CastReceiver](https://github.com/googlecast/CastReceiver)). The two FilmTrade-specific changes are:

1. A `setMediaPlaybackInfoHandler` that constructs a Mux Widevine license URL from `customData` passed by the sender.
2. FilmTrade-branded CSS theming (cyan accent, FilmTrade logo splash, 10-image idle slideshow).

Everything else in the repo (LICENSE, setup instructions in the README, `cast-media-player` element, debug logger boilerplate) is unchanged from the upstream sample.

### The Mux DRM Chromecast pattern in one paragraph

Mux documents this exact flow at https://www.mux.com/docs/guides/play-drm-protected-videos-on-google-cast. The sender app obtains a signed **DRM token** from Mux (separate from the regular playback token — you must explicitly request `drm` as an `audience` when signing a JWT with your Mux signing key, because Chromecasts only support Widevine). The sender loads the media onto the receiver by issuing a `LoadRequestData` whose `media.customData` contains `{ mux: { playbackId, tokens: { drm } } }`. The receiver intercepts the load via `setMediaPlaybackInfoHandler`, reads those fields, and rewrites `playbackConfig.licenseUrl` to `https://license.mux.com/license/widevine/<playbackId>?token=<drmToken>`. The CAF player then handles the Widevine challenge/response handshake against Mux's license server automatically. The receiver does **not** need the playback URL — the sender still passes `media.contentId` / `media.contentUrl` (the Mux `.mpd` or `.m3u8`) normally, signed with a separate `playback` audience token.

---

## 2. Tech stack

| Concern          | Choice                                                                     | Notes                                               |
| ---------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| Runtime          | Chromecast / Google TV (Chromium-based, runs on the cast device itself)    | Not Node, not a SPA — plain browser JS in a `<body>`|
| Framework        | Google CAF v3 (`cast_receiver_framework.js` from `gstatic.com`)            | Loaded via `<script src>` — no bundler              |
| Media element    | `<cast-media-player>` (custom element provided by CAF)                     | Handles UI, shaka-player under the hood             |
| DRM              | Widevine L1/L3 (Chromecast-native)                                         | PlayReady and FairPlay not supported on Cast        |
| DRM provider     | Mux (`license.mux.com/license/widevine/<playbackId>`)                      | License URL templated per load request              |
| Debug overlay    | `cast_receiver_logger.js` from gstatic                                     | On-screen log viewer enabled by default             |
| Hosting          | Vercel (static-site mode — no `vercel.json`, no build step needed)         | Any static HTTPS host works; Vercel is what's wired |
| Cast registration| Google Cast SDK Developer Console (https://cast.google.com/publish)        | Requires Google account, $5 one-time fee, App ID    |
| Source control   | GitHub (FilmTrade/CastReceiver) — **default branch is `master`** (not main)| Keep this in mind for any automation                |
| License          | Apache 2.0 (inherited from Google's sample)                                | See `LICENSE` at repo root                          |

There is no package manager, no lockfile, no `node_modules`, no build command. The repo is what ships.

---

## 3. Repo layout

```
CastReceiver/
├── .gitignore          # single line: .DS_Store
├── LICENSE             # Apache 2.0 (Google's, unchanged)
├── README.md           # Google's sample README, lightly edited to mention Mux
├── index.html          # 18 lines — mounts <cast-media-player> + loads SDK
├── css/
│   └── receiver.css    # Theming: cyan progress, FilmTrade splash, slideshow
├── js/
│   └── receiver.js     # THE file you'll edit — 40 lines, does the Mux DRM wiring
└── res/
    ├── filmtrade-logo.svg   # 8KB splash/logo
    ├── background-1.jpg     # unused but present
    ├── background-2.jpg     # slideshow image 1
    ├── hub-1/2/3/4.jpg      # slideshow images (large — up to 4.7MB each)
    ├── max-1/4.jpg          # slideshow images
    ├── home-1/2.jpg         # slideshow images
    ├── mini-1/2.jpg         # slideshow images
    └── logo_googleg_color_{1x,2x}_web_48dp.png  # unused — leftover from Google sample
```

Flat layout. Two code files total.

---

## 4. The only file that matters — `js/receiver.js`

Reproduced in full, annotated:

```js
// 1. Debug logger setup — lets you tail receiver logs either on-TV
//    (showDebugLogs(true) draws an overlay) or in Cast Tool
//    (https://casttool.appspot.com/cactool) when remote-debugging via Chrome.
const castDebugLogger = cast.debug.CastDebugLogger.getInstance();
const LOG_TAG = 'MUX';
castDebugLogger.setEnabled(true);
castDebugLogger.showDebugLogs(true);   // ← flip to false for production
castDebugLogger.loggerLevelByTags = {
  [LOG_TAG]: cast.framework.LoggerLevel.DEBUG,
};

// 2. Grab the singleton receiver context.
const context = cast.framework.CastReceiverContext.getInstance();

// 3. The only FilmTrade-specific logic: intercept every load request and
//    rewrite playbackConfig.licenseUrl based on Mux tokens from the sender.
context.getPlayerManager().setMediaPlaybackInfoHandler((loadRequest, playbackConfig) => {
  const customData = loadRequest.media.customData || {};

  if (customData.mux && customData.mux.tokens.drm) {
    playbackConfig.licenseUrl =
      `https://license.mux.com/license/widevine/${customData.mux.playbackId}?token=${customData.mux.tokens.drm}`;
  }

  playbackConfig.protectionSystem = cast.framework.ContentProtection.WIDEVINE;
  return playbackConfig;
});

// 4. Start listening for incoming cast sessions.
context.start();
```

### What the sender must send

The sender (RN app, web app, whatever) issues a `LoadRequestData` that looks roughly like this:

```js
const loadRequest = new chrome.cast.media.LoadRequest(
  new chrome.cast.media.MediaInfo(
    `https://stream.mux.com/${playbackId}.m3u8?token=${playbackToken}`,
    'application/vnd.apple.mpegurl'
  )
);
loadRequest.media.customData = {
  mux: {
    playbackId: '<Mux playback ID>',
    tokens: {
      playback: '<JWT signed with aud="video">',    // used in the contentId URL
      drm:      '<JWT signed with aud="drm">',       // read by the receiver
    },
  },
};
```

The `drm` token and `playback` token are **separate JWTs** with different `aud` claims. Signed with the same Mux signing key, but they are not interchangeable — a playback token will not pass the license server, and a DRM token will not authorize the manifest fetch. Both must be generated on the sender's backend (never in-app) and both should be short-lived.

### What about non-DRM videos?

The receiver gracefully degrades: if `customData.mux` is absent or `customData.mux.tokens.drm` is missing, the handler skips the license-URL rewrite. Non-DRM Mux videos (signed with only a playback token) play normally because `cast-media-player` handles HLS natively. So you can cast free/preview content through this same receiver without changes.

---

## 5. `index.html` — trivially small

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title></title>
    <link rel="stylesheet" href="css/receiver.css" media="screen" />
    <script src="//www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js"></script>
    <script src="//www.gstatic.com/cast/sdk/libs/devtools/debug_layer/caf_receiver_logger.js"></script>
  </head>
  <body>
    <cast-media-player></cast-media-player>
    <footer>
      <script src="js/receiver.js"></script>
    </footer>
  </body>
</html>
```

Two things to know:

1. The SDK script tags use protocol-relative URLs (`//www.gstatic.com/...`). Because Cast requires HTTPS, these always resolve to `https://`. Don't "fix" them to `http://` for local testing — host locally over HTTPS instead (see §8 on debugging).
2. The `<title>` is intentionally empty — Chromecast never displays it, and the branded idle screen (logo + slideshow) comes from the CSS custom properties on `<cast-media-player>` in `css/receiver.css`.

---

## 6. `css/receiver.css` — theming & idle slideshow

CAF exposes `<cast-media-player>` as a styleable custom element. The current theme:

| Property               | Value                                 | Effect                                              |
| ---------------------- | ------------------------------------- | --------------------------------------------------- |
| `--theme-hue`          | `180`                                 | Cyan accent across player controls                  |
| `--progress-color`     | `rgb(0, 255, 255)`                    | Scrubber / buffer bar color                         |
| `--splash-image`       | `res/filmtrade-logo.svg`              | Shown briefly on session start and between loads    |
| `--splash-size`        | `cover`                               | Fills the TV                                        |
| `--playback-logo-image`| `res/filmtrade-logo.svg`              | Small overlay during playback                       |
| `--slideshow-interval` | `8` (seconds)                         | How long each idle-screen image shows               |
| `--slideshow-animation`| `3` (seconds)                         | Crossfade duration between slideshow images         |
| `--slideshow-image-1..10` | `res/*.jpg`                        | Ten background images cycled while idle             |

**Heads-up on asset weight:** several of the slideshow images (`hub-1.jpg` through `hub-4.jpg`, `max-1.jpg`, `max-4.jpg`) are 2–5 MB each. The total `res/` payload is around **15 MB**. This is fine over home Wi-Fi for the one-time slideshow load, but if you ever add more images, consider running them through an optimizer (e.g. `squoosh-cli`, `imagemin`) — Chromecasts are not fast at decoding huge JPEGs.

### Full list of available CAF theming variables

See https://developers.google.com/cast/docs/caf_receiver/styling_player for the complete set (backgrounds, typography, logo positioning, progress bar variants, etc.). If you need to change anything beyond the variables currently set, start there before attempting to override DOM styles directly — `<cast-media-player>` uses Shadow DOM and is not fully penetrable from the outside.

---

## 7. Deployment — Vercel + Google Cast SDK Developer Console

Deployment is a two-step dance: host the static site somewhere with HTTPS, then tell Google about the URL.

### 7.1 Hosting on Vercel

Connected as a Vercel project. Because there's no build step, Vercel just serves the repo root as a static site. No `vercel.json` is needed, but if you want to pin things:

```json
{
  "cleanUrls": true,
  "trailingSlash": false
}
```

Deploy on push to `master` — Vercel's default Git integration. The production URL is whatever `*.vercel.app` domain (or custom domain) the project is bound to. **Get the current URL from the Vercel dashboard; it is not written down in this repo.**

Vercel requirements:
- Root directory: repo root (not `/public` or anything)
- Framework preset: **Other** (static)
- Build command: *(leave blank)*
- Output directory: *(leave blank — defaults to repo root)*
- Install command: *(leave blank)*

### 7.2 Registering with the Cast SDK Developer Console

After deploy, visit https://cast.google.com/publish:

1. Click **Add New Application** → **Custom Receiver**.
2. Give it a name (e.g. "FilmTrade Receiver Dev" / "FilmTrade Receiver Prod").
3. Set **Receiver Application URL** to the Vercel URL (must be HTTPS).
4. Save. You get a **Cast Application ID** (8-character hex) — this is the value senders use.
5. Add at least one **Sender** (the Chromecast SDK requires this before testing) — for FilmTrade that's the iOS bundle ID, Android package name, and/or the web sender origin, whichever you're testing from.
6. Add your test Chromecast's serial to **Cast Receiver Devices** (find the serial in the Google Home app → device settings). Without this, the registered-but-unpublished receiver will not launch on that device.
7. Once stable, click **Publish**. **Propagation can take up to 15 minutes — don't panic if the published version appears to 404 right after publish.**

Typical setup has **two** registered receivers — one pointing at the Vercel Preview URL for dev/staging, one at the production URL — with separate App IDs so senders can switch contexts.

### 7.3 Vercel environment variables

None. The receiver takes no env vars — all per-request data (playback IDs, tokens) arrives in `customData` from the sender at load time.

---

## 8. Debugging

There is no test suite and no local dev server. Iteration is "edit → push → Vercel deploys → cast from a sender → read logs."

### 8.1 On-device debug overlay (simplest)

The receiver has `castDebugLogger.showDebugLogs(true)` enabled in `js/receiver.js`. This renders a text log directly over the TV screen. Good for verifying "did my code even run" and "did it receive the customData I expected." Turn it off for production by flipping to `false`.

### 8.2 Chrome Remote Debugging (most powerful)

When running an **unpublished** or **devices-listed** receiver on a registered Chromecast:

1. Open `chrome://inspect` in Chrome on a laptop on the same Wi-Fi as the Chromecast.
2. Under "Other," you should see the Chromecast's IP (e.g. `192.168.1.42:9222`). Click **Configure** and add it if it doesn't appear.
3. Cast to the Chromecast from a sender.
4. Your receiver page appears under **Other** in chrome://inspect.
5. Click **inspect** — you get full Chrome DevTools: console, network, sources, the lot.

If the Chromecast doesn't appear: the receiver must be in an unpublished/dev-registered state, and your Chromecast's serial must be in the developer console's device list. Published receivers have remote debugging disabled.

### 8.3 Cast Tool web playground

https://casttool.appspot.com/cactool lets you launch a receiver by App ID, craft arbitrary `LoadRequestData` (including `customData`), and view receiver logs — all from a browser tab, no Chromecast hardware required. Best tool for iterating on the `setMediaPlaybackInfoHandler` logic specifically.

Paste your App ID, paste a test `LOAD` message JSON, hit LOAD. Logs stream live.

### 8.4 Local HTTPS

If you want to iterate without waiting for Vercel deploys, you can run a local HTTPS server and temporarily point the Custom Receiver at `https://<your-ngrok-url>`:

```bash
# from repo root
npx http-server -S -C cert.pem -K key.pem -p 8443
```

Generate a self-signed cert with `mkcert` or `openssl`. Then expose with `ngrok http 8443` and update the Receiver Application URL in the dev console. Remember: any URL change takes up to 15 minutes to propagate.

---

## 9. Working on this repo — runbook

### First-time setup

```bash
git clone git@github.com:FilmTrade/CastReceiver.git
cd CastReceiver
# nothing to install
```

### Making a change

```bash
git checkout -b docs/<something>    # or feat/<something>, fix/<something>
$EDITOR js/receiver.js              # or css/receiver.css
git add -A
git commit -m "feat: <describe>"
git push origin docs/<something>
# open PR against master (not main!)
```

### Deploying

Merge to `master`. Vercel's Git integration auto-deploys. If you need to confirm the deploy went through: check Vercel's dashboard or curl the production URL and grep for your change. Allow up to 15 minutes for the Cast SDK to start serving the new version to senders (Google caches the receiver URL aggressively).

### Bumping the CAF SDK

The SDK is loaded from `https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js` — Google manages versioning behind the `v3` path. You do not need to update anything here unless Google releases a major-version `v4`.

---

## 10. Gotchas

Twelve things that are not obvious and that have all bitten someone before.

1. **Default branch is `master`, not `main`.** Half the FilmTrade repos use `main`; this one doesn't. PR base, Vercel's production branch, and any CI must all target `master`.

2. **`customData.mux.tokens.drm` is trusted blindly.** The current handler does `if (customData.mux && customData.mux.tokens.drm)` — if the sender accidentally sends a malformed or expired token, the license request will simply fail with a Widevine error and the video will stall at "Loading". There's no client-side validation. Add defensive parsing if you see mysterious stalls in logs.

3. **The DRM token and the playback token are different JWTs.** Both are signed with the same Mux signing key but with different `aud` claims (`drm` vs. `video`/`playback`). If you swap them, Mux returns 403. Generate both server-side in the sender's backend.

4. **Only Widevine works on Chromecast.** PlayReady and FairPlay are unsupported. If a video was signed for FairPlay only, it will not play on Cast — the sender must request a Widevine-compatible token. Mux auto-handles this if you ask for `aud=drm` at signing time, but confirm.

5. **Published receivers disable remote debugging.** If `chrome://inspect` shows nothing, check whether the App ID you're casting is the published one. Use the dev-registered App ID for any debugging work.

6. **Slideshow images are HUGE.** `res/hub-3.jpg` is 4.7 MB. Chromecasts load them all on startup. If idle screens stutter, compress these before adding more.

7. **There's no linter, formatter, or CI.** Syntax errors in `receiver.js` will **not** fail the Vercel build — Vercel just serves the file. You'll only notice when the cast session starts and the receiver silently dies. Always open DevTools via `chrome://inspect` after a change to confirm there are no runtime errors.

8. **`showDebugLogs(true)` should be flipped to `false` before prod.** Otherwise end users see a giant log overlay on their TV. The production deploy currently ships with it enabled — consider wrapping it in a `window.location.hostname.includes('vercel.app')` check or similar.

9. **Cast SDK URL changes take up to 15 minutes to propagate.** Google caches the receiver URL at the CDN layer. If you re-point the App ID to a new URL and nothing appears to change, you're not crazy — wait it out.

10. **No `vercel.json` means no headers/redirects.** If we ever need CORS, COEP/COOP, or similar for advanced DRM scenarios, add a `vercel.json`. Currently none are required because Mux's license server handles CORS itself.

11. **Two App IDs is the expected norm.** One dev, one prod. If you ever see only one in the developer console and people are testing against production, that's a bug — ask before merging anything risky.

12. **`.gitignore` only contains `.DS_Store`.** Be careful — `npm install` (even accidentally) would drop a `node_modules/` into the repo root and get served by Vercel as a giant static tree. If you ever add any Node tooling, extend `.gitignore` first.

---

## 11. Related repos & external systems

| Thing                             | Where                                                        | Relationship                                                  |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| Upstream Google sample            | https://github.com/googlecast/CastReceiver                   | This repo is a light fork                                     |
| Mux Cast DRM guide                | https://www.mux.com/docs/guides/play-drm-protected-videos-on-google-cast | The canonical reference for the sender↔receiver contract      |
| CAF Receiver docs                 | https://developers.google.com/cast/docs/caf_receiver         | SDK reference                                                 |
| Cast Media Player styling         | https://developers.google.com/cast/docs/caf_receiver/styling_player | Full list of CSS custom properties for `<cast-media-player>`  |
| Cast SDK Developer Console        | https://cast.google.com/publish                              | Where App IDs live                                            |
| Cast Debugging guide              | https://developers.google.com/cast/docs/debugging            | Remote debug / Cast Tool                                      |
| `filmtrade-rn-app`                | FilmTrade/filmtrade-rn-app                                   | The React Native sender that builds `customData` with Mux tokens |
| `filmtrade-web-app`               | FilmTrade/filmtrade-web-app                                  | The web sender (if/when Cast support is added there)          |
| Mux signing infrastructure        | FilmTrade/backend-fast-api (see its HANDOFF.md §DRM)         | Where DRM JWTs are signed before being handed to senders      |

---

## 12. Quick "I need to..." index

| Task                                            | Where to go                                               |
| ----------------------------------------------- | --------------------------------------------------------- |
| Change the license URL template                 | `js/receiver.js`, line with `playbackConfig.licenseUrl =` |
| Change the idle slideshow images                | `css/receiver.css` `--slideshow-image-N` + `res/*.jpg`    |
| Change the splash logo                          | Replace `res/filmtrade-logo.svg`                          |
| Change theme color                              | `css/receiver.css` `--theme-hue` and `--progress-color`   |
| Disable the on-screen debug log before prod     | `js/receiver.js` → `castDebugLogger.showDebugLogs(false)` |
| Add support for a non-Mux DRM provider          | Add another branch in `setMediaPlaybackInfoHandler` keyed on `customData.<provider>` |
| Register a new Chromecast for testing           | https://cast.google.com/publish → Cast Receiver Devices   |
| Point the App ID at a different URL             | https://cast.google.com/publish → your Custom Receiver → Receiver Application URL (wait 15 min) |
| See what the receiver is logging                | `chrome://inspect` on same Wi-Fi, or casttool.appspot.com |
| Test a fake `LOAD` request without a sender     | https://casttool.appspot.com/cactool                      |
