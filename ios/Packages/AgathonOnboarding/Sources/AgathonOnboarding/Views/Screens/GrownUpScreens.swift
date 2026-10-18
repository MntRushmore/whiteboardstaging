import AgathonDesign
import AgathonKit
import SafariServices
import SwiftUI
import UserNotifications

// MARK: - 10 · the gate

struct GateScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var entry = ""
    @State private var note: String?
    @State private var paused: Date?
    @State private var miss = false

    var body: some View {
        let c = model.copy
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            VStack(spacing: 20) {
                SheetHeader(c.gateHeader, onClose: { model.go(.handBack) })
                Text(c.gateQuestion)
                    .dsFont(.title)
                    .foregroundStyle(DS.Color.ink)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                PinDots(count: entry.count, length: model.gate.length, lookAgain: miss)
                    .padding(.vertical, 4)
                Text(note ?? " ")
                    .dsFont(.callout)
                    .foregroundStyle(DS.Color.ink)
                    .frame(height: 24)
                PinPad(entry: $entry, length: model.gate.length) { answer in submit(answer) }
                    .disabled(paused != nil)
                    .opacity(paused != nil ? 0.4 : 1)
            }
            .padding(28)
            .frame(width: 420)
            .background(RoundedRectangle(cornerRadius: DS.Radius.cardLarge, style: .continuous).fill(DS.Color.paper))
            .reveal(0)
            Spacer(minLength: 0)
        }
        .frame(width: layout.size.width, height: layout.size.height)
        .task(id: paused) {
            guard let until = paused else { return }
            try? await Task.sleep(for: .seconds(max(0, until.timeIntervalSinceNow)))
            paused = nil
            note = nil
        }
    }

    private func submit(_ answer: String) {
        switch model.gate.check(answer, now: Date()) {
        case .open:
            note = nil
            OnboardingSound.shared.play(.tick)
            model.passGate()
        case .miss:
            miss = true
            note = model.copy.gateMiss
            OnboardingSound.shared.play(.woodblock)
            Task {
                try? await Task.sleep(for: .milliseconds(500))
                entry = ""
                miss = false
            }
        case .paused(let until):
            paused = until
            note = model.copy.gatePaused
            entry = ""
            miss = false
        }
        // the year is never stored or sent
    }
}

extension FlowModel {
    func passGate() {
        record("start_gate")
        go(backend.isSignedIn ? (state.hasPlan ? .pin : .trial) : .account)
    }
}

// MARK: - 11 · the account

