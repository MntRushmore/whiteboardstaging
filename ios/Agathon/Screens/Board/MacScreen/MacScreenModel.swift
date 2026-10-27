import AgathonKit
import Foundation
import os
import Supabase
import UIKit

/// The Mac screen panel's live link: the signed-in person's private Realtime channel
/// (`screen:<user id>`), where agathon.app/share sends the chosen window as JPEG frames. While the
/// panel is open the iPad listens, puts each frame back together and shows the newest, and says
/// "I'm watching" every few seconds so the Mac shows "Live on your iPad". Nothing is stored.
@MainActor
final class MacScreenModel: ObservableObject {
    /// The newest frame, when one has come.
    @Published private(set) var frame: UIImage?
    @Published private(set) var lastFrameAt: Date?
    @Published private(set) var connected = false

    private var channel: RealtimeChannelV2?
    private var listen: Task<Void, Never>?
    private var ping: Task<Void, Never>?
    private var assembler = MacScreenAssembler()
    private static let log = Logger(subsystem: "app.agathon", category: "mac-screen")

    /// Debug: `-macScreen.stub` shows a made-up frame (no network: the panel's screenshots);
    /// `-macScreen.open` opens the panel when a board opens.
    static var stubbed: Bool { ProcessInfo.processInfo.arguments.contains("-macScreen.stub") }
    static var openAtLaunch: Bool { ProcessInfo.processInfo.arguments.contains("-macScreen.open") }

    /// Whether the Mac is sharing now: a frame within the last few keep-alives.
    func live(now: Date = Date()) -> Bool {
        guard let at = lastFrameAt else { return false }
        return now.timeIntervalSince(at) < 12
    }

    func start(_ backend: AgathonBackend) {
        guard channel == nil, listen == nil else { return }
        if Self.stubbed {
            frame = Self.stubFrame()
            lastFrameAt = Date()
            return
        }
        guard let userId = backend.auth.userId else { return }
        let supabase = backend.supabase
        let channel = supabase.channel(MacScreenChannel.topic(userId: userId)) {
            $0.isPrivate = true
            $0.broadcast.receiveOwnBroadcasts = false
        }
        self.channel = channel
        let frames = channel.broadcastStream(event: MacScreenChannel.frameEvent)
        listen = Task { [weak self] in
            do {
                try await channel.subscribeWithError()
            } catch {
                Self.log.error("mac screen: couldn't join the channel: \(String(describing: error), privacy: .public)")
                return
            }
            await MainActor.run { self?.connected = true }
            for await message in frames {
                guard let chunk = Self.chunk(message) else { continue }
                await MainActor.run { self?.take(chunk) }
            }
        }
        ping = Task {
            while !Task.isCancelled {
                await channel.broadcast(event: MacScreenChannel.viewerEvent, message: ["at": .double(Date().timeIntervalSince1970)])
                try? await Task.sleep(for: .seconds(MacScreenChannel.pingSeconds))
            }
        }
    }

    func stop(_ backend: AgathonBackend) {
        listen?.cancel()
        ping?.cancel()
        listen = nil
        ping = nil
        connected = false
        assembler = MacScreenAssembler()
        if let channel {
            self.channel = nil
            Task { await backend.supabase.removeChannel(channel) }
        }
    }

    private func take(_ chunk: MacScreenChunk) {
        guard let data = assembler.add(chunk), let image = UIImage(data: data) else { return }
        frame = image
        lastFrameAt = Date()
    }

    /// A broadcast's payload as a chunk (the message is `{event, payload, type}`; older servers send
    /// the payload alone).
    nonisolated static func chunk(_ message: JSONObject) -> MacScreenChunk? {
        let payload: JSONObject = message["payload"]?.objectValue ?? message
        guard let data = try? JSONEncoder().encode(payload) else { return nil }
        return try? JSONDecoder().decode(MacScreenChunk.self, from: data)
    }

    /// A stand-in window for the stub: a question as a study site shows it.
    static func stubFrame() -> UIImage {
        let size = CGSize(width: 1280, height: 800)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            UIColor(white: 0.97, alpha: 1).setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            UIColor.white.setFill()
            ctx.fill(CGRect(x: 80, y: 90, width: 1120, height: 620))
            let title: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 30, weight: .semibold), .foregroundColor: UIColor.darkGray]
            let body: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 44, weight: .regular), .foregroundColor: UIColor.black]
            ("Question 7 of 22 · Algebra" as NSString).draw(at: CGPoint(x: 130, y: 140), withAttributes: title)
            ("If 3x − 7 = 2x + 5, what is the value of x?" as NSString).draw(at: CGPoint(x: 130, y: 240), withAttributes: body)
            for (i, choice) in ["A) 2", "B) 7", "C) 12", "D) 17"].enumerated() {
                (choice as NSString).draw(at: CGPoint(x: 160, y: 360 + CGFloat(i) * 80), withAttributes: body)
            }
        }
    }
}
