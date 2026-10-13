// The native tab bar's glass platter, resized to the custom TRAQS pill it replaced:
// a 355 × 66 bar with a 73 × 54 highlight (TRAQSTabBar's barWidth / barHeight /
// highlightW / highlightH before 8782d7a).
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
    /// The old pill's outer size: 15pt padding each side + five 57pt keys + four
    /// 10pt gaps = 355 wide; 66 tall. Centred where Apple centres its own, and
    /// grown UPWARD, so the bar's distance from the bottom of the screen is Apple's.
    static let platterSize = CGSize(width: 355, height: 66)
    /// The old highlight: 73 × 54 (keyW + 16, and 6pt clear above and below in 66).
    static let buttonSize = CGSize(width: 73, height: 54)

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


    fileprivate static func adjust(_ bar: UITabBar) {
        guard let platter = bar.subviews.first(where: { name($0) == "_UITabBarPlatterView" })
        else { return }
        let current = platter.frame
        let applied = (objc_getAssociatedObject(platter, &appliedKey) as? NSValue)?.cgRectValue
        if applied != current {
            let target = CGRect(x: current.midX - platterSize.width / 2,
                                y: current.maxY - platterSize.height,
                                width: platterSize.width,
                                height: platterSize.height)
            platter.frame = target
            objc_setAssociatedObject(platter, &appliedKey, NSValue(cgRect: target), .OBJC_ASSOCIATION_RETAIN)
        }
        relayoutButtons(in: platter)
    }

    /// The bar's own layout pass places the buttons for Apple's platter size, and
    /// the platter does not re-place them when its bounds change (measured: the
    /// last button ended flush with the narrowed edge, and the row sat 1pt high).
    /// So they are re-spread here at the old pill's geometry: `buttonSize` each,
    /// centred vertically, the first and last the same distance from the ends and
    /// the rest evenly between — 7pt from each end and a 67pt step, the old keys'
    /// centres. The selection lens, when it is resting on a button, moves with it.
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
            guard !buttons.isEmpty else { continue }
            let bounds = container.bounds
            let w = buttonSize.width, h = buttonSize.height
            let endInset = (bounds.width - (w + 67 * CGFloat(buttons.count - 1))) / 2
            let step = buttons.count > 1
                ? (bounds.width - endInset * 2 - w) / CGFloat(buttons.count - 1) : 0
            let y = (bounds.height - h) / 2
            for (i, b) in buttons.enumerated() {
                let old = b.frame
                let new = CGRect(x: endInset + step * CGFloat(i), y: y, width: w, height: h)
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
