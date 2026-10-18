import AgathonDesign
import AgathonKit
import AgathonStore
import StoreKit
import SwiftUI

/// The gate, then the plan: what every grown-up path to money goes through (out of ink, the account).
struct GrownUpPlanFlow: View {
    let onClose: () -> Void
    @State private var passed = false

    var body: some View {
        if passed {
            PlanScreen(onClose: onClose)
        } else {
            ParentalGateView(onPass: { withAnimation(DS.Motion.snap) { passed = true } }, onClose: onClose)
        }
    }
}

/// Agathon Unlimited for grown-ups (after the parental gate). The price is the App Store's
/// (`displayPrice`, in the buyer's storefront), the billed amount is the biggest price on the screen,
/// the free week shows only when this Apple ID can have it, and the auto-renewal disclosure, Restore,
/// and the Terms and Privacy links are always there (App Review Guideline 3.1.2). What the family has
/// comes from the server (`PlanStore.standing`), so a web plan or a kid's grown-up's plan reads right.
struct PlanScreen: View {
    let onClose: () -> Void
    /// Reads the plan and the product when it appears (off only for previews and screenshots).
    var loadsOnAppear = true

    @Environment(PlanStore.self) private var store
    @Environment(AgathonBackend.self) private var backend
    @Environment(\.purchase) private var purchaseAction
    @State private var showManage = false
    @State private var showRefund = false
    @State private var notice: (title: String, message: String?)?
    @State private var justStarted = false
    @State private var contentWidth: CGFloat = 0

