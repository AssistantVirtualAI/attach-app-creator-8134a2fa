## Plan

1. **Stabiliser le layout iOS au clavier**
   - Garder le viewport mobile correct (`width=device-width`, `viewport-fit=cover`, sans largeur fixe).
   - Renforcer les styles globaux pour `input`, `textarea`, `select`, `button` à `font-size: 16px` côté mobile.
   - Désactiver `text-size-adjust` implicite et ajouter un lock CSS quand le clavier est détecté.

2. **Ajouter un verrouillage réel du layout/scroll**
   - Améliorer le `Frame` mobile pour utiliser `visualViewport`.
   - Quand un champ est focus et que le clavier apparaît: figer `--pp-app-height`, bloquer le scroll document, ajouter une classe `pp-keyboard-open`.
   - Appliquer ce comportement aux écrans keypad, directory, teams/messages et chatbot via le shell mobile global.

3. **Réparer Directory: noms/prénoms des courtiers**
   - Corriger la normalisation de l’annuaire pour lire les champs backend `directory_first_name`, `directory_last_name`, `directory_visible`, `directory_exten_visible` en plus des variantes actuelles.
   - Faire afficher prénom + nom en priorité dans `MContacts` et dans le keypad search, puis seulement l’extension en fallback.

4. **Connecter Search à Directory**
   - Corriger `pp-search` pour inclure les résultats de l’annuaire interne, pas seulement Maestro.
   - Corriger `MSearch` pour appeler proprement la fonction backend, afficher une erreur/état vide propre, et rendre les contacts directory avec prénom, nom, extension, email/poste.
   - Depuis un résultat directory, permettre de lancer l’appel via l’extension.

5. **Validation**
   - Vérifier les fichiers modifiés et lancer une validation légère ciblée (typecheck/test disponible si pertinent) sans toucher aux autres apps.