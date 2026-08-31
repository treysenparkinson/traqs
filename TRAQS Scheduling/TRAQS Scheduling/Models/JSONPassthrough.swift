import Foundation

// MARK: - Keeping the fields Swift does not model
//
// `tasks.json` is written by the web app, and the web app is a 30,000-line React
// component that puts whatever it likes on a job. Swift models a subset of that:
// `Panel` carries 17 fields where the web writes 29, and the custom-columns
// feature stores its values under DYNAMIC keys (`_cc_<uuid>`) that a static
// struct cannot describe at all.
//
// That subset would be fine if Swift only ever read. It does not. `saveJobs`
// re-encodes the whole `[Job]` array and POSTs it, and `tasks.js` replaces the
// object rather than merging field by field — so every key Swift did not model
// is DESTROYED the moment anyone edits a cell. Demonstrably:
//
//     IN : {"id":"p1","title":"Panel A","depsMode":"locked","apprChain":[…],"qty":12}
//     OUT: {"id":"p1","title":"Panel A"}
//
// Approval chains, sign-offs, the approval log, required departments, panel
// colours, quantities, start/end hours, dependency modes and every custom-column
// value, gone org-wide on one keystroke.
//
// So each model keeps what it could not name. On the way in, every key the struct
// does not know about is captured verbatim; on the way out it is written back
// first and the modelled fields are written over the top. Nothing has to be
// enumerated, nothing goes stale when the web adds a field next week, and the
// dynamic `_cc_` keys are covered by the same rule as everything else.
//
// The `Operation.finishRequest` comment already recorded half of this lesson —
// that modelling completion requests only on `Job` meant iOS silently stripped
// them. This is that lesson applied generally instead of one field at a time.

// MARK: Any JSON value

/// Arbitrary JSON, held losslessly.
///
/// Deliberately NOT `Any`: this round-trips through `Codable` unchanged, which is
/// the entire requirement, and it keeps the models `Sendable`-friendly.
///
/// Numbers are kept as `Double`. JSON has one number type and every value the web
/// writes here is a count, an hour or a timestamp — none of them large enough for
/// a Double to lose a digit.
enum JSONValue: Codable, Equatable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        // Order matters. `Bool` first: JSONDecoder will happily read `true` as a
        // number 1 on some platforms, and writing 1 back where the web expects
        // `true` is its own quiet corruption.
        if c.decodeNil() { self = .null; return }
        if let v = try? c.decode(Bool.self) { self = .bool(v); return }
        if let v = try? c.decode(Double.self) { self = .number(v); return }
        if let v = try? c.decode(String.self) { self = .string(v); return }
        if let v = try? c.decode([JSONValue].self) { self = .array(v); return }
        if let v = try? c.decode([String: JSONValue].self) { self = .object(v); return }
        throw DecodingError.dataCorruptedError(
            in: c, debugDescription: "Value is not JSON")
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v):   try c.encode(v)
        case .object(let v): try c.encode(v)
        case .array(let v):  try c.encode(v)
        case .null:          try c.encodeNil()
        }
    }
}

// MARK: A key that is whatever the JSON said

/// Lets a container be opened without knowing the keys in advance — which is the
/// only way to discover keys the struct was never told about.
struct JSONAnyKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

// MARK: The bag

/// Every key an object carried that its Swift model does not name.
///
/// Empty for anything Swift created itself, which is correct: a job this app just
/// built has no history of unmodelled fields to preserve.
struct JSONExtras: Equatable, Sendable {
    private var values: [String: JSONValue] = [:]

    init() {}

    /// Capture. `known` is the model's own key set, and everything outside it is
    /// kept.
    ///
    /// FAILS SOFT. A malformed object must not abort the decode — the whole model
    /// layer is written that way (`try?` around every field, so one bad job cannot
    /// blank the list), and losing the passthrough on a broken record is a far
    /// smaller problem than losing the record.
    init(from decoder: Decoder, known: Set<String>) {
        guard let c = try? decoder.container(keyedBy: JSONAnyKey.self) else { return }
        for key in c.allKeys where !known.contains(key.stringValue) {
            guard let value = try? c.decode(JSONValue.self, forKey: key) else { continue }
            values[key.stringValue] = value
        }
    }

    /// Write the kept keys back.
    ///
    /// MUST be called FIRST in a model's `encode(to:)`, before the modelled
    /// fields, so that a modelled field always wins over a stale captured one.
    /// The two write into the same underlying object — asking an encoder for a
    /// second keyed container with different keys merges rather than replaces.
    func encode(to encoder: Encoder) throws {
        guard !values.isEmpty else { return }
        var c = encoder.container(keyedBy: JSONAnyKey.self)
        for (key, value) in values {
            try c.encode(value, forKey: JSONAnyKey(stringValue: key))
        }
    }

    // MARK: Reading one

    /// For the handful of unmodelled fields the app needs to READ — a custom
    /// column's value, a panel's approval chain — without promoting each to a
    /// typed property.
    subscript(key: String) -> JSONValue? {
        get { values[key] }
        set { values[key] = newValue }
    }

    /// Whatever is there, as display text — "" when the key is absent. What a
    /// custom-column cell wants: it renders a string whatever the column's
    /// declared type, and the web is loose about which JSON type it stored.
    func text(_ key: String) -> String { values[key]?.text ?? "" }

    func string(_ key: String) -> String? {
        if case .string(let s) = values[key] { return s }
        return nil
    }

    func double(_ key: String) -> Double? {
        if case .number(let d) = values[key] { return d }
        // The web stores a number typed into a text column as a string.
        if case .string(let s) = values[key] { return Double(s) }
        return nil
    }

    /// Checkbox columns. The web writes `String(!checked)`, so "true"/"false"
    /// strings are as common as real booleans.
    func bool(_ key: String) -> Bool {
        switch values[key] {
        case .bool(let b):   return b
        case .string(let s): return s == "true"
        case .number(let d): return d != 0
        default:             return false
        }
    }

    /// Set or clear one. Clearing REMOVES the key rather than writing null — the
    /// web tests these with `!value`, and an explicit null is a different record
    /// than an absent field to anything that iterates the object's keys.
    mutating func set(_ key: String, _ value: JSONValue?) {
        values[key] = value
    }

    var isEmpty: Bool { values.isEmpty }
    var keys: [String] { Array(values.keys) }
}

extension JSONValue {
    /// The value as text, however the web wrote it. Custom-column cells display a
    /// string whatever the column's declared type, and the web is loose about
    /// which JSON type it stores — a number column round-trips as a number when
    /// typed in, and as a string when imported.
    var text: String {
        switch self {
        case .string(let s): return s
        // No trailing ".0" on a whole number: the web prints `12`, not `12.0`,
        // and a Progress or Budget column showing the latter looks broken.
        case .number(let d): return d == d.rounded() && abs(d) < 1e15
            ? String(Int(d)) : String(d)
        case .bool(let b):   return b ? "true" : "false"
        case .null:          return ""
        case .array, .object: return ""
        }
    }
}
