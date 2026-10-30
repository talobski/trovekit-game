# Contributing to Trovekit Game

Thanks for helping. Bug reports, fixes, tests and documentation improvements are
welcome. For larger changes, such as new mechanics, schema changes or new
dependencies, open an issue first so the approach can be agreed before you build it.

## Development setup

You need Node.js 22.22.2 (`.nvmrc`) on macOS or Linux.

```sh
npm ci
npm run dev      # game on http://localhost:4747
npm run admin    # private admin on http://127.0.0.1:4748
```

A new checkout has no content. Create or import a pack in the admin, or follow the
[first-pack tutorial](docs/CONTENT_PACKS.md). Your local library lives in the
ignored `data/` directory (or `TROVEKIT_DATA`); never commit it.

## Before opening a pull request

Run the checks CI runs:

```sh
npm run release:check
npm run typecheck
npm test
npm run build
npx playwright install chromium   # once
npm run test:e2e
```

The browser suite builds the app and starts its own servers on fresh temporary
libraries, so it never touches your `data/`. It needs OpenSSL for its HTTPS test.
For a focused change you can run one spec while working, for example
`npx playwright test e2e/keyboard.spec.ts`, but run the full suite before asking
for review.

## Guidelines

- **Keep the engine generic.** Player-facing words, names and artwork come from
  content packs. Don't hardcode a theme; see
  [internal terminology](docs/INTERNAL_TERMINOLOGY.md) and
  [architecture](docs/ARCHITECTURE.md).
- **Follow the UI conventions** in the [README](README.md#ui-conventions): shadcn/ui
  components, theme tokens only, keyboard and phone support, no hover-only
  information.
- **Test with fixtures, not real content.** Use the fictional fixtures in `tests/`
  and temporary data directories. Don't add content packs, photos or downloaded
  artwork to the repository.
- **Dependencies.** Add one only when it is clearly needed. After any dependency
  change, run `npm run notices` and commit the updated
  `public/third-party-notices.txt` together with the lockfile.
- **New files.** `npm run release:check` fails for tracked files that are not on
  `scripts/release-allowlist.txt`, and for binaries, private paths or credentials.
  Add new top-level paths to the allowlist in the same pull request.
- **Documentation.** Update the README or `docs/` when behaviour, configuration
  or limits change.

## Licensing of contributions

Trovekit Game is [MIT licensed](LICENSE). By contributing, you agree that your
contribution is provided under the same license and that you have the right to
submit it. Don't include code, text or images you can't license that way.

## Reporting bugs and getting help

Use the issue templates. Include your Node version, operating system, how you run
the servers (development, production, behind a proxy) and the steps to reproduce.
Remove session tokens, room codes of live games, private hostnames and anything
from a pack you can't share publicly.

Support is best effort by volunteers. It covers the documented setup: Node
22.22.2, one game process and one admin process per data directory, and the admin
kept private on loopback. Publicly exposed admins, multi-instance hosting and the
rights to content in your own packs are outside what this project can support.

## Reporting security problems

Don't report vulnerabilities in public issues, pull requests or discussions.
Report them privately through GitHub's private vulnerability reporting, as
[SECURITY.md](SECURITY.md) describes.