struct AccountScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var email = ""
    @State private var password = ""
    @State private var agreed = false
    @State private var heardFrom: String?
    @State private var busy = false
    @State private var error: String?
    @State private var emailTaken = false
    @State private var safari: URL?

    var body: some View {
        let c = model.copy
        let ready = email.contains("@") && password.count >= 8 && agreed && !busy
        VStack(spacing: 0) {
            Color.clear.frame(height: layout.contentTop)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(c.accountLede).dsFont(.body).foregroundStyle(DS.Color.inkSecondary).reveal(0)
                    let columns = layout.landscape && !layout.compact
                    let form = Group {
                        VStack(alignment: .leading, spacing: 12) {
                            GrownUpField(title: c.email, text: $email, kind: .email)
                                .accessibilityIdentifier("onboarding.account.email")
                                .reveal(1)
                            GrownUpField(title: c.password, text: $password, kind: .newPassword)
                                .submitLabel(.go)
                                .onSubmit { if ready { save() } }
                                .accessibilityIdentifier("onboarding.account.password")
                                .reveal(2)
                            if let error {
                                HStack(spacing: 12) {
                                    Text(error).dsFont(.callout).foregroundStyle(DS.Color.ink)
                                        .fixedSize(horizontal: false, vertical: true)
                                    if emailTaken {
                                        Button(c.signInInstead) { model.openSignIn(from: .account) }
                                            .buttonStyle(.pill(.primary))
                                    }
                                }
                                .padding(.horizontal, 16).padding(.vertical, 8)
                                .background(Capsule().fill(DS.Color.tryAgain))
                            }
                        }
                        .frame(maxWidth: 440)
                        VStack(alignment: .leading, spacing: 14) {
                            Toggle(isOn: $agreed) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(c.consent).dsFont(.callout, size: 15).foregroundStyle(DS.Color.ink)
                                        .fixedSize(horizontal: false, vertical: true)
                                    HStack(spacing: 14) {
                                        Button(c.terms) { safari = Legal.terms(model) }
                                        Button(c.privacy) { safari = Legal.privacy(model) }
                                    }
                                    .dsFont(.button, size: 15)
                                    .foregroundStyle(DS.Color.tutorInk)
                                }
                            }
                            .toggleStyle(CheckToggle())
                            .accessibilityIdentifier("onboarding.account.consent")
                            .reveal(3)
                            Menu {
                                ForEach(OnboardingCatalog.shared.heardFrom) { o in
                                    Button(o.label) { heardFrom = o.id }
                                }
                            } label: {
                                HStack {
                                    Text(OnboardingCatalog.shared.heardFrom.first { $0.id == heardFrom }?.label ?? c.heardFromPrompt)
                                        .dsFont(.callout)
                                    Spacer()
                                    DSIcon(.forward, size: 16).rotationEffect(.degrees(90))
                                }
                                .foregroundStyle(DS.Color.ink)
                                .padding(.horizontal, 22)
                                .frame(height: 56)
                                .background(Capsule().fill(DS.Color.surface))
                            }
                            .reveal(4)
                        }
                        .frame(maxWidth: 440)
                    }
                    if columns {
                        HStack(alignment: .top, spacing: 28) { form }
                    } else {
                        VStack(alignment: .leading, spacing: 18) { form }
                    }
                    HStack(spacing: 12) {
                        PillButton(busy ? "Saving…" : c.accountSave, icon: .forward, kind: .sunny, size: .large) { save() }
                            .accessibilityIdentifier("onboarding.account.save")
                            .disabled(!ready)
                        Button(c.haveAccount) { model.openSignIn(from: .account) }
                            .buttonStyle(.pill(.quiet))
                    }
                    .padding(.top, 8)
                    .reveal(5)
                }
                .padding(.horizontal, layout.margin)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .sheet(item: $safari) { url in SafariView(url: url).ignoresSafeArea() }
    }

    private func save() {
        busy = true
        error = nil
        emailTaken = false
        Task {
            defer { busy = false }
            do {
                let signedIn = try await model.backend.signUp(email: email, password: password)
                guard signedIn else {
                    // "Confirm email" is on in this project: the account waits on an email round trip
                    error = model.copy.confirmEmail
                    return
                }
                model.state.answers.heardFrom = heardFrom
                await model.backend.finishGrownUp(heardFrom: heardFrom, journey: model.state.journeyId)
                model.state.hasPlan = await model.hasPlanNow()
                model.advance()
            } catch {
                let message = AuthService.message(for: error)
                emailTaken = message.contains("already exists")
                self.error = emailTaken ? model.copy.emailTaken : (error is URLError ? model.copy.offline : message)
            }
        }
    }
}

extension FlowModel {
    func hasPlanNow() async -> Bool {
        let plan = await trial.hasPlan()
        if plan { return true }
        return await backend.hasPlan()
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

enum Legal {
    @MainActor static func terms(_ model: FlowModel) -> URL { URL(string: "https://www.agathon.app/terms")! }
    @MainActor static func privacy(_ model: FlowModel) -> URL { URL(string: "https://www.agathon.app/privacy")! }
}

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

/// A grown-up's field: a paper pill on the ground, the Keychain's AutoFill on.
struct GrownUpField: View {
    enum Kind { case email, newPassword, password }
    let title: String
    @Binding var text: String
    let kind: Kind
    @FocusState private var focused: Bool

    var body: some View {
        Group {
            switch kind {
            case .email:
                TextField("", text: $text, prompt: prompt)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            case .newPassword:
                SecureField("", text: $text, prompt: prompt).textContentType(.newPassword)
            case .password:
                SecureField("", text: $text, prompt: prompt).textContentType(.password)
            }
        }
        .font(.ds(.body))
        .foregroundStyle(DS.Color.ink)
        .tint(DS.Color.focus)
        .focused($focused)
        .padding(.horizontal, 24)
        .frame(height: 64)
        .background(Capsule().fill(DS.Color.surface))
        .overlay { if focused { Capsule().strokeBorder(DS.Color.focus, lineWidth: DS.Stroke.focus) } }
        .accessibilityLabel(title)
    }

    private var prompt: Text { Text(title).foregroundStyle(DS.Color.inkSecondary) }
}

/// The consent box: an ink square that fills with a sunny tick.
struct CheckToggle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(alignment: .top, spacing: 14) {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(configuration.isOn ? DS.Color.ink : DS.Color.surface)
                    .frame(width: 34, height: 34)
                    .overlay {
                        if configuration.isOn {
                            TickShape().stroke(DS.Color.sunny, style: StrokeStyle(lineWidth: 3.6, lineCap: .round, lineJoin: .round))
                                .padding(8)
                        }
                    }
                    .frame(width: 56, height: 56, alignment: .topLeading)
                configuration.label
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? [.isSelected] : [])
    }
}

