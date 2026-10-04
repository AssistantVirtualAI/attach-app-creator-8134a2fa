# Phase 29B — Contrat serveur d'accès aux enregistrements

Actions concernées : `get-recording`, `get-recording-signed-url` (fonction `fusionpbx-proxy`).

1. Appel service-role interne : autorisé (seul contournement).
2. Appel utilisateur : `xml_cdr_uuid` obligatoire → CDR résolu côté serveur (`pbx_uuid`, puis `id`) → extension du CDR non vide → ligne `pbx_softphone_users` avec `portal_user_id`, `organization_id` et `extension` identiques.
3. Tout échec : `403` « Recording is outside the signed-in user extension scope », sans donnée CDR/PBX.
4. Rôles administratifs, appartenance à l'organisation, et `organization_id` / `domain_uuid` / `domain_name` / `record_path` / `record_name` / `local_recording_url` / extension envoyés par le client n'accordent jamais l'accès.

La configuration du portail ne peut jamais contourner cette portée extension par extension.
