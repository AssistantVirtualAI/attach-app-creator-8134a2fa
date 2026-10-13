# Lemtel — autorité unique Mobile / Desktop

> **Principe :** Mobile et Desktop sont deux clients du même compte Lemtel. Ils ne se copient jamais des mots de passe, des enregistrements ou de l’historique entre appareils.

## Ce qui est partagé côté serveur

| Donnée | Autorité | Règle client |
| --- | --- | --- |
| Mot de passe Lemtel | Supabase Auth Lemtel | Un seul mot de passe pour les deux applications. Il n’est jamais stocké, exporté ni recopié par un client. |
| Sessions | Supabase Auth Lemtel | Une session distincte par appareil; une déconnexion ou révocation est vérifiée côté serveur. |
| Organisation, rôle et poste | `lemtel-session-bootstrap` | Le serveur décide; ni Mobile ni Desktop ne choisit une organisation ou un rôle. |
| Historique, messagerie et métadonnées d’enregistrement | APIs et Realtime authentifiés du serveur | Les clients affichent les données autorisées par la session courante. Aucun cache n’est une source de vérité. |
| Lecture audio d’un enregistrement | Proxy authentifié | Le client fournit seulement l’identifiant d’appel; le serveur autorise chaque URL de lecture. |

## Règles de sécurité appliquées

1. Les mots de passe métier ne sont pas enregistrés localement. Les anciens secrets SIP persistés sont ignorés et ne sont plus réécrits.
2. Les caches audio sont cloisonnés par utilisateur, organisation et poste; ils sont purgés à la déconnexion ou au changement de session.
3. Une réponse arrivée après une déconnexion ou un changement de session est rejetée.
4. Un enregistrement ne peut pas être lu à partir de son chemin, nom, URL ou métadonnée fournie par le client.

## État de disponibilité

Le compte e-mail/mot de passe est le point d’entrée commun. La récupération de mot de passe nécessite que le runtime Edge du writer DO possède les quatre variables requises et que le contrat SQL Lemtel soit présent.

L’historique réel des appels, les enregistrements, la messagerie et les appels eux-mêmes ne peuvent être déclarés synchronisés de bout en bout qu’après le provisionnement téléphonique approuvé et les tests réels Mobile/Desktop. Aucun changement SIP, WSS, TURN ou FusionPBX n’est activé par ce document.
