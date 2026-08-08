# AVA — recherche unifiée de contacts (répertoire, cellulaire, clients Maestro)

Objectif : quand vous dites à AVA (chat ou voix ElevenLabs) « appelle Jean Tremblay » ou juste « appelle Tremblay », elle cherche dans **toutes** les sources et trouve la bonne personne.

## État actuel (vérifié)

- `ava-tool-executor` cherche seulement dans 3 sources : table `planipret_contacts`, cache `planipret_maestro_clients`, et Microsoft 365. La recherche est un simple `ilike %texte%` : « Tremblay Jean » ne trouve pas « Jean Tremblay », et les accents cassent le match.
- Le **répertoire d'entreprise NetSapiens** (`pp-ns-contacts` : list / shared / directory) n'est **pas** accessible à AVA.
- Les **clients Maestro en direct** (`maestro-actions` → `/users/{id}/clients`) ne sont pas interrogés par AVA ; seul un cache local l'est.
- Les **contacts du cellulaire** sont lus en mémoire dans l'app (`listDeviceContacts`) mais **jamais envoyés au serveur** pour l'app Planiprêt — donc AVA (et surtout le voice bot ElevenLabs, qui tourne côté serveur) ne les voit pas.

## Ce qui sera fait

### 1. Contacts du cellulaire disponibles pour AVA (après autorisation)
- Après l'acceptation de la permission Contacts, l'app téléverse les contacts de l'appareil vers `pp-contacts-upsert` (source `device`), puis re-synchronise en arrière-plan à chaque ouverture (max 1×/24 h) et sur bouton « Synchroniser ».
- Un interrupteur dans Réglages : « Rendre mes contacts du téléphone disponibles à AVA » (activé lors de l'autorisation, désactivable — la désactivation efface les lignes `source=device` du serveur).
- Aucune permission demandée d'avance : rien n'est envoyé tant que la permission n'est pas accordée.

### 2. Un moteur de recherche unique côté serveur
- Nouvelle fonction `pp-contact-search` qui interroge **en parallèle** :
  1. contacts appareil + Microsoft (table `planipret_contacts`),
  2. répertoire entreprise NetSapiens (`pp-ns-contacts` : extensions, contacts partagés, annuaire du domaine),
  3. clients Maestro du courtier (`maestro-actions` → `list_clients`, avec le cache existant),
  4. contacts Outlook (`ms365-actions` search_contact).
- Correspondance intelligente : insensible aux accents et à la casse, par **jetons** (« tremblay jean » = « Jean Tremblay »), prénom seul, nom seul, initiales, entreprise, courriel, et numéro de téléphone.
- Résultats fusionnés, dédoublonnés par téléphone/courriel normalisé, classés par score (correspondance exacte > début de mot > partielle) avec la source affichée.

### 3. AVA branchée dessus (chat + voix)
- `find_contact`, `make_call`, `send_sms`, `send_email`, Teams : tous passent par `pp-contact-search` au lieu du `ilike` actuel.
- Nouveaux outils exposés à l'agent : `search_directory` (recherche générale) et `list_company_directory`.
- Si plusieurs personnes correspondent (« appelle Tremblay » → 3 résultats), AVA demande de choisir en énonçant prénom + entreprise + source, au lieu d'échouer ou d'appeler au hasard.
- Les mêmes outils sont ajoutés à la configuration de l'agent ElevenLabs afin que le voice bot ait exactement les mêmes accès.

## Détails techniques

- Nouveau : `supabase/functions/pp-contact-search/index.ts` + utilitaire de score partagé `supabase/functions/_shared/contactMatch.ts` (réutilise `normalizeText` / logique de jetons déjà présente côté client).
- Modifié : `supabase/functions/ava-tool-executor/index.ts` (`resolveContact`, `find_contact`, ajout des outils), déclarations d'outils ElevenLabs.
- Modifié (les 2 copies) : `src/lib/native/permissions/contacts.ts` + `apps/planipret-mobile/...` pour le téléversement, `MContacts.tsx` (bouton synchro) et la page Réglages (interrupteur).
- Cache serveur 60 s par courtier pour éviter de frapper NetSapiens/Maestro à chaque phrase dictée.
- Tout est cloisonné par `user_id` / `organization_id` : un courtier ne voit jamais les contacts d'un autre.
