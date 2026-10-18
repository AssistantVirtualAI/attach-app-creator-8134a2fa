# Lemtel — observation locale de protection au repos du credential mTLS

> **Statut : lecture seule, non autorisant.** Ce collecteur vérifie seulement des métadonnées locales redacted sur le writer DigitalOcean. Il ne lit jamais le credential chiffré, le certificat PEM ou une clé privée. Il ne réémet ni ne journalise une empreinte. Il ne modifie aucun fichier, service, timer, route, runtime, Cloudflare, fournisseur, base ou failover.

## But limité

`lemtel-ha-do-writer-managed-mtls-storage-observation.sh` observe l’emplacement prévu du credential de CA locale durable et la clé hôte utilisée par `systemd-creds`. Il vérifie uniquement les types de fichiers, liens, propriétaires, modes et parents attendus. Il refuse si le répertoire `managed-ca` contient autre chose que le credential attendu.

Avant tout parsing Bash, l’attestation publique est vérifiée au niveau **des octets bruts** : longueur strictement positive, au plus 4096 octets, hexadécimal de taille cohérente et absence de NUL. Cela évite qu’une locale UTF‑8 ou la suppression de NUL par Bash contourne la borne. Après cette prévalidation seulement, l’empreinte publique est validée syntaxiquement dans la mémoire du processus; elle n’est ni affichée, ni loggée, ni rapprochée du PEM. La syntaxe ne prouve donc ni la vérité de l’attestation ni le binding de la clé à l’hôte. Le champ correspondant reste `declared_unverified`.

Le collecteur demande à `findmnt` le montage contenant **le fichier credential précis**, jamais une approximation telle que `/etc`. Il peut observer uniquement une couche `dm-crypt` immédiatement visible sous ce montage. Une topologie LVM, overlay, réseau, source opaque ou incomplète reste `indeterminate`. L’absence de couche visible vaut `false` pour cette observation locale. Le script ne déduit jamais l’état de chiffrement côté fournisseur, les snapshots, les sauvegardes, les volumes précédemment attachés, l’état hors ligne ou une résistance à un administrateur root après démarrage.

Le binding `systemd-creds --with-key=host` ne constitue pas une preuve de chiffrement au repos. Une clé liée à l’hôte peut être stockée sur le même système de fichiers que le credential. La présence d’un TPM ou d’une couche LUKS ne prouve pas non plus que ce credential est scellé avec une politique TPM correcte ou que le stockage fournisseur est protégé. Le collecteur garde donc inconditionnellement :

- `host_key_storage_protection=not_verified`;
- `provider_storage_encryption=not_assessable_from_guest`;
- `ha_gate_satisfied=false`;
- `activation_authorized=false` et `relay_authorized=false`.

Même dans son meilleur cas, l’état est `local_evidence_positive_observation_only` et le statut terminal `observed_without_gate`. Le script retourne toujours le code `78`. Les états `local_evidence_observed_negative`, `local_evidence_indeterminate` et `local_evidence_incomplete` ont leurs statuts terminaux distincts. Aucun état n’est `complete`; cela empêche un parseur de confondre la collecte avec une autorisation.

La gate canonique reste `root_only_credential_backend_with_encrypted_at_rest_attestation`. Ce collecteur est explicitement incapable de la satisfaire. Une preuve indépendante, approuvée et applicable au writer demeure requise avant tout import de CA locale, leaf, policy Access, relais ou enrôlement. Cette preuve ne peut jamais être produite par le collecteur.

## Invocation contrôlée

Le script exige root, le rôle exact `digitalocean_writer`, aucun argument et le token d’exécution exact `observe_do_managed_mtls_credential_at_rest_root_only`. Il ne doit être exécuté qu’après livraison immuable vérifiée de la version source examinée. Sa sortie est un jeu déterministe de booléens ou d’états `indeterminate`, sans chemin, nom de disque, UUID, empreinte, hostname, clé ou contenu de credential.

Un résultat `local_evidence_observed_negative`, `local_evidence_indeterminate` ou `local_evidence_incomplete` est un refus de gate, non une erreur à contourner. La seule voie vers une éventuelle attestation positive reste une preuve indépendante et approuvée de protection au repos applicable au writer, suivie des drills mTLS requis; elle ne peut jamais être produite par ce collecteur.
