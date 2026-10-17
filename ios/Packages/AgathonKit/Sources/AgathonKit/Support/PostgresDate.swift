import Foundation

/// Timestamps as PostgREST and the API write them: ISO 8601, with or without fractional seconds
/// (Postgres writes 0 to 6 digits: `2026-10-17T09:41:12.123456+00:00`), `Z`, `+00` or `+05:30`.
public enum PostgresDate {
    public static func parse(_ text: String) -> Date? {
        var s = text.trimmingCharacters(in: .whitespaces)
        guard s.count >= 10 else { return nil }
        // Postgres's own text form has a space between the date and the time.
        let tenth = s.index(s.startIndex, offsetBy: 10)
        if s.count > 10, s[tenth] == " " { s.replaceSubrange(tenth ... tenth, with: "T") }
        // ISO8601DateFormatter wants exactly milliseconds: cut or pad the fraction to 3 digits.
        if let range = s.range(of: #"\.\d+"#, options: .regularExpression) {
            let digits = s[range].dropFirst()
            let millis = String((digits + "000").prefix(3))
            s.replaceSubrange(range, with: "." + millis)
        }
        // `+00` (an offset without minutes) is Postgres's, not ISO 8601's.
        if s.range(of: #"T.*[+-]\d{2}$"#, options: .regularExpression) != nil { s += ":00" }
        // No zone at all (a `timestamp` column): UTC.
        if s.count > 10, s.range(of: #"(Z|[+-]\d{2}:?\d{2})$"#, options: .regularExpression) == nil { s += "Z" }
        return withFraction.date(from: s) ?? withoutFraction.date(from: s)
    }

    public static func string(from date: Date) -> String {
        withFraction.string(from: date)
    }

    // ISO8601DateFormatter is thread-safe.
    nonisolated(unsafe) private static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) private static let withoutFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
