## Mon avis sur l'analyse de Manus

Point factuel d'abord: j'ai cherché `SpeakAccount`, `speak_account`, `speak-account` dans **tout le dépôt** (frontend, `apps/planipret-mobile`, `apps/ava-softphone-*`, toutes les edge functions, toutes les migrations). **Zéro occurrence.** Aucune de nos fonctions d'appels sortants (`pp-ns-calls`, `ava-tool-executor`) n'écrit ni ne lit ce champ. `call_term_to_uri: SpeakAccount` est donc une valeur renvoyée par NetSapiens, pas quelque chose que j'ai hardcodé.

Là où je ne suis pas d'accord avec la conclusion « 100% côté AVA Telecom »: notre `pp-sync-answering-rules` écrit dans NS une règle qui peut produire exactement ce CDR (200 OK en 37 ms, aucun 3e participant). Deux éléments suspects, tous les deux dans notre code:

1. **Sim-ring qui boucle sur l'utilisateur lui-même.** Le payload envoie `destinations: [sip:113@planipret.ca]` et `list: [sip:113@planipret.ca]` — c'est-à-dire l'extension appelée renvoyée vers elle-même. Sur les builds NS qui n'honorent pas `ring-all-user-phones`, ce fork ne peut pas être routé et NS termine immédiatement dans une application (VMail / SpeakAccount) sans jamais forker vers `113_web` / `113_mobile`.
2. **Le PUT sur `/users/{ext}`** envoie une dizaine de clés (`call-forward-always: ""`, etc.). Si NS rejette la requête partiellement, on ne le voit pas: le statut est stocké mais pas interprété.

Avant de contacter AVA Telecom, il faut donc lire le vrai enregistrement NS. Ce diagnostic n'a pas encore été fait: notre `pp-inbound-diagnostic` interprète les champs mais ne renvoie pas le JSON brut de l'utilisateur, du DID et de la règle active.

## Plan

### 1. Mode « raw » dans `pp-inbound-diagnostic` (lecture seule)
- Ajouter `?raw=1` qui renvoie le JSON NS **non filtré** de:
  - `GET /domains/planipret.ca/users/113` (tous les champs — on cherche `speak_account*`, `voicemail_rings`, `call_limit`, `dial_rule*`, `application`)
  - la règle active `answerrules` telle que NS l'a réellement enregistrée après notre dernier sync (et non le payload qu'on a envoyé)
  - le DID `4388427217` avec son champ `dial-rule-application` / `dial-rule-translation-destination`
  - les `registrations` par device
- Ajouter un verdict `TERMINATED_BY_APPLICATION` quand un CDR récent a `call-term-to-uri` non-SIP (SpeakAccount, VMail, AA…) avec 0 s de sonnerie, et afficher le nom de l'application dans l'UI.

### 2. Corriger le payload de sim-ring
- Retirer l'auto-référence `sip:113@planipret.ca` des `destinations` / `list`.
- Ne conserver que `ring-all-user-phones: yes` + `include-user-extension: yes`, et si NS ne renvoie pas ces clés dans sa réponse, retomber sur les **AOR de devices réels lus depuis `/users/{ext}/devices`** (`113_mobile`, `113_web`) au lieu de valeurs devinées.
- Vérifier le résultat en relisant la règle après écriture (read-after-write) et remonter un échec explicite si NS a ignoré les clés.

### 3. Vérifier le DID côté application
- Si `dial-rule-application` du DID `(438) 842-7217` n'est pas `to-user` / `sip`, c'est la preuve que l'interception est au niveau du DID → là seulement l'escalade AVA Telecom est justifiée, avec le JSON brut comme pièce jointe.

### 4. Exécution et validation
- Déployer les deux fonctions, lancer le diagnostic `raw` sur l'extension 113, relancer le sync de règle sur 113 uniquement, puis un appel test et relecture du CDR (`call-term-to-uri` doit devenir un AOR SIP de device, `call-answer-datetime` > `call-start-datetime`).

## Détails techniques

- Fichiers touchés: `supabase/functions/pp-inbound-diagnostic/index.ts`, `supabase/functions/pp-sync-answering-rules/index.ts`, plus l'écran admin de diagnostic pour afficher le JSON brut.
- Aucun changement dans l'app mobile: je suis d'accord avec Manus que les correctifs JS/iOS (`contact_uri` retiré, `forceReregister()` sans `unregister({all:true})`, background modes) sont bons et à conserver.
- Sur les identifiants NS-API collés dans le message: ils sont déjà utilisés côté serveur via `nsFetch` (secrets backend). Le mot de passe admin ayant été écrit en clair dans le chat, il faut le changer dans NetSapiens puis mettre à jour le secret — je peux ouvrir le formulaire sécurisé pour ça.
