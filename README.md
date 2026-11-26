# Pingrid

**Local-first uptime & SSL wallboard.** Part of the Syntrope family: single-purpose tools, no accounts, no cloud, no telemetry.

Pingrid checks your sites and APIs, reads their TLS certificates directly, and fills any screen with an equal-tile status board, from an Android phone in portrait to a 4K monitor on the wall. It alerts you via OS notifications, Telegram, or a webhook when something goes down, comes back, or a certificate is about to expire.

One codebase, three targets:

| Target | Shell | Storage | HTTP check | Certificates |
|---|---|---|---|---|
| macOS / Windows / Linux | Tauri v2 | SQLite (`tauri-plugin-sql`) | Rust `reqwest` | Rust `rustls` handshake + `x509-parser` |
| Android | Tauri v2 | SQLite | Rust `reqwest` | Rust `rustls` |
| Browser / PWA | none | IndexedDB (localStorage fallback) | `fetch` (no-cors) | via optional proxy |

---

## Quick start

### Prerequisites

- Node.js 20+ and npm
- Rust 1.77+ (`rustup`), only for native builds
- Platform deps for Tauri: see <https://v2.tauri.app/start/prerequisites/>
  - macOS: Xcode Command Line Tools
  - Windows: WebView2 (preinstalled on Windows 11) + MSVC build tools
  - Linux: `libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev`

```bash
npm install
```

The Tauri CLI is a dev dependency, so `npm run tauri …` works without `cargo install tauri-cli`. If you prefer `cargo tauri build`, install it once with `cargo install tauri-cli --version "^2"`.

### Web / PWA

```bash
npm run dev          # http://localhost:1420
npm run build        # type-check + production build into dist/
npm run preview      # serve dist/ on http://localhost:4173
```

`dist/` is a static site. Host it anywhere (any static host, an nginx folder, a NAS). The service worker caches the app shell so it opens offline, and it can be installed as a PWA from the browser menu.

### Desktop (macOS / Windows / Linux)

```bash
npm run tauri:dev    # native window with hot reload
npm run tauri:build  # installers in src-tauri/target/release/bundle/
```

Build on each OS for that OS's installers (`.app`/`.dmg`, `.msi`/`.exe`, `.deb`/`.rpm`/`.AppImage`). For macOS only the app bundle: `npm run tauri build -- --bundles app`.

