const api = globalThis.browser ?? globalThis.chrome;
const ANCHOR_ID = "gruzly-open-anchor";
const SCHEME_PREFIX = "gruzly://add?url=";

let schemeUrl = null;

function message(key, fallback) {
  return api.i18n.getMessage(key) || fallback;
}

function localize() {
  const uiLocale = (api.i18n.getUILanguage() || "en").split("-")[0];
  document.documentElement.lang = uiLocale;
  document.title = message("popupTitle", "Gruzly");
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const text = api.i18n.getMessage(el.dataset.i18n);
    if (text) el.textContent = text;
  }
}

function toSchemeUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl === "") return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return SCHEME_PREFIX + encodeURIComponent(rawUrl);
}

// Same anchor-click technique as content.js: navigation to a custom scheme
// from an <a> is more widely accepted than from a script assignment.
function openScheme(url) {
  if (!url || !url.startsWith(SCHEME_PREFIX)) return false;

  const stale = document.getElementById(ANCHOR_ID);
  if (stale) stale.remove();

  const anchor = document.createElement("a");
  anchor.id = ANCHOR_ID;
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);

  let clicked = false;
  try {
    anchor.click();
    clicked = true;
  } catch {
    clicked = false;
  }

  // Keep the anchor in the DOM briefly; removing it synchronously can cancel
  // the protocol navigation before the browser has dispatched it.
  window.setTimeout(() => anchor.remove(), 1000);

  if (!clicked) {
    try {
      window.location.href = url;
    } catch {
      // The browser blocked the scheme.
    }
  }

  return clicked;
}

async function init() {
  localize();

  const button = document.getElementById("open");
  const status = document.getElementById("status");
  const urlEl = document.getElementById("page-url");

  let tab;
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    tab = tabs && tabs[0];
  } catch {
    tab = undefined;
  }

  const rawUrl = tab && typeof tab.url === "string" ? tab.url : "";
  schemeUrl = toSchemeUrl(rawUrl);

  urlEl.textContent = rawUrl || message("popupNoUrl", "No page URL available.");
  urlEl.title = rawUrl;

  if (!schemeUrl) {
    button.disabled = true;
    status.textContent = rawUrl
      ? message("popupUnsupported", "Only http and https pages can be sent to Gruzly.")
      : message("popupNoUrl", "No page URL available.");
    return;
  }

  button.addEventListener("click", () => {
    const ok = openScheme(schemeUrl);
    status.dataset.tone = ok ? "" : "error";
    status.textContent = ok
      ? message("popupOpening", "Opening Gruzly…")
      : message("popupError", "Could not open Gruzly. Check that the app is installed.");
  });
}

init().catch(() => {
  const status = document.getElementById("status");
  if (status) {
    status.dataset.tone = "error";
    status.textContent = message(
      "popupError",
      "Could not open Gruzly. Check that the app is installed."
    );
  }
});
