import Foundation
import Testing
@testable import Agathon

/// The picture tutor's switch on a device: its own choice wins; a device never switched takes the
/// account's default (`user_metadata.picture_tutor`, set by an admin on the server).
@MainActor
@Suite(.serialized)
struct PictureTutorDefaultTests {
    private func withDefaults(_ body: (UserDefaults) -> Void) {
        let saved = PictureTutorSettings.defaults
        let d = UserDefaults(suiteName: "test.picture.\(UUID())")!
        PictureTutorSettings.defaults = d
        body(d)
        PictureTutorSettings.defaults = saved
    }

    @Test func anUntouchedDeviceTakesTheAccountsDefault() {
        withDefaults { _ in
            #expect(PictureTutorSettings.deviceChoice == nil)
            #expect(PictureTutorSettings.isOn(accountDefault: true))
            #expect(!PictureTutorSettings.isOn(accountDefault: false))
            #expect(PictureTutorSettings.defaultMode == .suggest)
        }
    }

    @Test func theDevicesOwnChoiceWins() {
        withDefaults { d in
            d.set(false, forKey: PictureTutorSettings.enabledKey)
            #expect(PictureTutorSettings.deviceChoice == false)
            #expect(!PictureTutorSettings.isOn(accountDefault: true), "switched off here: off, whatever the account says")
            d.set(true, forKey: PictureTutorSettings.enabledKey)
            #expect(PictureTutorSettings.isOn(accountDefault: false), "switched on here: on")
        }
    }
}
