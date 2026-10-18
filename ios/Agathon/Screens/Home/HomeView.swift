import AgathonDesign
import AgathonKit
import SwiftUI

/// Home, in Blocks (docs/brand/directions.html, "Blocks: Home"): the mark, the tutor's ink, who is
/// signed in and the grown-ups' door at the top; "Hi Maya." and New board; then My boards as tiles.
/// Tapping a board opens it full screen through `BoardOpening`.
struct HomeView: View {
    @Environment(AgathonBackend.self) private var backend
    @Environment(\.boardOpening) private var opening
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model = HomeModel()
    @State private var query = ""
    @State private var openBoard: OpenBoard?
    @State private var renaming: BoardSummary?
    @State private var deleting: BoardSummary?
    @State private var sheet: HomeSheet?
    @State private var area: AreaRequest?

    enum HomeSheet: String, Identifiable {
        case switcher, grownUpPin, topics
        var id: String { rawValue }
    }

    struct AreaRequest: Identifiable {
        let page: AccountArea.Page
        var id: String { page.rawValue }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            DS.Color.ground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    topBar
                        .padding(.top, DS.Space.m)
                    hello
                        .padding(.top, DS.Space.xl)
                    if model.showsPractice {
                        practiceRow
                            .padding(.top, DS.Space.xl)
                    }
                    boardsSection
                        .padding(.top, DS.Space.xxl)
                }
                .padding(.horizontal, ScreenMargin.horizontal(sizeClass))
                .padding(.bottom, DS.Space.xxxl)
                .frame(maxWidth: 1400)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await model.load(backend) }
            .scrollDismissesKeyboard(.interactively)

            if let toast = model.toast {
                Banner(toast.kind, toast.title, message: toast.message, surface: .ink)
                    .fixedSize()
                    .padding(.bottom, DS.Space.xl)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                    .task(id: toast.id) {
                        try? await Task.sleep(for: .seconds(3.5))
                        withDSAnimation(DS.Motion.fade, reduceMotion: reduceMotion) { model.toast = nil }
                    }
                    .accessibilityIdentifier("home.toast")
            }
        }
        .dsAnimation(DS.Motion.snap, value: model.toast)
        .task {
            await model.load(backend)
            if HomeFlow.openGrownUpsNext {
                HomeFlow.openGrownUpsNext = false
                area = AreaRequest(page: .account)
            }
        }
        .fullScreenCover(item: $openBoard, onDismiss: { Task { await model.refreshQuietly(backend) } }) { request in
            opening.makeView(request)
                .environment(backend)
                #if DEBUG
                .labsButton()
                #endif
        }
        .sheet(item: $renaming) { board in
            RenameBoardSheet(board: board) { await model.rename(board, to: $0, backend: backend) }
        }
        .sheet(item: $deleting) { board in
            DeleteBoardSheet(board: board, thumbnail: model.thumbnail(for: board)) { await model.delete(board, backend: backend) }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .switcher:
                ProfileSwitcherSheet(initial: model.family, openMine: {
                    area = AreaRequest(page: .progress)
                }).environment(backend)
            case .grownUpPin:
                ProfileSwitcherSheet(initial: model.family, start: .grownUp).environment(backend)
            case .topics:
                TopicPickerSheet(grade: model.grade, summary: model.summary) { skill in
                    Task { if let request = await model.startTopic(skill, backend: backend) { openBoard = request } }
                }
            }
        }
        .fullScreenCover(item: $area, onDismiss: { Task { await model.load(backend) } }) { request in
            AccountArea(start: request.page, isKid: model.isKid, family: model.family) { skill in
                Task { if let board = await model.startTopic(skill, backend: backend) { openBoard = board } }
            }
            .environment(backend)
            #if DEBUG
            .labsButton()
            #endif
        }
    }

    // MARK: the top bar

    private var topBar: some View {
        HStack(spacing: DS.Space.s) {
            AgathonLogo(size: 30)
            Spacer(minLength: DS.Space.s)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    inkMeter
                    profileChip
                    grownUpsChip(showsWord: true)
                }
                HStack(spacing: 10) {
                    profileChip
                    grownUpsChip(showsWord: false)
                }
                profileChip
            }
        }
        .frame(minHeight: DS.Size.minTarget)
    }

    @ViewBuilder private var inkMeter: some View {
        if model.ink != nil {
            InkMeter(level: InkLevel.level(model.ink), style: .compact)
                .fixedSize()
                .accessibilityIdentifier("boards.ink")
        }
    }

    private var profileChip: some View {
        ProfileChip(model.displayName(email: backend.auth.email), color: model.avatarColor) {
            sheet = .switcher
        }
        .fixedSize()
        .accessibilityIdentifier("boards.switchProfile")
    }

    private func grownUpsChip(showsWord: Bool) -> some View {
        Button {
            if model.isKid { sheet = .grownUpPin } else { area = AreaRequest(page: .account) }
        } label: {
            HStack(spacing: 8) {
                DSIcon(.lock, size: 18)
                if showsWord {
                    Text("Grown-ups").dsFont(.button, size: 17).lineLimit(1)
                }
            }
            .foregroundStyle(DS.Color.ink)
            .padding(.horizontal, showsWord ? 20 : 0)
            .frame(minWidth: DS.Size.minTarget, minHeight: DS.Size.minTarget)
            .background(Capsule().fill(DS.Color.surface))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .fixedSize()
        .accessibilityLabel("Grown-ups")
        .accessibilityHint(model.isKid ? "Needs the grown-up's PIN" : "Account, family and sign out")
        .accessibilityIdentifier("home.grownUps")
    }

    // MARK: hello

    private var hello: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .lastTextBaseline, spacing: DS.Space.l) {
                greeting
                Spacer(minLength: DS.Space.l)
                HStack(spacing: DS.Space.s) {
                    topicButton
                    newBoardButton
                }
            }
            VStack(alignment: .leading, spacing: DS.Space.l) {
                greeting
                HStack(spacing: DS.Space.s) {
                    topicButton
                    newBoardButton
                }
            }
        }
    }

    private var greeting: some View {
        let name = model.greetingName(email: backend.auth.email)
        return (Text(name.map { "Hi \($0)." } ?? "Hi there.") + Text(" Ready?").foregroundStyle(DS.Color.inkSecondary))
            .dsFont(.display)
            .foregroundStyle(DS.Color.ink)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("home.greeting")
    }

    private var topicButton: some View {
        PillButton("Pick a topic", icon: .book, kind: .secondary) { sheet = .topics }
            .fixedSize()
            .accessibilityIdentifier("home.topics")
    }

    // MARK: Today's practice and the path

    private var practiceRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: DS.Space.l) {
                today.frame(minWidth: 560)
                path.frame(minWidth: 380)
            }
            .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: DS.Space.l) {
                today
                path
            }
        }
    }

    private var today: some View {
        TodayCard(row: model.todayRow, streak: model.streak, busy: model.startingPractice) {
            Task { if let request = await model.startPractice(backend) { openBoard = request } }
        }
    }

    private var path: some View {
        PathCard(path: model.path, isKid: model.isKid, open: { area = AreaRequest(page: .progress) },
                 pickGrade: { area = AreaRequest(page: .account) })
    }

    private var newBoardButton: some View {
        PillButton(model.creating ? "Making…" : "New board", icon: .plus, kind: .primary) {
            Task {
                if let board = await model.create(backend) { openBoard = OpenBoard(board: board) }
            }
        }
        .disabled(model.creating)
        .fixedSize()
        .accessibilityIdentifier("boards.new")
    }

    // MARK: my boards

    private var visibleBoards: [BoardSummary] { HomeModel.filter(model.boards, query: query) }

    private var showsSearch: Bool { model.boards.count >= HomeModel.searchThreshold }

    @ViewBuilder private var boardsSection: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: DS.Space.m) {
                    boardsHeading
                    Spacer(minLength: DS.Space.m)
                    if showsSearch { search.frame(width: 360) }
                }
                VStack(alignment: .leading, spacing: DS.Space.m) {
                    boardsHeading
                    if showsSearch { search }
                }
            }
            boardsBody
                .padding(.top, DS.Space.xxs)
        }
    }

    private var boardsHeading: some View {
        HStack(alignment: .firstTextBaseline, spacing: DS.Space.s) {
            Text("My boards")
                .dsFont(.title)
                .foregroundStyle(DS.Color.ink)
                .accessibilityAddTraits(.isHeader)
            Text(countText)
                .dsFont(.button, size: 16)
                .foregroundStyle(DS.Color.inkSecondary)
                .accessibilityIdentifier("boards.count")
        }
        .fixedSize()
    }

    private var countText: String {
        guard model.loaded, model.listError == nil else { return "" }
        let n = model.boards.count
        return "\(n) board\(n == 1 ? "" : "s")"
    }

    private var search: some View {
        PillField("Search boards", text: $query, icon: .search, onPaper: false)
            .submitLabel(.search)
            .autocorrectionDisabled()
            .accessibilityIdentifier("boards.search")
    }

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 220, maximum: 420), spacing: DS.Space.l, alignment: .top)]
    }

    @ViewBuilder private var boardsBody: some View {
        if !model.loaded {
            LazyVGrid(columns: columns, alignment: .leading, spacing: DS.Space.l) {
                ForEach(0..<4, id: \.self) { _ in BoardTilePlaceholder() }
            }
            .accessibilityElement()
            .accessibilityLabel("Getting your boards")
        } else if let error = model.listError {
            EmptyState(.icon(.offline, .sunny), title: "Couldn't load your boards", message: error,
                       actionTitle: "Try again", actionIcon: .retry) {
                Task { await model.load(backend) }
            }
            .frame(maxWidth: .infinity)
            .accessibilityIdentifier("boards.error")
        } else if model.boards.isEmpty {
            EmptyState(.shapes(.hello), title: "No boards yet",
                       message: "Tap New board, write your math by hand, and the tutor checks each step.",
                       actionTitle: "New board", actionIcon: .plus) {
                Task { if let board = await model.create(backend) { openBoard = OpenBoard(board: board) } }
            }
            .frame(maxWidth: .infinity)
            .accessibilityIdentifier("boards.empty")
        } else if visibleBoards.isEmpty {
            EmptyState(.icon(.search, .paper), title: "No boards match", message: "Try another word, or clear the search.",
                       actionTitle: "Clear search", actionIcon: .close) { query = "" }
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("boards.noMatches")
        } else {
            LazyVGrid(columns: columns, alignment: .leading, spacing: DS.Space.l) {
                ForEach(visibleBoards) { board in
                    BoardTile(board: board, thumbnail: model.thumbnail(for: board),
                              open: { openBoard = OpenBoard(board: board) },
                              rename: { renaming = board },
                              delete: { deleting = board })
                }
            }
        }
    }
}

#Preview {
    HomeView()
        .environment(AgathonBackend.preview())
}

/// What Home does next time it appears (a kid typed the grown-up's PIN to reach the grown-ups'
/// places: the grown-up's Home opens them straight away).
@MainActor
enum HomeFlow {
    static var openGrownUpsNext = false
}
