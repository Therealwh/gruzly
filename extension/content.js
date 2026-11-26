// Injected on demand by background.js (activeTab + scripting), so the
// extension asks for no host permissions and runs on no page by itself.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const ANCHOR_ID = "gruzly-open-anchor";
  const SCHEME_PREFIX = "gruzly://add?url=";

  function openScheme(schemeUrl) {
    if (!schemeUrl.startsWith(SCHEME_PREFIX)) return false;

    // Drop a stale anchor left by an earlier click before adding a fresh one.
    const stale = document.getElementById(ANCHOR_ID);
    if (stale) stale.remove();

    const anchor = document.createElement("a");
    anchor.id = ANCHOR_ID;
    anchor.href = schemeUrl;
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    document.documentElement.appendChild(anchor);

    let clicked = false;
    try {
      anchor.click();
      clicked = true;
    } catch {
      clicked = false;
    }

    if (!clicked) {
      try {
        window.location.href = schemeUrl;
      } catch {
        // The browser blocked the scheme.
      }
    }

    // If the page is still focused and visible shortly after the click, the
    // browser probably ignored the anchor: retry with a plain navigation.
    // Focus is only a heuristic, but launching an external app normally
    // moves focus away and avoids a duplicate protocol prompt.
    window.setTimeout(() => {
      anchor.remove();
      if (clicked && document.hasFocus() && document.visibilityState === "visible") {
        try {
          window.location.href = schemeUrl;
        } catch {
          // The browser blocked the scheme.
        }
      }
    }, 1200);

    return clicked;
  }

  if (!window.__gruzlyBridgeReady) {
    window.__gruzlyBridgeReady = true;
    api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.type !== "gruzly:open" || typeof msg.url !== "string") {
        return undefined;
      }
      sendResponse({ ok: openScheme(msg.url) });
      return undefined;
    });
  }
})();
