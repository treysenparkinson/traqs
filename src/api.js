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
// payload: { system: string, messages: array, max_tokens: number }
export async function callAI(payload, getToken) {
  const headers = await authHeaders(getToken);
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 35000); // 35s client timeout
  try {
    const res = await fetch(`${BASE}/ai-schedule`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`callAI failed: ${res.status} — ${text}`);
    }
    return res.json(); // returns Anthropic response shape { content: [...] }
  } catch (e) {
    clearTimeout(tid);
    if (e.name === "AbortError") throw new Error("Request timed out — try a smaller file or add context in the text box.");
    throw e;
  }
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
