// Gruzly browser bridge (Manifest V3).
//
// Context menu clicks hand a URL to the desktop app through the custom
// scheme `gruzly://add?url=<percent-encoded URL>`. A service worker cannot
// reliably navigate to a custom protocol, so the URL is forwarded to a
// content script that performs an <a> click inside the page (the same
// technique the popup uses). If no content script is available, a new tab
// is opened as a last resort.
//
// `browser` is promise-based and only exists in Firefox; Chrome exposes
// `chrome` (these MV3 APIs return promises when called without a callback).
const api = globalThis.browser ?? globalThis.chrome;

const MENU_LINK = "gruzly-link";
const MENU_PAGE = "gruzly-page";
const MENU_VIDEO = "gruzly-video";
const MENU_IDS = new Set([MENU_LINK, MENU_PAGE, MENU_VIDEO]);

// Schemes Gruzly can accept: web pages/files, direct media URLs, magnets.
// blob:/data: URLs are deliberately rejected; the app could not fetch them.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "magnet:"]);

function message(key, fallback) {
  return api.i18n.getMessage(key) || fallback;
}

// Runs a callback-style API and also accepts a promise, so the same call
// works in Chrome (callbacks) and Firefox (`browser.*`, promises).
function invoke(register) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    let maybe;
    try {
      maybe = register(done);
    } catch {
      done(undefined);
      return;
    }
    if (maybe && typeof maybe.then === "function") {
      maybe.then(done, () => done(undefined));
    }
  });
}

async function createMenus() {
  await invoke((done) => api.contextMenus.removeAll(done));
  const title = message("contextMenuTitle", "Download in Gruzly");
  const menus = [
    { id: MENU_LINK, contexts: ["link"] },
    { id: MENU_PAGE, contexts: ["page"] },
    { id: MENU_VIDEO, contexts: ["video"] },
  ];
  for (const menu of menus) {
    api.contextMenus.create({ id: menu.id, title, contexts: menu.contexts });
  }
}

api.runtime.onInstalled.addListener(() => {
  void createMenus();
});

api.runtime.onStartup.addListener(() => {
  void createMenus();
});

function buildSchemeUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl === "") return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  return "gruzly://add?url=" + encodeURIComponent(rawUrl);
}

function pickUrl(info, tab) {
  if (info.menuItemId === MENU_LINK && info.linkUrl) return info.linkUrl;
  // Media element sources from MSE players are blob: URLs, which the app
  // cannot fetch; the containing page is the useful value there.
  if (info.menuItemId === MENU_VIDEO && info.srcUrl) {
    const unusable = /^(blob|data|mediasource):/i.test(info.srcUrl);
    if (!unusable) return info.srcUrl;
  }
  return info.pageUrl || (tab && tab.url) || "";
}

async function injectBridge(tabId) {
  try {
    await api.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return true;
  } catch {
    // Restricted page (chrome://, Web Store, PDF viewer, ...) or no
    // activeTab grant: the caller falls back to opening a tab.
    return false;
  }
}

async function openInNewTab(schemeUrl) {
  try {
    await api.tabs.create({ url: schemeUrl, active: true });
  } catch {
    // The browser refused the custom scheme; nothing else can be done here.
  }
}

async function handleClick(info, tab) {
  if (!MENU_IDS.has(info.menuItemId)) return;

  const schemeUrl = buildSchemeUrl(pickUrl(info, tab));
  if (!schemeUrl) return;

  const tabId = tab && typeof tab.id === "number" ? tab.id : -1;
  if (tabId >= 0 && (await injectBridge(tabId))) {
    try {
      const response = await api.tabs.sendMessage(tabId, {
        type: "gruzly:open",
        url: schemeUrl,
      });
      if (response && response.ok) return;
    } catch {
      // No receiver (page navigated or restricted); fall through.
    }
  }

  await openInNewTab(schemeUrl);
}

api.contextMenus.onClicked.addListener((info, tab) => {
  void handleClick(info, tab);
});
