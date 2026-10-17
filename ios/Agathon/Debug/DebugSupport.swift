import AgathonKit
import SwiftUI
import UIKit

// Phase 0 debug screens (the kit lane): plain, unbranded SwiftUI that proves AgathonKit end to end.
// The brand and screens lanes replace them.

extension AgathonBackend {
    /// For #Preview: production's addresses, a session kept in memory only, never signed in.
    static func preview() -> AgathonBackend {
        AgathonBackend(environment: .production, release: AppRelease(version: "0", build: "preview"),
                       authStorage: InMemoryAuthStorage())
    }
}

/// Which backend this run talks to, in small print (a Debug run may be on the local stack).
struct DebugEnvironmentLine: View {
    @Environment(AgathonBackend.self) private var backend

    var body: some View {
        let env = backend.environment
        Text("API \(env.apiBaseURL.host ?? "?")\(env.apiBaseURL.port.map { ":\($0)" } ?? "") · Supabase \(env.supabaseURL.host ?? "?")\(env.supabaseURL.port.map { ":\($0)" } ?? "") · \(backend.release.string)")
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("debug.environment")
    }
}

/// A board's thumbnail from its `preview` data URL, or a plain placeholder.
struct DebugThumbnail: View {
    let board: BoardSummary

    var body: some View {
        let image = board.previewImage.flatMap { UIImage(data: $0.data) }
        ZStack {
            Rectangle().fill(Color(.secondarySystemBackground))
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "scribble")
                    .font(.title2)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(width: 128, height: 72)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(.separator), lineWidth: 0.5))
        .accessibilityHidden(true)
    }
}

enum DebugFormat {
    static let relative: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter
    }()

    static func edited(_ date: Date?, now: Date = Date()) -> String {
        guard let date else { return "Never edited" }
        // The server's clock can be a moment ahead of the iPad's: never "in 0 seconds".
        if now.timeIntervalSince(date) < 60 { return "Edited just now" }
        return "Edited \(relative.localizedString(for: date, relativeTo: now))"
    }

    static func ink(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0)))
    }
}
