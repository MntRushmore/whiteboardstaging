import AgathonDesign
import SwiftUI

/// The words of the Mac screen panel.
enum MacScreenCopy {
    static let title = "Mac screen"
    static let open = "Mac screen"
    static let bring = "Bring to board"
    static let waitingTitle = "Waiting for your Mac"
    static let waitingSteps = "On your Mac, open agathon.app/share, sign in, and choose the window with your questions. It shows here live."
    static let paused = "Paused on your Mac"
}

/// The board with the Mac screen panel beside it: on the left in landscape (Ask docks on the right),
/// on top in portrait. The panel takes about 40% of the space.
struct MacScreenContainer<Board: View>: View {
    @Binding var isOpen: Bool
    @ObservedObject var model: MacScreenModel
    let onBring: (UIImage) -> Void
    let board: Board

    init(isOpen: Binding<Bool>, model: MacScreenModel, onBring: @escaping (UIImage) -> Void, @ViewBuilder board: () -> Board) {
        _isOpen = isOpen
        self.model = model
        self.onBring = onBring
        self.board = board()
    }

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            let layout = landscape ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
            layout {
                if isOpen {
                    MacScreenPanel(model: model, close: { isOpen = false }, onBring: onBring)
                        .frame(width: landscape ? geo.size.width * 0.4 : nil, height: landscape ? nil : geo.size.height * 0.4)
                        .transition(.move(edge: landscape ? .leading : .top))
                }
                board
            }
            .dsAnimation(DS.Motion.snap, value: isOpen)
        }
    }
}

/// The Mac's window, live: pinch to zoom in on a question, Bring to board to put it on the page.
struct MacScreenPanel: View {
    @ObservedObject var model: MacScreenModel
    let close: () -> Void
    let onBring: (UIImage) -> Void
    @State private var zoom: CGFloat = 1
    @State private var pinch: CGFloat = 1
    @State private var offset: CGSize = .zero
    @GestureState private var drag: CGSize = .zero

    var body: some View {
        VStack(spacing: 0) {
            header
            ZStack {
                DS.Color.surface
                if let frame = model.frame {
                    Image(uiImage: frame)
                        .resizable()
                        .interpolation(.high)
                        .aspectRatio(contentMode: .fit)
                        .scaleEffect(zoom * pinch)
                        .offset(x: offset.width + drag.width, y: offset.height + drag.height)
                        .gesture(zoomGesture.simultaneously(with: panGesture))
                        .onTapGesture(count: 2) { withAnimation(.spring(response: 0.3)) { zoom = 1; offset = .zero } }
                        .accessibilityLabel("Your Mac's window")
                } else {
                    waiting
                }
            }
            .clipped()
            footer
        }
        .background(DS.Color.ground)
        .overlay(alignment: .trailing) { Rectangle().fill(DS.Color.line).frame(width: 1.5) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("macScreen.panel")
    }

    private var header: some View {
        HStack(spacing: DS.Space.s) {
            DSIcon(.laptop, size: 20).foregroundStyle(DS.Color.ink)
            Text(MacScreenCopy.title).dsFont(.title, size: 20).foregroundStyle(DS.Color.ink)
            if model.frame != nil {
                Circle().fill(model.live() ? DS.Color.success : DS.Color.line).frame(width: 10, height: 10)
                    .accessibilityLabel(model.live() ? "Live" : MacScreenCopy.paused)
            }
            Spacer()
            RoundButton(.close, fill: .paper, label: "Close Mac screen", action: close)
                .accessibilityIdentifier("macScreen.close")
        }
        .padding(.horizontal, DS.Space.m)
        .padding(.vertical, DS.Space.s)
    }

    private var waiting: some View {
        VStack(spacing: DS.Space.s) {
            DSIcon(.laptop, size: 40).foregroundStyle(DS.Color.inkSecondary)
            Text(MacScreenCopy.waitingTitle).dsFont(.title, size: 22).foregroundStyle(DS.Color.ink)
            Text(MacScreenCopy.waitingSteps)
                .dsFont(.callout)
                .foregroundStyle(DS.Color.inkSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
        }
        .padding(DS.Space.l)
    }

    private var footer: some View {
        HStack {
            PillButton(MacScreenCopy.bring, icon: .plus, kind: .primary) {
                if let frame = model.frame { onBring(frame) }
            }
            .fixedSize()
            .disabled(model.frame == nil)
            .opacity(model.frame == nil ? 0.5 : 1)
            .accessibilityIdentifier("macScreen.bring")
            Spacer()
        }
        .padding(DS.Space.m)
    }

    private var zoomGesture: some Gesture {
        MagnifyGesture()
            .onChanged { pinch = $0.magnification }
            .onEnded { v in
                zoom = min(5, max(1, zoom * v.magnification))
                pinch = 1
                if zoom == 1 { offset = .zero }
            }
    }

    private var panGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .updating($drag) { v, s, _ in if zoom > 1 { s = v.translation } }
            .onEnded { v in if zoom > 1 { offset.width += v.translation.width; offset.height += v.translation.height } }
    }
}
