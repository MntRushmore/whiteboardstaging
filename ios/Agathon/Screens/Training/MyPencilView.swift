import AgathonBoard
import AgathonDesign
import AgathonKit
import AgathonLive
import SwiftUI

/// MY PENCIL: the training board for the owner's own Pencil. The top bar picks the handwriting the
/// page is written in and where the next problem comes from (a grade and topic, written by the tutor
/// at the top of a fresh page, or a blank page of their own); Next saves the page and opens a fresh
/// one. Each line the tutor has answered asks for a 👍 or a 👎 (and what it should have done).
struct MyPencilView: View {
    let close: () -> Void
    @Environment(AgathonBackend.self) private var backend
    @StateObject private var holder = Holder()

    @MainActor final class Holder: ObservableObject {
        @Published var session: PencilSession?
    }

    var body: some View {
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            if let session = holder.session {
                PencilBoard(session: session, close: {
                    Task { @MainActor in
                        await session.close()
                        close()
                    }
                })
            }
        }
        .task {
            guard holder.session == nil else { return }
            let s = PencilSession(backend: backend)
            holder.session = s
            await s.start()
        }
    }
}

private struct PencilBoard: View {
    @ObservedObject var session: PencilSession
    @ObservedObject var board: TrainingBoard
    let close: () -> Void
    @State private var reviewing: LiveLine?
    @State private var showLines = false
    @State private var showSource = false
    @State private var askOther = false
    @State private var otherDraft = ""

    init(session: PencilSession, close: @escaping () -> Void) {
        self.session = session
        board = session.board
        self.close = close
    }

    var body: some View {
        TrainingBoardView(board: board, title: "My Pencil", onBack: close) {
            #if DEBUG
            PencilAutowriteButton(session: session)
            #endif
            styleMenu
            sourceButton
            linesButton
            nextButton
        }
        .overlay(alignment: .topTrailing) {
            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                if let line = session.asking, !(board.loop?.pages.chipsHidden ?? false) {
                    ReviewStrip(line: line, mark: board.loop?.trainingMark(on: line.id) ?? .none,
                                up: { session.review(line.id, TrainingReview(thumbsUp: true)) },
                                down: { reviewing = line },
                                skip: { session.skip(line.id) })
                        .padding(.top, 92)
                        .padding(.trailing, DS.Space.l)
                        .transition(.opacity)
                }
            }
        }
        .overlay(alignment: .top) {
            if let message = session.message {
                Banner(.tutor, message, surface: .ink)
                    .frame(maxWidth: 560)
                    .padding(.top, 84)
                    .onTapGesture { session.message = nil }
            }
        }
        .sheet(item: $reviewing) { line in
            LineReviewSheet(line: line, mark: board.loop?.trainingMark(on: line.id) ?? .none) { review in
                session.review(line.id, review)
                reviewing = nil
            }
        }
        .sheet(isPresented: $showSource) {
            SourcePicker(source: $session.source) { showSource = false }
        }
    }

    private var styleMenu: some View {
        Menu {
            ForEach(HandwritingStyle.allCases) { style in
                Button {
                    if style == .other {
                        otherDraft = session.otherStyle
                        askOther = true
                    } else {
                        session.style = style
                    }
                } label: {
                    if style == session.style { Label(style.title, systemImage: "checkmark") } else { Text(style == .other ? "Other…" : style.title) }
                }
            }
        } label: {
            TrainingPill(text: "Hand: \(session.style == .other && !session.otherStyle.isEmpty ? session.otherStyle : session.style.title)"
                         + (session.page.map { $0.tag != session.styleTag } == true ? " (next page)" : ""))
        }
        .accessibilityIdentifier("pencil.style")
        .alert("Describe the handwriting", isPresented: $askOther) {
            TextField("e.g. cursive, tiny digits", text: $otherDraft)
            Button("Use it") {
                session.otherStyle = otherDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                session.style = .other
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var sourceButton: some View {
        Button { showSource = true } label: { TrainingPill(text: session.source.title) }
            .buttonStyle(.plain)
            .accessibilityIdentifier("pencil.source")
    }

    private var linesButton: some View {
        Button { showLines = true } label: {
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                TrainingPill(text: "Lines \(session.reviews.count)/\(session.lines.filter { !$0.latex.isEmpty }.count)")
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("pencil.lines")
        .popover(isPresented: $showLines) {
            LinesList(session: session) { line in
                showLines = false
                reviewing = line
            }
            .frame(width: 440)
            .frame(minHeight: 280)
        }
    }

    private var nextButton: some View {
        PillButton(session.busy ? "Writing…" : "Next", icon: .forward, kind: .primary) {
            Task { await session.next() }
        }
        .fixedSize()
        .disabled(session.busy)
        .accessibilityIdentifier("pencil.next")
    }
}

/// The question after the tutor answered a line: was that right?
private struct ReviewStrip: View {
    let line: LiveLine
    let mark: TrainingMark
    let up: () -> Void
    let down: () -> Void
    let skip: () -> Void

    var body: some View {
        HStack(spacing: DS.Space.s) {
            VStack(alignment: .leading, spacing: 2) {
                Text("The tutor read").dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                HStack(spacing: 8) {
                    LatexLabel(line.latex).frame(maxWidth: 220, alignment: .leading)
                    MarkBadge(mark: mark)
                }
            }
            Spacer(minLength: DS.Space.xs)
            ThumbButton(up: true, action: up).accessibilityIdentifier("pencil.up")
            ThumbButton(up: false, action: down).accessibilityIdentifier("pencil.down")
            Button("Not now", action: skip)
                .dsFont(.caption)
                .foregroundStyle(DS.Color.inkSecondary)
                .buttonStyle(.plain)
        }
        .padding(.horizontal, DS.Space.m)
        .padding(.vertical, DS.Space.s)
        .frame(width: 460)
        .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surface))
        .overlay(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).strokeBorder(DS.Color.line, lineWidth: 1.5))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pencil.review")
    }
}

