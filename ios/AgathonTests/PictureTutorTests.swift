import AgathonAsk
import AgathonBoard
import AgathonKit
import AgathonLive
import CoreGraphics
import Foundation
import Testing
import UIKit
@testable import Agathon

/// The picture tutor: its trigger and cancel (pen lift → quiet → send; a new stroke cancels; the same
/// picture isn't sent twice), the ghost's Accept / Reject, the region R and where the picture lands at
/// any zoom and pan, what counts as the kid's edit, the reveal, and the switch off = the app as it was.
@MainActor
@Suite(.serialized)
struct PictureTutorTests {
    // MARK: fakes

    /// Timers the test fires by hand.
    @MainActor
    final class ManualClock {
        final class Timer: PictureTimer {
            let seconds: Double
            let fn: @MainActor () -> Void
            var cancelled = false
            init(_ seconds: Double, _ fn: @escaping @MainActor () -> Void) {
                self.seconds = seconds
                self.fn = fn
            }
            func cancel() { cancelled = true }
        }

        var timers: [Timer] = []
        var live: [Timer] { timers.filter { !$0.cancelled } }

        func schedule(_ s: Double, _ fn: @escaping @MainActor () -> Void) -> PictureTimer {
            let t = Timer(s, fn)
            timers.append(t)
            return t
        }

        /// Fires the live timers of `seconds` (the quiet: 0.8).
        func fire(_ seconds: Double) {
            for t in live where t.seconds == seconds {
                t.cancelled = true
                t.fn()
            }
        }
    }

    /// The server, driven by the test: each request opens a stream the test feeds.
    @MainActor
    final class FakeServer {
        var requests: [BoardDrawRequest] = []
        var streams: [AsyncThrowingStream<BoardDrawEvent, Error>.Continuation] = []
        var terminated = 0
        var reports: [(String, BoardDrawOutcome)] = []

        func draw(_ r: BoardDrawRequest) -> AsyncThrowingStream<BoardDrawEvent, Error> {
            requests.append(r)
            let (stream, c) = AsyncThrowingStream<BoardDrawEvent, Error>.makeStream()
            c.onTermination = { [weak self] _ in Task { @MainActor in self?.terminated += 1 } }
            streams.append(c)
            return stream
        }

        func send(_ e: BoardDrawEvent) {
            streams.last?.yield(e)
            if e.isTerminal { streams.last?.finish() }
        }
    }

    static func image(_ w: Int = 8, _ h: Int = 6, color: CGColor = CGColor(gray: 1, alpha: 1)) -> CGImage {
        let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(color)
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage()!
    }

    static func capture(hash: String) -> PictureCapture {
        let img = image()
        return PictureCapture(region: Box(x: 0, y: 0, w: 1600, h: 900), screen: "screen:1", png: PictureTutorCapture.png(img)!, image: img,
                              hash: hash, blank: nil, ink: nil)
    }

    @MainActor
    final class Harness {
        final class State {
            var hash = "a"
            var captures = 0
            var accepted: [PictureTutor.Shown] = []
            var acceptSucceeds = true
        }

        let clock = ManualClock()
        let server = FakeServer()
        let state = State()
        let tutor: PictureTutor
        let log: PictureTutorLog

        var hash: String {
            get { state.hash }
            set { state.hash = newValue }
        }
        var captures: Int { state.captures }
        var accepted: [PictureTutor.Shown] { state.accepted }
        var acceptSucceeds: Bool {
            get { state.acceptSucceeds }
            set { state.acceptSucceeds = newValue }
        }

        @MainActor init(mode: PictureTutorMode = .suggest) {
            let suite = UserDefaults(suiteName: "picture-tests-\(UUID().uuidString)")!
            log = PictureTutorLog(defaults: suite)
            let clock = self.clock, server = self.server, state = self.state
            let deps = PictureTutor.Deps(
                capture: {
                    state.captures += 1
                    return PictureTutorTests.capture(hash: state.hash)
                },
                draw: { server.draw($0) },
                report: { id, outcome in await MainActor.run { server.reports.append((id, outcome)) } },
                accept: { shown in
                    state.accepted.append(shown)
                    return state.acceptSucceeds
                },
                schedule: { clock.schedule($0, $1) })
            tutor = PictureTutor(mode: mode, boardId: "b1", deps: deps, log: log)
        }
    }

