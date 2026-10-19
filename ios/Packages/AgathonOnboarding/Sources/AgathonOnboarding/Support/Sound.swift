import AVFoundation
import Foundation

/// Wood and bells (docs/ONBOARDING.md, "Sound"): a marimba tap for a choice, two notes stepping up
/// for a tick, a short xylophone run for the plan, one soft woodblock for "Look again". Synthesised
/// once into buffers (no audio files to license), played on an `.ambient` session so the mute switch
/// and the kid's own music are respected.
@MainActor
public final class OnboardingSound {
    public enum Cue: CaseIterable {
        case tap, tick, run, woodblock, rise
    }

    public static let shared = OnboardingSound()

    private var engine: AVAudioEngine?
    private var players: [AVAudioPlayerNode] = []
    private var next = 0
    private var buffers: [Cue: AVAudioPCMBuffer] = [:]
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)
    /// Off in tests and screenshots.
    public var isEnabled = !ProcessInfo.processInfo.arguments.contains("-onboardingMute")

    public func play(_ cue: Cue) {
        guard isEnabled else { return }
        if engine == nil { start() }
        guard let engine, engine.isRunning, let buffer = buffer(cue), !players.isEmpty else { return }
        let player = players[next % players.count]
        next += 1
        player.scheduleBuffer(buffer, at: nil, options: .interrupts)
        if !player.isPlaying { player.play() }
    }

    private func start() {
        guard let format else { return }
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        let engine = AVAudioEngine()
        for _ in 0..<3 {
            let p = AVAudioPlayerNode()
            engine.attach(p)
            engine.connect(p, to: engine.mainMixerNode, format: format)
            players.append(p)
        }
        engine.mainMixerNode.outputVolume = 0.55
        do {
            try engine.start()
            self.engine = engine
        } catch {
            players = []
        }
    }

    private func buffer(_ cue: Cue) -> AVAudioPCMBuffer? {
        if let b = buffers[cue] { return b }
        let notes: [Note]
        switch cue {
        case .tap: notes = [Note(f: 1046.5, at: 0, decay: 0.09, gain: 0.5)]
        case .tick: notes = [Note(f: 659.3, at: 0, decay: 0.11, gain: 0.45), Note(f: 987.8, at: 0.09, decay: 0.16, gain: 0.5)]
        case .rise: notes = [Note(f: 523.3, at: 0, decay: 0.1, gain: 0.35), Note(f: 659.3, at: 0.12, decay: 0.1, gain: 0.38), Note(f: 784.0, at: 0.24, decay: 0.14, gain: 0.42)]
        case .run:
            let scale: [Double] = [1046.5, 1174.7, 1318.5, 1568.0, 1760.0, 2093.0]
            notes = scale.enumerated().map { i, f in Note(f: f, at: Double(i) * 0.055, decay: 0.12, gain: 0.32, bright: true) }
        case .woodblock: notes = [Note(f: 760, at: 0, decay: 0.035, gain: 0.45, wood: true)]
        }
        let b = render(notes)
        buffers[cue] = b
        return b
    }

    private struct Note {
        var f: Double
        var at: Double
        var decay: Double
        var gain: Double
        var bright = false
        var wood = false
    }

    private func render(_ notes: [Note]) -> AVAudioPCMBuffer? {
        guard let format else { return nil }
        let rate = format.sampleRate
        let length = (notes.map { $0.at + $0.decay * 7 }.max() ?? 0.3) + 0.02
        let frames = AVAudioFrameCount(length * rate)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames), let data = buffer.floatChannelData?[0] else { return nil }
        buffer.frameLength = frames
        for i in 0..<Int(frames) { data[i] = 0 }
        var seed: UInt32 = 7
        for n in notes {
            let start = Int(n.at * rate)
            for i in start..<Int(frames) {
                let t = Double(i - start) / rate
                let env = (t < 0.002 ? t / 0.002 : 1) * exp(-t / n.decay)
                guard env > 0.0005 else { break }
                var s: Double
                if n.wood {
                    // a hollow knock: two inharmonic partials and a breath of noise, gone in a blink
                    seed = seed &* 1_664_525 &+ 1_013_904_223
                    let noise = Double(seed >> 9) / Double(1 << 23) - 1
                    s = sin(2 * .pi * n.f * t) + 0.6 * sin(2 * .pi * n.f * 2.32 * t) + 0.25 * noise * exp(-t / 0.008)
                } else {
                    // a marimba bar: the fundamental and its fourth partial (about 3.9 ×), which dies first
                    s = sin(2 * .pi * n.f * t) + 0.22 * sin(2 * .pi * n.f * 3.93 * t) * exp(-t / (n.decay * 0.35))
                    if n.bright { s += 0.18 * sin(2 * .pi * n.f * 3 * t) * exp(-t / (n.decay * 0.5)) }
                }
                data[i] += Float(s * env * n.gain * 0.6)
            }
        }
        return buffer
    }
}
