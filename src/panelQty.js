// A PANEL WITH `qty` > 1 BECOMES qty PANELS, one way (#485).
//
// `qty` is a property of a pending save in the wizard: "when this draft is written, emit N
// panels" (#484). Three places expanded it — the wizard's Save, the scheduler, and Schedule
// Later — and Schedule Later forgot to give the copies' OPS fresh ids, so qty 3 stored three
// panels holding the same op ids. This is the one expansion:
//   - copy 0 keeps the original panel and op ids, so a draft's existing ids survive;
//   - every later copy gets a fresh panel id and fresh op ids, with each op's deps remapped to
//     the ops of ITS OWN copy;
//   - copies are titled from the base ("Panel-007" → "Panel-001", "-002", …); a single copy
//     keeps its title;
//   - `qty` is stripped; `cleanDeps` is applied to every deps list (the wizard drops its
//     "__pending__" placeholder).
// Pure: `uid` is passed in.
export function expandQty(panel, { uid, cleanDeps = (d) => d || [] }) {
  const qty = Math.max(1, Math.min(999, parseInt(panel?.qty) || 1));
  const { qty: _q, ...rest } = panel;
  const subs = rest.subs || [];
  if (qty === 1) {
    return [{ ...rest, deps: cleanDeps(rest.deps), subs: subs.map(s => ({ ...s, deps: cleanDeps(s.deps) })) }];
  }
  const baseTitle = String(panel.title || "").replace(/-\d+$/, "").trimEnd();
  return Array.from({ length: qty }, (_, i) => {
    const idMap = {};
    subs.forEach(s => { idMap[s.id] = i === 0 ? s.id : uid(); });
    return {
      ...rest,
      id: i === 0 ? panel.id : uid(),
      title: `${baseTitle}-${String(i + 1).padStart(3, "0")}`,
      deps: cleanDeps(rest.deps),
      subs: subs.map(s => ({ ...s, id: idMap[s.id], deps: cleanDeps((s.deps || []).map(d => idMap[d] || d)) })),
    };
  });
}
