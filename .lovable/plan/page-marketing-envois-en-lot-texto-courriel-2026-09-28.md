# Page Marketing — envois en lot (texto + courriel)

Nouvelle page dans le portail courtier pour rédiger un message, le faire embellir par l'IA, choisir les clients, puis envoyer. Historique complet pour le courtier et vue globale pour l'admin.

## Parcours du courtier

1. **Écrire** — le courtier tape son idée de message et choisit le canal : texto, courriel, ou les deux.
2. **Générer** — l'IA produit :
   - un courriel mis en page (logo Planiprêt, couleurs, bouton d'appel à l'action, signature du courtier : nom, titre, téléphone, courriel);
   - un texto court, clair, sans mise en forme lourde, avec mention de désabonnement.
3. **Valider** — aperçu réel des deux versions. Boutons : *Régénérer*, *Modifier le texte à la main*, *Confirmer*.
4. **Choisir les clients** — liste des clients Maestro du courtier, avec recherche, cases à cocher et « Tout sélectionner ». Chaque ligne indique si le client a un cellulaire, un courriel, ou les deux.
5. **Envoyer** — texto envoyé uniquement aux clients avec cellulaire valide, courriel uniquement à ceux avec adresse valide. Écran de confirmation avant l'envoi réel (nombre exact de textos et de courriels).

## Historique et statistiques

- **Courtier** : liste de ses campagnes (date, canal, nombre de destinataires) et détail par client : envoyé, livré, ouvert/cliqué, échoué (mauvais numéro, adresse invalide).
- **Admin** : même écran mais pour tous les courtiers, avec filtre par courtier et par période, plus les totaux.

### Ce qui est réellement mesurable (honnêteté des chiffres)

| Canal | Envoyé | Livré | Ouvert / lu | Échec |
|---|---|---|---|---|
| Courriel (Outlook du courtier) | oui | non confirmé par le fournisseur | ouverture estimée (pixel) et clics sur les liens | oui, si l'adresse est refusée à l'envoi |
| Texto (NetSapiens, DID du courtier) | oui | oui/non selon la réponse NetSapiens | **impossible** — aucun accusé de lecture SMS | oui, numéro invalide ou rejeté |

L'interface affichera ces limites clairement plutôt que d'inventer un taux de lecture. Les ouvertures courriel sont sous-estimées quand le client bloque les images.

## Détails techniques

**Base de données** (nouvelles tables, RLS + GRANT) :
- `planipret_marketing_campaigns` — courtier, canaux, sujet, corps HTML courriel, texte SMS, prompt d'origine, statut, compteurs, dates.
- `planipret_marketing_recipients` — campagne, id client Maestro, nom, numéro, courriel, canal, statut (`queued|sent|delivered|opened|clicked|failed`), motif d'échec, horodatages, jeton d'ouverture unique.
- RLS : le courtier voit ses campagnes; les admins Planiprêt voient tout (`is_planipret_admin`).

**Fonctions Edge** (toutes nouvelles, rien de modifié sur la téléphonie existante) :
- `pp-marketing-compose` (`verify_jwt=true`) — génère/régénère le courriel HTML et le texto via la passerelle IA Lovable (`openai/gpt-6-astra`, `/v1/responses`), avec le profil du courtier pour la signature. Sortie structurée : sujet, HTML, texte SMS.
- `pp-marketing-send` (`verify_jwt=true`) — crée la campagne, résout les destinataires (réutilise `maestro-actions: list_clients`), normalise les numéros en E.164, valide les adresses, écrit les destinataires, puis envoie par lots bornés : SMS via le proxy NetSapiens existant depuis le DID du courtier, courriel via Graph `/me/sendMail` du courtier. Verrou anti-double-envoi, limite par lot, marquage idempotent par destinataire.
- `pp-marketing-track` (`verify_jwt=false`) — pixel d'ouverture, redirection de clic et page de désabonnement, par jeton opaque (aucune donnée personnelle dans l'URL).

**Frontend** :
- `src/pages/planipret/broker/PBMarketing.tsx` (assistant en 4 étapes + onglet Historique), entrée de menu « Marketing » dans `PlanipretBrokerLayout`, route `/planipret/broker/marketing`.
- `src/pages/planipret/admin/PAMarketing.tsx` (historique global), route et menu admin.
- Bilingue FR/EN via `useMplanipretLang`, styles existants `PAPageShell` / `PPPrimitives`.

**Garde-fous** : aucun envoi réel sans confirmation explicite à l'écran; aucun DID, device SIP, règle d'appel, secret ni tâche planifiée touché; les quatre tâches NetSapiens restent suspendues; lien de désabonnement dans chaque courriel et mention STOP dans chaque texto.
