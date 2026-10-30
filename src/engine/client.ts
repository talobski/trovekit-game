/** Engine entry for browsers: rules and helpers without the schema validator (and its Zod runtime). */
export * from "./game"
export * from "./predicates"
export * from "./projection"
export * from "./text"
export type { Achievement, Card, CardGroup, Labels, Pack, Predicate, ResourceKind, Rules, Tone, ResourceArt } from "./schema"
export { RESOURCE_ICONS, type ResourceIcon } from "./icons"
