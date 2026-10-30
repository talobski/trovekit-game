# Licensing and distribution review

Project-owned code, documentation, original fixtures and authorized theme output
are licensed under [MIT](../LICENSE), copyright **2026 Trovekit Contributors**.
The owner explicitly authorized this public holder label and the MIT grant for
their original contributions and existing generated theme output on 2026-10-11.
Third-party components and assets retain their own licenses; MIT does not override
the notices below. This is a source/provenance review, not trademark clearance.

## Release inventory and provenance

| Material | Evidence and treatment |
| --- | --- |
| Engine, server, app, documentation and tests | Project-developed source covered by the owner-authorized MIT grant. |
| `src/components/ui/`, composed components and hooks | Adapted shadcn/ui patterns and project modifications. Retain the upstream shadcn MIT copyright/permission text in `licenses/upstream/shadcn-ui.txt` and the distribution notices. Generating/copying a component does not remove its upstream license. |
| `src/styles/theme.css` | Header identifies `@personal-ui/core` generator, revision 18. The local renderer was inspected: it emits token declarations, font/radius/shadow mappings and utilities. The owner explicitly confirmed control of the original generator work and authorized this existing output under MIT. Header preserved; the generator source/package remains private and is not copied or required to run Trovekit Game. |
| `src/styles/semantic.css`, other styling | Owner-authorized project adaptations; theme values retained. |
| Radix, React, Recharts, cmdk, Vaul, Sonner and supporting libraries | Installed package license texts retained in `public/third-party-notices.txt`; most use MIT. These are dependencies, not project-owned code. |
| Lucide icons | ISC plus MIT notices for Feather-derived icons; both included from the installed Lucide license. |
| Inter and Space Grotesk | SIL Open Font License 1.1, with each font's copyright notice retained. Fonts are unmodified; the project's MIT license must not be presented as their license. |
| class-variance-authority, Sharp and development tools | Include Apache notices where supplied; other tool licenses include MIT, BSD, ISC, 0BSD and MPL. Tool inclusion here does not mean it is shipped in the browser. |
| `tests/fixtures.ts`, `tests/fixtures/starfall.json` and `.ts` | Fictional test data and programmatic geometric artwork; no downloaded player photographs. SVG paths, gradients and shapes are generated locally, not by an image service. The source and introduction history identify them as original project fixtures. The audit found no imported artwork or external source payload; they are included under the original-contribution MIT grant. They remain test-only, never installed automatically. |
| `public/favicon.svg`, typographic identity | Simple geometric letter T created for this project; no game publisher logo/artwork. |
| Historical screenshots/reports | Excluded from tracked release files and preserved in the ignored private archive. Not licensed or redistributed as part of this source snapshot. |
| Operator-created content packs | Separately licensed by their authors. The code license grants no rights to uploaded images, names, third-party artwork, trademarks or externally supplied content. |

## Notices included

`public/third-party-notices.txt` contains full license texts and supplied notices
(with line endings and trailing whitespace normalized)
for the installed lockfile-matched package set, plus shadcn/ui. Vite copies this
file into `dist/`, so it accompanies browser distributions and is available at
`/third-party-notices.txt`. Keep it with both source and compiled browser files.
The file deliberately includes some development/server licenses beyond the
browser bundle to avoid dropping relevant notices.

Refresh after dependency changes with:

```sh
npm run notices
```

The script checks installed versions against the lockfile, preserves nested
vendored notices (including D3 dependencies), and fails on missing texts rather
than silently assuming a license. It reads local dependency packages and writes
only the notice artifact. Review the diff before committing. Optional packages
vary by target platform; review any new/missing package when generating elsewhere.
This is a notice collector, not a general license-compliance certification.

Upstream supplemental texts fetched on 2026-10-11:

- [shadcn/ui MIT](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md)
- [react-remove-scroll-bar MIT](https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE)
- [std-env MIT](https://github.com/unjs/std-env/blob/main/LICENCE)
- [Victory MIT](https://github.com/FormidableLabs/victory/blob/main/LICENSE.txt), alongside the installed vendor subdirectory licenses

These texts are checked in under `licenses/upstream/`; refresh requires human
review of provenance, versions and changed notices. The installed license texts
are authoritative for the installed dependency versions.

## Native binaries and future artifacts

The proposed source snapshot excludes `node_modules`, build output and packaged
native binaries. `npm ci` obtains dependencies separately. Sharp's native libvips
packages have LGPL terms and bundled libraries with additional licenses; they
are **not covered by the project MIT license**. Before distributing a Docker
image, executable, dependency archive or preinstalled server bundle, audit the
exact target's native components, include corresponding licenses/notices and
satisfy applicable source/relinking requirements. The project publishes no such
artifact. MPL-licensed tools likewise retain their own
file-level obligations if distributed or modified.

## Review findings and remaining boundaries

The Starfall fixture was introduced as original project test content. Its JSON
contains fictional students, elements and original-fiction relationship notes;
its generator defines gradients, rings and geometric paths locally. The compact
Gem Guild fixture is algorithmic test data. The tests use no bundled photos or
image-service output. Source/history inspection found no additional third-party
asset attribution requirements for these fixtures; this is not an exhaustive
external plagiarism search or a claim of exclusive rights to generic names/shapes.

Copied/generated shadcn components remain third-party MIT material, with upstream
notices retained rather than attributed solely to Trovekit Contributors. Generated
CSS does not embed or require the private generator package. Runtime font binaries
remain OFL, and dependency license terms survive compilation/bundling.

No unresolved source-license blocker was identified after the owner's confirmations
and this review. Public-name clearance remains open (see [release preparation](RELEASE.md)).
Native packaged releases require the separate review above. New packs and future
contributions still require their own rights review; the application does not
validate legal permissions and cannot certify externally supplied content.
