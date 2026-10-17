import SwiftUI

// MARK: - Segmented picker

/// A segmented control: a chalk (or paper) track with the chosen segment as an ink pill that snaps
/// across. Segments are 56 pt tall.
public struct SegmentedPicker<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, title: String)]
    let onPaper: Bool
    @Namespace private var namespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// `onPaper`: a chalk track on paper; otherwise a paper track on the ground.
    public init(selection: Binding<Value>, options: [(value: Value, title: String)], onPaper: Bool = false) {
        _selection = selection
        self.options = options
        self.onPaper = onPaper
    }

    public var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.value) { option in
                let on = option.value == selection
                Button {
                    withDSAnimation(DS.Motion.snap, reduceMotion: reduceMotion) { selection = option.value }
                } label: {
                    Text(option.title)
                        .dsFont(.button, size: 17)
                        .lineLimit(1)
                        .foregroundStyle(on ? DS.Color.onInk : DS.Color.ink)
                        .padding(.horizontal, 20)
                        .frame(maxWidth: .infinity, minHeight: DS.Size.minTarget - 8)
                        .background {
                            if on {
                                Capsule().fill(DS.Color.ink).matchedGeometryEffect(id: "selection", in: namespace)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(SegmentStyle())
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Capsule().fill(onPaper ? DS.Color.surfaceSunken : DS.Color.surface))
        .fixedSize(horizontal: false, vertical: true)
    }

    private struct SegmentStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            configuration.label.pressEffect(configuration.isPressed)
        }
    }
}

// MARK: - Text field

/// A pill text field (the Ask input, sign-in). Chalk on paper, paper on the ground. A focused field
/// gets the 3 pt focus ring.
public struct PillField: View {
    let placeholder: String
    @Binding var text: String
    let icon: DS.Icon?
    let secure: Bool
    let onPaper: Bool
    @FocusState private var focused: Bool

    public init(_ placeholder: String, text: Binding<String>, icon: DS.Icon? = nil, secure: Bool = false,
                onPaper: Bool = true) {
        self.placeholder = placeholder
        _text = text
        self.icon = icon
        self.secure = secure
        self.onPaper = onPaper
    }

    public var body: some View {
        HStack(spacing: 12) {
            if let icon { DSIcon(icon, size: 20).foregroundStyle(DS.Color.inkSecondary) }
            Group {
                if secure {
                    SecureField("", text: $text, prompt: prompt)
                } else {
                    TextField("", text: $text, prompt: prompt)
                }
            }
            .font(.ds(.callout))
            .foregroundStyle(DS.Color.ink)
            .tint(DS.Color.focus)
            .focused($focused)
        }
        .padding(.horizontal, 22)
        .frame(minHeight: DS.Size.field)
        .background(Capsule().fill(onPaper ? DS.Color.surfaceSunken : DS.Color.surface))
        .overlay {
            if focused { Capsule().strokeBorder(DS.Color.focus, lineWidth: DS.Stroke.focus) }
        }
        .contentShape(Capsule())
        .onTapGesture { focused = true }
        .accessibilityElement(children: .contain)
    }

    private var prompt: Text { Text(placeholder).foregroundStyle(DS.Color.inkSecondary) }
}

// MARK: - PIN

/// The grown-ups' PIN: dots that fill as digits go in. An empty place is a flat chalk circle, a
/// filled one an ink dot that pops in. `lookAgain` turns them sunny (never red).
public struct PinDots: View {
    let count: Int
    let length: Int
    let lookAgain: Bool

    public init(count: Int, length: Int = 4, lookAgain: Bool = false) {
        self.count = count
        self.length = length
        self.lookAgain = lookAgain
    }

    public var body: some View {
        HStack(spacing: 18) {
            ForEach(0..<length, id: \.self) { i in
                Circle()
                    .fill(lookAgain ? DS.Color.tryAgain : (i < count ? DS.Color.ink : DS.Color.line))
                    .frame(width: 20, height: 20)
                    .scaleEffect(i < count ? 1 : 0.8)
                    .dsAnimation(DS.Motion.pop, value: i < count)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("\(count) of \(length) digits")
    }
}

/// One key on the PIN pad: a 76 pt circle.
public struct PinKey: View {
    public enum Key: Hashable, Sendable {
        case digit(Int)
        case delete
    }

    let key: Key
    let action: () -> Void

    public init(_ key: Key, action: @escaping () -> Void) {
        self.key = key
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            switch key {
            case .digit(let d): Text("\(d)").dsFont(.numeral, size: 30)
            case .delete: DSIcon(.delete, size: 28)
            }
        }
        .buttonStyle(KeyStyle(quiet: key == .delete))
        .accessibilityLabel(label)
    }

    private var label: String {
        switch key {
        case .digit(let d): "\(d)"
        case .delete: "Delete"
        }
    }

    private struct KeyStyle: ButtonStyle {
        let quiet: Bool
        func makeBody(configuration: Configuration) -> some View {
            let fill = DS.Fill.paper
            configuration.label
                .foregroundStyle(DS.Color.ink)
                .frame(width: DS.Size.pinKey, height: DS.Size.pinKey)
                .background(Circle().fill(configuration.isPressed ? fill.pressed.color
                                          : (quiet ? SwiftUI.Color.clear : fill.background.color)))
                .contentShape(Circle())
                .pressEffect(configuration.isPressed)
        }
    }
}

/// The PIN pad: 1 to 9, then 0 and delete. Calls `onComplete` when `length` digits are in.
public struct PinPad: View {
    @Binding var entry: String
    let length: Int
    let onComplete: (String) -> Void

    public init(entry: Binding<String>, length: Int = 4, onComplete: @escaping (String) -> Void = { _ in }) {
        _entry = entry
        self.length = length
        self.onComplete = onComplete
    }

    public var body: some View {
        Grid(horizontalSpacing: 22, verticalSpacing: 16) {
            ForEach(0..<3) { row in
                GridRow {
                    ForEach(1...3, id: \.self) { col in
                        let d = row * 3 + col
                        PinKey(.digit(d)) { type(d) }
                    }
                }
            }
            GridRow {
                Color.clear.frame(width: DS.Size.pinKey, height: DS.Size.pinKey)
                PinKey(.digit(0)) { type(0) }
                PinKey(.delete) { if !entry.isEmpty { entry.removeLast() } }
                    .disabled(entry.isEmpty)
            }
        }
    }

    private func type(_ d: Int) {
        guard entry.count < length else { return }
        entry.append(String(d))
        if entry.count == length { onComplete(entry) }
    }
}

#Preview("Inputs") {
    struct Demo: View {
        @State var tab = "Boards"
        @State var text = ""
        @State var pin = "12"
        var body: some View {
            VStack(spacing: 28) {
                SegmentedPicker(selection: $tab, options: [("Boards", "Boards"), ("Practice", "Practice"), ("Progress", "Progress")])
                    .frame(width: 460)
                PillField("Ask me anything…", text: $text, onPaper: false).frame(width: 420)
                PinDots(count: pin.count)
                PinPad(entry: $pin)
            }
            .padding(40)
            .background(DS.Color.ground)
        }
    }
    return Demo()
}