    /// Lets the tutor's tasks run.
    static func settle() async {
        for _ in 0..<20 { await Task.yield() }
        try? await Task.sleep(for: .milliseconds(20))
        for _ in 0..<20 { await Task.yield() }
    }

    static var donePNG: Data { PictureTutorCapture.png(image())! }

    static func done(strokes: [BoardDrawStroke] = [BoardDrawStroke(points: [0, 0, 4, 3], width: 1)]) -> BoardDrawEvent {
        .done(BoardDrawResult(overlay: donePNG, width: 8, height: 6, strokes: strokes))
    }

    // MARK: trigger and cancel

    @Test func penLiftWaitsForQuietThenSends() async {
        let h = Harness()
        h.tutor.noteEdit()
        #expect(h.tutor.phase == .waiting)
        #expect(h.clock.live.map(\.seconds) == [PictureTutorSettings.quietDelay])
        #expect(h.server.requests.isEmpty)
        h.clock.fire(PictureTutorSettings.quietDelay)
        await Self.settle()
        #expect(h.server.requests.count == 1)
        #expect(h.server.requests[0].mode == .suggest)
        #expect(h.server.requests[0].source == .auto)
        #expect(h.server.requests[0].boardId == "b1")
        #expect(h.server.requests[0].image.hasPrefix("data:image/png;base64,"))
        #expect(h.tutor.phase == .working(.reading))
        #expect(h.tutor.work != nil)
        h.server.send(.status(.reading, runId: "r1", instructions: nil))
        h.server.send(.status(.drawing, runId: nil, instructions: "x"))
        await Self.settle()
        #expect(h.tutor.phase == .working(.drawing))
    }

    @Test func theQuietIsHeldWhileThePenIsDown() async {
        let h = Harness()
        h.tutor.noteEdit()
        h.tutor.notePen(true)
        #expect(h.clock.live.isEmpty)
        h.tutor.notePen(false)
        #expect(h.clock.live.count == 1)
        h.clock.fire(PictureTutorSettings.quietDelay)
        await Self.settle()
        #expect(h.server.requests.count == 1)
    }

    @Test func aNewStrokeCancelsTheRunInFlight() async {
        let h = Harness()
        h.tutor.noteEdit()
        h.clock.fire(PictureTutorSettings.quietDelay)
        await Self.settle()
        h.server.send(.status(.reading, runId: "r1", instructions: nil))
        await Self.settle()
        // the kid writes again
        h.hash = "b"
        h.tutor.noteEdit()
        await Self.settle()
        #expect(h.server.terminated == 1, "the request was cancelled")
        #expect(h.server.reports.contains { $0.0 == "r1" && $0.1 == .cancelled })
        #expect(h.tutor.phase == .waiting)
        #expect(h.tutor.work == nil)
        // a late event of the cancelled run changes nothing
        h.server.streams[0].yield(.status(.drawing, runId: nil, instructions: nil))
        await Self.settle()
        #expect(h.tutor.phase == .waiting)
        // the quiet again, then the new picture
        h.clock.fire(PictureTutorSettings.quietDelay)
        await Self.settle()
        #expect(h.server.requests.count == 2)
        #expect(h.log.runs.first?.outcome == .running)
        #expect(h.log.runs.dropFirst().first?.outcome == .cancelled)
    }

