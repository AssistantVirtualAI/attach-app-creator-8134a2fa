# Nouvel avis d'enregistrement + mises à jour poussées depuis le portail

Deux chantiers indépendants.

## Partie 1 — Remplacer l'avis d'enregistrement

Ce qui existe aujourd'hui (vérifié dans le code) :
- Le média d'attente NetSapiens nommé `ava-recording-notice` est le seul avis joué. Il est référencé dans `pp-ns-did-announcement` (file personnelle par courtier, entrants uniquement) et dans `pp-ns-ring-announcement`.
- L'action `upload` de `pp-ns-ring-announcement` envoie déjà un fichier audio en `base64_file` vers NetSapiens sous ce même nom.
- L'application ne joue plus aucun avis localement (`recordingNotice.ts` est un no-op) : il n'y a donc rien à changer côté mobile.

Fichier fourni : MP3 mono 44,1 kHz, 4,3 s.

Étapes :
1. Convertir le MP3 en WAV PCM 8 kHz mono (format attendu par le central) et le stocker comme asset du projet.
2. Appeler l'action `upload` de `pp-ns-ring-announcement` avec ce nouveau fichier, sous le nom `ava-recording-notice`, pour écraser le média actuel — aucun DID n'est touché (invariant de routage respecté).
3. Vérifier via l'action `status` que le média est bien remplacé, puis un appel test entrant vers un DID courtier pour écouter la nouvelle voix.

## Partie 2 — Pousser des mises à jour vers l'application mobile depuis le portail

Objectif : modifier l'app sans repasser par l'App Store / Play Store à chaque fois. Trois niveaux, du plus simple au plus complet.

### Niveau A — Configuration à distance (immédiat, sans rebuild)
Une table `mobile_app_config` (par app : planipret / lemtel, et par canal : prod / beta) contenant :
- interrupteurs de fonctionnalités (activer/désactiver un onglet, une page, un bouton),
- textes et bannières affichés dans l'app (message d'annonce, maintenance, nouveautés),
- paramètres numériques (délais de sonnerie, intervalles de rafraîchissement, URL de support),
- version minimale requise + version recommandée.

Côté portail : une page **Admin → Application mobile** pour éditer ces valeurs, avec aperçu et bouton « Publier ». Côté app : lecture au démarrage + à chaque retour en avant-plan, avec mise en cache locale pour le mode hors ligne.

### Niveau B — Mises à jour du contenu web de l'app (OTA)
L'app est en Capacitor : tout ce qui est JS/CSS/HTML peut être remplacé sans passer par les stores. On ajoute un mécanisme de bundle web :
- le portail téléverse un paquet de build dans un bucket de stockage privé,
- une table `mobile_app_releases` enregistre version, canal, notes, empreinte, actif oui/non,
- l'app vérifie au démarrage s'il existe un bundle plus récent pour son canal, le télécharge, vérifie l'empreinte, et l'applique au prochain lancement (avec retour automatique à la version précédente si le nouveau bundle plante).

Limite à respecter : seul le code web peut être poussé ainsi. Tout changement natif (PJSIP, CallKit, permissions, plugins) exige toujours une soumission aux stores.

### Niveau C — Mise à jour obligatoire et notifications
- Si la version installée est sous la version minimale, l'app affiche un écran bloquant avec le lien vers le store.
- Le portail peut envoyer une notification push « nouvelle version disponible » ou un message in-app ciblé (tous, un courtier, un canal beta).
- Journal d'audit : qui a publié quoi et quand, et taux d'adoption par version.

### Ordre de livraison proposé
1. Partie 1 (avis d'enregistrement).
2. Niveau A : table de config, page admin, lecture côté app.
3. Niveau C : version minimale, écran de mise à jour obligatoire, notifications.
4. Niveau B : OTA des bundles web, d'abord sur le canal beta, puis prod.

## Détails techniques
- Nouvelles tables `public` : `mobile_app_config`, `mobile_app_releases`, `mobile_app_config_audit` — lecture par les utilisateurs authentifiés de l'app, écriture réservée aux admins Planiprêt, avec GRANT explicites.
- Bucket de stockage privé pour les bundles, accès via URL signée générée par une edge function.
- Nouvelles edge functions : `mobile-config` (lecture publique authentifiée), `mobile-config-admin` (écriture + publication), `mobile-release-publish` (téléversement bundle + activation/rollback).
- Côté app : un `RemoteConfigProvider` avec cache Preferences, un hook `useRemoteConfig()`, et un `useAppUpdate()` pour le contrôle de version. Le mécanisme OTA s'appuie sur le plugin de mise à jour live Capacitor, auto-hébergé sur notre stockage.
- Conformité stores : l'OTA reste limité au contenu web déjà validé, sans changer la finalité de l'app.
