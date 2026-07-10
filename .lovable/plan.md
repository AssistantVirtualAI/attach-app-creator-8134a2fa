## Objectif

Rendre les deux toggles admin réellement fonctionnels côté courtier :

1. **Application mobile** : décocher = blocage immédiat de l'accès à l'app mobile ; cocher = accès restauré.
2. **Agent vocal IA** : cocher = le bouton central AVA lance l'**agent vocal WebRTC** ; décocher = le bouton central lance le **chatbot texte**.

## Constats

- Le gate mobile existe déjà (`PlanipretMobile.tsx` ligne 593 : `profile.mobile_app_enabled === false → écran verrouillé`). Deux failles :
  - `mobile_app_enabled` peut être `null` par défaut pour les anciens comptes → le `=== false` strict laisse passer.
  - Après un toggle admin, le profil courtier reste en cache tant que l'utilisateur ne recharge pas. Il faut un rafraîchissement temps réel (Supabase Realtime sur `planipret_profiles`) pour couper l'accès sans attendre un reload.
- Le bouton central AVA ouvre **toujours** `AvaChatSheet`, quel que soit `voice_agent_enabled`. Seule la couleur du FAB change. `AvaVoiceAgent` est importé mais jamais rendu depuis le FAB. Il faut brancher la logique conditionnelle.
- Côté admin (`PAUsers.tsx` `toggleField`) le PATCH via `pp-admin-user` fonctionne, mais l'UI ne surface pas l'erreur si `data.error` est non-string, et il n'y a pas de vérification que la valeur persistée en DB correspond bien au toggle affiché.

## Changements

### 1. Gate mobile robuste + réactif (`src/pages/planipret/PlanipretMobile.tsx`)

- Remplacer le check `profile.mobile_app_enabled === false` par `profile.mobile_app_enabled !== true` pour bloquer aussi les profils avec valeur `null`.
- Ajouter un abonnement Supabase Realtime sur `planipret_profiles` filtré par `user_id = current user`. À chaque `UPDATE`, rappeler `loadProfile()` pour que la révocation ou l'activation par l'admin prenne effet en < 2 s sans reload.
- Si `mobile_app_enabled` bascule à `false` pendant que l'utilisateur est dans l'app, l'écran verrouillé prend le relais automatiquement (déjà géré une fois `profile` mis à jour).

### 2. Bouton central AVA branché sur `voice_agent_enabled` (`src/pages/planipret/PlanipretMobile.tsx`)

- Ajouter un state `avaMode: "chat" | "voice"` initialisé par `profile.voice_agent_enabled`.
- `openAva()` détermine dynamiquement le mode d'ouverture :
  - `voice_agent_enabled === true` → monter `<AvaVoiceAgent userId=... onClose=... />`.
  - sinon → monter `<AvaChatSheet userId=... onClose=... />`.
- Un seul overlay actif à la fois ; la fermeture (`onClose`) remet `avaOpen=false`.
- Le style/animation du FAB reste synchronisé (déjà en place).

### 3. Migration DB : défaut explicite pour `mobile_app_enabled`

- `ALTER TABLE planipret_profiles ALTER COLUMN mobile_app_enabled SET DEFAULT false;`
- Backfill : `UPDATE planipret_profiles SET mobile_app_enabled = false WHERE mobile_app_enabled IS NULL;`
- Même chose pour `voice_agent_enabled` (`DEFAULT false`, backfill des `NULL`).
- Ainsi tout nouveau courtier est bloqué tant que l'admin ne coche pas explicitement.

### 4. Toggle admin — feedback + persistance vérifiée (`src/pages/planipret/admin/PAUsers.tsx`)

- Dans `toggleField`, après l'appel edge `pp-admin-user action=update`, relire la ligne (`select mobile_app_enabled, voice_agent_enabled`) et resynchroniser `rows` avec la valeur réelle en DB (évite un état optimiste divergent en cas d'échec silencieux).
- Améliorer les messages : `toast.error` prend maintenant `data.error ?? error?.message ?? "Erreur"`.
- Rien à changer dans l'edge function `pp-admin-user` (déjà en place, écrit correctement les deux colonnes).

## Validation (build mode)

1. Se connecter comme admin sur `/planipret/admin/users`, décocher **Mobile app** pour un courtier → vérifier via Playwright que l'app mobile de ce courtier affiche `access.notActivated` dans les 2 secondes.
2. Recocher → l'écran de blocage disparaît sans reload manuel.
3. Cocher **Agent vocal IA** → sur l'app mobile du courtier, taper sur le bouton central AVA → l'overlay `AvaVoiceAgent` (WebRTC) s'ouvre au lieu du chat texte.
4. Décocher → même bouton ouvre à nouveau `AvaChatSheet`.
5. Console : plus de 400 « user\_id requis » puisqu'on garde les guards ajoutés au tour précédent.
