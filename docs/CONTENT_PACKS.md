# Create your first content pack

A pack changes the game's theme without modifying its engine. Names, action words,
resource identities, card artwork, relationships, achievements and supported
balance settings are data. The turn sequence, payment system, actions and allowed
achievement predicates remain those implemented by Schema v2. Packs cannot run
scripts or invent new mechanics.

## Start with an empty library

Use Node 22.22.2, run `npm ci`, then start `npm run dev` and `npm run admin` in
separate terminals. Open the private admin at `http://127.0.0.1:4748`.
The game at `http://localhost:4747` says **No game available yet**. This is expected.
For a remote host, use the [SSH tunnel](DEPLOYMENT.md#private-admin-through-ssh).
Never expose the content editor publicly.

The admin has a sidebar: **Library**, then every installed pack. Selecting a pack
opens its workspace: **Overview**, **Cards**, **Resources**, **Rules**,
**Achievements**, **Relationships**, **Versions**, **Preview** and **Settings**.
Each page has its own address (for example `#/packs/garden-guild/cards`), so
Back, Forward, refresh and bookmarks work. On phones the sidebar opens from the
menu button.

1. On the empty library, choose **Create pack** (later packs start from **New pack**
   in the sidebar or the library). The creation page (`#/new`) replaces the sidebar
   with a short header and **Back to Library**. Enter **Pack name**, such as
   `Garden Guild`, and optionally **Describe your game**. Then either:
   - **Copy AI prompt**: paste it into any AI assistant. The assistant first acts as
     a game designer: it explains how Trovekit plays, asks a few questions at a time
     about what your name and description leave open (theme, what the cards are,
     the five resources, tiers and card count, achievements, relationships, pacing),
     suggests options and takes "Surprise me" or "Use your recommendations". It then
     summarizes a design for you to approve. Only after you approve, or tell it to
     go ahead, does it write the pack, following the full-pack requirements with
     this pack's ID and name, the blank template and the content schema. Save that
     file as `.json` and choose **Import pack file**
     (any JSON or ZIP pack file works, with or without copying first). The import review
     summarizes the pack: name, description, cards per tier, resources, achievements,
     relationships and any warnings, with the JSON under **View technical details**.
     **Import** saves it as a draft and opens its workspace; nothing is published or
     made the default. If saving fails, the review stays open to try again. If the file
     names the pack differently, the review says so and the file's name is used.
     If its ID is already installed, you choose between updating that pack and
     creating a separate pack, which takes the name you entered.
   - **Create manually instead** to save an empty draft right away.

   Visiting the page, typing and copying save nothing. For a manual pack the server creates `garden-guild` automatically, or `garden-guild-2` if already
   used. Accents are normalized; names without Latin letters or digits use `pack`
   with the same collision handling. IDs stay fixed when a pack is renamed. The pack
   starts from generic rules and a blank template, is saved as a draft, and opens on
   its **Overview**. Until its first version is published, Overview shows a setup
   checklist (resources, card groups, cards, rules and achievements, then publish).
   Each step reflects the pack's actual data and validation, not which pages you
   visited, and links to the page that fixes it. Work in any order and save the
   draft at any point; the blank template's generic settings are valid as they are.
2. In **Settings**, set the theme's labels under **Terminology**: for example resources → Seeds, acquire → Grow,
   acquired → Grown, collection → Garden. The collect label can be
   `Gather {label:resources}`. Plain UI controls such as Join are application
   copy; packs customize the schema's named game labels, not all interface text.
3. In **Resources**, rename the five resource kinds and choose a different allowed icon for each.
   Choose named tones from the palette. Keep stable IDs when possible: card
   costs and requirements refer to IDs, not labels. An optional resource picture
   provides a shared background; it does not replace resource identity icons.
4. In **Cards**, configure the three tiered card groups and their cost/point ranges, then copy the
   prompt for your AI assistant, prepare a JSON or CSV file, then **Import cards**.
   Review the batch before applying it; select individual cards to refine them.
   Each card needs a unique ID/name, group, cost, permanent resource and points
   within its group's ranges. Deck sizes follow the cards you add. Each group's `deckSize` must equal its
   number of cards. Match the validator's deck/market requirements. Keep the
   supplied balance initially and use enough cards for a full game.
5. Add achievement categories and achievements. Requirements may count cards,
   distinct permanent resources, completed relationships or earlier category
   claims, combined with `all`/`any`. Supply enough achievable goals for each
   supported player count. Relationships connect two or three existing tiered
   cards. The editor reports broken references or unattainable simple counts.
6. **Save draft** in the toolbar while incomplete, including with no cards.
   The draft stays private. **Review requirements** beside **Publish version** explains
   publishing blockers and links to the relevant editor. Technical details remain
   available, but an empty draft is normal progress rather than an error. Validation checks structure/references; it does not prove the
   theme is balanced, fun, factually correct or legally licensed.
7. In the editor toolbar, **Publish version** publishes a valid, immutable snapshot
   to this server's library. Publishing does not change what players get: choose
   **Make default** (offered right after publishing, and in **Versions**) when new
   rooms should use it. Here “publish” means available on your instance, not
   uploaded to a marketplace or GitHub. No external service is involved.
8. Open the game, create a room and invite friends. Every new room uses the
   default version, and keeps that exact version even if you later change the
   default. Add a bot in the lobby for
   solo testing. Test complete games with 2–4 players before sharing the pack.

See [terminology and schema fields](INTERNAL_TERMINOLOGY.md) for exact names and
supported rules. Existing started games retain their own pack/rules snapshot;
editing a pack never rewrites a running game.

## Drafts, versions and the default

Each pack has three separate kinds of state:

| State | What it is | Changed by |
| --- | --- | --- |
| **Draft** | Your unfinished work. One per pack, private, may be incomplete | **Save draft** |
| **Published versions** | Immutable snapshots. The newest is the pack's **latest published** version | **Publish version** |
| **Default** | The one version new rooms use, across the whole library | **Make default** |

- **Publish version** creates a new version and makes it the pack's latest. It
  never changes the default. Unsaved editor changes are saved to the draft first;
  the draft is then cleared because it was exactly what you published. A draft
  that differs from what was published (for example one saved in another tab)
  is kept.
- **Make default** asks for confirmation, then points new rooms at that version.
  Making an older version the default is a rollback: it does not move the latest
  published pointer, touch any draft, or unarchive anything.
- The editor opens a pack's draft if it has one, otherwise its latest published
  version. Reloading the admin reopens the pack you were last editing.
- Archived packs keep their drafts, versions and rooms, but none of their versions
  can be made the default until the pack is restored.

The **Library** shows each pack's ID, whether it has an unpublished draft, its
latest published version, and a **Default** marker when new rooms use one of its
versions (including an older one). Above the list it says which version new rooms
use, or that no default is set yet. Each pack offers **Continue draft** (or
**Edit**), **Versions**, **Make default** for its latest version, and **Archive**.
**Versions** lists the selected pack's history, marks **Latest** and
**Default**, and compares the editor with that pack's own versions.

After a pack's first published version, its **Overview** shows its status
instead of the setup checklist: unsaved editor changes, the saved draft, the
latest published version (with a link to its history), which version new rooms
use, and anything to fix before publishing. Saving a new draft later never brings
the checklist back. **Save draft** and **Publish version** stay in the header on
every page of the workspace. **Preview** shows the pack's resources, cards by
group and achievements as players see them.

Unsaved changes stay in the editor while you move between a pack's pages or to
the library. Opening another pack (from the sidebar, the library, Back or Forward,
creating or importing a pack) first asks you to **Save draft**, **Discard
changes** or **Cancel**. If saving fails, you stay on the pack with your changes.
Closing or reloading the window with unsaved changes asks the browser to confirm.
A link to a pack that is not in the library, or that cannot be read, returns to
the library with a message.

Version numbers (`pack.version`, for example `1.2.0`) stay manual. Publishing a
number that the pack has already published shows a warning but is allowed;
change the number in **Settings** so the two can be told apart.

### Two tabs, one draft

Every save and publish carries the revision the editor loaded. If the pack
changed since then (another tab or window saved or published), nothing is saved
and the admin offers **Open latest** (discarding your unsaved changes) or
**Replace with mine** (an explicit overwrite). **Cancel** keeps your changes in
the editor so you can export them first.

### Importing a pack that is already in the library

If an imported JSON or ZIP pack uses an ID the library already has, the admin
asks before doing anything: **Update** that pack (the import is saved as its
draft, replacing any previous draft; published versions are kept), or **Create
separate pack** (saved as a new draft with a new ID). Unsaved changes in the
editor are confirmed first. If the pack's draft was saved in another tab or window
since you opened it, Update says so and replaces it only when chosen again.
Packs with new IDs are saved as new drafts. Either way the pack then opens.

### What players can choose

Players never pick a pack or version. Every new room uses the current default
and is pinned to that exact version when it is created: joining, adding bots,
starting, server restarts and reconnects all keep it, even if the default
changes or the pack is archived. The public `GET /api/packs` lists only the
default, and `POST /api/rooms` accepts no other version (`400 INVALID_PACK`).
With no default set, rooms cannot be created (`409 NO_CONTENT`).

Waiting rooms saved before rooms were pinned (no `selectedVersion`) are never
moved to the current default. They show **This room cannot start** with a
request to create a new room; players can still leave them. Games that had
already started keep their own snapshot and are unaffected.

### Test an unreleased version privately

Published but non-default versions are not playable on your public instance.
To playtest one, run a second, isolated instance on its own data directory and
ports, import the pack there and make it the default:

```sh
HOST=127.0.0.1 TROVEKIT_DATA=~/trovekit-playtest PORT=5747 npm run dev
TROVEKIT_DATA=~/trovekit-playtest ADMIN_PORT=5748 npm run admin
```

`HOST=127.0.0.1` keeps the playtest game reachable from this computer only
(the game server otherwise listens on all interfaces; the admin always binds to
`127.0.0.1`). Play it at `http://127.0.0.1:5747`.

In your main admin choose **Export with images**; in the playtest admin
(`http://127.0.0.1:5748`) choose **Import**, then publish and **Make default**.
The playtest library never touches your real one. Expand `~` in the shell (as
above) rather than quoting it.

### Admin API behaviour

The admin API (`/admin-api/...`, localhost only, `X-Trovekit-Admin: 1`) follows
the same rules:

- `POST /admin-api/versions` with `{ content, note, revision? }` publishes and
  returns `201 { ok, version, draftCleared }`. It never changes the default. The
  former `activate` field is refused when `true`
  (`400 ACTIVATE_SEPARATELY`) so older scripts fail loudly instead of silently
  publishing without activating; `false` or omitted is accepted.
- `POST /admin-api/active` with `{ id }` makes a published version the default.
  Unknown versions return `404`; versions of an archived pack return
  `409 PACK_ARCHIVED`.
- `GET /admin-api/drafts/<pack id>` returns the pack's head:
  `{ content, revision, source: "draft" | "published", versionId }`.
- `POST /admin-api/drafts` with `{ content, revision }` saves the draft over the
  revision the editor loaded, `{ content, create: true }` saves a new pack, and
  `{ name, create: true }` creates one from the blank template.

## Batch authoring and import review

For full-pack files, the creation page's **Advanced tools** offer the **Schema
reference** (**Download schema**), the **Blank pack template** (**Download
template**) and the **Import format guide** (**View guide**), which explains JSON
files, ZIP archives with artwork, the import review and card batches. A full
file contains `{ "pack": { ... }, "rules": { ... } }`, with `schemaVersion: 2`
in both objects. Schema v1 is not accepted and has no automatic converter.
**Copy AI prompt** on the same page supplies the instructions for a complete pack,
with the schema and template included. Trovekit Game does not call an AI service. Review generated text and rights yourself.

**Import pack** (Library) or **Import pack file** (a pack's Settings) accepts JSON
or ZIP and opens a review; **Import** saves the pack as a draft. A pack's **Settings** also
has **Export JSON**, **Export with images**, the **Card-ID manifest**, **Duplicate
pack** and **Archive pack**. If the pack ID already exists you choose between updating that pack and
creating a separate one (see above). Correct IDs/references in the review's technical details and inspect the resulting validation
messages. An import is not automatically a published version.

**Cards → Generate cards with AI** copies a prompt that reflects the current pack
configuration, including Schema v2 card fields, resource and group IDs, rules,
achievements, relationships and existing cards. The assistant first asks what to
add and to which groups, explains how cards work in your pack and recommends from
what is there, then proposes a plan (cards per group, subjects, resources, cost and
points, achievements helped). It writes the batch, as JSON unless you ask for CSV,
only after you approve. Configure Resources and card groups first, and recopy the
prompt whenever settings change. **View prompt and example** lets you select the
prompt manually if clipboard access is unavailable, or download a small example batch. No cards are installed
automatically; the example is not a complete playable pack.

Save the assistant's output without Markdown fences, then choose **Import cards**
on the Cards page. It accepts a JSON array or CSV. Use columns
`id,group,name,shortName,permanentResource,points,cost.<resource-id>` with a cost
column for each kind (omitted costs are zero). ID, group, name, permanentResource
and points columns are required. Existing IDs update cards and preserve artwork
and metadata if omitted; new IDs add cards. Duplicate IDs within a batch are rejected. JSON/CSV uploads are limited to
1 MB. Row/field errors explain what to correct before importing again.

Review additions, replacement IDs and publishing requirements, then explicitly
confirm **Apply to editor**. Cancel leaves the editor unchanged. Small, structurally
valid batches can be applied to a draft before achievements or other publishing
requirements are satisfied. Select a card to correct it, or use **Edit import JSON**
in the review for advanced corrections. Save draft persists your work; only
**Publish version** publishes, after server validation. Full-pack imports continue
to require valid content before applying. Use the card-ID manifest in Settings to
name artwork files consistently.

### Card image ZIPs

**Cards → Get images with AI** copies a prompt for the cards without artwork (by
default), all cards, or one group. It lists each card's name and exact ID and asks
the assistant to find existing images, check each source's reuse terms, and return
a ZIP; original AI artwork only on request, after it explains the cost and you
approve. **Import images** reads the ZIP directly:

- Images named `<card id>.jpg`, `.jpeg`, `.png` or `.webp` (the extension must
  match the real format), all at the top level or all in one folder. JPEG, PNG or
  WebP stills, 64–8000 pixels per side, at most 20 megapixels and 8 MB each; at
  most 400 images and 64 MB per ZIP, unpacked or not. Each is cropped to 4:5 and
  stored as a 480 × 600 WebP, like a single upload.
- An optional `trovekit-images.json` source list beside them:

  ```json
  {
    "format": "trovekit-card-images",
    "version": 1,
    "images": [
      { "cardId": "aria-ashgrove", "file": "aria-ashgrove.jpg",
        "source": "https://…", "creator": "Jane Smith", "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "Photo by Jane Smith", "modifications": "Cropped and resized",
        "restrictions": "…", "alt": "…" }
    ]
  }
  ```

  Only `cardId` is required. If an entry names a `file`, it must be that card's
  image in the ZIP (same name and format); otherwise its details are left out
  and the image imports without them. Each entry fills the card artwork's existing source,
  creator, license, license URL, attribution, restrictions and alt text fields;
  `modifications` is kept with the attribution as "Changes: …", since licenses such
  as CC BY ask for it there. Bad entries are listed in the review and left out;
  their images import without details.
- Paths with `..`, absolute paths, nested folders, a second source list or a
  complete pack bundle (`content.json`/`manifest.json`) are refused; other files
  are listed and skipped. The ZIP's structure is checked before anything is
  unpacked: every entry must sit inside the archive, entries may not share bytes,
  stored entries must state one size, and encrypted, split or ZIP64 archives are
  refused. Sizes and counts are then checked, and an entry that unpacks to more or
  less than it states, or fails its checksum, refuses the whole ZIP.

The review shows each file's card, whether it matched, and its reported source and
license. Applying never touches cards whose artwork changed after the import
started, and replacing existing images still needs **Replace existing images in
this batch**. A replaced image takes only its own details; nothing from the previous
image is kept.

## Artwork and rights

Upload supported raster images through the private admin. Images are normalized
to content-addressed WebP. Packs reference managed paths; remote images, embedded
base64 and SVG uploads are not allowed. The Starfall tests generate geometric SVG
locally and convert it to raster before upload; that is test tooling, not an SVG
upload feature.

For card art, record the source, creator, license, license URL, attribution and
restrictions where applicable. Details imported from a source list are what the
assistant reported, not verified permission: confirm them before you publish. In
the game, the credit (creator, source link, license with its link, and the full
attribution text) appears at the bottom of a card's details, never on the card face. Use original artwork or material you have explicit
rights to redistribute. An AI-generated picture is not automatically cleared of
third-party rights. Do not invent license claims. Keep a separate rights manifest
for resource artwork, which has no full per-image provenance fields in Schema v2.

Assets are readable by anyone with their URL, including staged images; “private
admin” does not mean private image storage. Do not upload sensitive images.

## Export and share

The toolbar’s **Export** saves the content data. It does not include image bytes.
**Export with images** creates a ZIP with `content.json`, `manifest.json` and
managed WebP assets. ZIP import allows at most 64 MB compressed/expanded and
402 entries; invalid paths, duplicate entries and mismatched hashes are rejected.
Do not hand-edit hashed image paths. Share and import the ZIP exactly as
exported: extracting it and compressing it again with Finder or `zip` adds
folder entries (such as `assets/`), and the import refuses those. To change a
pack, import it, edit it in the admin and export it again. Import the export
into a separate test library and play a game to verify portability.

Choose and document a license for your own pack text/art separately from the
application's code license. Include any required third-party credits/license
texts alongside the bundle; do not add unknown top-level schema fields or arbitrary
extra ZIP entries. The bundle format has no general license-file attachment area.
An import validator cannot grant redistribution rights.

Archiving keeps a pack's draft, versions and saved games, but none of its
versions can be made the default until you restore it. Make another version the
default before archiving the pack that has the current default. Rooms already
created on an archived pack keep working. Artwork is retained;
archiving is not revocation of previously shared or cached image URLs.

## Test fixtures

`tests/fixtures/starfall.json` is a fictional example used by automated tests;
`tests/fixtures/starfall.ts` creates its geometric art. `tests/fixtures.ts` contains
a compact generic fixture. They demonstrate the schema but are never installed
in a normal library. `npm run test:e2e` seeds only fresh temporary directories.
Do not run the test seeder against a real library.
