# Releasing a source snapshot

The product name is **Trovekit Game**. The public repository is named
`trovekit-game` and belongs to the maintainer's personal GitHub account; the npm
package name in `package.json` is also `trovekit-game`.
The public description is: “An open-source card strategy game you can make your own.”
Releases are source snapshots. The package is private and is not published to a
registry, and no Docker image, executable or preinstalled bundle is produced.

## Name check

An initial name search on 2026-10-11 found existing software using TroveKit:
[an offline toolbox repository](https://github.com/1595901624/TroveKit),
[a desktop product site](https://trovekit.app/en), and
[an ecommerce product site](https://trovekit.shop/).
**Trovekit Game** was chosen as the product name to distinguish this project.
Whether `trovekit-game` is free under the maintainer's account is checked when the
repository is created. No trademark search or legal clearance is claimed.

## What a release contains

Only files **tracked in the release commit** and listed in
[`scripts/release-allowlist.txt`](../scripts/release-allowlist.txt) are released:
source, configuration, the generic rules and blank template in `content/`, tests and
their fictional fixtures, development scripts, documentation (including
`SECURITY.md` and `CONTRIBUTING.md`), GitHub workflows and templates, the favicon
and the third-party notices. There is no default content pack.

Never released, because they are ignored or untracked: `data/` or any custom
library path (packs, versions, rooms, uploaded artwork), `.env*` files and other
credentials, `node_modules/`, `dist/`, test reports, screenshots and recordings,
local notes and archives, and the development repository's Git history.

`npm run release:check` checks HEAD and fails when a tracked file:

- is not on the allowlist (review it, then add it);
- is a binary, archive, image, font or key file, or is larger than 1 MB;
- contains a private home directory, a local checkout path, a private-tracker
  reference, a private key or a recognisable access token.

CI runs this check on every push and pull request. It is a guard, not a full
secret scanner: review new files and dependency notices before each release.

## Making a snapshot

Commit everything first; the snapshot is built from a commit, not the working tree.

```sh
npm run release:snapshot -- ../trovekit-game-release        # HEAD
npm run release:snapshot -- ../trovekit-game-release v1.0.0 # any commit or tag
```

The output directory must be outside the repository. It receives:

- `trovekit-game-<commit>.tar`: the allowlisted files under `trovekit-game/`,
  written by `git archive`, so the same commit always produces identical bytes;
- `trovekit-game-<commit>.manifest.txt`: the commit, the archive's SHA-256 and the
  SHA-256 of every file.

## Verifying a snapshot

Verify the extracted archive, not the development checkout, with Node 22.22.2:

```sh
mkdir -p /tmp/trovekit-verify && tar -xf trovekit-game-<commit>.tar -C /tmp/trovekit-verify
cd /tmp/trovekit-verify/trovekit-game
npm ci
npx playwright install chromium
npm run typecheck && npm test && npm run build && npm run test:e2e
```

The browser suite creates its own temporary libraries, including an empty one.
Then start the production servers with a new, empty `TROVEKIT_DATA` directory and
walk through the [first run](../README.md#first-run-an-empty-library): create or
import a pack, publish it, make it the default, play a room with a second browser
or a bot, restart both servers and reconnect. Check that the admin answers only on
127.0.0.1. Refresh notices with `npm run notices` after any dependency change and
review the diff.

## Publishing as a fresh repository

The public repository starts with **one initial commit** made from an approved
snapshot. It has **fresh Git history**: the development repository and its
complete history stay private and unchanged, and are never pushed, merged into or
rewritten for publication. Publishing needs the maintainer's explicit approval of
a specific snapshot, identified by its commit and archive SHA-256.

1. **Create the snapshot** of the approved commit and check its manifest against
   the approved archive SHA-256.
2. **Make the initial commit**, outside the development repository. Use the
   maintainer's GitHub identity or its `noreply` address; the placeholders below
   are not real values.

   ```sh
   mkdir trovekit-game-public && cd trovekit-game-public
   tar -xf ../trovekit-game-release/trovekit-game-<commit>.tar --strip-components=1
   git init -b main
   git add -A
   git -c user.name="<maintainer name>" -c user.email="<maintainer GitHub noreply address>" \
     commit -m "Initial public release"
   git ls-files | sort > ../published-files.txt
   ```

   Compare `published-files.txt` with the manifest's paths. Check that
   `git log` shows exactly one commit, `git status` is clean, and no `data/`,
   `node_modules/`, `dist/` or `.env` exists.
3. **Create the repository** `trovekit-game` under the maintainer's personal
   GitHub account (`<your-account>/trovekit-game`), empty: no README, license or
   `.gitignore` generated by GitHub. Choose private visibility first if you want
   to see CI pass before anyone else can see the code.
4. **Push** `main` to it as `origin`. Push nothing from the development repository.
5. **Confirm the first CI run.** Both jobs (checks, and the Chromium browser
   suite) must pass on GitHub before release sign-off. If a job fails, fix the
   development repository, make a new snapshot and start again from step 1 rather
   than adding fix-up commits to the public history before sign-off.
6. **Make the repository public** once CI has passed.
7. **Enable the security settings straight away** (Settings → Code security, and
   Settings → Rules or Branches). Private vulnerability reporting is offered for
   public repositories, which is why this follows step 6:
   - **Private vulnerability reporting.** `SECURITY.md` tells reporters to use
     **Security → Report a vulnerability**, which only exists once this is on.
     Check that the button appears.
   - Dependabot alerts and security updates (`.github/dependabot.yml` already
     schedules version updates).
   - Branch protection or a ruleset for `main` that requires the CI checks.
