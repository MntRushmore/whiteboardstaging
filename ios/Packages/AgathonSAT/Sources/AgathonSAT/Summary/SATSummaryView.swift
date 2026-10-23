#if os(iOS)
import AgathonDesign
import SwiftUI

/// The end of a set (docs/SAT-V2.md; docs/sat2/DESIGN-NOTES.md frame 11): "SET DONE · MIXED
/// PRACTICE", the score as a test counts it ("7 of 10", right on the first try), the time and how
/// often Help me was used, ten marks (an ink dot: right; an ink ring: into the deck; a faint ring: not
/// answered), the questions one a row ("Into the deck" for a miss), and the mistake deck: "3 come back
/// tomorrow.", its rule, the front card (a missed stem, "Back in 1 day"), Practice 10 more and See the
/// missed. Calm: no confetti, no faces; misses are ink rings, never red.
public struct SATSummaryView: View {
    let summary: SATPractice.Summary
    let busy: Bool
    let review: () -> Void
    let more: () -> Void
    let home: () -> Void
    let open: (Int) -> Void

    @State private var width: CGFloat = 1000

    public init(summary: SATPractice.Summary, busy: Bool = false, review: @escaping () -> Void, more: @escaping () -> Void,
                home: @escaping () -> Void, open: @escaping (Int) -> Void) {
        self.summary = summary
        self.busy = busy
        self.review = review
        self.more = more
        self.home = home
        self.open = open
    }

