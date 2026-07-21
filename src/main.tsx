import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

if (typeof window !== "undefined" && window.location.hostname === "localhost") {
  // Keep Spotify OAuth and localStorage on the same loopback origin.
  const canonicalUrl = new URL(window.location.href);
  canonicalUrl.hostname = "127.0.0.1";
  window.location.replace(canonicalUrl.toString());
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
