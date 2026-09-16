import CoreGraphics

// MARK: - Where a pointer-anchored menu opens
//
// A direct port of `src/menuPlacement.js` and `placePopover` (TRAQS.jsx:2333).
// The web already pulled the first of these out of its 30,000-line component so
// the flip decision could be exercised on its own; this keeps that split.
//
// Pure and geometry-only — no view, no window, no screen. Everything the rules
// need is a number the caller measures.

enum MenuPlacement {

    /// Whether a menu opens downward from the pointer or flips above it, and how
    /// tall it may be.
    ///
    /// The menu's OWN MEASURED HEIGHT drives the decision, which is the whole
    /// point of the web's version and the bug it was written to fix: the rule
    /// before it compared the space below against a flat 300pt guess. A job's
    /// menu is much taller than that, so right-clicking with ~380pt below cleared
    /// the bar, opened downward, and ran off the bottom of the page.
    ///
    /// `maxHeight` comes back only when the menu genuinely cannot fit. A menu
    /// that fits sizes to its content, so no scrollbar appears on a short one —
    /// and when it IS returned the menu must actually scroll, because a height
    /// cap with clipped overflow silently hides the rows it cuts off.
    struct Context: Equatable {
        var up: Bool
        var maxHeight: CGFloat?
    }

    static func contextMenu(pointerY: CGFloat, viewportHeight: CGFloat,
                            menuHeight: CGFloat, pad: CGFloat = 12) -> Context {
        let viewport = max(0, viewportHeight)
        let anchor = max(0, pointerY)
        let height = max(0, menuHeight)
        let below = max(0, viewport - anchor - pad)
        let above = max(0, anchor - pad)
        // Flip only when it truly does not fit below AND above is roomier —
        // flipping into an equally cramped space just moves the problem.
        let up = height > below && above > below
        let available = up ? above : below
        let constrained = height > available
        return Context(up: up,
                       maxHeight: constrained ? max(0, min(available, viewport)) : nil)
    }

    /// `placePopover(rect, count, rowH)` — for a list anchored to a CONTROL
    /// rather than to the pointer: the status picker, the custom-select picker.
    ///
    /// Rows are a known height and there is a known number of them, so unlike
    /// the context menu this one can decide before anything is measured.
    struct Popover: Equatable {
        var x: CGFloat
        var y: CGFloat
        var maxHeight: CGFloat?
        var up: Bool
    }

    static func popover(anchor: CGRect, rowCount: Int, rowHeight: CGFloat = 35,
                        viewportHeight: CGFloat, pad: CGFloat = 8) -> Popover {
        let below = viewportHeight - anchor.maxY - pad
        let above = anchor.minY - pad
        // `+ 8` is the menu's own 4pt of padding, top and bottom.
        let natural = CGFloat(rowCount) * rowHeight + 8
        let up = below < min(natural, 260) && above > below
        let available = up ? above : below
        let constrained = natural > available
        let height = (constrained ? available : natural).rounded()
        return Popover(x: anchor.minX,
                       y: up ? max(pad, anchor.minY - 4 - height) : anchor.maxY + 4,
                       maxHeight: constrained ? height : nil,
                       up: up)
    }

    /// Keeps a menu of known width inside the viewport horizontally.
    ///
    /// `Math.min(x, innerWidth - 268)` on the web, where 268 is the menu's 252
    /// minimum plus its 16 of breathing room. Also clamped at the left edge,
    /// which the web gets for free from the document origin and a Mac window
    /// does not.
    static func clampX(_ x: CGFloat, menuWidth: CGFloat, viewportWidth: CGFloat,
                       pad: CGFloat = 16) -> CGFloat {
        max(pad, min(x, viewportWidth - menuWidth - pad))
    }
}
