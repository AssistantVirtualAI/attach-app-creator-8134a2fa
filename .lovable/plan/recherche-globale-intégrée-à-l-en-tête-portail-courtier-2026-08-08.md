# Recherche globale intégrée à l'en-tête (portail courtier)

Supprimer la page « Recherche » et la remplacer par une barre de recherche universelle présente en haut de **toutes** les pages du portail courtier, avec résultats instantanés pendant la frappe.

## Ce qui change pour l'utilisateur

- Plus d'onglet « Recherche » dans le menu latéral ni dans la barre mobile.
- Une barre de recherche visible en permanence dans l'en-tête (desktop **et** mobile).
- Dès 2 caractères tapés, les résultats apparaissent automatiquement dans un panneau déroulant (aucun bouton « Rechercher », aucune touche Entrée requise).
- Résultats groupés par source, avec un lien « Ouvrir la section » vers la page correspondante et un clic direct qui ouvre l'élément.
- Raccourci clavier ⌘K / Ctrl+K pour ouvrir la recherche, Échap pour fermer, flèches + Entrée pour naviguer.

## Portée des données interrogées

Toutes les sources du portail, toujours filtrées au courtier connecté :

- Appels (numéro, nom, résumé IA, statut)
- Textos (numéro, nom, contenu)
- Messagerie vocale (numéro, nom, transcription)
- Enregistrements (issus des appels avec enregistrement)
- Clients Maestro (nom, courriels, téléphones)
- Courriels Microsoft 365 (objet, expéditeur) et contacts/collègues Teams
- Commissions (nom du client, prêteur, référence)

Les sources lentes (Maestro, Microsoft) sont interrogées en parallèle des sources locales et s'ajoutent au panneau dès qu'elles répondent, sans bloquer l'affichage.

## Détails techniques

- Nouveau composant `src/components/planipret/broker/BrokerOmniSearch.tsx` : champ + panneau de résultats, debounce ~250 ms, annulation des requêtes obsolètes, mise en cache courte par terme.
- Nouveau hook `src/hooks/planipret/useBrokerGlobalSearch.ts` : orchestre les requêtes Supabase (`brokerSelect` + `searchFilter` de `brokerAccess.ts`, limite ~8 par source) et les appels edge (`maestro-actions` liste clients, `ms365-actions` recherche courriels/personnes) en `Promise.allSettled`.
- `PlanipretBrokerLayout.tsx` : retirer l'entrée `search` de `NAV`, remplacer le formulaire d'en-tête par `BrokerOmniSearch`, et ajouter la même barre dans l'en-tête mobile (sous le titre) pour qu'elle soit sur toutes les pages.
- Supprimer `src/pages/planipret/broker/PBSearch.tsx` et sa route ; rediriger `/planipret/broker/search` vers `/planipret/broker` afin que les anciens liens ne cassent pas.
- Les liens « Ouvrir la section » continuent de passer le terme en paramètre (`?q=` / `?search=`) aux pages Appels, Textos, Voicemail, Enregistrements, Clients Maestro.
- Textes FR/EN via `useMplanipretLang`, styles avec les tokens `pp-*` existants.
