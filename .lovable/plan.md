**Do I know what the issue is?** Oui.

**Problème exact**
L’app Android a deux connexions séparées: la connexion Verto du WebView et le `SipConnectionService` natif. Quand le téléphone se verrouille, Android suspend/ferme souvent le WebView; le statut affiché vient encore du WebView, pas du service natif. Donc l’app passe à `unregistered/retrying` même si le service natif tente de rester connecté, et les appels peuvent ne pas être remis correctement au UI.

**Plan de correction**
1. Faire du `SipConnectionService` Android la source officielle du statut background.
2. Ajouter des événements natifs vers React: `registered`, `disconnected`, `reconnecting`, dernière raison, dernier ping, dernier login OK.
3. Mettre à jour `useSoftphoneVerto.ts` pour afficher le statut natif quand l’app est background/locked, au lieu de se fier seulement au WebView.
4. Corriger le cycle de reconnexion natif: heartbeat plus strict, watchdog stale-socket, reconnexion immédiate au retour réseau, et logs structurés persistés.
5. Éviter le conflit double-login WebView/native: WebView pour appels actifs au premier plan, service natif pour maintien/enregistrement background.
6. Sur `verto.invite` reçu par le service natif: afficher notification plein écran, stocker l’appel entrant, réveiller l’app, puis forcer une resynchronisation Verto côté UI.
7. Ajouter un panneau debug Android dans Settings: statut natif, dernière déconnexion, dernière reconnexion, battery optimization, WakeLock/WifiLock.
8. Vérifier avec scénario réel: app ouverte → verrouiller téléphone → attendre 2-5 min → appeler ext 223/300 → vérifier notification + statut + logs.

**Fichiers ciblés**
- `SipConnectionService.kt`
- `CapacitorPjsip.kt`
- `nativeSipProvider.ts`
- `useSoftphoneVerto.ts`
- écran Settings/debug SIP existant

**Après implémentation**
Tu devras faire `git pull`, puis `npx cap sync android`, rebuild sur un vrai Android. Lis aussi le blog-post Capacitor mobile avant le test natif.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>