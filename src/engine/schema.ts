import { z } from "zod"
import { RESOURCE_ICONS } from "./icons"

export { RESOURCE_ICONS, type ResourceIcon } from "./icons"

/*
 * Content pack and rules schemas. Everything here is data only: closed object
 * shapes (unknown keys are rejected), bounded numbers, plain-text strings and a
 * closed set of declarative predicates. No expressions, scripts or remote URLs.
 */

/** Schema v2: mechanical identifiers throughout (see docs/INTERNAL_TERMINOLOGY.md). Version 1 content is not accepted. */
export const PACK_SCHEMA_VERSION = 2
export const RULES_SCHEMA_VERSION = 2
export const RESOURCE_KIND_COUNT = 5

/** Tones a pack may use for its resource kinds. They map to theme resources in the UI. */
export const TONES = ["rose", "orange", "amber", "lime", "green", "teal", "sky", "blue", "indigo", "violet", "pink", "slate"] as const
export type Tone = (typeof TONES)[number]

export const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,47}$/, "Use 1-48 lowercase letters, digits, - or _, starting with a letter or digit")

/** Plain text: trimmed, bounded, no markup characters. */
export const Text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Required")
    .max(max, `At most ${max} characters`)
    .refine((s) => !/[<>]/.test(s), "Markup characters < and > are not allowed")
    .refine((s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s), "Control characters are not allowed")

const Count = (max: number) => z.number().int().min(0).max(max)

/** Optional card art: same-origin static file under /art/. No remote, data: or javascript: URLs. */
export const ArtSrc = z
  .string()
  .regex(/^\/art\/[a-z0-9_-]+(\/[a-z0-9_-]+)*\.(png|jpg|jpeg|webp)$/, "Art must be a path like /art/name.webp")

/** Uploaded artwork after decoding: a content-addressed WebP served by both servers. */
export const ManagedArtSrc = z.string().regex(/^\/art\/managed\/[a-f0-9]{64}\.webp$/, "Use an image uploaded through the admin")


/**
 * Optional picture for the resources as a whole (not per kind): an image
 * uploaded through the admin. Packs without one show the resource icons and labels.
 */
export const ResourceArt = z.strictObject({ src: ManagedArtSrc, alt: Text(120).optional() })

export const ResourceKind = z.strictObject({
  id: Id,
  label: Text(24),
  tone: z.enum(TONES),
  icon: z.enum(RESOURCE_ICONS),
})

export const Range = z.strictObject({ min: Count(60), max: Count(60) }).refine((r) => r.min <= r.max, "min must not exceed max")

export const CardGroup = z.strictObject({
  id: Id,
  label: Text(32),
  /** tiered: market rows that can be reserved. unique: market-only, limited per player. */
  kind: z.enum(["tiered", "unique"]),
  deckSize: z.number().int().min(1).max(200),
  cost: Range,
  points: Range,
})

export const Card = z.strictObject({
  id: Id,
  group: Id,
  name: Text(48),
  shortName: Text(18).optional(),
  art: z.strictObject({
    src: ArtSrc,
    alt: Text(120).optional(),
    source: z.string().url().max(1000).refine(s => s.startsWith("https://"), "Use an HTTPS source URL").optional(),
    creator: Text(160).optional(),
    license: Text(160).optional(),
    licenseUrl: z.string().url().max(1000).refine(s => s.startsWith("https://"), "Use an HTTPS license URL").optional(),
    attribution: Text(1000).optional(),
    restrictions: Text(1000).optional(),
  }).optional(),
  cost: z.record(Id, Count(15)),
  /** The resource kind this card permanently contributes once acquired: it lowers future costs and is never spent. */
  permanentResource: Id,
  points: Count(10),
  meta: z.record(Id, Text(80)).optional(),
})

export type Predicate =
  | { type: "cardCount"; min: number; groups?: string[]; permanentResource?: string }
  | { type: "distinctPermanentResources"; min: number; groups?: string[] }
  | { type: "relationships"; min: number; size?: number; disjoint?: boolean }
  | { type: "claimedCategory"; category: string; min: number }
  | { type: "all"; of: Predicate[] }
  | { type: "any"; of: Predicate[] }

