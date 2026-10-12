# Routage canonique Lemtel via Cloudflare

Le nom public canonique Lemtel est **`lemtel.assistantvirtualai.com`** dans la zone Cloudflare `assistantvirtualai.com`.

## État réel — drill contrôlé exécuté

Le 11 octobre 2026, la procédure contrôlée et explicitement autorisée a été menée dans cet ordre :

1. le writer Hostinger a été fencé avec une preuve liée à l’incident de drill ;
2. PostgreSQL DigitalOcean a été promu comme **writer unique** ;
3. le runtime Supabase et le Storage répliqué ont été activés sur DigitalOcean, tandis que PostgreSQL est resté non publié ;
4. l’enregistrement A DNS-only du nom canonique a été déplacé manuellement vers l’origine DigitalOcean, avec un TTL de 120 secondes ;
5. les sondes HTTPS strictes, Auth, Storage, REST et `lemtel-session-bootstrap` ont confirmé le chemin public sur DigitalOcean.

> Le routage actuel est un **cutover manuel de drill**. Ce n’est pas un mécanisme de bascule automatique ni un Cloudflare Load Balancer.

## Garanties conservées

- Le record est DNS-only : Cloudflare n’est pas utilisé comme proxy applicatif dans ce drill.
- PostgreSQL DigitalOcean n’a aucun port hôte ou listener public.
- Aucun FusionPBX, SIP, WSS, TURN, provisionnement d’extension ou téléphonie réelle n’a été changé.
- Hostinger est le **former primary fenced**. Il ne doit jamais être relancé comme writer dans son état actuel.
- Aucun failback, retour DNS ou reverse-replication vers Hostinger n’a été effectué.

## Retour vers Hostinger

Le failback est une opération distincte : il faut d’abord reconstruire/resynchroniser Hostinger comme standby à partir du writer DO, contrôler la réplication PostgreSQL et Storage dans le bon sens, puis approuver une nouvelle fenêtre avec fencing, cutover et validation. Un simple redémarrage Hostinger est interdit, car il pourrait créer deux writers.
