# Lemtel — Phase 29B : autorité serveur sur l'audio des enregistrements Mobile

## Risque corrigé
Les Phases 26 à 29A filtrent côté client (liste, historique, Realtime) par extension connectée. Mais l'écran de détail Mobile appelait le proxy d'enregistrement par un chemin audio dupliqué (appel direct, métadonnées PBX fournies par le client, domaine de secours codé en dur), et le proxy gardait des contournements trop larges (admin Lemtel, propriétaire/admin d'organisation) et ne vérifiait l'accès que si un identifiant CDR était fourni.

## Règle finale (contrôle serveur obligatoire)
Pour un utilisateur connecté, `get-recording` et `get-recording-signed-url` exigent `xml_cdr_uuid`. Le serveur résout le CDR dans `pbx_call_records` (par `pbx_uuid`, puis `id` au format UUID), exige une extension non vide, puis une ligne `pbx_softphone_users` avec `portal_user_id = userId`, `organization_id = CDR.organization_id`, `extension = CDR.extension`. Sinon : `403` générique, avant toute lecture PBX, écriture Storage, URL signée ou audit.

## Service-role vs utilisateur
Le service-role interne reste le seul contournement (tâches backend existantes, éventuellement sans identifiant CDR). L'auto-appel service-role de `get-recording-signed-url` n'a lieu qu'après la validation utilisateur.

## Écran de détail
`CallDetailScreen.tsx` utilise désormais `loadPbxRecordingAudioMobile` (helper authentifié existant). Métadonnées issues du CDR chargé uniquement; erreur de permission affichée de façon générique.

## Inchangé
PBX, SIP, politique du portail, migrations, Desktop, autres actions du proxy.

## Phase 29B.1 — métadonnées autoritaires côté serveur
La Phase 29B.1 élimine la confiance résiduelle dans les métadonnées PBX envoyées par l'utilisateur. Le client ne peut fournir que l'identifiant de demande du CDR, jamais le chemin réel de lecture : après autorisation, le serveur remplace (sans fusion) chemin, nom, domaine, date, URL locale, organisation et identifiant par ceux du CDR validé. L'auto-appel service-role de `get-recording-signed-url` reçoit uniquement ces métadonnées serveur pour un utilisateur, et l'audit prend organisation et identifiant de ressource du CDR autorisé. Le service-role interne demeure le seul chemin historique compatible, non exposé au client.
