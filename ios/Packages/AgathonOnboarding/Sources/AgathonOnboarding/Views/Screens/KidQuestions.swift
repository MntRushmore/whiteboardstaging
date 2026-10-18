import AgathonDesign
import SwiftUI

// The kid's questions: who's holding the iPad, the name, the grade, what's tricky.

// MARK: - 1 · hello

enum WhoKind { case ink, sunny }

struct HelloScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var chosen: OnboardingRole?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let c = model.copy.hello
        let w = layout.centreSpeakerWidth
        let top = layout.centreSpeakerOrigin(width: w, step: .hello).y + w / TheShapes.aspectRatio + (layout.landscape ? 28 : 40)
        // at the accessibility sizes the cards stack and the screen scrolls: words wrap, never cut
        let big = typeSize.isAccessibilitySize
        let stack = big || layout.compact || layout.size.width < 700
        let cardW: CGFloat = stack ? min(big ? 560 : 420, layout.columnWidth) : min(340, (layout.columnWidth - 20) / 2)
        let cardH: CGFloat? = big ? nil : (stack ? 150 : max(196, min(240, layout.size.height - top - layout.bottomInset - 110)))

        ScrollView {
        VStack(spacing: layout.landscape ? 22 : 30) {
            Text(c.lede)
                .dsFont(.body)
                .foregroundStyle(DS.Color.inkSecondary)
                .multilineTextAlignment(.center)
                .reveal(0)

            let cards = Group {
                whoCard(.parent, kind: .ink, small: c.grownUpSmall, big: c.grownUpBig, hint: c.grownUpHint, width: cardW, height: cardH)
                    .reveal(1)
                whoCard(.kid, kind: .sunny, small: c.kidSmall, big: c.kidBig, hint: c.kidHint, width: cardW, height: cardH)
                    .reveal(2)
            }
            if stack {
                VStack(spacing: 16) { cards }
            } else {
                HStack(spacing: 20) { cards }
            }

            Button { model.openSignIn(from: .hello) } label: {
                Text(c.signIn).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            }
            .buttonStyle(QuietWrapping())
            .reveal(3)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, top)
        .padding(.bottom, 24)
        }
        .scrollDisabled(!big)
        .scrollIndicators(.hidden)
    }

    private func whoCard(_ role: OnboardingRole, kind: WhoKind, small: String, big: String, hint: String,
                         width: CGFloat, height: CGFloat?) -> some View {
        let fill: DS.Fill = kind == .ink ? .ink : .sunny
        let on = chosen == role
        return Button {
            guard chosen == nil else { return }
            chosen = role
            model.chooseRole(role)
        } label: {
            ZStack(alignment: .topLeading) {
                CardDeco(color: (kind == .ink ? DS.Palette.ink.mixed(with: DS.Palette.white, amount: 0.07)
                                 : DS.Palette.sunny.mixed(with: DS.Palette.tomato, amount: 0.14)).color, size: (height ?? 200) * 0.95)
                    .offset(x: width - (height ?? 200) * 0.62, y: (height ?? 200) * 0.42)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    Text(small).dsFont(.heading, size: 21)
                    Text(big).dsFont(.display, size: 58).padding(.top, -4)
                        .lineLimit(1).minimumScaleFactor(0.55)
                    Spacer(minLength: 8)
                    Text(hint).dsFont(.body, size: 18).opacity(0.86)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(26)
            }
            .frame(width: width, height: height, alignment: .topLeading)
            .frame(minHeight: height == nil ? 150 : nil)
            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.card, style: .continuous))
            .overlay(alignment: .topTrailing) { TickBadge(diameter: 44, drawn: on).padding(18) }
        }
        .buttonStyle(ChoiceCardStyle(chosen: false, base: fill))
        .accessibilityIdentifier("onboarding.who.\(role.rawValue)")
        .accessibilityLabel("\(small) \(big).")
        .accessibilityHint(hint)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

extension FlowModel {
    func chooseRole(_ role: OnboardingRole) {
        state.answers = state.answers.choosing(role: role)
        state.keep()
        record("start_who", ["role": .string(role.rawValue)])
        OnboardingSound.shared.play(.tap)
        Task {
            try? await Task.sleep(for: FlowRules.autoAdvance)
            advance()
        }
    }

    func openSignIn(from step: OnboardingStep) {
        state.signInFrom = step
        go(.signIn)
    }
}

// MARK: - 2 · name

