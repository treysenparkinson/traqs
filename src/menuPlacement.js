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

/**
 * Horizontal placement and width for an anchored dropdown menu.
 *
 * A portalled menu used to take its width straight from the trigger's rect,
 * which is correct while the trigger is a full-width field and wrong as soon as
 * it is a word. The Jobs page's quick-assign picker hands SimpleDrop the text
 * "Unassigned" as its trigger; the menu came out about 70px wide and clipped
 * every name in it to two letters.
 *
 * So a CUSTOM trigger stops dictating width: the menu sizes to its own content
 * with a readable floor, and is pulled back from the viewport edge rather than
 * hanging off it. A DEFAULT trigger keeps matching its own width exactly, which
 * is what every existing caller expects and what makes this safe to change in a
 * shared control.
 *
 * @param {{left:number, width:number, viewportWidth:number, custom?:boolean,
 *          minWidth?:number, pad?:number}} o
 * @returns {{left:number, width:number|undefined, minWidth:number|undefined,
 *            maxWidth:number}}
 */
export function placeDropMenu({ left, width, viewportWidth, custom = false, minWidth = 220, pad = 8 }) {
  const maxWidth = Math.max(120, viewportWidth - pad * 2);
  if (!custom) return { left, width, minWidth: undefined, maxWidth };
  // Never wider than the viewport allows, never narrower than readable.
  const want = Math.min(Math.max(minWidth, width), maxWidth);
  // Pull back from the right edge, then refuse to go off the left.
  const x = Math.max(pad, Math.min(left, viewportWidth - want - pad));
  return { left: x, width: undefined, minWidth: want, maxWidth };
}
