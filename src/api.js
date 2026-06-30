// api.js — All fetch calls to Netlify backend functions
// Each function that writes data requires an Auth0 Bearer token.

const BASE = "/.netlify/functions";

// ─── Token helper ───────────────────────────────────────────────────────────
async function authHeaders(getToken, orgCode) {
  const token = await getToken();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(orgCode ? { "X-Org-Code": orgCode } : {}),
  };
}

function orgHeader(orgCode) {
  return orgCode ? { "X-Org-Code": orgCode } : {};
}

// Build read-only headers (no Content-Type) for GETs that now require auth.
// Backend gates these behind org membership, so a Bearer token is mandatory.
async function authReadHeaders(getToken, orgCode) {
  const token = await getToken();
  return {
    Authorization: `Bearer ${token}`,
    ...(orgCode ? { "X-Org-Code": orgCode } : {}),
  };
}

// Build a descriptive Error from a failed save response so callers see the
// actual server error (e.g. "Refusing to overwrite ...", "Failed to save tasks")
// instead of an opaque status code. Includes status, endpoint, and response body.
async function saveError(endpoint, status, res) {
  let body = "";
  try { body = await res.text(); } catch {}
  let serverMsg = "";
  try { serverMsg = JSON.parse(body)?.error || ""; } catch {}
  const detail = serverMsg || body.slice(0, 200) || "(no response body)";
  const e = new Error(`${endpoint} failed (${status}): ${detail}`);
  e.endpoint = endpoint;
  e.status = status;
  e.serverMessage = detail;
  return e;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────
export async function fetchTasks(getToken, orgCode) {
  const res = await fetch(`${BASE}/tasks`, { headers: await authReadHeaders(getToken, orgCode) });
  if (!res.ok) throw new Error(`fetchTasks failed: ${res.status}`);
  return res.json(); // returns [] if empty
}

export async function saveTasks(tasks, getToken, orgCode) {
  if (!Array.isArray(tasks)) {
    console.warn("saveTasks blocked — not an array", tasks);
    return { ok: true };
  }
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify(tasks),
  });
  if (!res.ok) throw await saveError("saveTasks", res.status, res);
  return res.json();
}

// ─── People ──────────────────────────────────────────────────────────────────
// Authenticated members pass getToken and receive the full roster (minus PINs).
// The pre-login kiosk passes getToken=null and receives a reduced projection
// (no push tokens, no time-off PII) — see netlify/functions/people.js GET.
export async function fetchPeople(getToken, orgCode) {
  const headers = getToken ? await authReadHeaders(getToken, orgCode) : orgHeader(orgCode);
  const res = await fetch(`${BASE}/people`, { headers });
  if (!res.ok) throw new Error(`fetchPeople failed: ${res.status}`);
  return res.json();
}

export async function savePeople(people, getToken, orgCode) {
  if (!Array.isArray(people)) {
    console.warn("savePeople blocked — not an array", people);
    return { ok: true };
  }
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/people`, {
    method: "POST",
    headers,
    body: JSON.stringify(people),
  });
  if (!res.ok) throw await saveError("savePeople", res.status, res);
  return res.json();
}

// ─── Clients ─────────────────────────────────────────────────────────────────
export async function fetchClients(getToken, orgCode) {
  const res = await fetch(`${BASE}/clients`, { headers: await authReadHeaders(getToken, orgCode) });
  if (!res.ok) throw new Error(`fetchClients failed: ${res.status}`);
  return res.json();
}

export async function saveClients(clients, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/clients`, {
    method: "POST",
    headers,
    body: JSON.stringify(clients),
  });
  if (!res.ok) throw await saveError("saveClients", res.status, res);
  return res.json();
}

// ─── Org Settings ────────────────────────────────────────────────────────────
export async function fetchOrgSettings(getToken, orgCode) {
  const res = await fetch(`${BASE}/settings`, { headers: await authReadHeaders(getToken, orgCode) });
  if (!res.ok) throw new Error(`fetchOrgSettings failed: ${res.status}`);
  return res.json(); // returns {} if not found
}

