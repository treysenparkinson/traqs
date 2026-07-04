import Foundation

enum APIError: LocalizedError {
    case noToken
    case noOrgCode
    case httpError(Int)
    case decodingError(Error)
    case unknown(Error)

    var errorDescription: String? {
        switch self {
        case .noToken: return "Not authenticated"
        case .noOrgCode: return "No org code set"
        case .httpError(401): return "Error: 401 (Log out, and log back in)"
        case .httpError(let code): return "Server error \(code)"
        case .decodingError(let e): return "Decode error: \(e.localizedDescription)"
        case .unknown(let e): return e.localizedDescription
        }
    }
}

struct APIService {
    let auth: AuthManager
    let orgCode: String
    private let base = AppConfig.netlifyBase
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    // MARK: - Request Builder

    private func request(_ path: String, method: String = "GET", body: Data? = nil) async throws -> URLRequest {
        guard let url = URL(string: "\(base)/\(path)") else {
            throw URLError(.badURL)
        }
        // Fetch a valid access token *per request*. If the cached token
        // is expired, AuthManager refreshes it now — this is what closes
        // the "401 until you log out and back in" gap. Refresh is
        // deduped server-side via a shared Task, so a burst of parallel
        // requests rotates the refresh token at most once.
        let token = try await auth.validAccessToken()
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue(orgCode, forHTTPHeaderField: "X-Org-Code")
        // Bypass URLSession's HTTP cache. The Netlify functions don't emit
        // Cache-Control headers, so URLSession's heuristic freshness can
        // serve a stale body — which on the messaging endpoints means the
        // tester's device never sees newly posted messages until the cache
        // entry naturally expires.
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    private func perform(_ req: URLRequest, alreadyRetried: Bool = false) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: req)

