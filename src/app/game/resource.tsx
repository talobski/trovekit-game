import {
  Anchor,
  Beef,
  BookOpen,
  Brain,
  Car,
  Carrot,
  Circle,
  Compass,
  Crosshair,
  Crown,
  Diamond,
  Droplet,
  Eye,
  Feather,
  Flame,
  Gem,
  Hand,
  Heart,
  Hexagon,
  Leaf,
  Lock,
  Moon,
  Mountain,
  Music,
  RectangleCircle,
  Rocket,
  Shield,
  SparkleIcon,
  Square,
  Star,
  Sun,
  Sword,
  Triangle,
  Wheat,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react"
import type { ResourceArt, ResourceIcon, ResourceKind } from "@/engine/client"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TONE_SOLID } from "@/lib/tones"

/** Every icon a pack may choose (RESOURCE_ICONS). Sparkle stays reserved for wildcards. */
export const RESOURCE_ICON_COMPONENTS: Record<ResourceIcon, LucideIcon> = {
  circle: Circle,
  square: Square,
  triangle: Triangle,
  diamond: Diamond,
  hexagon: Hexagon,
  star: Star,
  heart: Heart,
  flame: Flame,
  droplet: Droplet,
  wind: Wind,
  mountain: Mountain,
  zap: Zap,
  leaf: Leaf,
  sun: Sun,
  moon: Moon,
  shield: Shield,
  sword: Sword,
  crown: Crown,
  gem: Gem,
  "book-open": BookOpen,
  music: Music,
  brain: Brain,
  rocket: Rocket,
  crosshair: Crosshair,
  lock: Lock,
  hand: Hand,
  eye: Eye,
  anchor: Anchor,
  feather: Feather,
  compass: Compass,
  wheat: Wheat,
  beef: Beef,
  "rectangle-circle": RectangleCircle,
  car: Car,
  carrot: Carrot,
}

const SIZE = {
  xs: "size-4 text-[0.625rem]",
  sm: "size-6 text-xs",
  md: "size-8 text-sm",
  lg: "size-11 text-base",
} as const

/** A resource: solid tone disc with the kind's icon, never colour alone. */
export function ResourceDisc({ kind, size = "sm", className }: { kind: ResourceKind | "wild"; size?: keyof typeof SIZE; className?: string }) {
  const wild = kind === "wild"
  const Icon = wild ? SparkleIcon : RESOURCE_ICON_COMPONENTS[kind.icon]
  return (
    <span
      aria-hidden
      className={cn(
        "resource-shade inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none ring-1 ring-black/10 ring-inset dark:ring-white/10",
        SIZE[size],
        wild ? "bg-foreground text-background" : TONE_SOLID[kind.tone],
        className
      )}
    >
      <Icon className="size-[65%]" strokeWidth={2} />
    </span>
  )
}

/** Disc plus a count (and any permanent contribution), with an accessible label. */
export function ResourceCount({
  kind,
  label,
  count,
  permanent,
  size = "sm",
  className,
}: {
  kind: ResourceKind | "wild"
  label: string
  count: number
  permanent?: number
  size?: keyof typeof SIZE
  className?: string
}) {
  const sr = `${label}: ${count}${permanent ? `, plus ${permanent} permanent` : ""}`
  // Hover shows the same text as the accessible name; the Supply key covers keyboard and touch.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1.5", count === 0 && !permanent && "opacity-50", className)} aria-label={sr} role="img">
          <ResourceDisc kind={kind} size={size} />
          <span className="num text-sm font-semibold tabular-nums">{count}</span>
          {!!permanent && <span className="num -ml-0.5 text-xs font-medium text-muted-foreground">+{permanent}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>{sr}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The pack's resource picture as full-bleed artwork behind a collect option.
 * Decorative: the option's label and count carry the meaning.
 */
export function ResourceArtFill({ art }: { art: ResourceArt }) {
  return <img src={art.src} alt="" aria-hidden width={480} height={600} className="absolute inset-0 size-full object-cover object-top" />
}

/** The pack's resource picture as a thumbnail, if it has one. Decorative; nearby text names the resources. */
export function ResourceArtImage({ art, className }: { art?: ResourceArt; className?: string }) {
  if (!art) return null
  return <img src={art.src} alt="" aria-hidden width={480} height={600} className={cn("size-10 shrink-0 rounded-md object-cover", className)} />
}
