import { useState } from "react"
import type { Card } from "@/engine/client"
import { initials } from "@/app/game/pack-view"
import { cn } from "@/lib/utils"

/** Fixed frame or full-card background; loading and errors never change layout. */
export function CardArt({ card, className, fill = false }: { card: Card; className?: string; fill?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  const shown = !!card.art && failed !== card.art.src
  // Without a picture a full-card face is marked empty, so the card can take its tier's colour instead (cards.css).
  return <span className={cn("flex items-center justify-center overflow-hidden type-heading", fill ? "card-photo-art absolute inset-0 size-full" : "relative aspect-[4/5] shrink-0 rounded-md bg-muted text-muted-foreground", fill && !shown && "card-photo-empty", className)}>
    {card.art && shown ? <img src={card.art.src} alt={card.art.alt ?? card.name} width={480} height={600} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover object-top" onError={() => setFailed(card.art!.src)} /> : <span aria-label={`${card.name}, no image`} role="img">{initials(card.name)}</span>}
  </span>
}
