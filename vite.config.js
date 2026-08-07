import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync } from "fs";
import path from "node:path";

// Writes dist/_redirects after build so the SPA catch-all only exists in production
const netlifyRedirects = {
  name: "netlify-redirects",
  closeBundle() {
    writeFileSync("./dist/_redirects", "/api/*  /.netlify/functions/:splat  200\n/*  /index.html  200\n");
  },
};

// Force full-page reload on every file change instead of HMR patching.
// TRAQS.jsx is 500KB+ — HMR can't patch it reliably and causes white screens.
//
// Only files the BROWSER actually loads may trigger that reload. Vite watches the
// whole repo root, and this repo contains files that rewrite themselves with nobody
// editing anything:
//   • TRAQS Scheduling/…/UserInterfaceState.xcuserstate — Xcode rewrites it on any
//     UI activity (scrolling, selecting a file, moving a window)
//   • .netlify/functions-serve/** — rebuilt every time Netlify Dev reloads a function
// Unfiltered, each of those silently reloaded the page, which reads as the app
// "randomly refreshing" with no pattern — it was tracking Xcode, not a timer.
const ROOT = process.cwd();
const BROWSER_OWNED = /^(src\/|public\/|index\.html$)/;
const forceFullReload = {
  name: "force-full-reload",
  handleHotUpdate({ file, server }) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (!BROWSER_OWNED.test(rel)) {
      if (process.env.TQ_RELOAD_DEBUG) console.log(`[force-full-reload] skip ${rel}`);
      return [];
    }
    if (process.env.TQ_RELOAD_DEBUG) console.log(`[force-full-reload] reload ${rel}`);
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
