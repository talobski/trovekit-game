import { InfoIcon } from "lucide-react"
import type { GameContext } from "@/engine/client"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { noun, withArticle } from "./presentation"
import { ResourceDisc } from "./resource"

/** What each resource icon means. A button, so it works by keyboard and touch as well as hover. */
export function IconKey({ ctx }: { ctx: GameContext; }) {
  const { labels } = ctx.pack
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="-my-1 h-8 gap-1 px-2 text-muted-foreground">
          <InfoIcon aria-hidden />
          Key
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <p className="mb-3 text-sm font-medium">{labels.resources}</p>
        <ul className="flex flex-col gap-2.5 text-sm">
          {ctx.pack.resourceKinds.map((k) => (
            <li key={k.id} className="flex items-center gap-2.5">
              <ResourceDisc kind={k} size="sm" />
              {k.label}
            </li>
          ))}
          <li className="flex items-center gap-2.5">
            <ResourceDisc kind="wild" size="sm" />
            {labels.wildcard}, counts as any kind
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">On {withArticle(noun(ctx.pack, "card"))}, the corner icon is its permanent resource, which lowers future costs of that kind by 1; the row below is its cost.</p>
      </PopoverContent>
    </Popover>
  )
}
