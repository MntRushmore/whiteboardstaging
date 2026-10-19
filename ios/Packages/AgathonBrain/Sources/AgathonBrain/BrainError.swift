import Foundation

/// What can go wrong between Swift and `brain.js`.
public enum BrainError: Error, Equatable, CustomStringConvertible {
    /// `brain.js` is not in the bundle (the package was built without `npm run brain:build`).
    case scriptMissing
    case loadFailed(String)
    /// A call before `load()` succeeded.
    case notLoaded
    /// `brain.js` speaks another API version than these Swift wrappers.
    case apiMismatch(expected: Int, found: Int)
    /// The JavaScript threw outside the brain's own error handling.
    case javaScript(message: String, stack: String?)
    /// The brain refused the call: `bad_args`, `unknown_method`, or `threw` (a bug in the logic).
    case brain(code: String, message: String)
    /// The result did not decode into the Swift type.
    case decoding(method: String, message: String)
    case encoding(method: String, message: String)

    public var description: String {
        switch self {
        case .scriptMissing: "brain.js is missing from the AgathonBrain bundle (run `npm run brain:build`)"
        case .loadFailed(let message): "brain.js failed to load: \(message)"
        case .notLoaded: "the brain is not loaded"
        case .apiMismatch(let expected, let found): "brain.js speaks API \(found), these wrappers speak \(expected)"
        case .javaScript(let message, _): "brain.js threw: \(message)"
        case .brain(let code, let message): "brain refused (\(code)): \(message)"
        case .decoding(let method, let message): "\(method): the result did not decode: \(message)"
        case .encoding(let method, let message): "\(method): the arguments did not encode: \(message)"
        }
    }
}