struct ThumbButton: View {
    let up: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(up ? "👍" : "👎")
                .font(.system(size: 26))
                .frame(width: 56, height: 56)
                .background(Circle().fill(up ? DS.Color.surfaceSunken : DS.Color.surfaceSunken))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(up ? "Right" : "Not right")
    }
}

/// A tutor's mark as a small flat badge.
struct MarkBadge: View {
    let mark: TrainingMark

    var body: some View {
        let (text, fill): (String, Color) = {
            switch mark {
            case .tick: return ("✓ tick", DS.Color.success.opacity(0.16))
            case .ring: return ("◯ ring", DS.Color.tomato.opacity(0.18))
            case .question: return ("? unread", DS.Color.sunny.opacity(0.35))
            case .none: return ("no mark", DS.Color.surfaceSunken)
            }
        }()
        Text(text)
            .dsFont(.label)
            .foregroundStyle(DS.Color.ink)
            .padding(.horizontal, 10)
            .frame(minHeight: 28)
            .background(Capsule().fill(fill))
            .fixedSize()
    }
}

/// Every line on the page, with its read, its mark and its review.
private struct LinesList: View {
    @ObservedObject var session: PencilSession
    let open: (LiveLine) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.s) {
                Text("This page").dsFont(.headline).foregroundStyle(DS.Color.ink)
                let lines = session.lines.filter { !$0.latex.isEmpty }
                if lines.isEmpty {
                    Text("Write a line: the tutor's read shows here.").dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
                }
                ForEach(lines, id: \.id) { line in
                    let review = session.reviews[line.id]
                    let mark = session.board.loop?.trainingMark(on: line.id) ?? .none
                    HStack(spacing: DS.Space.s) {
                        LatexLabel(line.latex).frame(maxWidth: .infinity, alignment: .leading)
                        if session.answered(line) { MarkBadge(mark: mark) } else { TrainingPill(text: "not checked", tint: DS.Color.inkSecondary) }
                        if let review {
                            Text(review.thumbsUp ? "👍" : "👎").font(.system(size: 22))
                        }
                        ThumbButton(up: true) { session.review(line.id, TrainingReview(thumbsUp: true)) }
                        ThumbButton(up: false) { open(line) }
                    }
                }
            }
            .padding(DS.Space.l)
        }
        .background(DS.Color.paper)
    }
}

