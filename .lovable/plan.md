## Objectif

Auditer l'application mobile Planiprêt écran par écran et fonction par fonction, corriger ce qui casse, et livrer un rapport complet en français.

## Périmètre (15 écrans)

Home, Calls, Messages (SMS + Emails), Voicemail, Contacts, Pipeline, Search, Stats, AVA Chat, AVA Notifications, More/Settings, Extension Sync, SIP Debug, MS365 Diagnostics, Deep Link Debug — plus le shell (auth, header, bottom nav, dialpad FAB, safe-areas).

## Méthode

1. **Audit statique** — comparer `src/pages/planipret/mobile/**` et `apps/planipret-mobile/src/pages/planipret/mobile/**` (les deux arbres ont divergé : `MDiagnostics`, `MKpiAudit`, `MLayoutQA`, `MStyleDiagnostics` n'existent que côté app). Repérer imports manquants, `any` risqués, appels edge functions non gérés en erreur.
2. **Test E2E automatisé** — script Playwright en viewport iPhone (390×844) qui, pour chaque route : charge la page, attend le rendu, capture les erreurs console/réseau, prend une capture d'écran, et teste les interactions principales (onglets, recherche, ouverture d'un détail, boutons d'action).
3. **Vérification backend** — pour chaque écran, vérifier que les edge functions et tables qu'il consomme répondent (pp-mobile-profile, pp-ns-calls, pp-ns-sms, ms365-actions, ava-tool-executor, maestro-*), et relever les 4xx/5xx.
4. **Contrôles transverses** — safe-areas iOS/Android, absence de zoom-out, header unique, bilinguisme FR/EN, états de chargement/erreur, comportement hors-ligne.
5. **Corrections** — corriger au fil de l'eau les bugs bloquants trouvés, en synchronisant les deux arbres de code.
6. **Re-test** — relancer le script complet après corrections.

## Livrable

Un rapport par écran avec : statut (OK / dégradé / cassé), fonctions testées, erreurs console/réseau observées, capture d'écran, et correctif appliqué ou recommandation. Suivi d'une synthèse : bloquants, risques, et points nécessitant un test sur appareil réel (SIP, CallKit, push, OAuth natif — non testables en navigateur).

## Détails techniques

- Scripts sous `/tmp/browser/pp-audit/` ; captures dans le même dossier.
- Session authentifiée restaurée via les variables Supabase du sandbox avant navigation.
- Les fonctions natives (registre SIP, appels, notifications push, deep links OAuth) seront validées par revue de code et logs, pas par navigateur — je les signalerai comme « à valider sur appareil ».
