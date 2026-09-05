# Audit complet — état final (5 sept. 2026, 00h10 UTC)

## Résumé
| Domaine | État |
|---|---|
| Appels (journal, CDR) | OK |
| Enregistrements | OK |
| Transcriptions / résumés / coaching IA | OK |
| Textos | OK (153/155 synchronisés) |
| Endpoints Maestro | OK (boucle 405 éteinte) |
| Files de travaux (appels, actions PBX) | Vides, aucun échec |
| Connexions Maestro des courtiers | **À corriger — action humaine** |

## Détails mesurés
- **Boucle d'erreurs 405** : dernière occurrence à 22h30 le 4 sept., plus rien depuis le correctif du garde de vérification. Sur 3 h : 812 sondages médias réussis, 141 poussées d'enregistrement, 151 résumés IA.
- **Appels** : 506 appels sur 30 jours. Sur 7 jours, seulement **8 appels de plus de 5 s** ne sont pas rattachés à Maestro (postes 1370, 1136, 1316), contre 157 avant correctifs. Le rattrapage automatique tourne toutes les 5 min.
- **Médias et IA** (7 jours, appels ≥ 5 s) : 92 appels, 57 enregistrements, 65 transcriptions, 64 résumés IA. Les manques restants sont des appels très courts ou sans audio côté PBX.
- **Textos** : 155 sur 30 jours, 153 synchronisés. Les 2 restants (10 août, même destinataire) ont atteint la limite de tentatives — refus côté Maestro, pas un défaut applicatif.
- **Files d'attente** : 0 travail en attente et 0 échec sur 24 h pour le traitement d'appel et les actions PBX.

## Point bloquant restant
Seuls **15 courtiers sur 224** ont une connexion Maestro active. Les appels et textos des autres ne peuvent pas être synchronisés, quel que soit le correctif logiciel. Ces personnes doivent cliquer « Reconnecter Maestro » dans leur portail (Audrey Ann Chagnon Nantel, Pierre Gauthier, Miriam Nourcy, David Roussel, Josianne Leboeuf en priorité — ce sont elles qui génèrent du volume).

## À faire sur appareil réel (non vérifiable côté serveur)
- Appels SIP entrants/sortants, transfert, attente, muet, DTMF sur la build TestFlight 1.0.21 (poste 1372).
- Prise d'appel en arrière-plan et écran verrouillé.
- Audio du voicebot AVA et connexion Microsoft depuis l'app.
