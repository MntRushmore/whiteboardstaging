import AgathonDesign
import SwiftUI

// MARK: - 7 · building (a beat, not a place)

struct BuildingScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var ticked = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let c = model.copy
        let firstSkill = Plan.shown(model.answers).skills.first?.name
        let lines = [c.buildingLevel, c.buildingStart(firstSkill), c.buildingBoard]
        let w = layout.centreSpeakerWidth
        let top = layout.centreSpeakerOrigin(width: w, step: .building).y + w / TheShapes.aspectRatio + 40

        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                HStack(spacing: 14) {
                    TickBadge(diameter: 40, drawn: ticked > i)
                    Text(line)
                        .dsFont(.heading, size: 22)
                        .foregroundStyle(DS.Color.ink)
                }
                .opacity(ticked > i || reduceMotion ? 1 : 0.0)
                .offset(y: ticked > i || reduceMotion ? 0 : 10)
                .animation(DS.Motion.snap, value: ticked)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, top)
        .accessibilityElement(children: .combine)
        .task(id: model.revealed) {
            guard model.revealed, ticked == 0 else { return }
            // the plan is computed here (it is the answers already): three real things, 0.6 s apart
            if reduceMotion {
                ticked = 3
                try? await Task.sleep(for: .milliseconds(1200))
            } else {
                for i in 1...3 {
                    try? await Task.sleep(for: .milliseconds(i == 1 ? 120 : 600))
                    ticked = i
                    OnboardingSound.shared.play(i == 3 ? .rise : .tap)
                }
                try? await Task.sleep(for: .milliseconds(820))
            }
            model.advance()
        }
    }
}

// MARK: - 8 · the plan

struct PlanScreen: View {
    let model: FlowModel
    let layout: StageLayout

    var body: some View {
        let c = model.copy
        let plan = Plan.shown(model.answers)
        let solved = model.answers.tried?.solved == true
        let tried = model.answers.tried != nil
        let wide = layout.landscape && !layout.compact
        let gap: CGFloat = 18
        let cols: CGFloat = wide ? 3 : 2
        let cardW = (layout.columnWidth - gap * (cols - 1)) / cols
        let cardH: CGFloat = wide ? min(300, layout.size.height - layout.contentTop - 150 - layout.bottomInset) : 280

        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
                Text(c.planLede).dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
                if tried {
                    Tag(c.tried(solved: solved), style: .paper).transition(.opacity)
                }
            }
            .reveal(0)

            let cards = Group {
                today(c, solved: solved).frame(width: cardW, height: cardH).reveal(1)
                path(c, plan: plan).frame(width: cardW, height: cardH).reveal(2)
                if wide { board(c, solved: solved).frame(width: cardW, height: cardH).reveal(3) }
            }
            HStack(alignment: .top, spacing: gap) { cards }
            if !wide {
                board(c, solved: solved).frame(width: layout.columnWidth, height: 220).reveal(3)
            }
        }
        .padding(.horizontal, layout.margin)
        .padding(.top, layout.contentTop)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: layout.size.height, alignment: .top)
        .overlay(alignment: .bottomTrailing) {
            PillButton(c.save, icon: .forward, kind: .sunny, size: .large) { model.advance() }
                .accessibilityIdentifier("onboarding.plan.save")
                .padding(.trailing, layout.margin)
                .padding(.bottom, layout.bottomInset + 12)
                .reveal(4)
        }
    }

    private func today(_ c: OnboardingCopy, solved: Bool) -> some View {
        Card(.cobalt, radius: DS.Radius.cardLarge, deco: true, fillsHeight: true) {
            Text(c.todayLabel).dsFont(.label).foregroundStyle(DS.Color.onInk)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(Plan.todayProblems)").dsFont(.display, size: 72)
                Text("problems").dsFont(.headline, size: 26)
            }
            .foregroundStyle(DS.Color.onInk)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Text("About 10 minutes").dsFont(.body, size: 18).foregroundStyle(DS.Color.onInk)
            Spacer(minLength: 8)
            StarRow(earned: solved ? 1 : 0, total: Plan.todayProblems, size: 34, onCobalt: true)
        }
        .accessibilityElement(children: .combine)
    }

    private func path(_ c: OnboardingCopy, plan: Plan.Shown) -> some View {
        let words = [c.startHere, c.pathNext, c.then]
        return Card(.sunny, radius: DS.Radius.cardLarge, fillsHeight: true) {
            if plan.open {
                Text(plan.level ?? "Your plan").dsFont(.headline)
                Text(c.openPlan).dsFont(.body, size: 17)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(plan.skills.enumerated()), id: \.element.id) { i, s in
                        HStack(alignment: .center, spacing: 14) {
                            ZStack {
                                if i < plan.skills.count - 1 {
                                    Rectangle().fill(DS.Color.ink).frame(width: 5, height: 58).offset(y: 30)
                                }
                                if i == 0 {
                                    SkillPathNode(.now, size: 34)
                                } else {
                                    Circle().fill(DS.Color.ink).frame(width: 18, height: 18)
                                        .frame(width: 42, height: 42)
                                }
                            }
                            .frame(width: 42, height: 42)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(s.name).dsFont(.heading, size: 19).lineLimit(2).minimumScaleFactor(0.85)
                                Text(words[min(i, 2)]).dsFont(.caption, size: 14)
                            }
                        }
                        .frame(height: 64, alignment: .center)
                    }
                }
            }
        }
        .foregroundStyle(DS.Color.ink)
        .accessibilityElement(children: .combine)
    }

    private func board(_ c: OnboardingCopy, solved: Bool) -> some View {
        let tryProblem = model.answers.tries.first.flatMap { OnboardingCatalog.shared.problem($0.problemId) }
            ?? Plan.tryProblems(model.answers).first
        return Card(.paper, radius: DS.Radius.cardLarge, padding: 22, fillsHeight: true) {
            HStack {
                Text(c.firstBoard).dsFont(.headline, size: 21)
                Spacer()
                if solved {
                    HStack(spacing: 6) {
                        RoundedStar().frame(width: 18, height: 18)
                        Text(c.oneStar).dsFont(.button, size: 15)
                    }
                    .padding(.horizontal, 12).frame(height: 34)
                    .background(Capsule().fill(DS.Color.ink))
                    .foregroundStyle(DS.Color.onInk)
                }
            }
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: DS.Radius.thumb, style: .continuous).fill(DS.Color.surfaceSunken)
                VStack(alignment: .leading, spacing: 10) {
                    if let p = tryProblem {
                        HStack(spacing: 12) {
                            LoadedHand(source: .latex([TryBoard.written(p)]), size: 34)
                            if let kid = model.answers.tries.first(where: { $0.problemId == p.id }), !kid.strokes.isEmpty {
                                KidInk(strokes: kid.answerStrokes ?? kid.strokes, height: 40)
                            }
                            if solved {
                                TickShape()
                                    .stroke(DS.Color.tutorInk, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                                    .frame(width: 30, height: 28)
                            }
                        }
                    }
                    Capsule().fill(DS.Color.line).frame(width: 150, height: 6)
                    Capsule().fill(DS.Color.line).frame(width: 110, height: 6)
                }
                .padding(18)
            }
        }
        .foregroundStyle(DS.Color.ink)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(c.firstBoard)
    }
}

