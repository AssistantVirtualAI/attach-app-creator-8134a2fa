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
  const rows = [...voicemailRows(await getRows(fetcher, path))];
  // Provider pages at 20 rows; read further pages (read-only), stop when no new file appears.
  const key = (r: any) => r?.filename ?? r?.ns_vm_id ?? r?.vm_id ?? r?.id;
  const seen = new Set(rows.map(key));
  for (let page = 0; rows.length >= 20 && page < 25; page++) {
    let next: any[] = [];
    try { next = voicemailRows(await getRows(fetcher, `${path}?start=${rows.length}&limit=100`)); } catch { break; }
    const fresh = next.filter((r) => key(r) && !seen.has(key(r)));
    if (!fresh.length) break;
    fresh.forEach((r) => { seen.add(key(r)); rows.push(r); });
  }
  const items = rows.map((row) => normalizeVoicemail(row, folder, now));
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
      if (enriched) {
        item.from_number = enriched.from_number ?? item.from_number;
        item.from_name = enriched.from_name ?? item.from_name;
        item.audio_url = enriched.audio_url ?? item.audio_url;
        item.transcript = enriched.transcript ?? item.transcript;
      }
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