import Foundation
import Testing
@testable import Agathon

struct AppConfigTests {
    @Test func apiIsHTTPS() {
        // A Debug run may point at http://localhost; everything else is production over HTTPS.
        let url = AppConfig.apiBaseURL
        #expect(url.scheme == "https" || url.host == "localhost" || url.host == "127.0.0.1")
    }

    @Test func versionComesFromTheBundle() {
        #expect(!AppConfig.version.isEmpty)
        #expect(!AppConfig.build.isEmpty)
    }
}