    @Test func theSamePictureIsNotSentTwice() async {
        let h = Harness()
        h.tutor.noteEdit()
        h.clock.fire(PictureTutorSettings.quietDelay)
        await Self.settle()
        h.server.send(.none(reason: "fine"))
        await Self.settle()
        #expect(h.tutor.phase == .idle)
        // a change that leaves the same picture (a stroke drawn and undone)
        h.tutor.noteEdit()
        h.clock.fire(PictureTutorSettings.quietDelay)
        await Self.settle()
        #expect(h.server.requests.count == 1)
        #expect(h.tutor.phase == .idle)
        #expect(h.captures == 2)
        // a different picture goes
        h.hash = "c"
        h.tutor.noteEdit()
        h.clock.fire(PictureTutorSettings.quietDelay)
        await Self.settle()
        #expect(h.server.requests.count == 2)
    }

    @Test func drawNowAlwaysSendsAndTakesOver() async {
        let h = Harness()
        h.tutor.noteEdit()
        h.clock.fire(PictureTutorSettings.quietDelay)
        await Self.settle()
        // the same picture, asked for: it goes, and the auto run in flight is cancelled
        h.tutor.drawNow()
        await Self.settle()
        #expect(h.server.requests.count == 2)
        #expect(h.server.requests[1].source == .voice)
        #expect(h.server.terminated == 1)
    }

    @Test func offSendsNothing() async {
        let h = Harness(mode: .off)
        h.tutor.noteEdit()
        #expect(h.tutor.phase == .idle)
        #expect(h.clock.live.isEmpty)
        h.tutor.drawNow()
        await Self.settle()
        #expect(h.server.requests.isEmpty)
    }

    @Test func aFailureLeavesNothingOnTheBoardAndShakesDrawNow() async {
        let h = Harness()
        h.tutor.drawNow()
        await Self.settle()
        h.server.send(.error(message: "upstream", retryable: true))
        await Self.settle()
        #expect(h.tutor.phase == .idle)
        #expect(h.tutor.shown == nil)
        #expect(h.tutor.drawNowShake == 1)
        #expect(h.tutor.penExit != nil, "the pen lifts away")
        #expect(h.log.runs.first?.outcome == .error)
        // an auto run's failure: quiet
        h.hash = "z"
        h.tutor.noteEdit()
        h.clock.fire(PictureTutorSettings.quietDelay)
        await Self.settle()
        h.server.streams.last?.finish(throwing: APIError.http(HTTPFailure(status: 429, code: "rate_limited", message: "slow")))
        await Self.settle()
        #expect(h.tutor.drawNowShake == 1)
    }

    // MARK: the picture

    @Test func suggestIsAGhostToAcceptOrReject() async throws {
        let h = Harness(mode: .suggest)
        h.tutor.drawNow()
        await Self.settle()
        h.server.send(.status(.reading, runId: "r1", instructions: nil))
        h.server.send(Self.done())
        await Self.settle()
        let shown = try #require(h.tutor.shown)
        #expect(shown.state == .revealing)
        #expect(shown.opacity == PictureReveal.ghostOpacity)
        #expect(shown.region == Box(x: 0, y: 0, w: 1600, h: 900))
        #expect(h.tutor.phase == .idle)
        // the reveal ends: a ghost, the pen leaves
        let reveal = try #require(h.clock.live.first { $0.seconds == shown.revealDuration })
        reveal.cancelled = true
        reveal.fn()
        #expect(h.tutor.shown?.state == .ghost)
        #expect(h.tutor.penExit != nil)
        h.tutor.accept()
        #expect(h.tutor.shown?.state == .accepting)
        #expect(h.tutor.shown?.opacity == 1)
        await Self.settle()
        #expect(h.accepted.count == 1)
        #expect(h.tutor.shown == nil, "it's on the board now")
        #expect(h.server.reports.contains { $0.0 == "r1" && $0.1 == .accepted })
        #expect(h.log.runs.first?.outcome == .accepted)
    }

    @Test func rejectRemovesIt() async {
        let h = Harness(mode: .answer)
        h.tutor.drawNow()
        await Self.settle()
        h.server.send(.status(.reading, runId: "r2", instructions: nil))
        h.server.send(Self.done())
        await Self.settle()
        h.clock.fire(h.tutor.shown!.revealDuration)
        h.tutor.reject()
        await Self.settle()
        #expect(h.tutor.shown == nil)
        #expect(h.server.reports.contains { $0.0 == "r2" && $0.1 == .rejected })
        #expect(h.accepted.isEmpty)
    }

