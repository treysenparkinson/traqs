// Read-modify-write on one S3 JSON file without losing a concurrent write.
//
// tasks.js and timeclock.js both read tasks.json, change it and write it back;
// with a plain PUT, a write landing between one handler's read and its write was
// silently lost (SCHEDULE_MAP #185). updateJson re-reads and re-applies `mutate`
// whenever the conditional write finds the object changed, so every writer's
// change lands on top of the others.
//
// `mutate(current)` gets the parsed file (null when absent) and returns either
//   { value, ...extra }  — write `value`; the whole object is returned, or
//   { abort: anything }  — write nothing and return it (a refusal, a no-op).
// It MUST be a pure function of `current` plus what it closed over: it runs once
// per attempt, so side effects (publishing, pushes) belong after updateJson.
import { readJsonVersioned, writeJsonIfMatch } from "./s3.js";

export class WriteContention extends Error {
  constructor(key, attempts) {
    super(`Gave up writing ${key} after ${attempts} attempts; another write kept landing first`);
    this.name = "WriteContention";
    this.statusCode = 503;
  }
}

export async function updateJson(key, mutate, { attempts = 5 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const { data, etag } = await readJsonVersioned(key);
    const out = await mutate(data);
    if (!out || "abort" in out) return out;
    try {
      await writeJsonIfMatch(key, out.value, etag);
      return { ...out, previous: data };
    } catch (e) {
      if (!e?.preconditionFailed) throw e;
    }
  }
  throw new WriteContention(key, attempts);
}
