# Lemtel — préparation d’activation téléphonie

> **État : préparation hors ligne seulement.** Aucune connexion PBX, configuration SIP/WSS/TURN, notification push, changement DNS, écriture fournisseur, démarrage Hostinger ou bascule automatique n’est effectué par ce package.

## Ce qui est déjà prêt côté applications et portail

- **Compte unique e-mail/mot de passe** : Mobile et Desktop authentifient la même identité serveur; le mot de passe n’est jamais copié entre appareils.
- **Autorité serveur** : le serveur décide organisation, rôle, accès et révision de compte; un client ne choisit jamais son organisation ou son extension.
- **Isolation** : accès aux messages, CDR, boîtes vocales et enregistrements limité à l’organisation, à l’identité et au poste autorisés. La lecture audio doit rester un proxy serveur authentifié.
- **Portail** : les sections Communications affichent l’état `Non provisionné` et n’exposent aucun contrôle téléphonique prématuré.
- **Prévol** : `lemtel-telephony-readiness-preflight.sh` atteste uniquement la présence de catégories de configuration, jamais leurs valeurs.

## Informations attendues de Phil et Kenny

Fournir ces éléments **uniquement par un canal secret contrôlé**, jamais dans Git, le portail, un message, une URL, un artefact ou un journal :

1. Identité du fournisseur, périmètre de tenant et interlocuteur de changement/rollback.
2. Profil de transport validé : TLS/SRTP/WSS, restrictions réseau et exigences de certificats.
3. Contrat de création/lien d’un poste à un utilisateur Lemtel et règle de rotation des accès.
4. Contrat de courtier serveur des identifiants : les clients reçoivent au plus un jeton éphémère autorisé; aucun secret SIP/TURN durable ne quitte le writer.
5. Politique d’appels entrants/sortants, numéros et urgences applicable au tenant de test.
6. Politique boîte vocale : activation, annonces, rétention, téléchargement, suppression et notifications.
7. Politique enregistrements : consentement, rétention, lecture autorisée, export, audit et négatif cross-user/cross-org.
8. Preuve de configuration iOS PushKit/CallKit et Android FCM, sans remettre les secrets applicatifs dans le dépôt.
9. Deux postes de test non critiques et une fenêtre de recette avec critères de rollback.

## Ordre d’activation ultérieur — transactionnel

1. Confirmer une sauvegarde fraîche du writer DigitalOcean et que Hostinger reste passif/fencé.
2. Exécuter le prévol lecture seule et vérifier toutes les présences attendues sans afficher de valeur.
3. Faire entrer les secrets dans l’environnement privé du writer via le canal contrôlé du propriétaire.
4. Déployer le broker serveur et les politiques d’autorisation; vérifier qu’aucun bundle Portal/Mobile/Desktop ne contient de secret.
5. Tester successivement Desktop, iPhone et Android avec les seuls postes de test : connexion, appel sortant/entrant, interruption réseau, notifications et déconnexion.
6. Exécuter les tests négatifs : organisation différente, utilisateur différent, poste différent, session expirée, compte révoqué, URL d’enregistrement réutilisée.
7. Tester boîte vocale, historique, enregistrements et chat à partir des sources serveur, puis vérifier Mobile ↔ Desktop.
8. Tester le rollback : couper le gate serveur; les clients doivent revenir à un état de téléphonie désactivée sans perte de compte ni bascule de données.
9. Activer pour le tenant de production seulement après approbation signée des preuves de test.

## Invariants

- DigitalOcean demeure le seul writer/runtime public.
- Hostinger demeure standby passif; ce document ne prépare ni promotion ni runtime actif.
- Les secrets restent serveur-only; les clients et le portail ne gèrent pas de mots de passe métier/SIP.
- Aucun automatisme de bascule ou de modification DNS ne fait partie de l’activation téléphonie.
