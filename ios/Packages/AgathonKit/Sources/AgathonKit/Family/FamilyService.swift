import Foundation

/// Family profiles (src/lib/family/client.ts): read the family, set the grown-up's PIN, and become
/// another member of it.
///
/// Switching: the server mints the other profile's session (POST /api/family/switch) and ends the
/// caller's; the app takes the new one with `setSession`. Everything read as the old profile (boards,
/// ink, the learning record) belongs to someone else now, so screens key their state on
/// `AuthService.userId` and read again.
public final class FamilyService: Sendable {
    public static let path = "/api/family"

    let api: APIClient
    let adoptSession: @Sendable (SwitchResult) async throws -> Void

    /// `adoptSession` takes the new session (`AuthService.setSession`).
    public init(api: APIClient, adoptSession: @escaping @Sendable (SwitchResult) async throws -> Void) {
        self.api = api
        self.adoptSession = adoptSession
    }

    /// GET /api/family?tz=<minutes behind UTC> (Date#getTimezoneOffset, for "this week").
    public func load(timeZone: TimeZone = .current, now: Date = Date()) async throws -> FamilyState {
        try await api.get(Self.path, query: [URLQueryItem(name: "tz", value: String(Self.tzOffset(timeZone, at: now)))])
    }

    /// Becomes `userId` (a member of the signed-in user's family), with the grown-up's PIN when
    /// `userId` is the grown-up. Refusals are `APIError.http`: a wrong PIN is 403 with
    /// `reason == "wrong_pin"` and `triesLeft` (`locked` on the day's last try), too many tries 429
    /// (`reason == "pin_locked"` once locked for the day), no PIN set `reason == "no_pin"`.
    public func switchProfile(to userId: String, pin: String? = nil) async throws {
        if let pin, !Self.isValidPin(pin) { throw FamilyError.pinFormat }
        let result: SwitchResult = try await api.post("\(Self.path)/switch", body: SwitchBody(to: userId, pin: pin))
        try await adoptSession(result)
    }

    /// POST /api/family/pin: sets or changes the grown-up's 4-digit PIN (a kid's profile is refused).
    public func setPin(_ pin: String) async throws {
        guard Self.isValidPin(pin) else { throw FamilyError.pinFormat }
        _ = try await api.post("\(Self.path)/pin", body: ["pin": pin], as: EmptyResponse.self)
    }

    /// A grown-up's PIN: exactly 4 digits (PIN_PATTERN).
    public static func isValidPin(_ pin: String) -> Bool {
        pin.count == 4 && pin.allSatisfy { $0.isASCII && $0.isNumber }
    }

    /// JavaScript's Date#getTimezoneOffset: minutes BEHIND UTC (New York in winter is 300).
    public static func tzOffset(_ timeZone: TimeZone, at date: Date) -> Int {
        -timeZone.secondsFromGMT(for: date) / 60
    }

    struct SwitchBody: Encodable {
        let to: String
        let pin: String?

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(to, forKey: .to)
            // The schema is strict: no `pin` key at all unless there is one.
            try c.encodeIfPresent(pin, forKey: .pin)
        }

        enum CodingKeys: String, CodingKey { case to, pin }
    }
}

public enum FamilyError: Error, Equatable, LocalizedError {
    case pinFormat

    public var errorDescription: String? {
        switch self {
        case .pinFormat: return "A PIN is exactly 4 digits."
        }
    }
}
