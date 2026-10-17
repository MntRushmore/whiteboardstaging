import Foundation
import Supabase

/// The signed-in user's profile and ink, read as the user under RLS.
public final class ProfileRepository: Sendable {
    let client: SupabaseClient

    public init(client: SupabaseClient) {
        self.client = client
    }

    /// The signed-in user's profile; nil when the row does not exist yet.
    public func profile() async throws -> Profile? {
        guard let userId = client.auth.currentUser?.id.uuidString.lowercased() else { throw APIError.notSignedIn }
        let response = try await SkewRetry.run {
            try await client.from("profiles")
                .select(Profile.columns)
                .eq("user_id", value: userId)
                .limit(1)
                .execute()
        }
        do {
            return try JSONDecoder().decode([Profile].self, from: response.data).first
        } catch {
            throw APIError.invalidResponse("Profile: \(error)")
        }
    }

    /// The ink balance and the plan (`ink_summary()`, SECURITY DEFINER, the caller's own).
    public func inkSummary() async throws -> InkSummary {
        let response = try await SkewRetry.run {
            try await client.rpc("ink_summary").execute()
        }
        guard let summary = InkSummary.parse(response.data) else {
            throw APIError.invalidResponse("ink_summary: \(String(decoding: response.data.prefix(200), as: UTF8.self))")
        }
        return summary
    }
}
