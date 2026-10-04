# Phase 29B — Modèle de menace

- **Menace** : un administrateur Mobile ou un client modifié demande l'audio d'un CDR d'une autre extension.
- **Mitigation** : résolution serveur du CDR + égalité stricte utilisateur / organisation / extension dans `pbx_softphone_users` + refus `403` avant tout accès PBX ou Storage. Rôles admin, appartenance à l'organisation et valeurs envoyées par le client ignorés.
- **Données protégées** : audio d'appel, existence de l'enregistrement, métadonnées et chemin de stockage.
- **Limite** : le service-role interne reste réservé aux tâches backend déjà existantes; il n'est jamais exposé au client.
