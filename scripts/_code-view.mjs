// A source file with its COMMENTS removed.
//
// Why this exists, and it has cost this campaign five false results to learn:
// an assertion about CODE must not be satisfiable — or violable — by a COMMENT.
// The comment explaining a fix almost always names the pattern the fix removed,
// because that is what makes the comment worth reading. A raw scan then matches
// its own prose and reports the defect as still present (#343), or, worse,
// matches an explanation and reports a defect as fixed when it is not.
//
// Both comment forms bite:
//   //  a line comment at a fix site naming the removed read
//   {/* a JSX comment standing where deleted markup used to be */}
//
// ─── THIS USED TO BE TWO REGEXES, AND IT DELETED 772 LINES OF CODE (#418) ───
//
// The first was `\{\s*\/\*[\s\S]*?\*\/\s*\}`, for a JSX comment. But a CSS rule
// inside a template literal ALSO opens with `{`, and its first declaration is very
// often a `/* comment */` — so the match started at the rule's brace and ran to the
// next `*/` that happened to sit before a `}`, hundreds of lines later. Two such
// matches swallowed 298 and 459 lines of TRAQS.jsx, and because they consumed `/*`
// and `*/` unevenly, the plain block pass that ran next was left unbalanced and ate
// more. Measured: 772 of 20,598 unambiguous code lines (3.7%) were absent from the
// view that 23 suites assert against. `hexToHsl` and `brandGrad` were gone whole.
//
// An absence assertion — "the old spelling is gone", which is the shape of nearly
// every wiring assertion in this campaign — naming anything in that gap PASSED FOR
// FREE. The header above warned that a drifted scanner "is the quietest kind of
// broken test: it keeps passing", and it was describing itself.
//
// So this is a scanner, not a pattern. It walks the source once and always knows
// whether it is in code, a string, a template literal, a `${}` inside one, a regex
// literal or a comment. A comment marker is only a comment in code context.
//
// TWO DELIBERATE SAFETY RULES, because this reads JSX, which is not quite JS:
//
//   A quote that does not close on its own line is a CHARACTER, not a delimiter.
//   Otherwise the apostrophe in `<p>don't</p>` opens a string that never closes and
//   the rest of the file is read as string content.
//
//   A `/` only starts a regex where one is grammatically possible, and only if it
//   closes on the same line. Regex literals cannot span lines, so a run-on is
//   division — `50% / 50%` in JSX text, for instance.
//
// Both rules fail toward KEEPING text rather than deleting it, which is the safe
// direction: a missed comment can make an assertion fail and be noticed, while a
// deleted line makes one pass and cannot.
//
// This is deliberately ONE function imported by every suite rather than a few
// lines copied into each. Two copies of a scanner drift, and a drifted scanner
// is the quietest kind of broken test: it keeps passing.

/** Where a quoted string ends, or -1 if it does not close on its own line. */
function stringEnd(s, start) {
  const quote = s[start];
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { i++; continue; }
    if (c === "\n") return -1;
    if (c === quote) return i;
  }
  return -1;
}

/** Whether a `/` at this point can begin a regex literal, from what preceded it. */
function regexCanStart(prevChar, prevWord) {
  if (!prevChar) return true;
  if ("(,=:[!&|?{};+-*%~^<>".includes(prevChar)) return true;
  return ["return", "typeof", "case", "in", "of", "new", "delete", "void", "instanceof", "do", "else", "yield", "await"].includes(prevWord);
}

/** Where a regex literal ends, or -1 if it does not close on its own line. */
function regexEnd(s, start) {
  let inClass = false;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { i++; continue; }
    if (c === "\n") return -1;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i;
  }
  return -1;
}

/**
 * Strip block and line comments, preserving line structure.
 *
 * Whole-line comments drop their line entirely, which assertions of the form
 * /A\n\s*B/ depend on — #403's save-skip assertion matches two statements as
 * ADJACENT once the comment between them is gone. Genuinely blank source lines
 * are kept.
 */
export function codeOf(src) {
  const s = String(src == null ? "" : src);
  const n = s.length;
  let out = "";
  let i = 0;
  // "`" while inside a template literal; "{" while inside a ${ } within one.
  const stack = [];
  let prevChar = "", prevWord = "";
  const emit = (text) => {
    out += text;
    const t = text.replace(/\s+$/, "");
    if (t) {
      prevChar = t[t.length - 1];
      const w = t.match(/([A-Za-z_$][\w$]*)$/);
      prevWord = w ? w[1] : "";
    }
  };

  while (i < n) {
    const c = s[i], c2 = s[i + 1];

    // ── inside a template literal ────────────────────────────────────────────
    // `/* … */` IS STRIPPED HERE TOO, because this app's entire stylesheet lives
    // in template literals and a CSS comment is exactly the prose that falsely
    // satisfies an assertion — a rule's comment names what the rule replaced.
    // `//` is NOT, because it is not a CSS comment and inside a template it is
    // almost always a URL. The comment must open and close inside the same
    // template run, so a stray `/*` in template DATA cannot reach past a `${` or
    // the closing backtick and delete anything.
    if (stack[stack.length - 1] === "`") {
      if (c === "\\") { out += s.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { stack.pop(); emit(c); i++; continue; }
      if (c === "$" && c2 === "{") { stack.push("{"); emit("${"); i += 2; continue; }
      if (c === "/" && c2 === "*") {
        const close = s.indexOf("*/", i + 2);
        if (close >= 0) {
          const between = s.slice(i + 2, close);
          if (!between.includes("`") && !between.includes("${")) {
            out += s.slice(i, close + 2).replace(/[^\n]/g, "");
            i = close + 2;
            continue;
          }
        }
      }
      out += c; i++; continue;
    }

    // ── code context (top level, or inside a ${ }) ───────────────────────────
    if (c === "`") { stack.push("`"); emit(c); i++; continue; }
    if (c === "}" && stack[stack.length - 1] === "{") { stack.pop(); emit(c); i++; continue; }

    if (c === '"' || c === "'") {
      const end = stringEnd(s, i);
      // Unclosed on this line: a JSX apostrophe, not a delimiter.
      if (end < 0) { emit(c); i++; continue; }
      emit(s.slice(i, end + 1));
      i = end + 1;
      continue;
    }

    if (c === "/" && c2 === "/") {            // line comment: to end of line
      while (i < n && s[i] !== "\n") i++;
      continue;
    }

    if (c === "/" && c2 === "*") {            // block comment: keep its newlines
      const close = s.indexOf("*/", i + 2);
      const stop = close < 0 ? n : close + 2;
      out += s.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
      continue;
    }

    if (c === "/" && regexCanStart(prevChar, prevWord)) {
      const end = regexEnd(s, i);
      if (end >= 0) { emit(s.slice(i, end + 1)); i = end + 1; continue; }
      // No close on this line: it was division.
    }

    emit(c);
    i++;
  }

  // A line that held only a comment is DROPPED, as it always was. A line that was
  // blank in the source stays blank.
  const before = s.split(/\r?\n/);
  return out
    .split(/\r?\n/)
    .filter((l, idx) => l.trim() !== "" || (before[idx] ?? "").trim() === "")
    .join("\n");
}
