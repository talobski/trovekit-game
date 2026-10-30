# Trovekit Game

An open-source card strategy game you can make your own.

A mobile-first multiplayer card-collecting game engine for 2 to 4 players. Players collect resources, reserve and acquire cards that permanently lower the cost of later ones, and claim shared achievements. Reaching the target points starts the final round; everyone gets the same number of turns.

Trovekit Game itself is theme-independent. The themed game content (names, cards, artwork, achievements and configurable action words) comes from a **content pack** you create or import in the private admin. A new installation has **no content installed**.

Fork the source, create a content pack and self-host a themed game without changing
the engine. Packs customize presentation and supported Schema v2 balance fields;
they cannot define arbitrary actions, scripts or unrestricted game mechanics.

Start with the [first-pack tutorial](docs/CONTENT_PACKS.md),
[architecture guide](docs/ARCHITECTURE.md) and [deployment guide](docs/DEPLOYMENT.md).

**License:** [MIT](LICENSE) for project-owned code and original fixtures.
Dependencies, fonts and copied components retain their [third-party licenses and notices](docs/LICENSING.md).
To report a problem or contribute, see [contributing](CONTRIBUTING.md).

## Requirements

- Node.js 22.22.2 (see `.nvmrc`) and the npm that comes with it. This is the only verified runtime; other versions may work but are not supported until verified.
- macOS or Linux with a POSIX shell for the documented commands. Windows is not documented or verified.
- For the browser test suite only: Playwright's Chromium (`npx playwright install chromium`) and OpenSSL for the temporary HTTPS test certificate. The LAN test skips when no non-loopback IPv4 interface is available.

## Setup

Clone the repository (or your fork), then install the locked dependencies:

```sh
git clone <repository-url> trovekit-game
cd trovekit-game
npm ci
```

## First run: an empty library

```sh
npm run dev      # game, http://localhost:4747
npm run admin    # private admin, http://127.0.0.1:4748
```

A fresh installation has no content packs, rooms or artwork. Nothing is installed or restored automatically.

- **Game:** Home says "No game available yet" and Create room stays disabled until a published version is made the default. Joining an existing room still works.
- **Admin:** opens on its library, with **Create pack** and **Import pack**. **Create pack** opens a creation page (`#/new`) for making a pack with your own AI assistant. A sidebar lists the library and every installed pack; the selected pack expands into its workspace (Overview, Cards, Resources, Rules, Achievements, Relationships, Versions, Preview, Settings).

To get playing:

1. In the admin, choose **Create pack** and enter a pack name, and optionally describe your game. **Copy AI prompt** copies a prompt for ChatGPT, Claude or another assistant: it first talks through your game in plain language (theme, cards, resources, tiers, achievements, relationships and pacing, accepting "Surprise me"), proposes a design for you to approve, and only then writes the complete pack, following the full-pack requirements with the blank template and content schema included. Save the pack it gives you as a `.json` file and **Import pack file**. The import review summarizes the pack (its JSON is under **View technical details**); **Import** saves it as a draft and opens its workspace, so a refresh keeps it. Nothing is saved by visiting the page, typing or copying. Or choose **Create manually instead**: a unique internal ID is generated automatically and stays the same when you rename the pack, and the pack starts from the generic blank template (`content/templates/blank-pack.json`): generic labels, five resources, three tiers and no cards. Either way the pack opens on its **Overview**, whose setup checklist follows the pack's real configuration and links to each page. **Import pack** on the library also accepts a JSON file, or a ZIP bundle with images.
2. In **Cards**, copy the prompt for your AI assistant or prepare your own JSON/CSV batch, then **Import cards** and review it. Individual card editing and artwork upload remain available. A draft can be saved while incomplete. Publishing requires a valid pack.
3. **Publish version** publishes it as an immutable version. Then choose **Make default** so new rooms use it.
4. On the game's Home, create a room and share the invite link or room code. Action IDs use Web Crypto `getRandomValues`, which works on ordinary local HTTP. The server listens on all interfaces, so phones on the same network can join at `http://<your-computer's-LAN-IP>:4747`.

To play without other people, choose **Add bot** in the lobby. The host can add 1 to 3 bots (4 players in total). Bots play on the server after a short pause.

Production build:

```sh
npm run build
npm start              # game, http://localhost:4747
npm run admin:start    # admin, http://127.0.0.1:4748
```

By default the game listens on every network interface over plain HTTP, which
suits a trusted LAN. On a machine reachable from the internet, bind it to
`127.0.0.1` behind an HTTPS/WSS reverse proxy, as the
[deployment guide](docs/DEPLOYMENT.md) describes.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4747` | Game server port |
| `HOST` | `0.0.0.0` | Game server bind address (all interfaces; use `127.0.0.1` behind a proxy) |
| `ADMIN_PORT` | `4748` | Admin port (always bound to 127.0.0.1) |
| `TROVEKIT_DATA` | `./data` | Rooms, content versions and uploaded images |
| `BOT_DELAY_MS` | `1200` | Pause before each bot move |