struct NameScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var text = ""
    @State private var invalid = false
    @State private var reply: String?
    @State private var writing = false
    @FocusState private var focused: Bool

    var body: some View {
        let c = model.copy
        VStack(alignment: .leading, spacing: 18) {
            if !layout.tight {
                Text(c.nameLede)
                    .dsFont(.body)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .opacity(reply == nil ? 1 : 0)
                    .reveal(0)
            }

            HStack(spacing: 16) {
                NameField(placeholder: c.namePlaceholder, text: $text, focused: $focused) { submit() }
                    .frame(maxWidth: 520)
                    .disabled(reply != nil)
                PillButton(c.continueTitle, icon: .forward, kind: .sunny, size: .large) { submit() }
                    .accessibilityIdentifier("onboarding.name.continue")
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || reply != nil)
                    .opacity(reply == nil ? 1 : 0)
            }
            .offset(y: reply == nil ? 0 : -24)
            .dsAnimation(DS.Motion.snap, value: reply)
            .reveal(1)

            if invalid {
                Text(c.nameInvalid)
                    .dsFont(.callout)
                    .foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Capsule().fill(DS.Color.tryAgain))
                    .transition(.opacity)
            }

            ZStack(alignment: .topLeading) {
                if let reply {
                    LoadedHand(source: .words(reply), size: 46, duration: 0.7, play: writing)
                        .accessibilityHidden(false)
                        .accessibilityLabel(reply)
                }
            }
            .frame(height: 96, alignment: .topLeading)
            .offset(x: 8, y: -16)
        }
        .padding(.horizontal, layout.margin)
        .padding(.top, layout.contentTop)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: layout.size.height, alignment: .top)
        .onAppear {
            text = model.answers.name ?? ""
        }
        // no auto-focus: the on-screen keyboard would cover half the screen in landscape, and a
        // Pencil writes straight into the field (Scribble) without it
        .onChange(of: text) { _, _ in if invalid { withAnimation(DS.Motion.fade) { invalid = false } } }
    }

    private func submit() {
        guard reply == nil else { return }
        guard let name = OnboardingAnswers.cleanName(text) else {
            withAnimation(DS.Motion.fade) { invalid = true }
            OnboardingSound.shared.play(.woodblock)
            return
        }
        if name.isEmpty { model.skipName(); return }
        focused = false
        model.chooseName(name)
        reply = OnboardingCopy.reply(name)
        // the field lifts, the tutor writes "Hi, Sam." in its own hand, it holds, then the next screen
        Task {
            try? await Task.sleep(for: .milliseconds(160))
            writing = true
            OnboardingSound.shared.play(.tap)
            if UIAccessibility.isVoiceOverRunning { UIAccessibility.post(notification: .announcement, argument: reply) }
            try? await Task.sleep(for: .milliseconds(700 + 650))
            model.advance()
        }
    }
}

extension FlowModel {
    func chooseName(_ name: String) {
        state.answers = state.answers.choosing(name: name)
        state.keep()
        record("start_name")
    }

    func skipName() {
        state.answers = state.answers.choosing(name: nil)
        state.keep()
        record("start_name")
        advance()
    }
}

/// The name field: 72 pt tall, the name at 40 pt. Scribble turns Pencil writing into text. No
/// autocorrect, words capitalised, no content type (so AutoFill never offers the grown-up's name).
struct NameField: View {
    let placeholder: String
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    let submit: () -> Void

    var body: some View {
        TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(DS.Color.inkSecondary))
            .font(DS.Font.fixed(.headline, size: 40))
            .foregroundStyle(DS.Color.ink)
            .tint(DS.Color.focus)
            .textInputAutocapitalization(.words)
            .autocorrectionDisabled()
            .submitLabel(.continue)
            .onSubmit(submit)
            .focused(focused)
            .padding(.horizontal, 28)
            .frame(height: 76)
            .background(Capsule().fill(DS.Color.surface))
            .overlay { if focused.wrappedValue { Capsule().strokeBorder(DS.Color.focus, lineWidth: DS.Stroke.focus) } }
            .onChange(of: text) { _, now in if now.count > 24 { text = String(now.prefix(24)) } }
            .accessibilityLabel(placeholder)
            .accessibilityIdentifier("onboarding.name.field")
    }
}

// MARK: - 3 · grade

