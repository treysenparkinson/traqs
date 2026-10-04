// Root cause 9 chunk 3: the stylesheets.
//
// 27 declarations were unreachable -- seven entrance classes nothing ever applied, a rename
// leftover, sixteen keyframes no animation named, and three custom properties written on
// every theme change and read by nobody. Half of that was dead only because the OTHER half
// was: five keyframes had exactly one reference each, and all five lived inside one of the
// seven dead class rules. A by-name list would have kept them.
//
// So the suite asserts three things, and only the third is the one that still matters once
// this commit is old:
//
//   1. The named symbols are gone.
//   2. .anim-tab, which was dead for the opposite reason -- written, never wired -- is now
//      applied, and applied in a way that actually takes effect.
//   3. INVARIANTS. Every @keyframes in the shipped sheets is referenced by something, and
//      every class selector is reachable from the app. These are the checks that catch the
//      NEXT dead rule, including one written tomorrow by someone who never read this file.
//
//   node scripts/css-dead-test.mjs

import { readFileSync, readdirSync } from "node:fs";
const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8").replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

const FILES = [];
(function walk(dir) {
  for (const e of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = dir + e.name + (e.isDirectory() ? "/" : "");
    if (e.isDirectory()) walk(p); else if (/\.(jsx?|mjs|html|css)$/.test(e.name)) FILES.push(p);
  }
})("src/");
FILES.push("index.html");
const TEXT = Object.fromEntries(FILES.map(f => [f, read(f)]));
const ALL = Object.values(TEXT).join("\n");