    var body: some View {
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.xl) {
                    HStack {
                        AgathonLogo(size: 26)
                        Spacer()
                        RoundButton(.close, fill: .paper, diameter: 52, label: "Close", action: onClose)
                            .accessibilityIdentifier("plan.close")
                    }
                    if let notice {
                        Banner(.lookAgain, notice.title, message: notice.message).accessibilityIdentifier("plan.notice")
                    }
                    content
                }
                .padding(DS.Space.xxl)
                .frame(maxWidth: 1040)
                .frame(maxWidth: .infinity)
            }
        }
        .task {
            guard loadsOnAppear else { return }
            await store.refreshPlan()
            await store.loadProduct()
        }
        .manageSubscriptionsSheet(isPresented: $showManage)
        .refundRequestSheet(for: store.latestTransactionID ?? 0, isPresented: $showRefund)
    }

    @ViewBuilder private var content: some View {
        if justStarted {
            status(shapes: .celebrate, title: "You're all set", message: "Help is on for the whole family.", manage: false)
        } else if !store.planLoaded {
            if let error = store.planError {
                EmptyState(.icon(.offline, .sunny), title: "Couldn't check your plan", message: error, actionTitle: "Try again", actionIcon: .retry) {
                    Task { await store.refreshPlan() }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 300)
            }
        } else {
            switch store.standing {
            case .none, .ended:
                offer
            case let .subscribed(provider, trialEnds, renews, cancelling):
                if provider == "apple" {
                    status(shapes: nil, icon: (.check, .success), title: "Agathon Unlimited is on",
                           message: subscribedLine(trialEnds: trialEnds, renews: renews, cancelling: cancelling), manage: true)
                } else {
                    status(shapes: nil, icon: (.check, .success), title: "Agathon Unlimited is on",
                           message: "Your plan is billed through agathon.app. To change or cancel it, sign in there.", manage: false)
                }
            case let .repeatTrial(provider, startsOn):
                status(shapes: nil, icon: (.star, .sunny), title: "Your plan starts \(Self.day(startsOn).map { "on \($0)" } ?? "soon")",
                       message: "The free week is for a first plan only, so help uses ink until your first payment.", manage: provider == "apple")
            case let .paymentProblem(provider):
                status(shapes: nil, icon: (.pause, .sunny), title: provider == "apple" ? "Apple couldn't renew your plan" : "Your last payment didn't go through",
                       message: provider == "apple"
                           ? "Update your payment method in Settings, and help switches back on by itself."
                           : "Fix it at agathon.app. Help uses ink meanwhile.",
                       manage: provider == "apple")
            case .pending:
                status(shapes: .thinking, title: "Setting up your plan…", message: "This takes a moment.", manage: false)
            }
        }
    }

    // MARK: the offer

    private var offer: some View {
        VStack(alignment: .leading, spacing: DS.Space.xl) {
            VStack(alignment: .leading, spacing: DS.Space.s) {
                Text("Help on every problem.").dsFont(.display).foregroundStyle(DS.Color.ink)
                Text("Agathon Unlimited switches the tutor on for the whole family: hints, checks and worked steps, whenever they're needed.")
                    .dsFont(.body).foregroundStyle(DS.Color.inkSecondary).frame(maxWidth: 640, alignment: .leading)
            }
            // Side by side when there is room (landscape), the price first when stacked (portrait).
            Group {
                if contentWidth >= 880 {
                    HStack(alignment: .top, spacing: DS.Space.l) { included; buyCard.frame(width: 420) }
                } else {
                    VStack(spacing: DS.Space.l) { buyCard; included }
                }
            }
            .onGeometryChange(for: CGFloat.self, of: { $0.size.width }, action: { contentWidth = $0 })
            if let offer = store.offer {
                Text(offer.disclosure).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                    .frame(maxWidth: 760, alignment: .leading)
                    .accessibilityIdentifier("plan.disclosure")
            }
        }
    }

    private var included: some View {
        Card(.paper) {
            Text("What's included").dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            ForEach(Self.benefits, id: \.title) { benefit in
                HStack(alignment: .top, spacing: DS.Space.m) {
                    IconCircle(benefit.icon, fill: .chalk, diameter: 48)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(benefit.title).dsFont(.button, size: 18).foregroundStyle(DS.Color.ink)
                        Text(benefit.detail).dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                    }
                }
                .padding(.top, DS.Space.xs)
            }
        }
    }

    private var buyCard: some View {
        Card(.ink, radius: DS.Radius.cardLarge) {
            switch store.productState {
            case .loaded:
                if let offer = store.offer {
                    if let badge = offer.trialBadge { Tag(badge, style: .sunny) }
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(offer.displayPrice).dsFont(.display).foregroundStyle(DS.Color.onInk)
                            .accessibilityIdentifier("plan.price")
                        Text(offer.period.every).dsFont(.heading).foregroundStyle(DS.Color.onInkSecondary)
                    }
                    PillButton(offer.ctaTitle, icon: .play, kind: .sunny, size: .large) { Task { await buy() } }
                        .disabled(store.activity != nil)
                        .accessibilityIdentifier("plan.buy")
                        .padding(.top, DS.Space.s)
                    Text(offer.ctaDetail).dsFont(.callout).foregroundStyle(DS.Color.onInkSecondary)
                }
            case let .unavailable(message):
                Text(message).dsFont(.body).foregroundStyle(DS.Color.onInk)
                PillButton("Try again", icon: .retry, kind: .sunny) { Task { await store.loadProduct() } }
            case .idle, .loading:
                ProgressView().tint(DS.Color.onInk).frame(maxWidth: .infinity, minHeight: 160)
            }
            // Restore and the plan's terms, where a reviewer and a grown-up look: right under the button.
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    Task { await restore() }
                } label: {
                    Text(store.activity == .restoring ? "Restoring…" : "Restore purchases")
                        .frame(minHeight: DS.Size.minTarget)
                }
                .disabled(store.activity != nil)
                .accessibilityIdentifier("plan.restore")
                HStack(spacing: DS.Space.l) {
                    Link(destination: link("terms", fragment: "unlimited")) { Text("Terms of Use").frame(minHeight: 44) }
                        .accessibilityIdentifier("plan.terms")
                    Link(destination: link("privacy")) { Text("Privacy Policy").frame(minHeight: 44) }
                        .accessibilityIdentifier("plan.privacy")
                }
                .dsFont(.callout, size: 15)
                .foregroundStyle(DS.Color.onInkSecondary)
            }
            .dsFont(.button, size: 16)
            .foregroundStyle(DS.Color.onInk)
        }
    }

    // MARK: the plan's state

    private func status(shapes: TheShapes.Pose?, icon: (DS.Icon, DS.Fill)? = nil, title: String, message: String, manage: Bool) -> some View {
        VStack(spacing: DS.Space.m) {
            if let shapes {
                TheShapes(shapes).frame(width: 200)
            } else if let icon {
                IconCircle(icon.0, fill: icon.1, diameter: 96)
            }
            Text(title).dsFont(.title).foregroundStyle(DS.Color.ink).multilineTextAlignment(.center)
                .accessibilityIdentifier("plan.status")
            Text(message).dsFont(.body).foregroundStyle(DS.Color.inkSecondary).multilineTextAlignment(.center)
                .frame(maxWidth: 520)
            FlowStack(spacing: DS.Space.s) {
                PillButton("Done", kind: .primary, action: onClose).accessibilityIdentifier("plan.done")
                if manage {
                    PillButton("Manage subscription", kind: .secondary) { showManage = true }
                        .accessibilityIdentifier("plan.manage")
                    if store.latestTransactionID != nil {
                        PillButton("Request a refund", kind: .quiet) { showRefund = true }
                            .accessibilityIdentifier("plan.refund")
                    }
                }
            }
            .padding(.top, DS.Space.s)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, DS.Space.xxxl)
    }

    private func subscribedLine(trialEnds: Date?, renews: Date?, cancelling: Bool) -> String {
        if cancelling, let end = Self.day(renews ?? trialEnds) { return "It ends on \(end). You won't be charged again." }
        if let end = Self.day(trialEnds) {
            let price = store.offer.map { " Then \($0.pricePerPeriod), unless you cancel." } ?? ""
            return "Your free week ends on \(end).\(price)"
        }
        if let renews = Self.day(renews) { return "It renews on \(renews)." }
        return "Help is on for the whole family."
    }

    // MARK: actions

    private func buy() async {
        notice = nil
        let outcome = await store.purchase { product, options in try await purchaseAction(product, options: options) }
        switch outcome {
        case let .purchased(record):
            switch record {
            case .recorded, .ignored: justStarted = true
            case .refused: notice = ("This Apple Account's plan belongs to another Agathon account", "Sign in to that account to use it, or use another Apple Account.")
            case .rejected: notice = ("The purchase couldn't be checked", "Try Restore purchases in a moment.")
            case .retryLater: notice = ("Bought. Switching help on…", "It can take a minute to reach your account. It will by itself.")
            }
        case .cancelled: break
        case .pending: notice = ("Waiting for approval", "When it's approved, help switches on by itself.")
        case let .failed(message): notice = ("Couldn't start the plan", message)
        }
    }

    private func restore() async {
        notice = nil
        switch await store.restore() {
        case let .restored(unlimited): notice = unlimited ? nil : ("Restored", "Your plan isn't active right now.")
        case .nothing: notice = ("Nothing to restore", "This Apple Account has no Agathon Unlimited plan.")
        case .otherAccount: notice = ("This Apple Account's plan belongs to another Agathon account", "Sign in to that account to use it.")
        case .cancelled: break
        case let .failed(message): notice = ("Couldn't restore", message)
        }
    }

    // MARK: words

    private func link(_ path: String, fragment: String? = nil) -> URL {
        var components = URLComponents(url: backend.environment.apiBaseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        components?.fragment = fragment
        return components?.url ?? backend.environment.apiBaseURL
    }

    static func day(_ date: Date?) -> String? {
        date.map { $0.formatted(.dateTime.weekday(.wide).month(.wide).day()) }
    }

    static let benefits: [(icon: DS.Icon, title: String, detail: String)] = [
        (.hand, "Hints and worked steps", "Every line checked, and the next step shown when they're stuck."),
        (.chat, "Ask the tutor anything", "Out loud or typed, about what's on the board."),
        (.person, "Every kid in the family", "One plan covers each kid's own profile."),
        (.chart, "Practice and progress", "Today's practice, the skill path and a weekly report."),
    ]
}
