Plan de correction Microsoft SSO

1. Rendre le retour mobile fiable
- Sauvegarder `state`, `code_verifier`, `redirect_uri`, `intent=login` et `next` aussi dans le stockage natif Capacitor, pas seulement `localStorage/sessionStorage`.
- Lire ces valeurs depuis le stockage natif dans `Ms365Callback` avant de déclarer une erreur.
- Si `intent` est perdu mais que `state` commence par `login:`, traiter quand même le callback comme une connexion SSO.

2. Rediriger vers le bon Home après connexion
- Pour le login Microsoft Planiprêt mobile, forcer le retour final vers `/mplanipret/home`.
- Pour le login Microsoft depuis la page principale, détecter un utilisateur Planiprêt broker/member et envoyer vers `/mplanipret/home` au lieu de rester sur `/post-login` ou `/planipret/admin`.
- Garder les admins Planiprêt vers `/planipret/admin/overview`.

3. Corriger l’écran d’erreur actuel
- Remplacer le bouton “Retour” qui renvoie vers `/mplanipret/more` par un retour clair vers `/mplanipret/home` ou relancer Microsoft selon le cas.
- Afficher le vrai message backend si l’échange Microsoft échoue, pas juste “connexion interrompue”.

4. Sécuriser le deep link
- Garder `capacitor://localhost/auth/microsoft/callback` comme callback natif.
- S’assurer que `NativeDeepLinkBridge` ferme le navigateur et route toujours vers `/auth/microsoft/callback?...` dès que l’URL Microsoft arrive.
- Ajouter un fallback : si l’app revient active avec une URL callback stockée, traiter cette URL même si l’évènement `appUrlOpen` n’a pas déclenché.

5. Vérification finale
- Tester le flow web `/login` → Microsoft → retour Home.
- Tester le flow mobile `/mplanipret` → Microsoft → retour `/mplanipret/home`.
- Vérifier que la connexion Microsoft stocke bien les tokens et que la session utilisateur est active après retour.