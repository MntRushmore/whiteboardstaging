import Foundation
import Supabase

/// Session storage that forgets everything when the process ends: for tests, previews and the
/// integration test. The app uses the Keychain (supabase-swift's default).
public final class InMemoryAuthStorage: AuthLocalStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]

    public init() {}

    public func store(key: String, value: Data) throws {
        lock.withLock { values[key] = value }
    }

    public func retrieve(key: String) throws -> Data? {
        lock.withLock { values[key] }
    }

    public func remove(key: String) throws {
        lock.withLock { _ = values.removeValue(forKey: key) }
    }
}
