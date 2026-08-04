# Avis d'enregistrement : seulement sur les appels entrants

Objectif : le courtier n'entend plus « cet appel est enregistré » quand **il** appelle. L'avis reste joué uniquement aux personnes qui appellent le DID d'un courtier.

## Ce qui a été constaté dans le code

Il y a **deux** sources distinctes de l'avis, et les deux se déclenchent aujourd'hui sur les appels sortants.

### Source 1 — lecture locale dans l'application mobile

`PpActiveCallScreen.tsx` joue le fichier audio dès que l'appel passe à l'état `active`, sans regarder la direction :

```text
if (snap.callState !== "active") return;
playRecordingNotice(key);        // aucune vérification entrant/sortant
```

Le champ `direction` (`"in"` / `"out"`) existe déjà dans l'état d'appel mais n'est pas utilisé ici.

### Source 2 — annonce de sonnerie côté central téléphonique

Dans `pp-ns-ring-announcement`, l'action `enable` active `music-on-ring-enabled` **au niveau du domaine**. Le commentaire en tête du fichier dit lui-même que ce réglage s'applique aussi aux jambes sortantes, donc le courtier l'entend pendant que son correspondant sonne. Les actions `restore` et `enable_domain` font la même chose.

L'état réellement appliqué en ce moment sur le central n'a pas été vérifié — c'est la première étape ci-dessous.

## Plan

1. **Constater l'état réel du central** : appeler `pp-ns-ring-announcement` en action `status` et lire `musicOnRingEnabled` au niveau du domaine et par utilisateur. Cela confirme laquelle des deux sources est active (probablement les deux).

2. **Application mobile — n'annoncer que sur les entrants**
   - Dans `PpActiveCallScreen.tsx` (versions `apps/planipret-mobile/` et `src/`), n'appeler `playRecordingNotice` que si `snap.direction === "in"`.
   - Par sécurité, ajouter la même garde dans `recordingNotice.ts` : `playRecordingNotice(key, direction)` sort immédiatement si la direction n'est pas entrante, pour qu'aucun futur point d'appel ne puisse rejouer l'avis sur un sortant.

3. **Central téléphonique — retirer l'annonce au niveau du domaine**
   - Exécuter l'action `scope_users` : elle met `music-on-ring-enabled = no` sur le domaine et `yes` sur chaque utilisateur, ce qui limite l'avis à la sonnerie du courtier appelé.
   - Corriger l'action `enable` pour qu'elle ne remette plus `music-on-ring-enabled: "yes"` sur le domaine (garder seulement `music-on-hold-enabled` pour l'attente), afin que le problème ne revienne pas au prochain déploiement de l'annonce.
   - Marquer `restore` / `enable_domain` comme réglage de dépannage explicite, pas comme configuration normale.

4. **Vérifier** : relire `status` après l'opération (domaine à `no`, utilisateurs à `yes`), puis tester un appel sortant depuis le mobile (aucun avis) et un appel entrant vers le DID d'un courtier (avis présent des deux côtés).

## Détails techniques

- Fichiers modifiés : `apps/planipret-mobile/src/components/planipret/PpActiveCallScreen.tsx`, `src/components/planipret/PpActiveCallScreen.tsx`, les deux `lib/planipret/audio/recordingNotice.ts`, et `supabase/functions/pp-ns-ring-announcement/index.ts`.
- Aucune écriture sur les DID (invariant de routage respecté).
- Le changement mobile nécessite un rebuild iOS/Android ; le changement central est immédiat.
