// Pure decision: may this request push a call to Maestro (CRM)?
// Only an authenticated broker click may push. Installed app sends
// `{force:true}`; the newer app also sends `explicit_user_action:true`.

export type CrmSyncDecision =
  | { allow: true; authorizeConsent: boolean }
  | { allow: false; code: string; message: string; skipped?: boolean };

export function decideCrmSync(input: {
  access: { ok: boolean; serviceRole?: boolean; status?: number; error?: string };
  explicit_user_action?: unknown;
  force?: unknown;
  call: { deleted_at?: string | null; save_consent?: string | null };
}): CrmSyncDecision {
  const { access, call } = input;
  if (!access.ok) {
    return {
      allow: false,
      code: access.error ?? "forbidden",
      message: access.status === 401 ? "Session expirée — reconnectez-vous." : "Cet appel ne vous appartient pas.",
    };
  }
  const manualClick = !access.serviceRole && (input.explicit_user_action === true || input.force === true);
  if (!manualClick) {
    return { allow: false, code: "manual_only", skipped: true, message: "Envoi CRM uniquement via le bouton Synchroniser." };
  }
  if (call.deleted_at) return { allow: false, code: "call_deleted", message: "Cet appel a été supprimé." };
  return { allow: true, authorizeConsent: call.save_consent !== "approved" };
}

export const INTERNAL_BROKER_CALL_MESSAGE =
  "Appel interne entre courtiers : déjà consigné dans Maestro par le courtier appelant.";

/** Maps a maestro-cdr skip to the user-facing stop, or null to continue. */
export function internalBrokerStop(cdrSkipped: unknown) {
  return cdrSkipped === "internal_broker_inbound"
    ? { code: "internal_broker_call", message: INTERNAL_BROKER_CALL_MESSAGE }
    : null;
}
