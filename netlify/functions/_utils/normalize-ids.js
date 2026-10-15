// TEAM MEMBERS ARE STRINGS IN THE STORE, whoever sent them (#411).
//
// The id cluster (#205-#208, #324) was measured latent: all live ids are strings. But nothing
// asserted it on the WRITE side, so one client POSTing `team: [99]` would revive it. #411
// asked for exactly this: "a normaliser in tasks.js that stringifies membership ids on write".
//
// MEMBERSHIP ONLY, deliberately. The web's own op editor has written team members as strings
// for months (#208), and every membership comparison is held on sameId by the lint (#410), so
// stringifying `team` changes nothing any client does not already do. Node ids and person ids
// are NOT touched: they are referenced from other stores (activeJobClock, timeclock and
// time-off records), and converting them here would half-migrate a legacy numeric org.
//
// A node that needs no change comes back as the SAME object, so stamping (which diffs by
// content) and the conflict check see nothing new.
const str = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : v);

export function stringifyTeams(nodes) {
  if (!Array.isArray(nodes)) return nodes;
  let changed = false;
  const out = nodes.map(n => {
    if (!n || typeof n !== "object") return n;
    let team = n.team;
    if (Array.isArray(team) && team.some(v => typeof v === "number")) team = team.map(str);
    const subs = Array.isArray(n.subs) ? stringifyTeams(n.subs) : n.subs;
    if (team === n.team && subs === n.subs) return n;
    changed = true;
    return { ...n, team, subs };
  });
  return changed ? out : nodes;
}
