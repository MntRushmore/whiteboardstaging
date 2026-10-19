import Foundation

/// The signed-in user's row in `profiles`, the columns the app shows (read as the user, under RLS).
public struct Profile: Sendable, Equatable, Decodable {
    public static let columns = "user_id, display_name, avatar, grade, course, onboarded_at, terms_version"

    public let userId: String
    public let displayName: String?
    /// An avatar id (`FamilyAvatar`).
    public let avatar: String?
    /// 0 (Kindergarten) to 8, or nil.
    public let grade: Int?
    /// A high-school course, when the student picked one instead of a grade.
    public let course: String?
    public let onboardedAt: Date?
    public let termsVersion: String?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case displayName = "display_name"
        case avatar, grade, course
        case onboardedAt = "onboarded_at"
        case termsVersion = "terms_version"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.decode(String.self, forKey: .userId)
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        avatar = try c.decodeIfPresent(String.self, forKey: .avatar)
        grade = try c.decodeIfPresent(Int.self, forKey: .grade)
        course = try c.decodeIfPresent(String.self, forKey: .course)
        onboardedAt = try c.decodeIfPresent(String.self, forKey: .onboardedAt).flatMap(PostgresDate.parse)
        termsVersion = try c.decodeIfPresent(String.self, forKey: .termsVersion)
    }
}
