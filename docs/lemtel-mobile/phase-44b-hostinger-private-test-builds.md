# Phase 44B — Builds clients privés Hostinger

Le workflow manuel construit un **APK Android debug**, une **app iOS Debug non signée** et les sorties compilées du **Desktop** avec le profil Lemtel Hostinger filtré. Il crée ensuite une seule archive checksumée, privée et conservée trois jours, déposée sans application sur Hostinger puis DigitalOcean.

Ce workflow ne signe aucune release, ne crée aucun installateur Desktop, ne publie pas de page de téléchargement, ne distribue rien à des utilisateurs et ne démarre aucun composant sur DigitalOcean. Les valeurs SIP/WSS/TURN et les tests sur appareils physiques restent des prérequis séparés avant toute recette téléphonique.
