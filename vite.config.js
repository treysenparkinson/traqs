import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync } from "fs";

// Writes dist/_redirects after build so the SPA catch-all only exists in production
const netlifyRedirects = {
  name: "netlify-redirects",
  closeBundle() {
    writeFileSync("./dist/_redirects", "/*  /index.html  200\n");
  },
};

export default defineConfig({
  plugins: [react(), netlifyRedirects],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8888",
        changeOrigin: true,
      },
    },
  },
});