    @Test func anAcceptThatCannotBeSavedStaysAGhost() async {
        let h = Harness()
        h.acceptSucceeds = false
        h.tutor.drawNow()
        await Self.settle()
        h.server.send(Self.done(strokes: []))
        await Self.settle()
        h.clock.fire(h.tutor.shown!.revealDuration)
        h.tutor.accept()
        await Self.settle()
        #expect(h.tutor.shown?.state == .ghost)
    }

    @Test func aNewResultReplacesAnUndecidedGhost() async {
        let h = Harness()
        h.tutor.drawNow()
        await Self.settle()
        h.server.send(.status(.reading, runId: "r1", instructions: nil))
        h.server.send(Self.done())
        await Self.settle()
        let first = h.tutor.shown?.id
        h.hash = "next"
        h.tutor.noteEdit()
        h.clock.fire(PictureTutorSettings.quietDelay)
        await Self.settle()
        // the ghost stays while the next one is worked on
        #expect(h.tutor.shown?.id == first)
        h.server.send(.status(.reading, runId: "r2", instructions: nil))
        h.server.send(Self.done())
        await Self.settle()
        #expect(h.tutor.shown?.id != first)
        #expect(h.tutor.shown?.runId == "r2")
        #expect(h.server.reports.contains { $0.0 == "r1" && $0.1 == .cancelled })
    }

    @Test func feedbackIsShownAtOnceAndReported() async {
        let h = Harness(mode: .feedback)
        h.tutor.drawNow()
        await Self.settle()
        h.server.send(.status(.reading, runId: "r3", instructions: nil))
        h.server.send(Self.done())
        await Self.settle()
        #expect(h.tutor.shown?.opacity == 1)
        h.clock.fire(h.tutor.shown!.revealDuration)
        #expect(h.tutor.shown?.state == .shown)
        #expect(h.server.reports.contains { $0.0 == "r3" && $0.1 == .shown })
    }

    @Test func aPageChangeDropsTheRunAndThePicture() async {
        let h = Harness()
        h.tutor.drawNow()
        await Self.settle()
        h.server.send(.status(.reading, runId: "r1", instructions: nil))
        h.server.send(Self.done())
        await Self.settle()
        h.tutor.screenChanged()
        await Self.settle()
        #expect(h.tutor.shown == nil)
        #expect(h.tutor.phase == .idle)
    }

    // MARK: the reveal

    @Test func revealTiming() {
        let short = [BoardDrawStroke(points: [0, 0, 100, 0], width: 3)]
        let long = [BoardDrawStroke(points: [0, 0, 100_000, 0], width: 3)]
        #expect(PictureReveal.duration(short, reduceMotion: false) >= 1.2)
        #expect(PictureReveal.duration(short, reduceMotion: false) < 1.3)
        #expect(abs(PictureReveal.duration(long, reduceMotion: false) - 1.8) < 1e-9)
        #expect(PictureReveal.duration(long, reduceMotion: false) <= 2)
        #expect(PictureReveal.duration([], reduceMotion: false) == PictureReveal.fade)
        #expect(PictureReveal.duration(long, reduceMotion: true) == 0)
        #expect(PictureReveal.maskWidth(BoardDrawStroke(points: [], width: 1)) == 6)
        #expect(PictureReveal.maskWidth(BoardDrawStroke(points: [], width: 4)) == 10)
    }

    @Test func revealDrawsStrokesInOrder() {
        let strokes = [BoardDrawStroke(points: [0, 0, 10, 0], width: 2), BoardDrawStroke(points: [0, 10, 10, 10], width: 2)]
        let quarter = PictureReveal.partial(strokes, progress: 0.25)
        #expect(quarter.lines.count == 1)
        #expect(quarter.tip == CGPoint(x: 5, y: 0))
        let three = PictureReveal.partial(strokes, progress: 0.75)
        #expect(three.lines.count == 2)
        #expect(three.tip == CGPoint(x: 5, y: 10))
        #expect(PictureReveal.partial(strokes, progress: 1).tip == CGPoint(x: 10, y: 10))
    }

