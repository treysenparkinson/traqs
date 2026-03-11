import SwiftUI

// MARK: - TRAQS Nav Bar Logo

struct TRAQSNavLogo: View {
    @Environment(ThemeSettings.self) private var themeSettings

    var body: some View {
        Image(themeSettings.isLightTheme ? "TRAQSLogoBlack" : "TRAQSLogoWhite")
            .resizable()
            .scaledToFit()
            .frame(height: 22)
    }
}

// MARK: - TRAQS Nav Header (logo + tab name)

struct TRAQSNavHeader: View {
    let tabName: String

    var body: some View {
        VStack(spacing: 2) {
            TRAQSNavLogo()
            Text(tabName)
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(Color(hex: T.muted))
                .kerning(0.8)
                .textCase(.uppercase)
        }
        .padding(.top, 12)
    }
}

// MARK: - Fast TRAQS Labeled Button

struct FastTRAQSPillButton: View {
    var body: some View {
        Image(systemName: "bolt.fill")
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(Color(hex: T.accent))
            .frame(width: 32, height: 32)
            .background(Color(hex: T.accent).opacity(0.12))
            .clipShape(Circle())
            .overlay(Circle().stroke(Color(hex: T.accent).opacity(0.3), lineWidth: 1))
    }
}
