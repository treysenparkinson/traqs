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
}
