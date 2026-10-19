import Foundation
import JavaScriptCore
import os

/// One JavaScriptCore virtual machine and context running `brain.js`, with what plain
/// JavaScriptCore lacks and the bundle may reach for: `console` (to os_log), `performance.now`,
/// `crypto.getRandomValues`, `TextEncoder` and `TextDecoder`.
///
/// Not thread-safe by design: `Brain` (an actor) is its only owner, so every call is serialized.
/// The bundle needs no timers (`setTimeout`), no `structuredClone` and no network: every brain
/// call is synchronous (`scripts/build-ios-brain.mjs` fails the build if browser-only code is
/// reachable), so none are installed — a half-working stand-in would hide a mistake.
final class JSHost {
    private static let log = Logger(subsystem: "app.agathon.Agathon", category: "brain.js")

    let virtualMachine: JSVirtualMachine
    let context: JSContext
    /// The last uncaught exception, taken by `takeException()`.
    private var pending: JSValue?
    private var callFunction: JSValue?
    private let clockOrigin = DispatchTime.now().uptimeNanoseconds

    init() throws {
        guard let vm = JSVirtualMachine(), let context = JSContext(virtualMachine: vm) else {
            throw BrainError.loadFailed("JavaScriptCore could not create a context")
        }
        virtualMachine = vm
        self.context = context
        context.name = "Agathon brain"
        #if DEBUG
        // Safari > Develop > (device) > "Agathon brain": the brain's console and debugger.
        if #available(iOS 16.4, macOS 13.3, *) { context.isInspectable = true }
        #endif
        context.exceptionHandler = { [weak self] _, exception in
            self?.pending = exception
        }
        try installPolyfills()
    }

    // MARK: - loading and calling

    /// Evaluates the bundle; afterwards `AgathonBrain.call` must exist.
    func load(script: String, sourceURL: URL) throws {
        context.evaluateScript(script, withSourceURL: sourceURL)
        try throwIfException(during: "loading brain.js")
        guard let brain = context.objectForKeyedSubscript("AgathonBrain"), !brain.isUndefined,
              let call = brain.objectForKeyedSubscript("call"), !call.isUndefined
        else { throw BrainError.loadFailed("brain.js loaded but defines no AgathonBrain.call") }
        callFunction = call
    }

    /// `AgathonBrain.call(method, argsJSON)`: the JSON envelope it returns.
    func call(_ method: String, argsJSON: String) throws -> String {
        guard let callFunction else { throw BrainError.notLoaded }
        return try autoreleasepool {
            let value = callFunction.call(withArguments: [method, argsJSON])
            try throwIfException(during: method)
            guard let value, value.isString, let text = value.toString() else {
                throw BrainError.javaScript(message: "\(method) returned no JSON", stack: nil)
            }
            return text
        }
    }

