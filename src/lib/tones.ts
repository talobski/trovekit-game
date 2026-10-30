import type { Tone } from "@/engine/client"

/** Static class strings so Tailwind sees every tone. */
export const TONE_SOLID: Record<Tone, string> = {
  rose: "bg-tone-rose text-tone-rose-fg",
  orange: "bg-tone-orange text-tone-orange-fg",
  amber: "bg-tone-amber text-tone-amber-fg",
  lime: "bg-tone-lime text-tone-lime-fg",
  green: "bg-tone-green text-tone-green-fg",
  teal: "bg-tone-teal text-tone-teal-fg",
  sky: "bg-tone-sky text-tone-sky-fg",
  blue: "bg-tone-blue text-tone-blue-fg",
  indigo: "bg-tone-indigo text-tone-indigo-fg",
  violet: "bg-tone-violet text-tone-violet-fg",
  pink: "bg-tone-pink text-tone-pink-fg",
  slate: "bg-tone-slate text-tone-slate-fg",
}

export const TONE_SOFT: Record<Tone, string> = {
  rose: "bg-tone-rose-soft text-tone-rose",
  orange: "bg-tone-orange-soft text-tone-orange",
  amber: "bg-tone-amber-soft text-tone-amber",
  lime: "bg-tone-lime-soft text-tone-lime",
  green: "bg-tone-green-soft text-tone-green",
  teal: "bg-tone-teal-soft text-tone-teal",
  sky: "bg-tone-sky-soft text-tone-sky",
  blue: "bg-tone-blue-soft text-tone-blue",
  indigo: "bg-tone-indigo-soft text-tone-indigo",
  violet: "bg-tone-violet-soft text-tone-violet",
  pink: "bg-tone-pink-soft text-tone-pink",
  slate: "bg-tone-slate-soft text-tone-slate",
}
