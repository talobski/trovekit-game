/**
 * Game/admin server pairs (admin on port + 1) for specs that change the
 * default version. Public rooms only use the default, so these specs never
 * share a library with others. Seeded pairs start with the Starfall fixture as
 * the default; empty pairs start with nothing installed.
 */
export const ISOLATED_PAIRS = { packs: 5284, labels: 5286, expedition: 5288, lifecycle: 5290, workspace: 5294, races: 5296, creation: 5298, cards: 5302, gameplay: 5304, market: 5306, gameUi: 5308, requirements: 5312 } as const
export const EMPTY_PAIRS = { firstPublish: 5292, firstCreation: 5300 } as const
