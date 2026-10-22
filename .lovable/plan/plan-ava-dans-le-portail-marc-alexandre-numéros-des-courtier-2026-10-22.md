# Plan : AVA dans le portail (Marc-Alexandre) + numéros des courtiers

## Partie 1 — AVA chat et voix dans le portail, Marc-Alexandre Maglieri seulement
- Bouton AVA dans le portail courtier et admin, visible uniquement pour Marc-Alexandre (poste 1136).
- Même AVA que l'application : chat avec tous les outils Maestro (clients, profils, tâches, commissions, courtiers) et voix Amélie.
- Les autres comptes ne voient rien de nouveau; Marc ne voit que ses propres données.
- Aucun changement à l'application mobile, au code natif ou aux appels.

## Partie 2 — Numéros de Karl, Megan et de tous les courtiers
Constat actuel (lecture seule) : nos fiches locales datent d'août et montrent encore les 438 :
- Karl Hamilton (1142) : +1 438 953-5017
- Megan Lussier (1117) : +1 438 953-4992 (NetSapiens a déjà le 514 880-1737)
- Marc-Alexandre (1136) : +1 438 953-5011

Étapes :
1. Lire dans NetSapiens les numéros réellement assignés à chaque poste de courtier (Karl : confirmer le 450).
2. Karl : passer par l'outil standard d'assignation pour garder le 450 (appels, textos, numéro affiché à l'appel sortant vérifiés par relecture) et libérer le 438 de son poste. Je vous montre le 438 exact avant de le retirer.
3. Mettre à jour nos fiches locales avec les numéros NetSapiens pour tous les courtiers.
4. Envoyer au widget Maestro, par le webhook existant, la fiche complète de chaque courtier actif avec son numéro actuel (Megan et Karl inclus).
5. Rapport : par courtier, numéro NetSapiens, numéro local avant/après, envoi widget OK/échec, et les écarts restants.

## Points d'attention
- Retirer le 438 de Karl et changer son numéro affiché touchent au routage téléphonique : c'est fait seulement avec l'approbation de ce plan.
- Aucune autre modification de routage; aucun numéro retiré pour les autres courtiers sans vous le montrer.

## Détails techniques
- Partie 1 : réutiliser `AvaChatSheet` / `AvaVoiceAgent` dans un `PortalAvaLauncher` monté dans les layouts portail; indicateur `metadata.portal_ava_enabled` sur le profil de Marc; `pp-ava-chat` et `pp-ava-webrtc-token` refusent `surface: "portal"` sans l'indicateur (403). Tests masqué/403 et `list_clients` relu.
- Partie 2 : lecture NS-API v2 des phonenumbers du domaine; Karl via `assignNumberToExtension` (`_shared/pp-did-routing.ts`, inclut `dial-rule-translation-destination-user` et caller ID, libère l'ancien); resynchroniser `planipret_did_assignments` et `planipret_profiles.phone`; push via `_shared/maestro-widget-sync.ts` avec payload complet (jamais partiel). Fonction admin ponctuelle si aucune existante ne fait la boucle tous-courtiers.
- Déploiement des fonctions touchées seulement; pas de publication web sans demande.
