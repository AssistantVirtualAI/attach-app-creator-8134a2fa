# Phase 43A — Profil clients Hostinger Lemtel

Le profil `hostinger-staging` s’applique aux trois clients Lemtel : Desktop, iOS et Android. Il ne contient aucun secret. La clé publishable est injectée seulement par le système de build sous le nom `VITE_SUPABASE_PUBLISHABLE_KEY`.

Le filtre refuse par défaut toute origine autre que `https://lemtel.avastatistic.ca`, toute origine Planiprêt, un redirect autre que `/reset-password`, un flag non approuvé et toute clé dont l’empreinte ne correspond pas au staging Hostinger. Il n’autorise ni build, ni signature, ni distribution, ni basculement d’un appareil existant.

Le secret de build doit être configuré séparément, hors Git, dans un environnement GitHub dédié Lemtel. Les paramètres SIP/WSS/TURN et push restent exclus jusqu’à la recette FusionPBX et les tests appareil.