    // MARK: geometry

    @Test func regionIsWhatIsVisibleOfThePage() throws {
        let screen = Box.screen
        let size = CGSize(width: 1194, height: 834)
        // fitted: the whole page (the view's bands around it are not the page)
        let fit = CameraConstraints().fit(screen, in: size)
        #expect(PictureTutorGeometry.region(camera: fit, viewSize: size, screen: screen, margin: 0) == screen)
        // zoomed 2× about the middle: the middle half of the page
        let zoomed = Camera(scale: fit.scale * 2, offset: Vec2(size.width / 2 - 800 * fit.scale * 2, size.height / 2 - 450 * fit.scale * 2))
        let r = try #require(PictureTutorGeometry.region(camera: zoomed, viewSize: size, screen: screen, margin: 0))
        #expect(abs(r.midXForTest - 800) < 0.001)
        #expect(abs(r.w - size.width / (fit.scale * 2)) < 0.001)
        // a margin grows it on every side
        let m = try #require(PictureTutorGeometry.region(camera: zoomed, viewSize: size, screen: screen, margin: 0.1))
        #expect(abs(m.w - r.w * 1.2) < 0.001 && abs(m.h - r.h * 1.2) < 0.001)
        #expect(abs(m.x - (r.x - r.w * 0.1)) < 0.001)
        // panned off the page entirely: nothing
        #expect(PictureTutorGeometry.region(camera: Camera(scale: 1, offset: Vec2(5000, 0)), viewSize: size, screen: screen, margin: 0) == nil)
    }

    @Test func pixelSizeKeepsTheLongSideAt1440() {
        #expect(PictureTutorGeometry.pixelSize(for: Box.screen) == (1440, 810))
        #expect(PictureTutorGeometry.pixelSize(for: Box(x: 0, y: 0, w: 450, h: 800)) == (810, 1440))
    }

    /// R → the picture's pixels → the page → the screen, at any zoom and pan: a pixel of the overlay
    /// lands on the page point it was captured from.
    @Test(arguments: [(1.0, 0.0, 0.0), (2.0, -300.0, -120.0), (3.7, -2100.0, -900.0)])
    func overlayLandsWhereItWasCaptured(zoom: Double, dx: Double, dy: Double) throws {
        let size = CGSize(width: 1194, height: 834)
        let base = CameraConstraints().fit(.screen, in: size)
        let camera = Camera(scale: base.scale * zoom, offset: Vec2(base.offset.x * zoom + dx, base.offset.y * zoom + dy))
        let region = try #require(PictureTutorGeometry.region(camera: camera, viewSize: size, screen: .screen, margin: 0))
        let px = PictureTutorGeometry.pixelSize(for: region)
        let imageSize = CGSize(width: px.width, height: px.height)
        // the picture's corners are R's
        let tl = PictureTutorGeometry.pagePoint(.zero, imageSize: imageSize, region: region)
        let br = PictureTutorGeometry.pagePoint(CGPoint(x: px.width, y: px.height), imageSize: imageSize, region: region)
        #expect(abs(tl.x - region.x) < 1e-9 && abs(tl.y - region.y) < 1e-9)
        #expect(abs(br.x - region.maxX) < 1e-9 && abs(br.y - region.maxY) < 1e-9)
        // a page point inside R: to pixels (as the renderer maps it) and back to the page, then to the screen
        let p = Vec2(region.x + region.w * 0.37, region.y + region.h * 0.61)
        let k = Double(px.width) / region.w
        let pixel = CGPoint(x: (p.x - region.x) * k, y: (p.y - region.y) * Double(px.height) / region.h)
        let back = PictureTutorGeometry.pagePoint(pixel, imageSize: imageSize, region: region)
        #expect(abs(back.x - p.x) < 1e-6 && abs(back.y - p.y) < 1e-6)
        let onScreen = PictureTutorGeometry.viewPoint(pixel, imageSize: imageSize, region: region, camera: camera)
        let expected = camera.toView(p)
        #expect(abs(onScreen.x - expected.x) < 1e-6 && abs(onScreen.y - expected.y) < 1e-6)
        // the overlay's frame on screen is R's
        let frame = PictureTutorGeometry.viewRect(region, camera: camera)
        let a = camera.toView(Vec2(region.x, region.y))
        #expect(abs(frame.minX - a.x) < 1e-9 && abs(frame.width - region.w * camera.scale) < 1e-9)
        // what is visible of the page fills the view where the page does
        #expect(frame.minX >= -1e-6 || region.x == 0)
    }

