import Foundation
import Supabase

/// What a failed call says to the person holding the iPad: plain, kind words, never a server's raw
/// answer. Production sits behind Cloudflare, which swaps a 502/504 body for its own HTML page, and
/// supabase-swift's own errors read that body out whole ("Status Code: 502 Body: <!DOCTYPE html>…");
/// PostgREST's carry Postgres's own message. None of that is for people.
public enum ErrorWords {
    public static let offline = "Can't reach Agathon. Check the Wi-Fi, then try again."
    public static let server = HTTPFailure.serverWords
    public static let fallback = "Something got in the way. Try again in a moment."

    public static func message(for error: Error) -> String {
        if error is URLError { return offline }
        if let api = error as? APIError { return api.errorDescription ?? fallback }
        if let http = error as? HTTPError {
            // a Supabase call's non-2xx (PostgREST, Storage, Functions)
            return HTTPFailure(response: http.response, body: http.data).status >= 500
                ? server : (http.response.statusCode == 401 ? HTTPFailure.plainWords(status: 401) : fallback)
        }
        if error is PostgrestError || error is DecodingError { return fallback }
        if error is AuthError { return AuthService.message(for: error) }
        if let error = error as? LocalizedError, let text = error.errorDescription, isWrittenForPeople(text) { return text }
        return fallback
    }

    /// Words a person can read: short, no markup, no status lines, no stack of codes.
    public static func isWrittenForPeople(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, t.count <= 240 else { return false }
        let raw = ["<", "Status Code", "Body:", "Error Domain=", "{\"", "PGRST", "SQLSTATE", "Optional("]
        return !raw.contains { t.contains($0) }
    }
}
