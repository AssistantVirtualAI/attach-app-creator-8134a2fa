# AVA par texto — essai sur la ligne de Marc

## Déjà vérifié et publié
- Publication du portail demandée pour https://avastatistic.ca; le domaine répond HTTP 200.
- Les 61 tests de protection AVA réussissent.
- L’agent partagé contient les 93 outils attendus et 3 fonctions natives ElevenLabs; aucun outil attendu ne manque. Jessica est conservée.
- Ces contrôles prouvent la configuration et les protections, pas le succès de chaque action réelle ni la réception sur iPhone.

## Expérience à activer
- Un essai exclusivement sur la ligne vérifiée de Marc Maglieri, poste 1136; aucun changement pour les autres courtiers.
- AVA lit uniquement l’historique du fil concerné, comprend la demande et répond automatiquement aux questions ordinaires.
- Elle peut proposer des créneaux disponibles et réserver un rendez-vous demandé dans le calendrier de Marc, sans exposer les titres ou participants de ses autres rendez-vous.
- Elle identifie les collègues par les associations vérifiées poste/DID; une identité interne ne donne pas accès à tous les dossiers privés de Marc.
- Les demandes sensibles, ambiguës ou hors périmètre sont présentées à Marc pour autorisation; notification iOS via le service existant, avec ouverture du dossier de demande dans le portail.
- Pas de changement natif iOS/Android; pas d’appel vocal automatique ni de nouvelle voix.

## Protections obligatoires
- Un numéro externe, même reconnu comme DID d’un collègue, ne constitue pas une authentification suffisante pour transmettre des renseignements clients, financiers, courriels ou historiques d’autres fils.
- Les clients externes reçoivent seulement des informations non sensibles et celles explicitement autorisées par Marc. Aucune divulgation privée sur simple demande par texto.
- Réponses internes ordinaires sans confirmation de Marc; droits du demandeur et propriété des données toujours vérifiés côté serveur.
- Autorisation automatique dédiée aux réponses sur le fil entrant et aux rendez-vous: ne jamais simuler une confirmation utilisateur ni affaiblir les confirmations actuelles des autres outils AVA.
- Aucune répétition automatique d’un envoi incertain, aucune réponse aux événements sortants, aucune boucle entre assistants.
- Aucun traitement rétroactif des anciens messages; seulement les nouveaux événements après activation. Arrêt de l’essai accessible à Marc et à un administrateur autorisé.

## Détails techniques
1. Ajouter un adaptateur serveur événementiel au traitement `message.inbound` de `ns-webhook-receiver`, après persistance et résolution unique du propriétaire; conserver le secret de webhook existant et les notifications actuelles.
2. Conserver la logique AVA partagée et son registre; fournir un contexte SMS isolé au fil et une liste de capacités autorisées par politique serveur. Ne pas donner à un correspondant le contexte authentifié complet de Marc.
3. Persister la configuration Marc-only, les traitements uniques par événement, les propositions sensibles et leurs décisions. Tables serveur avec GRANT explicites, RLS et accès administrateur/propriétaire vérifiés.
4. Réutiliser le transport SMS et les contrôles d’attribution existants via une autorisation serveur étroitement bornée: fil, destinataire, action et événement. Le contrat des envois AVA interactifs demeure inchangé.
5. Calendrier: lecture limitée aux plages occupées, nouvelle vérification du créneau avant écriture, réservation idempotente; liens et invitations uniquement pour le rendez-vous demandé.
6. Réutiliser les notifications iOS existantes pour les décisions de Marc. Ne pas considérer l’acceptation du service comme preuve de réception ou de lecture.

## Tests et activation
- Tests concrets: poste 1136 autorisé, tous les autres exclus, propriétaire ambigu refusé, faux DID interne sans accès privé, historique strictement limité au fil, action sensible en attente, doublon sans second envoi, message sortant ignoré, conflit calendrier empêchant réservation.
- Maintenir les 61 tests AVA existants sans modifier leurs assertions de protection.
- Vérifier une réception réelle, une réponse simple, une demande de rendez-vous et une demande sensible avec approbation de Marc; vérifier les résultats dans son portail.
- Déployer uniquement les fonctions concernées après tests, puis activer l’essai. Confirmer séparément avec Marc la réception iOS et SMS; ne pas annoncer l’essai fonctionnel avant cette vérification.