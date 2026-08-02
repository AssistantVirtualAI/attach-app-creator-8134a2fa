# Alignement propriété softphone + redéploiement Edge Functions

## 1. Geler la propriété pendant une sonnerie ou un appel (Divergence A)

Dans `src/hooks/useMplanipretSoftphone.ts` et sa copie `apps/planipret-mobile/src/hooks/useMplanipretSoftphone.ts` :

- Ajouter `softphoneCallIsLive()` (lit `ppSipProvider.getSnapshot().callState` + `hasActiveCall()`).
- `releaseSoftphoneOwner(instanceId)` : sortir sans rien libérer si un appel est vivant (log `owner release deferred`).
- Registre typé : `Set<{ id: string; notify: () => void }>` ; l'entrée enregistrée à l'effet de montage porte `id: ownerIdRef.current`.

## 2. Effet dédié de reprise de propriété (Divergence B)

- Retirer `ownerTick` des dépendances de l'effet d'init SIP (ligne ~383) — cet effet contient `acquireSoftphoneOwner` et `releaseSoftphoneOwner` dans son cleanup, donc `ownerTick` y provoque une cascade teardown / re-REGISTER.
- Nouvel effet léger, dépendances `[enabled, user?.id, ownerTick]`, sans cleanup destructif :
  - déjà propriétaire → retour ;
  - propriétaire vivant (présent dans le registre) → retour ;
  - propriétaire orphelin : si appel vivant → attendre ; sinon libérer puis `acquireSoftphoneOwner` et `setOwnerTick(t => t + 1)`.
- `ownerTick` reste dans les dépendances des autres effets gardés (claim, Maestro, CallKit answer, cleanup session).

## 3. Edge Functions à redéployer

Déploiement de : `pp-connections-status`, `pp-connections-keepalive`, `pp-ava-e2e-check`, `maestro-oauth-callback`, plus toutes les fonctions important `_shared/maestro-oauth.ts` (identifiées par recherche avant déploiement).

Remarque : je ne peux pas faire de `git pull` de ton dépôt de build — je déploie les sources présentes ici. Si ton correctif `_shared/maestro-oauth.ts` (lecture `.or(user_id, id)` vs écriture `.eq(user_id)`) n'est pas encore dans ce dépôt, je l'applique ici avant déploiement : lectures et écritures alignées sur la même clé, `UPDATE ... .select()` pour rendre visible un update à zéro ligne.

## 4. Vérification base — courtier Maestro 93135

Requête de lecture seule sur `planipret_profiles` (`user_id`, `id`, `maestro_*`) pour le courtier 93135 afin d'identifier la clé canonique et signaler les lignes divergentes. Aucune écriture de réconciliation sans ton accord.

## 5. Marqueur de build

`apps/planipret-mobile/src/index.tsx` → `pp-build-2026-08-02-ringlock5`.

## Notes prises en compte

- `addDedupedCapListener` garantit déjà une souscription native unique ; les doublons du log sont N callbacks JS, pas des événements natifs dupliqués. Aucune recherche de bug de souscription native.
- Le log fourni ne contient aucun appel entrant : le chemin de décrochage ne sera pas déclaré réparé sans un log capturé pendant un vrai appel entrant.
