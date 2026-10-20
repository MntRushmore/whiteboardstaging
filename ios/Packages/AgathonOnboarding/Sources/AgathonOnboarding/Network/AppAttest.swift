import CryptoKit
import DeviceCheck
import Foundation

/// Proves to the server that a request before the account comes from this app on a real iPad
/// (Apple App Attest), so the pre-account routes (`/api/try/check`, `/api/try/help`,
/// `/api/start/step`) can serve the app without a session and without opening up to scripts.
///
/// The server's contract (src/lib/server/appAttest):
///  - `POST /api/app/attest/challenge` → `{ challenge }`; the attestation's clientDataHash is
///    SHA-256 of the challenge's UTF-8 bytes; `POST /api/app/attest/register { keyId, attestation,
///    challenge }` stores the key (base64 strings).
///  - every request then carries `X-Agathon-App-Key` and `X-Agathon-App-Assertion`, an assertion
///    over SHA-256 of the exact body bytes (the counter in it stops a replay).
///  - A simulator cannot attest: it sends `X-Agathon-App-Debug: <a uuid kept on the device>`, which
///    only a server that is not production accepts.
public actor AppAttestor {
    public enum Headers {
        public static let key = "X-Agathon-App-Key"
        public static let assertion = "X-Agathon-App-Assertion"
        public static let debug = "X-Agathon-App-Debug"
    }

    public enum Paths {
        public static let challenge = "/api/app/attest/challenge"
        public static let register = "/api/app/attest/register"
    }

    /// Posts a JSON body to an API path with no session; answers the status and body.
    public typealias Post = @Sendable (_ path: String, _ body: Data, _ headers: [String: String]) async throws -> (Int, Data)

    private let post: Post
    private let defaults: UserDefaults
    private let host: String
    /// The simulator's debug header may be sent (never to production, which refuses it anyway).
    private let allowsDebugHeader: Bool
    private let service: DCAppAttestService
    private var registering: Task<String, Error>?

    static let keyIdKey = "agathon.appattest.keyId"
    static let registeredKey = "agathon.appattest.registered"
    static let deviceKey = "agathon.appattest.device"

    /// `host`: the API's host, so a key registered with one server is registered again with another
    /// (the local stack and production). `allowsDebugHeader`: a device that cannot attest (the
    /// simulator) may send the debug header; false for production, where the call fails instead.
    public init(host: String, allowsDebugHeader: Bool = true, defaults: UserDefaults = .standard, post: @escaping Post) {
        self.host = host
        self.allowsDebugHeader = allowsDebugHeader
        self.defaults = defaults
        self.post = post
        service = DCAppAttestService.shared
    }

    /// The device can attest (a real iPad; never the simulator).
    public nonisolated var isSupported: Bool {
        #if targetEnvironment(simulator)
        false
        #else
        DCAppAttestService.shared.isSupported
        #endif
    }

    /// The headers that prove `body` came from this app.
    public func headers(for body: Data) async throws -> [String: String] {
        guard isSupported else {
            // production never takes the debug header: no point sending a device id it would refuse
            guard allowsDebugHeader else { throw TryCheckError.cannotAttest }
            return [Headers.debug: deviceId()]
        }
        let keyId: String
        do {
            keyId = try await registeredKey()
        } catch let error as DCError where error.code == .featureUnsupported {
            throw TryCheckError.cannotAttest
        }
        let hash = Data(SHA256.hash(data: body))
        do {
            let assertion = try await service.generateAssertion(keyId, clientDataHash: hash)
            return [Headers.key: keyId, Headers.assertion: assertion.base64EncodedString()]
        } catch let error as DCError where error.code == .invalidKey {
            // the key is gone (a restore onto another device): start again with a new one
            forgetKey()
            let fresh = try await registeredKey()
            let assertion = try await service.generateAssertion(fresh, clientDataHash: hash)
            return [Headers.key: fresh, Headers.assertion: assertion.base64EncodedString()]
        }
    }

    /// The server no longer knows the key (`reason: attest_unknown_key`): register it again next time.
    public func serverForgotKey() {
        defaults.removeObject(forKey: registeredFlag)
    }

    /// Registers the key ahead of the first check (the hand-off screen warms it).
    public func warmUp() async {
        guard isSupported else { return }
        _ = try? await registeredKey()
    }

    // MARK: - private

    private var registeredFlag: String { "\(Self.registeredKey).\(host)" }

    private func deviceId() -> String {
        if let id = defaults.string(forKey: Self.deviceKey) { return id }
        let id = UUID().uuidString.lowercased()
        defaults.set(id, forKey: Self.deviceKey)
        return id
    }

    private func forgetKey() {
        defaults.removeObject(forKey: Self.keyIdKey)
        defaults.removeObject(forKey: registeredFlag)
    }

    private func registeredKey() async throws -> String {
        if let keyId = defaults.string(forKey: Self.keyIdKey), defaults.bool(forKey: registeredFlag) { return keyId }
        if let registering { return try await registering.value }
        let task = Task { try await self.register() }
        registering = task
        defer { registering = nil }
        return try await task.value
    }

    private func register() async throws -> String {
        let keyId: String
        if let kept = defaults.string(forKey: Self.keyIdKey) {
            keyId = kept
        } else {
            keyId = try await service.generateKey()
            defaults.set(keyId, forKey: Self.keyIdKey)
        }
        let (status, data) = try await post(Paths.challenge, Data("{}".utf8), [:])
        guard status == 200, let challenge = (try? JSONDecoder().decode(Challenge.self, from: data))?.challenge else {
            throw TryCheckError.refused("challenge \(status)")
        }
        let attestation: Data
        do {
            attestation = try await service.attestKey(keyId, clientDataHash: Data(SHA256.hash(data: Data(challenge.utf8))))
        } catch let error as DCError where error.code == .invalidKey {
            // attested once already (or gone): a new key
            forgetKey()
            throw TryCheckError.refused("attest key invalid")
        }
        let body = try JSONEncoder().encode(Register(keyId: keyId, attestation: attestation.base64EncodedString(), challenge: challenge))
        let (registered, _) = try await post(Paths.register, body, [:])
        guard registered == 200 || registered == 201 else { throw TryCheckError.refused("register \(registered)") }
        defaults.set(true, forKey: registeredFlag)
        return keyId
    }

    private struct Challenge: Decodable { let challenge: String }
    private struct Register: Encodable {
        let keyId: String
        let attestation: String
        let challenge: String
    }
}