    @Test func captureRendersTheKidsWorkOnWhiteWithoutTheTutorsPictures() async throws {
        let controller = BoardController()
        let canvas = BoardCanvasView(controller: controller)
        canvas.frame = CGRect(x: 0, y: 0, width: 1194, height: 834)
        canvas.layoutIfNeeded()
        let screen = controller.currentScreenID
        // nothing on the page: nothing to send
        #expect(await PictureTutorCapture.capture(controller: controller) == nil)
        controller.store.put(.stroke(StrokeRecord(screen: screen, order: controller.store.nextOrder(on: screen), author: .kid, color: .black, width: 6,
                                                  pressure: .simulated, x: 200, y: 200, points: [InkPoint(x: 0, y: 0), InkPoint(x: 300, y: 40)], start: 0)), origin: .kid)
        let a = try #require(await PictureTutorCapture.capture(controller: controller))
        #expect(a.region == .screen)
        #expect(a.image.width == 1440 && a.image.height == 810)
        #expect(a.ink != nil)
        let blank = try #require(a.blank)
        #expect(!blank.intersects(try #require(a.ink)), "the blank space is clear of the ink")
        #expect(blank.width * blank.height > 1440 * 810 * 0.3)
        // an accepted picture on the page changes nothing in the capture
        controller.store.put(.image(ImageRecord(screen: screen, order: controller.store.nextOrder(on: screen), author: .tutor, x: 0, y: 0, w: 1600, h: 900,
                                                asset: AssetRef(src: "data:image/png;base64,\(PictureTutorCapture.png(Self.image(4, 4, color: CGColor(gray: 0, alpha: 1)))!.base64EncodedString())"),
                                                meta: PictureTutorCapture.meta(runId: "r", mode: .suggest))), origin: .kid)
        let b = try #require(await PictureTutorCapture.capture(controller: controller))
        #expect(b.hash == a.hash)
    }

    // MARK: the board

    @Test func onlyTheKidsChangesCount() {
        let screen: RecordID = "screen:1"
        let stroke = BoardRecord.stroke(StrokeRecord(screen: screen, order: OrderKey.first, author: .kid, color: .black, width: 6, pressure: .simulated, points: []))
        let picture = BoardRecord.image(ImageRecord(screen: screen, order: OrderKey.first, author: .tutor, x: 0, y: 0, w: 1, h: 1, asset: AssetRef(src: ""),
                                                    meta: PictureTutorCapture.meta(runId: nil, mode: .suggest)))
        func change(_ origin: ChangeOrigin, added: [BoardRecord] = [], removed: [BoardRecord] = []) -> ChangeSet {
            var c = ChangeSet(origin: origin)
            for r in added { c.added[r.id] = r }
            for r in removed { c.removed[r.id] = r }
            return c
        }
        #expect(PictureTutorBoard.isKidEdit(change(.kid, added: [stroke]), screen: screen))
        #expect(PictureTutorBoard.isKidEdit(change(.kid, removed: [stroke]), screen: screen), "erasing")
        #expect(PictureTutorBoard.isKidEdit(change(.history, removed: [stroke]), screen: screen), "undo")
        #expect(!PictureTutorBoard.isKidEdit(change(.tutor, added: [stroke]), screen: screen))
        #expect(!PictureTutorBoard.isKidEdit(change(.load, added: [stroke]), screen: screen))
        #expect(!PictureTutorBoard.isKidEdit(change(.kid, added: [picture]), screen: screen), "accepting the tutor's picture")
        #expect(!PictureTutorBoard.isKidEdit(change(.history, removed: [picture]), screen: screen))
        #expect(!PictureTutorBoard.isKidEdit(change(.kid, added: [stroke]), screen: "screen:2"), "another page")
    }