// MARK: - 12 · the trial

struct TrialScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var remind = true
    @State private var busy = false
    @State private var note: String?
    @State private var safari: URL?

    var body: some View {
        let c = model.copy
        let offer = model.offer
        let days = offer?.trialDays ?? 0
        VStack(alignment: .leading, spacing: 18) {
            Text(c.trialLede).dsFont(.body).foregroundStyle(DS.Color.inkSecondary).reveal(0)
            HStack(alignment: .top, spacing: 36) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(c.trialRows.enumerated()), id: \.offset) { i, row in
                        HStack(spacing: 14) {
                            IconCircle(DS.Icon(rawValue: row.icon) ?? .check, fill: .paper, diameter: 44)
                            Text(row.text).dsFont(.callout).foregroundStyle(DS.Color.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .reveal(1 + i)
                    }
                }
                .frame(maxWidth: 470, alignment: .leading)
                if days > 0 {
                    VStack(alignment: .leading, spacing: 16) {
                        TrialTimeline(days: days, copy: c)
                        Text(c.cancelBefore).dsFont(.caption, size: 15).foregroundStyle(DS.Color.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Toggle(isOn: $remind) {
                            Text(c.remindMe(daysBefore: 2)).dsFont(.callout).foregroundStyle(DS.Color.ink)
                        }
                        .tint(DS.Color.ink)
                    }
                    .padding(22)
                    .frame(maxWidth: 440)
                    .background(RoundedRectangle(cornerRadius: DS.Radius.card, style: .continuous).fill(DS.Color.surface))
                    .reveal(6)
                }
            }
            if let note {
                Text(note).dsFont(.callout).foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Capsule().fill(DS.Color.tryAgain))
            }
        }
        .padding(.horizontal, layout.margin)
        .padding(.top, layout.contentTop)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: layout.size.height, alignment: .top)
        .overlay(alignment: .bottom) {
            VStack(alignment: .trailing, spacing: 10) {
                if let offer {
                    Text(days > 0 ? c.trialPrice(days: days, price: offer.displayPrice) : c.subscribePrice(offer.displayPrice))
                        .dsFont(.caption)
                        .foregroundStyle(DS.Color.inkSecondary)
                }
                HStack(spacing: 12) {
                    HStack(spacing: 4) {
                        Button(c.restore) { restore() }
                        Text("·")
                        Button(c.terms) { safari = Legal.terms(model) }
                        Text("·")
                        Button("Privacy") { safari = Legal.privacy(model) }
                    }
                    .dsFont(.caption, size: 15)
                    .foregroundStyle(DS.Color.inkSecondary)
                    Spacer()
                    Button(c.notNow) { decline() }
                        .buttonStyle(.pill(.quiet, size: .large))
                        .accessibilityIdentifier("onboarding.trial.notNow")
                    PillButton(busy ? "One moment…" : (days > 0 ? c.startTrial : c.subscribe(offer?.displayPrice ?? "")),
                               icon: .play, kind: .sunny, size: .large) { start() }
                        .accessibilityIdentifier("onboarding.trial.start")
                        .disabled(busy || offer == nil)
                }
            }
            .padding(.horizontal, layout.margin)
            .padding(.bottom, layout.bottomInset + 12)
            .reveal(7)
        }
        .sheet(item: $safari) { url in SafariView(url: url).ignoresSafeArea() }
        .onAppear {
            if model.offer == nil { model.prefetchOffer() }
            if model.offerFailed { note = c.storeError }
        }
    }

    private func start() {
        busy = true
        note = nil
        Task {
            defer { busy = false }
            if remind, (model.offer?.trialDays ?? 0) > 0 { await TrialReminder.schedule(days: model.offer?.trialDays ?? 7) }
            do {
                let ref = await model.backend.checkoutRef()
                switch try await model.trial.start(checkoutRef: ref) {
                case .started:
                    model.record("start_trial_started")
                    model.state.hasPlan = true
                    model.go(.pin)
                case .pending:
                    model.record("start_trial_pending")
                    note = model.copy.pending
                    try? await Task.sleep(for: .seconds(2))
                    model.go(.pin)
                case .cancelled:
                    break
                }
            } catch {
                note = model.copy.storeError
            }
        }
    }

    private func decline() {
        model.record("start_trial_declined")
        model.go(.pin)
    }

    private func restore() {
        Task {
            if (try? await model.trial.restore()) == true {
                model.state.hasPlan = true
                model.go(.pin)
            } else {
                note = model.copy.restoreNothing
            }
        }
    }
}

