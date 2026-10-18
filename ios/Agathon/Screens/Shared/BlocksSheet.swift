import AgathonDesign
import SwiftUI

extension View {
    /// A Blocks sheet: paper, card corners, room around the content, as tall as it needs (iPadOS 18
    /// sizes it to fit; 17 uses the form sheet's size).
    func blocksSheet(width: CGFloat = 520) -> some View {
        modifier(BlocksSheet(width: width))
    }
}

private struct BlocksSheet: ViewModifier {
    let width: CGFloat

    func body(content: Content) -> some View {
        let padded = content
            .padding(DS.Space.xl)
            .frame(maxWidth: width, alignment: .topLeading)
            .presentationBackground(DS.Color.paper)
            .presentationCornerRadius(DS.Radius.card)
        if #available(iOS 18.0, *) {
            padded.presentationSizing(.fitted)
        } else {
            padded.presentationDetents([.medium, .large])
        }
    }
}
