# AVA — alignement du prompt (voie B de l'audit)

## Objectif
Une seule version d'AVA partout : la conversation réelle, le texte de secours ElevenLabs et l'aperçu admin disent la même chose (salut « Salut {prénom} ! C'est AVA… »), avec les règles de confirmation intactes.

## Étapes
1. **Prompt runtime** : remplacer `buildPrompt()` et le premier message dans `ava-agent-config` par le prompt cible de l'audit (FR + EN équivalent), avec prénom, date/fuseau America/Toronto injectés côté serveur.
2. **Aperçu admin** (`ava-agent-config-preview`) : réutiliser exactement le même constructeur de prompt; ajouter sans secret `agent_status`, les 4 autorisations d'override (prompt, premier message, langue, voix), nombre d'outils attendus/attachés, nom de la voix, version du prompt.
3. **Fallback ElevenLabs** : appliquer le texte de secours aligné de l'audit sur l'agent partagé (prompt + premier message seulement; voix Jessica et outils non touchés). Activer les 4 overrides s'ils sont désactivés.
4. **Inventaire outils (lecture seule)** : comparer par nom/type/URL les outils en ligne (93/96) vs le registre partagé; rapporter les écarts. **Aucune synchronisation d'outils.**
5. **Tests** : nouveau test vérifiant que runtime et aperçu produisent le même prompt/salut et que les règles de confirmation y figurent; garder verts `avaProtectionContract` et tous les `ava*.test.ts` (aucune assertion du contrat modifiée).
6. **Déploiement ciblé** : `ava-agent-config`, `ava-agent-config-preview` uniquement; relire l'aperçu pour 113 et 1142.

## Hors périmètre
Aucun appel/SMS/courriel de test, aucune resync d'outils, aucun changement natif ni publication.
