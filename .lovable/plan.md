# Maestro: nouveaux endpoints mobiles + liaison courtier par courriel Microsoft

## État actuel (vérifié)

- `maestro-actions` expose déjà les 4 actions `list_clients`, `client_profile`, `list_brokers`, `broker_profile`, mappées sur `/users/{id}/clients`, `/users/{id}/clients/{client-id}/profile`, `/users/{id}/brokers`, `/users/{id}/brokers/{broker-id}/profile`.
- AVA voice (ElevenLabs) expose déjà les outils `list_my_clients`, `get_maestro_client_profile`, `list_my_brokers`, `get_maestro_broker_profile` (`ava-agent-config`, `ava-tool-executor`).
- AVA chat (`pp-ava-chat`) sait déclencher ces actions et paginer.
- **Le maillon manquant** : la résolution du `maestro_broker_id`. Elle se fait aujourd'hui par sondage SIP (`/users/{id}/sip`, boucle 1..250/800, cooldown 10 min) ou par `/users/me` (`maestro-telecom-link`). Résultat : `maestro_user_id_unresolved` pour les courtiers non appariés, donc les 4 endpoints échouent.

## Ce qui sera fait

### 1. Résolution du Maestro ID par courriel (nouvelle méthode principale)

Nouveau module partagé `_shared/maestro-broker-directory.ts` :
- Récupère l'annuaire courtiers via `GET /users/{seedId}/brokers` (seed = id admin/broker déjà connu, sinon fallback id global) et met le résultat en cache court.
- Indexe chaque entrée par courriel (normalisé en minuscules), avec index secondaires extension / téléphone.
- `resolveBrokerIdByEmail(admin, email)` retourne l'id numérique et le persiste sur `planipret_profiles.maestro_broker_id`.

### 2. Branchement à la connexion Microsoft

- `maestro-telecom-link` : ajoute la résolution par courriel (`ms365_email` puis `email`) **avant** l'appel `/users/me`, et conserve `/users/me` comme repli.
- Appel automatique après une session Microsoft réussie (`ms365-store-session` / `ms365-auth-session`), en fire-and-forget, si `maestro_broker_id` est vide.
- `_shared/maestro.ts` (`getBrokerAuth`) : tente la résolution par courriel avant de retomber sur le sondage SIP coûteux.

### 3. Backfill de masse

`pp-maestro-broker-backfill` : nouvelle stratégie `email` en priorité (un seul appel annuaire au lieu de centaines de sondages SIP), sondage SIP conservé en repli pour les profils sans correspondance courriel. Réponse enrichie : `matched_by_email`, `matched_by_sip`, `unmatched[]`.

### 4. AVA chat + AVA voice

- `ava-tool-executor` : messages d'erreur explicites quand la liaison Maestro manque, et déclenchement d'une tentative de liaison par courriel avant d'échouer.
- `pp-ava-chat` : même comportement, plus prise en charge de `broker_profile` dans le contexte automatique.
- `ava-agent-config` : prompt mis à jour pour décrire les 4 endpoints et le cas « compte non lié ».

### 5. Rapport / diagnostic

`pp-ava-e2e-check` étendu pour tester en direct les 4 endpoints (staging) pour le courtier appelant et retourner un rapport : statut de liaison, id Maestro, résultat de chaque endpoint, couverture des outils chat + voix. Affiché dans la page diagnostics existante.

## Détails techniques

- Aucune écriture DID / NetSapiens n'est touchée.
- Auth Maestro inchangée : `Bearer <machine key>` + `?machine=1`.
- Seule colonne écrite : `planipret_profiles.maestro_broker_id`.
- Les changements Edge Functions sont miroités dans `apps/planipret-mobile/` si des fichiers front y sont modifiés.

## Question ouverte

Le seed id utilisé pour lire `/users/{seedId}/brokers` : j'utiliserai l'id courtier global déjà stocké dans `planipret_integration_secrets`, sauf indication contraire.
