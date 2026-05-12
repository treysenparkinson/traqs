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

// ─── Tasks ───────────────────────────────────────────────────────────────────
export async function fetchTasks(orgCode) {
  const res = await fetch(`${BASE}/tasks`, { headers: orgHeader(orgCode) });
  if (!res.ok) throw new Error(`fetchTasks failed: ${res.status}`);
  return res.json(); // returns [] if empty
}

export async function saveTasks(tasks, getToken, orgCode) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    console.warn("saveTasks blocked — empty or invalid array", tasks);
    return { ok: true };
  }
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify(tasks),
  });
  if (!res.ok) throw new Error(`saveTasks failed: ${res.status}`);
  return res.json();
}

// ─── People ──────────────────────────────────────────────────────────────────
export async function fetchPeople(orgCode) {
  const res = await fetch(`${BASE}/people`, { headers: orgHeader(orgCode) });
  if (!res.ok) throw new Error(`fetchPeople failed: ${res.status}`);
  return res.json();
}

export async function savePeople(people, getToken, orgCode) {
  if (!Array.isArray(people) || people.length === 0) {
    console.warn("savePeople blocked — empty or invalid array", people);
    return { ok: true };
  }
  const headers = await authHeaders(getToken, orgCode);
  const res = await fetch(`${BASE}/people`, {
    method: "POST",
    headers,
    body: JSON.stringify(people),
  });
  if (!res.ok) throw new Error(`savePeople failed: ${res.status}`);
  return res.json();
}

// ─── Clients ─────────────────────────────────────────────────────────────────
export async function fetchClients(orgCode) {
  const res = await fetch(`${BASE}/clients`, { headers: orgHeader(orgCode) });
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
  if (!res.ok) throw new Error(`saveClients failed: ${res.status}`);
  return res.json();
}

// ─── Org Settings ────────────────────────────────────────────────────────────
export async function fetchOrgSettings(orgCode) {
  const res = await fetch(`${BASE}/settings`, { headers: orgHeader(orgCode) });
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
export async function fetchMessages(orgCode) {
  const res = await fetch(`${BASE}/messages`, { headers: orgHeader(orgCode) });
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
export async function fetchGroups(orgCode) {
  const res = await fetch(`${BASE}/groups`, { headers: orgHeader(orgCode) });
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
            catch { blocks[idx].input = {}; /* upstream sent malformed JSON; preserve {} */ }
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

// ─── Timeclock (PIN-auth, no Bearer token required) ───────────────────────────
export const fetchTimeclock = (orgCode) =>
  fetch(`${BASE}/timeclock`, { headers: orgCode ? { "X-Org-Code": orgCode } : {} }).then(r => r.json());

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
