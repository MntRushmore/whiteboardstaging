import AgathonDesign
import SwiftUI

// The Design Gallery: every token and component of AgathonDesign on one screen, for checking the
// system on a device. Debug builds only. Launch arguments:
//
//   -designGallery                 open the gallery instead of the app
//   -designGalleryPage <page>      open on a page: colour, type, shape, controls, feedback, brand,
//                                  stickers, screens
//   -designGalleryScreen <screen>  open a full screen: splash, offline
//   -designGalleryAnchor <id>      scroll the page to a section on open

extension View {
    /// With `-designGallery` (Debug builds), the Design Gallery stands in for the app.
    func designGalleryOnLaunch() -> some View { modifier(DesignGalleryLaunch()) }
}

private struct DesignGalleryLaunch: ViewModifier {
    func body(content: Content) -> some View {
        #if DEBUG
        if DesignGallery.isRequested { DesignGallery() } else { content }
        #else
        content
        #endif
    }
}

#if DEBUG
struct DesignGallery: View {
    enum Page: String, CaseIterable, Identifiable {
        case colour, type, shape, controls, feedback, brand, stickers, screens
        var id: String { rawValue }
        var title: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
    }

    static var isRequested: Bool { ProcessInfo.processInfo.arguments.contains("-designGallery") }

    static func argument(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    @State private var page: Page = Page(rawValue: DesignGallery.argument("-designGalleryPage") ?? "") ?? .colour
    @State private var screen: String? = DesignGallery.argument("-designGalleryScreen")

    var body: some View {
        if screen == "splash" {
            SplashView()
        } else if screen == "offline" {
            OfflineView { screen = nil }
        } else {
            gallery
        }
    }

    private var gallery: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 14) {
                    AgathonLogo(size: 26)
                    Text("Design Gallery").dsFont(.headline).foregroundStyle(DS.Color.inkSecondary)
                    Spacer()
                    Tag("Blocks", style: .ink)
                }
                SegmentedPicker(selection: $page, options: Page.allCases.filter { $0 != .screens }.map { ($0, $0.title) })
            }
            .padding(.horizontal, 32)
            .padding(.top, 20)
            .padding(.bottom, 16)
            ScrollViewReader { proxy in
                ScrollView {
                    Group {
                        switch page {
                        case .colour: ColourPage()
                        case .type: TypePage()
                        case .shape: ShapePage()
                        case .controls: ControlsPage()
                        case .feedback: FeedbackPage()
                        case .brand: BrandPage()
                        case .stickers: StickersPage()
                        case .screens: ScreensPage(open: { screen = $0 })
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.bottom, 48)
                }
                .onAppear {
                    if let anchor = DesignGallery.argument("-designGalleryAnchor") {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { proxy.scrollTo(anchor, anchor: .top) }
                    }
                }
            }
        }
        .background(DS.Color.ground.ignoresSafeArea())
    }
}

// MARK: - Layout helpers

private struct GallerySection<Content: View>: View {
    let title: String
    let id: String?
    let content: Content

    init(_ title: String, id: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.id = id
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 20)
        .id(id ?? title)
    }
}

private struct Panel<Content: View>: View {
    let kind: Card<Content>.Kind
    let content: Content
    init(_ kind: Card<Content>.Kind = .paper, @ViewBuilder content: () -> Content) {
        self.kind = kind
        self.content = content()
    }
    var body: some View { Card(kind, padding: 24) { content } }
}

private struct Caption: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary) }
}

// MARK: - Colour

private typealias T = DS.ColorTokens