export async function saveOrgSettings(settings, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/settings`, {
    method: "POST",
    headers,
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`saveOrgSettings failed: ${res.status}`);
  return res.json();
}

// ─── Org ─────────────────────────────────────────────────────────────────────
export async function fetchOrgConfig(code) {
  const res = await fetch(`${BASE}/org?code=${encodeURIComponent(code)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const e = new Error(body.error || `fetchOrgConfig failed: ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

export async function forgotOrgCode(email) {
  const res = await fetch(`${BASE}/forgot-org`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function updateOrgCode(newCode, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/org`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ newCode }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `updateOrgCode failed: ${res.status}`);
  }
  return res.json();
}

export async function updateOrgName(newName, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/org`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ newName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `updateOrgName failed: ${res.status}`);
  }
  return res.json();
}

export async function createOrg(payload) {
  const res = await fetch(`${BASE}/org`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `createOrg failed: ${res.status}`);
  }
  return res.json();
}

// ─── Messages (job chat) ──────────────────────────────────────────────────────
export async function fetchMessages(getToken, orgCode) {
  const res = await fetch(`${BASE}/messages`, { headers: await authReadHeaders(getToken, orgCode) });
  if (!res.ok) throw new Error(`fetchMessages failed: ${res.status}`);
  return res.json();
}

export async function deleteThread(threadKey, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/messages?threadKey=${encodeURIComponent(threadKey)}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(`deleteThread failed: ${res.status}`);
  return res.json();
}

export async function postMessage(message, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`postMessage failed: ${res.status}`);
  return res.json();
}

// ─── Groups ───────────────────────────────────────────────────────────────────
export async function fetchGroups(getToken, orgCode) {
  const res = await fetch(`${BASE}/groups`, { headers: await authReadHeaders(getToken, orgCode) });
  if (!res.ok) throw new Error(`fetchGroups failed: ${res.status}`);
  return res.json();
}

export async function saveGroups(groups, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/groups`, {
    method: "POST",
    headers,
    body: JSON.stringify(groups),
  });
  if (!res.ok) throw new Error(`saveGroups failed: ${res.status}`);
  return res.json();
}