// ── locating the stylesheets ────────────────────────────────────────────────
// Every sheet is a template literal behind a marker: a *_CSS const, a .textContent
// assignment, or a JSX <style>. They are walked as literals rather than matched with a
// <style>...</style> regex, because that regex picks up `{SCREEN_CSS}` and then lets JS
// braces into the brace counter -- which is how the first version of this sweep reported a
// JS comment as a selector and counted several rules twice.
const MARKER = /(?:[A-Z][A-Z0-9_]*_CSS\s*=|\w+\.textContent\s*=|<style[^>]*>\s*\{?)\s*/g;
const literalAt = (t, i) => {
  const q = t[i];
  if (q !== "`" && q !== '"' && q !== "'") return null;
  let j = i + 1, out = "";
  while (j < t.length) {
    const c = t[j];
    if (c === "\\") { out += c + t[j + 1]; j += 2; continue; }
    if (q === "`" && c === "$" && t[j + 1] === "{") {
      let d = 1; j += 2;
      while (j < t.length && d) { if (t[j] === "{") d++; else if (t[j] === "}") d--; j++; }
      out += "INTERP"; continue;
    }
    if (c === q) return { css: out, end: j };
    out += c; j++;
  }
  return null;
};
const SHEETS = [];
for (const f of FILES) {
  const t = TEXT[f];
  if (f.endsWith(".css")) { SHEETS.push({ file: f, css: t, line: 1 }); continue; }
  if (f.endsWith(".html")) {
    for (const m of t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) SHEETS.push({ file: f, css: m[1], line: t.slice(0, m.index).split("\n").length });
    continue;
  }
  MARKER.lastIndex = 0;
  let m;
  while ((m = MARKER.exec(t))) {
    const lit = literalAt(t, m.index + m[0].length);
    if (!lit) continue;
    if (!/[{;:]/.test(lit.css)) continue;
    SHEETS.push({ file: f, css: lit.css, line: t.slice(0, m.index).split("\n").length });
    MARKER.lastIndex = lit.end;
  }
}
ok(`the sweep can see the stylesheets (${SHEETS.length} found, main sheet ${Math.max(...SHEETS.map(s => s.css.length))} chars)`,
  SHEETS.length >= 15 && Math.max(...SHEETS.map(s => s.css.length)) > 50000);

const rules = [];
const parse = (css, file, baseLine, inAt = "") => {
  let i = 0, line = baseLine, head = "", hl = line;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "\n") line++;
    if (ch === "{") {
      // A comment sitting above a rule is part of `head` as accumulated, so .anim-tab's
      // selector came back as "/* ...9 lines... */ .anim-tab" and matched nothing.
      const h = head.replace(/\/\*[\s\S]*?\*\//g, " ").trim(), start = hl;
      let d = 1, j = i + 1, body = "";
      while (j < css.length && d) { if (css[j] === "{") d++; else if (css[j] === "}") { d--; if (!d) break; } body += css[j]; j++; }
      if (/^@(media|supports|layer|container)/.test(h)) parse(body, file, line, h);
      else rules.push({ file, line: start, head: h, body, inAt });
      for (const c of css.slice(i, j)) if (c === "\n") line++;
      i = j + 1; head = ""; hl = line; continue;
    }
    if (ch === "}") { i++; head = ""; hl = line; continue; }
    if (!head.trim() && /\s/.test(ch)) hl = line;
    head += ch; i++;
  }
};
for (const s of SHEETS) parse(s.css, s.file, s.line);
ok(`...and parse them into rules (${rules.length})`, rules.length > 250);

// ── 1. the deleted symbols are gone ─────────────────────────────────────────
const GONE_CLASSES = ["anim-header", "anim-filter", "anim-badge", "anim-gantt-bar", "anim-spring", "anim-stagger", "anim-row", "ts-legend"];
for (const c of GONE_CLASSES) {
  const n = (ALL.match(new RegExp(`(^|[^\\w-])${c}(?![\\w-])`, "g")) || []).length;
  ok(`#rc9c3 .${c} is gone${n ? ` — ${n} left` : ""}`, n === 0);
}
// ts-key is the live replacement the export actually renders; deleting the leftover must
// not have taken it with it.
ok("#rc9c3 ...and the export legend still has .ts-key, which it renders", /\.ts-key\{/.test(ALL) && /class="ts-key"/.test(ALL));

const GONE_KF = ["drag-lift", "modalOverlayIn", "pulseGlow", "glassShimmer", "panelDropIn", "panelDropOut",
  "springPop", "headerSlide", "filterSlide", "badgeBounce", "ganttBarSlide", "tqPreviewFade", "tqDip",
  "fastTraqIn", "cancelScoot", "checkCircle"];
for (const k of GONE_KF) {
  const n = (ALL.match(new RegExp(`(^|[^\\w-])${k}(?![\\w-])`, "g")) || []).length;
  ok(`#rc9c3 @keyframes ${k} is gone${n ? ` — ${n} left` : ""}`, n === 0);
}
// checkCircle went; its two siblings in the same minified sheet are still used and stay.
ok("#rc9c3 ...but checkDraw and checkPop, used by the same sheet, survive", /@keyframes checkDraw/.test(ALL) && /@keyframes checkPop/.test(ALL));

const GONE_PROPS = ["--tq-bg-image", "--tq-glow", "--tq-lglass-shadow-hover"];
for (const v of GONE_PROPS) {
  const written = (ALL.match(new RegExp(`setProperty\\(\\s*["'\`]${v}(?![\\w-])`, "g")) || []).length;
  const readBack = (ALL.match(new RegExp(`var\\(\\s*${v}(?![\\w-])`, "g")) || []).length;
  ok(`#rc9c3 ${v} is neither written nor read${written || readBack ? ` — ${written} write(s), ${readBack} read(s)` : ""}`, written === 0 && readBack === 0);
}
// --tq-glow is a prefix of two live properties. Deleting it must not have taken them.
ok("#rc9c3 ...and --tq-glow-ring / --tq-glow-ring-soft, which ARE read, survive",
  /setProperty\(\s*"--tq-glow-ring"/.test(ALL) && /var\(--tq-glow-ring,/.test(ALL)
  && /setProperty\(\s*"--tq-glow-ring-soft"/.test(ALL) && /var\(--tq-glow-ring-soft,/.test(ALL));

// ── 2. .anim-tab is wired, and wired so that it takes effect ────────────────
// It was dead the opposite way round: written, reviewed, never put on an element. Tabs had
// no press feedback at all, which reads as the tab being broken rather than quiet.
const TAB_SITES = (ALL.match(/className="tq-noanim anim-tab"/g) || []).length;
// Three sites: the desktop Time Clock's admin tabs became revamp pills (rv-pill) in
// 2026-10, which carry the app-wide button press instead; mobile keeps its tab row.
ok(`#rc9c3 .anim-tab is applied (${TAB_SITES} tab sites)`, TAB_SITES >= 3);
ok("#rc9c3 ...on MobileNav's bottom bar", /className="tq-noanim anim-tab" ref=\{el => \{ btnRefs\.current\[tab\.id\] = el; \}\}/.test(ALL));
ok("#rc9c3 ...on the mobile Time Stamp admin tab row", (ALL.match(/className="tq-noanim anim-tab" onClick=\{\(\) => setTsAdminTab/g) || []).length === 1);
ok("#rc9c3 ...and on the settings tabs", /className="tq-noanim anim-tab" onClick=\{\(\) => setSettingsTab/.test(ALL));

// The trap this would otherwise fall into: an inline style object outranks a stylesheet
// rule, so an inline `transition` on a tab silently cancels .anim-tab's -- the press would
// snap instead of easing and the class would look wired while doing nothing. Same shape as
// the animation declaration that outranked the hover dim in root cause 8.
// Scanned, not matched with a regex. `className="..." [^>]*? style={{...}}` cannot cross the
// `=>` inside onClick={() => ...}, so that pattern found zero tags, ran its loop zero times
// and asserted nothing while the suite stayed green -- the same vacuous shape this root
// cause has now turned up four times. The count assertion below is what makes a zero loud.
const tagAfter = (t, i) => {               // the rest of the opening tag, brace-depth aware
  let d = 0, j = i;
  while (j < t.length) {
    const c = t[j];
    if (c === "{") d++;
    else if (c === "}") d--;
    else if (c === ">" && d === 0) return t.slice(i, j);
    j++;
  }
  return t.slice(i);
};
let scanned = 0;
for (let i = ALL.indexOf('className="tq-noanim anim-tab"'); i >= 0; i = ALL.indexOf('className="tq-noanim anim-tab"', i + 1)) {
  const tag = tagAfter(ALL, i);
  const style = tag.match(/style=\{\{/) ? tag.slice(tag.indexOf("style={{")) : "";
  scanned++;
  ok(`#rc9c3 ...with no inline transition to outrank the class (tab ${scanned})`, !/\btransition\s*:/.test(style));
}
ok(`#rc9c3 ...and all ${TAB_SITES} wired tabs were actually inspected`, scanned === TAB_SITES && scanned >= 3);

const animTab = rules.find(r => r.head.trim() === ".anim-tab");
ok("#rc9c3 .anim-tab still declares the press squeeze", !!animTab && /transition:/.test(animTab.body)
  && rules.some(r => r.head.trim() === ".anim-tab:active" && /scale\(0\.94\)/.test(r.body)));
// overflow:hidden exists on .anim-btn to clip its ::after edge. A .tq-noanim tab has no
// ::after -- every edge rule excludes that class by name -- so on a tab the clip can only
// crop MobileNav's unread badge, which hangs outside its icon at top:-4/right:-6.
ok("#rc9c3 ...without the overflow clip that would crop MobileNav's badge", !!animTab && !/overflow:\s*hidden/.test(animTab.body));
ok("#rc9c3 ...and .anim-btn, which does need the clip, keeps it",
  rules.some(r => r.head.trim() === ".anim-btn" && /overflow:\s*hidden/.test(r.body)));

// ── 3. the invariants ───────────────────────────────────────────────────────
// What the app can put on an element, by any route: a literal className, a template with
// static pieces, classList, a querySelector, or a class name chosen into a variable. The
// last one is why this is deliberately permissive -- a stricter reading called
// .msg-in-mine/.msg-in-other dead, and they are set at `isMe ? "msg-in-mine" : ...`.
let NOCSS = ALL;
for (const s of SHEETS) NOCSS = NOCSS.split(s.css).join("\n/*sheet*/\n");
const used = new Set(), dynP = new Set(), dynS = new Set();
const addAll = (s) => s.split(/\s+/).forEach(c => c && used.add(c));
for (const m of NOCSS.matchAll(/class(?:Name)?\s*=\s*["']([^"']*)["']/g)) addAll(m[1]);
for (const m of NOCSS.matchAll(/className\s*[:=]\s*\{?\s*`([^`]*)`/g)) {
  for (const p of m[1].split(/\$\{[^}]*\}/)) addAll(p);
  for (const d of m[1].matchAll(/([\w-]*)\$\{[^}]*\}([\w-]*)/g)) { if (d[1]) dynP.add(d[1]); if (d[2]) dynS.add(d[2]); }
}
for (const m of NOCSS.matchAll(/["'`]([^"'`\n]{1,160})["'`]/g))
  for (const tok of m[1].split(/[^\w-]+/)) if (/^[A-Za-z][\w-]*$/.test(tok) && tok.length > 1) used.add(tok);
// Classes rendered by a dependency into our tree. react-colorful draws its own markup, so
// nothing in src/ will ever name these -- a sweep scoped to our source calls every vendor
// class dead, and deleting them would have silently unstyled the colour picker.
const VENDOR = [/^react-colorful/];
const reachable = (c) => used.has(c) || VENDOR.some(v => v.test(c))
  || [...dynP].some(p => p && c.startsWith(p)) || [...dynS].some(s => s && c.endsWith(s));

// One rule is unreachable on purpose and says so in the source. .tq-lglass-noedge is an
// opt-in edge kill that the list cards used and gave back; the comment above it exists
// because the rule is easy to get wrong (it must set the border WIDTH, not the colour --
// background-clip and backdrop-filter both default to the border box, so a transparent
// border still leaks the element's own glass). Deleting a documented keepsake and
// weakening the invariant are both worse than naming the exception here.
const KEPT_ON_PURPOSE = [".tq-lglass-noedge"];

const unreachable = [];
for (const r of rules) {
  if (/^@/.test(r.head)) continue;
  if (KEPT_ON_PURPOSE.includes(r.head.trim())) continue;
  const sels = r.head.split(",").map(s => s.trim()).filter(Boolean);
  const selDead = (s) => { const cs = [...s.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map(m => m[1]); return cs.length > 0 && cs.every(c => !reachable(c)); };
  if (sels.length && sels.every(selDead)) unreachable.push(`${r.file}:${r.line} ${r.head.replace(/\s+/g, " ").slice(0, 60)}`);
}
ok(`#rc9c3 INVARIANT every class rule in the shipped sheets is reachable${unreachable.length ? "\n        " + unreachable.join("\n        ") : ""}`, unreachable.length === 0);
// The sweep has to be able to SEE a dead rule, or the assertion above passes on an empty
// search. A sweep that returns zero is when to check the sweep -- it returned a false zero
// three separate times in this root cause.
ok("#rc9c3 ...and the sweep can detect one (canary)", (() => {
  const canary = ".tq-canary-not-a-real-class";
  const cs = [...canary.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map(m => m[1]);
  return cs.length === 1 && !reachable(cs[0]);
})());

const kfNames = new Map();
for (const m of ALL.matchAll(/@keyframes\s+([\w-]+)/g)) kfNames.set(m[1], (kfNames.get(m[1]) || 0) + 1);
// A name can be assembled at run time (`tqLiquid${i}`), so a prefix that is interpolated
// anywhere keeps its whole family alive.
const builtPrefix = [...ALL.matchAll(/([A-Za-z][\w-]{2,})\$\{/g)].map(m => m[1]);
const orphanKf = [];
for (const [n, decls] of kfNames) {
  const uses = (ALL.match(new RegExp(`(^|[^\\w-])${n}(?![\\w-])`, "g")) || []).length - decls;
  if (uses === 0 && !builtPrefix.some(p => n.startsWith(p) && n !== p)) orphanKf.push(n);
}
ok(`#rc9c3 INVARIANT every @keyframes is referenced (${kfNames.size} declared)${orphanKf.length ? " — orphaned: " + orphanKf.join(", ") : ""}`, orphanKf.length === 0);

const unreadProps = [];
for (const m of ALL.matchAll(/setProperty\(\s*["'`](--[\w-]+)["'`]/g)) {
  const v = m[1];
  if (/\$\{/.test(v)) continue;
  const reads = (ALL.match(new RegExp(`var\\(\\s*${v}(?![\\w-])`, "g")) || []).length;
  if (!reads && !unreadProps.includes(v)) unreadProps.push(v);
}
// Interpolated names (`--tq-sb-${k}`) are written through a template, so a literal var()
// search cannot pair them up; they are excluded above rather than reported as unread.
ok(`#rc9c3 INVARIANT every custom property written is read back${unreadProps.length ? " — write-only: " + unreadProps.join(", ") : ""}`, unreadProps.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
