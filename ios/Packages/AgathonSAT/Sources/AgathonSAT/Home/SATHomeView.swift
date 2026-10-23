#if os(iOS)
import AgathonDesign
import SwiftUI

/// What SAT home asks of the screen around it.
public struct SATHomeActions {
    public var practice: (SATNextRequest) -> Void = { _ in }
    public var close: (() -> Void)?
    /// "Make a free account" (a student with no account)
    public var signUp: (() -> Void)?
    public var retry: () -> Void = {}

    public init() {}
}

/// SAT home (docs/SAT-MODE.md, "SAT home"): today (questions answered, free tutor questions left),
/// Practice 10 (mixed and adaptive), Pick a skill, and progress by domain and skill, with the rough
/// estimate band once there is one, labelled honestly. Two columns held sideways, one upright.
public struct SATHomeView: View {
    let progress: SATProgress?
    let loading: Bool
    let failed: Bool
    let account: SATAccount
    let starting: SATNextRequest?
    let actions: SATHomeActions

    @State private var width: CGFloat = 0
    @State private var openDomain: SATDomain?

    public init(progress: SATProgress?, loading: Bool, failed: Bool, account: SATAccount, starting: SATNextRequest?, actions: SATHomeActions) {
        self.progress = progress
        self.loading = loading
        self.failed = failed
        self.account = account
        self.starting = starting
        self.actions = actions
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.xl) {
                topBar
                if width >= 900 {
                    HStack(alignment: .top, spacing: DS.Space.l) {
                        VStack(spacing: DS.Space.l) {
                            todayCard
                            skillsCard
                        }
                        .frame(width: (width - DS.Space.l) * 0.56)
                        progressCard
                    }
                } else {
                    todayCard
                    progressCard
                    skillsCard
                }
            }
            .padding(.horizontal, width < 700 ? DS.Space.l : DS.Space.xxl)
            .padding(.top, DS.Space.m)
            .padding(.bottom, DS.Space.xxxl)
            .frame(maxWidth: 1240)
            .frame(maxWidth: .infinity)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 - 2 * ($0 < 700 ? DS.Space.l : DS.Space.xxl) }
        }
        .background(DS.Color.ground.ignoresSafeArea())
        .accessibilityIdentifier("sat.home")
    }

    // MARK: top

    private var topBar: some View {
        HStack(spacing: DS.Space.s) {
            if let close = actions.close {
                RoundButton(.back, label: "Back to Home", action: close)
                    .accessibilityIdentifier("sat.home.back")
            }
            Text(SATCopy.title)
                .dsFont(.title)
                .foregroundStyle(DS.Color.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: DS.Space.s)
            if account == .none, let signUp = actions.signUp {
                PillButton("Make a free account", icon: .person, kind: .secondary, action: signUp)
                    .fixedSize()
                    .accessibilityIdentifier("sat.home.signUp")
            }
        }
        .frame(minHeight: DS.Size.minTarget)
    }

    // MARK: today

    private var todayCard: some View {
        let today = progress?.today
        return Card(.paper, radius: DS.Radius.cardLarge, padding: DS.Space.xl) {
            Text(SATCopy.today).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            // the mistake deck (v2): the reviews due today come first in a set
            if let due = progress?.reviewsDue, due > 0 {
                HStack(alignment: .center, spacing: DS.Space.m) {
                    SATDeckStack().frame(width: 64, height: 52)
                    Text(SATCopy.toReviewToday(due))
                        .dsFont(.display, size: 46)
                        .foregroundStyle(DS.Color.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("sat.home.reviews")
            }
            Text(SATCopy.answeredToday(today?.answered ?? 0))
                .dsFont(.headline, size: 30)
                .foregroundStyle(DS.Color.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("sat.home.answered")
            tutorRow(today)
                .padding(.top, DS.Space.xxs)
            HStack(alignment: .center, spacing: DS.Space.m) {
                PillButton(starting == SATNextRequest() ? "Getting questions…" : SATCopy.practice10, icon: .play, kind: .primary, size: .large) {
                    actions.practice(SATNextRequest())
                }
                .disabled(starting != nil)
                .fixedSize()
                .accessibilityIdentifier("sat.home.practice10")
                Text((progress?.reviewsDue ?? 0) > 0 ? SATCopy.reviewsThenNew(min(progress?.reviewsDue ?? 0, SATLimits.setSize), SATLimits.setSize)
                     : SATCopy.practice10Line)
                    .dsFont(.callout, size: 15)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, DS.Space.s)
            if failed {
                HStack(spacing: DS.Space.xs) {
                    Text(SATCopy.loadFailed).dsFont(.caption).foregroundStyle(DS.Color.ink)
                    Button(SATCopy.tryAgain, action: actions.retry).dsFont(.caption).fontWeight(.semibold)
                        .accessibilityIdentifier("sat.home.retry")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.home.today")
    }

    /// The day's free tutor questions as the mark's dots: used are filled (the tutor's cobalt), left are rings.
    @ViewBuilder private func tutorRow(_ today: SATProgress.Today?) -> some View {
        if account == .unlimited || today?.unlimited == true {
            Text(SATCopy.tutorUnlimited).dsFont(.callout, size: 16).foregroundStyle(DS.Color.ink)
        } else if let today {
            let cap = max(1, today.cap), used = min(today.tutorUsed, cap)
            VStack(alignment: .leading, spacing: 8) {
                if cap <= 20 {
                    HStack(spacing: cap > 10 ? 4 : 6) {
                        ForEach(0..<cap, id: \.self) { i in
                            if i < used {
                                Circle().fill(DS.Color.tutorInkEmpty).frame(width: cap > 10 ? 10 : 14, height: cap > 10 ? 10 : 14)
                            } else {
                                Circle().fill(DS.Color.tutorInk).frame(width: cap > 10 ? 10 : 14, height: cap > 10 ? 10 : 14)
                            }
                        }
                    }
                    .accessibilityHidden(true)
                }
                Text(SATCopy.tutorLeftToday(cap - used, cap))
                    .dsFont(.callout, size: 16)
                    .foregroundStyle(DS.Color.ink)
                    .accessibilityIdentifier("sat.home.tutorLeft")
            }
        } else if loading {
            Text(" ").dsFont(.callout, size: 16)
        }
    }

    // MARK: pick a skill

    private var skillsCard: some View {
        Card(.paper, radius: DS.Radius.cardLarge, padding: DS.Space.xl) {
            Text(SATCopy.pickSkill).dsFont(.headline, size: 22).foregroundStyle(DS.Color.ink)
                .accessibilityAddTraits(.isHeader)
            ForEach(SATDomain.allCases) { domain in
                VStack(alignment: .leading, spacing: DS.Space.xs) {
                    Text(domain.title).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                        .padding(.top, DS.Space.xs)
                    FlowStack(spacing: DS.Space.xs) {
                        ForEach(SATTaxonomy.skills(in: domain)) { skill in
                            Chip(skill.title, onPaper: true) {
                                actions.practice(SATNextRequest(domain: domain, skill: skill.name))
                            }
                            .disabled(starting != nil)
                            .accessibilityIdentifier("sat.home.skill.\(skill.slug)")
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.home.skills")
    }

    // MARK: progress

    private var progressCard: some View {
        Card(.paper, radius: DS.Radius.cardLarge, padding: DS.Space.xl) {
            HStack(alignment: .firstTextBaseline) {
                Text(SATCopy.progress).dsFont(.headline, size: 22).foregroundStyle(DS.Color.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if let p = progress, p.streakDays > 0 {
                    Text(SATCopy.streak(p.streakDays)).dsFont(.button, size: 15).foregroundStyle(DS.Color.inkSecondary)
                }
            }
            estimate
                .padding(.vertical, DS.Space.xs)
            if let p = progress, p.answered > 0 {
                ForEach(SATDomain.allCases) { domain in domainRow(domain, p) }
            } else if !loading {
                Text(SATCopy.noProgress).dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.home.progress")
    }

    /// The band, honestly labelled; hidden while there is none (fewer than 15 answers).
    @ViewBuilder private var estimate: some View {
        if let e = progress?.estimate {
            VStack(alignment: .leading, spacing: 6) {
                Text(SATCopy.estimateTitle).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                Text("\(e.low)–\(e.high)")
                    .dsFont(.bigNumber, size: 44)
                    .foregroundStyle(DS.Color.ink)
                    .monospacedDigit()
                band(e)
                Text(e.note?.isEmpty == false ? e.note! : SATCopy.estimateFallbackNote)
                    .dsFont(.caption)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("sat.home.estimate")
        } else if let p = progress, p.answered > 0 {
            Text(SATCopy.estimateLater(max(1, SATLimits.estimateMinAnswered - p.answered)))
                .dsFont(.callout, size: 15)
                .foregroundStyle(DS.Color.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("sat.home.estimateLater")
        }
    }

    /// 200–800 as a track, the band on it as the mark's bar.
    private func band(_ e: SATProgress.Estimate) -> some View {
        GeometryReader { geo in
            let w = geo.size.width
            let x0 = CGFloat(e.low - 200) / 600 * w, x1 = CGFloat(e.high - 200) / 600 * w
            ZStack(alignment: .leading) {
                Capsule().fill(DS.Color.surfaceSunken).frame(height: 10)
                Capsule().fill(DS.Color.ink).frame(width: max(10, x1 - x0), height: 10).offset(x: x0)
            }
            .frame(height: 10)
            .overlay(alignment: .bottom) {
                HStack {
                    Text("200")
                    Spacer()
                    Text("800")
                }
                .dsFont(.caption, size: 12)
                .foregroundStyle(DS.Color.inkSecondary)
                .offset(y: 20)
            }
        }
        .frame(height: 32)
        .accessibilityHidden(true)
    }

    private func domainRow(_ domain: SATDomain, _ p: SATProgress) -> some View {
        let c = p.count(domain)
        let skills = SATTaxonomy.skills(in: domain).filter { p.count(skill: $0.name).answered > 0 }
        let open = openDomain == domain
        return VStack(alignment: .leading, spacing: DS.Space.xs) {
            Button {
                withAnimation(DS.Motion.fade) { openDomain = open ? nil : domain }
            } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(domain.title).dsFont(.button, size: 16).foregroundStyle(DS.Color.ink)
                            .lineLimit(1).minimumScaleFactor(0.8)
                        Spacer(minLength: DS.Space.xs)
                        Text(c.answered > 0 ? SATCopy.correctOf(c.correct, c.answered) : "—")
                            .dsFont(.button, size: 15).foregroundStyle(DS.Color.inkSecondary).monospacedDigit()
                        if !skills.isEmpty {
                            DSIcon(open ? .back : .forward, size: 12).foregroundStyle(DS.Color.inkSecondary)
                                .rotationEffect(.degrees(open ? -90 : 0))
                        }
                    }
                    meter(c.share, answered: c.answered)
                }
                .frame(minHeight: DS.Size.minTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(SATPress())
            .disabled(skills.isEmpty)
            .accessibilityLabel("\(domain.title): \(c.correct) right of \(c.answered)")
            .accessibilityIdentifier("sat.home.domain.\(domain.rawValue)")
            if open {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(skills) { s in
                        let sc = p.count(skill: s.name)
                        HStack {
                            Text(s.title).dsFont(.callout, size: 15).foregroundStyle(DS.Color.ink).lineLimit(1)
                            Spacer()
                            Text(SATCopy.correctOf(sc.correct, sc.answered)).dsFont(.callout, size: 15).foregroundStyle(DS.Color.inkSecondary).monospacedDigit()
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.leading, DS.Space.m)
                .padding(.bottom, DS.Space.xs)
            }
        }
    }

    /// Right as a share of answered: the mark's bar on a chalk track.
    private func meter(_ share: Double, answered: Int) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(DS.Color.surfaceSunken)
                if answered > 0 { Capsule().fill(DS.Color.ink).frame(width: max(8, geo.size.width * CGFloat(share))) }
            }
        }
        .frame(height: 8)
    }
}
/// The mistake deck drawn as three flat stacked cards (no shadow: the design notes' `line`, `guide`, chalk).
struct SATDeckStack: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(DS.Color.line).offset(x: 0, y: 0).frame(width: 52, height: 40)
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(SATChromeColor.guide).offset(x: 6, y: 6).frame(width: 52, height: 40)
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(DS.Color.surfaceSunken)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(DS.Color.line, lineWidth: 1))
                .offset(x: 12, y: 12).frame(width: 52, height: 40)
        }
        .accessibilityHidden(true)
    }
}
#endif
