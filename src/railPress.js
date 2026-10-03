// The rail's selection highlight, painted on PRESS.
//
// Switching page re-renders the whole app before React repaints the rail, so a
// highlight driven only by `view` lands a beat after the click — on the Schedule
// that beat is long enough to see. On mouse-down the pressed button is painted
// with the accent straight onto the DOM, and the previously selected one cleared,
// so the colour fade (the .tq-sidebar button transition) starts at once. React's
// own render then lands on the same values.
//
// `data-nav-active` is the selection as the DOM currently shows it. Hover handlers
// read it rather than a render-time `active`, because between the press and the
// commit that closure is stale and would repaint the button you just pressed.
//
// Plain objects with `.style` and `.dataset` stand in for buttons in the suite
// (scripts/shell-redesign-test.mjs), which executes this.

export const isNavActive = (el) => el?.dataset?.navActive === "1";

const paint = (b, active, { on, onInk, off, offInk }) => {
  b.dataset.navActive = active ? "1" : "0";
  b.style.background = active ? on : off;
  b.style.color = active ? onInk : offInk;
};

// After every commit: make each button match the selection React last rendered.
// A press that did not navigate (an unsaved-changes guard, a refused page) gets no
// repaint from React — its virtual style never changed — so without this the
// painted guess would stick. Only buttons that disagree are touched, so a button
// under the cursor keeps its hover fill.
export function syncRail(buttonsByKey, activeKey, colors) {
  if (!colors) return;
  for (const [key, b] of Object.entries(buttonsByKey || {})) {
    if (!b) continue;
    const should = key === activeKey;
    if (isNavActive(b) !== should) paint(b, should, colors);
  }
}

export function paintPress(pressed, buttons, { on, onInk, off, offInk }) {
  for (const b of buttons) {
    if (!b || b === pressed || !isNavActive(b)) continue;
    b.dataset.navActive = "0";
    b.style.background = off;
    b.style.color = offInk;
  }
  pressed.dataset.navActive = "1";
  pressed.style.background = on;
  pressed.style.color = onInk;
}
