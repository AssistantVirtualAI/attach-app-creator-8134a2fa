# Appels, textos et enregistrements : remise à niveau complète + audit

## Ce que les données montrent aujourd'hui (mesuré)

- 2 416 appels enregistrés ; 468 seulement rattachés à une communication Maestro.
- 114 appels ont un enregistrement audio, 1 113 une transcription, 1 024 un résumé IA.
- 1 979 textos ; 1 632 marqués synchronisés vers Maestro (347 en attente), répartis sur 27 courtiers.
- 15 courtiers sur 224 ont une identité Maestro. Les autres ne peuvent rien pousser tant qu'ils ne se sont pas connectés une fois.

## 1. Couverture courtiers

- Lister les courtiers actifs (ceux qui ont un poste téléphonique) et distinguer : connectés à Maestro, jamais connectés, jeton expiré.
- Rafraîchir automatiquement les jetons expirés ; pour les jamais connectés, produire la liste nominative à faire connecter (aucune donnée ne peut partir sans leur autorisation Maestro).

## 2. Appels : enregistrement, transcription, résumé, coaching

- Reprendre la file de rattrapage jusqu'à épuisement, par lots bornés et auto-enchaînés.
- Pour chaque appel : récupérer l'audio du PBX, transcrire (avec bascule vers le fournisseur de secours), générer résumé + coaching, puis pousser vers la communication Maestro.
- Un appel n'est déclaré « complet » que si les quatre pièces sont présentes côté Maestro ; sinon il reste en attente avec la raison exacte (audio absent, transcription échouée, jeton manquant, refus Maestro).
- Les appels sans audio disponible chez le fournisseur sont classés à part, pour ne pas gonfler indéfiniment la file.

## 3. Textos regroupés par numéro

- Aujourd'hui les textos partent message par message. Nouveau comportement : un fil par numéro de contact et par courtier.
- Chaque fil est poussé comme une seule communication Maestro contenant l'historique horodaté (date, sens, texte), mise à jour lors des nouveaux messages plutôt que dupliquée.
- Clé d'idempotence par (courtier, numéro) pour éviter les doublons ; rattrapage des 347 textos non synchronisés dans les fils correspondants.
- Correspondance du numéro avec la fiche client Maestro ; sinon le fil est rattaché au contact créé/retrouvé par numéro.

## 4. Fiabilité et visibilité

- Suivi par courtier : appels en attente, textos en attente, motif du blocage, bouton de relance manuelle.
- Alerte quand un élément reste bloqué au-delà du délai prévu.

## 5. Audit final livré

Rapport unique avec, par courtier : nombre d'appels, part avec enregistrement / transcription / résumé / coaching visibles dans Maestro, nombre de fils de textos poussés, éléments restants et cause précise. Plus la liste des courtiers à faire connecter et les limites côté Maestro (leur lecteur audio ne lit que les médias hébergés chez eux ; le lien d'écoute dans les notes reste la solution).

## Notes techniques

- Fonctions touchées : `maestro-sync-call`, `maestro-sync-message`, `pp-maestro-sms-sweeper`, `pp-maestro-push-sweeper`, `maestro-recording-upload`, `ai-transcribe-call`.
- Regroupement SMS : nouvelle table de fils (courtier + numéro + identifiant de communication Maestro + dernier message poussé) plutôt qu'un marqueur par message.
- Aucun changement au SIP, au natif mobile ni à l'authentification Microsoft.
