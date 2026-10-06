# Phase 45A — Préparation de recette sur appareils Lemtel

La phase compile et vérifie la nouvelle logique **Hostinger staging** sans changer les applications installées :

| Cible | Preuve CI | Ce que cela ne fait pas |
| --- | --- | --- |
| Android | APK debug + installation/lancement sur émulateur | Aucune signature release ni diffusion Play Store |
| iOS | Compilation device Debug sans signature | Impossible à installer sur un iPhone sans identité Apple/profil ou TestFlight |
| macOS | Paquet privé non signé x64/arm64 | Pas de notarisation, d’auto-update ou de téléchargement public |

Avant un appel réel, il faut une extension de test, SIP/WSS/TURN du tenant FusionPBX de recette, l’accord du propriétaire de l’appareil de test et un plan de scénarios. Le workflow n’écrit pas sur Hostinger/DO, ne démarre pas DO et ne change ni DNS, ni FusionPBX, ni Planiprêt.
