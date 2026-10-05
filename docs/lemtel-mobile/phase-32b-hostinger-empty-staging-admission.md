# Lemtel — phase 32B : admission restreinte du staging Hostinger

**Décision limitée :** le propriétaire a confirmé la création d’un snapshot frais et autorisé un **staging Lemtel vide et isolé** sur Hostinger. Ce staging peut installer la distribution Docker officielle de Supabase, générer des secrets uniquement sur le VPS, créer des volumes persistants vides, exposer l’ingress TLS, et tester Auth/API. Il n’est ni la production Lemtel complète, ni une migration, ni un basculement DigitalOcean.

Le snapshot et l’autorisation ne valent que pour la courte fenêtre définie par la politique. Le script d’admission vérifie cette expiration; après elle, il retourne le code 78 et une nouvelle décision/snapshot est nécessaire.

## Contrat strict

La politique `schemas/lemtel-hostinger-empty-staging/policy.json` admet seulement le scope `hostinger_empty_staging`, avec les actions fermées suivantes :

- installation de Supabase Docker officiel et du reverse proxy;
- génération de secrets locaux à l’hôte, volumes vides, ouvertures ingress 80/443, certificat TLS;
- contrôle Auth/API.

Elle interdit explicitement :

- tout accès ou migration de données Planiprêt;
- changement FusionPBX ou échange d’identifiants PBX;
- cutover des applications Desktop/iOS/Android, onboarding d’utilisateurs ou modification DigitalOcean.

La rétention des journaux applicatifs est limitée à 30 jours et le propriétaire est responsable du monitoring et des secrets. Aucun nom, secret, adresse ou fichier `.env` n’est stocké dans la politique.

## Vérification locale

```sh
node scripts/lemtel-hostinger-empty-staging-admission.mjs --verify
node scripts/lemtel-hostinger-empty-staging-admission.mjs --report
```

Le premier retourne `HOSTINGER_EMPTY_STAGING_ADMITTED` uniquement dans la fenêtre approuvée. Le second expose uniquement le scope, le statut et les raisons, jamais les données d’exploitation. Aucun des deux scripts ne contacte le réseau, ne lance Docker, ne modifie le pare-feu ou n’exécute une commande sur le VPS.

> L’admission autorise une séquence manuelle limitée; elle ne remplace pas les tests ultérieurs de santé métier, les migrations Lemtel séparément approuvées, la recette PBX, les tests clients ou le secours DigitalOcean.
