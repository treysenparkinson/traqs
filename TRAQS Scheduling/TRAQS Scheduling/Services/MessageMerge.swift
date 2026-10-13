import Foundation

/// Pure helpers for folding a freshly loaded message list into what's on screen.
enum MessageMerge {
    /// `incoming` with any of `outgoing` (sends still in flight) it doesn't carry
    /// yet, in time order. Timestamps are ISO-8601 strings, so they sort as text.
    ///
    /// A refresh that lands mid-send loads a list the server or cache hasn't got the
    /// message in yet; replacing the list with it dropped the bubble until the send
    /// completed and put it back. Untouched when nothing is missing, so the common
    /// case returns the incoming list as is.
    static func keepingOutgoing(_ incoming: [Message], outgoing: [Message]) -> [Message] {
        let have = Set(incoming.map(\.id))
        let missing = outgoing.filter { !have.contains($0.id) }
        guard !missing.isEmpty else { return incoming }
        return (incoming + missing).sorted { $0.timestamp < $1.timestamp }
    }
}
