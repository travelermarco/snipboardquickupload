/* Snipboard Quick Upload — content script
   Injected on every page (except snipboard.io itself).
   Adds a floating camera button (bottom-left) that:
     1. Reads an image from the system clipboard
     2. Sends it to the background service worker for upload
     3. Writes the resulting Snipboard URL back to the clipboard
     4. Shows a brief toast notification
*/
(function () {
  'use strict';

  // Avoid double-injection (e.g. in dynamically loaded pages)
  if (document.getElementById('snipboard-btn')) return;

  /* ── Styles ── */
  const STYLE = `
    #snipboard-btn {
      position: fixed;
      bottom: 20px;
      left: 20px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      border: none;
      background: linear-gradient(145deg, #4a90e2, #2b6bd6);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 3px 12px rgba(66,133,244,.45), 0 1px 4px rgba(0,0,0,.25);
      transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease;
      z-index: 2147483647;
      padding: 0;
      outline: none;
      -webkit-user-select: none;
      user-select: none;
    }
    #snipboard-btn:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 18px rgba(66,133,244,.55), 0 2px 6px rgba(0,0,0,.3);
    }
    #snipboard-btn:active { transform: scale(.93); }
    #snipboard-btn:disabled { opacity: .7; cursor: default; transform: none; }

    #snipboard-btn svg.snip-icon { width: 24px; height: 24px; display: block; }
    #snipboard-btn .snip-spinner {
      display: none;
      width: 22px; height: 22px;
      border: 3px solid rgba(255,255,255,.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: snip-spin .65s linear infinite;
    }
    #snipboard-btn.snip-loading svg.snip-icon { display: none; }
    #snipboard-btn.snip-loading .snip-spinner { display: block; }
    @keyframes snip-spin { to { transform: rotate(360deg); } }

    #snipboard-toast {
      position: fixed;
      bottom: 78px;
      left: 20px;
      max-width: 320px;
      padding: 9px 14px;
      border-radius: 9px;
      font: 600 12.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #fff;
      word-break: break-all;
      box-shadow: 0 4px 14px rgba(0,0,0,.28);
      z-index: 2147483646;
      pointer-events: none;
      animation: snip-fade-in .2s ease;
    }
    #snipboard-toast.snip-info    { background: #444c5c; }
    #snipboard-toast.snip-success { background: #1f7a4a; }
    #snipboard-toast.snip-error   { background: #b71c1c; }
    @keyframes snip-fade-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes snip-fade-out {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  (document.head || document.documentElement).appendChild(styleEl);

  /* ── Button ── */
  const btn = document.createElement('button');
  btn.id = 'snipboard-btn';
  btn.title = 'Carica immagine clipboard → Snipboard.io';
  btn.setAttribute('aria-label', 'Snipboard Quick Upload');
  btn.innerHTML = `
    <svg class="snip-icon" viewBox="0 0 24 24" fill="none"
         stroke="white" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round"
         xmlns="http://www.w3.org/2000/svg">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8
               a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
    <div class="snip-spinner"></div>
  `;
  document.body.appendChild(btn);

  /* ── Toast ── */
  let toastEl = null;
  let toastTimer = null;

  function showToast(msg, type = 'info', duration = 4000) {
    if (toastEl) { toastEl.remove(); clearTimeout(toastTimer); }
    toastEl = document.createElement('div');
    toastEl.id = 'snipboard-toast';
    toastEl.className = `snip-${type}`;
    toastEl.textContent = msg;
    document.body.appendChild(toastEl);

    toastTimer = setTimeout(() => {
      if (!toastEl) return;
      toastEl.style.animation = 'snip-fade-out .3s ease forwards';
      setTimeout(() => { toastEl && toastEl.remove(); toastEl = null; }, 300);
    }, duration);
  }

  /* ── Clipboard helpers ── */
  async function readClipboardImage() {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          return { blob, mimeType: type };
        }
      }
    }
    return null;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result); // data:image/...;base64,...
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /* ── Click handler ── */
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('snip-loading')) return;

    btn.classList.add('snip-loading');
    btn.disabled = true;

    try {
      /* 1. Read clipboard */
      let imageData;
      try {
        imageData = await readClipboardImage();
      } catch (err) {
        const msg = err?.message || '';
        if (msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('permission')) {
          showToast('Accesso clipboard negato. Consenti l\'accesso negli appunti.', 'error', 5000);
        } else {
          showToast('Impossibile leggere la clipboard: ' + msg, 'error');
        }
        return;
      }

      if (!imageData) {
        showToast('Nessuna immagine nella clipboard. Fai uno screenshot prima.', 'error');
        return;
      }

      /* 2. Convert blob to base64 for message passing */
      showToast('Caricamento su Snipboard.io…', 'info');
      const base64 = await blobToBase64(imageData.blob);

      /* 3. Ask background to upload */
      let response;
      try {
        response = await chrome.runtime.sendMessage({
          action: 'upload',
          base64,
          mimeType: imageData.mimeType,
        });
      } catch (err) {
        showToast('Errore di comunicazione con l\'estensione: ' + err.message, 'error');
        return;
      }

      /* 4. Handle result */
      if (response && response.success) {
        try {
          await navigator.clipboard.writeText(response.url);
          showToast('✓ Link copiato: ' + response.url, 'success', 6000);
        } catch {
          // Clipboard write failed (e.g., on about: pages) — still show the URL
          showToast('✓ Upload OK: ' + response.url + ' (copia manuale)', 'success', 8000);
        }
      } else {
        const err = (response && response.error) || 'Errore sconosciuto';
        showToast('Upload fallito: ' + err, 'error');
      }
    } finally {
      btn.classList.remove('snip-loading');
      btn.disabled = false;
    }
  });
})();
