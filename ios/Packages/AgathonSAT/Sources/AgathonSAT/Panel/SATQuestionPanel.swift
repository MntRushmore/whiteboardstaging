#if os(iOS)
import AgathonDesign
import SwiftUI

/// What the panel asks of the screen around it.
public struct SATPanelActions {
    /// a question was checked (the screen may do more: nothing yet)
    public var checked: (SATPractice.CheckResult) -> Void = { _ in }
    /// the question on show changed (the board follows to its page)
    public var moved: () -> Void = {}
    /// the set's results
    public var results: () -> Void = {}
    /// the cap line's button: a free account (no account) or the plan (a free account)
    public var capTapped: () -> Void = {}
    /// the tutor couldn't be reached: ask again
    public var retryTutor: () -> Void = {}
    /// fold the panel to its tab
    public var collapse: (() -> Void)?
    /// "Graph an equation": nil when it went on the board, else the words why not
    public var graph: ((String) async -> String?)?
    /// leave review
    public var endReview: () -> Void = {}
    /// leave the session (back to SAT home)
    public var close: (() -> Void)?
    /// before Check: the screen settles what the attempt says (the tutor used or not)
    public var beforeCheck: () -> Void = {}

    public init() {}
}

/// The question panel (docs/SAT-MODE.md, "The session"): "Question 3 of 10", the skill, Mark for
/// review, the stem with its maths and figure, the four choices with Bluebook's eliminator (or the
/// grid-in and its keypad), Check, what the check said, the solution, the free tutor's line, Graph an
/// equation; Back and Next at the foot. Grown-up Blocks: calm, flat, no faces, no confetti.
public struct SATQuestionPanel: View {
    let practice: SATPractice
    let account: SATAccount
    let actions: SATPanelActions

    @State private var graphText = ""
    @State private var graphNote: String?
    @State private var graphing = false
    @FocusState private var graphFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// the collapse chevron's turn: left beside the board, up above it
    let collapseTurn: Double