struct GradeScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var chosen: LevelChoice?
    @State private var courses = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let c = model.copy
        VStack(spacing: 0) {
            Color.clear.frame(height: layout.contentTop)
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text(courses ? c.courseLede : c.gradeLede)
                        .dsFont(.body)
                        .foregroundStyle(DS.Color.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .reveal(0)
                    if courses { courseList } else if typeSize.isAccessibilitySize { gradeList } else { gradeGrid }
                }
                .padding(.horizontal, layout.margin)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDisabled(!typeSize.isAccessibilitySize)
            .scrollIndicators(.hidden)
        }
    }

    /// The accessibility sizes: two columns of whole names ("3rd grade"), then high school.
    private var gradeList: some View {
        let cat = OnboardingCatalog.shared
        return VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(Array(cat.grades.enumerated()), id: \.element.id) { i, g in
                    let on = chosen == .grade(g.id)
                    Button { choose(.grade(g.id)) } label: {
                        HStack {
                            Text(g.label).dsFont(.button).multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 4)
                            TickBadge(diameter: 30, drawn: on)
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
                    }
                    .buttonStyle(ChoiceCardStyle(chosen: on, base: .paper, radius: DS.Radius.tile))
                    .accessibilityIdentifier("onboarding.grade.\(g.id)")
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .reveal(1 + i)
                }
            }
            highSchoolPill(width: layout.columnWidth).reveal(10)
        }
    }

    private var gradeGrid: some View {
        let cat = OnboardingCatalog.shared
        let big = layout.landscape && !layout.compact
        let cols = big ? 5 : 3
        let side: CGFloat = min(layout.landscape ? 128 : 150, (layout.columnWidth - CGFloat(cols - 1) * 16) / CGFloat(cols))
        let columns = Array(repeating: GridItem(.fixed(side), spacing: 16), count: cols)
        return VStack(alignment: .leading, spacing: 16) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
                ForEach(Array(cat.grades.enumerated()), id: \.element.id) { i, g in
                    gradeBlock(g, side: side).reveal(1 + i)
                }
                if big { highSchoolBlock(side: side).reveal(10) }
            }
            if !big {
                highSchoolPill(width: side * 3 + 32).reveal(10)
            }
        }
    }

    private func gradeBlock(_ g: OnboardingCatalog.Grade, side: CGFloat) -> some View {
        let on = chosen == .grade(g.id)
        return Button { choose(.grade(g.id)) } label: {
            VStack(spacing: 0) {
                Text(g.short).dsFont(.bigNumber, size: 46)
                Text(g.id == 0 ? "Kindergarten" : "grade")
                    .dsFont(.caption, size: 15)
                    .opacity(0.8)
            }
            .frame(width: side, height: side)
            .overlay(alignment: .topTrailing) { TickBadge(diameter: 34, drawn: on).padding(10) }
        }
        .buttonStyle(ChoiceCardStyle(chosen: on, base: .paper, radius: DS.Radius.tile))
        .accessibilityIdentifier("onboarding.grade.\(g.id)")
        .accessibilityLabel(g.label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func highSchoolBlock(side: CGFloat) -> some View {
        Button { openCourses() } label: {
            VStack(spacing: 4) {
                Text(model.copy.highSchool).dsFont(.headline, size: 22).multilineTextAlignment(.center)
                Text("Algebra and up").dsFont(.caption, size: 14).opacity(0.8)
            }
            .padding(10)
            .frame(width: side, height: side)
        }
        .buttonStyle(ChoiceCardStyle(chosen: false, base: .paper, radius: DS.Radius.tile))
        .accessibilityHint(model.copy.highSchoolHint)
    }

    private func highSchoolPill(width: CGFloat) -> some View {
        Button { openCourses() } label: {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.copy.highSchool).dsFont(.button, size: 20)
                    Text(model.copy.highSchoolHint).dsFont(.caption, size: 15).opacity(0.8)
                }
                Spacer()
                DSIcon(.forward, size: 20)
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 10)
            .frame(width: width)
            .frame(minHeight: 72)
        }
        .buttonStyle(ChoiceCardStyle(chosen: false, base: .paper, radius: 36))
        .accessibilityHint(model.copy.highSchoolHint)
    }

    private var courseList: some View {
        let cat = OnboardingCatalog.shared
        let all = cat.courses + [cat.somethingElse]
        return VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(all.enumerated()), id: \.element.id) { i, course in
                let on = chosen == .course(course.id)
                Button { choose(.course(course.id)) } label: {
                    HStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(course.label).dsFont(.button, size: 21)
                            Text(course.blurb).dsFont(.caption, size: 15).opacity(0.8)
                        }
                        Spacer()
                        TickBadge(diameter: 34, drawn: on)
                    }
                    .padding(.horizontal, 24)
                    .frame(maxWidth: 560, minHeight: 68, alignment: .leading)
                }
                .buttonStyle(ChoiceCardStyle(chosen: on, base: .paper, radius: 34))
                .accessibilityAddTraits(on ? .isSelected : [])
                .reveal(1 + i)
            }
            Button(model.copy.backToGrades) {
                courses = false
                model.retype(model.copy.gradeTitle)
            }
            .buttonStyle(.pill(.quiet))
            .reveal(7)
        }
    }

    private func openCourses() {
        OnboardingSound.shared.play(.tap)
        courses = true
        model.retype(model.copy.courseTitle)
    }

    private func choose(_ level: LevelChoice) {
        guard chosen == nil else { return }
        chosen = level
        model.chooseLevel(level)
    }
}

