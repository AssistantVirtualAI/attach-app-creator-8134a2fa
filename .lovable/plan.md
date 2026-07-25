Plan pour corriger Lemtel mobile Android + iOS:

1. **Rétablir l’écran d’appel entrant**
   - Corriger l’état `ringing` pour distinguer clairement `ringing-in` vs `ringing-out`.
   - Faire afficher `ActiveCallSheet` avec les boutons **Répondre** et **Refuser** dès qu’un appel entrant arrive.

2. **Android: faire sonner en background**
   - Brancher le service natif Verto background sur les événements `verto.invite`.
   - Afficher une notification plein écran d’appel entrant avec numéro appelant.
   - Ajouter les actions natives **Répondre / Refuser** qui réveillent l’app et déclenchent la bonne action.
   - S’assurer que le service conserve le statut registered et relance la connexion si le socket tombe.

3. **iOS: CallKit + retour app**
   - Vérifier/corriger le mapping `on_incoming_call` pour déclencher CallKit avec le bon numéro.
   - Relayer l’action **Answer** de CallKit vers le JS/native call handler.
   - Éviter que l’appel entrant reste sans bouton quand l’app revient au premier plan.

4. **Corriger l’affichage du numéro iOS**
   - Normaliser les chaînes SIP comme `"+1514..." <sip:+1514...@domain>` pour ne plus afficher le SIP URI brut.
   - Afficher un numéro propre ou “Poste XXX” pour les appels internes.
   - Forcer le texte à rester dans l’écran avec wrapping/troncature professionnelle.

5. **Validation**
   - Vérifier les fichiers Android/iOS concernés et le flux React.
   - Tester au moins la logique de formatage et confirmer que l’UI expose les boutons d’appel entrant.

Après approbation, j’implémente directement.