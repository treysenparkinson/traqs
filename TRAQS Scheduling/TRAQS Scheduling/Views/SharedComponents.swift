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
        .padding(.top, 6)
    }
}

// MARK: - Fast TRAQS Labeled Button

struct FastTRAQSPillButton: View {
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 12, weight: .bold))
            Text("Ask TRAQS")
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
                .fixedSize()
        }
        .foregroundColor(Color(hex: T.accent))
        .fixedSize()
    }
}
