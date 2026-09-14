# Pourquoi « REGISTERED » avec « native_sip_unavailable »

Ce ne sont pas deux avis contradictoires : ce sont deux sources différentes.

- Le badge vert **REGISTERED** vient du **serveur téléphonique** : il dit simplement qu'une ligne `113M` est inscrite. Mesuré à l'instant : cette inscription est tenue par le *service de maintien en arrière-plan* (agent « Planipret iOS KeepAlive », en WSS), pas par le moteur d'appel.
- Le message rouge **native_sip_unavailable** vient de **l'application elle-même** : dans cette session, le moteur d'appel natif n'a pas répondu, et le softphone de secours est volontairement interdit sur téléphone (il volerait la ligne au moteur natif).

Conséquence : la ligne paraît « en ligne » côté serveur mais aucun composant capable de porter l'audio ne la détient. D'où « Ringing… » sans son. Le bandeau « REST » en haut et les champs vides (Domaine —, WSS —, Dernière inscription —) confirment qu'aucun moteur n'a démarré dans l'app.

# Ce que je propose

## 1. Savoir précisément quel moteur est présent dans l'app installée

Ajouter un bloc de diagnostic honnête à l'écran d'état : moteur natif présent oui/non, pourquoi il a échoué (absent du binaire, refus d'inscription, identifiants non résolus), version du paquet à distance installée. Aujourd'hui l'écran n'affiche qu'un code d'erreur sans dire lequel des trois cas s'applique. Ce bloc tranche la question sans nouvelle soumission.

## 2. Selon le résultat, deux chemins

**Cas A — le moteur natif est présent mais n'arrive pas à s'inscrire**
Réparation à distance : libérer la ligne tenue par le service d'arrière-plan, réinscrire le moteur en TLS, réessayer avec attente croissante, et forcer le réalignement serveur du poste. Les appels retrouvent l'audio.

**Cas B — le moteur natif est absent de l'app installée**
Aucun correctif à distance ne peut y ajouter un moteur d'appel. Mais on peut redonner l'audio autrement, sans soumission : faire porter les appels par le softphone de l'application sur **sa propre ligne** (`113W`), au lieu de la ligne mobile `113M` qui reste réservée au moteur natif. Les deux lignes coexistent déjà côté serveur, donc :
- plus de conflit ni de vol de ligne entre les deux ;
- les appels entrants sonnent sur les deux grâce au renvoi simultané déjà actif ;
- les appels sortants partent avec l'audio du softphone.

C'est exactement la configuration qui séparait les rôles avant la dérive, et elle est entièrement livrable à distance.

## 3. Vérification réelle

- Appel sortant de test depuis ton poste 113, contrôle du relevé d'appel (durée > 0, flux audio présent).
- Appel entrant de test, contrôle de la sonnerie et de l'audio.
- Rapport final : qui tient la ligne, quel moteur, résultat des deux appels.

# Détails techniques

- Écran concerné : `MSipDebug.tsx` — ajouter l'origine réelle de l'état (moteur natif / service d'arrière-plan / serveur) et le motif d'échec détaillé fourni par `nativeSipService`.
- Cas B : dans `useMplanipretSoftphone.ts`, lorsque le moteur natif est indisponible sur plateforme native, résoudre les identifiants avec `client_type: "web"` (ligne `<ext>W`, WSS 9002) et lever le blocage JsSIP uniquement pour cette ligne — `ppSipProvider.init` garde son interdiction sur `<ext>M`.
- Vérifier côté serveur que la règle de renvoi simultané inclut `<ext>W` (contrôle déjà exposé par `pp-ns-call-doctor`), et que `<ext>M` reste en TLS 5061.
- Aucune modification du code natif iOS, de CallKit, du routage audio ni de la configuration Capacitor.
- Livraison : nouveau paquet à distance + activation, comme pour 1.0.25.

# Limite connue

Si le moteur natif est absent du binaire installé (cas B), les appels passeront par le softphone : cela fonctionne app ouverte, mais un appel entrant ne pourra pas réveiller un téléphone dont l'app est fermée tant qu'une nouvelle version de l'app n'est pas soumise.
