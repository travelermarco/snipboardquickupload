# Security

This Chrome extension requests fairly broad permissions, worth explaining honestly:

| Permission | Why |
|---|---|
| `clipboardRead` / `clipboardWrite` | Core function: reads the image you copied, writes the resulting Snipboard.io link back |
| `<all_urls>` host permission | The content script (floating camera button) is injected on every page you visit, so the upload button is available everywhere |
| `scripting`, `tabs`, `webNavigation` | Used to open/manage the hidden background tab that performs the actual upload to Snipboard.io |
| `storage` | Caches the last-known upload endpoint for faster subsequent uploads |

What it does **not** do: no analytics, no tracking, no data sent anywhere except directly to `snipboard.io`/`i.snipboard.io` (the service the extension exists to upload to). All source is in this repo — `background.js` and `content.js` — for anyone to audit.

## Reporting a vulnerability

If you find a security issue (e.g. a way the content script could leak clipboard data to a page other than Snipboard.io), please open a GitHub issue or contact the maintainer directly rather than disclosing it publicly first.
