# Appels sortants : délai avant la sonnerie et écran figé sans audio

## Ce qui se passe aujourd'hui

Quand l'app n'a pas de ligne active enregistrée sur le central (cas fréquent après une mise en veille), l'app ne peut pas appeler elle-même. Elle demande alors au central de faire sonner **le cellulaire du courtier** d'abord, puis le client.

Deux conséquences, exactement celles décrites :

1. **Lenteur** : le central doit d'abord joindre le cellulaire par le réseau téléphonique (plusieurs secondes) avant de composer le client. D'où l'attente bien au-delà de 3 secondes.
2. **Écran figé, personne ne s'entend** : l'app affiche quand même sa propre fenêtre d'appel (« Appel entrant — Marc Account »). Or la conversation se trouve sur l'appel cellulaire, pas dans l'app. Les boutons de cette fenêtre ne contrôlent rien : l'écran reste bloqué et aucun son ne passe côté app.

## Ce qui va être corrigé

### 1. Réveiller la ligne avant d'appeler (rapidité)
Avant de composer, l'app tente de rétablir sa ligne (réveil par notification si nécessaire) et attend au maximum ~2 secondes. Si la ligne revient, l'appel part directement depuis l'app : la sonnerie démarre quasi immédiatement et l'audio passe dans l'app.

### 2. Ne plus afficher de fausse fenêtre d'appel
Si l'appel part quand même par le cellulaire, l'app n'ouvre plus sa fenêtre d'appel. Elle affiche seulement un message clair : « Votre cellulaire va sonner — répondez pour parler au client ». Plus d'écran figé.

### 3. Fenêtre d'appel toujours sortable
Dans tous les cas, la fenêtre d'appel garde un bouton Raccrocher/Fermer qui fonctionne, même quand aucune conversation n'est rattachée. Aucun bouton Répondre n'est proposé quand il n'y a rien à répondre.

### 4. Vérification
Mesure du délai entre la composition et la sonnerie dans les journaux du central, puis test d'un vrai appel pour confirmer : sonnerie rapide, audio des deux côtés, écran qui se ferme normalement à la fin.

## Détails techniques

- `apps/planipret-mobile/src/hooks/useMplanipretSoftphone.ts` (+ copie `src/hooks/`) :
  - `placeCall` : tentative de ré-enregistrement natif/JsSIP bornée (~2 s) avant tout repli REST.
  - `callViaPBX` : n'appelle `setRestCall(...)` que si la réponse indique `orig_fallback === "device"`. Pour `orig_fallback === "cell" | "extension"`, retour d'un résultat `{ via: "pbx", ok: true, ringsOnCell: true }` sans rattachement d'appel.
- Écran d'appel mobile (`ActiveCallOverlay.tsx` / `InboundCallOverlay.tsx`) : masquer le bouton Répondre quand aucune session SIP live n'existe, garantir la fermeture via Raccrocher.
- `supabase/functions/pp-ns-calls` (action `start`) : conserve `orig_fallback` déjà exposé ; ajout d'un log du délai POST→202 pour mesurer la latence côté central. Aucune modification du repli ni des champs NS existants.
- Intouchés : PJSIP iOS, TLS 5061, CallKit, propriété de l'AOR mobile, session audio et routage, icônes/splash/Capacitor.
- Vérification : `npx tsc --noEmit`, tests mobiles `npx vitest run` dans `apps/planipret-mobile`, puis appel réel.
