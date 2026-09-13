# Appeler le numéro composé directement, avec votre DID affiché

## Problème

Aujourd'hui, quand la ligne de l'app n'est pas active côté central, le système fait sonner votre cellulaire en premier, puis compose le client. C'est lent, ce n'est pas ce que vous voulez, et le numéro affiché au client n'est pas garanti d'être le vôtre.

## Ce qui va changer

1. **Plus jamais d'appel vers votre cellulaire.** L'appel part toujours de votre poste dans l'app : le numéro composé sonne, et vous parlez dans l'app.
2. **Si votre ligne n'est pas active**, l'app tente de la réactiver, puis affiche un message clair (« Votre ligne n'est pas connectée — rouvrez l'app ») au lieu de détourner l'appel vers votre cellulaire.
3. **Votre DID assigné s'affiche au client.** Le numéro affiché est repris de la configuration « Appels sortants » de votre poste, et à défaut du numéro attribué à votre poste chez le fournisseur.
4. L'écran d'appel n'apparaît que s'il y a vraiment une conversation dans l'app.

## Détails techniques

- `supabase/functions/pp-ns-calls` (action `start`) :
  - supprimer le repli `cell` (et l'option `extension` qui sonne ailleurs) ; si aucun appareil n'est inscrit, retourner une erreur explicite `sip_not_registered` au lieu d'originer l'appel.
  - résoudre le caller ID côté serveur : `planipret_outbound_settings.caller_id_number` du courtier, sinon le DID du poste via NS (`/domains/{d}/users/{ext}` → numéro sortant), sinon aucun champ (défaut du central). Normaliser en chiffres.
  - toujours envoyer `caller-id-number` (et `caller-id-name` si configuré) dans le corps NS.
  - conserver `synchronous: "no"`, le format chiffres + repli E.164 et le log de latence.
- `apps/planipret-mobile/src/hooks/useMplanipretSoftphone.ts` et `src/hooks/useMplanipretSoftphone.ts` :
  - retirer le chemin `ringsOnCell` ; sur `sip_not_registered`, remonter une erreur affichée en toast et ne pas créer de fenêtre d'appel.
  - conserver le réveil borné à 2 s de la ligne avant le repli REST.
- i18n : remplacer `dialer.callStartedCell` par un message d'erreur `dialer.sipNotRegistered` (FR/EN).
- Aucune modification de PJSIP iOS, TLS 5061, CallKit, propriété de l'AOR mobile, session audio ou routage.

## Vérification

- Typecheck + tests mobiles.
- Test réel : composer un numéro depuis l'app → le numéro sonne directement (pas votre cellulaire), et l'afficheur montre votre DID.
