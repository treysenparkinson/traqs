// api.js — All fetch calls to Netlify backend functions
// Each function that writes data requires an Auth0 Bearer token.

const BASE = "/api";

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

// ─── Org ─────────────────────────────────────────────────────────────────────
export async function fetchOrgConfig(code) {
  const res = await fetch(`${BASE}/org?code=${encodeURIComponent(code)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `fetchOrgConfig failed: ${res.status}`);
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
  const res = await fetch(`${BASE}/ai-schedule`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`callAI failed: ${res.status} — ${text}`);
  }
  return res.json(); // returns Anthropic response shape { content: [...] }
}

// ─── Upload & Parse (alias kept for future direct-upload flows) ───────────────
export async function uploadAndProcess(payload, getToken) {
  return callAI(payload, getToken);
}
