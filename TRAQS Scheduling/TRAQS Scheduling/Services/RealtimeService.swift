import Foundation
import Ably

// Coarse connection status surfaced to AppState for the Phase 6 sync-status
// indicator. `.degraded` = real-time disabled (503 preflight) — the app polls
// instead, so the indicator should stay quiet rather than nag "reconnecting".
enum RealtimeStatus { case connecting, connected, disconnected, degraded }

// Ably realtime subscriber (mirrors the desktop src/realtime/ably.js). Deferred
// until connect() runs after login. The device never sees ABLY_ROOT_KEY — it
// authenticates through /.netlify/functions/ably-token (fetched fresh each time
// via APIService, so the Auth0 token is always valid). @MainActor: Ably delivers
// callbacks on the main queue by default, and we hop to main defensively anyway.
@MainActor
final class RealtimeService {
    private var client: ARTRealtime?
    private var orgCode = ""
    private var degraded = false
    private var hasConnected = false
    private var channels: [ARTRealtimeChannel] = []
    private var onChange: (() -> Void)?
    private var onReconnect: (() -> Void)?
    private var onStatus: ((RealtimeStatus) -> Void)?

    private static let entities = ["tasks", "people", "clients", "messages", "groups", "timeclock", "orgConfig", "settings"]

    var isDegraded: Bool { degraded }

    func connect(orgCode: String,
                 api: APIService,
                 onChange: @escaping () -> Void,
                 onReconnect: @escaping () -> Void,
                 onStatus: @escaping (RealtimeStatus) -> Void = { _ in }) async {
        if client != nil || degraded {
            print("[ably] connect() ignored (connected: \(client != nil), degraded: \(degraded))")
            return
        }
        print("[ably] connect() orgCode=\"\(orgCode)\"")
        self.orgCode = orgCode
        self.onChange = onChange
        self.onReconnect = onReconnect
        self.onStatus = onStatus
        onStatus(.connecting)

        // Preflight probe so a "real-time not configured" (503) degrades cleanly
        // instead of spinning Ably's auth-retry loop forever.
        do {
            _ = try await api.fetchAblyTokenData()
        } catch let e as APIError {
            if case .httpError(503) = e {
                degraded = true
                onStatus(.degraded)
                print("[ably] disabled — /ably-token returned 503 (real-time not configured). No live updates.")
                return
            }
            print("[ably] token preflight error (connecting anyway): \(e)")
        } catch {
            print("[ably] token preflight error (connecting anyway): \(error)")
        }

        let options = ARTClientOptions()
        options.authCallback = { _, callback in
            Task { @MainActor in
                do {
                    let data = try await api.fetchAblyTokenData()
                    guard let json = try JSONSerialization.jsonObject(with: data) as? NSDictionary else {
                        callback(nil, NSError(domain: "Realtime", code: -1)); return
                    }
                    let tokenRequest = try ARTTokenRequest.fromJson(json)
                    callback(tokenRequest, nil)
                } catch {
                    callback(nil, error)
                }
            }
        }

        let realtime = ARTRealtime(options: options)
        client = realtime

        realtime.connection.on { [weak self] change in
            let current = change.current
            let previous = change.previous
            let reason = change.reason?.message
            Task { @MainActor in
                guard let self else { return }
                print("[ably] connection: \(ARTRealtimeConnectionStateToStr(previous)) → \(ARTRealtimeConnectionStateToStr(current))" + (reason.map { " reason=\($0)" } ?? ""))
                // Surface a coarse status for the sync indicator.
                switch current {
                case .connected:              self.onStatus?(.connected)
                case .connecting, .initialized: self.onStatus?(.connecting)
                default:                      self.onStatus?(.disconnected)  // disconnected/suspended/closing/closed/failed
                }
                if current == .connected {
                    // On a RE-connect (not the first), pull the delta to catch
                    // anything published while we were offline.
                    if self.hasConnected { self.onReconnect?() }
                    self.hasConnected = true
                }
            }
        }

        for entity in Self.entities {
            let name = "org-\(orgCode):\(entity)"
            let channel = realtime.channels.get(name)
            channels.append(channel)
            channel.subscribe("changed") { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.onChange?()
                }
            }
        }
    }

    func disconnect() {
        for ch in channels { ch.unsubscribe() }
        channels.removeAll()
        client?.close()
        client = nil
        orgCode = ""
        degraded = false
        hasConnected = false
        onChange = nil
        onReconnect = nil
        onStatus = nil
    }
}
