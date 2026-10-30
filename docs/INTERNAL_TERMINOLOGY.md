# Internal terminology

The canonical names for Trovekit Game's internal identifiers (Schema v2). Internal
identifiers describe **game mechanics**; themed game vocabulary comes from the
content pack's `labels`, resource kinds, card groups and achievements. The engine,
server, bots, admin and UI never use a theme's vocabulary, and no code branches
on a pack's id or on any id a pack defines.

## The game in mechanical terms

Players **collect** resources from a shared supply, **reserve** a card to hold it
for later (taking a wildcard if one is left), or **acquire** a card by paying its
cost. Every acquired card gives a **permanent resource**: one unit of its resource
kind that lowers the cost of every later acquisition and is never spent. Cards and
achievements give **points**; reaching the target starts the final round.

## Core concepts

| Identifier | Meaning | Player-facing word comes from |
| --- | --- | --- |
| `resource`, `resources` | Consumable units of one of five **resource kinds**, held by players and the supply, spent to acquire cards | `labels.resource` / `labels.resources`, and each kind's `label` |
| `ResourceKind` (`id`, `label`, `tone`, `icon`) | One of exactly five kinds. `tone` is a named theme colour, `icon` a named glyph | `label`; `tone` and `icon` are presentation |
| `ResourceCounts` | A count per resource kind id | — |
| `wildcard`, `wildcards` | Units that count as any kind when paying; held, never permanent | `labels.wildcard` / `labels.wildcards` |
| `supply` | The shared pool: `supply.resources` and `supply.wildcards` | — |
| `card` | A collectible with a `group`, `cost`, `permanentResource` and `points` | `labels.card` / `labels.cards` (optional; default "Card" / "Cards") |
| `card.permanentResource` | The resource kind the card permanently contributes once acquired. Contributions reduce future acquisition costs and are never spent | the kind's `label` |
| `permanentResources(ctx, player)` | A player's permanent contribution per kind (one per acquired card) | — |
| `card group` (`tiered` or `unique`) | A deck with face-up market slots; tiered cards can be reserved | each group's `label` |
| `market`, `deck` | Face-up slots per group, and the face-down remainder | — |
| `reserved` | A player's held cards, acquirable later | `labels.reserved` |
| `acquired` | A player's acquired cards | `labels.acquired` |
| `collection` | A player's whole area (acquired cards, reserved cards, holdings) | `labels.collection` |
| `points` | Victory points from acquired cards and claimed achievements | `labels.points` |
| `achievement`, `achievement category` | Shared goals with declarative requirements; first to qualify claims | each achievement's `name`, `labels.achievements` |
| `relationship` | 2 or 3 tiered cards that belong together, used by requirements | each relationship's `label` |

## Actions

| Action (`type`) | What it does | Label (verb) | Past-tense label |
| --- | --- | --- | --- |
| `collect` | Take resources from the supply (`take: ResourceCounts`) | `labels.collect` | `labels.collected` |
| `reserve` | Hold a face-up tiered card; take wildcards (`rules.wildcardsOnReserve`) | `labels.reserve` | `labels.reserved` |
| `acquire` | Pay for a market or reserved card (`wildcards` may allocate wildcards per kind) | `labels.acquire` | `labels.acquired` |
| `pass` | Only when no other action is legal | — | — |

Any action may carry a `discard` (`{ resources?, wildcards? }`) when it would put
the player over `rules.holdingCap`. Log entries use the same names: `collect`,
`reserve`, `acquire`, `discard`, `claim`, `pass`, `final-round`, `finish`.

Error codes are mechanical too, for example `INVALID_COLLECT`, `RESERVE_FULL`,
`CANNOT_AFFORD`, `UNIQUE_LIMIT`.

## Engine functions

`setupGame`, `applyAction`, `checkCollect`, `canCollect`, `canReserveAny`,
`canAcquire`, `canAcquireAny`, `hasLegalAction`, `permanentResources`, `points`,
`dueCost`, `resolvePayment`, `heldTotal`, `rank`, `projectGame`.

## Rules (`rules.json`, schema version 2)

