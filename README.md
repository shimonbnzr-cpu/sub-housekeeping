# Hôtel SUB - Housekeeping App

Gestion quotidienne du ménage pour l'Hôtel SUB (44 chambres).

## Stack

- **Frontend**: React 19 + Vite
- **Backend**: Firebase Firestore
- **Styling**: CSS custom (pas de framework UI)
- **i18n**: i18next (FR/EN/RO)

## Getting Started

### 1. Installation

```bash
npm install
```

### 2. Configuration

Copier `.env.example` vers `.env` et configurer:

```bash
cp .env.example .env
```

Variables requises:
- `VITE_FIREBASE_*` - Configuration Firebase (voir Firebase Console)

Optionnelles:
- `VITE_SENTRY_DSN` - Error tracking Sentry
- `VITE_POSTHOG_KEY` - Analytics PostHog

### 3. Lancement

```bash
npm run dev
```

Acces: http://localhost:5173

### 4. Build production

```bash
npm run build
```

## Utilisation

### Mode réception
- URL: `/?mode=reception` (ou défaut)
- Grille des 53 chambres
- Assignation femme de chambre
- Statuts: à faire / en cours / terminée

### Mode femme de chambre
- URL: `/?mode=staff`
- Voir ses chambres assignées
- Mettre à jour le statut

## Règles d'auto-assignation

1. Blanc d'abord (quota = ceil(nb_blanc / nb_personnes))
2. Total max 1 différence entre personnes
3. Max 3 étages par personne
4. Dortoirs groupés
5. Rotation quotidienne

## Bonnes pratiques (Vibe Coding)

Ce projet suit les règles de "Vibe Coding 2.0":

- ✅ Auth Firebase (géré)
- ✅ Environment variables pour secrets
- ✅ Sentry pour error tracking
- ✅ PostHog pour analytics
- ✅ README documenté

## Structure

```
src/
├── components/    # Composants React
├── services/      # Firebase, analytics
├── data/          # Données statiques
├── App.jsx        # Routeur principal
└── main.jsx       # Entry point
```

## Déploiement

```bash
npm run build
# Upload dist/ vers hosting (Firebase Hosting, Vercel, etc.)
```
