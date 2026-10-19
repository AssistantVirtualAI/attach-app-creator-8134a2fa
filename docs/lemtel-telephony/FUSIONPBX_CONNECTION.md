# Connexion FusionPBX — saisie dans le portail, test réel, activation, Mobile et Desktop

Statut : **source prête et testée hors ligne**. Rien n'est déployé ; le déploiement suit la procédure de la section 6.

## 1. Comment Ringotel se connecte à FusionPBX, et ce que Lemtel reprend

| Ringotel | Lemtel (ce dépôt) |
|---|---|
| L'admin crée une **organisation** puis une **connexion** : transport UDP, TCP, TLS ou NAPTR, domaine ou IP du PBX, port SIP, proxy sortant, SRTP. | Portail → Téléphonie → **Connexion FusionPBX**, étape 1. Profil unique par organisation, champs stricts et sans secret. |
| L'admin attribue des **utilisateurs** : extension, nom SIP, nom d'autorisation, mot de passe SIP. | Étape 3 : membre ↔ extension, nom d'autorisation optionnel, mot de passe SIP **en écriture seule**, chiffré AES-256-GCM et lié à (organisation, utilisateur, extension). |
| Les apps parlent au **cloud Ringotel** en WebSocket TLS. Le cloud s'enregistre au PBX à la place de l'utilisateur ; le mot de passe SIP n'est jamais sur l'appareil. | Les apps s'enregistrent **directement** au profil `internal` de FusionPBX en **SIP over WSS** (`wss-binding`, port 7443, RFC 7118) avec DTLS-SRTP. Le mot de passe est remis par le serveur Lemtel au seul propriétaire de l'extension, voir la décision D1. |
| Le push est géré par le cloud Ringotel. | Push : `lemtel-mobile-register-push` est encore bloqué (PushKit, CallKit et FCM restent à fournir). |
| Le PBX autorise les IP Ringotel (ACL ou pare-feu). | Les appareils joignent directement `wss://<pbx>:7443` ; TURN sert de relais média derrière NAT. |

