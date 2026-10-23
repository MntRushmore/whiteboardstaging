import AgathonDesign
import AgathonKit
import SwiftUI

/// Account → Picture tutor (test): admins only (`is_admin()`, as the Training Center). The switch for
/// this iPad, the mode a board starts in, and the last runs' timings (the board itself shows none).
@MainActor
struct PictureTutorPage: View {
    @AppStorage(PictureTutorSettings.enabledKey) private var enabled = false
    @AppStorage(PictureTutorSettings.modeKey) private var mode: PictureTutorMode = .suggest
    @ObservedObject var log: PictureTutorLog

    init(log: PictureTutorLog? = nil) {
        self.log = log ?? .shared
    }

    var body: some View {
        AreaPage("Picture tutor (test)",
                 subtitle: "Reed's picture tutor, sped up. When the pen lifts, the board goes to the tutor as a picture and its drawing comes back over the work. On your boards only, on this iPad.") {
            AreaCard("On this iPad") {
                Toggle(isOn: $enabled) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Use the picture tutor on my boards").dsFont(.callout).foregroundStyle(DS.Color.ink)
                        Text(enabled ? "On: your boards run it instead of the ticks and rings. Kids' profiles never see it."
                                     : "Off: the boards work exactly as they do today.")
                            .dsFont(.caption)
                            .foregroundStyle(DS.Color.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .tint(DS.Color.tutorInk)
                .frame(minHeight: DS.Size.minTarget)
                .accessibilityIdentifier("picture.enabled")
                VStack(alignment: .leading, spacing: DS.Space.xs) {
                    Text("A board starts in").dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                    SegmentedPicker(selection: $mode, options: PictureTutorMode.allCases.filter { $0 != .off }.map { ($0, $0.title) }, onPaper: true)
                        .accessibilityIdentifier("picture.defaultMode")
                    Text(Self.modeWords(mode))
                        .dsFont(.caption)
                        .foregroundStyle(DS.Color.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .opacity(enabled ? 1 : 0.5)
                .disabled(!enabled)
            }
            AreaCard("Last runs") {
                if log.runs.isEmpty {
                    Text("No runs yet. Turn it on, open a board and write.")
                        .dsFont(.callout)
                        .foregroundStyle(DS.Color.inkSecondary)
                } else {
                    VStack(spacing: 0) {
                        RunRow.header
                        ForEach(log.runs) { run in
                            Divider().overlay(DS.Color.divider)
                            RunRow(run: run)
                        }
                    }
                    PillButton("Clear", kind: .secondaryOnPaper) { log.clear() }
                        .fixedSize()
                }
            }
        }
        .accessibilityIdentifier("picture.page")
    }

    static func modeWords(_ mode: PictureTutorMode) -> String {
        switch mode {
        case .off: return "Nothing is sent."
        case .feedback: return "Feedback: marks and short notes on the work, shown at once."
        case .suggest: return "Suggest: a hint for the next step, faint until you Accept it."
        case .answer: return "Solve: the rest of the working, faint until you Accept it."
        }
    }
}

/// One run: when, mode, how long to each stage (s), the server's total, what became of it.
private struct RunRow: View {
    let run: PictureTutorRun

    static var header: some View {
        HStack(spacing: DS.Space.s) {
            cell("When", width: 64)
            cell("Mode", width: 82)
            cell("Read", width: 52, trailing: true)
            cell("Draw", width: 52, trailing: true)
            cell("Done", width: 52, trailing: true)
            cell("Server", width: 60, trailing: true)
            cell("Outcome", width: nil)
        }
        .dsFont(.label, size: 12)
        .foregroundStyle(DS.Color.inkSecondary)
        .padding(.vertical, DS.Space.xs)
    }

    var body: some View {
        HStack(spacing: DS.Space.s) {
            Self.cell(run.at.formatted(date: .omitted, time: .shortened), width: 64)
            Self.cell(run.mode.title + (run.source == "voice" ? " · now" : ""), width: 82)
            Self.cell(Self.seconds(run.readingMs), width: 52, trailing: true)
            Self.cell(Self.seconds(run.drawingMs), width: 52, trailing: true)
            Self.cell(Self.seconds(run.endMs), width: 52, trailing: true)
            Self.cell(Self.seconds(run.timings?.totalMs), width: 60, trailing: true)
            Self.cell(run.outcome.rawValue, width: nil)
        }
        .dsFont(.callout, size: 15)
        .monospacedDigit()
        .foregroundStyle(DS.Color.ink)
        .padding(.vertical, DS.Space.xs)
        .accessibilityElement(children: .combine)
        .help(run.note ?? "")
    }

    static func seconds(_ ms: Double?) -> String {
        guard let ms else { return "–" }
        return String(format: "%.1f s", ms / 1000)
    }

    @ViewBuilder static func cell(_ text: String, width: CGFloat?, trailing: Bool = false) -> some View {
        Text(text)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(width: width, alignment: trailing ? .trailing : .leading)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}
