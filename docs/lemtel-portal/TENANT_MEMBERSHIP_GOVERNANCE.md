# Gouvernance des rattachements Lemtel

## Autorité et frontières

- Une **organisation Lemtel** est le tenant canonique.
- Un **domaine applicatif** est rattaché à une seule organisation. Il ne crée ni DNS, ni routage, ni extension, ni donnée ou réglage de téléphonie.
- L’accès d’une personne au domaine découle exclusivement de son **membership actif** dans l’organisation propriétaire du domaine. Il n’existe pas de liaison directe utilisateur–domaine, afin d’éviter une frontière d’accès concurrente et incohérente.
- Toute action passe par `lemtel-onboarding-admin`; le navigateur ne modifie jamais les tables directement.

## Opérations autorisées au control-plane

| Opération | Rôle requis | Effet autoritaire |
|---|---|---|
| Assigner un compte Lemtel existant | Owner ou admin de l’organisation | Crée une adhésion `active`, ou réactive une adhésion suspendue. Aucun compte, mot de passe ou e-mail n’est créé. |
| Modifier le rôle d’une adhésion non-owner | Owner ou admin de l’organisation | Bascule entre `member` et `admin`, avec incrément de la révision d’autorité. |
| Réactiver | Owner ou admin de l’organisation | Même opération d’assignation : retire uniquement l’état `suspended`. |
| Révoquer | Owner ou admin de l’organisation | Suspend l’adhésion ; le dernier owner actif reste protégé. |
| Créer/suspendre un domaine | Owner ou admin de l’organisation | Gère le registre Lemtel applicatif sans modifier DNS ni téléphonie. |

Chaque mutation est auditée sans secret ni détail réseau. Le trigger `lemtel_membership_authority_revision_after_change` garantit que Mobile et Desktop reçoivent une nouvelle révision d’autorité lors de tout changement d’adhésion.

## Limites intentionnelles

- Les owners ne sont ni créés ni déclassés par ces nouvelles commandes ; le dernier owner demeure protégé par la logique de révocation existante.
- Les invitations opaques, l’expiration et le transfert formel de owner seront traités dans la suite de la phase 1.
- Aucune capacité PBX/SIP/WSS/TURN, appel, média, SMS, messagerie vocale, chat, notification ou donnée Avastatistic/Planiprêt ne fait partie de ce périmètre.
