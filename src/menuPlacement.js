// Placement math for pointer-anchored menus (the right-click context menu).
// Kept out of TRAQS.jsx so the flip decision can be exercised directly.

/**
 * Decide whether a context menu opens downward or flips above its anchor, and
 * how tall it may be.
 *
 * The menu's own measured height drives the decision. The previous rule
 * compared the space below against a flat 300px guess, which is far shorter
 * than a job-card menu: right-clicking with ~380px below cleared the 300px bar,
 * so the menu opened downward and ran off the page.
 *
 * `maxHeight` is returned only when the menu genuinely cannot fit, so a menu
 * that fits sizes to its content and no scrollbar appears. When it is returned,
 * the menu must actually be scrollable — a `maxHeight` with clipped overflow
 * hides the rows it cuts off, which is the failure this replaces.
 *
 * @param {{y:number, viewportHeight:number, menuHeight:number, pad?:number}} o
 *   `y` is the pointer's viewport Y; `menuHeight` the menu's natural height.
 * @returns {{up: boolean, maxHeight: number|undefined}}
 */
export function placeContextMenu({ y, viewportHeight, menuHeight, pad = 12 }) {
  const vh = Math.max(0, viewportHeight || 0);
  const anchor = Math.max(0, y || 0);
  const h = Math.max(0, menuHeight || 0);
  const spaceBelow = Math.max(0, vh - anchor - pad);
  const spaceAbove = Math.max(0, anchor - pad);
  // Flip only when it truly doesn't fit below AND above is roomier — flipping
  // into an equally cramped space just moves the problem.
  const up = h > spaceBelow && spaceAbove > spaceBelow;
  const avail = up ? spaceAbove : spaceBelow;
  const constrained = h > avail;
  return {
    up,
    maxHeight: constrained ? Math.max(0, Math.min(avail, vh)) : undefined,
  };
}