| Field | Meaning |
| --- | --- |
| `playerCounts` | Minimum and maximum players (2–4) |
| `resourceSupply` | Resources per kind in the supply, by player count |
| `wildcardSupply` | Wildcards in the supply |
| `startingResources` | Resources per kind each player starts with |
| `collect` | `distinct` (different kinds taken at once), `pair` (same-kind amount), `pairMinSupply`, `allowPartialDistinct` |
| `holdingCap` | Most resources plus wildcards a player may hold |
| `reserveCap` | Most reserved cards |
| `wildcardsOnReserve` | Wildcards taken with each reserve |
| `market` | `tieredSlots`, `uniqueSlots` |
| `uniqueLimitPerPlayer` | Most unique-group cards per player |
| `achievementsDrawn` | Achievements in play, by player count |
| `targetPoints` | Points that start the final round |
| `tieBreak` | `fewest-acquired` (points, then fewest acquired cards, then shared) or `shared` |

## Pack labels (`pack.labels`)

| Key | Role | Blank template |
| --- | --- | --- |
| `game` | Game title | the pack name |
| `collect` | Collect action (verb) | Collect {label:resources} |
| `collected` | Collect action, past tense (activity log) | Collected {label:resources} |
| `reserve` | Reserve action (verb) | Reserve |
| `acquire` | Acquire action (verb) | Acquire |
| `resource` / `resources` | Resource unit, one / many | Resource / Resources |
| `wildcard` / `wildcards` | Wildcard, one / many | Wildcard / Wildcards |
| `reserved` | Reserved area, and the reserve action in the past tense | Reserved |
| `acquired` | Acquired area, and the acquire action in the past tense | Acquired |
| `points` | Points | Points |
| `collection` | A player's area | Collection |
| `achievements` | Achievements | Achievements |
| `card` / `cards` | Optional noun for the collectible cards | Card / Cards |

Labels may reference other labels with placeholders, for example
`"collect": "Collect {label:resources}"` (stored up to 40 characters; the
text players see after resolving must fit in 32). A fantasy pack might use
`collect: "Gather {label:resources}"`, `collected: "Gathered {label:resources}"`,
`acquire: "Learn"`, `acquired: "Learned"`, `resources: "Motes"`,
`points: "Renown"`, `collection: "Academy"`, `card: "Spell"`.

## Placeholders in pack text

Achievement descriptions (and the `collect` / `collected` labels) can name pack
words by id, so renaming a label updates every sentence:

- `{group:<cardGroup id>}` → the group's label
- `{kind:<resourceKind id>}` → the kind's label
- `{label:<labels key>}` → a label, e.g. `{label:acquire}`, `{label:cards}`

Placeholders resolve for display only; stored text and the content hash never change.

## Achievement requirements (`requirement.type`)

| Type | Fields | Counts |
| --- | --- | --- |
| `cardCount` | `min`, `groups?`, `permanentResource?` | Acquired cards (tiered unless `groups` is set), optionally only those with that permanent resource |
| `distinctPermanentResources` | `min`, `groups?` | Different permanent resources among acquired cards |
| `relationships` | `min`, `size?`, `disjoint?` | Completed relationships |
| `claimedCategory` | `category`, `min` | Achievements already claimed in a category |
| `all`, `any` | `of` | Combinations |

## Presentation

| Identifier | Meaning |
| --- | --- |
| `resourceArt` | Optional uploaded picture for the resources as a whole (`src`, `alt`) |
| `icon` (pack) | Optional icon from `RESOURCE_ICONS` shown beside the game title (`labels.game`) on the home page and in rooms; absent shows the title alone |
| `packBrand` | How the public game names a pack: its `labels.game` and `icon`; a room always uses its own pinned version's |
| `ResourceDisc`, `ResourceCount` | A kind's tone disc with its icon; with a count |
| `RESOURCE_ICONS` | The named glyphs a resource kind may use (`circle`, `flame`, `gem`, …), in `src/engine/icons.ts`; each kind must use a different one, and `sparkle` is reserved for wildcards |
| `TONES` | The named theme colours a resource kind may use |
| `PlayerCollection` | The UI panel for one player's collection |

## Formats and versions

- `PACK_SCHEMA_VERSION = 2`, `RULES_SCHEMA_VERSION = 2`. Version 1 content is not
  accepted; there is no converter.
- Saved rooms carry `formatVersion: 2` (`ROOM_FORMAT_VERSION` in `server/rooms.ts`). Rooms in any other
  format are skipped when the server loads, never run by the engine, and left on
  disk untouched.
- Bundles (`manifest.json`, `bundleVersion: 1`) are unchanged; their content must
  be Schema v2.

## Words that are not game vocabulary

- `token` on the server and in the client means a **session token** (room
  authentication: `token`, `tokenHash`, `hashToken`). It is unrelated to resources.
- `draft` in the admin and content store means an **unsaved pack edit**
  (`saveDraft`, `DraftSchema`, `draft-<id>.json`). It is unrelated to reserving.
