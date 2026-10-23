import Foundation

/// Fields every Live request body carries besides its own, while they are set: SAT mode's
/// `sat_question_id` (docs/SAT-MODE.md, "Server enforcement": the server lets a live call on an SAT
/// page through only with that question's free tutor pass for today, or Unlimited). The board's SAT
/// session sets it to the question on show, before the tutor is switched on for that page; nil on
/// every other board, where the bodies are exactly as before.
public final class LiveRequestTag: @unchecked Sendable {
    private let lock = NSLock()
    private var _satQuestionId: String?

    public init(satQuestionId: String? = nil) {
        _satQuestionId = satQuestionId
    }

    /// The SAT question the board's live calls are about.
    public var satQuestionId: String? {
        get { lock.withLock { _satQuestionId } }
        set { lock.withLock { _satQuestionId = newValue } }
    }

    /// The fields to add, by their JSON keys.
    public var fields: [String: String] {
        satQuestionId.map { ["sat_question_id": $0] } ?? [:]
    }

    /// `body` with the tag's fields beside its own.
    func wrap<Body: Encodable & Sendable>(_ body: Body) -> TaggedBody<Body> {
        TaggedBody(body: body, fields: fields)
    }
}

/// A request body with extra top-level keys: the body's own JSON object, then the fields (the
/// encoder's keyed container is the same object, so they land in it).
struct TaggedBody<Body: Encodable & Sendable>: Encodable, Sendable {
    let body: Body
    let fields: [String: String]

    struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(_ s: String) { stringValue = s }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    func encode(to encoder: Encoder) throws {
        try body.encode(to: encoder)
        guard !fields.isEmpty else { return }
        var c = encoder.container(keyedBy: Key.self)
        for (k, v) in fields.sorted(by: { $0.key < $1.key }) { try c.encode(v, forKey: Key(k)) }
    }
}