private struct ColourPage: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            GallerySection("Surfaces and ink") {
                Panel { SwatchRow([T.ground, T.paper, T.surfaceSunken, T.ink, T.inkSecondary, T.line, T.divider, T.onInkSecondary, T.onInkFaint]) }
            }
            GallerySection("Brand") {
                Panel {
                    FlowStack(spacing: 12, lineSpacing: 16, alignment: .top) {
                        SwatchRow([T.sunny, T.tomato])
                        TutorSwatch()
                        SwatchRow([T.cobaltDeep, T.tutorInkEmpty])
                    }
                }
            }
            GallerySection("Kid pens: none is blue or purple") {
                Panel {
                    HStack(spacing: 22) {
                        ForEach(DS.KidPen.all) { pen in
                            VStack(spacing: 6) {
                                Circle().fill(pen.color).frame(width: 44, height: 44)
                                Text(pen.name).dsFont(.button, size: 14)
                                Text(pen.rgb.hex).font(.system(size: 12, design: .monospaced)).foregroundStyle(DS.Color.inkSecondary)
                                Text("ΔE \(Int(pen.rgb.deltaE2000(DS.Palette.cobalt).rounded()))")
                                    .dsFont(.caption, size: 12).foregroundStyle(DS.Color.inkSecondary)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    Caption("ΔE00 from tutor ink; 25 and up reads as another colour.")
                }
            }
            GallerySection("Feedback and rewards") {
                Panel { SwatchRow([T.success, T.tryAgain, T.star, T.starEmpty, T.streak, T.focus]) }
            }
            GallerySection("Contrast (WCAG AA)", id: "contrast") {
                Panel {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                        ForEach(DS.ContrastPair.all) { pair in ContrastChip(pair: pair) }
                    }
                }
            }
        }
    }
}

private struct SwatchRow: View {
    let tokens: [ColorToken]
    init(_ tokens: [ColorToken]) { self.tokens = tokens }
    var body: some View {
        FlowStack(spacing: 12, lineSpacing: 16, alignment: .top) {
            ForEach(tokens) { token in
                VStack(alignment: .leading, spacing: 6) {
                    RoundedRectangle(cornerRadius: DS.Radius.swatch, style: .continuous)
                        .fill(token.color)
                        .frame(width: 78, height: 52)
                        .overlay(RoundedRectangle(cornerRadius: DS.Radius.swatch, style: .continuous)
                            .strokeBorder(DS.Color.line, lineWidth: token.light.contrast(with: DS.Palette.paper) < 1.3 ? 1 : 0))
                    Text(token.name).dsFont(.button, size: 13).lineLimit(1).fixedSize()
                    Text(token.light.hex).font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.Color.inkSecondary)
                }
                .frame(minWidth: 78, alignment: .leading)
            }
        }
    }
}

private struct TutorSwatch: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: DS.Radius.swatch, style: .continuous)
                .fill(DS.Color.tutorInk)
                .frame(width: 168, height: 52)
                .overlay(alignment: .leading) {
                    Text("Tutor ink only").dsFont(.button, size: 14).foregroundStyle(DS.Color.onInk).padding(.leading, 14)
                }
            Text("tutorInk").dsFont(.button, size: 13)
            Text(DS.ColorTokens.tutorInk.light.hex).font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.Color.inkSecondary)
        }
    }
}

private struct ContrastChip: View {
    let pair: DS.ContrastPair
    var body: some View {
        HStack(spacing: 10) {
            Text("Aa")
                .font(DS.Font.fixed(.button, size: 18))
                .foregroundStyle(pair.foreground.color)
                .frame(width: 44, height: 40)
                .background(RoundedRectangle(cornerRadius: 10).fill(pair.background.color))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.Color.line, lineWidth: pair.background.light == DS.Palette.paper ? 1 : 0))
            VStack(alignment: .leading, spacing: 1) {
                Text(String(format: "%.1f:1", pair.ratio)).dsFont(.button, size: 14)
                Text(pair.use == .text ? "text" : (pair.use == .largeText ? "large text" : "graphic"))
                    .dsFont(.caption, size: 11).foregroundStyle(DS.Color.inkSecondary)
            }
            Spacer(minLength: 0)
            Image(systemName: pair.passes ? "checkmark" : "xmark").font(.system(size: 12, weight: .bold))
                .foregroundStyle(pair.passes ? DS.Color.success : DS.Color.tomato)
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 14).fill(DS.Color.surfaceSunken))
    }
}

// MARK: - Type

