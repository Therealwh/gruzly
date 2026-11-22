import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initI18n } from "./i18n";
import { isTauri } from "./lib/api";
import "./index.css";

async function main() {
  await initI18n();

  // Fail loudly in dev if something renders undefined text.
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  // Window starts hidden to avoid a white flash while WebView2 warms up:
  // show it once the UI has actually rendered.
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().show();
  }
}

void main();