    private var wide: Bool { width >= 900 }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.l) {
                RoundButton(.close, fill: .paper, diameter: 48, label: SATCopy.backToSAT, action: home)
                    .accessibilityIdentifier("sat.summary.home")
                if wide {
                    HStack(alignment: .top, spacing: 60) {
                        VStack(alignment: .leading, spacing: DS.Space.l) {
                            scoreBlock
                            list
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        deckCard.frame(width: min(520, width * 0.4))
                            .padding(.top, 70)
                    }
                } else {
                    scoreBlock
                    deckCard
                    list
                }
            }
            .padding(.horizontal, wide ? 64 : DS.Space.l)
            .padding(.top, DS.Space.m)
            .padding(.bottom, DS.Space.xxxl)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        }
        .background(DS.Color.ground.ignoresSafeArea())
        .accessibilityIdentifier("sat.summary")
    }

    // MARK: the score

    private var scoreBlock: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            Text("\(SATCopy.setDone.uppercased()) · \((summary.oneSkill.map { SATTaxonomy.title(of: $0) } ?? SATCopy.mixedPractice).uppercased())")
                .dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            Text(SATCopy.scoreOf(summary.rightFirstTry, summary.count))
                .dsFont(.display, size: 80)
                .foregroundStyle(DS.Color.ink)
                .monospacedDigit()
                .accessibilityIdentifier("sat.summary.score")
            Text(SATCopy.setLine(minutes: summary.minutes, helped: summary.helped))
                .dsFont(.body, size: 19).foregroundStyle(DS.Color.inkSecondary)
                .accessibilityIdentifier("sat.summary.line")
            marks.padding(.top, DS.Space.s)
        }
    }

    /// One mark a question, its number under it.
    private var marks: some View {
        HStack(spacing: 14) {
            ForEach(summary.rows) { row in
                VStack(spacing: 8) {
                    mark(row)
                    Text("\(row.number)").dsFont(.caption, size: 14).foregroundStyle(DS.Color.inkSecondary).monospacedDigit()
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(summary.rows.map { "\($0.number) \(Self.spoken($0))" }.joined(separator: ", "))
        .accessibilityIdentifier("sat.summary.marks")
    }

    @ViewBuilder private func mark(_ row: SATPractice.Summary.Row) -> some View {
        switch row.verdict {
        case .right(true) where row.backInDays == nil:
            Circle().fill(DS.Color.ink).frame(width: 30, height: 30)
        case .open:
            Circle().strokeBorder(DS.Color.line, lineWidth: 3).frame(width: 30, height: 30)
        default:
            Circle().strokeBorder(DS.Color.ink, lineWidth: 3.5).frame(width: 30, height: 30)
        }
    }

    static func spoken(_ row: SATPractice.Summary.Row) -> String {
        if row.backInDays != nil { return SATCopy.intoTheDeck }
        switch row.verdict {
        case .right: return SATCopy.resultRight
        case .open: return SATCopy.resultSkipped
        case .missed, .lookAgain: return SATCopy.resultMissed
        }
    }

    // MARK: the questions

    private var list: some View {
        VStack(spacing: 0) {
            ForEach(Array(summary.rows.enumerated()), id: \.element.id) { i, row in
                if i > 0 { Rectangle().fill(DS.Color.line).frame(height: 1.5) }
                Button { open(row.index) } label: { rowView(row) }
                    .buttonStyle(SATPress())
                    .accessibilityIdentifier("sat.summary.row.\(row.number)")
            }
        }
        .padding(.horizontal, DS.Space.l)
        .padding(.vertical, DS.Space.xs)
        .background(RoundedRectangle(cornerRadius: 32, style: .continuous).fill(DS.Color.paper))
    }

    private func rowView(_ row: SATPractice.Summary.Row) -> some View {
        HStack(spacing: DS.Space.m) {
            Text("Q\(row.number)").dsFont(.button, size: 16).foregroundStyle(DS.Color.ink).frame(width: 44, alignment: .leading)
            Text(SATTaxonomy.title(of: row.skill)).dsFont(.callout, size: 17).foregroundStyle(DS.Color.ink).lineLimit(1)
            if row.review {
                Text(SATCopy.reviewChip).dsFont(.caption, size: 11).fontWeight(.semibold).foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .overlay(Capsule().strokeBorder(DS.Color.ink, lineWidth: 1.2))
            }
            if row.marked {
                Image(systemName: "bookmark.fill").font(.system(size: 13, weight: .semibold)).foregroundStyle(DS.Color.ink)
                    .accessibilityLabel(SATCopy.marked)
            }
            Spacer(minLength: DS.Space.s)
            Text(Self.spoken(row))
                .dsFont(row.backInDays != nil ? .button : .callout, size: 16)
                .foregroundStyle(row.backInDays != nil ? DS.Color.ink : DS.Color.inkSecondary)
                .frame(width: 140, alignment: .leading)
                .accessibilityIdentifier(row.backInDays != nil ? "sat.summary.deck.\(row.number)" : "sat.summary.result.\(row.number)")
            Text(SATCopy.clock(row.seconds)).dsFont(.callout, size: 15).foregroundStyle(DS.Color.inkSecondary).monospacedDigit()
                .frame(width: 52, alignment: .trailing)
        }
        .frame(minHeight: 66)
        .contentShape(Rectangle())
    }

    // MARK: the mistake deck

    private var deckCard: some View {
        let deck = summary.intoDeck
        return VStack(alignment: .leading, spacing: DS.Space.m) {
            Text(SATCopy.deckTitle).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            Text(deck.isEmpty ? SATCopy.deckEmpty : SATCopy.comeBackTomorrow(deck.count))
                .dsFont(.title, size: 34).foregroundStyle(DS.Color.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("sat.summary.deck")
            Text(SATCopy.deckRule).dsFont(.body, size: 17).foregroundStyle(DS.Color.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let front = deck.first {
                frontCard(front, behind: min(2, deck.count - 1))
                    .padding(.vertical, DS.Space.s)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: DS.Space.s) { buttons(deck.count) }
                VStack(alignment: .leading, spacing: DS.Space.s) { buttons(deck.count) }
            }
        }
        .padding(DS.Space.xl)
        .background(RoundedRectangle(cornerRadius: 32, style: .continuous).fill(DS.Color.paper))
        .accessibilityElement(children: .contain)
    }

    /// The deck's front card over the cards behind it (flat: `line`, `guide`, chalk; no shadow).
    private func frontCard(_ row: SATPractice.Summary.Row, behind: Int) -> some View {
        ZStack(alignment: .topLeading) {
            if behind >= 2 {
                RoundedRectangle(cornerRadius: 26, style: .continuous).fill(DS.Color.line).padding(.trailing, 50).padding(.bottom, 50)
            }
            if behind >= 1 {
                RoundedRectangle(cornerRadius: 26, style: .continuous).fill(SATChromeColor.guide)
                    .padding(.leading, 26).padding(.top, 26).padding(.trailing, 26).padding(.bottom, 26)
            }
            VStack(alignment: .leading, spacing: 14) {
                Text("Q\(row.number) · \(SATTaxonomy.title(of: row.skill).uppercased())").dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                    .lineLimit(1)
                SATText(row.stem, size: 19).lineLimit(3)
                HStack(spacing: 8) {
                    Image(systemName: "calendar.badge.clock").font(.system(size: 17, weight: .semibold))
                    Text(SATCopy.backInADay).dsFont(.button, size: 17)
                }
                .foregroundStyle(DS.Color.ink)
                .accessibilityIdentifier("sat.summary.backIn")
            }
            .padding(DS.Space.l)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 26, style: .continuous).fill(DS.Color.surfaceSunken))
            .padding(.leading, CGFloat(behind) * 26)
            .padding(.top, CGFloat(behind) * 26)
        }
    }

    @ViewBuilder private func buttons(_ missed: Int) -> some View {
        PillButton(busy ? "Getting questions…" : SATCopy.practiceMore, icon: .play, kind: .sunny, size: .large, action: more)
            .disabled(busy)
            .fixedSize()
            .accessibilityIdentifier("sat.summary.more")
        if !summary.toReview.isEmpty {
            PillButton(missed > 0 ? SATCopy.seeMissed(missed) : SATCopy.reviewMissed, kind: .secondaryOnPaper, size: .large, action: review)
                .fixedSize()
                .accessibilityIdentifier("sat.summary.review")
        }
    }
}
#endif