private struct TypePage: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            GallerySection("Type scale") {
                Panel {
                    Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 16, verticalSpacing: 18) {
                        TypeRow(.display, "Hi Maya.")
                        TypeRow(.title, "Today's practice")
                        TypeRow(.headline, "Fractions practice")
                        TypeRow(.bigNumber, "4")
                        TypeRow(.heading, "Your 3rd grade path")
                        TypeRow(.body, "A fourth is the same as 2 eighths.")
                        TypeRow(.callout, "Because the pieces are different sizes.")
                        TypeRow(.button, "New board")
                        TypeRow(.label, "Next up")
                        TypeRow(.caption, "Today · 3 screens")
                        TypeRow(.numeral, "0123456789")
                        TypeRow(.tutorHand, "Make the bottoms match first", color: DS.Color.tutorInk)
                    }
                }
            }
            GallerySection("Families") {
                Panel {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Bricolage Grotesque ExtraBold for display: big, tight and a little quirky. Optical size follows the point size.").dsFont(.callout)
                        Text("Lexend for UI and numerals: made to be easy to read, with plain digits a kid can match to their own.").dsFont(.callout)
                        Text("Kalam Bold for the tutor's hand, in tutor ink only.").dsFont(.callout)
                        Caption("All three: SIL Open Font License 1.1, licences bundled with the fonts.")
                    }
                }
            }
        }
    }
}

private struct TypeRow: View {
    let style: DS.TextStyle
    let sample: String
    let color: SwiftUI.Color
    init(_ style: DS.TextStyle, _ sample: String, color: SwiftUI.Color = DS.Color.ink) {
        self.style = style
        self.sample = sample
        self.color = color
    }
    var body: some View {
        GridRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(style.id).dsFont(.button, size: 13)
                Text("\(Int(style.size)) · \(Int(style.weight))").dsFont(.caption, size: 12).foregroundStyle(DS.Color.inkSecondary)
            }
            .fixedSize()
            Text(sample).dsFont(style).foregroundStyle(color)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Shape and motion

private struct ShapePage: View {
    @State private var replay = 0
    @State private var tick = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            GallerySection("Shape: cards 28, tools are circles, buttons are pills") {
                Panel {
                    FlowStack(spacing: 22, lineSpacing: 18, alignment: .bottom) {
                        VStack(spacing: 8) {
                            RoundedRectangle(cornerRadius: DS.Radius.card, style: .continuous).fill(DS.Color.ground).frame(width: 96, height: 64)
                            Caption("Card 28")
                        }
                        VStack(spacing: 8) { Circle().fill(DS.Color.ink).frame(width: 56, height: 56); Caption("Tool 56") }
                        VStack(spacing: 8) {
                            Capsule().fill(DS.Color.sunny).frame(width: 110, height: 64)
                                .overlay(Text("Start").dsFont(.button))
                            Caption("Main button 64")
                        }
                        VStack(spacing: 8) {
                            HelpMeButton {}
                            Caption("Help me 72")
                        }
                    }
                    Caption("No borders. No shadows. Depth is a colour change.")
                }
            }
            GallerySection("Spacing") {
                Panel {
                    HStack(alignment: .bottom, spacing: 22) {
                        ForEach(DS.Space.all, id: \.0) { name, value in
                            VStack(spacing: 6) {
                                RoundedRectangle(cornerRadius: 3).fill(DS.Color.cobalt).frame(width: 16, height: value)
                                Text(name).dsFont(.button, size: 12)
                                Text("\(Int(value))").dsFont(.caption, size: 12).foregroundStyle(DS.Color.inkSecondary)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
            GallerySection("Radii") {
                Panel {
                    FlowStack(spacing: 16, lineSpacing: 14, alignment: .top) {
                        ForEach(DS.Radius.all, id: \.0) { name, value in
                            VStack(spacing: 6) {
                                RoundedRectangle(cornerRadius: value, style: .continuous).fill(DS.Color.ground).frame(width: 64, height: 64)
                                Text(name).dsFont(.button, size: 12)
                                Text("\(Int(value))").dsFont(.caption, size: 12).foregroundStyle(DS.Color.inkSecondary)
                            }
                        }
                    }
                }
            }
            GallerySection("Icons: line icons in the ring of the mark") {
                Panel {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 68), spacing: 6)], spacing: 14) {
                        ForEach(DS.Icon.allCases) { icon in
                            VStack(spacing: 6) {
                                IconCircle(icon, fill: icon == .pen ? .ink : (icon == .mic ? .sunny : .chalk), diameter: 52)
                                Text(icon.label).dsFont(.caption, size: 11).lineLimit(1).minimumScaleFactor(0.7)
                            }
                        }
                    }
                }
            }
            GallerySection("Motion: snap", id: "motion") {
                Panel {
                    HStack(spacing: 28) {
                        TickShape()
                            .trim(from: 0, to: tick ? 1 : 0)
                            .stroke(DS.Color.tutorInk, style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round))
                            .frame(width: 82, height: 78)
                            .frame(width: 100, height: 100)
                        AgathonMark(.color, assembles: true, replay: replay).frame(width: 100, height: 100)
                        Spacer(minLength: 0)
                    }
                    Text("Fast and sure: 150 to 250 ms, one small overshoot, then still. The tutor's tick draws in one stroke; the mark assembles ring, bar, dot.")
                        .dsFont(.callout)
                    PillButton("Play it again", icon: .play, kind: .secondaryOnPaper) {
                        replay += 1
                        tick = false
                        withDSAnimation(DS.Motion.draw, reduceMotion: reduceMotion) { tick = true }
                    }
                }
                .onAppear { withDSAnimation(DS.Motion.draw, reduceMotion: reduceMotion) { tick = true } }
            }
        }
    }
}

