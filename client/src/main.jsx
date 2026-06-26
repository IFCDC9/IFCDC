import React from "react";
import ReactDOM from "react-dom/client";
import { BootDismisser } from "./BootDismisser";
import { showBootError, markAppMounted } from "./boot";
import { AuthProvider } from "./auth/AuthContext";
import { HqErrorBoundary } from "./components/hq/HqErrorBoundary";
import { PortalErrorScreen } from "./components/hq/PortalErrorScreen";
import App from "./App";
import "./styles/globals.css";
import "./styles/hq.css";

function renderFatal(message, detail) {
  markAppMounted();
  const rootEl = document.getElementById("root");
  if (!rootEl) {
    showBootError(message);
    return;
  }
  if (!appRoot) {
    appRoot = ReactDOM.createRoot(rootEl);
  }
  appRoot.render(<PortalErrorScreen message={message} detail={detail} />);
}

let appRoot = null;

window.addEventListener("error", (event) => {
  console.error("IFCDC runtime error:", event.error ?? event.message);
});

const CHUNK_LOAD_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

window.addEventListener("unhandledrejection", (event) => {
  console.error("IFCDC unhandled rejection:", event.reason);
  const message = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "");
  if (!CHUNK_LOAD_RE.test(message)) return;

  event.preventDefault();
  renderFatal(
    "A Headquarters module failed to load. This usually clears after a hard refresh (Cmd+Shift+R).",
    message
  );
});

const rootEl = document.getElementById("root");
if (!rootEl) {
  showBootError("Root element #root not found.");
} else {
  try {
    appRoot = ReactDOM.createRoot(rootEl);
    appRoot.render(
      <HqErrorBoundary title="IFCDC Portal failed to load">
        <BootDismisser>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BootDismisser>
      </HqErrorBoundary>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Startup failed.";
    renderFatal("Headquarters failed to start.", message);
  }
}
