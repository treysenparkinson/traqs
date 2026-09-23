// ESLint exists here for ONE rule: no-undef.
//
// Twice in one session a call to a name that was never declared built cleanly
// through Vite and would have thrown at runtime — `requirePerm` in a Netlify
// function with no import line, and `authWriteHeaders` in api.js, a helper that
// does not exist under that name. Both are valid syntax. A bundler has no
// opinion about them; only scope analysis does.
//
// scripts/check-function-imports.mjs already catches the netlify/functions half
// and is silent because it only looks for known _utils exports. That trick does
// not reach src/: a mistyped local is exported nowhere, so there is nothing to
// match against, and the general "called but declared nowhere" regex measured
// 355 candidates over src/ — parameters, destructured props, class methods and
// rgba() are indistinguishable from a typo without a parser.
//
// Deliberately NOT a style config. No formatting rules, no opinions about
// hooks or imports. Every rule added here is one more thing that can fail a
// build for a reason nobody wants to think about at the time; this one earns
// its place by catching a class that ships silently.

import globals from "globals";

export default [
  {
    files: ["src/**/*.js", "src/**/*.jsx"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      // espree parses JSX natively with this flag — no extra parser dependency.
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: { "no-undef": "error" },
  },
  {
    files: ["netlify/**/*.js", "scripts/**/*.mjs", "tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: { "no-undef": "error" },
  },
  {
    // Edge functions run on Deno and reference its globals.
    files: ["netlify/edge-functions/**"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2021, Deno: "readonly" },
    },
    rules: { "no-undef": "error" },
  },
  {
    // These drive a headless browser: the bodies passed to page.evaluate() run
    // in the page, not in Node, so document and getComputedStyle are genuinely
    // defined there. Node globals alone would report every one as undefined.
    files: ["tools/verify/**"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser, ...globals.es2021 },
    },
    rules: { "no-undef": "error" },
  },
  { ignores: ["dist/**", "node_modules/**", "android/**", "ios/**", "TRAQS Scheduling/**"] },
];
