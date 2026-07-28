Plan proposé :

1. **Restaurer l’accès DB qui fonctionnait avant**
   - Réappliquer proprement les droits `authenticated` sur `planipret_profiles` pour les colonnes sécuritaires seulement.
   - Garder les credentials/tokens/SIP secrets bloqués côté client.
   - Vérification confirmée : actuellement `authenticated` n’a plus de droit direct sur `planipret_profiles`, donc le fallback direct ne peut pas fonctionner.

2. **Remettre le boot profil comme avant le crash**
   - Dans l’app native Planiprêt, remettre un chargement simple et stable : session → profil direct sécurisé → backend seulement en fallback.
   - Retirer la dépendance obligatoire à `CapacitorHttp` / `pp-mobile-profile` au démarrage, parce que les logs backend montrent que `pp-mobile-profile` n’est même pas atteint.
   - Garder `pp-mobile-profile` disponible comme secours, mais il ne doit plus bloquer l’ouverture de l’app.

3. **Corriger la source native du problème session/profile**
   - Ajouter un helper de session robuste pour iOS/Android, mais sans boucle agressive ni refresh qui bloque le rendu.
   - Si session absente : montrer login.
   - Si session présente : charger le profil directement avec colonnes safe.

4. **Empêcher le softphone de partir avant le profil**
   - Le log montre `ns-resolve-sip-credentials` pendant que le profil échoue.
   - Je vais m’assurer que l’initialisation SIP attend un user/profil valide au lieu de compétitionner avec le boot.

5. **Validation**
   - Vérifier les grants/policies après migration.
   - Vérifier que `loadProfile` ne peut plus tomber sur l’écran “Unable to load profile” si le user a un profil.
   - Vérifier que les secrets ne sont toujours pas exposés au frontend.

Résultat attendu : l’application revient au comportement stable d’avant, charge le profil directement, et utilise le backend seulement comme filet de sécurité.