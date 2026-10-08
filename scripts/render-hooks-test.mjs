// #452 — the web app crashed at phone width.
//
// `renderMobileApp` declared `const [moreOpen, setMoreOpen] = useState(false)`
// in its own body. It is not a component: it is a plain function the App calls
// as `{isMobile ? renderMobileApp() : …}`. So the hook ran on renders where the
// phone layout was drawn and not on the others, React saw the hook count change,
// and at 390px the app went to the error boundary after load: "Rendered more
// hooks than during the previous render", at renderMobileApp. Measured in the
// sandbox (real app, CDP device emulation, 2026-10-07), before and after.
//
// THE FIX hoists the state to the App's top level, next to `isMobile`, where it
// runs on every render. Nothing else about the More sheet changed.
//
// THIS SUITE IS A RATCHET OVER EVERY `renderX` HELPER, not a check on one line,
// because the bug is a shape: any `render…` function is called conditionally by
// construction (that is what makes it a helper rather than JSX), so a hook in any
// of them is the same crash waiting for the render that skips it. Thirty such
// helpers exist; at the time of the fix renderMobileApp was the only one with a
// hook. The scanner proves it can see one (section 1) before it is trusted to
// report that there are none (section 2).
//
//   node scripts/render-hooks-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// A component-level helper is declared at two-space indent, and its body ends at
// the next line that is back at two-space indent (its own closing brace).
function renderHelpers(src) {
  const S = codeOf(src.replace(/\r\n/g, "\n"));
  const re = /\n  const (render[A-Z]\w*) = \(([^)]*)\) => [{(]/g;
  const out = [];
  let m;
  while ((m = re.exec(S))) {
    const rest = S.slice(m.index + m[0].length);
    const end = rest.search(/\n  \S/);
    const body = end < 0 ? rest : rest.slice(0, end);
    out.push({ name: m[1], hooks: [...new Set(body.match(/(?<![\w.$])use[A-Z]\w*\(/g) || [])] });
  }
  return out;
}

console.log("\n1. THE SCANNER CAN SEE THE BUG (must-catch / must-pass fixtures)");
{
  const fixture = [
    "function App() {",
    "  const [isMobile] = useState(false);",
    "  const renderBad = () => {",
    "    const [open, setOpen] = useState(false);",
    "    return <div onClick={() => setOpen(!open)} />;",
    "  };",
    "  const renderGood = (x) => (",
    "    <div>{x}</div>",
    "  );",
    "  useEffect(() => {}, []);",
    "  return isMobile ? renderBad() : renderGood(1);",
    "}",
  ].join("\n");
  const r = renderHelpers(fixture);
  ok("finds both helpers in the fixture", r.map(x => x.name), ["renderBad", "renderGood"]);
  ok("flags the hook inside renderBad", r.find(x => x.name === "renderBad")?.hooks, ["useState("]);
  ok("does not charge the App's own top-level hooks to a helper", r.find(x => x.name === "renderGood")?.hooks, []);
}

console.log("\n2. NO render HELPER IN TRAQS.jsx CALLS A HOOK");
const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const helpers = renderHelpers(SRC);
// Guard the INPUT, not just the result: a scanner that stopped matching would
// report "no hooks" over nothing. 30 helpers at the time of writing.
if (helpers.length < 25 || !helpers.some(h => h.name === "renderMobileApp")) {
  console.error(`scanner found ${helpers.length} render helpers (renderMobileApp ${helpers.some(h => h.name === "renderMobileApp") ? "found" : "MISSING"}) — expected ≥25 including renderMobileApp`);
  process.exit(2);
}
ok(`RED: none of the ${helpers.length} render helpers calls a hook`,
  helpers.filter(h => h.hooks.length).map(h => `${h.name}: ${h.hooks.join(",")}`), []);

console.log("\n3. THE MORE SHEET'S STATE LIVES AT THE TOP LEVEL");
const CODE = codeOf(SRC.replace(/\r\n/g, "\n"));
const decl = "\n  const [moreOpen, setMoreOpen] = useState(false);";
ok("moreOpen is declared once, at the App's top level", CODE.split(decl).length - 1, 1);
ok("...and renderMobileApp still uses it", (() => {
  const at = CODE.indexOf("\n  const renderMobileApp = () => {");
  if (at < 0) return "renderMobileApp not found";
  const rest = CODE.slice(at + 5); const body = rest.slice(0, rest.search(/\n  \S/));
  return /setMoreOpen\(/.test(body) && /activeId=\{moreOpen \?/.test(body);
})(), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