/// Today · Day 5 · Day 7 in the trail's style: a done dot, the reminder's ring, the plan's dot.
struct TrialTimeline: View {
    let days: Int
    let copy: OnboardingCopy

    var body: some View {
        let nodes: [(SkillPathNode.State, String, String)] = [
            (.done, copy.trialToday.0, copy.trialToday.1),
            (.now, copy.trialReminder(day: max(1, days - 2)).0, copy.trialReminder(day: max(1, days - 2)).1),
            (.later, copy.trialEnd(day: days).0, copy.planStarts),
        ]
        ZStack(alignment: .topLeading) {
            Capsule().fill(DS.Color.ink).frame(height: 5).padding(.horizontal, 22).offset(y: 23)
            HStack(alignment: .top, spacing: 0) {
                ForEach(Array(nodes.enumerated()), id: \.offset) { i, n in
                    VStack(alignment: i == 0 ? .leading : (i == nodes.count - 1 ? .trailing : .center), spacing: 4) {
                        SkillPathNode(n.0, size: 40).background(Circle().fill(DS.Color.surface).padding(2))
                        Text(n.1).dsFont(.button, size: 16)
                        Text(n.2).dsFont(.caption, size: 14).foregroundStyle(DS.Color.inkSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: i == 0 ? .leading : (i == nodes.count - 1 ? .trailing : .center))
                }
            }
        }
        .foregroundStyle(DS.Color.ink)
        .accessibilityElement(children: .combine)
    }
}

/// The trial's reminder: a local notification two days before it ends, asked for at the tap on
/// Start (the only notification ask in onboarding).
enum TrialReminder {
    static func schedule(days: Int) async {
        let center = UNUserNotificationCenter.current()
        guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return }
        let content = UNMutableNotificationContent()
        content.title = "Your Agathon trial ends in 2 days"
        content.body = "Cancel in Settings before then and you pay nothing. Or keep going."
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: Double(max(1, days - 2)) * 86_400, repeats: false)
        try? await center.add(UNNotificationRequest(identifier: "agathon.trial.reminder", content: content, trigger: trigger))
    }
}

// MARK: - 13 · the PIN

struct PinScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var entry = ""
    @State private var first: String?
    @State private var note: String?
    @State private var miss = false
    @State private var busy = false

    var body: some View {
        let c = model.copy
        VStack(spacing: 18) {
            Text(c.pinLede)
                .dsFont(.body)
                .foregroundStyle(DS.Color.inkSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 520)
                .reveal(0)
            PinDots(count: entry.count, lookAgain: miss).reveal(1)
            Text(note ?? " ").dsFont(.callout).foregroundStyle(DS.Color.ink).frame(height: 22)
            PinPad(entry: $entry, keyFill: .paper) { pin in submit(pin) }
                .disabled(busy)
                .reveal(2)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, layout.contentTop - (layout.landscape ? 10 : 0))
        .frame(height: layout.size.height, alignment: .top)
    }

    private func submit(_ pin: String) {
        guard let first else {
            self.first = pin
            Task {
                try? await Task.sleep(for: .milliseconds(220))
                entry = ""
                model.retype(model.copy.pinAgain)
            }
            return
        }
        guard pin == first else {
            miss = true
            note = model.copy.pinMismatch
            OnboardingSound.shared.play(.woodblock)
            Task {
                try? await Task.sleep(for: .milliseconds(500))
                entry = ""
                miss = false
                self.first = nil
                model.retype(model.copy.pinTitle)
            }
            return
        }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await model.backend.setPin(pin)
                model.record("start_pin_set")
                OnboardingSound.shared.play(.tick)
                model.go(.handOver)
            } catch {
                note = model.copy.offline
                entry = ""
                self.first = nil
            }
        }
    }
}