        // On 401, force a refresh and retry once with the new token.
        // This covers the common case (access token expired in the
        // background while the user was in the app) and the older
        // JWKS-cold-start case in one path: the refresh round-trip
        // itself gives the function ~100-500ms to warm, and the retry
        // carries a freshly-minted token. Retry is safe — every server
        // handler validates the token BEFORE mutating state, so a 401
        // means no side effects occurred.
        if let http = response as? HTTPURLResponse, http.statusCode == 401, !alreadyRetried {
            do {
                let newToken = try await auth.refreshAccessToken()
                var retry = req
                retry.setValue("Bearer \(newToken)", forHTTPHeaderField: "Authorization")
                return try await perform(retry, alreadyRetried: true)
            } catch {
                // Refresh failed (no refresh token, revoked, network).
                // AuthManager has already torn down auth state and
                // RootView will swap in LoginView; surface 401 to the
                // caller so any in-flight UI can finish.
                throw APIError.httpError(401)
            }
        }

        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw APIError.httpError(http.statusCode)
        }
        return data
    }

    // MARK: - Tasks (Jobs)

    func fetchJobs() async throws -> [Job] {
        let req = try await request("tasks")
        let data = try await perform(req)
        return try decoder.decode([Job].self, from: data)
    }

    // MARK: - Live sync (Phase 4)

    /// Delta-sync snapshot. `since` = the cursor from the last response; nil/empty
    /// → full snapshot. Returns raw JSON so SyncService can store per-record blobs.
    func fetchSyncData(since: String?) async throws -> Data {
        var path = "sync"
        if let since, !since.isEmpty {
            let q = since.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? since
            path += "?since=\(q)"
        }
        let req = try await request(path)
        return try await perform(req)
    }

    /// Ably TokenRequest JSON for the realtime auth callback. Throws
    /// APIError.httpError(503) when real-time isn't configured server-side.
    func fetchAblyTokenData() async throws -> Data {
        let req = try await request("ably-token", method: "POST")
        return try await perform(req)
    }

    func saveJobs(_ jobs: [Job]) async throws {
        let body = try JSONEncoder().encode(jobs)
        let req = try await request("tasks", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - People

    func fetchPeople() async throws -> [Person] {
        let req = try await request("people")
        let data = try await perform(req)
        return try decoder.decode([Person].self, from: data)
    }

    func savePeople(_ people: [Person]) async throws {
        let body = try JSONEncoder().encode(people)
        let req = try await request("people", method: "POST", body: body)
        _ = try await perform(req)
    }

    /// Patch only the supplied fields of a single person. Prevents the
    /// race where iOS writes the entire people array and clobbers a
    /// concurrent server-side mutation like jobClockIn that touches one
    /// field of one person. Use this for granular updates (push token,
    /// role toggle, etc.) instead of savePeople.
    func patchPerson(personId: String, fields: [String: Any]) async throws {
        let body = try JSONSerialization.data(
            withJSONObject: ["personId": personId, "fields": fields],
            options: []
        )
        let req = try await request("people", method: "PATCH", body: body)
        _ = try await perform(req)
    }

    // MARK: - Clients

    func fetchClients() async throws -> [Client] {
        let req = try await request("clients")
        let data = try await perform(req)
        return try decoder.decode([Client].self, from: data)
    }

    func saveClients(_ clients: [Client]) async throws {
        let body = try JSONEncoder().encode(clients)
        let req = try await request("clients", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Messages

    func fetchMessages() async throws -> [Message] {
        let req = try await request("messages")
        let data = try await perform(req)
        return try decoder.decode([Message].self, from: data)
    }

    func sendMessage(_ message: Message) async throws -> Message {
        let body = try JSONEncoder().encode(message)
        let req = try await request("messages", method: "POST", body: body)
        let data = try await perform(req)
        return try decoder.decode(Message.self, from: data)
    }

    func deleteThread(threadKey: String) async throws {
        let encoded = threadKey.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? threadKey
        let req = try await request("messages?threadKey=\(encoded)", method: "DELETE")
        _ = try await perform(req)
    }

    // MARK: - Read receipts

    /// Per-thread, per-person "read up to" cursors:
    /// `[threadKey: [personId: ISO8601 read-up-to timestamp]]`. Scoped
    /// server-side to threads the viewer participates in.
    func fetchReadReceipts() async throws -> [String: [String: String]] {
        let req = try await request("message-reads")
        let data = try await perform(req)
        return try decoder.decode([String: [String: String]].self, from: data)
    }

    /// Advance the current user's read cursor for a thread (monotonic
    /// server-side). `at` is the "read up to" timestamp — typically the newest
    /// message's timestamp in the thread.
    func postReadReceipt(threadKey: String, at: String) async throws {
        let body = try JSONSerialization.data(
            withJSONObject: ["threadKey": threadKey, "at": at], options: [])
        let req = try await request("message-reads", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Groups

    func fetchGroups() async throws -> [ChatGroup] {
        let req = try await request("groups")
        let data = try await perform(req)
        return try decoder.decode([ChatGroup].self, from: data)
    }

    func saveGroups(_ groups: [ChatGroup]) async throws {
        let body = try JSONEncoder().encode(groups)
        let req = try await request("groups", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Org Settings (GET is unauthenticated server-side; we still send auth headers harmlessly)

    func fetchOrgSettings() async throws -> OrgSettings {
        let req = try await request("settings")
        let data = try await perform(req)
        return try decoder.decode(OrgSettings.self, from: data)
    }

    func saveOrgSettings(_ settings: OrgSettings) async throws {
        let body = try JSONEncoder().encode(settings)
        let req = try await request("settings", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Time Off Requests
    // Approval workflow on top of person.timeOff. Members submit + cancel their
    // own; admins decide on the desktop. GET returns only the caller's own
    // requests for a member (server-filtered).

    private struct TimeOffListResponse: Decodable { let requests: [TimeOffRequest] }
    private struct TimeOffOneResponse: Decodable { let request: TimeOffRequest }

    func fetchTimeOffRequests() async throws -> [TimeOffRequest] {
        let req = try await request("timeoff")
        let data = try await perform(req)
        return try decoder.decode(TimeOffListResponse.self, from: data).requests
    }

    @discardableResult
    func submitTimeOff(type: String, start: String, end: String, note: String) async throws -> TimeOffRequest {
        let body = try JSONSerialization.data(withJSONObject: [
            "type": type, "start": start, "end": end, "note": note,
        ])
        let req = try await request("timeoff", method: "POST", body: body)
        let data = try await perform(req)
        return try decoder.decode(TimeOffOneResponse.self, from: data).request
    }

    @discardableResult
    func cancelTimeOff(id: String) async throws -> TimeOffRequest {
        let body = try JSONSerialization.data(withJSONObject: [
            "id": id, "action": "cancel",
        ])
        let req = try await request("timeoff", method: "PATCH", body: body)
        let data = try await perform(req)
        return try decoder.decode(TimeOffOneResponse.self, from: data).request
    }

    /// Approve or deny a request (admin only — the server enforces the role).
    @discardableResult
    func decideTimeOff(id: String, action: String, reason: String = "") async throws -> TimeOffRequest {
        let body = try JSONSerialization.data(withJSONObject: [
            "id": id, "action": action, "reason": reason,
        ])
        let req = try await request("timeoff", method: "PATCH", body: body)
        let data = try await perform(req)
        return try decoder.decode(TimeOffOneResponse.self, from: data).request
    }

    // MARK: - Attachments

    /// Upload a single binary attachment. `data` should be raw bytes;
    /// they're base64-encoded before posting because the server expects
    /// either a `data:<mime>;base64,...` URL string or plain base64.
    struct AttachmentResult: Decodable {
        let key: String
        let filename: String
        let mimeType: String
        let size: Int
    }
    func uploadAttachment(filename: String, mimeType: String, data: Data) async throws -> AttachmentResult {
        let base64 = data.base64EncodedString()
        let body = try JSONSerialization.data(withJSONObject: [
            "filename": filename,
            "mimeType": mimeType,
            "data": "data:\(mimeType);base64,\(base64)",
        ])
        let req = try await request("attachment", method: "POST", body: body)
        let resp = try await perform(req)
        return try decoder.decode(AttachmentResult.self, from: resp)
    }

    // MARK: - Forgot org code (unauthenticated)

    /// Trigger a "your org codes" recovery email. Server is silent about
    /// whether the email matched anything, to prevent enumeration.
    static func forgotOrgCode(email: String) async throws {
        guard let url = URL(string: "\(AppConfig.netlifyBase)/forgot-org") else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["email": email])
        let (_, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw APIError.httpError(http.statusCode)
        }
    }

    // MARK: - Admin timeclock (Bearer-only)

    private struct AdminClockTimePayload: Encodable {
        let action: String
        let personId: String
        let clockInTime: String?
        let clockOutTime: String?
        let note: String?
    }

    /// Admin force-clocks a person in. `clockInTime` is optional; if nil,
    /// the server uses its own clock.
    func adminClockIn(personId: String, clockInTime: String? = nil) async throws {
        let body = try JSONEncoder().encode(AdminClockTimePayload(
            action: "adminClockIn", personId: personId,
            clockInTime: clockInTime, clockOutTime: nil, note: nil))
        let req = try await request("timeclock", method: "POST", body: body)
        _ = try await perform(req)
    }

    /// Admin force-clocks a person out. Optionally annotate the entry.
    func adminClockOut(personId: String, clockOutTime: String? = nil, note: String? = nil) async throws {
        let body = try JSONEncoder().encode(AdminClockTimePayload(
            action: "adminClockOut", personId: personId,
            clockInTime: nil, clockOutTime: clockOutTime, note: note))
        let req = try await request("timeclock", method: "POST", body: body)
        _ = try await perform(req)
    }

    private struct AdminEditEntryPayload: Encodable {
        let action = "adminEditEntry"
        let entryId: String
        let clockIn: String
        let clockOut: String
    }

    /// Admin edits an existing timeclock entry's clockIn/clockOut.
    /// Server recalculates `hours` and `date` from `clockIn`.
    func adminEditEntry(entryId: String, clockIn: String, clockOut: String) async throws {
        let body = try JSONEncoder().encode(AdminEditEntryPayload(
            entryId: entryId, clockIn: clockIn, clockOut: clockOut))
        let req = try await request("timeclock", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Notify

    func sendNotification(_ payload: NotifyPayload) async throws {
        let body = try JSONEncoder().encode(payload)
        let req = try await request("notify", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Time Clock

    private struct TimeclockIdentifyPayload: Encodable {
        let action = "identify"
        let pin: String
    }

    struct TimeclockIdentifyResponse: Decodable {
        var personId: String
        var name: String
        var activeClockIn: ActiveClockIn?

        enum CodingKeys: String, CodingKey { case personId, name, activeClockIn }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            personId     = (try? c.decodeFlexID(forKey: .personId)) ?? ""
            name         = (try? c.decode(String.self, forKey: .name)) ?? ""
            activeClockIn = try? c.decodeIfPresent(ActiveClockIn.self, forKey: .activeClockIn)
        }
    }

    private struct TimeclockClockInPayload: Encodable {
        let action = "clockIn"
        let personId: String
        let pin: String
        let jobRefs: [JobRef]
    }

    private struct TimeclockClockInResponse: Decodable {
        var clockIn: String
    }

    private struct TimeclockSimplePayload: Encodable {
        let action: String
        let personId: String
        let pin: String
    }

    private struct TimeclockFinishPayload: Encodable {
        let action = "finishRequest"
        let personId: String
        let pin: String
        let jobId: String
        let panelId: String
        let opId: String
    }

    func timeclockIdentify(pin: String) async throws -> TimeclockIdentifyResponse {
        let body = try JSONEncoder().encode(TimeclockIdentifyPayload(pin: pin))
        let req = try await request("timeclock", method: "POST", body: body)
        let data = try await perform(req)
        return try decoder.decode(TimeclockIdentifyResponse.self, from: data)
    }

    func timeclockClockIn(personId: String, pin: String, jobRefs: [JobRef]) async throws -> String {
        let body = try JSONEncoder().encode(TimeclockClockInPayload(personId: personId, pin: pin, jobRefs: jobRefs))
        let req = try await request("timeclock", method: "POST", body: body)
        let data = try await perform(req)
        let resp = try decoder.decode(TimeclockClockInResponse.self, from: data)
        return resp.clockIn
    }

    func timeclockClockOut(personId: String, pin: String) async throws {
        let body = try JSONEncoder().encode(TimeclockSimplePayload(action: "clockOut", personId: personId, pin: pin))
        let req = try await request("timeclock", method: "POST", body: body)
        _ = try await perform(req)
    }

    func timeclockEvent(action: String, personId: String, pin: String) async throws {
        let body = try JSONEncoder().encode(TimeclockSimplePayload(action: action, personId: personId, pin: pin))
        let req = try await request("timeclock", method: "POST", body: body)
        _ = try await perform(req)
    }

    func timeclockFinishRequest(personId: String, pin: String, jobId: String, panelId: String, opId: String) async throws {
        let body = try JSONEncoder().encode(TimeclockFinishPayload(personId: personId, pin: pin, jobId: jobId, panelId: panelId, opId: opId))
        let req = try await request("timeclock", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Timeclock history (read)

    /// Fetch historical timeclock entries. Optionally filter by personId
    /// — server-side filter avoids pulling the whole org's history.
    func fetchTimeclock(personId: String? = nil) async throws -> [TimeclockEntry] {
        let path = personId.map { "timeclock?personId=\($0)" } ?? "timeclock"
        let req = try await request(path)
        let data = try await perform(req)
        return try decoder.decode([TimeclockEntry].self, from: data)
    }

    /// Timestamped per-session job-clock log (jobsessions.json) for pay-period
    /// job-hours reporting. Scoped to the person server-side (non-admins → self).
    func fetchJobSessions(personId: String? = nil) async throws -> [JobSession] {
        var path = "timeclock?dataset=jobsessions"
        if let personId { path += "&personId=\(personId)" }
        let req = try await request(path)
        let data = try await perform(req)
        return try decoder.decode([JobSession].self, from: data)
    }

    // MARK: - Job Clock (Bearer-only, no PIN)

    private struct JobClockInPayload: Encodable {
        let action = "jobClockIn"
        let personId: String
        let jobId: String
        let panelId: String?
        let opId: String?
        let jobTitle: String?
        let panelTitle: String?
        let opTitle: String?
    }

    private struct JobClockSimplePayload: Encodable {
        let action: String
        let personId: String
    }

    func jobClockIn(personId: String, jobId: String,
                    panelId: String? = nil, opId: String? = nil,
                    jobTitle: String? = nil, panelTitle: String? = nil, opTitle: String? = nil) async throws {
        let body = try JSONEncoder().encode(JobClockInPayload(
            personId: personId, jobId: jobId, panelId: panelId, opId: opId,
            jobTitle: jobTitle, panelTitle: panelTitle, opTitle: opTitle))
        let req = try await request("timeclock", method: "POST", body: body)
        _ = try await perform(req)
    }

    func jobClockOut(personId: String) async throws {
        let body = try JSONEncoder().encode(JobClockSimplePayload(action: "jobClockOut", personId: personId))
        let req = try await request("timeclock", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Break (Bearer-only, no PIN) — lightweight status, not a clock pause

    private struct BreakBeginPayload: Encodable {
        let action = "breakBegin"
        let personId: String
        let durationMinutes: Int
    }

    /// Mark a worker on break. The job clock keeps running; this only sets a
    /// status + logs the break for payroll. `durationMinutes` is a snapshot
    /// of the configured break length used for the reminder + UI countdown.
    func breakBegin(personId: String, durationMinutes: Int) async throws {
        let body = try JSONEncoder().encode(BreakBeginPayload(personId: personId, durationMinutes: durationMinutes))
        let req = try await request("timeclock", method: "POST", body: body)
        _ = try await perform(req)
    }

    func breakEnd(personId: String) async throws {
        // "breakClear" (not "breakEnd") so this Bearer action doesn't collide
        // with the PIN-authenticated kiosk "breakEnd" handler.
        let body = try JSONEncoder().encode(JobClockSimplePayload(action: "breakClear", personId: personId))
        let req = try await request("timeclock", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Org Lookup

    static func lookupOrg(code: String) async throws -> OrgInfo {
        guard let url = URL(string: "\(AppConfig.netlifyBase)/org?code=\(code)") else {
            throw URLError(.badURL)
        }
        let (data, response) = try await URLSession.shared.data(from: url)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw APIError.httpError(http.statusCode)
        }
        return try JSONDecoder().decode(OrgInfo.self, from: data)
    }

    /// Resolve which orgs an authenticated user belongs to, by email. Used by
    /// the mobile app after Auth0 login to skip the manual org-code prompt.
    static func lookupOrgByEmail(email: String, token: String) async throws -> [OrgMatch] {
        let encoded = email.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? email
        guard let url = URL(string: "\(AppConfig.netlifyBase)/org-lookup?email=\(encoded)") else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw APIError.httpError(http.statusCode)
        }
        struct Wrapper: Decodable { let matches: [OrgMatch] }
        return try JSONDecoder().decode(Wrapper.self, from: data).matches
    }
}

struct OrgInfo: Decodable {
    let name: String?
    let domain: String?
    let adminEmail: String?
    let connection: String?
}

struct OrgMatch: Decodable, Hashable {
    let code: String
    let name: String?
    let domain: String?
    let adminEmail: String?
}
