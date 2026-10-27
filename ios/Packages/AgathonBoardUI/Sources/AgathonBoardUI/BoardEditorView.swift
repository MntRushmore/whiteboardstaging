import AgathonBoard
import AgathonDesign
import PDFKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// One-time setup of the board's rendering for the app: SwiftMath for typeset maths, Lexend for the
/// board's own words (a graph's numbers). `BoardEditorView` calls it; call it before drawing a board
/// anywhere else (a thumbnail).
public enum BoardEditorSetup {
    @MainActor private static var done = false

    @MainActor
    public static func install() {
        guard !done else { return }
        done = true
        DSFonts.register()
        MathRendering.install(SwiftMathTypesetter())
        RenderFonts.install(regular: DSFonts.uiPostScriptName(weight: 400), medium: DSFonts.uiPostScriptName(weight: 500),
                            semibold: DSFonts.uiPostScriptName(weight: 600))
    }
}

/// The board editor in Blocks: the canvas on the chalk ground, a top bar (back, the board's name,
/// "Page 2 of 3", More) and the kid dock (Select, Pen, Eraser, Shapes, Picture | Undo, Redo | the
/// five pens | ‹ n/N › and New page), Copy and Delete over a selection, the pages, pictures from
/// Photos, the camera and Files (a PDF page through a page picker).
///
/// Slots for the Live lane:
///  - `topTrailing`: the tutor's status pill and ink meter, at the right of the top bar;
///  - `helpButton`: the big Help me, beside the dock (above it when the board is too narrow);
///  - `overlay`: hint cards and the like over the canvas, in screen space; the `BoardViewport` maps
///    page points to it (and follows the camera).
public struct BoardEditorView<TopTrailing: View, Help: View, Overlay: View>: View {
    @ObservedObject var controller: BoardController
    let title: String
    let onBack: (() -> Void)?
    let onCanvas: ((BoardCanvasView) -> Void)?
    let topTrailing: TopTrailing
    let helpButton: Help
    let overlay: (BoardViewport) -> Overlay
    /// the top bar and the dock (false: the screen around draws its own chrome over the page, SAT v2)
    let chrome: Bool
    /// the camera's insets when there is no chrome (the page edge to edge, fitted to its width)
    let bareInsets: CameraConstraints
    let appearance: CanvasAppearance

    @State private var panel: DockPanel?
    @StateObject private var roomWatch = PageRoomWatch()
    @State private var showPages = false
    @State private var helpSize: CGSize = .zero
    @State private var shownNotice: BoardNotice?
    // pictures
    @State private var showPhotos = false
    @State private var photoItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var showFiles = false
    @State private var pdf: PickedPDF?

    struct PickedPDF: Identifiable {
        let id = UUID()
        let document: PDFDocument
        let name: String
    }

    /// `initialPanel`: a dock panel open from the start (screenshots, previews).
    public init(
        controller: BoardController, title: String, onBack: (() -> Void)? = nil, onCanvas: ((BoardCanvasView) -> Void)? = nil,
        initialPanel: DockPanel? = nil, chrome: Bool = true,
        bareInsets: CameraConstraints = CameraConstraints(top: 0, left: 0, bottom: 0, right: 0, fitsWidth: true),
        appearance: CanvasAppearance = .blocks,
        @ViewBuilder topTrailing: () -> TopTrailing, @ViewBuilder helpButton: () -> Help,
        @ViewBuilder overlay: @escaping (BoardViewport) -> Overlay
    ) {
        BoardEditorSetup.install()
        self.chrome = chrome
        self.bareInsets = bareInsets
        self.appearance = appearance
        _panel = State(initialValue: initialPanel)
        self.controller = controller
        self.title = title
        self.onBack = onBack
        self.onCanvas = onCanvas
        self.topTrailing = topTrailing()
        self.helpButton = helpButton()
        self.overlay = overlay
    }

