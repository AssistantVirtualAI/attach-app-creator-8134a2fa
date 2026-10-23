# Builds mobiles Planiprêt via Codemagic (artifacts uniquement)

Conforme au cahier Manus « Use CODEMAGIC, not GitHub Actions ». Aucun déploiement store automatique.

## Fichiers proposés (tous nouveaux, aucun fichier existant modifié sauf 2 ajouts de menu)

1. `codemagic.yaml` (racine, nouveau) — 3 workflows :
   - `planipret-ios-artifact` : gates → build Vite → cap sync ios → archive Xcode signé (Distribution / App Store profile existant) → IPA en artifact Codemagic.
   - `planipret-android-artifact` : gates → build Vite → cap sync android → bundle Gradle signé (keystore alias `planipret` existant) → AAB en artifact.
   - `planipret-release-artifacts` (optionnel) : enchaîne les deux sur le même SHA.
   - Aucun workflow d'upload store dans cette phase. Le workflow « Upload mobile build to store processing » (IPA → App Store Connect, AAB → Play Internal Testing uniquement) sera ajouté plus tard, séparément, manuel, sans soumission review ni rollout production.
2. `apps/planipret-mobile/scripts/release-gates.mjs` (nouveau) — enchaîne et bloque au premier échec : `npm ci` (lockfile), TypeScript, tests unitaires, build Vite prod, parité web↔mobile (`audit-parity.mjs`), vérification qu'aucun fichier Lemtel n'est modifié, scan qu'aucun secret n'est tracké dans Git, validation lien PJSIP/CallKit + entitlements iOS, validation signature + targetSdk Android, validation que `google-services.json` a le package `com.planipret.mobile`, comparaison des assets React embarqués iOS/Android, validation des numéros de version/build fournis.
3. `supabase/functions/pp-mobile-build/index.ts` + `pp-mobile-build_test.ts` (nouveaux) — côté serveur du bouton portail :
   - Actions allowlistées seulement : `preview` (retourne SHA, branche/tag, versions iOS/Android, environnement cible), `start` (démarre le workflow Codemagic allowlisté), `status` (état + liens artifacts + logs assainis).
   - Authentification admin Planiprêt requise; le client ne peut fournir ni branche, ni commande, ni URL, ni repo, ni workflow — tout est allowlisté côté serveur.
   - Anti-double-build : refuse si un build est déjà en cours pour le même SHA/version/plateforme; rate limiting.
   - Audit log : admin ID, build ID, SHA, version, workflow, timestamp, résultat — jamais de credentials, tokens, keystores, JSON de compte de service ni valeurs d'environnement.
4. `src/components/planipret/admin/PAMobileBuildCard.tsx` (nouveau) + lien dans le menu admin Planiprêt — bouton **« Préparer une build mobile »** (pas « Publier »), affiche SHA exact, branche/tag, version iOS + build number, versionName + versionCode Android, environnement cible, puis étape de confirmation explicite avant déclenchement.
5. `roadmap.md` / `AGENTS.md` — mise à jour.

## Noms de secrets (jamais de valeurs)

- Lovable Cloud (serveur) : `CODEMAGIC_API_TOKEN` — demandé via formulaire sécurisé uniquement.
- Codemagic (identités de signature chiffrées, jamais dans Git/chat/logs) : certificat Apple Distribution + profil App Store existants, clé API App Store Connect (.p8), keystore Android existant (alias `planipret`) + mots de passe, et plus tard le JSON de compte de service Google Play pour le workflow d'upload.

## Confirmations

- Mode artifacts-only par défaut : oui. Aucun upload App Store Connect / Google Play dans la première phase.
- Aucune soumission store ni rollout production automatique : confirmé, maintenant et dans le workflow d'upload futur (release publique = décision manuelle dans App Store Connect / Google Play Console).
- Non touché : Lemtel, configuration Firebase client, secrets FCM, PJSIP/CallKit/PushKit/SIP, routage PBX/DID/extensions/NetSapiens, migrations, crons, webhooks téléphonie, versions et identités de signature existantes, workflows GitHub Actions protégés.
