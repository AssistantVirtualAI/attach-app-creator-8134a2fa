# Rapports de commissions Planiprêt — mobile + AVA

Intégration complète et sécurisée de l'API officielle de rapports de commissions (`/api/main/commissions/reports/*`) dans l'app mobile, avec une nouvelle page détaillée et 5 outils AVA (chat + voix).

## Ce qui existe déjà
- `supabase/functions/_shared/maestro-commissions-api.ts` : client officiel (deposits paginé, agents, institutions) avec token Bearer Maestro OAuth côté serveur.
- `pp-maestro-commissions` / `pp-maestro-commissions-sync` : agrégation existante (portail web).
- `AiConsentGate.tsx` / `AiConsentHost.tsx` : consentement IA mobile déjà en place.
- Routes mobiles enfants sous `/mplanipret/*` dans `src/App.tsx` (lazy + `MobilePageSkeleton`).

## 1. Passerelle Edge Function `planipret-commission-reports`
Body strict : `{ action: "deposits" | "agents" | "institutions" | "summary", filters? }`.

- Vérification du JWT Supabase, résolution serveur du profil `planipret_profiles` et du rôle.
- Refus (403) de tout rôle autre que `admin` / `broker`, avant tout appel externe.
- Token Bearer obtenu uniquement côté serveur (OAuth Maestro stocké), jamais renvoyé au client.
- `users_id` client non fiable : broker forcé sur son propre id (ou membres d'équipe retournés par `/reports/agents`) ; admin validé contre la même liste.
- Allowlist stricte : `commission_type` (base|bonus|bonus2|perform), `split_type` (planipret|planipret_override|planipret_external), `order_by` (liste fermée), `sort` (asc|desc), `page >= 1`, `per_page` 1–200 (défaut 50), `number_prefix` normalisé, `date_from`/`date_to` obligatoirement appariés et ordonnés (sinon 422 champ par champ).
- Timeout 8 s, une seule reprise pour réseau/5xx, aucune pour 401/403/422.
- `summary` : agrégation serveur bornée (pages plafonnées) → total, nombre de dépôts, moyenne, volume de prêts, ajustements, top institutions, série par date, comparaison période précédente.
- Journalisation `planipret_edge_function_runs` : user_id, rôle, action, filtres normalisés, statut, durée, `correlation_id`. Jamais de token ni de données client complètes.
- Extension du client partagé : passage des filtres complets (institution, type, split, prefix, order_by, sort) à `fetchCommissionDeposits`.

## 2. Page mobile `MCommissions.tsx`
Nouvelle route `/mplanipret/commissions` (lazy, dans le groupe mobile existant), accès depuis Plus → Finances/Commissions et depuis une carte MHome.

- En-tête « Commissions » (sans robot AVA), sélecteur de période, bouton filtres.
- KPI : total, nombre de dépôts, montant moyen, volume de prêts, ajustements — CAD `fr-CA`, alimentés par l'action `summary`.
- Graphes légers (commissions par date, top institutions), masqués si vide.
- Feuille de filtres : période prédéfinie/personnalisée, courtier, institution, type de commission, split, préfixe de contrat, tri + direction.
- Liste paginée (per_page 50, chargement progressif), noms clients masqués en aperçu, détail au toucher en lecture seule.
- États : skeleton, vide, erreur + Réessayer, accès refusé, hors ligne, 422 par champ.
- Cache mémoire de session uniquement (5 min), clé `user_id + rôle + filtres`. Aucun stockage local.
- Style aligné sur les tokens mobiles Planiprêt, safe-area iOS, cibles 44 px.

## 3. MHome
Carte compacte « Commissions ce mois-ci » (total, nombre de dépôts, période, lien « Voir le rapport ») affichée uniquement pour admin/broker, chargée après le brief pour ne pas alourdir le démarrage. Masquée sinon. Inclusion dans le brief AVA seulement si la préférence « Inclure les commissions dans AVA » est activée (désactivée par défaut, stockée dans les préférences mobiles existantes).

## 4. Outils AVA (chat + voix, mêmes schémas)
`get_commission_summary`, `get_commission_deposits`, `get_commission_agents`, `get_financial_institutions`, `open_commission_report`.

- Déclarés dans `_shared/ava-tools.ts` (chat + ElevenLabs), exécutés dans `ava-tool-executor` en réutilisant la passerelle et ses contrôles de rôle.
- Consentement IA vérifié avant tout envoi de données financières au modèle ou à ElevenLabs.
- Par défaut, seul l'agrégat part vers le LLM/voix (total, nb, période, top 3 institutions, comparaison). Les listes détaillées exigent une demande explicite et un consentement couvrant ce partage.
- `open_commission_report` renvoie une navigation vers `/mplanipret/commissions` avec filtres pré-appliqués ; `MAvaChat.tsx` et `AvaVoiceAgent.tsx` gèrent cette action.
- Rôle non autorisé → message clair, aucun détail financier.

## 5. Tests
- Edge Function : sans token, rôle refusé, broker propre id, broker id non autorisé, admin id autorisé, 422 (date seule, per_page > 200, enum invalide), timeout et 5xx avec une seule reprise.
- Allowlist : aucun paramètre invalide ne sort de la passerelle.
- Sécurité : aucun token/clé dans le bundle ni les réponses ; isolation du cache.
- Page mobile : KPI, filtres, pagination, vide, offline, 401/403/422, format CAD fr-CA, institutions en français.
- AVA chat/voix : parsing des 5 outils, agrégat seul, consentement exigé, navigation.
- Régression : suites existantes (tâches, contacts, SMS, appels, MS365) doivent rester vertes ; `npm run build` fourni.

## Notes techniques
- Aucune migration prévue, sauf si la préférence « commissions dans AVA » ne trouve pas de colonne existante dans `planipret_settings` (sinon ajout d'un champ booléen par défaut `false`).
- Aucun fichier natif VoIP touché.
- Lecture seule stricte : aucune écriture de commission.