    public var body: some View {
        GeometryReader { geo in
            // the narrowest windows (Slide Over, a third of a split view) keep the folded dock whole
            let margin: CGFloat = geo.size.width < 420 ? 8 : geo.size.width < 900 ? DS.Space.l + 4 : DS.Space.xxl
            let layout = DockLayout.fitting(width: geo.size.width - 2 * margin, helpWidth: helpSize.width, pages: controller.screenCount)
            let top = geo.safeAreaInsets.top + DS.Space.m + DS.Size.round + DS.Space.m
            let bottom = geo.safeAreaInsets.bottom + DS.Space.m + DockLayout.Size.height + DS.Space.m + (layout.helpAbove ? helpSize.height + DS.Space.s : 0)
            ZStack(alignment: .top) {
                (chrome ? DS.Color.ground : DS.Color.paper).ignoresSafeArea()
                BoardCanvas(controller: controller, insets: chrome ? CameraConstraints(top: top, left: margin, bottom: bottom, right: margin) : bareInsets,
                            appearance: appearance, onCanvas: onCanvas)
                    .ignoresSafeArea()
                overlay(controller.viewport)
                    .ignoresSafeArea()
                SelectionBar(controller: controller, viewport: controller.viewport)
                    .ignoresSafeArea()
                if panel != nil {
                    // a tap off the panel closes it
                    Color.clear.contentShape(Rectangle()).ignoresSafeArea().onTapGesture { panel = nil }
                }
                if chrome { chromeView(layout: layout, margin: margin) }
            }
        }
        .sheet(isPresented: $showPages) {
            PagesSheet(controller: controller)
                .presentationDetents([.height(360)])
                .presentationCornerRadius(DS.Radius.card)
        }
        .photosPicker(isPresented: $showPhotos, selection: $photoItem, matching: .images, photoLibrary: .shared())
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task { await addPhoto(item) }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                showCamera = false
                guard let image else { return }
                Task { await add(try? PictureImport.prepare(image), source: "camera") }
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.pdf, .image]) { result in
            guard case .success(let url) = result else { return }
            Task { await addFile(url) }
        }
        .sheet(item: $pdf) { picked in
            PDFPagePicker(document: picked.document, fileName: picked.name, onPick: { i in
                pdf = nil
                Task { await controller.insertPDFPage(picked.document, index: i, fileName: picked.name) }
            }, onCancel: { pdf = nil })
        }
        .onChange(of: controller.notice) { _, n in
            guard let n else { return }
            withAnimation(DS.Motion.fade) { shownNotice = n }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) {
                if shownNotice?.id == n.id { withAnimation(DS.Motion.fade) { shownNotice = nil } }
                if controller.notice?.id == n.id { controller.notice = nil }
            }
        }
        .onChange(of: controller.tool) { _, _ in if panel == .shapes || panel == .colors { panel = nil } }
    }

    private func chromeView(layout: DockLayout, margin: CGFloat) -> some View {
        VStack(spacing: 0) {
            BoardTopBar(controller: controller, title: title, onBack: onBack, showPages: $showPages, trailing: topTrailing)
                .padding(.top, DS.Space.m)
            if let n = shownNotice {
                notice(n)
                    .padding(.top, DS.Space.s)
                    .frame(maxWidth: 520)
                    .transition(.opacity)
            }
            Spacer(minLength: 0)
            if let p = panel {
                DockPanelView(controller: controller, kind: p, layout: layout, panel: $panel, canTakePhoto: CameraPicker.isAvailable, onPicture: pick)
                    .padding(.bottom, DS.Space.s)
                    .frame(maxWidth: .infinity, alignment: layout.helpAbove ? .center : .leading)
                    .transition(.opacity)
            }
            if layout.helpAbove {
                HStack {
                    Spacer()
                    measuredHelp
                }
                .padding(.bottom, DS.Space.s)
            }
            HStack(alignment: .center, spacing: DockLayout.Size.helpGap) {
                BoardDock(controller: controller, layout: layout, panel: $panel, canTakePhoto: CameraPicker.isAvailable, onPicture: pick)
                    .fixedSize()
                    // the writing reached the bottom of the page: point at New page
                    .overlay(alignment: .topTrailing) {
                        if roomWatch.show && !layout.newPageInMore && controller.strip.canAdd {
                            PageRoomTip(add: {
                                roomWatch.dismiss()
                                panel = nil
                                controller.addScreen()
                            }, dismiss: { roomWatch.dismiss() })
                            .fixedSize()
                            .alignmentGuide(.top) { $0[.bottom] + 2 }
                            .padding(.trailing, DockLayout.Size.padding)
                            .transition(.opacity)
                        }
                    }
                    .onAppear { roomWatch.attach(controller) }
                    .onChange(of: controller.screenCount) { roomWatch.dismiss() }
                Spacer(minLength: 0)
                if !layout.helpAbove { measuredHelp }
            }
            .padding(.bottom, DS.Space.m)
        }
        .padding(.horizontal, margin)
        .dsAnimation(DS.Motion.snap, value: panel)
    }

    private var measuredHelp: some View {
        helpButton
            .fixedSize()
            .background(GeometryReader { g in Color.clear.preference(key: HelpSizeKey.self, value: g.size) })
            .onPreferenceChange(HelpSizeKey.self) { helpSize = $0 }
    }

    private func notice(_ n: BoardNotice) -> some View {
        switch n.kind {
        case .pictureFailed: return Banner(.lookAgain, DockCopy.pictureFailed, message: DockCopy.tryAgain, surface: .ink)
        case .pdfFailed: return Banner(.lookAgain, DockCopy.pdfFailed, message: DockCopy.tryAgain, surface: .ink)
        case .nothingToPaste: return Banner(.lookAgain, DockCopy.nothingToPaste, message: DockCopy.nothingToPasteMessage, surface: .ink)
        case .boardFull: return Banner(.paused, DockCopy.boardFull, message: DockCopy.boardFullMessage, surface: .ink)
        }
    }

    // MARK: - Pictures

    private func pick(_ source: PictureSource) {
        switch source {
        case .photos: showPhotos = true
        case .camera: showCamera = true
        case .files: showFiles = true
        case .paste: Task { await addPasted() }
        }
    }

    /// The clipboard's picture on the board: a question copied on a Mac arrives here by Universal
    /// Clipboard (the owner, 2026-10-27: "a way ... so the ipad screen can see my laptop for questions").
    private func addPasted() async {
        guard let image = UIPasteboard.general.image else {
            controller.notice = BoardNotice(kind: .nothingToPaste)
            return
        }
        let prepared = await Task.detached(priority: .userInitiated) { try? PictureImport.prepare(image) }.value
        await add(prepared, source: "paste")
    }

    private func addPhoto(_ item: PhotosPickerItem) async {
        let data = try? await item.loadTransferable(type: Data.self)
        let prepared = await Task.detached(priority: .userInitiated) { data.flatMap { try? PictureImport.prepare($0) } }.value
        await add(prepared, source: "photo")
    }

    private func add(_ p: PreparedPicture?, source: String) async {
        guard let p else {
            controller.notice = BoardNotice(kind: .pictureFailed)
            return
        }
        await controller.insert(p, source: source)
    }

    private func addFile(_ url: URL) async {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let isPDF = (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType?.conforms(to: .pdf)) ?? false || url.pathExtension.lowercased() == "pdf"
        if isPDF {
            do {
                pdf = PickedPDF(document: try PictureImport.openPDF(url), name: url.lastPathComponent)
            } catch {
                controller.notice = BoardNotice(kind: .pdfFailed)
            }
            return
        }
        let data = try? Data(contentsOf: url)
        let prepared = await Task.detached(priority: .userInitiated) { data.flatMap { try? PictureImport.prepare($0) } }.value
        await add(prepared, source: "file")
    }
}

private struct HelpSizeKey: PreferenceKey {
    static let defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) {
        let n = nextValue()
        if n != .zero { value = n }
    }
}

extension BoardEditorView where TopTrailing == EmptyView, Help == EmptyView, Overlay == EmptyView {
    /// The editor with its slots empty.
    public init(controller: BoardController, title: String, onBack: (() -> Void)? = nil, onCanvas: ((BoardCanvasView) -> Void)? = nil,
                initialPanel: DockPanel? = nil) {
        self.init(controller: controller, title: title, onBack: onBack, onCanvas: onCanvas, initialPanel: initialPanel,
                  topTrailing: { EmptyView() }, helpButton: { EmptyView() }, overlay: { _ in EmptyView() })
    }
}
