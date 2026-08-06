import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync } from "fs";

// Writes dist/_redirects after build so the SPA catch-all only exists in production
const netlifyRedirects = {
  name: "netlify-redirects",
  closeBundle() {
    writeFileSync("./dist/_redirects", "/api/*  /.netlify/functions/:splat  200\n/*  /index.html  200\n");
  },
};

// Force full-page reload on every file change instead of HMR patching.
// TRAQS.jsx is 500KB+ — HMR can't patch it reliably and causes white screens.
const forceFullReload = {
  name: "force-full-reload",
  handleHotUpdate({ server }) {
    server.ws.send({ type: "full-reload" });
    return [];
  },
};

export default defineConfig({
  plugins: [react(), netlifyRedirects, forceFullReload],
  server: {
    // Bind IPv4 explicitly. Vite's default host is "localhost", which Node 18+
    // resolves to ::1 first — Vite then listens on [::1]:5173 ONLY. Netlify Dev
    // probes 127.0.0.1:targetPort, never sees the framework come up ("Waiting
    // for framework port 5173" forever), and falls back to its SPA rewrite: the
    // browser asks for /src/main.jsx and gets index.html as text/html, so no
    // module ever parses and the page renders blank (white screen).
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://localhost:8888",
        changeOrigin: true,
      },
    },
  },
});
