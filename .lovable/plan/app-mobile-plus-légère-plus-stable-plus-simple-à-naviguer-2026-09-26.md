# App mobile plus légère, plus stable, plus simple à naviguer

Livraison : dans la prochaine soumission iPhone/Android, avec le portail web à jour en même temps. Ne change ni les réglages d'appel natifs, ni NetSapiens, ni les versions iOS/Android.

## 1. Passer d'une page à l'autre plus vite
- Précharger en arrière-plan les 5 onglets du bas (Accueil, Appels, AVA, Messages, Contacts) après l'ouverture de l'app : plus d'écran blanc au premier toucher.
- Garder le contenu déjà affiché pendant l'actualisation : un petit indicateur en haut remplace le squelette plein écran.
- Revenir sur un onglet le rouvre à la même position de défilement.
- Mesurer, puis réduire le nombre de demandes envoyées au serveur à l'ouverture de l'accueil : regrouper les compteurs et supprimer les doublons.

## 2. Aucune liste qui disparaît
- Appliquer la même règle partout (tâches, messages, appels, messages vocaux, contacts, courriels, commissions) : en cas d'erreur, la dernière liste connue reste affichée, avec un bandeau discret « Dernier état connu · Réessayer ».
- L'écran d'erreur complet n'apparaît que s'il n'existe aucune donnée en mémoire.
- Chaque liste est conservée après un redémarrage de l'app : la dernière version s'affiche tout de suite, puis se met à jour.
- Éviter aussi que le serveur tombe en surcharge, comme pour les tâches de Sandra, sur les autres listes volumineuses (appels, messages).

## 3. Navigation plus claire
- Réorganiser le menu « Plus » en groupes nommés (Travail : Tâches, Pipeline, Commissions, Maestro · Communication : Messages vocaux, Courriels · Compte : Réglages, Connexions, Feedback).
- Uniformiser l'en-tête des pages secondaires : bouton Retour, titre, actualisation, toujours au même endroit.
- Boutons d'action avec du texte, pas seulement des icônes, comme pour les nouveaux boutons des tâches.
- Toutes les tuiles et cartes de l'accueil mènent à leur page.

## 4. Barre du haut et affichage iPhone
- Barre du haut toujours fixée (feedback, thème, langue, avis), y compris après le clavier, la connexion Maestro, un appel ou le retour de l'app.
- Barre du bas bien placée au-dessus de la zone de geste de l'iPhone. Aucun contenu caché dessous.
- Supprimer l'avertissement récurrent « ResizeObserver loop » et les autres erreurs d'affichage relevées.

## 5. Vérification
- Parcours automatisé sur écran de téléphone : ouvrir chaque onglet et chaque page du menu Plus, sans écran blanc ni erreur dans la console.
- Scénario « serveur en panne » : chaque liste garde son contenu.
- Tests existants plus nouveaux tests de non-régression. Les copies portail et app mobile restent identiques.
- Captures avant/après des écrans principaux.

## Détails techniques
- Préchargement : `import()` différé des routes des onglets après la première peinture (`requestIdleCallback`) dans `App.tsx` des deux arbres.
- Un hook commun `useResilientList(key, fetcher, ttl)` bâti sur `screenCache.ts` (mémoire, puis localStorage) : il remplace les états d'erreur locaux de `MMessages`, `MCalls`, `MVoicemail`, `MContacts`, `MCommissions` et `TasksSection`.
- Un composant `MobilePageHeader` commun pour les pages secondaires. Menu `MMore` regroupé par sections.
- Barre du haut : `position: sticky` dans `#pp-mobile-frame`, avec réinitialisation du défilement limitée au cadre principal (pas aux listes défilantes). Padding `env(safe-area-inset-bottom)` pour la barre du bas.
- Serveur : pagination et plafonds sur `pp-ns-cdr` / `pp-ns-sms` pour les gros comptes, sur le modèle du correctif `planipret-task-api`.
- Aucun ajout d'interrogation répétée du serveur (polling). Réglages natifs PJSIP, CallKit, PushKit et TLS inchangés.
