// The native tab bar's glass platter, resized: a little taller, a little narrower.
//
// iOS 26 gives the Liquid Glass tab bar no size API. Measured in the simulator, not
// assumed: UITabBarAppearance's stackedItemWidth/Positioning/Spacing and UITabBar's
// itemWidth/itemPositioning all leave the platter exactly where it was (360 × 62pt,
// 21pt in from each side on a 402pt screen). So this adjusts the platter's frame
// directly, after the system has laid it out, and the platter then lays its own
// buttons and selection glass out inside the new bounds.
//
// `_UITabBarPlatterView` is a private class. If a future iOS renames it, the lookup
// finds nothing and the bar simply keeps Apple's size — the failure is harmless.
#if canImport(UIKit)
import UIKit
import ObjectiveC

enum TabBarSizing {
    /// Points added to the platter's height. It grows UPWARD, so its distance from
    /// the bottom of the screen is unchanged.
    static let extraHeight: CGFloat = 2
    /// Points taken off EACH side.
    static let insetEachSide: CGFloat = 2

    /// Swap UITabBar.layoutSubviews for one that runs the system's layout, then
    /// resizes the platter. Once, at launch.
    static func install() {
        guard !installed else { return }
        installed = true
        let cls: AnyClass = UITabBar.self
        guard let original = class_getInstanceMethod(cls, #selector(UITabBar.layoutSubviews)),
              let replacement = class_getInstanceMethod(cls, #selector(UITabBar.traqs_layoutSubviews))
        else { return }
        method_exchangeImplementations(original, replacement)
    }
    private static var installed = false

    /// The frame we last wrote, per platter. When the platter still holds it, the
    /// system has NOT re-laid it out since, so adjusting again would compound —
    /// this is what keeps repeated layout passes from shrinking the bar each time.
    fileprivate static var appliedKey: UInt8 = 0

    /// Inset of the buttons from the platter's edges — Apple's own, measured: 4pt
    /// all round in a 360 × 62 platter.
    private static let buttonInset: CGFloat = 4

    fileprivate static func adjust(_ bar: UITabBar) {
        guard let platter = bar.subviews.first(where: { name($0) == "_UITabBarPlatterView" })
        else { return }
        let current = platter.frame
        let applied = (objc_getAssociatedObject(platter, &appliedKey) as? NSValue)?.cgRectValue
        if applied != current {
            let target = CGRect(x: current.minX + insetEachSide,
                                y: current.minY - extraHeight,
                                width: current.width - insetEachSide * 2,
                                height: current.height + extraHeight)
            platter.frame = target
            objc_setAssociatedObject(platter, &appliedKey, NSValue(cgRect: target), .OBJC_ASSOCIATION_RETAIN)
        }
        relayoutButtons(in: platter)
    }

    /// The bar's own layout pass places the buttons for Apple's platter size, and
    /// the platter does not re-place them when its bounds change (measured: the
    /// last button ended flush with the narrowed edge, and the row sat 1pt high).
    /// So they are re-spread here exactly as Apple spreads them — first and last
    /// `buttonInset` from the edges, the rest evenly between — at the platter's
    /// new size. The selection lens, when it is resting on a button, moves with it.
    ///
    /// Computed purely from the platter's bounds, so running it on every layout
    /// pass lands on the same frames and never drifts.
    private static func relayoutButtons(in platter: UIView) {
        let lens = platter.subviews.first(where: { name($0) == "_UILiquidLensView" })
        var lensTarget: CGRect?
        for container in platter.subviews where ["ContentView", "SelectedContentView"].contains(name(container)) {
            let buttons = container.subviews
                .filter { name($0) == "_UITabButton" }
                .sorted { $0.frame.minX < $1.frame.minX }
            guard let first = buttons.first else { continue }
            let bounds = container.bounds
            let w = first.frame.width
            let h = bounds.height - buttonInset * 2
            let step = buttons.count > 1
                ? (bounds.width - buttonInset * 2 - w) / CGFloat(buttons.count - 1) : 0
            for (i, b) in buttons.enumerated() {
                let old = b.frame
                let new = CGRect(x: buttonInset + step * CGFloat(i), y: buttonInset, width: w, height: h)
                if let lens, name(container) == "ContentView", lens.frame == old { lensTarget = new }
                if old != new { b.frame = new }
            }
        }
        if let lens, let lensTarget, lens.frame != lensTarget { lens.frame = lensTarget }
    }

    private static func name(_ v: UIView) -> String { String(describing: type(of: v)) }
}

extension UITabBar {
    /// After `install()`, this name points at the ORIGINAL layoutSubviews — so the
    /// call below is the system's layout, not recursion.
    @objc fileprivate func traqs_layoutSubviews() {
        traqs_layoutSubviews()
        TabBarSizing.adjust(self)
    }
}
#endif