// MARK: - 14 · hand it back, the kid's picture

struct HandOverScreen: View {
    let model: FlowModel
    let layout: StageLayout

    var body: some View {
        let c = model.copy
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            IconCircle(.check, fill: .sunny, diameter: 104).reveal(0)
            Text(c.handOverTitle)
                .dsFont(.display)
                .foregroundStyle(DS.Color.onInk)
                .multilineTextAlignment(.center)
                .padding(.top, 32)
                .reveal(1)
                .accessibilityAddTraits(.isHeader)
            PillButton(c.kidHasIt, icon: .play, kind: .sunny, size: .large) { model.go(.kidProfile) }
                .accessibilityIdentifier("onboarding.handOver.go")
                .padding(.top, 36)
                .reveal(2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, layout.margin)
        .frame(width: layout.size.width, height: layout.size.height)
    }
}

struct KidProfileScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var picked: KidPicture?
    @State private var busy = false
    @State private var note: String?

    var body: some View {
        let c = model.copy
        let name = model.answers.name ?? "Me"
        VStack(alignment: .leading, spacing: 26) {
            Text(c.pictureLede).dsFont(.body).foregroundStyle(DS.Color.inkSecondary).reveal(0)
            HStack(spacing: 22) {
                ForEach(Array(KidPicture.allCases.enumerated()), id: \.element) { i, p in
                    Button {
                        picked = p
                        OnboardingSound.shared.play(.tap)
                    } label: {
                        Avatar(name, color: Self.rgb(p), diameter: 116)
                            .overlay(alignment: .topTrailing) { TickBadge(diameter: 38, drawn: picked == p).offset(x: 6, y: -6) }
                            .scaleEffect(picked == p ? 1.06 : 1)
                            .dsAnimation(DS.Motion.pop, value: picked)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("onboarding.picture.\(p.rawValue)")
                    .accessibilityLabel(p.name)
                    .accessibilityAddTraits(picked == p ? .isSelected : [])
                    .reveal(1 + i)
                }
            }
            if let note {
                Text(note).dsFont(.callout).foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Capsule().fill(DS.Color.tryAgain))
            }
            if busy {
                HStack(spacing: 12) {
                    ProgressView().tint(DS.Color.ink)
                    Text(c.making).dsFont(.callout).foregroundStyle(DS.Color.ink)
                }
            }
        }
        .padding(.horizontal, layout.margin)
        .padding(.top, layout.contentTop)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: layout.size.height, alignment: .top)
        .overlay(alignment: .bottomTrailing) {
            PillButton(c.thatsMe, icon: .forward, kind: .sunny, size: .large) { make() }
                .accessibilityIdentifier("onboarding.picture.done")
                .disabled(picked == nil || busy)
                .padding(.trailing, layout.margin)
                .padding(.bottom, layout.bottomInset + 12)
                .reveal(7)
        }
    }

    static func rgb(_ p: KidPicture) -> RGB {
        switch p {
        case .tomato: DS.Palette.tomato
        case .sunny: DS.Palette.sunny
        case .green: DS.Palette.green
        case .pink: DS.Palette.pink
        case .ink: DS.Palette.ink
        }
    }

    private func make() {
        guard let picked else { return }
        busy = true
        note = nil
        model.state.answers.picture = picked
        model.state.keep()
        Task {
            defer { busy = false }
            do {
                try await model.makeKidAndBoard()
                model.go(.firstBoard)
            } catch {
                note = (error as? APIError)?.failure?.reason == "plan_required"
                    ? "Start the free trial to add another kid." : model.copy.offline
            }
        }
    }
}