export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("cardCount"),
      min: z.number().int().min(1).max(100),
      groups: z.array(Id).min(1).max(8).optional(),
      permanentResource: Id.optional(),
    }),
    z.strictObject({
      type: z.literal("distinctPermanentResources"),
      min: z.number().int().min(1).max(RESOURCE_KIND_COUNT),
      groups: z.array(Id).min(1).max(8).optional(),
    }),
    z.strictObject({
      type: z.literal("relationships"),
      min: z.number().int().min(1).max(10),
      size: z.number().int().min(2).max(3).optional(),
      disjoint: z.boolean().optional(),
    }),
    z.strictObject({
      type: z.literal("claimedCategory"),
      category: Id,
      min: z.number().int().min(1).max(20),
    }),
    z.strictObject({ type: z.literal("all"), of: z.array(PredicateSchema).min(1).max(6) }),
    z.strictObject({ type: z.literal("any"), of: z.array(PredicateSchema).min(1).max(6) }),
  ])
)

export const AchievementCategory = z.strictObject({ id: Id, label: Text(32) })

export const Achievement = z.strictObject({
  id: Id,
  category: Id,
  name: Text(40),
  description: Text(160),
  points: Count(10),
  requirement: PredicateSchema,
})

export const Relationship = z.strictObject({
  id: Id,
  label: Text(60),
  cardIds: z.array(Id).min(2).max(3),
  note: Text(300),
  source: Text(200),
})

export const Labels = z.strictObject({
  game: Text(32),
  /** Collect action and its past tense. May include {label:resources}; validation limits the displayed length. */
  collect: Text(40),
  collected: Text(40),
  reserve: Text(16),
  acquire: Text(16),
  resource: Text(20),
  resources: Text(20),
  wildcard: Text(20),
  wildcards: Text(20),
  reserved: Text(24),
  acquired: Text(24),
  points: Text(16),
  collection: Text(24),
  achievements: Text(24),
  /** Optional noun for the collectible cards (one / many), e.g. Star / Stars. Absent: "Card" / "Cards". */
  card: Text(20).optional(),
  cards: Text(20).optional(),
})

export const Pack = z.strictObject({
  schemaVersion: z.literal(PACK_SCHEMA_VERSION),
  id: Id,
  name: Text(48),
  version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/, "Use a version like 1.0.0"),
  description: Text(300).optional(),
  /** Optional icon shown beside the game title in the public game, from the resource icon set. Absent: the title alone. */
  icon: z.enum(RESOURCE_ICONS).optional(),
  labels: Labels,
  resourceKinds: z.array(ResourceKind).length(RESOURCE_KIND_COUNT, `Exactly ${RESOURCE_KIND_COUNT} resource kinds`),
  resourceArt: ResourceArt.optional(),
  cardGroups: z.array(CardGroup).min(1).max(5),
  cards: z.array(Card).min(1).max(400),
  achievementCategories: z.array(AchievementCategory).min(1).max(8),
  achievements: z.array(Achievement).min(1).max(40),
  relationships: z.array(Relationship).max(60),
})

const PerPlayerCount = z.strictObject({ "2": Count(30), "3": Count(30), "4": Count(30) })

export const Rules = z.strictObject({
  schemaVersion: z.literal(RULES_SCHEMA_VERSION),
  playerCounts: z
    .strictObject({ min: z.number().int().min(2).max(4), max: z.number().int().min(2).max(4) })
    .refine((r) => r.min <= r.max, "min must not exceed max"),
  resourceSupply: PerPlayerCount,
  wildcardSupply: Count(20),
  startingResources: Count(3),
  collect: z.strictObject({
    distinct: z.number().int().min(1).max(RESOURCE_KIND_COUNT),
    pair: z.number().int().min(1).max(4),
    pairMinSupply: z.number().int().min(1).max(30),
    allowPartialDistinct: z.boolean(),
  }),
  holdingCap: z.number().int().min(3).max(30),
  reserveCap: Count(5),
  wildcardsOnReserve: Count(3),
  market: z.strictObject({ tieredSlots: z.number().int().min(1).max(6), uniqueSlots: Count(6) }),
  uniqueLimitPerPlayer: Count(3),
  achievementsDrawn: PerPlayerCount,
  targetPoints: z.number().int().min(1).max(60),
  /** fewest-acquired: points, then fewest acquired cards, then shared. shared: points, then shared. */
  tieBreak: z.enum(["fewest-acquired", "shared"]),
})

export type ResourceKind = z.infer<typeof ResourceKind>
export type CardGroup = z.infer<typeof CardGroup>
export type Card = z.infer<typeof Card>
export type Achievement = z.infer<typeof Achievement>
export type Relationship = z.infer<typeof Relationship>
export type Labels = z.infer<typeof Labels>
export type ResourceArt = z.infer<typeof ResourceArt>
export type Pack = z.infer<typeof Pack>
export type Rules = z.infer<typeof Rules>