// MARK: - Controls

private struct ControlsPage: View {
    @State private var tool: DS.Icon = .pen
    @State private var pen: DS.KidPen = .black
    @State private var segment = "Boards"
    @State private var text = ""
    @State private var pin = "12"

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            GallerySection("Buttons: solid pills, press = 96 % and darken") {
                Panel {
                    FlowStack(spacing: 12, lineSpacing: 14) {
                        PillButton("New board", icon: .plus, kind: .primary) {}
                        PillButton("Continue", icon: .play, kind: .sunny, size: .large) {}
                        PillButton("See all", kind: .secondaryOnPaper) {}
                        PillButton("Not now", kind: .quiet) {}
                        PillButton("Try again", kind: .primary, size: .large) {}
                        PillButton("Start", kind: .sunny) {}
                        PillButton("Locked", icon: .lock) {}.disabled(true)
                    }
                }
            }
            GallerySection("The board") {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 10) {
                        RoundButton(.back) {}
                        FlowStack(spacing: 16, lineSpacing: 8) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Fractions practice").dsFont(.headline)
                                Text("Screen 1 of 3").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                            }
                            StatusPill("Checking…")
                        }
                        Spacer(minLength: 8)
                        InkMeter(level: 0.7, style: .compact)
                        RoundButton(.more) {}
                    }
                    Dock {
                        ForEach([DS.Icon.pen, .eraser, .more], id: \.self) { icon in
                            ToolButton(icon, isOn: tool == icon, context: .dock) { if icon != .more { tool = icon } }
                        }
                        DockSeparator()
                        ToolButton(.undo, context: .dock) {}
                        ToolButton(.redo, context: .dock) {}.disabled(true)
                        DockSeparator()
                        ForEach(DS.KidPen.all) { p in PenSwatch(p, isOn: pen == p) { pen = p } }
                    }
                    .fixedSize()
                    HelpMeButton {}
                    Caption("On a narrow screen the dock folds Shapes and Picture behind More, as the Ask panel does.")
                }
            }
            GallerySection("Tools on light: icon and one word") {
                Panel(.chalk) {
                    FlowStack(spacing: 8, lineSpacing: 12) {
                        ToolButton(.pen, title: "Pen", isOn: true) {}
                        ToolButton(.eraser, title: "Eraser") {}
                        ToolButton(.shapes, title: "Shapes") {}
                        ToolButton(.picture, title: "Picture") {}
                        ToolButton(.mic, title: "Talk") {}
                        ForEach(DS.KidPen.all) { p in PenSwatch(p, isOn: p == .green, context: .light) {} }
                    }
                }
            }
            GallerySection("Chips, tags and people") {
                Panel {
                    FlowStack(spacing: 10, lineSpacing: 12) {
                        Chip("3 more like these") {}
                        Chip("Show me with pizza") {}
                        Tag("Next up", style: .ink)
                        Tag("Screen 1")
                        ProfileChip("Maya") {}
                        ProfileChip("Leo", color: DS.Palette.cobalt) {}
                        PillButton("Grown-ups", icon: .lock, kind: .secondaryOnPaper) {}
                    }
                }
            }
            GallerySection("Segmented and text field", id: "inputs") {
                Panel {
                    SegmentedPicker(selection: $segment, options: [("Boards", "Boards"), ("Practice", "Practice"), ("Progress", "Progress")], onPaper: true)
                    PillField("Your grown-up's email", text: $text, icon: .person)
                    HStack(spacing: 10) {
                        PillField("Ask me anything…", text: .constant(""))
                        RoundButton(.mic, fill: .sunny, diameter: 64) {}
                    }
                }
            }
            GallerySection("PIN for grown-ups", id: "pin") {
                Panel {
                    HStack(spacing: 40) {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Grown-ups only").dsFont(.title)
                            Text("Type the 4-digit PIN.").dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
                            PinDots(count: pin.count).padding(.top, 10)
                        }
                        Spacer(minLength: 0)
                        PinPad(entry: $pin)
                    }
                }
            }
        }
    }
}

