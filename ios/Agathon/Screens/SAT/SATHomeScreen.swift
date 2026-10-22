import AgathonDesign
import AgathonKit
import AgathonOnboarding
import AgathonSAT
import AgathonStore
import AgathonBoardUI
import SwiftUI

/// SAT home as a screen (docs/SAT-MODE.md): progress read from `/api/sat/progress`, a set fetched from
/// `/api/sat/next` (mixed, or one skill) and opened as a session beside its board. From Home (a card for
/// every profile, no plan needed), or as the whole app for a student with no account (an anonymous
/// session: SAT practice and nothing else, "Make a free account" at the top).
struct SATHomeScreen: View {
    /// Back to Home (nil when SAT practice is the whole app: no account)
    var onClose: (() -> Void)?

    @Environment(AgathonBackend.self) private var backend
    @Environment(PlanStore.self) private var planStore
    @State private var context: SATContext?
    @State private var loading = false
    @State private var failed = false
    @State private var starting: SATNextRequest?
    @State private var session: SessionRequest?
    @State private var showsAccount = false
    @State private var toast: String?

    struct SessionRequest: Identifiable {
        let id = UUID()
        let questions: [SATQuestion]
    }

    var body: some View {
        let ctx = context ?? SATContext.make(backend)
        var actions = SATHomeActions()
        actions.practice = { request in Task { await start(request, ctx) } }
        actions.close = onClose
        actions.signUp = ctx.account(backend) == .none ? { showsAccount = true } : nil
        actions.retry = { Task { await load(ctx) } }
        return SATHomeView(progress: ctx.progress, loading: loading, failed: failed, account: ctx.account(backend),
                           starting: starting, actions: actions)
            .overlay(alignment: .bottom) {
                if let toast {
                    Banner(.lookAgain, toast, surface: .ink)
                        .fixedSize()
                        .padding(.bottom, DS.Space.xl)
                        .task(id: toast) {
                            try? await Task.sleep(for: .seconds(4))
                            self.toast = nil
                        }
                        .accessibilityIdentifier("sat.home.toast")
                }
            }
            .task {
                // the board's maths (SwiftMath) for the panel's maths too
                BoardEditorSetup.install()
                if context == nil { context = ctx }
                await load(ctx)
                #if DEBUG
                if SATDebug.openAtLaunch == "session" || SATDebug.openAtLaunch == "summary", session == nil {
                    await start(SATNextRequest(), ctx)
                }
                #endif
            }
            .fullScreenCover(item: $session, onDismiss: { Task { await load(ctx) } }) { request in
                SATSessionScreen(context: ctx, questions: request.questions) { session = nil }
                    .environment(backend)
                    .environment(planStore)
            }
            .fullScreenCover(isPresented: $showsAccount, onDismiss: { Task { await load(ctx) } }) {
                SATAccountFlow(onDone: { showsAccount = false }, onUnder13: { showsAccount = false })
                    .environment(backend)
            }
    }

    private func load(_ ctx: SATContext) async {
        loading = true
        defer { loading = false }
        do {
            ctx.progress = try await ctx.service.progress()
            failed = false
        } catch {
            failed = ctx.progress == nil
        }
    }

    private func start(_ request: SATNextRequest, _ ctx: SATContext) async {
        guard starting == nil else { return }
        starting = request
        defer { starting = nil }
        do {
            let qs = try await ctx.service.next(request)
            guard !qs.isEmpty else {
                toast = SATCopy.noQuestions
                return
            }
            session = SessionRequest(questions: qs)
        } catch {
            toast = SATCopy.setFailed
        }
    }
}

/// SAT practice with no account (docs/SAT-MODE.md, `POST /api/sat/anon`): the server mints an
/// anonymous session for the real app (App Attest, the simulator's debug header off production);
/// the app adopts it. It never signs in anonymously by itself.
enum SATAnonymous {
    /// A session for SAT practice: the one there is, or an anonymous one. Throws when the server
    /// would not give one (no App Attest here, offline, anonymous sign-ins off).
    @MainActor static func ensureSession(_ backend: AgathonBackend) async throws {
        #if DEBUG
        if SATDebug.isStub { return }
        #endif
        guard backend.auth.phase != .signedIn else { return }
        let anon = try await PreAccountAPI(api: backend.api).satAnonSession()
        try await backend.auth.setSession(accessToken: anon.accessToken, refreshToken: anon.refreshToken)
    }
}

/// SAT practice on Home: a card for every profile, no plan needed. Grown-up Blocks: ink, flat.
struct SATHomeCard: View {
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(alignment: .center, spacing: DS.Space.l) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(SATCopy.homeCard.uppercased()).dsFont(.label).foregroundStyle(DS.Color.onInkSecondary)
                    Text("SAT math, beside your board").dsFont(.headline, size: 26).foregroundStyle(DS.Color.onInk)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(SATCopy.homeCardLine).dsFont(.callout, size: 16).foregroundStyle(DS.Color.onInkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: DS.Space.s)
                DSIcon(.forward, size: 18)
                    .foregroundStyle(DS.Color.ink)
                    .frame(width: 48, height: 48)
                    .background(Circle().fill(DS.Color.onInk))
            }
            .padding(.horizontal, 30)
            .padding(.vertical, DS.Space.l)
            .background(RoundedRectangle(cornerRadius: DS.Radius.cardLarge, style: .continuous).fill(DS.Color.ink))
            .contentShape(RoundedRectangle(cornerRadius: DS.Radius.cardLarge, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("home.sat")
    }
}
