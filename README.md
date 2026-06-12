# Snipboard Quick Upload

Chrome extension that uploads the image in your clipboard to [Snipboard.io](https://snipboard.io) with a single click and copies the resulting link automatically.

No website to open. No drag-and-drop. Just click the button.

---

## What it does

1. You take a screenshot (or copy any image).
2. You click the floating camera button that appears on every web page.
3. In 2–6 seconds the Snipboard link is already in your clipboard, ready to paste.

The extension opens a hidden background tab, uploads the image, waits until it is confirmed available on the CDN, closes the tab, and writes the URL to your clipboard — all without switching windows or interrupting your flow.

---

## Requirements

- **Google Chrome** 116 or later (or any Chromium-based browser that supports Manifest V3)
- A working internet connection
- The image must already be in your clipboard before clicking the button

---

## Installation

> The extension is not yet published on the Chrome Web Store. Install it in **Developer Mode** (takes about 30 seconds).

### Step 1 — Download the extension

Clone or download this repository to your computer:

```
git clone https://github.com/<your-org>/snipboard-quick-upload.git
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

Click **Load unpacked**, then select the folder you downloaded (`Snipboard Extection` or whatever you renamed it to).

The camera icon appears in your extensions bar and a blue circle button appears in the bottom-left corner of every web page.

---

## Usage

### On macOS

| Step | Action |
|------|--------|
| 1 | Take a screenshot with **Cmd + Shift + 4** (area) or **Cmd + Shift + 3** (full screen). macOS copies it to the clipboard automatically. |
| 2 | Switch to any browser tab. |
| 3 | Click the **blue camera button** in the bottom-left corner. |
| 4 | Wait 2–6 seconds for the toast notification. |
| 5 | Paste the link anywhere with **Cmd + V**. |

> **Tip:** On macOS 13+, if you see a clipboard permission prompt the first time you click, choose *Allow*. Chrome only asks once.

### On Windows

| Step | Action |
|------|--------|
| 1 | Take a screenshot with **Win + Shift + S** (Snipping Tool) — the screenshot goes to the clipboard automatically. Alternatively press **Print Screen** and paste into Paint, crop, then copy. |
| 2 | Switch to any browser tab. |
| 3 | Click the **blue camera button** in the bottom-left corner. |
| 4 | Wait 2–6 seconds for the toast notification. |
| 5 | Paste the link anywhere with **Ctrl + V**. |

> **Tip:** Win + Shift + S is the fastest method — it copies directly without saving a file.

---

## Permissions explained

| Permission | Why it is needed |
|------------|-----------------|
| `clipboardRead` | Read the image from your clipboard when you click the button |
| `clipboardWrite` | Write the Snipboard link back to your clipboard |
| `scripting` | Inject the paste simulation into the Snipboard tab |
| `tabs` | Open and close the hidden background tab |
| `webNavigation` | Detect when Snipboard navigates to the new image URL |
| `storage` | Cache the upload endpoint so repeat uploads are faster |
| Access to `snipboard.io` and `i.snipboard.io` | Upload the image and verify it is available on the CDN before returning the link |
| Access to all sites | Show the camera button on every web page |

---

## How it works (technical)

```
Click button
    │
    ▼
Read clipboard image (navigator.clipboard.read)
    │
    ▼
Send base64 image to background service worker
    │
    ▼
Open snipboard.io in a hidden background tab
    │
    ▼
Simulate paste event with image data (DataTransfer + ClipboardEvent)
    │
    ▼
Snipboard processes paste → calls history.pushState('/ID.jpg')  ← optimistic navigation
    │
    ▼
Background detects the new URL (webNavigation / DOM relay)
    │
    ▼
Background polls  HEAD https://i.snipboard.io/ID.jpg  every 500 ms
    │                          (tab stays open the whole time)
    ▼
CDN returns HTTP 200  →  close tab  →  return URL
    │
    ▼
Content script writes URL to clipboard + shows toast notification
```

The key design decision is that the tab is **never closed until the CDN confirms the image is actually available**. Snipboard navigates to the result URL before the upload finishes (optimistic UI), so earlier versions that closed the tab on URL detection would consistently produce broken links.

---

## Troubleshooting

**"Nessuna immagine nella clipboard"**
Make sure you copied an image, not text or a file path. On Mac: use Cmd+Shift+4. On Windows: use Win+Shift+S.

**"Accesso clipboard negato"**
Chrome is blocking clipboard access. Click the lock icon in the address bar → Site settings → Clipboard → Allow.

**The button doesn't appear on a page**
The button is hidden on `snipboard.io` itself and on `chrome://` internal pages. It appears on all regular HTTP/HTTPS pages.

**The link works but the image looks different from what I copied**
Snipboard converts all uploads to JPEG. Transparent PNGs will have a white background.

**Upload takes longer than usual**
Large images (4K screenshots etc.) may take up to 15–20 seconds. The spinner on the button shows the upload is still in progress.

---

## Development

```bash
# No build step required — plain HTML/JS/CSS
# After editing any file, reload the extension at chrome://extensions/
```

Files:

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome extension manifest (MV3) |
| `content.js` | Floating button + toast UI injected on every page |
| `background.js` | Upload logic: direct POST (cached) or tab-based paste simulation |
| `icons/` | Extension icons (16 × 16, 48 × 48, 128 × 128) |
| `create_icons.py` | Script used to generate the icons (requires Pillow) |

---

## License

MIT