extension FlowModel {
    func chooseLevel(_ level: LevelChoice) {
        state.answers = state.answers.choosing(level: level)
        state.keep()
        switch level {
        case .grade(let g): record("start_grade", ["grade": .number(Double(g))])
        case .course(let c): record("start_grade", ["course": .string(c)])
        }
        OnboardingSound.shared.play(.tap)
        // the skills' examples, written ahead of the tricky screen
        let examples = Plan.focusOptions(level).map { OnboardingCatalog.shared.words($0).example }.filter { !$0.isEmpty }
        Task.detached { for e in examples { _ = await HandInkMaker.shared.latex(e, size: TrickyScreen.exampleSize) } }
        Task {
            try? await Task.sleep(for: FlowRules.autoAdvance)
            advance()
        }
    }
}

// MARK: - 4 · tricky

struct TrickyScreen: View {
    let model: FlowModel
    let layout: StageLayout
    static let exampleSize = 30.0

    var body: some View {
        let c = model.copy
        let options = Plan.focusOptions(model.answers.choice)
        let picked = model.answers.focus
        let full = picked.count >= OnboardingCatalog.shared.maxFocus
        let cols = layout.landscape && !layout.compact ? 3 : 2
        let gap: CGFloat = 16
        let cardW = (layout.columnWidth - gap * CGFloat(cols - 1)) / CGFloat(cols)

        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Text(c.trickyLede).dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
                if !picked.isEmpty {
                    Tag(full ? c.trickyFull : c.picked(picked.count), style: full ? .sunny : .paper)
                        .transition(.opacity)
                }
            }
            .animation(DS.Motion.fade, value: picked.count)
            .reveal(0)

            LazyVGrid(columns: Array(repeating: GridItem(.fixed(cardW), spacing: gap), count: cols), alignment: .leading, spacing: gap) {
                ForEach(Array(options.enumerated()), id: \.element) { i, skill in
                    skillCard(skill, order: picked.firstIndex(of: skill), width: cardW).reveal(1 + i)
                }
            }

            Button { model.notSureTricky() } label: {
                HStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.notSure).dsFont(.button, size: 20)
                        Text(c.notSureHint).dsFont(.caption, size: 15).opacity(0.8)
                    }
                    Spacer(minLength: 12)
                    DSIcon(.forward, size: 20)
                }
                .padding(.horizontal, 26)
                .frame(width: min(440, layout.columnWidth), height: 68)
            }
            .buttonStyle(ChoiceCardStyle(chosen: false, base: .paper, radius: 34))
            .reveal(1 + options.count)
        }
        .padding(.horizontal, layout.margin)
        .padding(.top, layout.contentTop)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: layout.size.height, alignment: .top)
        .overlay(alignment: .bottomTrailing) {
            PillButton(c.continueTitle, icon: .forward, kind: .sunny, size: .large) { model.finishTricky() }
                .accessibilityIdentifier("onboarding.tricky.continue")
                .disabled(picked.isEmpty)
                .padding(.trailing, layout.margin)
                .padding(.bottom, layout.bottomInset + 12)
                .reveal(2 + options.count)
        }
    }

    private func skillCard(_ skill: String, order: Int?, width: CGFloat) -> some View {
        let w = OnboardingCatalog.shared.words(skill)
        let on = order != nil
        return Button { model.toggleSkill(skill) } label: {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    Text(w.name).dsFont(.heading, size: 21).multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    if let order {
                        Text("\(order + 1)")
                            .font(DS.Font.fixed(.numeral, size: 18))
                            .foregroundStyle(DS.Color.ink)
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(DS.Color.sunny))
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DS.Color.surfaceSunken)
                    if !w.example.isEmpty {
                        LoadedHand(source: .latex(w.example), size: Self.exampleSize)
                            .scaleEffect(0.9, anchor: .leading)
                            .padding(.horizontal, 12)
                    }
                }
                .frame(height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .padding(18)
            .frame(width: width, alignment: .leading)
        }
        .buttonStyle(ChoiceCardStyle(chosen: on, base: .paper))
        .accessibilityIdentifier("onboarding.skill.\(skill)")
        .animation(DS.Motion.pop, value: order)
        .accessibilityLabel(w.name)
        .accessibilityHint(w.blurb)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

extension FlowModel {
    func toggleSkill(_ skill: String) {
        let before = state.answers.focus
        state.answers = state.answers.toggling(skill: skill)
        if before == state.answers.focus {
            // full: the woodblock, and the counter says "Tap one to swap it."
            OnboardingSound.shared.play(.woodblock)
        } else {
            OnboardingSound.shared.play(.tap)
        }
        state.keep()
    }

    func notSureTricky() {
        state.answers = state.answers.notSure()
        state.keep()
        record("start_focus", ["count": .number(0)])
        OnboardingSound.shared.play(.tap)
        advance()
    }

    func finishTricky() {
        record("start_focus", ["count": .number(Double(state.answers.focus.count))])
        advance()
    }
}
