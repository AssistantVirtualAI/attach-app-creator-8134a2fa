# Bandeau d'appel + transcription lisible (portail et mobile)

## 1. Bandeau d'appel qui cache la zone SMS
Pendant un appel, le bandeau vert (« Toucher pour revenir ») est fixé au-dessus de la barre du bas et recouvre la zone de saisie des textos.
- Dans l'écran Messages (conversation ouverte) : le bandeau passe en haut de l'écran, sous la barre d'état, en version compacte.
- Quand le clavier est ouvert : le bandeau se cache automatiquement (ou se réduit) et la zone de saisie reste visible.
- Ailleurs : comportement actuel inchangé.
Aucun changement aux appels eux-mêmes (audio, CallKit, raccrochage).

## 2. Transcription : noms au lieu de `sip:...`
Chaque intervention affichera, dans cet ordre :
1. **Courtier** (poste `1284`, `1284M`, `1284x`) → nom du courtier propriétaire de l'appel.
2. **Client existant** (numéro dans sa liste de contacts/CRM) → nom du client.
3. **Appel interne** (autre poste Planiprêt) → nom du collègue.
4. Sinon → numéro formaté, ex. `+1 (514) 707-1203`.
Le domaine `@sbc1.ucstack.io` / `@planipret.ca` n'est plus jamais affiché.

## 3. Caractères d'échappement
`\'` → `'`, `\"` → `"`, `\n` littéral → saut de ligne, nettoyés à l'affichage seulement (la transcription en base n'est pas modifiée).

## Où
- Portail courtier : fiche d'appel de la page Appels (aujourd'hui texte brut) → utilise le même affichage en bulles que le mobile.
- App mobile : fiche d'enregistrement / transcription.
- Les deux versions (portail et app) gardent un code identique, comme prévu par les règles du projet.

## Détails techniques
- Nouveau module partagé `transcriptSpeakers.ts` (copié à l'identique dans `src/` et `apps/planipret-mobile/src/`) : `parseSipSpeaker`, `unescapeTranscript`, `resolveSpeakerName(speaker, ctx)` avec `ctx = { brokerExt, brokerName, contactsByPhone, internalByExt }`.
- `TranscriptConversation` reçoit un `resolveName` optionnel; l'identité vient toujours de l'étiquette source (pas de déduction des tours de parole) — conforme à la règle existante.
- Noms internes : lecture des profils Planiprêt déjà accessibles (extension → nom); contacts : liste du courtier déjà chargée dans l'app (aucun nouvel accès serveur, aucune nouvelle permission).
- `PBCalls.tsx` : remplace le `<p>` brut par `TranscriptConversation`.
- `PpCallPill.tsx` (x2) : position haute + masquage via `visualViewport` quand le clavier est ouvert ou sur la route conversation SMS.
- Tests vitest : SIP courtier → nom courtier; numéro en contacts → nom client; poste interne → nom collègue; inconnu → numéro formaté; `c\'est` → `c'est`.
- Aucun déploiement serveur, aucune modification native, téléphonie, SMS serveur ou Lemtel.
