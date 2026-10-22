# AVA chat + voix dans le portail, pour Marc-Alexandre Maglieri seulement

## Résultat
- Un bouton flottant AVA dans le portail courtier et le portail admin, visible uniquement pour le compte de Marc-Alexandre Maglieri (poste 1136).
- Il ouvre le même AVA que l'application : chat (mêmes outils Maestro : clients, profils, tâches, commissions, courtiers) et voix (Amélie fr-CA, même agent).
- Pour tous les autres comptes : rien ne change, le bouton n'apparaît pas.
- Les permissions restent celles de Marc : il ne voit que ses propres données Maestro, appels et commissions.

## Ce qui ne change pas
- Aucune modification de l'application mobile, du code natif, des appels ou du routage.
- Aucun nouveau calcul de commissions : AVA garde la même source validée que le portail et l'app.

## Détails techniques
- Réutiliser `AvaChatSheet` et `AvaVoiceAgent` existants (mêmes fonctions `pp-ava-chat`, `pp-ava-webrtc-token`, `ava-tool-executor`, `_shared/ava-tools.ts`), montés dans un composant `PortalAvaLauncher` ajouté aux layouts portail courtier et admin.
- Activation par une liste d'accès côté serveur (indicateur `metadata.portal_ava_enabled = true` sur le profil de Marc), lue au chargement; le bouton n'est rendu que si l'indicateur est vrai et que `ava_chat_enabled` / `voice_agent_enabled` le sont.
- Vérification serveur dans `pp-ava-chat` et `pp-ava-webrtc-token` : un appel avec `surface: "portal"` est refusé (403) si le profil n'a pas l'indicateur.
- En mode admin, AVA utilise toujours l'identité de Marc connecté (jamais celle d'un courtier sélectionné).
- Tests : indicateur absent → bouton masqué et 403; présent → chat répond et outil Maestro `list_clients` relu.
- Déploiement des deux fonctions + publication web seulement après votre accord.
