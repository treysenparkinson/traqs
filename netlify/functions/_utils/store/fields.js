// Splitting a JSON record into typed columns + a verbatim `extra`, and joining it back.
// docs/db/schema-design.md "five rules": a known key goes to its column only when its value has
// the expected type and isn't null; everything else (unknown keys, explicit nulls, odd types)
// stays in `extra` exactly as stored, so join(split(x)) deep-equals x.

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// type -> [accepts(value), toColumn(value), fromColumn(columnValue)]
export const TYPES = {
  text: [(v) => typeof v === "string", (v) => v, (v) => v],
  num: [(v) => typeof v === "number" && Number.isFinite(v) && !Object.is(v, -0), (v) => v, (v) => Number(v)],
  bool: [(v) => typeof v === "boolean", (v) => v, (v) => v],
  ts: [(v) => typeof v === "string" && ISO_TS.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v,
    (v) => v, (v) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString())],
  date: [(v) => typeof v === "string" && ISO_DATE.test(v) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v,
    (v) => v, (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))],
  // JSON-valued column: any value at all except "absent". A JSON null is stored as the json `null`
  // literal, which the database distinguishes from SQL NULL (absent).
  json: [(v) => v !== undefined, (v) => ({ __json: v }), (v) => v],
  textArr: [(v) => Array.isArray(v) && v.every((x) => typeof x === "string"), (v) => v, (v) => v],
  intArr: [(v) => Array.isArray(v) && v.every((x) => Number.isInteger(x) && Math.abs(x) < 2 ** 31 && !Object.is(x, -0)), (v) => v, (v) => v.map(Number)],
  dateArr: [(v) => Array.isArray(v) && v.every((x) => TYPES.date[0](x)), (v) => v, (v) => v.map((x) => TYPES.date[2](x))],
};

/**
 * spec: [[jsonKey, column, type], ...]. Returns { cols, extra } where cols holds only the
 * accepted values (JSON-typed values wrapped as {__json}) and extra holds every other key, or
 * null when there is nothing left over.
 */
export function split(record, spec, { skip = [] } = {}) {
  const cols = {}, extra = {};
  const known = new Map(spec.map(([k, col, type]) => [k, [col, type]]));
  for (const [k, v] of Object.entries(record)) {
    if (skip.includes(k)) continue;
    const hit = known.get(k);
    if (hit && v !== null && TYPES[hit[1]][0](v)) cols[hit[0]] = TYPES[hit[1]][1](v);
    else if (hit && hit[1] === "json" && v === null) cols[hit[0]] = { __json: null };
    else extra[k] = v;
  }
  return { cols, extra: Object.keys(extra).length ? extra : null };
}

/** The inverse: a row (as read back from the database) plus its extra -> the JSON record. */
export function join(row, spec, extra) {
  const out = {};
  for (const [k, col, type] of spec) {
    const v = row[col];
    if (v === null || v === undefined) continue;
    out[k] = type === "json" ? unwrapJson(v) : TYPES[type][2](v);
  }
  if (extra) for (const [k, v] of Object.entries(extra)) out[k] = v;
  return out;
}

// A json column read back from the database is already parsed; written from a codec it is
// wrapped as {__json}. Accept both, so encode works on decode's output and on real rows.
// From the database (store/pg.js) a json column arrives as {__rawjson: text}, so JSON null stays
// distinct from SQL NULL.
export const unwrapJson = (v) => {
  if (v && typeof v === "object" && Object.keys(v).length === 1) {
    if ("__json" in v) return v.__json;
    if ("__rawjson" in v) return JSON.parse(v.__rawjson);
  }
  return v;
};
export const wrapJson = (v) => ({ __json: v });

/** A list of scalars (any JSON type) under `key`: rows + a presence flag. */
export function scalarList(record, key, makeRow) {
  const v = record[key];
  if (!Array.isArray(v)) return { present: false, rows: [], extra: v === undefined ? undefined : v };
  return { present: true, rows: v.map((x, position) => makeRow(x, position)) };
}

/** A list of plain objects under `key`; any non-object element sends the whole list to extra. */
export function objectList(record, key) {
  const v = record[key];
  if (!Array.isArray(v) || !v.every(isPlainObject)) return { ok: false, value: v };
  return { ok: true, value: v };
}
