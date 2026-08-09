# Correctifs Android — Planiprêt Mobile

Trois problèmes distincts, tous corrigés sans toucher à iOS.

## 1. Robot affiché en haut de l'écran (Android)

Sur Android, l'image de lancement (le robot) reste visible dans une bande au-dessus de l'interface : la WebView ne couvre pas toute la hauteur et l'écran de démarrage natif transparaît. Le robot n'existe nulle part dans le code web — c'est une ressource native générée dans le projet Android.

Correctif :
- Le script de configuration native écrira des ressources Android neutres : écran de lancement en couleur unie (`#0A1425`), sans image de robot, et thème plein écran pour que la WebView occupe tout l'écran sous la barre d'état.
- Côté web, sur Android uniquement : barre d'état non superposée (`overlaysWebView: false`) avec fond bleu nuit, et masquage immédiat de l'écran de lancement au premier rendu.
- Résultat attendu : rendu identique à iOS, application plein écran, plus aucune bande avec le robot.

## 2. Fuseau horaire des réunions Microsoft

Les appels Microsoft Graph ne précisent aucun fuseau, donc les heures reviennent en UTC et s'affichent décalées.

Correctif :
- Ajout de l'en-tête `Prefer: outlook.timezone="America/Toronto"` sur toutes les lectures d'agenda (liste d'événements, vue du jour, briefing).
- Création/modification d'événements forcée sur `America/Toronto` au lieu du fuseau de l'appareil.
- Affichage des heures formaté explicitement sur `America/Toronto` dans l'app mobile et dans le portail courtier (panneau calendrier), pour rester cohérent partout.

## 3. Page Textos qui fige au défilement (Android)

Un garde anti-zoom global annule l'événement `touchend` lorsque deux touchers s'enchaînent en moins de 300 ms. Sur Android, chaque petit balayage de défilement déclenche ce cas et le défilement par inertie se bloque.

Correctif :
- Le garde double-tap ne s'appliquera plus sur Android (le zoom y est déjà bloqué par la balise viewport) et, sur iOS, seulement si les deux touchers sont au même endroit (< ~30 px) et hors zone défilante.
- Vérification de la hauteur des conteneurs de la page Textos (utilisation de `100dvh` + `min-height: 0`) pour que la liste défile correctement dans la WebView Android.

## Détails techniques

- `apps/planipret-mobile/scripts/apply-native-config.mjs` : génération de `res/values/styles.xml`, `res/drawable/splash.xml` (couleur unie) et `res/values/colors.xml`; suppression des drawables d'écran de lancement imagés.
- `apps/planipret-mobile/src/index.tsx` : garde double-tap conditionné à la plateforme et à la distance; réglage `StatusBar` Android; masquage du splash au premier rendu.
- `supabase/functions/ms365-actions/index.ts` : en-tête `Prefer: outlook.timezone` sur `calendarView`/`events`, `timeZone: "America/Toronto"` pour `create_calendar_event` / `update_calendar_event`.
- `apps/planipret-mobile/src/pages/planipret/mobile/MHome.tsx` et le panneau calendrier du portail courtier : formatage des dates sur `America/Toronto`.
- `apps/planipret-mobile/src/pages/planipret/mobile/MMessages.tsx` : ajustements de hauteur/défilement.
- Aucun changement de schéma ni de RLS. Redéploiement de `ms365-actions`.
