// The `_utils/s3.js` contract on Postgres (Postgres migration plan, step 5).
//
// Same functions, same semantics, so handlers don't change:
//   readJson / writeJson / readJsonVersioned / writeJsonIfMatch / PreconditionFailed
//   listOrgCodes / writeBinary / readBinaryWithMeta / copyPrefix / copyObject / deleteObject
// A key exists when it has a store_versions row; its version is the ETag. A JSON file whose key
// has a codec (codecs.js) lives in its tables; any other key, or a file its codec declines, lives
// verbatim in raw_documents. Writes diff the stored rows against the new ones and touch only what
// changed, so change_log records real changes and the append-only move log is never rewritten.

import pg from "pg";
import { codecFor } from "./codecs.js";
import { unwrapJson } from "./fields.js";

// Dates come back as the strings they went in as; date[] likewise (text[] parser).
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1182, pg.types.getTypeParser(1009));
// json comes back as its raw text, wrapped: a stored JSON null ("null") must stay distinguishable
// from SQL NULL (the key was absent), and parsing it would collapse both to JS null.
pg.types.setTypeParser(114, (v) => ({ __rawjson: v }));

export class PreconditionFailed extends Error {
  constructor(key) { super("Precondition failed: " + key); this.name = "PreconditionFailed"; this.preconditionFailed = true; }
}

// ── metadata ───────────────────────────────────────────────────────────────

const metaCache = new WeakMap();
async function meta(client) {
  const key = client.__pool || client;
  if (metaCache.has(key)) return metaCache.get(key);
  const cols = await client.query(`select table_name, column_name, data_type, udt_name from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`);
  const pks = await client.query(`select k.table_name, k.column_name from information_schema.table_constraints t
    join information_schema.key_column_usage k on k.constraint_name = t.constraint_name and k.table_schema = t.table_schema
    where t.table_schema = 'public' and t.constraint_type = 'PRIMARY KEY' order by k.table_name, k.ordinal_position`);
  const m = {};
  for (const r of cols.rows) (m[r.table_name] ??= { cols: {}, pk: [] }).cols[r.column_name] = r.data_type === "ARRAY" ? `${r.udt_name.slice(1)}[]` : r.udt_name;
  for (const r of pks.rows) m[r.table_name].pk.push(r.column_name);
  metaCache.set(key, m);
  return m;
}

// ── value normalisation ────────────────────────────────────────────────────

const toParam = (type, v) => {
  if (v === undefined || v === null) return null;
  if (type === "json") return JSON.stringify(unwrapJson(v));
  return v;
};
// A canonical string per column value, for "did this row change?": DB rows and codec rows differ
// in representation (Date vs ISO string, parsed json vs {__json}).
const canonJson = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const canon = (type, v) => {
  if (v === undefined || v === null) return "\u0000null";
  if (type === "json") return canonJson(unwrapJson(v));
  if (type === "timestamptz") return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  if (type === "float8") return String(Number(v));
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => (x instanceof Date ? x.toISOString().slice(0, 10) : x)));
  return String(v);
};
const rowKey = (pk, r) => JSON.stringify(pk.map((c) => String(r[c])));
// Column names come from information_schema, never from data; quoted because some are reserved ("end").
const q = (ident) => `"${ident.replace(/"/g, '""')}"`;

// ── scoping: which rows of a table belong to a key ─────────────────────────

function scopeOf(owner, table, m) {
  const where = [], params = [];
  const has = (c) => c in m[table].cols;
  if (table === "orgs") { params.push(owner.org); where.push(`code = $${params.length}`); }
  else if (has("org_code") && owner.org) { params.push(owner.org); where.push(`org_code = $${params.length}`); }
  if (table === "user_settings") { params.push(owner.sub); where.push(`email_key = $${params.length}`); }
  if (table === "auth_cache") { params.push(owner.sub); where.push(`key = $${params.length}`); }
  if (owner.codec.scope?.[table]) where.push(owner.codec.scope[table]);
  return { where: where.length ? `where ${where.join(" and ")}` : "", params };
}

async function readTables(client, owner) {
  const m = await meta(client);
  const out = {};
  for (const table of owner.codec.tables) {
    const { where, params } = scopeOf(owner, table, m);
    out[table] = (await client.query(`select * from ${table} ${where}`, params)).rows;
  }
  return out;
}

async function ensureOrg(client, org) {
  if (org) await client.query("insert into orgs (code, has_config) values ($1, false) on conflict (code) do nothing", [org]);
}