// MARK: - Feedback

private struct FeedbackPage: View {
    @State private var burst = 0
    private var todayCard: some View {
        Card(.cobalt, radius: DS.Radius.cardLarge, deco: true, fillsHeight: true) {
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Today's practice").dsFont(.label)
                    Text("5 problems").dsFont(.title, size: 52).padding(.top, 12)
                    Text("About 10 minutes · 2 of 5 done").dsFont(.callout).padding(.top, 10)
                    PillButton("Continue", icon: .play, kind: .sunny, size: .large) {}.padding(.top, 26)
                }
                Spacer(minLength: 0)
                VStack(alignment: .leading, spacing: 16) {
                    StarRow(earned: 2, size: 30, onCobalt: true)
                    StreakBadge(days: 4, onCobalt: true)
                    WeekDots([("M", .done), ("T", .done), ("W", .done), ("T", .today), ("F", .later), ("S", .later), ("S", .later)], on: .cobalt)
                }
            }
        }
    }

    private var pathCard: some View {
        Card(.sunny, radius: DS.Radius.cardLarge, fillsHeight: true) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Your 3rd grade path").dsFont(.headline)
                    Spacer()
                    Text("12 of 30 done").dsFont(.button, size: 15)
                }
                SkillTrail([.done, .done, .done, .now, .later, .later], size: 34).padding(.top, 22)
                HStack(spacing: 12) {
                    Tag("Next up", style: .ink)
                    Text("Adding fractions").dsFont(.headline)
                }
                .padding(.top, 22)
                Text("3 short lessons · about 15 minutes").dsFont(.caption, size: 15).padding(.top, 6)
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            GallerySection("Cards: the logo's ring, dot and bar become every card") {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 16) { todayCard; pathCard }
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(minWidth: 900)
                    VStack(spacing: 16) { todayCard; pathCard }
                }
                HStack(spacing: 16) {
                    Card(.paper, fillsHeight: true) {
                        StreakBadge(days: 4)
                        WeekDots([("M", .done), ("T", .done), ("W", .done), ("T", .today), ("F", .later), ("S", .later), ("S", .later)], on: .paper)
                    }
                    Card(.paper, fillsHeight: true) {
                        HStack(spacing: 18) {
                            ProgressRing(progress: 0.4, label: "2/5")
                            ProgressRing(progress: 1)
                            ProgressRing(progress: 0.75, tint: DS.Color.success)
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            GallerySection("Messages: short and kind; look again is yellow", id: "messages") {
                HStack(alignment: .top, spacing: 16) {
                    VStack(spacing: 10) {
                        Banner(.success, "You got it.", message: "5 for 5 today.")
                        Banner(.lookAgain, "Look again.", message: "Check the bottom number.")
                        Banner(.paused, "Help is paused for now.", message: "Ask a grown-up to switch it back on.", surface: .ink)
                        Banner(.tutor, "Your tutor wrote on screen 2.", surface: .ink)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        CheerPill("Nailed it.")
                        Panel {
                            VStack(alignment: .leading, spacing: 16) {
                                InkMeter(level: 0.8)
                                InkMeter(level: 0.12)
                                InkMeter(level: 0)
                            }
                        }
                    }
                    .frame(width: 280)
                }
            }
            GallerySection("Ask") {
                Panel {
                    VStack(spacing: 12) {
                        SheetHeader("Ask your tutor", tag: "Screen 1", actions: [.init(.speaker) {}], onClose: {})
                        ChatBubble("Hi Maya! Ask me anything, and I can write on your board too.", from: .tutor)
                        ChatBubble("why can't I just add the tops?", from: .kid, icon: .mic)
                    }
                }
            }
            GallerySection("A finished set", id: "celebrate") {
                Panel {
                    HStack(spacing: 24) {
                        ZStack {
                            CelebrationBurst(size: 240, frozen: true)
                            TheShapes(.celebrate, animated: false).frame(width: 120)
                        }
                        .frame(width: 240, height: 200)
                        ZStack {
                            CelebrationBurst(trigger: burst, size: 240)
                            PillButton("Celebrate", icon: .star, kind: .sunny) { burst += 1 }
                        }
                        .frame(width: 240, height: 200)
                    }
                }
            }
            GallerySection("Empty") {
                Panel {
                    EmptyState(.icon(.picture, .sunny), title: "No boards yet", message: "Start one and write anything.",
                               actionTitle: "New board", actionIcon: .plus) {}
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }
}

// MARK: - Brand

private struct BrandPage: View {
    @State private var replay = 0
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            GallerySection("The mark: ring, dot and bar, three colours") {
                Panel {
                    HStack(spacing: 28) {
                        AgathonMark(.color, assembles: true, replay: replay).frame(width: 110, height: 110)
                        AgathonMark(.mono(DS.Color.ink)).frame(width: 110, height: 110)
                        AppIconArt().frame(width: 110, height: 110)
                        VStack(alignment: .leading, spacing: 16) {
                            AgathonLogo(size: 44, replay: replay)
                            AgathonLogo(size: 26)
                            PillButton("Assemble", icon: .play, kind: .secondaryOnPaper) { replay += 1 }
                        }
                    }
                }
            }
            GallerySection("The shapes: eyes only for big moments", id: "shapes") {
                Panel {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 20), GridItem(.flexible(), spacing: 20)], spacing: 24) {
                        ForEach(TheShapes.Pose.allCases) { pose in
                            VStack(spacing: 10) {
                                TheShapes(pose, showsGround: true).frame(width: 220)
                                Text(poseTitle(pose)).dsFont(.button, size: 15)
                            }
                        }
                    }
                }
            }
            GallerySection("From 24 to 200 pt", id: "sizes") {
                Panel {
                    HStack(alignment: .bottom, spacing: 24) {
                        ForEach([24.0, 48, 96, 200], id: \.self) { w in
                            VStack(spacing: 8) {
                                TheShapes(.hello).frame(width: w)
                                Caption("\(Int(w)) pt")
                            }
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }

    private func poseTitle(_ pose: TheShapes.Pose) -> String {
        switch pose {
        case .hello: "Hello"
        case .thinking: "Thinking"
        case .celebrate: "Celebrate"
        case .outOfInk: "Out of ink"
        }
    }
}

// MARK: - Stickers

private struct StickersPage: View {
    @State private var landing = 0
    @State private var slots: [Sticker.Kind?] = [.star, .star, .ring, .star, .flame, .perfect, .star, .mark, nil, nil, nil, nil]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            GallerySection("Stickers: practice wins only") {
                Card(.ink, padding: 24) {
                    HStack(spacing: 0) {
                        ForEach(Sticker.Kind.allCases) { kind in
                            VStack(spacing: 12) {
                                Sticker(kind, size: 84, face: kind == .star, lift: DS.Color.stickerLiftOnInk)
                                Text(kind.label.replacingOccurrences(of: " sticker", with: "")).dsFont(.button, size: 13)
                                    .multilineTextAlignment(.center)
                                    .foregroundStyle(DS.Color.onInk)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.top, 8)
                }
                Caption("A star for a problem done on your own, the ring for one done with a hint, a flame for a streak, a tick for a perfect set, the whole mark for a skill mastered.")
            }
            GallerySection("The sticker book", id: "book") {
                StickerBook(slots: slots, newest: slots.lastIndex { $0 != nil }, landing: landing)
                PillButton("Earn a sticker", icon: .star, kind: .sunny) {
                    if let i = slots.firstIndex(where: { $0 == nil }) { slots[i] = .star }
                    landing += 1
                }
                .padding(.top, 8)
            }
        }
    }
}

// MARK: - Screens

private struct ScreensPage: View {
    let open: (String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            GallerySection("Screens this lane owns") {
                HStack(spacing: 12) {
                    PillButton("Splash", icon: .play, kind: .secondary) { open("splash") }
                    PillButton("Offline", icon: .offline, kind: .secondary) { open("offline") }
                }
            }
        }
    }
}

#Preview {
    DesignGallery()
}
#endif
