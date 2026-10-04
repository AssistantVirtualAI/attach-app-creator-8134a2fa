# Lemtel — Phase 23B : le portail, unique autorité du transfert (Desktop)

Base de revue : `fc6cb6514`.

## Chaîne autoritaire

```text
Portail Lemtel → miroir d'extension → lemtel-client-config (authentifié)
  → manifeste Desktop validé / cache autorisé → carte « Portal policy » (lecture seule)
```

## Suppression

`apps/ava-softphone-desktop/src/components/CallForwarding.tsx` est supprimé, ainsi que son import et son rendu dans `SoftphonePane.tsx`. Ce composant lisait et écrivait directement `pbx_softphone_users.forward_enabled` / `forward_to` (`supabase.from('pbx_softphone_users').update(...)`). Aucun remplacement, stub ni alias n'existe : le client Desktop ne peut plus écrire la destination ni l'activation du transfert.

## Ce qui reste disponible

- `SettingsPage` (inchangé) : carte `desktop-portal-policy` avec les quatre états (DND, transfert, enregistrement, boîte vocale) et la note d'autorité du portail.
- Ligne « Call Forwarding — Manage in portal » : ouvre uniquement le portail.

## Exclusions (non modifiés)

Console/administration du portail (`TelecomSettingsView`, `AdminView`, `PbxEditSheet`), PBX/FusionPBX, Supabase, fonctions Edge, signalisation JsSIP, `useSoftphone`, Electron main/preload, Mobile.

## Limite

Les tests réels macOS/Windows et la validation SIP restent une phase physique séparée avant publication.
