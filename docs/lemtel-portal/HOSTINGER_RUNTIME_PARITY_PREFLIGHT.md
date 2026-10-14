# Prévol de parité runtime Hostinger

Le prévol collecte seulement des preuves locales redacted. Il exige un artefact immuable reçu et vérifié par digest, une configuration Compose staging complète et valide, PostgreSQL en recovery avec un WAL receiver `streaming`, WireGuard actif, aucune exposition PostgreSQL hôte et aucun conteneur du runtime standby lancé.

Il ne décompresse pas d’artefact, ne modifie pas Storage, ne démarre aucun runtime, ne promeut pas PostgreSQL, ne fence aucun fournisseur et ne modifie ni Cloudflare ni DNS. Une preuve réussie signifie **préparé et dormant**, jamais prêt à router du trafic.