async function writeTables(client, owner, tables) {
  const m = await meta(client);
  const current = await readTables(client, owner);
  // Two phases, upserts for every table first, then deletes. Deleting first is a data-loss bug:
  // nodes cascade on parent_id / job_id, so a node moved OUT of a panel that the same write
  // removes would be cascade-deleted before its UPDATE ran, and the UPDATE would hit no row.
  // With FKs deferred, re-parenting first is always legal. Deletes then run parents-first
  // (codec.tables lists parents first) so the move log's "only with its node" rule holds.
  const plans = owner.codec.tables.map((table) => {
    const { cols: types, pk } = m[table];
    return { table, types, pk,
      have: new Map(current[table].map((r) => [rowKey(pk, r), r])),
      want: new Map((tables[table] || []).map((r) => [rowKey(pk, r), r])) };
  });
  for (const { table, types, pk, have, want } of plans) {
    for (const [k, r] of want) {
      const old = have.get(k);
      if (!old) {
        const names = Object.keys(r).filter((c) => r[c] !== undefined && c in types);
        await client.query(`insert into ${table} (${names.map(q).join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")})`, names.map((c) => toParam(types[c], r[c])));
        continue;
      }
      // every column the table has: one the new row doesn't set becomes NULL
      const changed = Object.keys(types).filter((c) => !pk.includes(c) && canon(types[c], old[c]) !== canon(types[c], r[c]) && !(table === "orgs" && c === "auth0_org_id"));
      if (!changed.length) continue;
      const sets = changed.map((c, i) => `${q(c)} = $${i + 1}`).join(", ");
      const where = pk.map((c, i) => `${q(c)} = $${changed.length + i + 1}`).join(" and ");
      const res = await client.query(`update ${table} set ${sets} where ${where}`, [...changed.map((c) => toParam(types[c], r[c])), ...pk.map((c) => r[c])]);
      // A row read moments ago in this transaction must still be there; never lose it silently.
      if (res.rowCount !== 1) throw new Error(`store: update of ${table} ${k} touched ${res.rowCount} rows`);
    }
  }
  // config.json owns the org row's config columns, but the row itself is shared with every
  // other file of the org: an org row is never deleted by a write, only reset.
  for (const { table, pk, have, want } of plans) {
    for (const [k, r] of have) {
      if (want.has(k)) continue;
      if (table === "orgs") { await resetOrgConfig(client, m, r.code); continue; }
      const where = pk.map((c, i) => `${q(c)} = $${i + 1}`).join(" and ");
      await client.query(`delete from ${table} where ${where}`, pk.map((c) => r[c]));
    }
  }
}

async function resetOrgConfig(client, m, code) {
  const keep = new Set(["code", "auth0_org_id"]);
  const cols = Object.keys(m.orgs.cols).filter((c) => !keep.has(c));
  await client.query(`update orgs set ${cols.map((c) => (c === "has_config" ? "has_config = false" : `${q(c)} = null`)).join(", ")} where code = $1`, [code]);
}

// ── the store ──────────────────────────────────────────────────────────────

/**
 * createPgStore({ pool })  — pool: a pg.Pool (or anything with connect()).
 * actor(): optional, returns { personId, email, source, requestId } for change_log.
 */
