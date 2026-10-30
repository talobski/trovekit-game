# Architecture

Trovekit Game separates a generic Schema v2 engine from pack data and presentation.
A content pack provides themed text/artwork and supported balance settings;
it cannot introduce executable code, new action types or arbitrary rules.

| Area | Responsibility |
| --- | --- |
| `src/engine/` | Schemas, validation, seeded randomness, turn rules and client projections |
| `src/shared/content.ts` | Shared content contract used by admin and server |
| `content/` | Generic rules and blank template; no installed pack |
| `server/rooms.ts`, `saved-room.ts` | Room sessions, lifecycle, snapshots and local JSON persistence |
| `server/game-server.ts`, `websockets.ts` | Public game HTTP/WebSocket boundaries and live subscriptions |
| `server/admin-server.ts`, `content-store.ts` | Separate loopback-only content library and version management |
| `server/assets.ts`, `bundles.ts` | Managed raster artwork, validation and portable import/export |
| `src/app/` | Game UI using pack labels/icons/tones |
| `src/admin/` | Trusted local content editor |
| `src/bots/` | Deterministic bots using the same engine rules as human actions |
| `tests/`, `e2e/` | Generic fixtures and isolated unit/integration/browser verification |

The game server validates actions and membership, persists accepted room changes,
then publishes state to authorized subscribers. Browsers do not supply authoritative
scores or game state. A started room keeps a canonical content snapshot/hash;
subsequent pack edits cannot change that game's rules. Internal action names such
as `collect`, `reserve` and `acquire` stay mechanical while packs choose display
words. See [INTERNAL_TERMINOLOGY.md](INTERNAL_TERMINOLOGY.md).

One game process and at most one admin process share a persistent local library.
They are separate HTTP servers; the public game has no content-management API.
There are no user accounts, external databases or shared-worker coordination.
Room membership uses bearer tokens stored in the browser. This is deliberately a
small self-hosted deployment model, not a horizontally scaled service.

Schema v2 content, saved-room format v2 and bundle format v1 are distinct formats.
See [deployment notes](DEPLOYMENT.md) for security, recovery, proxy requirements
and upgrades.
