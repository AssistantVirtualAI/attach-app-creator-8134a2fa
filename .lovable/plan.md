## Problème observé

Depuis Settings → « Se connecter à Maestro » (page `PAMaestroStatus`) :
1. L'utilisateur est redirigé vers `dev.planipret.com` (page de login Maestro)
2. Après avoir saisi ses identifiants + code 2FA, Safari affiche :
   > Safari ne peut ouvrir la page, car l'adresse n'est pas valide.

Cela veut dire que **l'URL finale vers laquelle Maestro tente de rediriger n'est pas une URL HTTPS valide** — le OAuth d'AVA/Planiprêt côté serveur reçoit probablement une réponse OK, mais le redirect final émis par Maestro est cassé (souvent `undefined/...`, un `redirect_uri` vide, ou un schème custom `capacitor://` sur Safari web).

## Diagnostic à confirmer avant fix

Ces points doivent être vérifiés — je ne peux pas les affirmer sans les lire :

1. **URL réelle affichée par Safari** dans la barre au moment de l'erreur (l'utilisateur peut la copier depuis la barre d'adresse avant de cliquer OK). C'est le signal #1.
2. **Secrets edge functions** : valeurs de `MAESTRO_OAUTH_AUTHORIZE_URL`, `MAESTRO_OAUTH_TOKEN_URL`, `MAESTRO_OAUTH_CLIENT_ID` (doit être `2` pour le web), `MAESTRO_OAUTH_CLIENT_SECRET`.
3. **Redirect URI enregistré côté Maestro** pour `client_id=2` : doit être exactement `https://avastatistic.ca/auth/maestro/callback` (à confirmer avec Scott).
4. **Logs de `maestro-oauth-start`** : vérifier que `authorize_url` retournée contient bien `redirect_uri=https%3A%2F%2Favastatistic.ca%2Fauth%2Fmaestro%2Fcallback` et pas une valeur vide/mobile.
5. **Ligne insérée dans `planipret_maestro_oauth_states`** : que `redirect_uri` est bien persisté (utile si Maestro reprend la valeur de leur DB plutôt que du query string).

## Correctifs prévus (une fois la cause confirmée)

### A. Si Maestro renvoie sur un redirect_uri incorrect
- Aligner la valeur enregistrée côté Maestro (Scott) sur `https://avastatistic.ca/auth/maestro/callback` pour `client_id=2`.
- Ajouter un log en début de `maestro-oauth-callback` avec le `redirect_uri` reçu vs celui persisté dans `planipret_maestro_oauth_states` pour détecter les divergences futures.

### B. Si l'URL Safari commence par `capacitor://` ou `undefined`
- Bug dans `PAMaestroStatus` où `platform` serait envoyé à `"mobile"` par erreur. Forcer `platform: "web"` explicitement dans l'invocation `maestro-oauth-start` depuis le portail admin.
- Valider côté `maestro-oauth-start` que si `platform !== "mobile"` alors `redirect_uri` doit commencer par `https://` — sinon renvoyer une erreur claire.

### C. Si `MAESTRO_OAUTH_AUTHORIZE_URL` est mal configurée
- Corriger la valeur du secret (via `secrets--set_secret`) et redéployer `maestro-oauth-start`.

### D. UX : afficher un fallback lisible
- Sur la page `PAMaestroStatus`, avant `window.location.href = url`, vérifier via `URL()` que `url` est absolue et HTTPS ; sinon afficher un message d'erreur explicite plutôt que d'ouvrir Safari sur une URL invalide.
- Enregistrer chaque échec dans `planipret_integration_secrets` avec la raison exacte (`invalid_authorize_url`, `redirect_uri_mismatch`, `pkce_missing`, etc.) pour l'afficher directement dans l'UI.

### E. Callback resilience
- Dans `maestro-oauth-callback`, si `state` n'est pas retrouvé dans `planipret_maestro_oauth_states`, retomber sur le `redirect_uri` envoyé dans le body (comme aujourd'hui) mais logguer explicitement le mismatch.

## Question bloquante avant d'implémenter

Peux-tu me donner **l'URL exacte** que Safari affiche comme « adresse non valide » (barre d'adresse ou message complet) ? C'est le signal qui différencie A/B/C. Sans ça je risque de corriger la mauvaise cause.
