import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const serverPort = process.env.SERVER_PORT || "8087";

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to 127.0.0.1 explicitly so the Spotify redirect URI
    // (http://127.0.0.1:5173/callback) always matches.
    host: "127.0.0.1",
    port: Number(process.env.VITE_PORT || 5173),
    // Silent port drift creates a new origin, orphaning stored Spotify tokens.
    // Failing loudly is correct so the stray dev server can be stopped.
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${serverPort}`,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