    public init(practice: SATPractice, account: SATAccount, actions: SATPanelActions, collapsesUp: Bool = false) {
        self.practice = practice
        self.account = account
        self.actions = actions
        collapseTurn = collapsesUp ? 90 : 0
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(DS.Color.line).frame(height: 1)
            ScrollViewReader { proxy in
                ScrollView {
                    if let q = practice.current {
                        content(q)
                            .padding(.horizontal, DS.Space.l)
                            .padding(.top, DS.Space.l)
                            .padding(.bottom, DS.Space.xl)
                            .id(q.id)
                    }
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: practice.index) { _, _ in
                    graphNote = nil
                    if let id = practice.current?.id { proxy.scrollTo(id, anchor: .top) }
                }
                .onChange(of: practice.item.solutionOpen) { _, open in
                    guard open else { return }
                    withAnimation(reduceMotion ? nil : DS.Motion.fade) { proxy.scrollTo("solution", anchor: .top) }
                }
            }
            Rectangle().fill(DS.Color.line).frame(height: 1)
            footer
        }
        .background(DS.Color.paper)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.panel")
    }

    // MARK: header

    private var header: some View {
        HStack(spacing: DS.Space.s) {
            if let close = actions.close {
                RoundButton(.close, fill: .chalk, diameter: 44, label: "End practice", action: close)
                    .accessibilityIdentifier("sat.close")
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(headerTitle)
                    .dsFont(.headline, size: 22)
                    .foregroundStyle(DS.Color.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("sat.position")
                if let q = practice.current { SATSkillChip(question: q) }
            }
            Spacer(minLength: DS.Space.xs)
            markButton
            if let collapse = actions.collapse {
                Button(action: collapse) {
                    Image(systemName: "sidebar.left")
                        .font(.system(size: 17, weight: .semibold))
                        .rotationEffect(.degrees(collapseTurn))
                        .foregroundStyle(DS.Color.ink)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(DS.Color.surfaceSunken))
                        .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
                        .contentShape(Circle())
                }
                .buttonStyle(SATPress())
                .accessibilityLabel(SATCopy.hidePanel)
                .accessibilityIdentifier("sat.collapse")
            }
        }
        .padding(.horizontal, DS.Space.l)
        .padding(.vertical, DS.Space.s)
    }

    private var headerTitle: String {
        if let list = practice.reviewing, let k = list.firstIndex(of: practice.index) { return SATCopy.reviewing(k + 1, list.count) }
        return SATCopy.questionOf(practice.item.number, practice.item.count)
    }

    private var markButton: some View {
        let marked = practice.item.marked
        return Button { practice.toggleMarked() } label: {
            HStack(spacing: 6) {
                Image(systemName: marked ? "bookmark.fill" : "bookmark")
                    .font(.system(size: 15, weight: .semibold))
                Text(marked ? "Marked" : "Mark")
                    .dsFont(.button, size: 15)
            }
            .foregroundStyle(marked ? DS.Color.onInk : DS.Color.ink)
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(Capsule().fill(marked ? DS.Color.ink : DS.Color.surfaceSunken))
            .frame(minHeight: DS.Size.minTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(SATPress())
        .accessibilityLabel(marked ? SATCopy.marked : SATCopy.mark)
        .accessibilityAddTraits(marked ? .isSelected : [])
        .accessibilityIdentifier("sat.mark")
    }

    // MARK: the question

    @ViewBuilder private func content(_ q: SATQuestion) -> some View {
        let item = practice.item
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SATText(q.stem, size: 19)
                .accessibilityIdentifier("sat.stem")
            if let figure = q.figure {
                SATFigureView(figure)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            switch q.format {
            case .mcq:
                VStack(spacing: 10) {
                    ForEach(q.choices ?? []) { c in
                        SATChoiceRow(choice: c, look: look(c, q, item), locked: item.verdict.isLocked,
                                     choose: { practice.choose(c.key) }, strike: { practice.toggleEliminated(c.key) })
                    }
                }
            case .spr:
                SATGridInField(typed: item.typed, hint: item.hint, verdict: item.verdict) { practice.press($0) }
            }
            verdictLine(q, item)
            if item.verdict.isLocked && item.solutionOpen {
                SATSolutionView(q.solution, answer: q.answer.shown).id("solution")
            }
            SATTutorLine(tutor: item.tutor, left: practice.tutorLeft, cap: practice.tutorCap, account: account,
                         capTapped: actions.capTapped, retry: actions.retryTutor)
            if actions.graph != nil { graphField }
        }
    }

    private func look(_ c: SATChoice, _ q: SATQuestion, _ item: SATPractice.Item) -> SATChoiceRow.Look {
        switch item.verdict {
        case .right:
            return c.key == item.chosen ? .right : (item.eliminated.contains(c.key) ? .struck : .plain)
        case .missed:
            if c.key == q.answer.key { return .answer }
            if item.tries.contains(c.key) { return .tried }
            return item.eliminated.contains(c.key) ? .struck : .plain
        case .lookAgain, .open:
            if item.eliminated.contains(c.key) { return .struck }
            if c.key == item.chosen { return item.tries.contains(c.key) ? .tried : .chosen }
            return item.tries.contains(c.key) ? .tried : .plain
        }
    }

    @ViewBuilder private func verdictLine(_ q: SATQuestion, _ item: SATPractice.Item) -> some View {
        switch item.verdict {
        case .open:
            EmptyView()
        case .lookAgain:
            verdict(icon: .lookAgain, fill: DS.Color.tryAgain, fg: DS.Color.ink, words: SATCopy.lookAgain, id: "sat.verdict.lookAgain")
        case .right(let first):
            VStack(alignment: .leading, spacing: DS.Space.s) {
                verdict(icon: .check, fill: DS.Color.success, fg: DS.Color.onInk, words: first ? SATCopy.right : SATCopy.rightSecond, id: "sat.verdict.right")
                solutionToggle(item)
            }
        case .missed:
            VStack(alignment: .leading, spacing: DS.Space.s) {
                verdict(icon: .lookAgain, fill: DS.Color.tryAgain, fg: DS.Color.ink,
                        words: "\(SATCopy.missed) \(SATCopy.answerWas(SATGridIn.display(q.answer.shown)))", id: "sat.verdict.missed")
                solutionToggle(item)
            }
        }
    }

    private func verdict(icon: DS.Icon, fill: Color, fg: Color, words: String, id: String) -> some View {
        HStack(spacing: 12) {
            DSIcon(icon, size: 16)
                .foregroundStyle(fg)
                .frame(width: 32, height: 32)
                .background(Circle().fill(fill))
            Text(words)
                .dsFont(.button, size: 17)
                .foregroundStyle(DS.Color.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
    }

    private func solutionToggle(_ item: SATPractice.Item) -> some View {
        PillButton(item.solutionOpen ? SATCopy.hideSolution : SATCopy.seeSolution, icon: .book, kind: .secondaryOnPaper) {
            practice.setSolutionOpen(!item.solutionOpen)
        }
        .fixedSize()
        .accessibilityIdentifier("sat.seeSolution")
    }

    // MARK: Graph an equation

    private var graphField: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            Text(SATCopy.graphTitle).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            HStack(spacing: DS.Space.xs) {
                TextField(SATCopy.graphPlaceholder, text: $graphText)
                    .font(DS.Font.fixed(.callout, size: 17))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.numbersAndPunctuation)
                    .focused($graphFocused)
                    .submitLabel(.go)
                    .onSubmit(graph)
                    .padding(.horizontal, 16)
                    .frame(height: 48)
                    .background(Capsule().fill(DS.Color.surfaceSunken))
                    .accessibilityIdentifier("sat.graph.field")
                Button(action: graph) {
                    Text(graphing ? "…" : SATCopy.graphButton)
                        .dsFont(.button, size: 16)
                        .foregroundStyle(DS.Color.ink)
                        .padding(.horizontal, 18)
                        .frame(height: 48)
                        .background(Capsule().fill(DS.Color.surfaceSunken))
                        .frame(minHeight: DS.Size.minTarget)
                }
                .buttonStyle(SATPress())
                .disabled(graphText.trimmingCharacters(in: .whitespaces).isEmpty || graphing)
                .accessibilityIdentifier("sat.graph.go")
            }
            if let note = graphNote {
                Text(note).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                    .accessibilityIdentifier("sat.graph.note")
            }
        }
    }

    private func graph() {
        let typed = graphText.trimmingCharacters(in: .whitespaces)
        guard !typed.isEmpty, let run = actions.graph, !graphing else { return }
        graphing = true
        graphFocused = false
        Task { @MainActor in
            let why = await run(typed)
            graphing = false
            graphNote = why ?? SATCopy.graphDone
            if why == nil { graphText = "" }
        }
    }

    // MARK: footer

    private var footer: some View {
        HStack(spacing: DS.Space.s) {
            RoundButton(.back, fill: .chalk, diameter: 48, label: SATCopy.previous) {
                practice.previous()
                actions.moved()
            }
            .disabled(!practice.hasPrevious)
            .opacity(practice.hasPrevious ? 1 : 0.4)
            .accessibilityIdentifier("sat.previous")
            Spacer(minLength: DS.Space.xs)
            primary
            Spacer(minLength: DS.Space.xs)
            RoundButton(.forward, fill: .chalk, diameter: 48, label: SATCopy.next) {
                practice.next()
                actions.moved()
            }
            .disabled(!practice.hasNext)
            .opacity(practice.hasNext ? 1 : 0.4)
            .accessibilityIdentifier("sat.next")
        }
        .padding(.horizontal, DS.Space.m)
        .padding(.vertical, DS.Space.xs)
    }

    @ViewBuilder private var primary: some View {
        let item = practice.item
        if practice.reviewing != nil {
            PillButton(SATCopy.endReview, kind: .primary) { actions.endReview() }
                .fixedSize()
                .accessibilityIdentifier("sat.endReview")
        } else if !item.verdict.isLocked {
            PillButton(SATCopy.check, kind: .primary) {
                actions.beforeCheck()
                let result = practice.check()
                actions.checked(result)
            }
            .disabled(practice.answerNow == nil || practice.answerAlreadyTried)
            .fixedSize()
            .accessibilityIdentifier("sat.check")
        } else if practice.isLastInSet || practice.setDone {
            PillButton(SATCopy.results, kind: .primary) { actions.results() }
                .fixedSize()
                .accessibilityIdentifier("sat.results")
        } else {
            PillButton(SATCopy.next, kind: .primary) {
                practice.next()
                actions.moved()
            }
            .fixedSize()
            .accessibilityIdentifier("sat.nextQuestion")
        }
    }
}