export function createPgStore({ pool, actor = () => null }) {
  const tx = async (fn, { readOnly = false } = {}) => {
    const client = await pool.connect();
    client.__pool = pool;
    try {
      await client.query(readOnly ? "begin isolation level repeatable read read only" : "begin");
      const a = actor();
      if (!readOnly && a) {
        await client.query("select set_config('app.actor_person_id', $1, true), set_config('app.actor_email', $2, true), set_config('app.source', $3, true), set_config('app.request_id', $4, true)",
          [a.personId == null ? "" : String(a.personId), a.email || "", a.source || "", a.requestId || ""]);
      }
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };

  const readIn = async (client, key) => {
    const v = await client.query("select version from store_versions where key = $1", [key]);
    if (!v.rows.length) return { exists: false, data: null, etag: null };
    const etag = String(v.rows[0].version);
    const raw = await client.query("select doc, binary_body from raw_documents where key = $1", [key]);
    if (raw.rows.length) return { exists: true, data: raw.rows[0].binary_body ? null : unwrapJson(raw.rows[0].doc), etag, binary: !!raw.rows[0].binary_body };
    const owner = codecFor(key);
    if (!owner) return { exists: true, data: null, etag };
    const data = owner.codec.encode(owner.org, await readTables(client, owner), owner.sub);
    return { exists: true, data, etag };
  };

  const writeIn = async (client, key, value) => {
    const owner = codecFor(key);
    const decoded = owner && value !== null && value !== undefined ? owner.codec.decode(owner.org, value, owner.sub) : null;
    // Only a codec-owned key belongs to an org row; raw keys (orgs/_index/..., legacy files)
    // carry no tenant FK.
    if (owner?.org) await ensureOrg(client, owner.org);
    if (owner) {
      // clear the other representation, then write this one
      await client.query("delete from raw_documents where key = $1", [key]);
      await writeTables(client, owner, decoded && !decoded.declined ? decoded : {});
    }
    if (!owner || !decoded || decoded.declined) {
      await client.query(`insert into raw_documents (key, doc, content_type, binary_body, last_written_at) values ($1, $2, null, null, now())
        on conflict (key) do update set doc = excluded.doc, content_type = null, binary_body = null, last_written_at = now()`, [key, JSON.stringify(value)]);
    }
  };

  const bump = (client, key) => client.query(`insert into store_versions (key, version) values ($1, 1)
    on conflict (key) do update set version = store_versions.version + 1`, [key]);

  const store = {
    name: "pg",
    PreconditionFailed,
    async readJson(key) { return tx(async (c) => (await readIn(c, key)).data, { readOnly: true }); },
    async readJsonVersioned(key) {
      return tx(async (c) => { const r = await readIn(c, key); return { data: r.data, etag: r.exists ? r.etag : null }; }, { readOnly: true });
    },
    async writeJson(key, value) {
      return tx(async (c) => {
        await c.query("insert into store_versions (key, version) values ($1, 0) on conflict (key) do nothing", [key]);
        await c.query("select version from store_versions where key = $1 for update", [key]);
        await writeIn(c, key, value);
        await bump(c, key);
      });
    },
    async writeJsonIfMatch(key, value, etag) {
      return tx(async (c) => {
        if (etag == null) {
          const ins = await c.query("insert into store_versions (key, version) values ($1, 0) on conflict (key) do nothing returning key", [key]);
          if (!ins.rows.length) throw new PreconditionFailed(key);
        } else {
          const v = await c.query("select version from store_versions where key = $1 for update", [key]);
          if (!v.rows.length || String(v.rows[0].version) !== String(etag)) throw new PreconditionFailed(key);
        }
        await writeIn(c, key, value);
        await bump(c, key);
      });
    },
    async listOrgCodes() {
      // Byte order, as S3 lists keys: a non-C database collation (Aurora's en_US) would sort
      // dotted / mixed-case codes differently and change the order handlers iterate orgs in.
      return tx(async (c) => (await c.query(`select distinct split_part(key, '/', 2) collate "C" as code from store_versions where key like 'orgs/%/%' order by 1`)).rows.map((r) => r.code), { readOnly: true });
    },
    async writeBinary(key, body, contentType) {
      return tx(async (c) => {
        await c.query("insert into store_versions (key, version) values ($1, 0) on conflict (key) do nothing", [key]);
        await c.query("select version from store_versions where key = $1 for update", [key]);
        await c.query(`insert into raw_documents (key, doc, content_type, binary_body, last_written_at) values ($1, null, $2, $3, now())
          on conflict (key) do update set doc = null, content_type = excluded.content_type, binary_body = excluded.binary_body, last_written_at = now()`, [key, contentType || null, Buffer.from(body)]);
        await bump(c, key);
      });
    },
    async readBinaryWithMeta(key) {
      const r = await tx((c) => c.query("select r.content_type, r.binary_body from raw_documents r join store_versions v on v.key = r.key where r.key = $1 and r.binary_body is not null", [key]), { readOnly: true });
      if (!r.rows.length) { const e = new Error("The specified key does not exist."); e.name = "NoSuchKey"; e.$metadata = { httpStatusCode: 404 }; throw e; }
      return { data: Buffer.from(r.rows[0].binary_body), contentType: r.rows[0].content_type || "application/octet-stream" };
    },
    async deleteObject(key) {
      return tx(async (c) => {
        const owner = codecFor(key);
        if (owner) await writeTables(c, owner, {});
        await c.query("delete from raw_documents where key = $1", [key]);
        await c.query("delete from store_versions where key = $1", [key]);
      });
    },
    async copyObject(src, dst) {
      const bin = await tx((c) => c.query("select content_type, binary_body from raw_documents where key = $1 and binary_body is not null", [src]), { readOnly: true });
      if (bin.rows.length) return store.writeBinary(dst, bin.rows[0].binary_body, bin.rows[0].content_type);
      const v = await store.readJson(src);
      if (v !== null) await store.writeJson(dst, v);
    },
    async copyPrefix(src, dst) {
      const keys = (await tx((c) => c.query("select key from store_versions where key like $1 order by key", [src.replace(/[%_\\]/g, "\\$&") + "%"]), { readOnly: true })).rows.map((r) => r.key);
      for (const k of keys) { await store.copyObject(k, dst + k.slice(src.length)); await store.deleteObject(k); }
    },
    // Test/tooling only: every key and its value, as the mem store's dump().
    async dump() {
      const keys = (await tx((c) => c.query("select key from store_versions order by key"), { readOnly: true })).rows.map((r) => r.key);
      const out = {};
      for (const k of keys) {
        const bin = await tx((c) => c.query("select content_type, binary_body from raw_documents where key = $1 and binary_body is not null", [k]), { readOnly: true });
        out[k] = bin.rows.length ? { __binary: Buffer.from(bin.rows[0].binary_body).toString("base64"), contentType: bin.rows[0].content_type } : await store.readJson(k);
      }
      return out;
    },
  };
  return store;
}
