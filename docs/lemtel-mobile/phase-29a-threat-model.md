# Phase 29A — Modèle de menace

- **Menace** : un téléphone reçoit un événement Realtime de boîte vocale concernant une autre extension du domaine.
- **Mitigation** : filtre Realtime exact par extension (`extension=eq.<ext>`), contrôle de l'extension de la charge (`new`/`old`) avant rechargement, retrait du canal au changement de session ou au démontage.
- **Données protégées** : existence, fréquence et moment de réception d'une boîte vocale d'un collègue.
- **Limitation** : le filtre client ne remplace pas l'autorisation serveur de l'audio, traitée dans une phase ultérieure.
