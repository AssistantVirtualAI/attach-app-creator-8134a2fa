---
name: NS ring announcement (avis d'enregistrement)
description: L'avis "cet appel est enregistré" joué au correspondant pendant la sonnerie via MOH + music-on-ring-enabled
type: feature
---

Pour jouer un message au **correspondant pendant la sonnerie** sur NetSapiens (sans toucher aux DID) :

- Uploader le WAV (8 kHz mono PCM16) comme média MOH du domaine : `POST /domains/{domain}/moh` avec `{ synchronous:"yes", convert:"yes", name, index:1, script, encoding:"audio/wav", base64_file }` → 200, fichier `moh-01.wav`.
- Activer l'early media : `PUT /domains/{domain}` avec `"music-on-ring-enabled":"yes"` (+ `music-on-hold-enabled:"yes"`, `music-on-hold-randomized-enabled:"no"`).
- Edge Function : `pp-ns-ring-announcement` (actions `status` | `enable` | `disable`, `probe` pour diagnostic).
- Effet secondaire : le même média sert aussi de musique d'attente (hold) du domaine.
- Fait le 2026-07-31 sur `planipret.ca`. Les greetings voicemail (index 1) restent le message standard ; index 9 = slot annonce.
