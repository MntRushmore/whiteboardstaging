import AgathonKit
import AgathonLive
import Foundation
import os

/// Who may open the Training Center (`is_admin()`), and where a run goes once it is made: this
/// iPad's copy (`TrainingStore`) always, Supabase's tables (`TrainingRepository`) when they are there.
@MainActor
enum TrainingSync {
    static let log = Logger(subsystem: "app.agathon.ios", category: "training")

    /// The signed-in user is an admin (asked once per sign-in; a failed ask is "no").
    static func isAdmin(_ backend: AgathonBackend) async -> Bool {
        do {
            return try await TrainingRepository(client: backend.supabase).isAdmin()
        } catch {
            log.notice("training: is_admin failed: \(String(describing: error), privacy: .public)")
            return false
        }
    }

    /// The API this build calls, as the screens name it.
    static func target(_ backend: AgathonBackend) -> String {
        backend.environment.apiBaseURL.host ?? backend.environment.apiBaseURL.absoluteString
    }

    static func isProduction(_ backend: AgathonBackend) -> Bool {
        let host = target(backend)
        return !(host == "localhost" || host == "127.0.0.1" || host.hasSuffix(".local"))
    }

    static var appBuild: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? "?"
        let b = info?["CFBundleVersion"] as? String ?? "?"
        #if DEBUG
        return "\(v) (\(b)) debug"
        #else
        return "\(v) (\(b))"
        #endif
    }

    // MARK: - uploading

    /// Saves the run on this iPad, then to Supabase. Returns the run with its sync state.
    @discardableResult
    static func save(_ run: TrainingRun, backend: AgathonBackend, cases only: [UUID]? = nil) async -> TrainingRun {
        var run = run
        TrainingStore.shared.save(run)
        let repo = TrainingRepository(client: backend.supabase)
        do {
            try await repo.upsert(run: runRow(run))
            let rows = run.cases.filter { only == nil || only!.contains($0.id) }.map { caseRow($0, run: run) }
            try await repo.upsert(cases: rows)
            run.synced = true
            run.syncNote = nil
        } catch {
            run.synced = false
            run.syncNote = TrainingRepository.isMissingTable(error)
                ? "Kept on this iPad: the training tables are not on this server yet."
                : "Kept on this iPad: couldn't save to the server (\(String(String(describing: error).prefix(120))))."
            log.notice("training: sync failed: \(String(describing: error), privacy: .public)")
        }
        TrainingStore.shared.save(run)
        return run
    }

    static func json<T: Encodable>(_ value: T) -> JSONValue {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(value), let v = JSONValue.parse(data) else { return .null }
        return v
    }

    static let iso = ISO8601DateFormatter()

    static func runRow(_ run: TrainingRun) -> TrainingRepository.RunRow {
        let s = run.summary
        let totals: JSONValue = .object([
            "cases": .number(Double(s.cases)), "passed": .number(Double(s.passed)),
            "lines": .number(Double(s.lines)), "linesPassed": .number(Double(s.linesPassed)),
            "readsRight": .number(Double(s.readsRight)), "readsChecked": .number(Double(s.readsChecked)),
            "calls": json(s.calls), "ink": .number(Double(s.ink)),
            "readP50": s.readP50.map { .number($0.rounded()) } ?? .null, "readP90": s.readP90.map { .number($0.rounded()) } ?? .null,
            "checkP50": s.checkP50.map { .number($0.rounded()) } ?? .null, "checkP90": s.checkP90.map { .number($0.rounded()) } ?? .null,
            "byCategory": .array(s.byCategory.map(bucket)), "byHand": .array(s.byHand.map(bucket)), "byGrade": .array(s.byGrade.map(bucket)),
        ])
        return TrainingRepository.RunRow(id: run.id.uuidString.lowercased(), kind: run.kind.rawValue, status: run.status.rawValue,
                                         target: String(run.target.prefix(200)), app_build: run.appBuild,
                                         config: run.config.map { json($0) } ?? .object([:]), totals: totals,
                                         created_at: iso.string(from: run.startedAt), finished_at: run.finishedAt.map { iso.string(from: $0) })
    }

    static func bucket(_ b: TrainingSummary.Bucket) -> JSONValue {
        .object(["name": .string(b.name), "cases": .number(Double(b.cases)), "passed": .number(Double(b.passed)),
                 "lines": .number(Double(b.lines)), "linesPassed": .number(Double(b.linesPassed))])
    }

    static func caseRow(_ r: TrainingCaseResult, run: TrainingRun) -> TrainingRepository.CaseRow {
        let expected: JSONValue = .array(r.lines.map { l in
            .object(["written": .string(l.written), "expect": l.expect.map { .string($0.rawValue) } ?? .null,
                     "value": l.value.map { .string($0) } ?? .null, "place": .string(l.place.rawValue)])
        })
        let snapshot = r.snapshot.flatMap { data -> String? in
            let s = "data:image/jpeg;base64,\(data.base64EncodedString())"
            return s.count <= 600_000 ? s : nil
        }
        let settings = TrainingFixture.Settings(mode: "feedback", auto: true, checking: run.config?.checking ?? CheckTiming.whenDone.rawValue)
        return TrainingRepository.CaseRow(
            id: r.id.uuidString.lowercased(), run_id: run.id.uuidString.lowercased(), kind: r.kind.rawValue,
            case_key: String(r.caseKey.prefix(120)), category: r.category.rawValue, grade: r.grade?.rawValue, topic: String(r.topic.prefix(60)),
            hand: String(r.hand.prefix(60)), problem: json(r.problem), expected: expected, lines: json(r.lines), strokes: json(r.strokes),
            reads: json(r.reads), pass: r.pass, calls: json(r.calls), ms: Int(r.ms.rounded()), snapshot: snapshot, regression: r.regression,
            fixture: r.regression ? json(TrainingFixture(r, settings: settings)) : nil, updated_at: iso.string(from: Date()))
    }

    // MARK: - reading back

    static func decode<T: Decodable>(_ value: JSONValue?, as: T.Type) -> T? {
        guard let value, let data = try? JSONEncoder().encode(value) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(T.self, from: data)
    }

    /// A case row (another device's run) as a result the results screen shows.
    static func result(_ row: TrainingRepository.CaseRow) -> TrainingCaseResult? {
        guard let id = UUID(uuidString: row.id), let kind = TrainingKind(rawValue: row.kind) else { return nil }
        let snapshot = row.snapshot.flatMap { s -> Data? in
            guard let comma = s.firstIndex(of: ",") else { return nil }
            return Data(base64Encoded: String(s[s.index(after: comma)...]))
        }
        return TrainingCaseResult(
            id: id, kind: kind, caseKey: row.case_key, category: TrainingCategory(rawValue: row.category) ?? .generated,
            grade: row.grade.flatMap(TrainingGrade.init(rawValue:)), topic: row.topic ?? "", hand: row.hand,
            problem: decode(row.problem, as: [String].self) ?? [], spec: nil,
            lines: decode(row.lines, as: [TrainingLineResult].self) ?? [], strokes: decode(row.strokes, as: [[TrainingStroke]].self) ?? [],
            reads: decode(row.reads, as: [RecordedRead].self) ?? [], solvedExpected: nil, solvedGot: false, pass: row.pass,
            calls: decode(row.calls, as: [String: Int].self) ?? [:], ms: Double(row.ms ?? 0), snapshot: snapshot, regression: row.regression)
    }
}
