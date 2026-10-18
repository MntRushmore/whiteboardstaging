#if DEBUG
import AgathonKit
import AgathonStore
import StoreKit
import SwiftUI

/// The Billing Lab (Debug only, from the Labs menu): buy, restore, manage and refund with
/// Agathon.storekit against the local server (APPLE_ENVIRONMENT=Xcode on `npm run dev`), and read
/// what the server and StoreKit each say. Renew, expire or refund a test purchase from Xcode's
/// Debug > StoreKit > Manage Transactions: the listener hands each change to the server.
struct BillingLabView: View {
    @Environment(PlanStore.self) private var store
    @Environment(\.purchase) private var purchaseAction
    @State private var screen: Screen?
    @State private var showManage = false
    @State private var showRefund = false
    @State private var result = ""

    enum Screen: String, Identifiable {
        case plan, planNoGate, gate, kidOutOfInk, grownUpOutOfInk
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("The server (ink_summary().unlimited, the source of truth)") {
                    row("status", store.plan?.status ?? "none")
                    row("unlimited", store.plan?.unlimited.map(String.init) ?? "?")
                    row("provider", store.plan?.provider ?? "—")
                    row("trial end", store.plan?.trialEnd?.formatted() ?? "—")
                    row("period end", store.plan?.currentPeriodEnd?.formatted() ?? "—")
                    row("set to cancel", store.plan?.cancelAtPeriodEnd.map(String.init) ?? "—")
                    row("checkout ref", store.plan?.checkoutRef.map { String($0.uuidString.prefix(8)) + "…" } ?? "—")
                    if let advice = DeletionAdvice(plan: store.plan).message { Text("Delete account: \(advice)").font(.footnote) }
                    Button("Refresh") { Task { await store.refreshPlan() } }
                }
                Section("The App Store (StoreKit; a hint only)") {
                    row("product", "\(store.productState)")
                    row("price", store.offer?.pricePerPeriod ?? "—")
                    row("free trial", store.offer?.trialBadge ?? "not eligible / none")
                    row("entitled on this Apple ID", String(store.hasStoreEntitlement))
                    row("latest transaction", store.latestTransactionID.map(String.init) ?? "—")
                    Button("Load product") { Task { await store.loadProduct() } }
                }
                Section("Do") {
                    Button("Open the plan (parental gate first)") { screen = .plan }.accessibilityIdentifier("lab.openPlan")
                    Button("Open the plan without the gate (Lab only)") { screen = .planNoGate }
                    Button("Buy now (no screens)") {
                        Task {
                            let outcome = await store.purchase { try await purchaseAction($0, options: $1) }
                            result = "\(outcome)"
                        }
                    }
                    Button("Restore purchases") { Task { result = "\(await store.restore())" } }
                    Button("Manage subscription") { showManage = true }
                    Button("Request a refund") { showRefund = true }.disabled(store.latestTransactionID == nil)
                    Button("Re-send unfinished transactions") { Task { await store.retryUnfinished() } }
                    Button("Parental gate") { screen = .gate }
                    Button("Out of ink: kid") { screen = .kidOutOfInk }
                    Button("Out of ink: grown-up") { screen = .grownUpOutOfInk }
                    if !result.isEmpty { Text(result).font(.footnote.monospaced()).accessibilityIdentifier("lab.result") }
                }
                Section("Log") {
                    ForEach(store.log.reversed()) { line in
                        Text("\(line.at.formatted(date: .omitted, time: .standard))  \(line.text)").font(.caption.monospaced())
                    }
                }
            }
            .navigationTitle("Billing Lab")
            .task {
                await store.refreshPlan()
                await store.loadProduct()
            }
            .manageSubscriptionsSheet(isPresented: $showManage)
            .refundRequestSheet(for: store.latestTransactionID ?? 0, isPresented: $showRefund)
            .fullScreenCover(item: $screen) { screen in
                switch screen {
                case .plan: GrownUpPlanFlow { self.screen = nil }
                case .planNoGate: PlanScreen { self.screen = nil }
                case .gate: ParentalGateView(onPass: { self.screen = .planNoGate }, onClose: { self.screen = nil })
                case .kidOutOfInk: OutOfInkView(audience: .kid) { self.screen = nil }
                case .grownUpOutOfInk: OutOfInkView(audience: .grownUp, onSeePlan: { self.screen = .plan }, onClose: { self.screen = nil })
                }
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        LabeledContent(label) { Text(value).font(.callout.monospaced()) }
    }
}

extension View {
    /// `-billingScreen lab|plan|gate|outOfInkKid|outOfInkGrownUp` (Debug): opens a billing screen at
    /// launch, for screenshots and UI tests.
    func billingScreenOnLaunch() -> some View {
        modifier(BillingScreenOnLaunch())
    }
}

private struct BillingScreenOnLaunch: ViewModifier {
    func body(content: Content) -> some View {
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-billingScreen"), i + 1 < args.count {
            switch args[i + 1] {
            case "plan": GrownUpPlanFlow {}
            case "gate": ParentalGateView(onPass: {}, onClose: {})
            case "outOfInkKid": OutOfInkView(audience: .kid) {}
            case "outOfInkGrownUp": OutOfInkView(audience: .grownUp, onClose: {})
            default: BillingLabView()
            }
        } else {
            content
        }
    }
}
#endif
