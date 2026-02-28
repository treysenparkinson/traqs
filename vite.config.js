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
    proxy: {
      "/api": {
        target: "http://localhost:8888",
        changeOrigin: true,
      },
    },
  },
});