/// The kid's own strokes, small (the plan's picture of the first board): black ink, as written.
struct KidInk: View {
    let strokes: [[[Double]]]
    let height: CGFloat

    var body: some View {
        let pts = strokes.flatMap { $0 }.filter { $0.count >= 2 }
        let minX = pts.map { $0[0] }.min() ?? 0, maxX = pts.map { $0[0] }.max() ?? 1
        let minY = pts.map { $0[1] }.min() ?? 0, maxY = pts.map { $0[1] }.max() ?? 1
        let scale = height / max(1, maxY - minY)
        Canvas { gc, _ in
            for s in strokes where s.count >= 2 {
                var path = Path()
                for (i, p) in s.enumerated() where p.count >= 2 {
                    let q = CGPoint(x: (p[0] - minX) * scale + 2, y: (p[1] - minY) * scale + 2)
                    if i == 0 { path.move(to: q) } else { path.addLine(to: q) }
                }
                gc.stroke(path, with: .color(DS.Color.ink), style: StrokeStyle(lineWidth: 2.6, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(width: (maxX - minX) * scale + 4, height: height + 4)
        .accessibilityHidden(true)
    }
}

// MARK: - 9 · hand back

struct HandBackScreen: View {
    let model: FlowModel
    let layout: StageLayout

    var body: some View {
        let c = model.copy
        let kidAlone = model.answers.role == .kid
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            IconCircle(.lock, fill: .sunny, diameter: 104).reveal(0)
            Text(c.handBackTitle)
                .dsFont(.display)
                .foregroundStyle(DS.Color.onInk)
                .multilineTextAlignment(.center)
                .padding(.top, 32)
                .reveal(1)
                .accessibilityAddTraits(.isHeader)
            Text(c.handBackLede)
                .dsFont(.body, size: 21)
                .foregroundStyle(DS.Color.onInkSecondary)
                .multilineTextAlignment(.center)
                .padding(.top, 14)
                .reveal(2)
            HStack(spacing: 16) {
                if kidAlone {
                    Button(c.noGrownUp) { model.go(.waiting) }
                        .buttonStyle(QuietOnInk())
                        .accessibilityIdentifier("onboarding.handBack.noGrownUp")
                }
                PillButton(c.imGrownUp, icon: .lock, kind: .sunny, size: .large) { model.go(.gate) }
                    .accessibilityIdentifier("onboarding.handBack.grownUp")
            }
            .padding(.top, 36)
            .reveal(3)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, layout.margin)
        .frame(width: layout.size.width, height: layout.size.height)
    }
}

/// A quiet pill on ink: white words, a faint fill only while pressed.
struct QuietOnInk: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .dsFont(.button, size: 21)
            .foregroundStyle(DS.Color.onInk)
            .padding(.horizontal, 26)
            .frame(minHeight: DS.Size.mainButton)
            .background(Capsule().fill(configuration.isPressed ? DS.Color.onInkFaint : .clear))
            .contentShape(Capsule())
    }
}

// MARK: - the waiting screen (a kid alone, no grown-up)

struct WaitingScreen: View {
    let model: FlowModel
    let layout: StageLayout

    var body: some View {
        let c = model.copy
        VStack(alignment: .leading, spacing: 24) {
            Text(c.waitingLede).dsFont(.body).foregroundStyle(DS.Color.inkSecondary).reveal(0)
            HStack(spacing: 16) {
                PillButton(c.imGrownUp, icon: .lock, kind: .primary, size: .large) { model.go(.gate) }
                    .accessibilityIdentifier("onboarding.waiting.grownUp")
                if model.state.triesLeft > 0 {
                    PillButton(c.tryAnother, icon: .pen, kind: .secondary, size: .large) { model.go(.tryIt) }
                }
            }
            .reveal(1)
        }
        .padding(.horizontal, layout.margin)
        .padding(.top, layout.contentTop)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
