# Phase 44A — Synchronisation GitHub vers Hostinger et DigitalOcean

Cette phase active uniquement la **synchronisation d’un artefact source Lemtel immuable** pour les changements intégrés à `lemtel/integration`. Lovable n’est pas une source de cette phase : le projet actuel reste Planiprêt.

1. GitHub construit une archive une seule fois et calcule son SHA-256.
2. L’archive est déposée chez Hostinger par une identité SSH sans shell, sans sudo et sans accès au runtime.
3. La santé publique existante de Hostinger est vérifiée sans appliquer l’archive.
4. Le même fichier, vérifié par le même SHA-256, est déposé sur DigitalOcean par une autre identité SSH restreinte.

Les récepteurs n’acceptent qu’une commande `receive <sha256>` et vérifient le contenu reçu. Ils ne peuvent ni exécuter Docker, ni modifier DNS, ni démarrer le standby. Aucune application native n’est construite, signée ou distribuée par ce workflow.
