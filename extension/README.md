# Gruzly browser extension

Sends the current page, a link or a video to the Gruzly desktop app.

## Protocol

The extension only talks to Gruzly through one URL shape:

```
gruzly://add?url=<percent-encoded URL>
```

The app decides what to do with the value:

- a video page opens Gruzly's Video analysis;
- a file or magnet link is added to the download queue directly;
- the optional `title` parameter is ignored, so the extension sends `url` only.

Gruzly registers the `gruzly://` scheme on first launch. The browser (or the
OS) may ask for confirmation before handing the link to the app; if Gruzly is
not installed, nothing happens and the browser may show an error page.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest (`default_locale: en`) |
| `background.js` | Context menus (link/page/video), URL forwarding |
| `content.js` | Injected on demand; clicks a temporary `gruzly://` anchor |
| `popup.html`, `popup.js`, `popup.css` | Toolbar popup with the current URL |
| `_locales/en`, `_locales/ru` | English and Russian UI strings |
| `icons/` | 16/32/48/128 px icons, scaled from the app icon |
| `package-firefox.mjs` | Optional Firefox build (see below) |

## Install in Chrome or Edge

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension/` folder.
4. If the toolbar button is hidden, pin the Gruzly extension.

Right-click a link, page or video and pick **Download in Gruzly**, or open the
popup and press **Open in Gruzly**.

## Install in Firefox (temporary)

Firefox runs MV3 extensions as event pages, not service workers, so the
manifest needs one change. A build script does it:

```sh
node extension/package-firefox.mjs
```

This writes `extension/dist-firefox/` with `background.scripts` instead of
`background.service_worker` and adds
`browser_specific_settings.gecko.id = "extension@gruzly.app"`.

Then open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
Add-on…** and select `extension/dist-firefox/manifest.json`. Temporary add-ons
disappear when Firefox restarts; a permanent install requires signing through
addons.mozilla.org.

Firefox limitations to be honest about:

- The jump from `chrome.*` callbacks to Firefox's promise-based `browser.*` is
  handled with `globalThis.browser ?? globalThis.chrome`, but the extension has
  **not been tested in Firefox**. Load it there before relying on it.
- Protocol confirmation dialogs, `activeTab` grants and context menu URL fields
  can differ slightly between Firefox versions.
- Do not point Firefox at the raw `extension/` folder unless you apply the
  background-script change yourself; its service worker entry is ignored.

## How it works, and why the content script

A service worker cannot reliably navigate to a custom protocol, so:

1. `background.js` builds `gruzly://add?url=…` from `linkUrl`, `srcUrl` or
   `pageUrl` (falling back to `tab.url`). Only `http:`, `https:` and `magnet:`
   are forwarded.
2. It injects `content.js` into the active tab with
   `chrome.scripting.executeScript` and sends the URL with
   `chrome.tabs.sendMessage`.
3. `content.js` clicks a hidden `<a href="gruzly://…">`. If the page still has
   focus about a second later, it retries with `window.location.href`. A stale
   anchor is removed before each attempt.
4. If no content script can run (restricted page, viewer, injection denied),
   `background.js` falls back to `chrome.tabs.create` with the scheme URL.

The popup uses the same anchor click for the active tab's URL after checking
that it is `http:` or `https:`.

## Permissions

- `contextMenus` — the three right-click entries.
- `activeTab` — temporary access to the tab the user just acted on; also lets
  the popup read `tab.url` and lets the background inject into that tab.
- `scripting` — on-demand injection of `content.js`.

There are **no host permissions**, no declared content scripts and no `tabs`
permission: `activeTab` already covers reading the active URL when the user
opens the popup or clicks a menu item, and the extension does not run on pages
by itself. No remote code, no analytics, no network requests.

## Known limitations (not verified without a browser)

- The extension was syntax-checked and its JSON validated, but not loaded in a
  real browser here.
- Chrome/Edge may still ignore a custom-scheme anchor in some versions; the
  new-tab fallback is best effort and browsers may block that too. If both
  paths fail, opening `gruzly://add?url=…` manually still works.
- The delayed `window.location.href` fallback uses focus as a heuristic to
  avoid a duplicate prompt; an unusual focus state could skip or duplicate it.
- Pages such as `chrome://`, the Web Store, `file://` URLs (unless the user
  enables file access) and the PDF viewer cannot receive the injected script;
  those go through the new-tab fallback.