    // MARK: off = the app as it was

    @Test func theSwitchIsOffUntilAnAdminTurnsItOn() {
        let saved = PictureTutorSettings.defaults
        defer { PictureTutorSettings.defaults = saved }
        PictureTutorSettings.defaults = UserDefaults(suiteName: "picture-off-\(UUID().uuidString)")!
        #expect(PictureTutorSettings.enabled == false)
        #expect(PictureTutorSettings.defaultMode == .suggest)
        #expect(PictureTutorSettings.usesStub == false)
        PictureTutorSettings.enabled = true
        #expect(PictureTutorSettings.enabled)
    }

    /// Counts the Live loop's calls.
    final class CountingServices: LiveServices, @unchecked Sendable {
        let lock = NSLock()
        var calls = 0
        func count() { lock.withLock { calls += 1 } }
        func capabilities() async throws -> LiveCapabilities { count(); throw APIError.network(.notConnectedToInternet) }
        func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse { count(); throw APIError.network(.notConnectedToInternet) }
        func reread(_ request: RereadRequest) async throws -> RereadResponse { count(); throw APIError.network(.notConnectedToInternet) }
        func setup(_ request: SetupRequest) async throws -> SetupResponse { count(); throw APIError.network(.notConnectedToInternet) }
        func check(_ request: CheckRequest) -> LiveEventStream { count(); return LiveEventStream { $0.finish() } }
        func solve(_ request: SolveRequest) -> LiveEventStream { count(); return LiveEventStream { $0.finish() } }
    }

    /// The board's tutor started as always (the switch off) watches the board; started for the picture
    /// tutor, the Live loop never starts: it asks nothing and writes nothing.
    @Test(arguments: [true, false])
    func theLiveLoopRunsOnlyWithoutThePictureTutor(live: Bool) async throws {
        let controller = BoardController()
        let canvas = BoardCanvasView(controller: controller)
        canvas.frame = CGRect(x: 0, y: 0, width: 1194, height: 834)
        canvas.layoutIfNeeded()
        let services = CountingServices()
        let tutor = BoardTutor(controller: controller, canvas: canvas, boardId: "gate-\(live)", services: services) { board, helper in
            let driver = AskBoardDriver(canvasBoard: board, helper: helper)
            let speech = AskSpeech(voice: AskVoice(source: nil), grade: 4)
            let session = AskSession(boardId: "gate", transport: ScriptedAskTransport(), board: driver, speech: speech.queue, grade: 4)
            return (AskParts(session: session, speech: speech, mic: AskMic(stt: ScriptedSpeechToText())), driver)
        }
        tutor.start(live: live)
        #expect(tutor.liveRunning == live)
        #expect((tutor.liveBoard.onPen != nil) == live, "the loop takes the pen only when it runs")
        let screen = controller.currentScreenID
        controller.store.put(.stroke(StrokeRecord(screen: screen, order: controller.store.nextOrder(on: screen), author: .kid, color: .black, width: 6,
                                                  pressure: .simulated, x: 100, y: 100, points: [InkPoint(x: 0, y: 0), InkPoint(x: 40, y: 10)], start: 0)), origin: .kid)
        try await Task.sleep(for: .seconds(1.5))
        let tutorRecords = controller.store.records.values.filter { $0.author == .tutor && $0.type != .screen }
        if live {
            #expect(services.calls > 0, "the switch off: the Live loop reads the board as before")
        } else {
            #expect(services.calls == 0)
            #expect(tutorRecords.isEmpty)
        }
        tutor.stop()
    }
}

extension Box {
    fileprivate var midXForTest: Double { x + w / 2 }
}
