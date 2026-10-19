import AgathonBrain
import Foundation

// The Live routes' bodies, field for field as src/lib/live/contracts.ts (zod is the source of
// truth there). Optional fields are left out of the JSON when nil.

/// POST /api/live/recognize
public struct RecognizeRequest: Encodable, Sendable, Equatable {
    public struct Strokes: Encodable, Sendable, Equatable {
        public var x: [[Double]]
        public var y: [[Double]]
    }
    public struct Size: Encodable, Sendable, Equatable {
        public var w: Double
        public var h: Double
    }
    public var boardId: String
    public var lineId: String
    public var strokes: Strokes
    public var bounds: Size
    /// data:image/jpeg;base64 crop: with the vision recognizer, or the one retry after `needsCrop`
    public var crop: String?
    /// the crop retry: the route goes straight to the vision reader
    public var cropOnly: Bool?
    /// with `crop`: a second opinion on the line (docs/PROBLEM-PAGES.md, "The second opinion"): the
    /// route reads the crop too (Mathpix v3/text, behind its `RECOGNIZE_SECOND_OPINION` flag) and says
    /// whether the two reads agree. Never the line's reading. A route without it ignores the key.
    public var secondOpinion: Bool?

    public init(boardId: String, lineId: String, payload: RecognizerPayload, crop: String? = nil, cropOnly: Bool? = nil) {
        self.boardId = boardId
        self.lineId = lineId
        strokes = Strokes(x: payload.strokes.x, y: payload.strokes.y)
        bounds = Size(w: payload.bounds.w, h: payload.bounds.h)
        self.crop = crop
        self.cropOnly = cropOnly
    }
}

public struct RecognizeResponse: Codable, Sendable, Equatable {
    public var latex: String
    public var text: String
    /// math, chem, text, unknown
    public var kind: String
    public var confidence: Double
    /// mathpix, vision
    public var provider: String
    public var ms: Double
    /// the second opinion's read of the line's crop, when asked for and the route's flag is on
    public var second: SecondRead?
    /// the two reads are the same maths (nil: no second opinion)
    public var agree: Bool?

    /// A second reader's read of a line (never the line's reading: a reason to ask the kid).
    public struct SecondRead: Codable, Sendable, Equatable {
        public var latex: String
        public var confidence: Double?

        public init(latex: String, confidence: Double? = nil) {
            self.latex = latex
            self.confidence = confidence
        }
    }

    public init(latex: String, text: String = "", kind: String = "math", confidence: Double = 1, provider: String = "mathpix", ms: Double = 0,
                second: SecondRead? = nil, agree: Bool? = nil) {
        self.latex = latex
        self.text = text
        self.kind = kind
        self.confidence = confidence
        self.provider = provider
        self.ms = ms
        self.second = second
        self.agree = agree
    }
}

/// GET /api/live/recognize
public struct LiveCapabilities: Codable, Sendable, Equatable {
    public struct Models: Codable, Sendable, Equatable {
        public var check: String
        public var solve: String
        public var vision: String
    }
    /// mathpix or vision (with vision, every read sends a crop)
    public var recognizer: String
    public var liveEnabled: Bool
    public var models: Models?
}

/// One line as check and solve see it (`CheckLineSchema`).
public struct CheckLine: Codable, Sendable, Equatable {
    public struct Local: Codable, Sendable, Equatable {
        public var kind: String
        public var verdict: String
        public var resultLatex: String?
        public var note: String?
    }
    public var id: String
    public var latex: String
    /// [x0, y0, x1, y1] in 0…1 of the region: reading order, never placement
    public var bbox: [Double]
    public var local: Local
}

/// The page rect the lines sit in.
public struct RegionRect: Codable, Sendable, Equatable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double
}

/// POST /api/live/check (SSE)
public struct CheckRequest: Encodable, Sendable, Equatable {
    public var boardId: String
    /// feedback or suggest
    public var mode: String
    public var region: RegionRect
    public var lines: [CheckLine]
    public var focusLineId: String?
    public var userAsked: Bool
}

/// POST /api/live/solve (SSE)
public struct SolveRequest: Encodable, Sendable, Equatable {
    public var boardId: String
    public var region: RegionRect
    public var lines: [CheckLine]
    public var fromLineId: String?
    public var goal: String?
}

/// POST /api/live/reread: the second reader, one suspicious line.
public struct RereadRequest: Encodable, Sendable, Equatable {
    public var boardId: String
    public var lineId: String
    public var crop: String
    public var latex: String
    public var above: [String]
    public var below: [String]
}

public struct RereadResponse: Codable, Sendable, Equatable {
    public var latex: String
    public var changed: Bool
    public var model: String
    public var ms: Double
}

/// POST /api/live/setup: a word problem's equations (the engine then solves them).
public struct SetupRequest: Encodable, Sendable, Equatable {
    public var boardId: String
    public var lines: [String]
}

public struct SetupResponse: Codable, Sendable, Equatable {
    public var lines: [String]
    public var reason: String?
    public var unknown: String?
    public var model: String
    public var ms: Double
}

extension BrainRect {
    var region: RegionRect { RegionRect(x: x, y: y, w: max(0, w), h: max(0, h)) }

    /// `rect` as [x0, y0, x1, y1] within this region, each in 0…1 (`normalizeBBox`).
    func normalized(_ r: BrainRect) -> [Double] {
        let w = Swift.max(1, self.w), h = Swift.max(1, self.h)
        func c(_ v: Double) -> Double { Swift.min(1, Swift.max(0, v)) }
        return [c((r.x - x) / w), c((r.y - y) / h), c((r.maxX - x) / w), c((r.maxY - y) / h)]
    }
}