Points FreeSWITCH et FusionPBX vérifiés dans la documentation :
- `ws-binding` (5066) et `wss-binding` (7443) se trouvent sur le profil SIP `internal`.
- Le certificat WSS est `wss.pem` (ou `wss.key` + `wss.crt`) dans `tls-cert-dir`. **Il doit être signé par une CA** : un navigateur ou une WebView refuse un certificat auto-signé.
- DTLS-SRTP s'active automatiquement quand l'offre WebRTC contient `a=fingerprint`.
- FreeSWITCH ne génère aucun candidat `relay`. Le TURN est configuré **côté client** : Lemtel délivre des identifiants coturn `use-auth-secret` d'une heure.
- FusionPBX n'a pas d'API REST officielle pour les extensions (l'API communautaire `app/api` couvre surtout les contacts). Le mode « API FusionPBX » est donc optionnel. Les registrations n'en ont pas besoin.

## 2. Ce que Kenny ou Phil doivent fournir, et où le saisir

Tout se saisit dans le portail (Téléphonie → Vue d'ensemble → **Connexion FusionPBX**). **Rien ne passe par courriel.**

| Information | Étape du portail | Secret ? |
|---|---|---|
| FQDN du PBX (ex. `pbxnode.lemtel.tel`) | 1 — Hôte PBX | non |
| Domaine FusionPBX du tenant (ex. `lemtel.lemtel.tel`) | 1 — Domaine SIP | non |
| URL WSS (ex. `wss://pbxnode.lemtel.tel:7443`) **avec certificat CA valide** | 1 — URL WSS (proposée automatiquement) | non |
| Proxy sortant éventuel | 1 | non |
| Serveurs STUN/TURN (`turns:hôte:5349?transport=tcp`) | 1 | non |
| Secret partagé coturn (`static-auth-secret`) | 2 — Secret TURN | **oui** (écriture seule) |
| Clé API FusionPBX (optionnelle) | 2 | **oui** (écriture seule) |
| 2 extensions de test, avec mot de passe et nom d'autorisation si différent | 3 — cocher « Extension de test » | **oui**, pour le mot de passe |
| Fenêtre de test et matrice d'appels | hors portail (plan) | non |

## 3. « Tout s'allume » — séquence exacte

1. **Étape 1** : enregistrer les paramètres. Toute modification ultérieure repasse la connexion en *brouillon* (trigger SQL).
2. **Étape 2** : saisir le secret TURN. Le portail affiche ensuite seulement « Défini le … ».
3. **Étape 3** : attribuer les 2 extensions de test, avec leur mot de passe.
4. **Étape 4, « Tester la connexion »** : le serveur
   - ouvre le WSS avec le sous-protocole `sip` (TLS et certificat compris) ;
   - envoie `OPTIONS` ;
   - pour chaque extension de test, envoie `REGISTER` avec digest MD5, puis désenregistre aussitôt (`Expires: 0`).

   Aucun appel n'est passé. Le rapport détaille chaque contrôle : `wss_tls_websocket`, `sip_options`, `register_<ext>`, `turn_relay`.
5. **Étape 5, « Activer »** : possible seulement si le dernier test a réussi et date de moins de 24 h.
6. **Mobile et Desktop**, à la connexion suivante, appellent `lemtel-softphone-provisioning` et reçoivent **la même configuration** : domaine, WSS, extension, nom d'autorisation, durée de REGISTER, codecs, ICE avec TURN temporaire. Les deux apps partagent un module identique octet pour octet, `src/lib/lemtelSoftphoneProvisioning.ts`, vérifié par `scripts/lemtel-softphone-provisioning-contract.test.mjs`.

Quand une étape manque, les apps affichent le motif exact : `not_assigned`, `not_provisioned`, `pending_activation`, `suspended`, `delivery_disabled` ou `credential_missing`.

## 4. Sécurité

- **Base de données** :
  - tables `lemtel_pbx_*` sous RLS, sans aucun droit pour `anon` ni `authenticated` ;
  - secrets stockés **uniquement chiffrés** : le format `v<n>.<iv>.<ct>` est imposé par un `CHECK`, et du clair est rejeté ;
  - la clé de chiffrement est dans l'environnement des Edge Functions (`LEMTEL_PBX_SECRET_ENCRYPTION_KEY`, 32 octets en base64, plus `LEMTEL_PBX_SECRET_KEY_VERSION`), **jamais** en base.
- **Administration** : réservée aux administrateurs plateforme et aux propriétaires ou admins de l'organisation. Chaque action est journalisée dans `lemtel_pbx_connection_audit`, sans aucune valeur secrète.
- **Distribution aux apps**, soumise à **deux clés** :
  1. connexion de l'organisation `active` ;
  2. interrupteur plateforme `LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY=enabled`.

  En plus, l'utilisateur doit avoir une adhésion active et sa famille de client (mobile ou desktop) ne doit pas être révoquée : c'est la même RPC que `lemtel-session-bootstrap`. Réponse `Cache-Control: no-store`. TTL de 15 min : les apps relisent, ce qui permet la rotation depuis le portail.
- **Un client n'écrit jamais dans FusionPBX** : l'ancien `softphone-sync-password` (`force_local_to_pbx`) a été retiré du mobile.

## 5. Décisions ouvertes (pour Mohamad, Kenny et Phil)

- **D1 — mot de passe SIP sur l'appareil.** Une registration WSS directe à FusionPBX exige le digest, donc le mot de passe, sur l'appareil. Options :
  - (a) l'état actuel : mot de passe remis au seul propriétaire, chiffré au repos côté serveur, rotation possible depuis le portail ;
  - (b) une passerelle SIP Lemtel (Kamailio ou FreeSWITCH en B2BUA) qui s'enregistre à la place de l'appareil, comme le fait Ringotel ;
  - (c) des identifiants SIP par appareil créés dans FusionPBX, ce qui demande l'accès API.

  Recommandation : (a) pour les tests, puis (c) ou (b) pour la production.
- **D2 — TURN** : coturn hébergé par Lemtel ou TURN du fournisseur ? Le portail attend `use-auth-secret`.
- **D3 — iOS** : PJSIP natif (TLS et SRTP) ou JsSIP en WSS comme Android. La configuration reçue est la même ; le transport natif est à valider pendant la fenêtre de test.

## 6. Déploiement (après retour de DO comme writer)

1. Snapshot DO.
2. Appliquer la migration `0024_lemtel_pbx_connection.sql`.
3. Déployer `lemtel-pbx-connection-admin` et `lemtel-softphone-provisioning` (dossier `_shared` inclus).
4. Générer la clé de chiffrement sur le serveur (`openssl rand -base64 32`) et la placer dans l'environnement des fonctions. Elle ne transite ni par Git ni par le chat.
5. Déployer le portail (Connexion FusionPBX visible).
6. Laisser `LEMTEL_SOFTPHONE_CREDENTIAL_DELIVERY` **désactivé** jusqu'au test réel réussi depuis le portail, puis l'activer pour la fenêtre de test.
7. Builds de test : Desktop avec `VITE_SUPABASE_URL=https://lemtel.assistantvirtualai.com` (origine Lemtel) et Mobile (déjà sur l'origine Lemtel).