extension FlowModel {
    /// Adds the kid (a profile even without the plan: the owner's "Not now"), becomes them, saves
    /// their grade, makes the first board and files the try as their first attempt.
    func makeKidAndBoard() async throws {
        let a = state.answers
        let name = a.name ?? "Me"
        let kid: MadeKid
        if let made = madeKid {
            kid = made
        } else {
            kid = try await backend.addKid(name: name, grade: a.choice?.grade, avatar: (a.picture ?? .tomato).avatarId)
            madeKid = kid
            record("start_kid_added")
        }
        try await backend.switchTo(kid.userId)
        try? await backend.saveKid(choice: a.choice)
        let title = a.name.map { "\($0)’s first board" } ?? "My first board"
        let boardId = try? await backend.createBoard(title: title)
        let made = await FirstBoardMaker.make(answers: a, seed: boardSeed, boardId: boardId)
        firstBoardMade = made
        if let boardId { _ = await backend.saveBoard(id: boardId, document: made.document) }
        firstBoard = FirstBoardHandoff(boardId: boardId, document: made.document, kidName: a.name, welcome: copy.welcome)
        if let t = a.tries.first(where: { $0.checked }) ?? a.tries.first, let p = OnboardingCatalog.shared.problem(t.problemId) {
            let skill = p.skill ?? Plan.firstSkill(a) ?? "add_within_10"
            await backend.recordAttempt(FirstAttempt(
                boardId: boardId, problemLatex: p.lines.joined(separator: " "), skill: skill,
                course: a.choice?.course, solvedAlone: t.solved && !t.helped, helped: t.helped, rings: t.rings,
                startedAt: t.startedAt, finishedAt: Date()))
        }
        record("start_first_board")
    }
}

// MARK: - sign in

struct SignInScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var note: String?

    var body: some View {
        let c = model.copy
        VStack(spacing: 0) {
            Color.clear.frame(height: layout.contentTop)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(c.welcomeBackLede).dsFont(.body).foregroundStyle(DS.Color.inkSecondary).reveal(0)
                    GrownUpField(title: c.email, text: $email, kind: .email).frame(maxWidth: 440).reveal(1)
                    GrownUpField(title: c.password, text: $password, kind: .password).frame(maxWidth: 440)
                        .submitLabel(.go)
                        .onSubmit { signIn() }
                        .reveal(2)
                    if let note {
                        Text(note).dsFont(.callout).foregroundStyle(DS.Color.ink)
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .background(Capsule().fill(DS.Color.tryAgain))
                    }
                    HStack(spacing: 12) {
                        PillButton(busy ? "Signing in…" : c.signIn, icon: .forward, kind: .sunny, size: .large) { signIn() }
                            .disabled(busy || !email.contains("@") || password.isEmpty)
                        Button(c.forgotPassword) { reset() }.buttonStyle(.pill(.quiet))
                    }
                    .padding(.top, 8)
                    .reveal(3)
                }
                .padding(.horizontal, layout.margin)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private func signIn() {
        busy = true
        note = nil
        Task {
            defer { busy = false }
            do {
                try await model.backend.signIn(email: email, password: password)
                await model.afterSignIn()
            } catch {
                note = AuthService.message(for: error)
            }
        }
    }

    private func reset() {
        guard email.contains("@") else { note = "Type your email first."; return }
        Task {
            try? await model.backend.sendPasswordReset(email: email)
            note = model.copy.resetSent
        }
    }
}

extension FlowModel {
    /// Signed in: a family with kids goes Home (the switcher's picker is the screens lane's); an
    /// iPad holding an unsaved plan offers to add the kid; anyone else goes Home.
    func afterSignIn() async {
        state.hasPlan = await hasPlanNow()
        let family = try? await backend.family()
        let hasKids = family?.members.contains { !$0.isParent } ?? false
        let holdsPlan = state.answers.role != nil && state.answers.choice != nil
        if holdsPlan, !hasKids || state.hasPlan, family?.role != .kid {
            go(.addToFamily)
        } else {
            state.finish()
            onFinish(.signedIn)
        }
    }
}

struct AddToFamilyScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var hasPin = false

    var body: some View {
        let c = model.copy
        VStack(alignment: .leading, spacing: 24) {
            Text(c.addLede).dsFont(.body).foregroundStyle(DS.Color.inkSecondary).reveal(0)
            HStack(spacing: 16) {
                Button(c.notNow) {
                    model.state.finish()
                    model.onFinish(.signedIn)
                }
                .buttonStyle(.pill(.quiet, size: .large))
                PillButton(c.addYes, icon: .plus, kind: .sunny, size: .large) {
                    if !model.state.hasPlan { model.go(.trial) } else { model.go(hasPin ? .handOver : .pin) }
                }
            }
            .reveal(1)
        }
        .padding(.horizontal, layout.margin)
        .padding(.top, layout.contentTop)
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { hasPin = (try? await model.backend.family().hasPin) ?? false }
    }
}
