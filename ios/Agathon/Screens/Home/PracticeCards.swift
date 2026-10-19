import AgathonDesign
import AgathonKit
import SwiftUI

/// Today's practice on Home (the Blocks Home's cobalt card): five problems a day, the stars earned,
/// the streak and this week. The words are the web's (src/lib/daily/copy.ts).
struct TodayCard: View {
    let row: DailyRow?
    let streak: DailyStreak
    let busy: Bool
    let start: () -> Void

    private var goal: Int { row?.goal ?? DailyRow.defaultGoal }
    private var done: Int { min(row?.done ?? 0, goal) }
    private var finished: Bool { row?.isDone ?? false }

    var body: some View {
        Card(.cobalt, radius: DS.Radius.cardLarge, padding: 0, deco: true, fillsHeight: true) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: DS.Space.l) {
                    words
                    Spacer(minLength: 0)
                    side.frame(width: 196, alignment: .leading)
                }
                VStack(alignment: .leading, spacing: DS.Space.l) {
                    words
                    side
                }
            }
            .padding(.horizontal, 30)
            .padding(.vertical, DS.Space.xl)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.today")
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Today's practice")
                .dsFont(.label)
                .foregroundStyle(DS.Color.onInk)
            Text(finished ? "You did it." : "\(goal) problems")
                .dsFont(.display, size: 56)
                .foregroundStyle(DS.Color.onInk)
                .padding(.top, DS.Space.s)
                .fixedSize(horizontal: false, vertical: true)
            Text(subtitle)
                .dsFont(.body, size: 18)
                .foregroundStyle(DS.Color.onInk)
                .padding(.top, 10)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: DS.Space.l)
            if !finished || row?.boardId != nil {
                PillButton(buttonTitle, icon: .play, kind: .sunny, size: .large, action: start)
                    .disabled(busy)
                    .fixedSize()
                    .accessibilityIdentifier("home.startPractice")
            }
        }
    }

    private var subtitle: String {
        if finished { return "Come back tomorrow for five more." }
        if done == 0 { return "About 10 minutes" }
        let left = goal - done
        return left == 1 ? "\(done) of \(goal) done · Just one more" : "\(done) of \(goal) done · About \(left * 2) minutes to go"
    }

    private var buttonTitle: String {
        if busy { return "Opening…" }
        if finished { return "See today's board" }
        return (row?.boardId != nil || done > 0) ? "Continue" : "Start"
    }

    private var side: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            StarRow(earned: min(row?.stars ?? 0, goal), total: goal, size: 32, onCobalt: true)
            if streak.current > 0 {
                StreakBadge(days: streak.current, onCobalt: true)
            } else {
                Text("Start a streak today.")
                    .dsFont(.callout)
                    .foregroundStyle(DS.Color.onInk)
            }
            WeekDots(streak.week.map { day in
                (letter: String(LocalDay.weekdayName(day.day).prefix(1)), state: Self.dot(day.state))
            }, on: .cobalt)
        }
    }

    static func dot(_ state: DailyStreak.DayState) -> WeekDots.Day {
        switch state {
        case .done: return .done
        case .today, .started: return .today
        default: return .later
        }
    }
}

/// The skill path on Home (the Blocks Home's sunny card): the path is the logo, done is a dot, now
/// is the ring. Tapping it opens Progress.
struct PathCard: View {
    let path: PathView?
    let isKid: Bool
    let open: () -> Void
    let pickGrade: (() -> Void)?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if let path {
            Button(action: open) {
                card { filled(path) }
            }
            .buttonStyle(CardPress())
            .accessibilityElement(children: .combine)
            .accessibilityHint("Opens your progress")
            .accessibilityIdentifier("home.path")
        } else {
            card { noGrade }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("home.path")
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        Card(.sunny, radius: DS.Radius.cardLarge, padding: 0, fillsHeight: true) {
            VStack(alignment: .leading, spacing: 0) { content() }
                .padding(.horizontal, 30)
                .padding(.vertical, DS.Space.xl)
                .frame(maxHeight: .infinity, alignment: .topLeading)
        }
    }

    @ViewBuilder private func filled(_ path: PathView) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: DS.Space.s) {
            Text(GradePath.title(path.grade))
                .dsFont(.headline, size: 28)
                .foregroundStyle(DS.Color.ink)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: DS.Space.xs)
            Text("\(path.doneCount) of \(path.stops.count) done")
                .dsFont(.button, size: 16)
                .foregroundStyle(DS.Color.ink)
                .fixedSize()
        }
        SkillTrail(path.stops.map { stop in
            switch stop.state {
            case .done: .done
            case .current: .now
            case .upcoming: .later
            }
        }, size: 36)
        .padding(.top, DS.Space.l)
        Spacer(minLength: DS.Space.l)
        if let next = path.next {
            // the largest text: the tag above the skill's name, and room for the words to wrap
            let big = typeSize.isAccessibilitySize
            let row = big ? AnyLayout(VStackLayout(alignment: .leading, spacing: DS.Space.xs)) : AnyLayout(HStackLayout(alignment: .center, spacing: DS.Space.s))
            row {
                Tag("Next up", style: .ink)
                Text(next.name)
                    .dsFont(.headline, size: 26)
                    .foregroundStyle(DS.Color.ink)
                    .lineLimit(big ? 4 : 2)
                    .minimumScaleFactor(0.8)
                    .fixedSize(horizontal: false, vertical: big)
            }
            Text(GradePath.names[next.id]?.blurb ?? GradePath.levelLabel(next.level))
                .dsFont(.callout, size: 16)
                .foregroundStyle(DS.Color.ink)
                .padding(.top, 6)
                .padding(.leading, 2)
                .lineLimit(big ? 5 : 2)
                .fixedSize(horizontal: false, vertical: big)
        } else {
            Text("You did it. Every skill on your path is done.")
                .dsFont(.body)
                .foregroundStyle(DS.Color.ink)
        }
    }

    @ViewBuilder private var noGrade: some View {
        Text(isKid ? "Ask your grown-up to pick your grade" : "Pick your grade")
            .dsFont(.headline, size: 28)
            .foregroundStyle(DS.Color.ink)
            .fixedSize(horizontal: false, vertical: true)
        Text(isKid ? "They can set it on their Family page. Then you'll get a path of skills."
                   : "Tell us your grade and we'll make you a path of skills.")
            .dsFont(.callout)
            .foregroundStyle(DS.Color.ink)
            .padding(.top, DS.Space.s)
            .fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: DS.Space.l)
        if !isKid, let pickGrade {
            PillButton("Pick my grade", kind: .primary, action: pickGrade)
                .fixedSize()
        }
    }

    private struct CardPress: ButtonStyle {
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
                .animation(reduceMotion ? nil : DS.Motion.snap, value: configuration.isPressed)
        }
    }
}
