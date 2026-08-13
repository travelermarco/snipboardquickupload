# Snipboard Quick Upload

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?logo=open-source-initiative&logoColor=white)](LICENSE)
[![CI](https://github.com/travelermarco/snipboardquickupload/actions/workflows/ci.yml/badge.svg)](https://github.com/travelermarco/snipboardquickupload/actions/workflows/ci.yml)

Chrome extension (Manifest V3) that uploads the image currently in your clipboard to [Snipboard.io](https://snipboard.io) with a single click and copies the resulting link back to your clipboard automatically.

No website to open. No drag-and-drop. Just click the button.

---

## What it does

1. You take a screenshot (or copy any image).
2. You click the floating camera button that appears on every web page.
3. Within a few seconds the Snipboard link is already in your clipboard, ready to paste.

Under the hood, the extension either reuses a previously discovered upload endpoint (near-instant direct upload) or opens a hidden background tab, simulates a paste of the image on snipboard.io, and waits until the image is confirmed available on Snipboard's CDN before closing the tab and writing the URL to your clipboard — all without you switching windows or interrupting your flow.

---

## Requirements

- **Google Chrome** 116 or later (or any Chromium-based browser that supports Manifest V3)
- A working internet connection
- The image must already be in your clipboard before clicking the button

---

## Installation

> The extension is not published on the Chrome Web Store. Install it in **Developer Mode**.

### Step 1 — Download the extension

Clone this repository:

```
git clone https://github.com/travelermarco/snipboardquickupload.git
```

Or use the green **Code → Download ZIP** button on GitHub, then unzip the folder.

### Step 2 — Open Chrome Extensions

Open Chrome and navigate to:

```
chrome://extensions/
```

### Step 3 — Enable Developer Mode

Toggle the **Developer mode** switch in the top-right corner of the page.

### Step 4 — Load the extension

Click **Load unpacked**, then select the `snipboardquickupload` folder you downloaded.

The camera icon appears in your extensions bar and a blue circular button appears in the bottom-left corner of every web page (except `snipboard.io` itself).

---

## Usage

### On macOS

| Step | Action |
|------|--------|
| 1 | Take a screenshot with **Cmd + Shift + 4** (area) or **Cmd + Shift + 3** (full screen). macOS copies it to the clipboard automatically. |
| 2 | Switch to any browser tab. |
| 3 | Click the **blue camera button** in the bottom-left corner. |
| 4 | Wait for the toast notification. |
| 5 | Paste the link anywhere with **Cmd + V**. |

### On Windows

| Step | Action |
|------|--------|
| 1 | Take a screenshot with **Win + Shift + S** (Snipping Tool) — the screenshot goes to the clipboard automatically. Alternatively press **Print Screen** and paste into Paint, crop, then copy. |
| 2 | Switch to any browser tab. |
| 3 | Click the **blue camera button** in the bottom-left corner. |
| 4 | Wait for the toast notification. |
| 5 | Paste the link anywhere with **Ctrl + V**. |

> **Note:** The first time you click the button, Chrome may show a clipboard-access permission prompt — choose *Allow*.

---

## Permissions explained

| Permission | Why it is needed |
|------------|-------------------|
| `clipboardRead` | Read the image from your clipboard when you click the button |
| `clipboardWrite` | Write the Snipboard link back to your clipboard |
| `scripting` | Inject the paste-simulation and result-relay scripts into the hidden Snipboard tab |
| `tabs` | Open and close the hidden background tab used for uploading |
| `webNavigation` | Detect when Snipboard's client-side navigation (`pushState`) reveals the new image URL |
| `storage` | Cache a working upload endpoint (`chrome.storage.session`) so repeat uploads can skip the tab-based flow |
| Host access to `snipboard.io` and `i.snipboard.io` | Upload the image and verify it is available on the CDN before returning the link |
| Host access to all sites (`<all_urls>`) | Show the floating camera button and read the clipboard on every web page |

---

## How it works (technical)

The background service worker (`background.js`) tries two upload strategies, in order:

**1. Cached endpoint (fast path)**
If a working upload endpoint was discovered during a previous upload (kept in memory and in `chrome.storage.session`), the image is POSTed directly to it via `fetch`. If that succeeds, the URL is returned immediately with no tab involved.

**2. Tab-based upload with paste simulation (fallback / first run)**

```
Click button
    │
    ▼
Read clipboard image (navigator.clipboard.read)
    │
    ▼
Send base64 image to the background service worker
    │
    ▼
Open snipboard.io in a hidden background tab (active: false)
    │
    ▼
Inject an ISOLATED-world listener, then a MAIN-world script that:
  - simulates a paste event with the image (DataTransfer + ClipboardEvent)
  - wraps history.pushState/replaceState and polls the DOM as a fallback
  - writes the discovered URL into a hidden DOM element
    │
    ▼
Isolated-world script relays the URL to the background via chrome.runtime.sendMessage
(webNavigation.onHistoryStateUpdated / onCommitted are also watched as a second signal)
    │
    ▼
Background starts polling  HEAD https://i.snipboard.io/<ID>.jpg  every 500 ms
(falls back to a ranged GET if HEAD returns 405; tab stays open the whole time)
    │
    ▼
CDN returns HTTP 200 (or a 30 s hard timeout is hit) → tab is closed → URL is returned
    │
    ▼
Content script writes the URL to the clipboard and shows a toast notification
```

The key design point: the background tab is **never closed until the CDN confirms the image is actually available**. Snipboard navigates to the result URL before the upload finishes (optimistic UI), so closing the tab as soon as the URL is detected produces a broken link — this is why the CDN poll exists.

---

## Troubleshooting

The extension's on-page button and toast messages are currently written in **Italian**, regardless of the browser's language — this is a known inconsistency between the (English) documentation and the (Italian) UI strings in `content.js`.

**"Nessuna immagine nella clipboard"**
Make sure you copied an image, not text or a file path. On Mac: use Cmd+Shift+4. On Windows: use Win+Shift+S.

**"Accesso clipboard negato"**
Chrome is blocking clipboard access. Click the lock icon in the address bar → Site settings → Clipboard → Allow.

**The button doesn't appear on a page**
The button is hidden on `snipboard.io` itself and on `chrome://` internal pages. It appears on all regular HTTP/HTTPS pages.

**The link works but the image looks different from what I copied**
Snipboard converts uploads to JPEG. Transparent PNGs will get a white background.

**Upload takes longer than usual**
Large images may take longer; there is a 30-second hard timeout in the background worker, after which the best-effort URL is returned even if the CDN hasn't confirmed it yet.

---

## Development

No build step — plain JavaScript/JSON, no bundler or package manager. After editing any file, reload the extension at `chrome://extensions/`.

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push/PR to `main`: it runs `node --check` on `background.js` and `content.js`, and validates that `manifest.json` is well-formed JSON.

Files:

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome extension manifest (MV3), currently version `1.2.0` |
| `content.js` | Floating button + toast UI injected on every page |
| `background.js` | Upload logic: cached direct POST, or hidden-tab paste simulation with CDN polling |
| `icons/` | Extension icons (16×16, 48×48, 128×128) |
| `create_icons.py` | Python/Pillow script used to generate the icons |
| `.github/workflows/ci.yml` | CI: JS syntax check + manifest validation |
| `CHANGELOG.md` | Version history and detailed notes on past bug fixes |
| `SECURITY.md` | Explanation of the requested permissions and how to report issues |

---

## Security

See [`SECURITY.md`](SECURITY.md) for a rundown of why each permission is requested. In short: no analytics, no tracking, no data sent anywhere except directly to `snipboard.io` / `i.snipboard.io`.

---

## License

MIT — see [`LICENSE`](LICENSE).
