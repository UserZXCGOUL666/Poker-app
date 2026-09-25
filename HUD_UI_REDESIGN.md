# Poker Club — HUD UI redesign

This build keeps the existing navigation, routes, API contracts and core user/admin workflows, while replacing the player-facing visual system with a performance-dashboard / tournament-HUD aesthetic.

## What changed

- New graphite + safety-orange visual system across the Mini App.
- Existing 5-item bottom navigation and route structure are unchanged.
- Home, tournaments, rating, privileges, profile, browser login and common cards/forms were restyled without removing features.
- Admin area remains deliberately simpler and function-first.
- Tournament TV timer was rebuilt as a full-screen HUD:
  - large circular central countdown;
  - current level / blinds / ante panel;
  - next level and upcoming-level queue;
  - wall clock and date;
  - full-screen mode;
  - existing start/pause/next/previous/add-time/reset controls retained for admins;
  - configurable top and bottom scrolling tickers.
- Ticker text and speed are stored in PostgreSQL per tournament, so a TV/browser opened on another device receives the same messages.

## Database migration

A new migration is included:

`apps/api/prisma/migrations/202609240001_hud_timer_display/migration.sql`

It adds these nullable/safe fields to `TournamentTimer`:

- `topTicker`
- `bottomTicker`
- `tickerSpeed`

It also changes the default club accent from the previous blue to `#FF3D0A` and migrates the old default blue setting to the new orange.

The migration does not delete tournaments, players, registrations, points or timer levels.

## Vercel deployment

The application no longer runs Prisma migrations during Vercel build or container startup. The migration file is retained only as schema history. If a database schema change is required, apply it manually in a controlled maintenance step. Previously documented normal flow:

1. Replace/update the repository files with this archive.
2. Commit to the production branch.
3. Let Vercel create a new Production deployment.
4. Open `/api/health` first.
5. Open the Mini App and a tournament timer.

No new environment variables are required for this UI update.

## Timer ticker settings

Open a tournament TV timer as an ADMIN and use the settings button in the timer header. You can edit:

- top ticker text;
- bottom ticker text;
- scrolling duration/speed.

Saving writes the settings to the tournament timer in PostgreSQL.
