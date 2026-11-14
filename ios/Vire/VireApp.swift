import AVFoundation
import SwiftUI

@main
struct VireApp: App {
    init() {
        // Keep AirPods on the high-quality stereo route while the phone's own mic records.
        // WebKit may override this once the page starts capture; the Lab page shows the real route.
        try? AVAudioSession.sharedInstance().setCategory(
            .playAndRecord, mode: .default, options: [.allowBluetoothA2DP, .defaultToSpeaker])
    }

    var body: some Scene {
        WindowGroup {
            WebShell()
                .ignoresSafeArea()
                .preferredColorScheme(.dark)
                .statusBarHidden(true)
        }
    }
}
