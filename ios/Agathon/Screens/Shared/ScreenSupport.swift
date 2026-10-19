import AgathonDesign
import AgathonKit
import SwiftUI

// Small pieces every Blocks screen shares: words for errors and dates, side-by-side async calls,
// the web pages the app links to, and the screen's margins.

/// The pages on the website the app opens (in an in-app Safari sheet), whatever backend a Debug run
/// talks to: the legal pages are the live site's.
enum AppLinks {
    static let site = URL(string: "https://www.agathon.app")!
    static let terms = site.appendingPathComponent("terms")
    static let privacy = site.appendingPathComponent("privacy")
}

/// What a failed call says to the person: the error's own description when it has one written for
/// people (`LocalizedError`), else a plain line. Never a stack of codes.
func userMessage(for error: Error) -> String {
    if error is URLError { return "Can't reach Agathon. Check the Wi-Fi, then try again." }
    if let error = error as? LocalizedError, let text = error.errorDescription, !text.isEmpty { return text }
    return "Something got in the way. Try again in a moment."
}

/// An async call's value or error, so several can run side by side and fail on their own.
func attempt<T: Sendable>(_ operation: @Sendable () async throws -> T) async -> Result<T, Error> {
    do {
        return .success(try await operation())
    } catch {
        return .failure(error)
    }
}

enum HomeFormat {
    /// A new board's name: its day ("Monday’s board"), numbered when the kid has one by that name
    /// already ("Monday’s board 2"), so a day's boards are told apart on Home.
    static func newBoardTitle(day: String, existing: [String] = []) -> String {
        let name = "\(LocalDay.weekdayName(day))’s board"
        let taken = Set(existing.map { $0.trimmingCharacters(in: .whitespaces) })
        guard taken.contains(name) else { return name }
        var n = 2
        while taken.contains("\(name) \(n)") { n += 1 }
        return "\(name) \(n)"
    }

    private static let relative: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        formatter.locale = Locale(identifier: "en_US")
        return formatter
    }()

    /// "Edited just now", "Edited 2 days ago". The server's clock can be a moment ahead of the
    /// iPad's: never "in 3 seconds".
    static func edited(_ date: Date?, now: Date = Date()) -> String {
        guard let date else { return "Not opened yet" }
        let seconds = now.timeIntervalSince(date)
        if seconds < 60 { return "Edited just now" }
        return "Edited \(relative.localizedString(for: date, relativeTo: now))"
    }

    /// "Hi Maya." — or "Hi there." when there is no first name to use (a grown-up's profile is
    /// often called just "Grown-up").
    static func greetingName(_ name: String?) -> String? {
        guard let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty,
              name.caseInsensitiveCompare("Grown-up") != .orderedSame else { return nil }
        // The first word only: "Maya Lopez" is "Maya".
        return name.split(separator: " ").first.map(String.init)
    }
}

/// The tutor's ink as the meter shows it: a level from 0 to 1, never a number on screen.
enum InkLevel {
    /// A plan covers help: always full. Otherwise the balance, in broad steps (the words are what
    /// matter: Lots of ink, Some ink left, Ink is low, Help is paused).
    static func level(_ ink: InkSummary?) -> Double {
        guard let ink else { return 1 }
        if ink.hasUnlimited { return 1 }
        switch ink.tone {
        case .empty: return 0
        case .low: return 0.12
        case .ok: return ink.balance < 300 ? 0.45 : 0.9
        }
    }
}

/// The screen's side margin: 40 on a full iPad, 20 in a narrow window (Split View, Slide Over).
struct ScreenMargin {
    static func horizontal(_ sizeClass: UserInterfaceSizeClass?) -> CGFloat {
        sizeClass == .compact ? DS.Space.l : DS.Space.xxl
    }
}

/// A family member's avatar colour. Avatars are initials on a colour for now (docs/ONBOARDING.md,
/// "Avatar art"): each picture id the server keeps (`FamilyAvatar`) has a Blocks colour, so a kid
/// looks the same on every device. The grown-up is ink. Never cobalt (that is the tutor's).
enum AvatarColor {
    /// The pictures a grown-up picks from for a kid, one per colour.
    static let choices: [(id: String, name: String, rgb: RGB)] = [
        ("fox", "Tomato", DS.Palette.tomato), ("tiger", "Orange", DS.Palette.orange), ("owl", "Sunny", DS.Palette.sunny),
        ("frog", "Green", DS.Palette.green), ("unicorn", "Pink", DS.Palette.pink),
    ]

    static let byAvatar: [String: RGB] = [
        "fox": DS.Palette.tomato, "cat": DS.Palette.tomato, "tiger": DS.Palette.orange, "dog": DS.Palette.orange,
        "penguin": DS.Palette.orange, "owl": DS.Palette.sunny, "lion": DS.Palette.sunny, "frog": DS.Palette.green,
        "koala": DS.Palette.green, "panda": DS.Palette.green, "unicorn": DS.Palette.pink, "rabbit": DS.Palette.pink,
    ]

    static func color(avatar: String?) -> RGB {
        avatar.flatMap { byAvatar[$0] } ?? DS.Palette.tomato
    }

    static func color(for member: FamilyMember, in family: FamilyState?) -> RGB {
        if member.isParent { return DS.Palette.ink }
        return color(avatar: member.avatar)
    }
}
