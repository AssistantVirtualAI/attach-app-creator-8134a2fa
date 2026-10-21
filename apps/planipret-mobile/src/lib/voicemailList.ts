import { formatPublicPhone, normalizeCallEndpoint } from "./planipret/callPresentation";

export function voicemailCaller(
  vm: { from_number: string | null; from_name: string | null },
  directory: { contactsByPhone?: Record<string, string>; internalByExt?: Record<string, string> },
): { name: string | null; phone: string | null } {
  const number = normalizeCallEndpoint(vm.from_number);
  const digits = number?.replace(/\D/g, "") ?? "";
  const key = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const ext = number?.match(/^(\d{2,6})[a-z]?$/i)?.[1];
  const matched = ext ? directory.internalByExt?.[ext] : directory.contactsByPhone?.[key];
  const supplied = vm.from_name?.trim();
  const usableName = supplied && !/^(unknown|anonymous|restricted|private|unavailable|inconnu|null)$/i.test(supplied)
    && !/^<?sips?:/i.test(supplied) && !/^[+\d().\s-]+$/.test(supplied) ? supplied : null;
  return { name: matched || usableName || null, phone: formatPublicPhone(number) };
}

export type VoicemailListItem = {
  id: string; user_id: string; ns_vm_id: string | null; folder: string;
  from_number: string | null; from_name: string | null; duration_seconds: number | null;
  audio_url: string | null; transcript: string | null; is_read: boolean;
  received_at: string | null; created_at: string;
};

export function voicemailFolder(folder: string): string {
  return ({ new: "inbox", save: "saved", trash: "deleted" } as Record<string, string>)[folder] ?? folder;
}

export function mergeVoicemailList(provider: Record<string, any>[], local: VoicemailListItem[], owner: string, folder: string): VoicemailListItem[] {
  const merged = new Map<string, VoicemailListItem>();
  for (const item of local) {
    if (item.user_id !== owner) continue;
    merged.set(item.ns_vm_id ?? item.id, { ...item, folder: voicemailFolder(item.folder) });
  }
  for (const item of provider) {
    const key = item.filename ?? item.ns_vm_id ?? item.vm_id ?? item.id;
    if (typeof key !== "string" || !key) continue;
    const cached = merged.get(key);
    const duration = Number(item["file-duration-seconds"] ?? item.length ?? item.duration_seconds ?? item.duration);
    const date = item.received_at ?? item["recorded-datetime"] ?? item["created-datetime"] ?? item.filedate ?? item.created_at ?? item.timestamp;
    merged.set(key, {
      id: cached?.id ?? key, user_id: owner, ns_vm_id: key, folder: voicemailFolder(item.folder ?? folder),
      from_number: item.FromUser ?? item.NmsAni ?? item.from_number ?? item.caller ?? cached?.from_number ?? null,
      from_name: item.FromName ?? item.from_name ?? item.caller_name ?? cached?.from_name ?? null,
      duration_seconds: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : cached?.duration_seconds ?? null,
      audio_url: item["file-access-url"] ?? item.remotepath ?? item.audio_url ?? cached?.audio_url ?? null,
      transcript: item.transcription ?? item.transcript ?? cached?.transcript ?? null,
      is_read: cached?.is_read ?? (item.is_read === true || item.read === true || voicemailFolder(folder) === "saved"),
      received_at: date ?? cached?.received_at ?? null,
      created_at: date ?? cached?.created_at ?? new Date().toISOString(),
    });
  }
  return [...merged.values()].sort((a, b) => Date.parse(b.received_at ?? b.created_at) - Date.parse(a.received_at ?? a.created_at));
}