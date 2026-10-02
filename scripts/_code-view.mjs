// A source file with its COMMENTS removed.
//
// Why this exists, and it has cost this campaign five false results to learn:
// an assertion about CODE must not be satisfiable — or violable — by a COMMENT.
// The comment explaining a fix almost always names the pattern the fix removed,
// because that is what makes the comment worth reading. A raw scan then matches
// its own prose and reports the defect as still present (#343), or, worse,
// matches an explanation and reports a defect as fixed when it is not.
//
// Both comment forms have bitten:
//   //  a line comment at a fix site naming the removed read
//   {/* a JSX comment standing where deleted markup used to be */}
//
// So block comments go first (they can span lines and carry the JSX braces
// with them), then whole-line comments.
//
// This is deliberately ONE function imported by every suite rather than a few
// lines copied into each. Two copies of a scanner drift, and a drifted scanner
// is the quietest kind of broken test: it keeps passing.

/** Strip block and line comments, preserving line structure. */
export function codeOf(src) {
  const noBlocks = String(src == null ? "" : src)
    // {/* … */} with its JSX braces, then any remaining /* … */
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlocks
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}
