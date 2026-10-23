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

/// SAT home (docs/SAT-V2.md; docs/sat2/DESIGN-NOTES.md frame 12). Left: today (the mistake deck's
/// "3 to review" with its cards, Practice 10 and what the set starts with, answered today and the free
/// tutor left as a cobalt bar) and progress (the rough estimate's band on 200–800 with its honest
/// note, then the four domains). Right: every skill by domain, right of answered as a bar, a skill
/// under half right flagged in tomato with PRACTICE, untried ones "—"; a tap starts a set of it.
/// One column upright.
public struct SATHomeView: View {
    let progress: SATProgress?
    let loading: Bool
    let failed: Bool
    let account: SATAccount
    let starting: SATNextRequest?
    let actions: SATHomeActions

    @State private var width: CGFloat = 0

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
            VStack(alignment: .leading, spacing: DS.Space.l) {
                topBar
                if width >= 1100 {
                    HStack(alignment: .top, spacing: DS.Space.l) {
                        VStack(spacing: DS.Space.l) {
                            todayCard
                            progressCard
                        }
                        .frame(width: (width - DS.Space.l) * 0.56)
                        skillsCard
                    }
                } else {
                    todayCard
                    skillsCard
                    progressCard
                }
            }
            .padding(.horizontal, width < 700 ? DS.Space.l : DS.Space.xl)
            .padding(.top, DS.Space.m)
            .padding(.bottom, DS.Space.xxxl)
            .frame(maxWidth: 1320)
            .frame(maxWidth: .infinity)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 - 2 * ($0 < 700 ? DS.Space.l : DS.Space.xl) }
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
            Text(SATCopy.homeTitle)
                .dsFont(.title, size: 40)
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
            if let p = progress, p.streakDays > 0 {
                HStack(spacing: 10) {
                    DSIcon(.flame, size: 18)
                    Text(SATCopy.streak(p.streakDays)).dsFont(.button, size: 17)
                }
                .foregroundStyle(DS.Color.ink)
                .padding(.horizontal, 22)
                .frame(height: 56)
                .background(Capsule().fill(DS.Color.paper))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("sat.home.streak")
            }
        }
        .frame(minHeight: DS.Size.minTarget)
    }

    // MARK: today

    private var due: Int { progress?.reviewsDue ?? 0 }

    private var todayCard: some View {
        let today = progress?.today
        return Card(.paper, radius: 36, padding: DS.Space.xl) {
            HStack(alignment: .top, spacing: DS.Space.l) {
                VStack(alignment: .leading, spacing: DS.Space.s) {
                    Text(SATCopy.today.uppercased()).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                    Text(due > 0 ? SATCopy.toReview(due) : SATCopy.noReviewsTitle)
                        .dsFont(.display, size: 64)
                        .foregroundStyle(DS.Color.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .accessibilityIdentifier(due > 0 ? "sat.home.reviews" : "sat.home.hero")
                    Text(due > 0 ? SATCopy.toReviewLine : SATCopy.noReviewsLine)
                        .dsFont(.body, size: 19).foregroundStyle(DS.Color.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if due > 0 && width >= 700 {
                    Spacer(minLength: 0)
                    SATDeckCards(count: due).frame(width: 300, height: 200)
                }
            }
            HStack(alignment: .center, spacing: DS.Space.m) {
                PillButton(starting == SATNextRequest() ? "Getting questions…" : SATCopy.practice10, icon: .play, kind: .sunny, size: .large) {
                    actions.practice(SATNextRequest())
                }
                .disabled(starting != nil)
                .fixedSize()
                .accessibilityIdentifier("sat.home.practice10")
                Text(due > 0 ? SATCopy.reviewsThenNew(min(due, SATLimits.setSize), SATLimits.setSize) : SATCopy.practice10Line)
                    .dsFont(.callout, size: 17)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, DS.Space.m)
            Rectangle().fill(DS.Color.line).frame(height: 1.5).padding(.vertical, DS.Space.m)
            HStack(alignment: .top, spacing: DS.Space.xl) {
                stat(SATCopy.answeredTodayShort, "\(today?.answered ?? 0)", id: "sat.home.answered")
                tutorStat(today)
            }
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

    private func stat(_ label: String, _ value: String, id: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).dsFont(.callout, size: 17).foregroundStyle(DS.Color.inkSecondary)
            Text(value).dsFont(.bigNumber, size: 40).foregroundStyle(DS.Color.ink).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
    }

    /// The free tutor left today as a cobalt bar (cobalt is the tutor's), its count beside it.
    @ViewBuilder private func tutorStat(_ today: SATProgress.Today?) -> some View {
        if account == .unlimited || today?.unlimited == true {
            VStack(alignment: .leading, spacing: 4) {
                Text(SATCopy.freeTutorLeft).dsFont(.callout, size: 17).foregroundStyle(DS.Color.inkSecondary)
                Text(SATCopy.tutorUnlimited).dsFont(.button, size: 19).foregroundStyle(DS.Color.ink)
            }
            .accessibilityIdentifier("sat.home.tutorLeft")
        } else if let today {
            let cap = max(1, today.cap), left = max(0, cap - min(today.tutorUsed, cap))
            VStack(alignment: .leading, spacing: 14) {
                Text(SATCopy.freeTutorLeft).dsFont(.callout, size: 17).foregroundStyle(DS.Color.inkSecondary)
                HStack(spacing: DS.Space.m) {
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(DS.Color.surfaceSunken)
                            if left > 0 { Capsule().fill(DS.Color.tutorInk).frame(width: max(12, g.size.width * CGFloat(left) / CGFloat(cap))) }
                        }
                    }
                    .frame(height: 14)
                    Text(SATCopy.ofCap(left, cap)).dsFont(.button, size: 20).foregroundStyle(DS.Color.ink).monospacedDigit().fixedSize()
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(SATCopy.tutorLeftToday(left, cap))
            .accessibilityIdentifier("sat.home.tutorLeft")
        }
    }

    // MARK: progress

    private var progressCard: some View {
        Card(.paper, radius: 36, padding: DS.Space.xl) {
            Text(SATCopy.progressLabel).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            estimate
            if let p = progress, p.answered > 0 {
                Rectangle().fill(DS.Color.line).frame(height: 1.5).padding(.vertical, DS.Space.xs)
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
            VStack(alignment: .leading, spacing: DS.Space.s) {
                HStack(alignment: .firstTextBaseline, spacing: DS.Space.s) {
                    Text("\(e.low)–\(e.high)")
                        .dsFont(.bigNumber, size: 56)
                        .foregroundStyle(DS.Color.ink)
                        .monospacedDigit()
                    Text(SATCopy.roughEstimate).dsFont(.callout, size: 18).foregroundStyle(DS.Color.inkSecondary)
                }
                band(e)
                Text(e.note?.isEmpty == false ? e.note! : SATCopy.estimateFallbackNote)
                    .dsFont(.callout, size: 16)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("sat.home.estimate")
        } else if let p = progress, p.answered > 0 {
            Text(SATCopy.estimateLater(max(1, SATLimits.estimateMinAnswered - p.answered)))
                .dsFont(.callout, size: 16)
                .foregroundStyle(DS.Color.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("sat.home.estimateLater")
        }
    }

    /// 200–800 as a track with its hundreds, the band on it in ink.
    private func band(_ e: SATProgress.Estimate) -> some View {
        VStack(spacing: 10) {
            GeometryReader { geo in
                let w = geo.size.width
                let x0 = CGFloat(e.low - 200) / 600 * w, x1 = CGFloat(e.high - 200) / 600 * w
                ZStack(alignment: .leading) {
                    Capsule().fill(DS.Color.surfaceSunken).frame(height: 14)
                    Capsule().fill(DS.Color.ink).frame(width: max(14, x1 - x0), height: 14).offset(x: x0)
                }
            }
            .frame(height: 14)
            HStack {
                Text("200")
                Spacer()
                Text("400")
                Spacer()
                Text("600")
                Spacer()
                Text("800")
            }
            .dsFont(.callout, size: 16)
            .foregroundStyle(DS.Color.inkSecondary)
            .monospacedDigit()
        }
        .padding(.vertical, DS.Space.xs)
        .accessibilityHidden(true)
    }

    private func domainRow(_ domain: SATDomain, _ p: SATProgress) -> some View {
        let c = p.count(domain)
        return HStack(spacing: DS.Space.m) {
            Text(domain.shortTitle).dsFont(.callout, size: 18).foregroundStyle(DS.Color.ink).lineLimit(1)
                .frame(width: 220, alignment: .leading)
            meter(c.share, answered: c.answered, weak: false)
            Text(c.answered > 0 ? "\(c.correct)/\(c.answered)" : "—").dsFont(.callout, size: 16).foregroundStyle(DS.Color.inkSecondary)
                .monospacedDigit().frame(width: 56, alignment: .trailing)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sat.home.domain.\(domain.rawValue)")
    }

    // MARK: skills

    /// A skill is flagged when it is under half right with a few answered.
    static func isWeak(_ c: SATProgress.Count) -> Bool { c.answered >= 2 && c.share < 0.5 }

    private var skillsCard: some View {
        Card(.paper, radius: 36, padding: DS.Space.xl) {
            HStack(alignment: .firstTextBaseline) {
                Text(SATCopy.skills).dsFont(.title, size: 32).foregroundStyle(DS.Color.ink).accessibilityAddTraits(.isHeader)
                Spacer()
                Text(SATCopy.tapToPractice).dsFont(.callout, size: 16).foregroundStyle(DS.Color.inkSecondary)
            }
            ForEach(SATDomain.allCases) { domain in
                VStack(alignment: .leading, spacing: 2) {
                    Text(domain.title.uppercased()).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                        .padding(.top, DS.Space.m)
                        .padding(.bottom, DS.Space.xxs)
                    ForEach(SATTaxonomy.skills(in: domain)) { skill in skillRow(skill, domain) }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.home.skills")
    }

    private func skillRow(_ skill: SATTaxonomy.Skill, _ domain: SATDomain) -> some View {
        let c = progress?.count(skill: skill.name) ?? SATProgress.Count(answered: 0, correct: 0)
        let weak = Self.isWeak(c)
        return Button {
            actions.practice(SATNextRequest(domain: domain, skill: skill.name))
        } label: {
            HStack(spacing: DS.Space.s) {
                Text(skill.title).dsFont(weak ? .button : .callout, size: 18).foregroundStyle(DS.Color.ink).lineLimit(1)
                    .minimumScaleFactor(0.85)
                if weak {
                    Text(SATCopy.practiceTag).dsFont(.label, size: 13).foregroundStyle(DS.Color.tomato).fixedSize()
                }
                Spacer(minLength: DS.Space.s)
                meter(c.share, answered: c.answered, weak: weak).frame(width: 104)
                Text(c.answered > 0 ? "\(c.correct)/\(c.answered)" : "—").dsFont(.callout, size: 16).foregroundStyle(DS.Color.inkSecondary)
                    .monospacedDigit().frame(width: 48, alignment: .trailing)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(SATPress())
        .disabled(starting != nil)
        .accessibilityLabel("\(skill.title): \(c.answered > 0 ? "\(c.correct) right of \(c.answered)" : "not tried yet")\(weak ? ". Worth practicing." : "")")
        .accessibilityIdentifier("sat.home.skill.\(skill.slug)")
    }

    /// Right as a share of answered: the ink bar on a chalk track (tomato for a weak skill).
    private func meter(_ share: Double, answered: Int, weak: Bool) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(DS.Color.surfaceSunken)
                if answered > 0 { Capsule().fill(weak ? DS.Color.tomato : DS.Color.ink).frame(width: max(10, geo.size.width * CGFloat(share))) }
            }
        }
        .frame(height: 10)
    }
}

/// The mistake deck as three flat stacked cards (`line`, `guide`, chalk; no shadow), the front one
/// "DUE TODAY" and how many.
struct SATDeckCards: View {
    let count: Int

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 26, style: .continuous).fill(DS.Color.line).frame(width: 260, height: 140)
            RoundedRectangle(cornerRadius: 26, style: .continuous).fill(SATChromeColor.guide).frame(width: 260, height: 140).offset(x: 18, y: 26)
            VStack(alignment: .leading, spacing: 10) {
                Text(SATCopy.dueToday).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                Text(SATCopy.dueCount(count)).dsFont(.button, size: 19).foregroundStyle(DS.Color.ink)
            }
            .padding(24)
            .frame(width: 260, height: 140, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 26, style: .continuous).fill(DS.Color.surfaceSunken))
            .offset(x: 36, y: 56)
        }
        .accessibilityHidden(true)
    }
}
#endif
