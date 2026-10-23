#if os(iOS)
import AgathonDesign
import SwiftUI

/// The end of a set (docs/SAT-MODE.md, "End of set"): the score (right on the first try, as a test
/// counts it) out of the set, each question's result, review the missed ones, Practice 10 more.
/// Calm: a big number and a list; no confetti, no faces.
public struct SATSummaryView: View {
    let summary: SATPractice.Summary
    let busy: Bool
    let review: () -> Void
    let more: () -> Void
    let home: () -> Void
    let open: (Int) -> Void

    public init(summary: SATPractice.Summary, busy: Bool = false, review: @escaping () -> Void, more: @escaping () -> Void,
                home: @escaping () -> Void, open: @escaping (Int) -> Void) {
        self.summary = summary
        self.busy = busy
        self.review = review
        self.more = more
        self.home = home
        self.open = open
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.l) {
                Text(SATCopy.setDone).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                HStack(alignment: .firstTextBaseline, spacing: DS.Space.s) {
                    Text(SATCopy.score(summary.rightFirstTry, summary.count))
                        .dsFont(.display, size: 72)
                        .foregroundStyle(DS.Color.ink)
                        .monospacedDigit()
                        .accessibilityIdentifier("sat.summary.score")
                    Text(SATCopy.scoreLine).dsFont(.heading, size: 20).foregroundStyle(DS.Color.inkSecondary)
                }
                .accessibilityElement(children: .combine)
                if summary.rightSecondTry > 0 {
                    Text(SATCopy.secondTries(summary.rightSecondTry)).dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                }
                // the mistake deck (v2): what comes back tomorrow
                if deckCount > 0 { deckCard }
                // what to do next, before the list: it never sits below the fold
                actionsRow
                    .padding(.vertical, DS.Space.xs)
                bar
                VStack(spacing: 0) {
                    ForEach(Array(summary.rows.enumerated()), id: \.element.id) { i, row in
                        if i > 0 { Rectangle().fill(DS.Color.line).frame(height: 1).padding(.leading, 60) }
                        Button { open(row.index) } label: { rowView(row) }
                            .buttonStyle(SATPress())
                            .accessibilityIdentifier("sat.summary.row.\(row.number)")
                    }
                }
                .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.paper))
            }
            .padding(DS.Space.xl)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(DS.Color.ground.ignoresSafeArea())
        .accessibilityIdentifier("sat.summary")
    }

    private var deckCount: Int { summary.rows.filter { $0.backInDays != nil }.count }

    /// "3 come back tomorrow.", the 1-day / 3-day rule, and the front card "Back in 1 day".
    private var deckCard: some View {
        VStack(alignment: .leading, spacing: DS.Space.s) {
            Text(SATCopy.deckTitle).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            Text(SATCopy.comeBackTomorrow(deckCount)).dsFont(.title, size: 30).foregroundStyle(DS.Color.ink)
                .accessibilityIdentifier("sat.summary.deck")
            Text(SATCopy.deckRule).dsFont(.callout).foregroundStyle(DS.Color.inkSecondary).fixedSize(horizontal: false, vertical: true)
            if let first = summary.rows.first(where: { $0.backInDays != nil }) {
                HStack(spacing: DS.Space.xs) {
                    Image(systemName: "calendar.badge.clock").font(.system(size: 16, weight: .semibold))
                    Text("Q\(first.number) · \(SATTaxonomy.title(of: first.skill)) · \(SATCopy.backInADay)").dsFont(.button, size: 15)
                }
                .foregroundStyle(DS.Color.ink)
                .padding(.horizontal, DS.Space.m)
                .frame(minHeight: 52)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DS.Color.surfaceSunken))
                .accessibilityIdentifier("sat.summary.backIn")
            }
        }
        .padding(DS.Space.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.paper))
        .accessibilityElement(children: .contain)
    }

    /// The set as a row of bars: right first time solid, right on the second try half, the rest empty.
    private var bar: some View {
        HStack(spacing: 6) {
            ForEach(summary.rows) { row in
                Capsule()
                    .fill(color(row.verdict))
                    .frame(height: 10)
            }
        }
        .accessibilityHidden(true)
    }

    private func color(_ v: SATPractice.Verdict) -> Color {
        switch v {
        case .right(true): DS.Color.success
        case .right(false): DS.Palette.green.mixed(with: DS.Palette.white, amount: 0.55).color
        case .missed, .lookAgain: DS.Color.tryAgain
        case .open: DS.Color.line
        }
    }

    private func rowView(_ row: SATPractice.Summary.Row) -> some View {
        HStack(spacing: DS.Space.s) {
            Text("\(row.number)")
                .dsFont(.button, size: 15)
                .foregroundStyle(DS.Color.ink)
                .frame(width: 34, height: 34)
                .background(Circle().fill(DS.Color.surfaceSunken))
            VStack(alignment: .leading, spacing: 2) {
                Text(SATTaxonomy.title(of: row.skill)).dsFont(.button, size: 16).foregroundStyle(DS.Color.ink).lineLimit(1)
                Text(row.domain.shortTitle).dsFont(.caption, size: 13).foregroundStyle(DS.Color.inkSecondary)
            }
            Spacer(minLength: DS.Space.xs)
            if row.marked {
                Image(systemName: "bookmark.fill").font(.system(size: 13, weight: .semibold)).foregroundStyle(DS.Color.ink)
                    .accessibilityLabel(SATCopy.marked)
            }
            if row.review {
                Text(SATCopy.reviewChip).dsFont(.caption, size: 11).fontWeight(.semibold).foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .overlay(Capsule().strokeBorder(DS.Color.ink, lineWidth: 1.2))
            }
            if row.backInDays != nil {
                // the mistake deck takes it: it comes back tomorrow (v2)
                Text(SATCopy.intoTheDeck).dsFont(.caption, size: 13).fontWeight(.semibold).foregroundStyle(DS.Color.ink)
                    .accessibilityIdentifier("sat.summary.deck.\(row.number)")
            }
            result(row.verdict)
            DSIcon(.forward, size: 13).foregroundStyle(DS.Color.inkSecondary)
        }
        .padding(.horizontal, DS.Space.m)
        .frame(minHeight: 60)
        .contentShape(Rectangle())
    }

    private func result(_ v: SATPractice.Verdict) -> some View {
        let (words, fill, fg): (String, Color, Color) = switch v {
        case .right(true): (SATCopy.resultRight, DS.Color.success, DS.Color.onInk)
        case .right(false): (SATCopy.resultRightSecond, DS.Color.surfaceSunken, DS.Color.ink)
        case .missed, .lookAgain: (SATCopy.resultMissed, DS.Color.tryAgain, DS.Color.ink)
        case .open: (SATCopy.resultSkipped, DS.Color.surfaceSunken, DS.Color.inkSecondary)
        }
        return Text(words)
            .dsFont(.caption, size: 13)
            .fontWeight(.semibold)
            .foregroundStyle(fg)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(fill))
    }

    private var actionsRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: DS.Space.s) {
                mainButtons
                homeButton
            }
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                HStack(spacing: DS.Space.s) { mainButtons }
                homeButton
            }
            VStack(alignment: .leading, spacing: DS.Space.s) {
                mainButtons
                homeButton
            }
        }
    }

    private var homeButton: some View {
        PillButton(SATCopy.backToSAT, kind: .quiet, action: home)
            .fixedSize()
            .accessibilityIdentifier("sat.summary.home")
    }

    @ViewBuilder private var mainButtons: some View {
        PillButton(busy ? "Getting questions…" : SATCopy.practiceMore, kind: .primary, action: more)
            .disabled(busy)
            .fixedSize()
            .accessibilityIdentifier("sat.summary.more")
        if !summary.toReview.isEmpty {
            PillButton(SATCopy.reviewMissed, kind: .secondary, action: review)
                .fixedSize()
                .accessibilityIdentifier("sat.summary.review")
        }
    }
}
#endif