// ─── Chat Attachments ─────────────────────────────────────────────────────────
// payload: { filename: string, mimeType: string, data: string (base64 data URL) }
export async function uploadAttachment(payload, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/attachment`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`uploadAttachment failed: ${res.status} — ${text}`);
  }
  return res.json(); // returns { key, filename, mimeType, size }
}

// ─── AI (proxied to keep Anthropic API key server-side) ──────────────────────
// The proxy now streams Anthropic's SSE response. We read the stream, accumulate
// content blocks (text + tool_use), and return the same { content: [...] } shape
// as the non-streaming response so callers don't need to change.
// payload: { system: string, messages: array, max_tokens: number, tools?, tool_choice? }
export async function callAI(payload, getToken) {
  const headers = await authHeaders(getToken);
  const controller = new AbortController();
  // Inactivity-style timeout: reset whenever bytes arrive. Anthropic generation can take
  // 60s+ for big tool-use; this keeps us from giving up while data is still flowing.
  let inactivityTimer;
  const IDLE_MS = 45000; // 45s without ANY chunk → bail
  const resetIdle = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => controller.abort(), IDLE_MS);
  };
  resetIdle();

  let res;
  try {
    res = await fetch(`${BASE}/ai-schedule`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(inactivityTimer);
    if (e.name === "AbortError") throw new Error("Request stalled — the AI did not respond in time. Try simplifying or splitting the input.");
    throw e;
  }

  if (!res.ok) {
    clearTimeout(inactivityTimer);
    const text = await res.text().catch(() => "");
    // Surface the readable error message from the proxy if it's JSON; otherwise pass through.
    try {
      const j = JSON.parse(text);
      throw new Error(j.error || `AI request failed (${res.status})`);
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) {
        throw new Error(text || `AI request failed (${res.status})`);
      }
      throw parseErr;
    }
  }

  // ── Stream parser ──────────────────────────────────────────────────────
  // Anthropic SSE event types we care about:
  //   message_start          → init usage
  //   content_block_start    → new block at index N (text or tool_use)
  //   content_block_delta    → append text (text_delta.text) or JSON chunk (input_json_delta.partial_json)
  //   content_block_stop     → finalize block (parse accumulated JSON for tool_use)
  //   message_delta          → final stop_reason / usage tweak
  //   message_stop           → done
  //   ping                   → keep-alive, ignore
  //   error                  → upstream error mid-stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const blocks = []; // accumulated content blocks at their respective indices
  const partialJson = {}; // index → partial JSON string awaiting parse at content_block_stop
  let stopReason = null;
  let usage = null;
  let streamError = null;

  const handleEvent = (evt) => {
    if (!evt.data) return;
    let data;
    try { data = JSON.parse(evt.data); } catch { return; }
    switch (data.type) {
      case "content_block_start": {
        const idx = data.index;
        blocks[idx] = { ...(data.content_block || {}) };
        if (blocks[idx].type === "text" && blocks[idx].text == null) blocks[idx].text = "";
        if (blocks[idx].type === "tool_use") partialJson[idx] = "";
        break;
      }
      case "content_block_delta": {
        const idx = data.index;
        const delta = data.delta || {};
        if (!blocks[idx]) blocks[idx] = {};
        if (delta.type === "text_delta") {
          blocks[idx].text = (blocks[idx].text || "") + (delta.text || "");
        } else if (delta.type === "input_json_delta") {
          partialJson[idx] = (partialJson[idx] || "") + (delta.partial_json || "");
        }
        break;
      }
      case "content_block_stop": {
        const idx = data.index;
        if (blocks[idx] && blocks[idx].type === "tool_use") {
          const raw = partialJson[idx] || "";
          if (raw.trim()) {
            try { blocks[idx].input = JSON.parse(raw); }
            catch (e) { console.warn("[callAI] tool_use JSON parse failed:", e.message, "raw:", raw.slice(0, 200)); blocks[idx].input = {}; }
          } else {
            blocks[idx].input = {};
          }
          delete partialJson[idx];
        }
        break;
      }
      case "message_delta":
        if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
        if (data.usage) usage = { ...(usage || {}), ...data.usage };
        break;
      case "message_stop":
        break;
      case "error":
        streamError = data.error?.message || "AI stream error";
        break;
      default:
        // message_start, ping — ignore
        break;
    }
  };

  const flushBuffer = () => {
    // SSE messages are separated by a blank line. Each message has lines like
    // "event: foo" / "data: bar". Normalize CRLF → LF so proxies that rewrite
    // line endings don't break event boundary detection.
    buffer = buffer.replace(/\r\n/g, "\n");
    let sepIdx;
    while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const evt = { event: null, data: "" };
      let dataLines = 0;
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue; // SSE comment (used for keep-alives)
        if (line.startsWith("event:")) evt.event = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          // Per SSE spec, multiple data: lines are joined with "\n". Strip a single
          // leading space ("data: value") but otherwise keep the value as-is.
          const v = line.slice(5).replace(/^ /, "");
          evt.data = dataLines === 0 ? v : evt.data + "\n" + v;
          dataLines++;
        }
      }
      handleEvent(evt);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      buffer += decoder.decode(value, { stream: true });
      flushBuffer();
    }
    // Handle any trailing buffered event
    if (buffer.trim()) {
      buffer += "\n\n";
      flushBuffer();
    }
  } catch (e) {
    clearTimeout(inactivityTimer);
    if (e.name === "AbortError") throw new Error("Connection idle for 45 seconds — the AI may have stalled. Try again or simplify the input.");
    throw e;
  }
  clearTimeout(inactivityTimer);

  if (streamError) throw new Error(streamError);

  // Fallback: if the stream was cut off after content_block_delta but before content_block_stop,
  // tool_use blocks still have their initial empty input from content_block_start. Try to parse
  // whatever partial_json accumulated so we don't lose the work.
  for (const idx of Object.keys(partialJson)) {
    const b = blocks[idx];
    if (b && b.type === "tool_use" && (!b.input || Object.keys(b.input || {}).length === 0)) {
      const raw = partialJson[idx];
      if (raw && raw.trim()) {
        try { b.input = JSON.parse(raw); }
        catch { /* unrecoverable — leave input empty */ }
      }
    }
  }

  // Return the same shape the non-streaming response had so callers don't need to change.
  return {
    content: blocks.filter(Boolean),
    stop_reason: stopReason,
    usage,
  };
}

// ─── Upload & Parse (alias kept for future direct-upload flows) ───────────────
export async function uploadAndProcess(payload, getToken) {
  return callAI(payload, getToken);
}

// ─── Timeclock (PIN-auth for kiosk writes; Bearer required for reads now) ────
// GET now requires org membership — non-admins see only their own entries,
// admins see the full org log. The kiosk POST flows below are PIN-based
// (no Bearer) and still work as a separate auth path.
export const fetchTimeclock = async (getToken, orgCode) => {
  const res = await fetch(`${BASE}/timeclock`, { headers: await authReadHeaders(getToken, orgCode) });
  if (!res.ok) throw new Error(`fetchTimeclock failed: ${res.status}`);
  return res.json();
};

export const clockInAction = (payload, orgCode) =>
  fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(orgCode ? { "X-Org-Code": orgCode } : {}) },
    body: JSON.stringify(payload),
  }).then(r => r.json());

export const clockOutAction = (payload, orgCode) =>
  fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(orgCode ? { "X-Org-Code": orgCode } : {}) },
    body: JSON.stringify(payload),
  }).then(r => r.json());

export const timeclockEventAction = (payload, orgCode) =>
  fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(orgCode ? { "X-Org-Code": orgCode } : {}) },
    body: JSON.stringify(payload),
  }).then(r => r.json());

export const finishRequestAction = (payload, orgCode) =>
  fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(orgCode ? { "X-Org-Code": orgCode } : {}) },
    body: JSON.stringify(payload),
  }).then(r => r.json());

export const adminClockOutAction = async (payload, getToken, orgCode) => {
  const token = await getToken();
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(orgCode ? { "X-Org-Code": orgCode } : {}) },
    body: JSON.stringify({ action: "adminClockOut", ...payload }),
  }).then(r => r.json());
};

export const adminClockInAction = async (payload, getToken, orgCode) => {
  const token = await getToken();
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(orgCode ? { "X-Org-Code": orgCode } : {}) },
    body: JSON.stringify({ action: "adminClockIn", ...payload }),
  }).then(r => r.json());
};

export const adminEditEntryAction = async (payload, getToken, orgCode) => {
  const token = await getToken();
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(orgCode ? { "X-Org-Code": orgCode } : {}) },
    body: JSON.stringify({ action: "adminEditEntry", ...payload }),
  }).then(r => r.json());
};

// Confirm / re-open a timesheet date range (admin only). Confirming locks every
// completed punch in [start, end] (stamped confirmedAt/confirmedBy) so it can't
// be edited and flows into the accountant's pay-period hours export. Re-opening
// clears that lock so the range can be edited again.
export const confirmTimesheetAction = async (payload, getToken, orgCode) => {
  const token = await getToken();
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(orgCode ? { "X-Org-Code": orgCode } : {}) },
    body: JSON.stringify({ action: "confirmTimesheet", ...payload }),
  }).then(r => r.json());
};

export const unconfirmTimesheetAction = async (payload, getToken, orgCode) => {
  const token = await getToken();
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(orgCode ? { "X-Org-Code": orgCode } : {}) },
    body: JSON.stringify({ action: "unconfirmTimesheet", ...payload }),
  }).then(r => r.json());
};

// Admin-triggered lunch/break events — flips a person's status with no PIN.
// `payload.action` must be one of: adminLunchStart, adminLunchEnd, adminBreakStart, adminBreakEnd.
export const adminTimeclockEventAction = async (payload, getToken, orgCode) => {
  const token = await getToken();
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(orgCode ? { "X-Org-Code": orgCode } : {}) },
    body: JSON.stringify(payload),
  }).then(r => r.json());
};

// ─── Job Clock (Auth token, no PIN — tracks hours on job, not pay) ────────────
export const jobClockInAction = async (payload, getToken, orgCode) => {
  const headers = await authHeaders(getToken, orgCode);
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "jobClockIn", ...payload }),
  }).then(r => r.json());
};

export const jobClockOutAction = async (payload, getToken, orgCode) => {
  const headers = await authHeaders(getToken, orgCode);
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "jobClockOut", ...payload }),
  }).then(r => r.json());
};

export const jobPauseAction = async (payload, getToken, orgCode) => {
  const headers = await authHeaders(getToken, orgCode);
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "jobPause", ...payload }),
  }).then(r => r.json());
};

export const jobResumeAction = async (payload, getToken, orgCode) => {
  const headers = await authHeaders(getToken, orgCode);
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "jobResume", ...payload }),
  }).then(r => r.json());
};

// Break is a lightweight status — the job clock keeps running. payload:
// breakBegin { personId, durationMinutes }, breakClear { personId }.
export const breakBeginAction = async (payload, getToken, orgCode) => {
  const headers = await authHeaders(getToken, orgCode);
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "breakBegin", ...payload }),
  }).then(r => r.json());
};

export const breakClearAction = async (payload, getToken, orgCode) => {
  const headers = await authHeaders(getToken, orgCode);
  return fetch(`${BASE}/timeclock`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "breakClear", ...payload }),
  }).then(r => r.json());
};

// ─── Web Push subscriptions ─────────────────────────────────────────────────
// Store/remove this browser's Web Push subscription for the logged-in person.
// The backend keys subscriptions by the authenticated personId.
export async function savePushSubscription(subscription, theme, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/push-subscribe`, {
    method: "POST",
    headers,
    body: JSON.stringify({ subscription, theme }),
  });
  if (!res.ok) throw await saveError("push-subscribe", res.status, res);
  return res.json();
}

