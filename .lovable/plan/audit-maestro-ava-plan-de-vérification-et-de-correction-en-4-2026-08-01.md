# Audit Maestro / AVA — Plan de vérification et de correction en 4 phases

## Constat important avant de commencer

J'ai relu le code de ce projet ligne par ligne. Les 7 « manquants » de l'audit **existent dans ce dépôt** :

| # | Point de l'audit | État vérifié ici |
| --- | --- | --- |
| 2 | `maestro_action` non exécuté dans `pp-ava-chat` | Présent — bloc `if (kind === "maestro_action")` à la ligne 240 de `supabase/functions/pp-ava-chat/index.ts`, avec listes, profils, pagination et gestion d'erreurs |
| 4 | 4 outils absents de `TOOL_NAMES` | Présents — ligne 20 de `supabase/functions/ava-agent-config/index.ts` (`list_my_clients`, `get_maestro_client_profile`, `list_my_brokers`, `get_maestro_broker_profile`) |
| 5 | Broker ID non lié au sign-in email/password | Présent — `pp-mobile-profile/index.ts` importe et appelle `linkBrokerIdByEmail` (lignes 2, 75-87) |
| 6 | Pagination absente | Présente — `maestro-actions` renvoie `offset/next_offset/prev_offset/has_more/page/page_count` (lignes 304-322) et `MAvaChat.tsx` affiche la pager row ◀/▶ (lignes 442-465) |
| 7 | Caching absent | Présent — cache mémoire 90 s dans `maestro-actions/index.ts` (lignes 53-73) |
| 8 | `MaestroRelinkButton` absent | Présent — composant + branché dans `MConnections.tsx` et `MMore.tsx`, côté app principale **et** `apps/planipret-mobile/` |
| 9 | Tests Deno absents | Présent — `supabase/functions/tests/maestro-mobile-endpoints.test.ts` |

L'audit porte sur la branche externe `planipret-build/main` (commit `08b3c47`), qui **n'a pas reçu ces changements**. Le vrai problème n'est donc pas « le code manque » mais « le code n'est pas déployé / pas synchronisé vers la branche auditée ».

Le plan ci-dessous garde les 4 phases demandées, mais chaque phase = **vérifier → corriger si écart → déployer → prouver par un test réel**, avec un rapport problème/solution/fichier.

---

## PHASE 1 — Chatbot : exécution des suggestions `maestro_action`

Problème rapporté : cliquer une suggestion Maestro ne fait rien.

Actions :
1. Relire le handler `confirm_action` de `supabase/functions/pp-ava-chat/index.ts` et vérifier que toutes les actions du set `MAESTRO_ACTIONS` retournent bien une réponse (liste, profil, action générique, erreur).
2. Vérifier côté client (`MAvaChat.tsx`, app principale + `apps/planipret-mobile/`) que le clic sur une suggestion renvoie bien `confirm_action` + `approved` et affiche `reply`.
3. Redéployer `pp-ava-chat`.
4. Preuve : appel réel de l'Edge Function avec `confirm_action { kind: "maestro_action", action: "client_profile" }` et capture de la réponse.

## PHASE 2 — Voicebot : outils Maestro visibles par ElevenLabs

Problème rapporté : les 4 outils ne sont pas dans `TOOL_NAMES`.

Actions :
1. Confirmer la présence des 4 noms dans `ava-agent-config/index.ts` et qu'ils sont bien poussés dans le payload agent ElevenLabs (`tools: TOOL_NAMES`, ligne 280).
2. Vérifier que chaque nom a une implémentation correspondante dans `ava-tool-executor` et un libellé dans `avaToolLabels.ts` (FR/EN) — ajouter les libellés manquants (les 4 outils n'y figurent pas aujourd'hui).
3. Redéployer `ava-agent-config` + `ava-tool-executor`, puis relancer la resynchronisation de l'agent ElevenLabs pour que le catalogue d'outils soit réellement mis à jour côté fournisseur.
4. Preuve : lecture de la config d'agent renvoyée par la fonction, avec les 4 outils listés.

## PHASE 3 — Broker ID auto-link au sign-in email/password

Problème rapporté : `maestro_broker_id` reste null en connexion email/password.

Actions :
1. Confirmer l'appel `linkBrokerIdByEmail` dans `pp-mobile-profile` et vérifier le comportement quand l'annuaire ne répond pas (erreur silencieuse vs remontée dans la réponse).
2. Ajouter, si absent, le même auto-link sur le chemin de connexion email/password en cas d'échec du premier essai (retry non bloquant au boot).
3. Requête en base : compter les profils `@planipret.com` avec `maestro_broker_id` null, puis lancer le backfill (`pp-maestro-broker-backfill`) pour ceux qui matchent l'annuaire.
4. Preuve : chiffres avant/après du nombre de profils liés.

## PHASE 4 — Pagination, cache, bouton de relien, tests

Actions :
1. Pagination : vérifier bout-en-bout `maestro-actions` → `pp-ava-chat` → pager row de `MAvaChat.tsx` sur une liste réelle de 196 clients (page 1, suivante, précédente).
2. Cache : vérifier le TTL 90 s et l'invalidation sur écriture, et que `refresh: true` force le rechargement.
3. `MaestroRelinkButton` : vérifier le rendu et le comportement dans Connexions et Plus, sur l'app principale et l'app mobile.
4. Tests : exécuter `supabase/functions/tests/maestro-mobile-endpoints.test.ts` et corriger ce qui échoue.
5. Synchroniser tout vers `apps/planipret-mobile/` et vérifier que le typecheck passe.

---

## Détails techniques

Fichiers concernés :
- `supabase/functions/pp-ava-chat/index.ts`
- `supabase/functions/ava-agent-config/index.ts`, `supabase/functions/ava-tool-executor/index.ts`
- `supabase/functions/pp-mobile-profile/index.ts`, `supabase/functions/_shared/maestro-broker-directory.ts`
- `supabase/functions/maestro-actions/index.ts`
- `src/pages/planipret/mobile/MAvaChat.tsx`, `MConnections.tsx`, `MMore.tsx` + miroirs `apps/planipret-mobile/src/...`
- `src/lib/i18n/avaToolLabels.ts` (+ miroir mobile)
- `supabase/functions/tests/maestro-mobile-endpoints.test.ts`

Livrable final : un rapport « problème → cause réelle → correction → fichier/ligne → preuve » pour chacun des 7 points, plus la liste des Edge Functions redéployées.

## Question

La branche auditée `planipret-build/main` est un dépôt externe que je ne peux pas pousser depuis ici. Je peux garantir l'état correct + déployé côté Lovable Cloud ; la synchronisation vers ce dépôt Git externe reste à faire de votre côté.
