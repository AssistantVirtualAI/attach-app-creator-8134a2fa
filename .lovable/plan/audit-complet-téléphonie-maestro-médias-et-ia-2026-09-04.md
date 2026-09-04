# Audit complet — téléphonie, Maestro, médias et IA

Objectif : passer toute l'application au banc d'essai, mesurer ce qui fonctionne réellement, et livrer un plan de correction priorisé. L'audit ne modifie rien ; les correctifs viennent en phases séparées après validation.

## Ce que les données montrent déjà (14 derniers jours, mesuré)

- 354 appels enregistrés en base ; 161 seulement possèdent un identifiant Maestro — 193 appels ne sont donc pas rattachés à une communication Maestro.
- 9 appels seulement ont un enregistrement audio associé.
- 57 appels restent en attente de transcription ; 146 ont un résumé et un coaching IA.
- 60 textos envoyés/reçus ; 8 seulement marqués comme synchronisés vers Maestro.
- Les files de travaux (traitement d'appel, actions PBX) sont vides sur la période : rien n'est en échec en file, ce qui suggère que les tâches ne sont pas créées plutôt qu'elles échouent.

Ces chiffres orientent l'audit mais les causes restent à confirmer phase par phase.

## Phase 1 — Téléphonie de base (appels)

- Enregistrement SIP par courtier : postes actifs, appareils mobile/web, état réel côté PBX vs état affiché.
- Appel sortant : composition interne (poste brut) et externe (E.164), affichage du numéro présenté, audio bidirectionnel.
- Appel entrant : routage du DID, sonnerie mobile et portail web, prise en arrière-plan et écran verrouillé, un seul écran d'appel.
- Transfert (aveugle et supervisé), mise en attente, muet, haut-parleur, DTMF, second appel.
- Boîte vocale : dépôt, liste, lecture, suppression, message d'accueil.
- Livrable : tableau poste par poste, PASS/WARN/FAIL avec identifiant d'appel de preuve.

## Phase 2 — Journal d'appels et enregistrements

- Comparaison des appels du PBX avec ceux stockés en base : appels manquants, doublons, direction et durée erronées, fuseau America/Toronto.
- Enregistrements : pourquoi 9 seulement sur 354 ; règle d'enregistrement active par poste, récupération du fichier, mise en cache, lecture et téléchargement.
- Vérification des liens d'enregistrement exposés au portail et à l'app.

## Phase 3 — Textos

- Envoi/réception réels, ordre des fils, compteurs non lus, doublons de bulles, pagination.
- Cause des 52 messages non synchronisés vers Maestro : contrat d'appel, correspondance du contact, statut renvoyé.

## Phase 4 — Intégration Maestro (endpoints)

- Inventaire de chaque endpoint utilisé (contacts, clients, appels, messages, enregistrements, transcriptions, tâches, commissions) avec méthode, code HTTP réel et exemple de réponse.
- Identité courtier résolue à chaque appel, isolation entre courtiers, comportement après déconnexion/reconnexion.
- Écritures : clé d'idempotence, absence de doublons, et raison exacte des appels sans identifiant Maestro.
- Distinction claire des états : traité localement / en attente Maestro / synchronisé / échoué.

## Phase 5 — Transcription, résumés et coaching IA

- Pourquoi 57 appels restent en attente : audio absent, plafond de tentatives atteint, ou erreur du fournisseur.
- Bascule automatique vers le fournisseur de secours quand le principal échoue.
- Qualité : langue détectée, résumé, points clés, prochaines actions, score de coaching, remontée vers Maestro sur la bonne communication.

## Phase 6 — AVA (chat et voix)

- Accès aux profils clients du courtier connecté et isolation multi-locataire.
- Chaque outil exécuté au moins une fois en chat et en voix : recherche de contact, lancer un appel (poste interne et numéro externe), envoyer un texto, créer/mettre à jour une tâche, résumé d'appel.
- Voix : démarrage de session, routage micro/haut-parleur, reprise après coupure réseau.

## Phase 7 — Portail et application mobile

- Connexion courtier et admin, ouverture directe du portail depuis l'app, expiration de session.
- Pages clés : accueil, clients, suivi par client, courtiers, tâches, commissions, enregistrements, calendrier et courriels Microsoft.
- Version affichée dans « Plus » cohérente avec la build installée, mises à jour à distance appliquées.
- Parité iOS / Android et écrans vides ou en erreur.

## Phase 8 — Santé backend et sécurité

- Taux d'erreur des fonctions serveur sur la fenêtre d'audit, appels lents, files bloquées.
- Contrôles d'accès : un courtier ne voit que ses données, les admins ne s'approprient pas les données d'autrui.
- Rétention et journaux d'audit.

## Livrable

Un rapport unique (PDF, anglais) : une ligne par test avec statut PASS / WARN / FAIL, preuve (identifiant de corrélation, code HTTP, extrait de journal, capture), cause racine par échec, et liste de correctifs classée bloquant / dégradé / cosmétique. Plus une courte liste de vérifications à faire sur un vrai appareil (appels SIP réels, arrière-plan, audio du voicebot, connexion Microsoft).

## Notes techniques

- Méthode : suites de tests existantes, appels directs aux fonctions serveur avec une vraie session courtier, requêtes base (lignes non synchronisées, doublons, files), lecture des journaux, et parcours navigateur headless pour le web mobile.
- Les écritures Maestro de test utilisent des clés d'idempotence pour ne pas polluer les Communications.
- Aucun fichier natif protégé (PJSIP, Info.plist, scripts de build, CI) n'est touché, aucun changement de code pendant l'audit.
- Les appels SIP réels et le comportement CallKit exigent un appareil : Tania reste sur un binaire App Store ancien, donc ces tests se font sur un poste à jour ou après une build TestFlight.
