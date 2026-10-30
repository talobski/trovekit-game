/**
 * Named glyphs a resource kind may use (drawn by the client from Lucide). With
 * the tone, the icon tells kinds apart without relying on colour alone.
 * "sparkle" is reserved for wildcards.
 */
export const RESOURCE_ICONS = [
  "circle", "square", "triangle", "diamond", "hexagon", "star", "heart", "flame", "droplet", "wind",
  "mountain", "zap", "leaf", "sun", "moon", "shield", "sword", "crown", "gem", "book-open",
  "music", "brain", "rocket", "crosshair", "lock", "hand", "eye", "anchor", "feather", "compass",
  "wheat", "beef", "rectangle-circle", "car", "carrot",
] as const
export type ResourceIcon = (typeof RESOURCE_ICONS)[number]
