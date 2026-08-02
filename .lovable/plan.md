# Correction des 4 régressions bloquantes (Planiprêt Mobile)

Vérifié par grep dans le dépôt actuel : les 4 régressions sont bien présentes.

| Contrôle | Attendu | Actuel |
|---|---|---|
| `aps-environment` dans le générateur | production | development |
| `pushkit.unrestricted` | 0 | 1 |
| `.allowBluetooth,` | 0 | 3 |
| `allowBluetoothHFP` | 3 | 0 |
| `applicationState == .active` | 0 | 2 |
| `applicationState != .background` | 2 | 0 |
| `local dialog is live` dans le hook | 1 | 0 |
| `App.entitlements` commité | production, sans unrestricted | development + unrestricted |

## Régression 1 — Entitlements
Dans `apps/planipret-mobile/scripts/apply-native-config.mjs` (lignes 51-54), dans le fichier commité `apps/planipret-mobile/ios/App/App/App.entitlements`, et dans le gabarit `apps/planipret-mobile/native-config/ios-App.entitlements.snippet.xml` (même contenu, sinon la régression revient) :
- `aps-environment` → `production`
- suppression complète de `com.apple.developer.pushkit.unrestricted-voip` et de son `<true/>`

## Régression 2 — `.inactive` traité comme arrière-plan
Dans le générateur, lignes 682 (`load()`) et 923 (`isForeground()`) :
`UIApplication.shared.applicationState == .active` → `UIApplication.shared.applicationState != .background`.
Le fichier natif déjà commité `ios/App/App/Plugins/PpSipKeepAlive/PpSipKeepAlive.swift` (et `PpVoipCall.swift` si concerné) est aligné sur le même critère, pour que le code présent dans Xcode corresponde au générateur.

## Régression 3 — Bluetooth déprécié
Lignes 978, 979 et 1464 du générateur : `.allowBluetooth` → `.allowBluetoothHFP`, en conservant `.allowBluetoothA2DP` et `.mixWithOthers`. Même remplacement dans les fichiers Swift commités correspondants.

## Régression 4 — Verrou de claim non destructif
`src/hooks/useMplanipretSoftphone.ts` (ligne ~1091) **et sa copie** `apps/planipret-mobile/src/hooks/useMplanipretSoftphone.ts` : après `claimCall(...)` perdu, lecture de `ppSipProvider.getSnapshot().callState` ; si `active` ou `held`, on garde l'appel et on journalise `claim lost but local dialog is live`. Sinon comportement actuel inchangé.

`src/lib/planipret/calls/callSessionSync.ts` et sa copie mobile : `claimCall` relit la ligne après un claim perdu et renvoie `true` si `answered_by === "mobile"` (auto-claim récent du même appareil), sinon `false`. Aucune migration nécessaire : simple relecture via la table.

## Non touché (explicitement)
`recordingNotice.ts`, `preferredRoute = "earpiece"`, garde WSS core1, refus du décrochage REST, contrat de délais 8 s < 30 s < 32 s, `retainUntilConsumed`, garde `incomingPendingUntil` 45 s.

## Vérification finale
Exécution des 7 commandes grep du prompt + inspection de `App.entitlements`, résultats reportés dans le rapport. Chaque fonction modifiée est vérifiée comme réellement appelée (grep d'appel), pas seulement définie.
