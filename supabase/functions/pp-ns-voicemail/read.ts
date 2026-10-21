import { normalizeVoicemail, providerFolder, voicemailRows } from "./voicemail.ts";

type Fetcher = (path: string, init: RequestInit) => Promise<Response>;
export function voicemailPath(domain: string, extension: string, folder: string, filename?: string): string {
  const provider = providerFolder(folder);
  if (!provider || !domain || !extension) throw new Error("Invalid voicemail scope");
  if (filename !== undefined && (!filename.trim() || filename.length > 512 || /[\/\\\u0000-\u001f]/.test(filename))) throw new Error("Invalid voicemail identity");
  const base = `/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(extension)}/voicemails/${provider}`;
  return filename === undefined ? base : `${base}/${encodeURIComponent(filename)}`;
}

async function getRows(fetcher: Fetcher, path: string) {
  const response = await fetcher(path, { method: "GET" });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Voicemail provider read failed"); }
  const raw = await response.json();
  return Array.isArray(raw) ? voicemailRows(raw) : raw;
}

export async function readVoicemailList(fetcher: Fetcher, domain: string, extension: string, folder: string, now: string) {
  const path = voicemailPath(domain, extension, folder);
  const raw = await getRows(fetcher, path);
  const items = voicemailRows(raw).map((row) => normalizeVoicemail(row, folder, now));
  if (items.some((item) => !item)) throw new Error("Voicemail identity missing");
  const valid = items.filter((item) => item !== null);
  // List responses may contain only file metadata; caller fields are documented
  // on the individual message. Enrich only unidentified rows, never another user.
  for (const item of valid) {
    if (item.from_number || item.from_name) continue;
    try {
      const detail = await getRows(fetcher, voicemailPath(domain, extension, folder, item.ns_vm_id));
      const row = Array.isArray(detail) ? detail[0] : detail?.data ?? detail;
      if (!row || typeof row !== "object") continue;
      const enriched = normalizeVoicemail({ ...row, filename: item.ns_vm_id }, folder, now);
      if (enriched) Object.assign(item, enriched);
    } catch { /* A metadata failure must not hide an existing message. */ }
  }
  return valid;
}

export async function readVoicemailAudio(fetcher: Fetcher, domain: string, extension: string, folder: string, filename: string) {
  const path = voicemailPath(domain, extension, folder, filename);
  const rows = await getRows(fetcher, voicemailPath(domain, extension, folder));
  const exists = voicemailRows(rows).some((row) => (row.filename ?? row.ns_vm_id ?? row.vm_id ?? row.id) === filename);
  if (!exists) return null; // Never read a guessed foreign or absent message.
  const detail = await getRows(fetcher, path);
  const item = Array.isArray(detail) ? detail[0] : detail?.data ?? detail;
  return item?.["file-access-url"] ?? item?.remotepath ?? item?.audio_url ?? null;
}