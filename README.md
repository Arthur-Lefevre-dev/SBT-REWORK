# Steam Ban Tracker

Outil JavaScript pour **traquer les bannissements Steam** (VAC, Game, Community). Les profils sont découverts via le réseau d'amis à partir d'un profil de départ.

## Prérequis

- Node.js 18+
- Une clé API Steam : https://steamcommunity.com/dev/apikey

## Installation

```bash
npm install
```

Créez un fichier `.env` :

```
STEAM_API_KEY=votre_cle_api
```

## Utilisation

```bash
# Scraper à partir d'un SteamID64
node index.js 76561198011775992

# Options : profondeur max 3, max 200 profils à analyser
node index.js 76561198011775992 3 200
```

Les amis servent uniquement à **découvrir de nouveaux profils** à analyser pour détecter les bans.

### Données extraites par profil

- **SteamID64** et **SteamID** (format legacy `STEAM_1:Y:Z`)
- **Bans** : VAC, Game, Community avec date (jours depuis dernier ban, date estimée)

### Base de données SQLite

Les données sont stockées dans `steam-data.db` à chaque scraping. L'interface web permet de consulter les bannissements.

### Interface web

```bash
npm run server
```

Ouvre http://localhost:3000 — dashboard centré sur les bans : tous les bannis, VAC, Game, Community.

## Notes

- L'API Steam impose des limites de débit ; un délai d'environ 1 s est appliqué entre les requêtes.
- Les profils privés n'exposent pas leur liste d'amis.
- Respectez les [conditions d'utilisation de l'API Steam](https://steamcommunity.com/dev/apiterms).
