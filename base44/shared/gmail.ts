// Minimal Gmail REST API helpers for the shared-inbox connector token.
// Read-only: list + get. Ingest never modifies the mailbox.

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessageMeta {
  id: string;
  threadId: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string; // ms epoch as string
  snippet: string;
  headers: Record<string, string>;
  html: string;
  text: string;
}

async function gmailFetch(token: string, path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${res.status} on ${path.split("?")[0]}: ${body.slice(0, 300)}`);
  }
  return await res.json();
}

// List message ids, newest first. `q` uses Gmail search syntax
// (e.g. "after:1721600000" with epoch seconds).
export async function listMessages(
  token: string,
  opts: { q?: string; maxResults?: number; pageToken?: string } = {},
): Promise<{ messages: GmailMessageMeta[]; nextPageToken?: string }> {
  const params = new URLSearchParams();
  params.set("maxResults", String(opts.maxResults ?? 25));
  if (opts.q) params.set("q", opts.q);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const data = await gmailFetch(token, `/messages?${params}`);
  return { messages: data.messages ?? [], nextPageToken: data.nextPageToken };
}

function b64UrlDecode(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// Walk MIME parts collecting the first text/html and text/plain bodies.
function walkParts(part: any, found: { html: string; text: string }) {
  if (!part) return;
  const mime = part.mimeType ?? "";
  const data = part.body?.data;
  if (data && mime === "text/html" && !found.html) found.html = b64UrlDecode(data);
  if (data && mime === "text/plain" && !found.text) found.text = b64UrlDecode(data);
  for (const child of part.parts ?? []) walkParts(child, found);
}

export async function getMessage(token: string, id: string): Promise<GmailMessage> {
  const data = await gmailFetch(token, `/messages/${id}?format=full`);
  const headers: Record<string, string> = {};
  for (const h of data.payload?.headers ?? []) headers[h.name] = h.value;
  const found = { html: "", text: "" };
  walkParts(data.payload, found);
  return {
    id: data.id,
    threadId: data.threadId ?? "",
    internalDate: data.internalDate ?? "0",
    snippet: data.snippet ?? "",
    headers,
    html: found.html,
    text: found.text,
  };
}
