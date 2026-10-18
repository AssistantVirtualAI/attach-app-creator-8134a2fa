# Économiser les jetons Claude (portail + app mobile) sans perte de qualité

## Constat (vérifié)
- 45 fonctions serveur appellent Claude, presque toutes via le module partagé (cache de prompt déjà actif sur instructions/outils).
- Modèle par défaut partout : Sonnet 4.5 (22 appels explicites). Haiku n'est utilisé qu'à 1-2 endroits.
- Aucune mesure réelle disponible : les journaux récents ne contiennent pas les lignes de consommation `[claude:…]`. On ne sait donc pas encore quelles fonctions coûtent le plus.

## Étapes
1. **Mesurer d'abord (sans rien changer au comportement)** : enregistrer pour chaque appel Claude la fonction, le modèle, jetons entrée/sortie, cache lu/écrit, dans une table interne (service seulement, aucun contenu client). 3-7 jours d'observation, puis classement des 5 plus gros consommateurs.
2. **Gains sans risque qualité, appliqués partout** :
   - Ne jamais rappeler Claude pour une même entrée : cache serveur par empreinte (résumés d'appel, analyses de transcription, amélioration de texte, insights) — même principe que les commissions.
   - Couper le texte envoyé : transcriptions/historiques tronqués aux parties utiles, pas de JSON brut inutile dans le message.
   - `max_tokens` ajusté par fonction à la longueur réelle des réponses observées (étape 1).
   - Vérifier que le cache de prompt touche vraiment (instructions statiques avant le contenu variable, aucun horodatage dans les instructions).
3. **Modèle plus léger seulement là où c'est prouvé équivalent** : pour les tâches simples (classification, titre, correction de texte, résumé court), comparer Sonnet vs Haiku sur 20 exemples réels avec des critères fixés avec toi. On ne bascule que les fonctions où le résultat est jugé équivalent. AVA chat/voix, coach d'appel et analyses de commissions restent sur Sonnet sauf accord.
4. **Vérification** : comparer jetons par tâche réussie avant/après sur la même période, et revue qualité par toi avant toute bascule de modèle.

## Ce qui ne change pas
- Aucune modification iOS/Android natif, téléphonie, Lemtel, crons téléphoniques, secrets.
- Claude reste le fournisseur principal; fallback OpenAI inchangé.
- Rien n'est déployé sans ta demande explicite, fonction par fonction.

## Détails techniques
- Journalisation ajoutée dans `_shared/anthropic.ts` (`callAnthropic`) et `_shared/claude-compat.ts` → table `ai_token_usage` (label, model, in, out, cache_read, cache_write, created_at), RLS service_role uniquement.
- Cache de résultats : table `ai_result_cache` (label, input_hash, output, created_at) consultée avant l'appel pour les fonctions déterministes (ai-summary, ai-text-improve, analyze-conversation, ai-call-analysis, maestro-transcript, pp-overview-insights, mobile-home-stats).
- Candidats Haiku à tester : ai-text-improve, pp-greeting-improve, pp-moh-improve, analyze-topics, ai-summary (court).
- Tests : cache hit = 0 appel Claude; troncature conserve la fin de transcription; aucune donnée client dans la table d'usage.
