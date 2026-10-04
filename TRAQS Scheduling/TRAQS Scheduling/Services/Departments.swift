import Foundation

// MARK: - Who may take a unit
//
// `unitDepartments`, `personDepartments`, `personDeptMatch` (src/scheduleRules.js) and
// `candidatesFor` (src/placement.js) — the web's settled rules since 4ee9598, "departments
// become sets":
//
//   - A unit's departments are the nearest of op, panel, job that states ANY, as a set. The
//     nearest level wins outright; a panel saying "Wire or Cut" is more specific than a job
//     saying "Layout", not additional to it. [] means anyone.
//   - Never inferred from the title. An op titled "Wire" with nothing stated is anyone's — the
//     title heuristic papered over "one department or none" being one encoding, and went with
//     the move to sets.
//   - A person holds their department and secondary department as a set; matching is
//     case-insensitive and has no primary-before-secondary ranking.
//   - Candidates: an existing team wins outright (unless none of it is on the roster); then
//     the department set; and when a stated department has nobody, NOBODY. No fallback to all
//     crew — that fallback is the funnel that put 71 ops on one person.
//
// Held to the JS by fixtures/schedule-parity.json (`candidates`). Pure.
enum Departments {

    /// `deptList` — any stored shape (a string, an array, nothing) as clean names.
    static func list(_ value: JSONValue?) -> [String] {
        switch value {
        case .array(let items)?:
            return items.compactMap { item -> String? in
                guard case .string(let s) = item else { return nil }
                let t = s.trimmingCharacters(in: .whitespaces)
                return t.isEmpty ? nil : t
            }
        case .string(let s)?:
            let t = s.trimmingCharacters(in: .whitespaces)
            return t.isEmpty ? [] : [t]
        default:
            return []
        }
    }

    /// A node's own departments: `requiredDepartments` when it is an array (even an empty
    /// one), else the legacy `requiredDepartment` string.
    static func of(_ extras: JSONExtras) -> [String] {
        if case .array? = extras["requiredDepartments"] { return list(extras["requiredDepartments"]) }
        return list(extras["requiredDepartment"])
    }

    /// `unitDepartments(node, panel, job)` — the nearest level that states any.
    static func unit(_ node: JSONExtras, panel: JSONExtras?, job: JSONExtras?) -> [String] {
        for level in [node, panel, job].compactMap({ $0 }) {
            let own = of(level)
            if !own.isEmpty { return own }
        }
        return []
    }

    /// `personDepartments` — department and secondary department. (`Person.role` is the
    /// `department` key, falling back to the legacy `role` on records that predate it.)
    static func person(_ p: Person) -> [String] {
        [p.role, p.secondaryDepartment]
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    /// `personDeptMatch` — whether `p` may take work requiring `required`. [] is anyone.
    static func matches(_ p: Person, _ required: [String]) -> Bool {
        guard !required.isEmpty else { return true }
        let mine = Set(person(p).map { $0.lowercased() })
        return required.contains { mine.contains($0.lowercased()) }
    }

    /// `candidatesFor` — the people on `crew` who may take a unit, in roster order.
    static func candidates(team: [String], departments: [String], crew: [Person]) -> [Person] {
        let named = team.filter { !$0.isEmpty }
        if !named.isEmpty {
            let kept = crew.filter { named.contains($0.id) }
            // The named people are not on the roster at all: the assignment is stale, not a
            // constraint to honour — fall through to departments.
            if !kept.isEmpty { return kept }
        }
        guard !departments.isEmpty else { return crew }
        return crew.filter { matches($0, departments) }
    }
}
