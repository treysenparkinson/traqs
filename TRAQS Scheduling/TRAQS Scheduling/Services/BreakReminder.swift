import Foundation
import UserNotifications

// MARK: - BreakReminder
//
// Schedules a single local notification that fires ~2 minutes before a
// worker's configured break duration elapses. Local (not OneSignal push)
// because the duration is known at break-start time, so an on-device timer
// is simpler and fires reliably even offline. OneSignal already requested
// notification authorization at launch (TRAQS_SchedulingApp.init), so we
// reuse that grant; we still request defensively if it's undetermined.

enum BreakReminder {
    private static let identifier = "break-ending"
    /// Minutes before the break's end to nudge the worker.
    private static let leadMinutes = 2

    /// Schedule the "break ending soon" reminder for a break of
    /// `durationMinutes`. Replaces any existing pending reminder. If the
    /// break is shorter than the lead time, fire a few seconds out so the
    /// worker still gets a heads-up.
    static func schedule(durationMinutes: Int) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])

        let leadSeconds = Double(max(0, durationMinutes - leadMinutes)) * 60
        let interval = max(5, leadSeconds)   // UNTimeIntervalTrigger requires > 0

        let content = UNMutableNotificationContent()
        content.title = "Break ending soon"
        content.body = durationMinutes > leadMinutes
            ? "Your break ends in \(leadMinutes) minutes."
            : "Your break is about to end."
        content.sound = .default

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)

        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                center.add(request)
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                    if granted { center.add(request) }
                }
            default:
                break   // denied — nothing we can do silently
            }
        }
    }

    /// Cancel the pending reminder — call when the worker ends the break.
    static func cancel() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
    }
}