The release profile uses `opt-level = "s"`, LTO, `panic = "abort"` and stripping, and the TLS stack uses the `ring` provider (no cmake/nasm). The macOS `.app` is 6.4 MB (see [Bundle size](#bundle-size)).

### Android

Requires Android Studio, SDK, NDK, and `JAVA_HOME` set as described in the [Tauri Android guide](https://v2.tauri.app/start/prerequisites/#android).

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npm run android:init     # generates src-tauri/gen/android (once)
npm run android:dev      # run on a device or emulator
npm run android:build    # release APK
```

After `android:init`, make sure `src-tauri/gen/android/app/src/main/AndroidManifest.xml` has `<uses-permission android:name="android.permission.INTERNET" />` (Tauri adds it by default) and, for Android 13+, `POST_NOTIFICATIONS` (the notification plugin adds it).

---

## Using it

1. Start the app. The board is empty, with **+ Add resource** and **Load demo resources**.
2. Add a URL. On `https://` addresses Pingrid reads the certificate as soon as you leave the field and suggests **Auto** or **Manual** renewal from the issuer (Let's Encrypt, ZeroSSL, Google Trust Services, Amazon → Auto).
3. Click any tile to edit it: give it its own check interval, pause it, or delete it. Hover a tile for **Check now**. A tile with its own interval shows it next to the last-check time.
4. **Settings** (gear icon): default check interval (30 s / 1 min / 5 min), timeout, language, theme, alert channels, SSL thresholds, import/export.

Ukrainian is the default language. Switch with the **УКР | ENG** control in the top bar (or Settings → General). Everything in the interface and in alert messages is translated; resource names you typed stay as they are.

### Supporting the project

The heart icon in the top bar (on phones: Settings → General → Support the project) opens a donation page. It links to a **monobank jar** when the interface is Ukrainian and to **Patreon** when it is English.

Set the links in `src/lib/donate.ts`, or at build time:

```bash
VITE_DONATE_MONOBANK_URL=https://send.monobank.ua/jar/XXXXXXXXXX \
VITE_DONATE_PATREON_URL=https://www.patreon.com/c/<name> \
npm run tauri:build
```

Only `https://send.monobank.ua/jar/…` and `https://(www.)patreon.com/…` (including `/c/<name>`) links are accepted; anything else leaves the button disabled. Native builds open them in the system browser through `tauri-plugin-opener`, whose permission is scoped to exactly those two hosts in `src-tauri/capabilities/default.json`.

### Tile states

| Look | Meaning |
|---|---|
| Neutral/emerald edge, `ONLINE` | Responding below HTTP 400 |
| Amber `RETRYING` | First check failed, confirming in 15 s |
| Amber edge | Certificate inside the warning window |
| Pulsing crimson, `OFFLINE`, live `Down for` counter | Two consecutive failed checks |
| Crimson edge, `SSL EXPIRED` | Certificate past `notAfter` |
| Dimmed, `PAUSED` | Checks paused |

The renewal badge shows **Auto** or **Manual**. A dashed border means Pingrid inferred it from the issuer and you have not set it yourself.

### Layout rules

- Tiles always split the space below the top bar equally. The layout engine (`computeGrid` in `src/engine/rules.ts`) tries every column count and picks the one closest to a 1.6:1 tile with the fewest empty cells.
- Minimum readable tile: **260 × 170 px**. When equal division would go below that, columns lock to the densest readable count and the board scrolls vertically, with row height chosen so a whole number of rows fits the screen.
- Type inside tiles scales with the tile (CSS container queries), so a 6×4 board on a 4K screen stays readable across a room.
- **Incidents first** (top bar toggle) moves offline, expired, and warning tiles to the top-left, with an animated reorder.
- **Keep the screen on** (eye icon in the top bar, or Settings → General) while resources are on the board. Desktop builds ask the OS directly through the Rust `keep_awake` command: an IOKit power assertion on macOS (visible in `pmset -g assertions`), `SetThreadExecutionState` on Windows, systemd-inhibit on Linux. WKWebView and WebKitGTK have no Screen Wake Lock API. Android and browsers use the Screen Wake Lock API.

---

## Monitoring & alert rules

- **Polling:** each resource is checked on its own interval if it has one (30 s / 1 min / 5 min, set in the resource editor), otherwise on the default from Settings → General (1 min out of the box). A scheduler looks every 2 s for resources whose time has come, oldest first, at most 6 in parallel. New or edited resources are checked right away. A check is a `GET` that follows redirects. Latency is time to response headers on a fresh connection (DNS + TCP + TLS included). HTTP status below 400 means online.
- **Anti-flapping:** a failed check does not alert. Pingrid retries after **15 s**; only a second consecutive failure marks the resource `OFFLINE` and fires the alert. The outage start time is the first failure.
- **State transitions:** `ONLINE → OFFLINE` sends an alert. `OFFLINE → ONLINE` sends a recovery alert with the total downtime. Downtime survives app restarts.
- **SSL schedule:** certificates are re-read every 6 h, every 30 min inside the last 7 days (to catch renewals), and 10 min after an error. Threshold rules run on every check, plus a timer set for the exact `notAfter` moment.
- **SSL thresholds** (default 30/14/7/3/1 days, configurable):
  - each threshold fires once per certificate;
  - if several are crossed at once (you add a site with 5 days left), only the tightest one fires;
  - **at the moment of expiry** a critical alert fires;
  - a newer certificate on a resource you were warned about sends a "certificate renewed" message and resets the thresholds.
- **Auto-renewal resources:** warnings at or above the urgent limit (default 5 days) are skipped. Below 5 days you get one urgent "auto-renewal failed?" alert, because ACME clients renew around 30 days before expiry.

### Delivery channels

All delivery happens on the device. There is no Pingrid server.

| Channel | Native (Tauri) | Browser |
|---|---|---|
| OS notification | `tauri-plugin-notification` | Notifications API (through the service worker on Android Chrome) |
| Sound | WebAudio two-tone chime, no audio files | same |
| Telegram | Rust `POST` to `api.telegram.org/bot<token>/sendMessage` | urlencoded `fetch` (CORS simple request) |
| Webhook | Rust `POST` JSON | `fetch` JSON; falls back to a `no-cors` `text/plain` POST when the endpoint refuses CORS (Slack) |

**Telegram setup:** create a bot with @BotFather, send it any message, then get your chat ID (for example from `https://api.telegram.org/bot<token>/getUpdates`). Paste both into Settings → Alerts and press **Send test**.

**Webhook payload** (one shape for Slack, Discord, and custom receivers):

```json
{
  "text": "🔴 Billing API is down — api.example.com is not responding. timeout",
  "content": "…same line, for Discord…",
  "source": "pingrid",
  "event": "down",
  "severity": "critical",
  "title": "Billing API is down",
  "message": "api.example.com is not responding. timeout",
  "resource": { "id": "…", "name": "Billing API", "url": "https://api.example.com/" },
  "at": "2026-11-26T09:58:00.000Z",
  "error": "timeout"
}
```

`event` is one of `down`, `up`, `ssl-warning`, `ssl-expired`, `ssl-autorenew-broken`, `ssl-renewed`, `test`. Optional fields: `downtimeMs`, `daysLeft`, `sslExpiresAt`.

---

## Browser mode and the optional proxy

A browser cannot read TLS certificates, and CORS hides HTTP status codes from cross-origin requests. Without help the PWA can only tell whether a host answered (a `no-cors` fetch) and how long it took. Tiles then show `SSL n/a`.

For full data in the browser, run the bundled zero-dependency proxy on a machine you trust:

```bash
node tools/pingrid-proxy.mjs
# pingrid-proxy listening on http://127.0.0.1:8787

# Hosted PWA on your own domain, proxy reachable on the LAN:
HOST=0.0.0.0 PORT=8787 PINGRID_ALLOW_ORIGIN=https://pingrid.example.com \
  PINGRID_PROXY_HOSTS=nas.local:8787 node tools/pingrid-proxy.mjs
```

Then set **Settings → General → CORS / SSL proxy URL** to `http://127.0.0.1:8787`. The field saves when you leave it or press Enter.

The proxy keeps other websites out in two ways. `/check` and `/tls` answer only pages from the origins in `PINGRID_ALLOW_ORIGIN` (by default the local Vite ports); requests without an `Origin` are refused. And it answers only when addressed by its own name: `127.0.0.1`, `localhost` or `[::1]` on its port, plus anything in `PINGRID_PROXY_HOSTS` (set it to the LAN name or IP when you bind to `0.0.0.0`). That blocks DNS rebinding, where a hostile site points its own domain at your machine to reach the proxy as if it were same-origin. Avoid `PINGRID_ALLOW_ORIGIN=*`: it lets any website you visit use the proxy to probe hosts reachable from that machine.

Proxy contract (if you want to write your own):

```
GET /check?url=<url>&timeout=<ms>  → { ok, status, latencyMs, error? }
GET /tls?host=<host>&port=<port>   → { notBefore, notAfter, issuer, issuerOrg, subject, sans, chainValid, validationError, protocol }
```

The native apps never need the proxy.

---

## Data & portability

Everything lives on the device: SQLite file `pingrid.db` in the app data folder (native) or IndexedDB `pingrid` (browser).

**Settings → Data:**

- **Export JSON:** resources and all settings, including alert channels. The file contains your Telegram token and webhook URL, so treat it as a secret.
- **Export CSV:** resources only, columns `name,url,checkSsl,autoRenew,paused,intervalSec` (`autoRenew` is `auto`, `manual`, or `auto-detect`; `intervalSec` is `30`, `60`, `300`, or empty for the default). Older CSVs without the last column still import.
- **Import** JSON or CSV, either **merge** (skips URLs you already have) or **replace**. Settings from a JSON file are applied, but your alert channels (Telegram, webhook) and proxy are kept unless you switch on **Also import alert channels and proxy**: a file from someone else must not be able to redirect your alerts. A CSV can also be a bare list like `My site,example.org`; missing schemes default to `https://`.

This is how you move a setup between desktop, Android, and the PWA.

---

## Project layout

```
src/
  platform/            ← the only code that knows which platform it runs on
    env.ts             isTauri detection, lazy invoke()
    storageAdapter.ts  SQLite | IndexedDB | localStorage
    networkChecker.ts  Rust commands | fetch | proxy
    notifier.ts        OS, sound, Telegram, webhook
  engine/
    rules.ts           pure logic: anti-flapping, SSL thresholds, issuer heuristics, grid math (unit-tested)
    monitor.ts         polling loop, 15 s confirmation, SSL schedule, expiry timers
  lib/                 store (useSyncExternalStore + debounced persistence), import/export, demo data
  components/          TopBar, Dashboard, Tile, ResourceEditor, SettingsPanel
  i18n/                uk.ts (default), en.ts
src-tauri/
  src/checker.rs       check_http, post_json, post_form
  src/awake.rs         keep_awake: OS display/idle-sleep assertion held on its own thread (desktop only)
  src/tls.rs           inspect_tls: rustls handshake that always completes, records real WebPKI verdict, parses leaf with x509-parser
  src/lib.rs           plugins, SQLite migrations, command registration, mobile entry point
tools/pingrid-proxy.mjs  optional browser proxy
public/                manifest, service worker, icons
```

## Diagnostics

Launch with `PINGRID_LOG_CHECKS=1` to print every check with a millisecond timestamp to stderr, for example to see how often checks really run:

```bash
open --env PINGRID_LOG_CHECKS=1 --stderr /tmp/pingrid-checks.log src-tauri/target/release/bundle/macos/Pingrid.app
```

## Tests

```bash
npm test                                   # alert rules, anti-flapping, issuer detection, grid layout, import/export
cd src-tauri && cargo test -- --ignored    # live network tests for check_http and inspect_tls
```

## Bundle size

| Artifact | Size |
|---|---|
| Web build (`dist/`, fonts included) | ~0.65 MB, ~98 KB gzipped JS |
| macOS `.app` (arm64, release) | 6.43 MB |

## Resource use

Pingrid is meant to run for days on a wallboard, so idle cost matters more than peak speed.

- **No polling.** The monitor sleeps until the earliest due check and arms one timer for it. With nothing due, the process does not wake at all.
- **Shared, aligned clocks.** All tiles share one timer per granularity, aligned to whole minutes (whole seconds only during the first minute of an outage). The top-bar clock shows minutes, not seconds.
- **Compositor-only animations.** The outage pulse and status blinks animate only `opacity` on their own layer, so the GPU runs them without repainting the page.
- **Quiet storage.** Status updates that change nothing are dropped before they reach React or SQLite. Status history is written at most every 30 s and when the window hides or closes.

Measured on macOS (Apple Silicon, one resource, 60 s sample, `top` + `footprint`):

| | Before | After |
|---|---|---|
| Memory, all 4 processes | ~125 MB | ~95 MB |
| CPU | ~1.2 % | ~0.1 % |
| Idle wake-ups/min, `pingrid` process | 10 | 0 |

With two resources down (pulsing tiles), the browser build went from 153 % to 40 % of one core in headless Chromium (software rendering, so the real app with GPU compositing is lower).

## Known limits

- **Android background:** Android pauses WebViews of apps in the background, so checks stop while Pingrid is not on screen. Keep it in the foreground (it holds a wake lock) on a wallboard device. True background monitoring would need a native foreground service.
- **Minimised or hidden window (macOS):** checks keep their schedule. By default WebKit suspends a page about 5 minutes after it stops being visible, which stopped monitoring completely; `backgroundThrottling: "disabled"` in `src-tauri/tauri.conf.json` turns that off (macOS 14+, iOS 17+). Verified on macOS: 7 minutes minimised and hidden, a check every ~60.5 s as configured.
- **Windows and Linux:** Tauri cannot change the webview's background policy there. On Chromium-based webviews (WebView2, Android) Pingrid holds a Web Lock, the documented way to avoid intensive throttling. This is not verified on Windows yet; WebKitGTK on Linux is untested. On WebKit the lock is skipped: it cost ~100 extra wake-ups a minute and gave nothing.
- **Browser background tabs** throttle timers. Install the PWA or use a native build for unattended monitoring.
- `HEAD`/custom methods, expected status codes, and keyword checks are not supported yet: any status below 400 counts as up.
- Favicons are loaded straight from each site's `/favicon.ico`. If a site has none, the tile shows a letter monogram.

## License

MIT