    /// JavaScriptCore's public collection hint; in a Debug build (benchmarks) a full, synchronous
    /// collection through its debugging entry point, which a Release build never names.
    func collectGarbage() {
        #if DEBUG
        typealias Collect = @convention(c) (JSContextRef?) -> Void
        if let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "JSSynchronousGarbageCollectForDebugging") {
            unsafeBitCast(symbol, to: Collect.self)(context.jsGlobalContextRef)
            return
        }
        #endif
        JSGarbageCollect(context.jsGlobalContextRef)
    }

    /// Evaluates a snippet (debug and tests).
    func evaluate(_ script: String) throws -> JSValue? {
        let value = context.evaluateScript(script)
        try throwIfException(during: "evaluate")
        return value
    }

    private func throwIfException(during what: String) throws {
        guard let exception = pending else { return }
        pending = nil
        let message = exception.toString() ?? "unknown JavaScript exception"
        let stack = exception.objectForKeyedSubscript("stack")?.toString()
        Self.log.error("brain.js threw during \(what, privacy: .public): \(message, privacy: .public)")
        throw BrainError.javaScript(message: message, stack: stack)
    }

    // MARK: - polyfills

    private func installPolyfills() throws {
        let global = context.globalObject

        // console.* -> os_log, one line per call, arguments joined like a browser's
        let console = JSValue(newObjectIn: context)
        for (name, level) in [("log", OSLogType.default), ("info", .info), ("debug", .debug), ("warn", .error), ("error", .fault)] {
            let block: @convention(block) () -> Void = {
                let parts = (JSContext.currentArguments() as? [JSValue] ?? []).map { $0.toString() ?? "" }
                Self.log.log(level: level, "\(parts.joined(separator: " "), privacy: .public)")
            }
            console?.setObject(block, forKeyedSubscript: name as NSString)
        }
        global?.setObject(console, forKeyedSubscript: "console" as NSString)

        // performance.now(): ms since the context started, monotonic
        let origin = clockOrigin
        let now: @convention(block) () -> Double = {
            Double(DispatchTime.now().uptimeNanoseconds - origin) / 1_000_000
        }
        let performance = JSValue(newObjectIn: context)
        performance?.setObject(now, forKeyedSubscript: "now" as NSString)
        global?.setObject(performance, forKeyedSubscript: "performance" as NSString)

        // random bytes for crypto.getRandomValues
        let randomBytes: @convention(block) (Int) -> [UInt8] = { count in
            var generator = SystemRandomNumberGenerator()
            return (0..<max(0, min(count, 65_536))).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        }
        global?.setObject(randomBytes, forKeyedSubscript: "__agathonRandomBytes" as NSString)

        context.evaluateScript(Self.polyfillScript, withSourceURL: URL(string: "agathon://brain/polyfills.js"))
        try throwIfException(during: "installing polyfills")
    }

    /// The polyfills written in JavaScript: `crypto.getRandomValues` over the Swift random bytes,
    /// and UTF-8 `TextEncoder` / `TextDecoder`.
    private static let polyfillScript = #"""
    (function (g) {
      if (!g.crypto) g.crypto = {};
      if (!g.crypto.getRandomValues) {
        g.crypto.getRandomValues = function (array) {
          if (!array || typeof array.length !== "number" || !array.buffer) throw new TypeError("getRandomValues needs an integer typed array");
          var bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
          if (bytes.length > 65536) throw new Error("QuotaExceededError: at most 65536 bytes");
          var random = g.__agathonRandomBytes(bytes.length);
          for (var i = 0; i < bytes.length; i++) bytes[i] = random[i];
          return array;
        };
      }
      if (!g.TextEncoder) {
        g.TextEncoder = function TextEncoder() {};
        g.TextEncoder.prototype.encoding = "utf-8";
        g.TextEncoder.prototype.encode = function (text) {
          text = text === undefined ? "" : String(text);
          var out = [];
          for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
              var d = text.charCodeAt(i + 1);
              if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
            }
            if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
            if (c < 0x80) out.push(c);
            else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
            else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
          }
          return new Uint8Array(out);
        };
      }
      if (!g.TextDecoder) {
        g.TextDecoder = function TextDecoder() {};
        g.TextDecoder.prototype.encoding = "utf-8";
        g.TextDecoder.prototype.decode = function (input) {
          if (!input) return "";
          var bytes = input instanceof Uint8Array ? input : new Uint8Array(input.buffer || input, input.byteOffset || 0, input.byteLength);
          var s = "";
          for (var i = 0; i < bytes.length; ) {
            var b = bytes[i++], c;
            if (b < 0x80) c = b;
            else if (b >= 0xc0 && b < 0xe0 && i < bytes.length) c = ((b & 31) << 6) | (bytes[i++] & 63);
            else if (b >= 0xe0 && b < 0xf0 && i + 1 < bytes.length) { c = ((b & 15) << 12) | ((bytes[i] & 63) << 6) | (bytes[i + 1] & 63); i += 2; }
            else if (b >= 0xf0 && i + 2 < bytes.length) { c = ((b & 7) << 18) | ((bytes[i] & 63) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); i += 3; }
            else c = 0xfffd;
            if (c > 0xffff) { c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); }
            else s += String.fromCharCode(c);
          }
          return s;
        };
      }
    })(this);
    """#
}