/// The free tutor's quiet line under the question: ready (it starts with the first ink here), on,
/// starting, used up for today (the cap line, with its button), or out of reach (Try again). The
/// tutor's dot is cobalt: cobalt is the tutor's alone.
struct SATTutorLine: View {
    let tutor: SATPractice.Tutor
    let left: Int?
    let cap: Int
    let account: SATAccount
    let capTapped: () -> Void
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            dot.padding(.top, 5)
            VStack(alignment: .leading, spacing: 8) {
                Text(words)
                    .dsFont(.callout, size: 15)
                    .foregroundStyle(capped ? DS.Color.ink : DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("sat.tutor.words")
                if capped {
                    Text(SATCopy.boardStillWorks).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                    PillButton(SATCopy.cappedAction(hasAccount: account.hasAccount), kind: .secondary, action: capTapped)
                        .fixedSize()
                        .accessibilityIdentifier("sat.tutor.capAction")
                } else if tutor == .unavailable {
                    PillButton(SATCopy.tryAgain, icon: .retry, kind: .secondaryOnPaper, action: retry)
                        .fixedSize()
                        .accessibilityIdentifier("sat.tutor.retry")
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(capped ? DS.Color.surfaceSunken : DS.Color.paper))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(DS.Color.line, lineWidth: capped ? 0 : 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.tutor.\(state)")
    }

    private var capped: Bool {
        if case .capped = tutor { return true }
        return false
    }

    private var state: String {
        switch tutor {
        case .ready: "ready"
        case .asking: "asking"
        case .on: "on"
        case .capped: "capped"
        case .unavailable: "unavailable"
        }
    }

    private var words: String {
        switch tutor {
        case .ready: SATCopy.tutorReady(left: account == .unlimited ? nil : left, cap: cap)
        case .asking: SATCopy.tutorAsking
        case .on(let pass): SATCopy.tutorOn(left: pass.left, cap: pass.cap)
        case .capped(let pass): SATCopy.capped(cap: pass.cap, hasAccount: account.hasAccount)
        case .unavailable: SATCopy.tutorUnavailable
        }
    }

    @ViewBuilder private var dot: some View {
        switch tutor {
        case .on, .asking:
            Circle().fill(DS.Color.tutorInk).frame(width: 12, height: 12)
        case .ready:
            Circle().strokeBorder(DS.Color.tutorInk, lineWidth: 2.5).frame(width: 12, height: 12)
        case .capped, .unavailable:
            Circle().fill(DS.Color.tutorInkEmpty).frame(width: 12, height: 12)
        }
    }
}
#endif
