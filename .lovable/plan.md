## Objectif

Ajouter dans le portail admin Planiprêt une page dédiée **Musique d'attente (MOH)** permettant de :
- écrire/corriger un texte d'annonce avec l'IA (Claude),
- générer l'audio voix + musique via ElevenLabs,
- écouter, conserver une bibliothèque,
- pousser la MOH au domaine et/ou à **tous les courtiers** d'un coup sur NetSapiens.

## Ce que dit la doc NetSapiens (vérifié)

NS-API v2 expose la musique d'attente sous `Media/Music on Hold` :
- `GET/POST /domains/{domain}/moh` — liste / création (upload multipart) au niveau domaine
- `DELETE /domains/{domain}/moh/{index}` — suppression
- `GET/POST /domains/{domain}/users/{user}/moh` — MOH par utilisateur (upload multipart)
- L'upload se fait en `multipart/mixed` avec le fichier audio (WAV/MP3) + métadonnées (index, description).

La page utilisera le helper existant `nsFetch` (`supabase/functions/_shared/planipret-ns.ts`), qui gère déjà JWT NS, domaine par défaut et circuit breaker.

## Ce qu'on construit

### 1. Base de données
Table `planipret_hold_music` : nom, texte source, texte corrigé, `voice_id`, style musical, `storage_path`, `audio_url`, `status` (queued / generating / ready / failed), `is_default`, `pushed_at`, `push_scope` (domain | all_brokers), `created_by`, timestamps. RLS + GRANT : lecture/écriture réservées aux admins Planiprêt (via `is_planipret_admin`).
Bucket privé Storage `planipret-hold-music`.

### 2. Edge functions
- **`pp-moh-improve`** — corrige/réécrit le texte d'annonce avec **Claude** via Lovable AI Gateway (prompt FR/EN, ton professionnel, durée cible), calqué sur `pp-greeting-improve`.
- **`pp-moh-generate`** — TTS ElevenLabs (`eleven_multilingual_v2`, voix sélectionnable via `pp-greeting-voices`) + génération d'un lit musical via l'API ElevenLabs Music, mixage voix/musique (voix par-dessus, boucle musicale), upload dans Storage, MAJ de la ligne DB.
- **`pp-moh-push`** — pousse le fichier vers NetSapiens :
  - scope `domain` → `POST /domains/{domain}/moh` (multipart)
  - scope `all_brokers` → itère sur les courtiers actifs (`planipret_profiles` avec extension) et `POST /domains/{domain}/users/{ext}/moh`, avec compteur succès/échecs et journalisation dans `planipret_audit_log`.
- **`pp-moh-list`** — liste les MOH déjà présentes côté NS (domaine) pour affichage/suppression.

### 3. Page admin
`src/pages/planipret/admin/PAHoldMusic.tsx`, route `/planipret/admin/hold-music`, entrée de menu (icône `Music`) dans la section **Système** de `PlanipretAdminLayout.tsx` (nav + `PAGE_KEY_BY_PATH` + clés i18n FR/EN dans `src/lib/i18n/mplanipret.ts`).

Contenu :
- Éditeur de texte avec bouton **« Corriger avec l'IA »** (Claude) et aperçu avant/après.
- Sélecteur de voix ElevenLabs + réglages (stabilité, style) + choix d'ambiance musicale et volume de la musique.
- Bouton **Générer** → lecteur audio intégré.
- Bibliothèque des MOH générées (rejouer, renommer, supprimer, définir par défaut).
- Bouton **Pousser** avec choix du périmètre (domaine / tous les courtiers) + dialogue de confirmation et rapport de résultat (X/Y programmés).
- Liste des MOH déjà en place côté NetSapiens.

## Détails techniques

- Réutilisation de `nsFetch`, `jsonResponse`, `corsHeaders` de `_shared/planipret-ns.ts`; toutes les fonctions valident le JWT et exigent le rôle admin Planiprêt.
- Le push utilise `FormData` (multipart) — NS accepte WAV/MP3 ; conversion en MP3 44.1 kHz côté ElevenLabs (`output_format=mp3_44100_128`).
- Le push « tous les courtiers » est traité par lots (concurrence limitée) pour éviter les timeouts, avec reprise possible.
- Aucun fichier `/mplanipret*` ni route mobile n'est modifié.
