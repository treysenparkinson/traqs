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
        case .httpError(let code): return "Server error \(code)"
        case .decodingError(let e): return "Decode error: \(e.localizedDescription)"
        case .unknown(let e): return e.localizedDescription
        }
    }
}

struct APIService {
    let token: String
    let orgCode: String
    private let base = AppConfig.netlifyBase
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    // MARK: - Request Builder

    private func request(_ path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let url = URL(string: "\(base)/\(path)") else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue(orgCode, forHTTPHeaderField: "X-Org-Code")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    private func perform(_ req: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw APIError.httpError(http.statusCode)
        }
        return data
    }

    // MARK: - Tasks (Jobs)

    func fetchJobs() async throws -> [Job] {
        let req = try request("tasks")
        let data = try await perform(req)
        return try decoder.decode([Job].self, from: data)
    }

    func saveJobs(_ jobs: [Job]) async throws {
        let body = try JSONEncoder().encode(jobs)
        let req = try request("tasks", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - People

    func fetchPeople() async throws -> [Person] {
        let req = try request("people")
        let data = try await perform(req)
        return try decoder.decode([Person].self, from: data)
    }

    func savePeople(_ people: [Person]) async throws {
        let body = try JSONEncoder().encode(people)
        let req = try request("people", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Clients

    func fetchClients() async throws -> [Client] {
        let req = try request("clients")
        let data = try await perform(req)
        return try decoder.decode([Client].self, from: data)
    }

    func saveClients(_ clients: [Client]) async throws {
        let body = try JSONEncoder().encode(clients)
        let req = try request("clients", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Messages

    func fetchMessages() async throws -> [Message] {
        let req = try request("messages")
        let data = try await perform(req)
        return try decoder.decode([Message].self, from: data)
    }

    func sendMessage(_ message: Message) async throws {
        let body = try JSONEncoder().encode(message)
        let req = try request("messages", method: "POST", body: body)
        _ = try await perform(req)
    }

    func deleteThread(threadKey: String) async throws {
        let encoded = threadKey.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? threadKey
        let req = try request("messages?threadKey=\(encoded)", method: "DELETE")
        _ = try await perform(req)
    }

    // MARK: - Groups

    func fetchGroups() async throws -> [ChatGroup] {
        let req = try request("groups")
        let data = try await perform(req)
        return try decoder.decode([ChatGroup].self, from: data)
    }

    func saveGroups(_ groups: [ChatGroup]) async throws {
        let body = try JSONEncoder().encode(groups)
        let req = try request("groups", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - Notify

    func sendNotification(_ payload: NotifyPayload) async throws {
        let body = try JSONEncoder().encode(payload)
        let req = try request("notify", method: "POST", body: body)
        _ = try await perform(req)
    }

    // MARK: - AI Schedule

    struct AIRequest: Encodable {
        let system: String
        let messages: [[String: String]]
        let max_tokens: Int
    }

    struct AIResponse: Decodable {
        struct Content: Decodable {
            let text: String?
            let type: String
        }
        let content: [Content]
    }

    func askAI(system: String, userMessage: String) async throws -> String {
        let payload = AIRequest(
            system: system,
            messages: [["role": "user", "content": userMessage]],
            max_tokens: 4096
        )
        let body = try JSONEncoder().encode(payload)
        let req = try request("ai-schedule", method: "POST", body: body)
        let data = try await perform(req)
        let response = try decoder.decode(AIResponse.self, from: data)
        return response.content.compactMap { $0.text }.joined()
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
}

struct OrgInfo: Decodable {
    let name: String?
    let domain: String?
    let adminEmail: String?
    let connection: String?
}
