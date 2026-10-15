/**
 * pp-did-routing — écriture/vérification CIBLÉE du routage d'un seul DID.
 *
 * Règle d'or (incident 2026-07-30) : un numéro n'est réellement assigné que si
 * `dial-rule-translation-destination-user` contient l'extension. Écrire
 * seulement `dial-rule-parameter` laisse la destination VIDE → l'opérateur
 * répond « the number can't be completed as dialled ».
 *
 * Portée autorisée : UN numéro à la fois, avec relecture obligatoire.
 * Les réécritures en masse restent interdites (voir pp-admin-phonenumbers).
 */

const NS_API_KEY = Deno.env.get("NS_API_KEY") ?? "";
const NS_API_BASE_URL = Deno.env.get("NS_API_BASE_URL") ?? "https://voice.ava-telecom.ca/ns-api/v2";
export const NS_DEFAULT_DOMAIN = Deno.env.get("NS_DEFAULT_DOMAIN") ?? "planipret.ca";

export const digitsOnly = (x: unknown) => String(x ?? "").replace(/\D/g, "");
/** Identifiant PBX d'un DID nord-américain : 11 chiffres avec le 1. */
export const pbxNumberId = (x: unknown) => {
  const d = digitsOnly(x);
  return d.length === 10 ? `1${d}` : d;
};
export const e164Of = (x: unknown) => {
  const d = pbxNumberId(x);
  return d ? `+${d}` : "";
};

const one = (x: any) => (Array.isArray(x) ? x[0] : x);

export const pnPath = (domain: string, pn: string) =>
  `/domains/${encodeURIComponent(domain)}/phonenumbers/${encodeURIComponent(pn)}`;

export async function nsCall(path: string, init: RequestInit = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(`${NS_API_BASE_URL}${path}`, {
      ...init,
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${NS_API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Connection: "close",
        ...(init.headers ?? {}),
      },
    });
    const text = await r.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: String(e) };
  } finally {
    clearTimeout(t);
  }
}

/** Destination réellement utilisée par le PBX pour livrer l'appel. */
export function destinationUserOf(raw: any): string | null {
  const o = one(raw) ?? {};
  const d = String(o?.["dial-rule-translation-destination-user"] ?? "").trim();
  return d && d !== "[*]" ? d : null;
}

export function routingSnapshotOf(raw: any) {
  const o = one(raw) ?? {};
  return {
    destination_user: destinationUserOf(raw),
    dial_rule_application: o["dial-rule-application"] ?? null,
    dial_rule_parameter: o["dial-rule-parameter"] ?? null,
    description: o["dial-rule-description"] ?? null,
    enabled: o["enabled"] ?? null,
  };
}

