#!/usr/bin/env node
// Guards against a Netlify function calling a _utils helper it never imported.
//
// Why this exists: clients.js and settings.js once shipped calling requirePerm()
// with no import line, which is a runtime ReferenceError on the first POST — a
// 502, not a 403. It survived review because an ESM import check only proves the
// module's own imports RESOLVE; a free identifier that is never imported is
// perfectly valid syntax and only explodes when the line executes. So
// `import('./clients.js')` passed while production was broken.
//
// Scans every function for identifiers that are exported by some _utils module,
// and fails if the file uses one without importing it.
//
// Run: node scripts/check-function-imports.mjs

import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const FN_DIR = "netlify/functions";
const UTIL_DIR = join(FN_DIR, "_utils");

const stripped = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "")
     .replace(/^\s*\/\/[^\n]*$/gm, "")
     .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

// name -> module that exports it
const exportedBy = new Map();
for (const f of readdirSync(UTIL_DIR).filter(f => f.endsWith(".js"))) {
  const src = stripped(readFileSync(join(UTIL_DIR, f), "utf8"));
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
    exportedBy.set(m[1], f);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) exportedBy.set(name, f);
    }
  }
}

let failures = 0, checked = 0;
for (const f of readdirSync(FN_DIR).filter(f => f.endsWith(".js"))) {
  const src = readFileSync(join(FN_DIR, f), "utf8");
  const code = stripped(src);
  checked++;

  // Names this file actually imports (from anywhere).
  const imported = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) imported.add(name);
    }
  }
  // Locally declared names shadow an import of the same name legitimately.
  const declared = new Set();
  for (const m of code.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);

  const missing = new Set();
  for (const [name, mod] of exportedBy) {
    if (imported.has(name) || declared.has(name)) continue;
    // Used as a call or a bare reference, not as a property access (obj.name).
    const used = new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(code);
    if (used) missing.add(`${name} (exported by _utils/${mod})`);
  }

  if (missing.size) {
    failures++;
    console.error(`FAIL ${f}`);
    for (const m of missing) console.error(`       uses ${m} without importing it`);
  }
}

console.log(`\nchecked ${checked} function(s) — ${failures === 0 ? "no missing imports" : `${failures} file(s) with missing imports`}`);
process.exit(failures === 0 ? 0 : 1);
