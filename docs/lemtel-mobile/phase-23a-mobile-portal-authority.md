# Lemtel — Phase 23A : le portail, unique autorité DND et transfert (Mobile)

## Flux autoritaire

```text
Portail Lemtel → miroir d'extension → lemtel-client-config (authentifié)
  → manifeste validé (Phase 21A) / cache autorisé → carte Mobile « Politique du portail » (lecture seule)
```

## Chemins locaux supprimés

- Interrupteur « Ne pas déranger » → `mobileApi.setDnd()` → `POST /mobile-settings-dnd`.
- Interrupteur/feuille « Transfert d'appels » → `mobileApi.setForwarding()` → `POST /mobile-settings-forwarding`.

Les deux méthodes ont été retirées de `mobileApi.ts`, ainsi que les états, fonctions, lignes et feuille correspondants de `SettingsScreen.tsx`. Sans manifeste autorisé, aucun contrôle local ne réapparaît en repli. Les types `MeResponse`/`DashboardBrief` restent inchangés (compatibilité serveur).

## États affichés (lecture seule)

1. Ne pas déranger : activé / désactivé.
2. Transfert d'appels : activé / désactivé.
3. Enregistrement : non autorisé / autorisé par l'utilisateur / géré par le portail.
4. Boîte vocale : activée / désactivée.

La modification se fait uniquement dans le portail Lemtel.

## Ce qui ne change pas

- Android : JsSIP/WebView reste l'unique propriétaire WSS/REGISTER/signalisation; aucune pile Verto ni PJSIP active.
- Appels, audio, Click-to-Call, CDR, enregistrements, messagerie, voicemail.
- Autres préférences locales (thème, langue, sonnerie, sortie audio, haptics, permissions, réduction de bruit, réseau).
- Aucun serveur, portail, Supabase, FusionPBX/PBX, code natif ni package modifié.

## Limites

- Rafraîchissement selon le manifeste existant (900 secondes minimum).
- Aucune modification possible depuis le client.
- Essai physique Android/iOS requis séparément avant publication Store.
