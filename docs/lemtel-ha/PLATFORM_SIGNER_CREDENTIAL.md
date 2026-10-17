# Lemtel — crédential chiffré du signer de plateforme

## But et limites

Ce paquet root-only prépare uniquement un signer de plateforme à partir d’un **crédential systemd chiffré**. Il crée :

- `/etc/credstore.encrypted/lemtel-node-platform-signer.cred`, un JWK P-256 privé chiffré et authentifié pour cet hôte ;
- `/etc/lemtel-node-platform-signer/public-pin.json`, le pin public correspondant, accessible uniquement à root.

La clé privée n’est jamais écrite en clair : le générateur Python l’envoie par pipe directement vers `systemd-creds encrypt`. Elle n’est ni affichée, ni ajoutée à une variable shell, ni placée dans un fichier `.env`, un dépôt, un gist, une archive, un navigateur ou une commande.

Le format s’appuie sur [`systemd-creds encrypt`](https://man7.org/linux/man-pages/man1/systemd-creds.1.html), qui chiffre et authentifie un crédential et l’associe à son nom. `LoadCredentialEncrypted=` le déchiffrera uniquement lors de l’activation ultérieure d’un service root-only. Le support exige systemd **250 ou plus**.

## Gates d’exécution

L’initialiseur bloque avant toute écriture sans :

1. utilisateur `root` ;
2. rôle `digitalocean_writer` ;
3. jeton d’exécution explicite `initialize_encrypted_platform_signer` ;
4. attestation d’un snapshot writer chiffré et frais ;
5. `python3`, `openssl` et `systemd-creds >= 250` disponibles ;
6. absence de crédential et de pin existants. Leur présence impose une procédure de rotation distincte.

Le script ne télécharge rien et ne contacte aucun réseau, fournisseur, base, runtime, Cloudflare, DNS ou téléphonie.

## Ce que cette phase ne fait pas

Elle ne crée pas de service systemd, ne charge aucun crédential dans un processus, ne modifie pas le runtime Edge, ne rend pas les routes d’enrôlement actives, ne transfère pas le pin public vers Hostinger et ne crée aucun publisher. Les endpoints d’enrôlement restent `503` tant qu’une future intégration n’a pas été revue, testée et explicitement activée.

La clé publique root-only devra ensuite être transférée via un canal indépendant authentifié avant d’être épinglée dans chaque `binding.json`. Une lecture réseau de la clé publique ou du signer depuis un nœud ne constitue pas un canal indépendant et est refusée.

Un crédential systemd déchiffré est fourni par systemd à un service au moment de son activation via son répertoire de credentials ; la conception d’un sidecar signer local devra s’assurer que ce fichier ne soit lisible que par le processus root concerné et qu’aucune clé privée n’entre dans l’environnement Edge.
