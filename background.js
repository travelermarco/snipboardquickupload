/* Snipboard Quick Upload — background service worker v1.2.0
   Upload flow:
     1. Cached endpoint → instant direct POST (if known from prior session)
     2. Tab + paste simulation → wait for CDN confirmation before closing tab

   Critical fix in v1.2.0:
     navHandler and msgHandler NO LONGER call settle() immediately on URL
     detection. Instead they start a CDN poll loop (background-side HEAD
     requests to i.snipboard.io) and only close the tab once the image is
     actually available on the CDN. This ensures the upload has time to
     complete before we destroy the tab.
*/
'use strict';

let _cachedEndpoint = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'upload') {
    handleUpload(msg.base64, msg.mimeType)
      .then(url  => sendResponse({ success: true,  url   }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

/* ─── ENTRY POINT ─── */
async function handleUpload(base64, mimeType) {
  const blob = base64ToBlob(base64, mimeType);

  if (_cachedEndpoint) {
    try {
      const url = await directPost(blob, _cachedEndpoint.url, _cachedEndpoint.field);
      if (url) return url;
    } catch (e) {
      console.warn('[Snipboard] Cached endpoint failed:', e.message);
    }
    _cachedEndpoint = null;
  }

  try {
    const stored = await chrome.storage.session.get('snipEndpoint');
    if (stored.snipEndpoint) {
      try {
        const url = await directPost(blob, stored.snipEndpoint.url, stored.snipEndpoint.field);
        if (url) { _cachedEndpoint = stored.snipEndpoint; return url; }
      } catch {}
      await chrome.storage.session.remove('snipEndpoint');
    }
  } catch {}

  return uploadViaTab(base64, mimeType);
}

/* ─── DIRECT POST (when endpoint is known) ─── */
async function directPost(blob, endpoint, field) {
  const fd = new FormData();
  fd.append(field || 'image', blob, 'screenshot.png');
  const resp = await fetch(endpoint, {
    method: 'POST', body: fd, redirect: 'follow',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (resp.status >= 400) return null;
  return extractUrl(resp);
}

async function extractUrl(resp) {
  const URL_RE = /https?:\/\/snipboard\.io\/[A-Za-z0-9]{4,10}(?:\.[a-zA-Z]{2,4})?/;
  if (URL_RE.test(resp.url)) return resp.url.match(URL_RE)[0];
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('json')) {
    try {
      const j = await resp.clone().json();
      const u = j.url || j.link || j.src || j.direct_link || (j.data && j.data.url);
      if (u && URL_RE.test(u)) return u.match(URL_RE)[0];
    } catch {}
  }
  try {
    const text = await resp.text();
    const m = text.match(URL_RE);
    if (m) return m[0];
  } catch {}
  return null;
}

/* ─── TAB-BASED UPLOAD ───
   Key architecture:
   - Open hidden tab, simulate paste
   - Detect URL via webNavigation (pushState) OR isolated world relay
   - Do NOT close the tab when URL is detected (Snipboard does optimistic
     pushState BEFORE the upload finishes)
   - Instead: poll i.snipboard.io/ID.jpg from the background every 500ms
   - Close tab only when CDN returns 200 (or after 30s hard timeout)
*/
async function uploadViaTab(base64, mimeType) {
  return new Promise(async (resolve, reject) => {
    let tabId      = null;
    let settled    = false;
    let pendingUrl = null;
    let cdnPoller  = null;

    const settle = (ok, val) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok) resolve(val);
      else reject(val instanceof Error ? val : new Error(String(val)));
    };

    const cleanup = () => {
      clearTimeout(hardTimer);
      if (cdnPoller) { clearInterval(cdnPoller); cdnPoller = null; }
      chrome.runtime.onMessage.removeListener(msgHandler);
      try { chrome.webNavigation.onHistoryStateUpdated.removeListener(navHandler); } catch {}
      try { chrome.webNavigation.onCommitted.removeListener(navHandler); } catch {}
      if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
    };

    /* Hard 30 s outer limit */
    const hardTimer = setTimeout(() => {
      if (pendingUrl) {
        console.warn('[Snipboard] CDN never confirmed; returning URL best-effort:', pendingUrl);
        settle(true, pendingUrl);
      } else {
        settle(false, new Error('Timeout 30 s — snipboard non ha risposto.'));
      }
    }, 30_000);

    /*
     * Poll i.snipboard.io/{ID}.jpg from the background.
     * The background service worker has host_permissions for i.snipboard.io
     * so it bypasses CORS and any same-origin restrictions.
     * Runs every 500 ms until the image returns HTTP 200.
     */
    function startCdnPoll(snipUrl) {
      if (cdnPoller) return; // already polling
      const baseCdnUrl = snipUrl.replace('https://snipboard.io/', 'https://i.snipboard.io/');
      console.log('[Snipboard] Starting CDN poll for:', baseCdnUrl);
      let attempts = 0;
      cdnPoller = setInterval(async () => {
        if (settled) { clearInterval(cdnPoller); return; }
        attempts++;
        /* Add nocache param to bypass any CDN-side negative caching of 403s */
        const cdnUrl = baseCdnUrl + '?nocache=' + Date.now();
        try {
          let ok = false;
          /* Try HEAD first (lightweight) */
          const r = await fetch(cdnUrl, {
            method: 'HEAD',
            cache:  'no-store',
            headers: { 'Referer': 'https://snipboard.io/' },
          });
          if (r.ok) {
            ok = true;
          } else if (r.status === 405) {
            /* HEAD not allowed — try GET with Range to avoid downloading the full image */
            const r2 = await fetch(cdnUrl, {
              method: 'GET',
              cache:  'no-store',
              headers: { 'Referer': 'https://snipboard.io/', 'Range': 'bytes=0-0' },
            });
            ok = r2.ok || r2.status === 206;
          }
          if (ok) {
            console.log('[Snipboard] CDN confirmed after', attempts, 'attempts');
            settle(true, snipUrl);
            return;
          }
          console.log('[Snipboard] CDN attempt', attempts, '→', r.status);
        } catch (e) {
          console.log('[Snipboard] CDN poll error:', e.message);
        }
        /* After 50 attempts (~25 s) give up waiting and return best-effort */
        if (attempts >= 50) {
          clearInterval(cdnPoller);
          console.warn('[Snipboard] CDN did not confirm after 50 attempts; best-effort return');
          settle(true, snipUrl);
        }
      }, 500);
    }

    /* Message from isolated-world listener in the tab */
    const msgHandler = (msg) => {
      if (msg.action !== 'snipboardFound' || msg.tabId !== tabId) return;
      if (!msg.url) return;
      if (msg.endpoint) {
        const ep = { url: msg.endpoint, field: msg.field || 'image' };
        _cachedEndpoint = ep;
        chrome.storage.session.set({ snipEndpoint: ep }).catch(() => {});
        console.log('[Snipboard] Endpoint cached:', ep.url, 'field:', ep.field);
      }
      if (!pendingUrl) {
        pendingUrl = msg.url;
        console.log('[Snipboard] URL from isolated world:', pendingUrl);
        startCdnPoll(pendingUrl);
      }
    };
    chrome.runtime.onMessage.addListener(msgHandler);

    /*
     * webNavigation fires when history.pushState changes the URL in the tab.
     * CRITICAL: we do NOT call settle() here. We only record the URL and
     * start CDN polling. The tab must stay alive until the upload finishes.
     */
    const navHandler = (details) => {
      if (details.tabId !== tabId || settled) return;
      const m = (details.url || '').match(
        /snipboard\.io\/([A-Za-z0-9]{4,10}(?:\.[a-zA-Z]{2,4})?)/
      );
      if (m && !pendingUrl) {
        pendingUrl = 'https://snipboard.io/' + m[1];
        console.log('[Snipboard] URL from navHandler:', pendingUrl);
        startCdnPoll(pendingUrl);
      }
    };
    chrome.webNavigation.onHistoryStateUpdated.addListener(navHandler);
    chrome.webNavigation.onCommitted.addListener(navHandler);

    /* Open the tab (not active so it stays in the background) */
    let tab;
    try {
      tab = await chrome.tabs.create({ url: 'https://snipboard.io/', active: false });
    } catch (e) {
      return settle(false, new Error('Impossibile aprire il tab: ' + e.message));
    }
    tabId = tab.id;

    await waitForTabLoad(tabId);
    await sleep(400); // wait for JS hydration

    try {
      /* ISOLATED world first so it's ready to relay the result */
      await chrome.scripting.executeScript({
        target: { tabId }, func: isolatedWorldListener, args: [tabId], world: 'ISOLATED',
      });
      /* MAIN world: simulate paste and monitor URL changes */
      await chrome.scripting.executeScript({
        target: { tabId }, func: mainWorldScript, args: [base64, mimeType], world: 'MAIN',
      });
    } catch (e) {
      settle(false, new Error('Injection fallita: ' + e.message));
    }
  });
}

/* ─── MAIN WORLD SCRIPT ───
   Runs inside Snipboard's JS context.
   Simulates paste and monitors the URL so the isolated world can relay it.
   Does NOT intercept fetch/XHR (removed to avoid interfering with the upload).
*/
function mainWorldScript(base64, mimeType) {
  var URL_RE = /https?:\/\/snipboard\.io\/[A-Za-z0-9]{4,10}(?:\.[a-zA-Z]{2,4})?/;
  var RESULT = '__snipboard_ext_result__';
  var written = false;

  function writeToDOM(url) {
    if (written) return;
    var m = (url || '').match(URL_RE);
    if (!m) return;
    written = true;
    var el = document.getElementById(RESULT);
    if (!el) {
      el = document.createElement('div');
      el.id = RESULT;
      el.style.cssText = 'display:none!important;position:absolute;top:-9999px';
      (document.body || document.documentElement).appendChild(el);
    }
    el.dataset.url = m[0];
    el.dataset.endpoint = '';
    el.dataset.field = '';
  }

  /* Intercept pushState / replaceState */
  function wrapHistory(name) {
    var orig = history[name].bind(history);
    history[name] = function (state, title, url) {
      var r = orig(state, title, url);
      try {
        var abs = url ? new URL(String(url), location.href).href : '';
        if (URL_RE.test(abs)) writeToDOM(abs);
      } catch {}
      return r;
    };
  }
  wrapHistory('pushState');
  wrapHistory('replaceState');

  /* Poll location.href + DOM inputs as fallback */
  var poll = setInterval(function () {
    if (written) { clearInterval(poll); return; }
    if (URL_RE.test(location.href)) { writeToDOM(location.href); return; }
    var els = document.querySelectorAll('input[readonly], input[type="text"], textarea, a[href]');
    for (var i = 0; i < els.length; i++) {
      var v = els[i].value || els[i].href || '';
      if (URL_RE.test(v)) { writeToDOM(v); return; }
    }
  }, 400);
  setTimeout(function () { clearInterval(poll); }, 32000);

  /* Paste simulation */
  try {
    var raw   = base64.indexOf(',') !== -1 ? base64.split(',')[1] : base64;
    var bin   = atob(raw);
    var bytes = new Uint8Array(bin.length);
    for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    var blob  = new Blob([bytes], { type: mimeType });
    var file  = new File([blob], 'screenshot.png', { type: mimeType });
    var dt    = new DataTransfer();
    dt.items.add(file);

    var opts = { bubbles: true, cancelable: true, clipboardData: dt };

    /* Fire on document first, then body, then common framework roots */
    document.dispatchEvent(new ClipboardEvent('paste', opts));
    if (document.body) document.body.dispatchEvent(new ClipboardEvent('paste', opts));

    var targets = document.querySelectorAll(
      'main, #app, #root, [class*="upload"], [class*="drop"], [class*="paste"], [class*="board"]'
    );
    for (var x = 0; x < targets.length; x++) {
      try { targets[x].dispatchEvent(new ClipboardEvent('paste', opts)); } catch {}
    }

    /* Also try file input in case the site uses one */
    var fi = document.querySelector('input[type="file"]');
    if (fi) {
      try {
        fi.files = dt.files;
        fi.dispatchEvent(new Event('change', { bubbles: true }));
        fi.dispatchEvent(new Event('input',  { bubbles: true }));
      } catch {}
    }
  } catch (e) {
    console.error('[Snipboard ext] paste error:', e);
  }
}

/* ─── ISOLATED WORLD LISTENER ───
   Normal content-script context.
   Polls the DOM element written by mainWorldScript.
   Relays the URL to the background via chrome.runtime.sendMessage.
*/
function isolatedWorldListener(tabId) {
  var RESULT_ID = '__snipboard_ext_result__';
  var sent = false;
  var iv = setInterval(function () {
    if (sent) { clearInterval(iv); return; }
    var el = document.getElementById(RESULT_ID);
    if (el && el.dataset && el.dataset.url) {
      sent = true;
      clearInterval(iv);
      chrome.runtime.sendMessage({
        action:   'snipboardFound',
        tabId:    tabId,
        url:      el.dataset.url,
        endpoint: el.dataset.endpoint || null,
        field:    el.dataset.field    || null,
      });
    }
  }, 150);
  setTimeout(function () { clearInterval(iv); }, 33000);
}

/* ─── HELPERS ─── */
function waitForTabLoad(tabId) {
  return new Promise(function (resolve) {
    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    var listener = function (tid, info) {
      if (tid === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(function (t) {
      if (t.status === 'complete') finish();
    }).catch(function () {});
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function base64ToBlob(base64, mimeType) {
  var raw   = base64.indexOf(',') !== -1 ? base64.split(',')[1] : base64;
  var bin   = atob(raw);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
