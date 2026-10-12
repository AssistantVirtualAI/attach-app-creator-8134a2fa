# Lemtel — statut de standby vérifié (12 octobre 2026)

> **État : DigitalOcean reste l’unique writer et le runtime public.** Hostinger est un standby PostgreSQL privé ; aucun failover automatique n’est actif.

## Preuves récentes, sans exposition de données sensibles

- **Route canonique DO :** les endpoints protégés Auth et REST répondent `401`, comportement attendu qui atteste le routage HTTPS sans révéler de données.
- **PostgreSQL Hostinger :** le contrôle lecture seule déjà exécuté confirme le mode recovery et un WAL receiver `streaming`. Aucun listener PostgreSQL public n’est déclaré.
- **Artefacts :** le workflow GitHub d’artefact immuable a réussi pour le commit courant : archive vérifiée et déposée sur Hostinger ; aucune application du runtime. Le job visant l’ancien receiver DO est volontairement ignoré, car DO est writer.
- **Storage DO → Hostinger :** le dernier lancement direct a terminé avec checksum et attestation d’intégrité, sans propagation de suppressions, démarrage du runtime standby ni exposition publique. Une erreur systemd antérieure liée au chemin Storage est conservée comme incident historique ; l’état courant du minuteur périodique doit encore être attesté par une lecture système réussie avant de promettre une cadence continue.
- **Cloudflare :** aucun Load Balancer, pool ou monitor n’existe. L’écran propose encore l’activation du produit ; aucune activation ni coût n’a été engagé.

## Ce que ce statut ne permet pas d’affirmer

- La réplication PostgreSQL **synchrone** côté DO n’est pas vérifiée ; une lecture root limitée du writer reste nécessaire.
- Storage n’a pas encore la politique cible de double écriture durable avant accusé de réception.
- Il n’existe ni arbitre indépendant, ni fencing fournisseur automatique, ni promotion automatique, ni routage Cloudflare automatique.
- Un appel VoIP en cours ne pourrait pas être garanti pendant une panne ; la téléphonie reste hors périmètre.

## Portée du prochain jalon

La préparation automatique reste bloquée tant que les prérequis ci-dessus ne sont pas prouvés et qu’une confirmation finale n’autorise pas explicitement l’activation Cloudflare potentiellement payante, le fencing et la bascule publique.