For an HTTPS deployment also set `PUBLIC_ORIGIN` and, behind a reverse proxy,
`TRUSTED_PROXIES`. Every setting, with its limits, is in the
[deployment guide](docs/DEPLOYMENT.md#configuration-and-limits).

The default `data/` directory is git-ignored. Everything you create lives in
`TROVEKIT_DATA`; keep custom data paths outside the source tree or exclude them explicitly:

- `content/`: the pack library, versions and drafts
- `assets/`: uploaded images, content-addressed WebP
- `rooms/`: saved rooms

SIGINT/SIGTERM stop new work, close WebSockets and drain HTTP requests for up to five seconds. Room changes are acknowledged only after an atomic file replacement succeeds. Failed writes return an error without advancing in-memory game state.

`GET /healthz` reports process liveness; `GET /readyz` also checks room recovery/storage status, the content index and production entry page. An empty library is healthy. Invalid Schema v2 room files are logged, left untouched and excluded from recovery; readiness stays false until the operator repairs or moves them and restarts. Unsupported older room formats remain untouched.

Back these up together. Unfinished rooms are saved after every action and reloaded on restart. Idle rooms expire: 24 hours in the lobby, 7 days in play, 24 hours after the game ends.

To return to a blank installation, stop both servers and remove or move the `TROVEKIT_DATA` directory. The servers recreate it, empty.

## Private admin

The admin is a separate process. It binds to 127.0.0.1 only, accepts only localhost `Host` headers, and requires an `X-Trovekit-Admin` request header (`tests/http-endpoints.test.ts` checks every admin route for both). The game server has no admin routes and does not serve the admin page. Run the admin on the same machine and with the same `TROVEKIT_DATA` as the game server.

In the admin you can:

- manage a library of packs: create from the blank template, duplicate, import, archive
- edit rules, resources (label, tone and icon), the optional resource picture, card groups, cards and their artwork, achievements, relationships and every label
- see validation as you edit (the same checks run on the server) and preview cards
- import and export JSON (up to 1 MB) or ZIP bundles with images
- save versions, compare any version with the editor, and choose the version new rooms use

Rooms copy their rules and pack when the game starts and keep that snapshot, along with its hash. Admin changes never alter a game in progress.

## Tests

```sh
npm run typecheck
npm test               # engine, content, bots, server and admin-model tests (Vitest)
npm run test:e2e       # browser suite (Playwright): builds and starts the servers itself
npm run release:check  # tracked files against the release allowlist (see docs/RELEASE.md)
npm run simulate -- [content.json] [games]   # balance report; defaults to the Starfall fixture
```

Tests never read local saved data, and nothing is installed by default, so every suite installs its content explicitly:

- **Starfall Academy** (`tests/fixtures/starfall.json`, artwork generated by `tests/fixtures/starfall.ts`) is the complete themed fixture.
- **Gem Guild** (`tests/fixtures.ts`) is a compact pack with a unique group.

`e2e/seed.ts` publishes Starfall into the e2e data directory before the servers start on 5280/5281. A second pair on 5282/5283 runs on an empty directory for the first-run tests (`e2e/blank.spec.ts`). Each run uses fresh OS temporary data directories; screenshots go to ignored `test-results/evidence/`. The suite raises request/room-creation limits for its rapid full-game runs.

## Project layout

```
src/engine/      Generic rules engine: schemas (Zod), validation, setup, actions, achievements
src/shared/      The content contract (pack + rules) shared by the servers and the admin client
src/bots/        Bot players (Normal level), separate from the engine
content/         Generic default rules and the blank pack template (nothing is installed)
server/          Game server (HTTP + WebSocket, JSON-file persistence) and the separate admin server
src/app/         Game client (React, Tailwind, shadcn/ui)
src/admin/       Admin client
src/styles/      Base theme tokens (theme.css) and semantic extensions (semantic.css)
tests/           Vitest suites and fixtures
e2e/             Playwright suites
docs/            Content authoring, architecture, terminology, deployment and release guides
```

## Internal terminology

Internal identifiers describe game mechanics (`collect`, `reserve`, `acquire`, `resources`, `permanentResource`, `points`, `collection`). Player-facing words come only from the pack. [docs/INTERNAL_TERMINOLOGY.md](docs/INTERNAL_TERMINOLOGY.md) is the canonical reference for every identifier, label and rule.

## Theme

`src/styles/theme.css` defines the base theme tokens: colours, Space Grotesk and Inter, radii, shadows, spacing and motion. `src/styles/semantic.css` adds success, warning, info and named tones for resource kinds. It also holds documented contrast adjustments for WCAG AA text contrast.

Each resource kind has a named **tone** and a named **icon**. Icons come from a fixed set of Lucide glyphs (`RESOURCE_ICONS`) and must differ between kinds, so kinds never rely on colour alone; wildcards keep the sparkle. A pack may add a **resource picture**, an uploaded image shown full-bleed behind each option when collecting resources. A **Key** button names every icon (keyboard and touch), and resource counts show their name on hover.

## UI conventions

- **shadcn/ui first.** Primitives live in `src/components/ui/`. Compositions live in `src/components/`: `ResponsiveSheet` (drawer on phones, dialog on wider screens) and `Combobox`. Custom controls are kept only for game pieces: cards, standings tiles, resource tiles and resource discs.
- **Select policy:**
  - shadcn **Select** for standard dropdowns (a handful of options).
  - The shadcn **Combobox** pattern (`src/components/combobox.tsx`) for long or searchable lists, such as relationship cards. It opens a Popover with a searchable Command list on wider screens and a Drawer on phones.
  - No NativeSelect or raw `<select>` without a specific technical reason. `tests/ui-conventions.test.ts` enforces this.
- **Forms** compose shadcn **Field** (label, control, description or error).
- **Disclosure** uses shadcn **Collapsible**, never a native `<details>`. **Tooltip** (one `TooltipProvider` at the root) only repeats text that is also available another way; hover-only information is not allowed. Headings use the theme's `type-heading` utility.
- **Scrolling.** Contained regions (sheet bodies, Combobox results, the admin change and issue lists) use shadcn **ScrollArea**. The page itself keeps native scrolling.
- **Sheets** use `ResponsiveSheet`. On open, focus moves inside; on close, it returns to the opener when it still exists.
- **Theme tokens only;** no one-off colours.

## Bots

Bots live in `src/bots/` and use only the engine's public functions. The server plays a bot's turn through the same engine call as a human turn, and a bot proposes only moves the engine accepts.

The Normal bot acquires the most valuable affordable card. Value combines points, achievement progress and how much the card's permanent resource helps with other cards in view, shifting toward points late in the game. When it can't acquire, it targets the card with the best value per turn of effort and collects the resources that card still needs. It reserves a card when an opponent could acquire its target first, or when collecting cannot help. It returns its least useful resources when over the holding cap.

Each decision is seeded from the game seed, the revision and the bot's seat, so a fixed game seed replays a game exactly. No external AI services are used.

## Content packs

A pack plus its rules is one JSON object `{ pack, rules }`, schema version 2, validated by `src/engine/schema.ts` and `src/engine/validate.ts`. Version 1 content is not accepted and there is no converter. See [docs/INTERNAL_TERMINOLOGY.md](docs/INTERNAL_TERMINOLOGY.md) for every field.

- `resourceKinds`: exactly five, each an `id`, `label`, `tone` (from a fixed palette, never raw colours) and `icon` (from `RESOURCE_ICONS`, different for each kind)
- `resourceArt`: optional uploaded picture for the resources as a whole, `{ "src": "/art/managed/<sha256>.webp", "alt": "…" }`. Bundles carry the image.
- `cardGroups`: tiered groups (four face-up cards each by default) and at most one optional unique group, each with an exact `deckSize` and cost and points ranges
- `cards`: `id`, `group`, `name`, optional `shortName`, `cost` per kind, one `permanentResource` (the kind it permanently contributes once acquired), `points`, optional `art` with provenance, and optional `meta` details (for example `{ "house": "Ashgrove" }`), shown with the card
- `achievementCategories` and `achievements`, with declarative requirements: `cardCount`, `distinctPermanentResources`, `relationships`, `claimedCategory`, `all` and `any`
- `relationships`: groups of 2 or 3 tiered card ids, each with a note and a source
- `labels`: every word the UI uses for actions and areas:
  - actions and their past tenses: `collect` / `collected`, `reserve` / `reserved`, `acquire` / `acquired`
  - nouns: `resource` / `resources`, `wildcard` / `wildcards`, `points`, `collection`, `achievements`, plus the optional `card` / `cards` (default "Card" / "Cards")

  `collect` and `collected` may name the resources label, for example `"Collect {label:resources}"`.

**Placeholders.** Achievement descriptions should name groups, kinds and labels through placeholders, so renaming a label in the admin updates every description:

- `{group:<cardGroup id>}`
- `{kind:<resourceKind id>}`
- `{label:<labels key>}`, for example `"{label:acquire} 3 {label:cards} from {group:tier-3}."`

Placeholders resolve for display only; the stored text and content hash never change. Unknown ids and stray braces are rejected on save. The admin shows a live "Reads as" line under each description.

Packs cannot contain scripts, expressions, remote image URLs or markup. HTTPS source and license links are allowed as provenance.

**Example: Starfall Academy** (`tests/fixtures/starfall.json`) is a complete fictional test pack:

- five elements (Ember, Tide, Gale, Stone, Spark) as resources, with their own icons
- 66 students and nine sworn pairs and triads
- 12 honors in four categories
- its own words (Gather / Gathered, Reserve, Bond / Bonded, Motes, Renown, Circle)
- original generated artwork and a crest as its resource picture, packaged as a portable ZIP

The tests import it through the admin, publish it and play full games against bots on phone and desktop. It is never installed by default.

## Card artwork

Card faces use full-bleed artwork with top-aligned object-cover, neutral readability gradients and a light inset edge. Missing images use an initials fallback.

In admin Cards, open a card to upload, replace or remove its image and record source, creator, permission, attribution and restrictions. **Import images** accepts multiple JPEG/PNG/WebP files (8 MB each, at most 400 and 64 MB per batch) or one ZIP of them with an optional `trovekit-images.json` source list; **Get images with AI** copies a prompt that asks your assistant to find images, check their sources and build that ZIP (see [card image ZIPs](docs/CONTENT_PACKS.md#card-image-zips)). Filenames match stable IDs exactly after lowercasing and removing the extension; the card-ID manifest in a pack's **Settings** lists them. Review matches and explicitly enable replacement before applying existing-image changes. Players see a card's image credit at the bottom of its details in the game.

Uploads are decoded on the private admin server, limited to 20 megapixels and 64–8000 pixels per side, and converted to 480 × 600 WebP. Images are stored only in `TROVEKIT_DATA/assets`; none ship with Trovekit Game. They are never automatically deleted, including after replacement or version changes. JSON exports keep artwork references and provenance; ZIP bundles also carry the images.

## Content packs and external AI workflow

Admin **Library** manages independent packs; each pack's own pages are in the sidebar:

- **New pack** (the creation page, then **Create manually instead** or an import), or **Duplicate pack** in a pack's **Settings**, by entering a name. IDs are generated on the server; duplicate names receive numeric suffixes without replacing existing packs.
- **Save draft** keeps unfinished work private.
- **Publish version** validates and publishes an immutable version. It never changes the default.
- **Make default** chooses the one published version new rooms use. Making an older version the default is a rollback; drafts and the latest published version are unchanged.
- **Archive** prevents a pack's versions from becoming the default while keeping its draft, versions and saved games. Change the default before archiving the pack that has it.

Players do not choose a pack: every new room uses the default version and stays on that exact version for its whole life, even if the default changes. Versions can be loaded for editing or made the default for rollback. To playtest an unreleased version, run a separate local instance with its own `TROVEKIT_DATA` (see the guide). See [drafts, versions and the default](docs/CONTENT_PACKS.md#drafts-versions-and-the-default).

**Cards** has a compact toolbar: **Add card**, **Generate cards with AI**, **Get images with AI**, **Import images** and **Import cards**. Generate cards with AI copies a prompt that first plans the new cards with you (subjects, counts per group, resources, cost and points), then, once you approve, writes a batch for **Import cards**; it includes the pack's resources, groups, rules, achievements, relationships, existing cards and the card schema. Recopy it after changing settings. **View prompt and example** in that sheet provides a small downloadable JSON batch. No AI service is called by Trovekit Game. The creation page's **Advanced tools** offer the full-pack schema, the blank template and an import format guide; a pack's **Settings** has its exports, card-ID manifest and bundle export.

**Imports.**

- Full JSON or ZIP imports require a review before they replace the editor. An import whose pack ID already exists asks whether to update that pack or create a separate one. Saves and publishes from a stale tab are refused with a choice to open the latest version or replace it. The review allows JSON and ID corrections and shows tiers, resources, ranges, achievements, relationships, image references and missing assets.
- Bulk cards accept JSON arrays, or CSV with the columns `id,group,name,shortName,permanentResource,points,cost.<resource-id>` (one cost column per resource).
- Review shows additions and replacements and requires your confirmation before applying anything. Existing IDs replace card data, keeping omitted artwork and metadata; duplicate IDs within a batch are rejected. Small batches can be applied and saved as drafts even while publishing requirements remain. Server validation still blocks invalid versions.
- JSON and CSV imports are limited to 1 MB.

**Export with images** produces a portable ZIP containing `manifest.json` (bundleVersion 1), `content.json` and content-addressed WebP assets. ZIP imports are limited to 64 MB compressed or expanded and 402 entries. Unsafe paths, duplicate entries, malformed images and hash mismatches are rejected, and so are archives whose structure does not add up (entries outside the archive or sharing bytes, sizes that differ from the data, failed checksums, encrypted or ZIP64 archives), before anything is unpacked. A bundle stages valid assets, then opens the same content review. Saved content is never changed by a failed import.

## Secure self-hosting

For an internet-facing instance, follow [the deployment guide](docs/DEPLOYMENT.md).
Run one game process behind an HTTPS/WSS reverse proxy with persistent local storage.
Keep the admin on loopback and reach it through SSH; its fixed request header is a
browser protection, not a password. Never proxy the admin port publicly.

The guide lists request, room and socket limits, exact proxy trust configuration,
health checks, recovery procedures and the supported local/LAN workflow. Production
configuration comes from the process environment; `.env` files are not loaded automatically.

Known limits of this deployment model:

- **One process per data directory.** Rooms live in memory and in local JSON files;
  there is no database, clustering or replication. Rate limits reset on restart.
- **Files, not a database.** Back up `content/`, `assets/` and `rooms/` together,
  with both servers stopped. Uploaded images are never deleted automatically and are
  readable by anyone who knows their URL.
- **Guest sessions.** No accounts, passwords or kick/ban controls; a room code lets
  anyone join a lobby, and session tokens live in the browser's localStorage.
- **No public admin.** The admin has no authentication and must stay on loopback.

## Contributing, support and security

Bug reports, fixes and documentation improvements are welcome; see
[CONTRIBUTING.md](CONTRIBUTING.md). Support is best effort from volunteers, for the
documented setup on Node 22.22.2. Report vulnerabilities privately, as
[SECURITY.md](SECURITY.md) describes, and never post session tokens, private packs
or artwork you cannot share in a public issue.

## Inspiration and independence

Gameplay inspired by Splendor, designed by Marc André and published by Space Cowboys.

Trovekit Game is an independent project and is not affiliated with or endorsed by
Splendor's creators or publishers. It does not include Splendor's logo or artwork.
Content authors must obtain their own rights to any themed text, images and other
assets they distribute; the code license does not license third-party content.
