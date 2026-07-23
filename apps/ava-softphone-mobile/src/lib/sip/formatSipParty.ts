/**
 * Normalize a SIP remote party display so the UI never shows raw
 * `"Name" <sip:USER@domain>` strings.
 *
 * Returns:
 *   - name:      caller display name (falls back to user part)
 *   - user:      the SIP user (extension for internal, E.164 for PSTN)
 *   - domain:    host part (used to detect internal vs external)
 *   - isInternal:true when the user part is a 3-6 digit extension
 *   - subtitle:  short second-line label (e.g. "Poste 223 · Interne" / "Ext. 223 · Internal")
 */
export interface SipPartyDisplay {
  name: string;
  user: string;
  domain: string | null;
  isInternal: boolean;
  subtitle: string;
}

export function formatSipParty(raw: string | null | undefined, lang: 'fr' | 'en' = 'fr'): SipPartyDisplay {
  const empty: SipPartyDisplay = { name: lang === 'en' ? 'Unknown' : 'Inconnu', user: '', domain: null, isInternal: false, subtitle: '' };
  if (!raw) return empty;
  const s = String(raw).trim();
  if (!s) return empty;

  // Try `"Display Name" <sip:user@domain>` or `<sip:user@domain>` or `sip:user@domain` or bare user.
  let name = '';
  let uri = s;
  const named = s.match(/^"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  if (named) {
    name = named[1].trim().replace(/^["']|["']$/g, '');
    uri = named[2].trim();
  }
  const sipMatch = uri.match(/^sips?:([^@;>]+)(?:@([^;>]+))?/i);
  const user = sipMatch ? sipMatch[1] : uri.replace(/^sips?:/i, '').split('@')[0].split(';')[0];
  const domain = sipMatch && sipMatch[2] ? sipMatch[2].split(';')[0] : null;

  const isInternal = /^\d{2,6}$/.test(user);
  if (!name) name = isInternal ? (lang === 'en' ? `Extension ${user}` : `Poste ${user}`) : user;

  const subtitle = isInternal
    ? (lang === 'en' ? `Ext. ${user} · Internal` : `Poste ${user} · Interne`)
    : (user && user !== name ? user : '');

  return { name, user, domain, isInternal, subtitle };
}