/// 👎: what should the tutor have done?
struct LineReviewSheet: View {
    let line: LiveLine
    let mark: TrainingMark
    let save: (TrainingReview) -> Void
    @State private var should: TrainingReview.Should?
    @State private var latex = ""
    @State private var note = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader("What should it have done?", onClose: { dismiss() })
            HStack(spacing: DS.Space.s) {
                Text("It read").dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                LatexLabel(line.latex)
                MarkBadge(mark: mark)
            }
            HStack(spacing: DS.Space.xs) {
                ForEach(TrainingReview.Should.allCases, id: \.self) { s in
                    Button { should = s } label: {
                        Text(s.title)
                            .dsFont(.button, size: 17)
                            .foregroundStyle(should == s ? DS.Color.onInk : DS.Color.ink)
                            .padding(.horizontal, DS.Space.m)
                            .frame(minHeight: 52)
                            .background(Capsule().fill(should == s ? DS.Color.ink : DS.Color.surfaceSunken))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("review.\(s.rawValue)")
                }
            }
            if should == .misread {
                VStack(alignment: .leading, spacing: 6) {
                    Text("What it says (LaTeX, e.g. 2x = 8)").dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                    TextField("", text: $latex)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(size: 20, design: .monospaced))
                        .padding(DS.Space.s)
                        .background(RoundedRectangle(cornerRadius: 14).fill(DS.Color.surfaceSunken))
                        .accessibilityIdentifier("review.latex")
                    if !latex.isEmpty { LatexLabel(latex) }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("A note (optional)").dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                TextField("", text: $note, axis: .vertical)
                    .lineLimit(2...4)
                    .padding(DS.Space.s)
                    .background(RoundedRectangle(cornerRadius: 14).fill(DS.Color.surfaceSunken))
                    .accessibilityIdentifier("review.note")
            }
            PillButton("Save", icon: .check, kind: .primary) {
                let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
                let trimmedLatex = latex.trimmingCharacters(in: .whitespacesAndNewlines)
                save(TrainingReview(thumbsUp: false, should: should, latex: trimmedLatex.isEmpty ? nil : trimmedLatex,
                                    note: trimmedNote.isEmpty ? nil : String(trimmedNote.prefix(500))))
            }
            .disabled(should == nil || (should == .misread && latex.trimmingCharacters(in: .whitespaces).isEmpty))
            .accessibilityIdentifier("review.save")
            Spacer(minLength: 0)
        }
        .padding(DS.Space.xl)
        .background(DS.Color.paper)
    }
}

/// Where Next's problem comes from: a grade and a topic (the brain's practice), or the writer's own.
private struct SourcePicker: View {
    @Binding var source: PencilSession.Source
    let done: () -> Void
    @State private var grade: TrainingGrade = .g56

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader("Next page", onClose: done)
            Button {
                source = .own
                done()
            } label: {
                HStack {
                    Text("My own problem").dsFont(.button, size: 19)
                    Spacer()
                    if source == .own { DSIcon(.check, size: 20) }
                }
                .foregroundStyle(DS.Color.ink)
                .padding(DS.Space.m)
                .background(RoundedRectangle(cornerRadius: DS.Radius.tile).fill(DS.Color.surfaceSunken))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("source.own")
            Text("Or the tutor writes one:").dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            SegmentedPicker(selection: $grade, options: TrainingGrade.allCases.map { ($0, $0.rawValue) })
            ScrollView {
                VStack(spacing: DS.Space.xs) {
                    ForEach(PencilSession.skills(grade), id: \.self) { skill in
                        Button {
                            source = .generated(grade: grade, skill: skill)
                            done()
                        } label: {
                            HStack {
                                Text(PencilSession.skillName(skill)).dsFont(.button, size: 17)
                                Spacer()
                                if source == .generated(grade: grade, skill: skill) { DSIcon(.check, size: 18) }
                            }
                            .foregroundStyle(DS.Color.ink)
                            .padding(.horizontal, DS.Space.m)
                            .frame(minHeight: 52)
                            .background(RoundedRectangle(cornerRadius: DS.Radius.tile).fill(DS.Color.surface))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("source.\(skill)")
                    }
                }
            }
        }
        .padding(DS.Space.xl)
        .background(DS.Color.ground)
        .onAppear {
            if case .generated(let g, _) = source { grade = g }
        }
    }
}

extension LiveLine: Identifiable {}