/** Charge utile SÛRE : refuse toute écriture sans destination explicite. */
export function safeDidPayload(extension: string, domain: string, current: any, description?: string) {
  const ext = String(extension ?? "").trim();
  if (!/^[0-9]{2,10}$/.test(ext)) throw new Error(`extension invalide: "${extension}"`);
  const cur = one(current) ?? {};
  return {
    "dial-rule-application": "to-user-residential",
    "dial-rule-parameter": `user_${ext}`,
    "dial-rule-translation-destination-user": ext,
    "dial-rule-translation-destination-host": domain,
    "dial-rule-translation-source-name": "[*]",
    ...(description
      ? { "dial-rule-description": description.slice(0, 80) }
      : cur["dial-rule-description"] && !/^AVAILABLE/i.test(String(cur["dial-rule-description"]))
        ? { "dial-rule-description": cur["dial-rule-description"] } : {}),
    enabled: "yes",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Le PBX est éventuellement cohérent : on relit jusqu'à 3 fois. */
export async function readDidRouting(domain: string, pn: string, expected?: string, attempts = 3) {
  let last: any = null;
  for (let i = 0; i < attempts; i++) {
    last = await nsCall(pnPath(domain, pn));
    const dest = destinationUserOf(last.data);
    if (!expected || dest === expected) {
      return { ...routingSnapshotOf(last.data), status: last.status, ok: last.ok, raw: last.data };
    }
    if (i < attempts - 1) await sleep(600);
  }
  return { ...routingSnapshotOf(last?.data), status: last?.status, ok: !!last?.ok, raw: last?.data };
}

export type DidWriteResult = {
  verified: boolean;
  phone_number: string;
  expected_destination: string;
  expected_parameter: string;
  live: Awaited<ReturnType<typeof readDidRouting>>;
  write_status: number;
  diagnostic: string;
};

/** Écrit le routage d'UN numéro puis relit pour confirmer `user_XXXX`. */
export async function assignDidToExtension(
  domain: string,
  rawNumber: string,
  extension: string,
  description?: string,
): Promise<DidWriteResult> {
  const pn = pbxNumberId(rawNumber);
  const ext = String(extension ?? "").trim();
  const current = await nsCall(pnPath(domain, pn));
  const payload = safeDidPayload(ext, domain, current.data, description);
  const write = await nsCall(pnPath(domain, pn), { method: "PUT", body: JSON.stringify(payload) });
  const live = await readDidRouting(domain, pn, ext);
  const verified = live.destination_user === ext && live.dial_rule_parameter === `user_${ext}`;
  return {
    verified,
    phone_number: pn,
    expected_destination: ext,
    expected_parameter: `user_${ext}`,
    live,
    write_status: write.status,
    diagnostic: verified
      ? `Le numéro ${e164Of(pn)} est routé vers user_${ext} (destination ${ext}) et confirmé par relecture du PBX.`
      : `Écriture PBX HTTP ${write.status} : la destination lue est ${live.destination_user ?? "VIDE"} `
        + `(paramètre ${live.dial_rule_parameter ?? "VIDE"}) au lieu de ${ext} / user_${ext}. `
        + `Tant que la destination est vide, l'opérateur répond « the number can't be completed as dialled ».`,
  };
}

/** Contrôle lecture seule : la destination correspond-elle au bon user_XXXX ? */
export async function verifyDidRouting(domain: string, rawNumber: string, extension: string | null) {
  const pn = pbxNumberId(rawNumber);
  const ext = String(extension ?? "").trim();
  const live = await readDidRouting(domain, pn, ext || undefined);
  const matches = !!ext && live.destination_user === ext && live.dial_rule_parameter === `user_${ext}`;
  let diagnostic: string;
  if (!live.ok && live.status !== 200) {
    diagnostic = `Le PBX n'a pas retourné ce numéro (HTTP ${live.status}) : il n'existe pas dans le domaine ${domain}.`;
  } else if (!live.destination_user) {
    diagnostic = `Destination VIDE dans le PBX : aucun abonné derrière ${e164Of(pn)} → « the number can't be completed as dialled ».`;
  } else if (!ext) {
    diagnostic = `Le PBX route ${e164Of(pn)} vers ${live.destination_user}, mais aucun poste n'est assigné dans le portail.`;
  } else if (!matches) {
    diagnostic = `Dérive de routage : le PBX pointe vers ${live.destination_user} `
      + `(${live.dial_rule_parameter ?? "sans paramètre"}) alors que le portail attend ${ext} / user_${ext}. `
      + `Si ce poste n'existe plus, l'appel échoue avec « can't be completed as dialled ».`;
  } else {
    diagnostic = `Routage conforme : ${e164Of(pn)} → user_${ext}.`;
  }
  return { matches, phone_number: pn, expected: ext || null, live, diagnostic };
}

/** Liste les postes qui existent RÉELLEMENT dans le PBX pour un domaine. */
export async function listLiveExtensions(domain: string): Promise<Set<string>> {
  const r = await nsCall(`/domains/${encodeURIComponent(domain)}/users?limit=1000`);
  const rows: any[] = Array.isArray(r.data) ? r.data : ((r.data as any)?.data ?? []);
  const set = new Set<string>();
  for (const u of rows) {
    const ext = String(u?.user ?? u?.["user"] ?? u?.extension ?? "").trim();
    if (/^[0-9]{2,10}$/.test(ext)) set.add(ext);
  }
  return set;
}

/** Libère un DID : plus aucune destination, numéro réutilisable. */
export async function releaseDid(domain: string, rawNumber: string) {
  const pn = pbxNumberId(rawNumber);
  const payload = {
    "dial-rule-application": "to-user-residential",
    "dial-rule-parameter": "",
    "dial-rule-translation-destination-user": "[*]",
    "dial-rule-translation-destination-host": domain,
    "dial-rule-translation-source-name": "[*]",
    "dial-rule-description": "AVAILABLE - libere automatiquement (poste inexistant)",
    enabled: "no",
  };
  const write = await nsCall(pnPath(domain, pn), { method: "PUT", body: JSON.stringify(payload) });
  const live = await readDidRouting(domain, pn);
  const released = !live.destination_user;
  return { released, phone_number: pn, write_status: write.status, live };
}

/** Liste les DID du domaine avec leur destination réelle (source de vérité PBX). */
export async function listLiveDids(domain: string): Promise<Map<string, string>> {
  const r = await nsCall(`/domains/${encodeURIComponent(domain)}/phonenumbers?limit=2000`);
  const rows: any[] = Array.isArray(r.data) ? r.data : ((r.data as any)?.data ?? []);
  const map = new Map<string, string>();
  for (const row of rows) {
    const pn = pbxNumberId(row?.phonenumber ?? row?.number ?? row?.["phonenumber"]);
    if (!pn) continue;
    map.set(pn, destinationUserOf(row) ?? "");
  }
  return map;
}

/** Route the texting side of a number to one extension (NS smsnumbers), then read back. */
export async function assignSmsNumber(domain: string, rawNumber: string, extension: string | null) {
  const pn = pbxNumberId(rawNumber);
  const path = `/domains/${encodeURIComponent(domain)}/smsnumbers/${pn}`;
  const body = extension ? { application: "user", dest: extension } : { application: "available", dest: "" };
  const w = await nsCall(path, { method: "PUT", body: JSON.stringify(body) });
  const r = await nsCall(path);
  const live = Array.isArray(r.data) ? r.data[0] : r.data;
  return { ok: (extension ? String(live?.dest ?? "") === extension : String(live?.application ?? "") === "available"), write_status: w.status };
}

/** Met le numéro comme caller ID du poste (appels + textos sortants), puis relit. */
export async function setExtensionCallerId(domain: string, extension: string, rawNumber: string | null) {
  const path = `/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(extension)}`;
  const d = rawNumber ? pbxNumberId(rawNumber).replace(/^1(?=\d{10}$)/, "") : "";
  const w = await nsCall(path, { method: "PUT", body: JSON.stringify({ "caller-id-number": d, "caller-id-number-emergency": d }) });
  const r = await nsCall(path);
  const live = digitsOnly(one(r.data)?.["caller-id-number"]).replace(/^1(?=\d{10}$)/, "");
  return { ok: live === d, write_status: w.status };
}

export type NumberAssignResult = {
  success: boolean;
  phone_number: string;
  extension: string;
  steps: { voice: boolean; sms: boolean; caller_id: boolean; released: { number: string; ok: boolean }[] };
  error_code?: string;
  diagnostic: string;
};

/**
 * Procédure UNIQUE d'assignation d'un numéro à un poste (création de courtier,
 * bouton Assigner, single_did). Appels → textos → caller ID → libération des
 * anciens numéros du poste. Échec appels = rien d'autre n'est modifié.
 */
export async function assignNumberToExtension(
  domain: string, rawNumber: string, extension: string,
  opts: { description?: string; releaseOthers?: boolean } = {},
): Promise<NumberAssignResult> {
  const pn = pbxNumberId(rawNumber);
  const ext = String(extension ?? "").trim();
  const base = { phone_number: pn, extension: ext, steps: { voice: false, sms: false, caller_id: false, released: [] as { number: string; ok: boolean }[] } };
  if (!/^[0-9]{2,10}$/.test(ext) || !/^\d{11}$/.test(pn)) {
    return { ...base, success: false, error_code: "invalid_input", diagnostic: "Numéro ou poste invalide." };
  }
  const exts = await listLiveExtensions(domain);
  if (exts.size && !exts.has(ext)) {
    return { ...base, success: false, error_code: "extension_missing", diagnostic: `Le poste ${ext} n'existe pas dans le système téléphonique.` };
  }
  const cur = await nsCall(pnPath(domain, pn));
  if (cur.status === 404) {
    return { ...base, success: false, error_code: "sms_only_number", diagnostic: "Numéro textos seulement : activez l'appel chez le fournisseur avant de l'assigner." };
  }
  const owner = destinationUserOf(cur.data);
  if (owner && owner !== ext && exts.has(owner)) {
    return { ...base, success: false, error_code: "number_in_use", diagnostic: `Ce numéro est déjà assigné au poste ${owner}.` };
  }
  const voice = await assignDidToExtension(domain, pn, ext, opts.description);
  base.steps.voice = voice.verified;
  if (!voice.verified) return { ...base, success: false, error_code: "voice_failed", diagnostic: voice.diagnostic };
  base.steps.sms = (await assignSmsNumber(domain, pn, ext).catch(() => ({ ok: false }))).ok;
  base.steps.caller_id = (await setExtensionCallerId(domain, ext, pn).catch(() => ({ ok: false }))).ok;
  if (opts.releaseOthers) {
    const dids = await listLiveDids(domain);
    for (const [other, dest] of dids) {
      if (other === pn || dest !== ext) continue;
      const rel = await releaseDid(domain, other);
      const s = await assignSmsNumber(domain, other, null).catch(() => ({ ok: false }));
      base.steps.released.push({ number: other, ok: rel.released && s.ok });
    }
  }
  const success = base.steps.voice && base.steps.sms && base.steps.caller_id && base.steps.released.every((r) => r.ok);
  return {
    ...base, success,
    error_code: success ? undefined : "partial",
    diagnostic: success
      ? `Appels ✓ Textos ✓ Numéro affiché ✓ pour ${e164Of(pn)} → ${ext}.`
      : `Appels ${base.steps.voice ? "✓" : "✗"} Textos ${base.steps.sms ? "✓" : "✗"} Numéro affiché ${base.steps.caller_id ? "✓" : "✗"}`
        + (base.steps.released.some((r) => !r.ok) ? " · libération ancien numéro ✗" : "") + " — relancez l'assignation.",
  };
}
