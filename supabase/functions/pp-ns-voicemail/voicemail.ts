// NS-API v2 Media/Voicemail: folders new/save/trash, identity filename.
export function providerFolder(folder: string): string | null {
  return ({ inbox: "new", saved: "save", deleted: "trash", new: "new", save: "save", trash: "trash" } as Record<string, string>)[folder] ?? null;
}

export function appFolder(folder: string): string {
  return ({ new: "inbox", save: "saved", trash: "deleted" } as Record<string, string>)[folder] ?? folder;
}

export function normalizeVoicemail(v: Record<string, any>, folder: string, now: string) {
  const id = v.filename ?? v.ns_vm_id ?? v.vm_id ?? v.id;
  if (typeof id !== "string" || !id.trim()) return null;
  const duration = Number(v["file-duration-seconds"] ?? v.length ?? v.NmsRecDuration ?? v.duration_seconds ?? v.duration);
  const date = v["recorded-datetime"] ?? v.RecordTime ?? v["created-datetime"] ?? v.filedate ?? v.received_at ?? v.created_at ?? v.timestamp;
  const receivedAt = date && !Number.isNaN(Date.parse(String(date))) ? new Date(String(date)).toISOString() : now;
  const isRead = v.is_read ?? v.read;
  return {
    vm_id: id, ns_vm_id: id,
    from_number: [v.FromUser, v.NmsAni, v.from_number, v.caller].find((value) => typeof value === "string" && value.trim())?.trim() ?? null,
    from_name: [v.FromName, v.from_name, v.caller_name].find((value) => typeof value === "string" && value.trim())?.trim() ?? null,
    duration_seconds: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null,
    folder: appFolder(folder),
    is_read: isRead === undefined ? appFolder(folder) !== "inbox" : isRead === true || isRead === 1 || isRead === "yes" || isRead === "true",
    audio_url: v["file-access-url"] ?? v.remotepath ?? v.audio_url ?? null,
    transcript: v.transcription ?? v.transcript ?? null,
    received_at: receivedAt, created_at: receivedAt,
  };
}

export function voicemailRows(raw: unknown): Record<string, any>[] {
  if (Array.isArray(raw)) return raw.filter((v) => v && typeof v === "object");
  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    for (const key of ["voicemails", "data", "items"]) {
      if (Array.isArray(value[key])) return voicemailRows(value[key]);
    }
  }
  throw new Error("Invalid voicemail list response");
}