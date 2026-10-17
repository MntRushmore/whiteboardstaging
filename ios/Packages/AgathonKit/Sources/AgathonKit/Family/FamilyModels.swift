import Foundation

/// GET /api/family: who is signed in and who else is in their family (src/lib/family/contracts.ts).
public struct FamilyState: Sendable, Equatable, Codable {
    public enum Role: String, Sendable, Codable {
        case solo, parent, kid
    }

    public let role: Role
    /// The signed-in user.
    public let me: String
    /// The grown-up's user id (`me` for solo and parent).
    public let parentId: String
    /// The grown-up first, then the kids in the order they were added.
    public let members: [FamilyMember]
    public let hasPin: Bool

    public var meMember: FamilyMember? { members.first { $0.userId == me } }
    /// The others this profile can become (never itself; nobody for a solo account).
    public var switchTargets: [FamilyMember] { role == .solo ? [] : members.filter { $0.userId != me } }
}

public struct FamilyMember: Sendable, Equatable, Codable, Identifiable {
    public struct Stats: Sendable, Equatable, Codable {
        public let streak: Int
        public let problemsThisWeek: Int
        public let mastered: Int
    }

    public let userId: String
    public let displayName: String
    /// An avatar id (`fox`, `owl`…), drawn as an emoji for now (`FamilyAvatar`).
    public let avatar: String?
    /// 0 (Kindergarten) to 8; nil for a high-school course or unknown.
    public let grade: Int?
    public let isParent: Bool
    /// Headline numbers, only for the grown-up looking at their own kids.
    public let stats: Stats?

    public var id: String { userId }
    /// Switching to this member needs the grown-up's PIN.
    public var needsPin: Bool { isParent }
}

/// The pictures a profile can have (`AVATARS` in src/lib/family/contracts.ts).
public enum FamilyAvatar {
    public static let emoji: [String: String] = [
        "fox": "🦊", "owl": "🦉", "cat": "🐱", "dog": "🐶", "panda": "🐼", "rabbit": "🐰",
        "tiger": "🐯", "frog": "🐸", "penguin": "🐧", "koala": "🐨", "lion": "🦁", "unicorn": "🦄",
    ]

    /// The member's picture, or a plain face when they have none.
    public static func emoji(for avatar: String?) -> String {
        avatar.flatMap { emoji[$0] } ?? "🙂"
    }
}

/// POST /api/family/switch's answer: the new profile's session, for `setSession`.
public struct SwitchResult: Sendable, Equatable, Codable {
    public let accessToken: String
    public let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
    }
}
