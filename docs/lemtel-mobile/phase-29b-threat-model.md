# Phase 29B — Modèle de menace

- **Menace** : un administrateur Mobile ou un client modifié demande l'audio d'un CDR d'une autre extension.
- **Mitigation** : résolution serveur du CDR + égalité stricte utilisateur / organisation / extension dans `pbx_softphone_users` + refus `403` avant tout accès PBX ou Storage. Rôles admin, appartenance à l'organisation et valeurs envoyées par le client ignorés.
- **Données protégées** : audio d'appel, existence de l'enregistrement, métadonnées et chemin de stockage.
- **Limite** : le service-role interne reste réservé aux tâches backend déjà existantes; il n'est jamais exposé au client.

## Phase 29B.1 — confused deputy
- **Menace** : un utilisateur présente l'identifiant de son propre CDR mais fournit le nom ou chemin d'un enregistrement tiers.
- **Mitigation** : après autorisation, le serveur remplace toutes les métadonnées de lecture par celles du CDR validé; les valeurs client (`record_path`, `record_name`, domaine, date, URL locale, organisation) ne sont jamais lues dans le chemin utilisateur, ni transmises à l'auto-appel service-role.
- **Limite** : le service-role interne conserve les paramètres historiques pour les tâches backend existantes; jamais applicable à un JWT utilisateur.
