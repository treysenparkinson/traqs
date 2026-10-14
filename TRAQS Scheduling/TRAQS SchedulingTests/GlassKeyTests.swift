import Testing
import SwiftUI
import UIKit
@testable import TRAQS_Scheduling

// The PIN keys moved onto the native `.glass` button style, which pads its label.
// GlassKey compensates so a key is still exactly the size the pad lays out for.
@MainActor
@Suite("GlassKey lands at its stated size")
struct GlassKeyTests {

    func measure<V: View>(_ v: V) -> CGSize {
        let host = UIHostingController(rootView: v)
        return host.sizeThatFits(in: CGSize(width: 1000, height: 1000))
    }

    @Test("a plain glass key is size × size")
    func plain() {
        let s = measure(GlassKey(size: 78, action: {}) { Text("5") })
        #expect(abs(s.width - 78) < 0.5, "width \(s.width)")
        #expect(abs(s.height - 78) < 0.5, "height \(s.height)")
    }

    @Test("a prominent glass key is size × size too")
    func prominent() {
        let s = measure(GlassKey(size: 78, prominent: true, tint: .blue, action: {}) {
            Image(systemName: "checkmark")
        })
        #expect(abs(s.width - 78) < 0.5, "width \(s.width)")
        #expect(abs(s.height - 78) < 0.5, "height \(s.height)")
    }

    @Test("capsule and rounded native glass pad a label 12pt a side, 7pt top and bottom")
    func capsuleInsets() {
        let label = Color.clear.frame(width: 100, height: 40)
        let want = CGSize(width: 100 + 2 * NativeGlass.insetH, height: 40 + 2 * NativeGlass.insetV)
        for s in [measure(Button {} label: { label }.nativeGlass(.capsule)),
                  measure(Button {} label: { label }.nativeGlass(.capsule, prominent: true)),
                  measure(Button {} label: { label }.nativeGlass(.rounded(18)))] {
            #expect(abs(s.width - want.width) < 0.5, "width \(s.width)")
            #expect(abs(s.height - want.height) < 0.5, "height \(s.height)")
        }
    }
}