export async function removePushSubscription(endpoint, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/push-subscribe`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) throw await saveError("push-subscribe", res.status, res);
  return res.json();
}

// ─── Time Off Requests ─────────────────────────────────────────────────────────
// Approval workflow on top of person.timeOff. Members submit; admins decide.
// GET → { requests: [...] } (members see only their own; admins see all).
export async function fetchTimeOffRequests(getToken, orgCode) {
  const res = await fetch(`${BASE}/timeoff`, { headers: await authReadHeaders(getToken, orgCode) });
  if (!res.ok) throw new Error(`fetchTimeOffRequests failed: ${res.status}`);
  return res.json(); // { requests: [...] }
}

// Submit a new request. payload: { type: "PTO"|"UTO", start, end, note? }
export async function submitTimeOffRequest(payload, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/timeoff`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await saveError("submitTimeOffRequest", res.status, res);
  return res.json(); // { request }
}

// Decide / withdraw a request. payload: { id, action: "approve"|"deny"|"cancel", reason? }
// approve writes the entry into person.timeOff (schedule + export pick it up).
export async function decideTimeOffRequest(payload, getToken, orgCode) {
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/timeoff`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await saveError("decideTimeOffRequest", res.status, res);
  return res.json(); // { request }
}

// ─── Notifications ────────────────────────────────────────────────────────────
// payload: { type, jobTitle, panelTitle, stepLabel, jobTeamIds, jobNumber }
export async function callNotify(payload, getToken, orgCode) {
  try {
    const headers = await authHeaders(getToken, orgCode);
    const res = await fetch(`${BASE}/notify`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.warn("callNotify failed:", res.status);
  } catch (e) {
    console.warn("callNotify error (non-fatal):", e);
  }
}
