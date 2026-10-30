import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { explainIssue, isMissingCards } from "../validation"
import { ResourceArtImage, ResourceDisc } from "@/app/game/resource"
import { SECTION_LABEL, type Section as EditorSection } from "../routes"
import { useMemo } from "react"
import { createContext } from "@/engine/game"
import type { Issue } from "@/engine/validate"
import { presentPack } from "@/app/game/presentation"
import { GameCard } from "@/app/game/game-card"
import { Section } from "../fields"
import { describePredicate, type Content } from "../model"

export function IssueList({ issues, content, onNavigate }: { issues: Issue[]; content?: Content; onNavigate?: (section: EditorSection) => void }) {
  return <div className="flex flex-col gap-2">
    <ul className="flex flex-col divide-y rounded-lg border text-sm" aria-label="Validation issues">
      {issues.map((issue, n) => {
        const item = explainIssue(issue, content)
        return <li key={n} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
          <div className="min-w-0 flex-1"><p className="font-medium break-words">{item.title}</p><p className="text-muted-foreground break-words">{item.action}</p></div>
          {onNavigate && <Button variant="outline" size="sm" onClick={() => onNavigate(item.section)}>Open {SECTION_LABEL[item.section]}</Button>}
        </li>
      })}
    </ul>
    <Collapsible><CollapsibleTrigger asChild><Button variant="ghost" size="sm">Technical details</Button></CollapsibleTrigger><CollapsibleContent><ul className="space-y-2 p-3 font-mono text-xs break-all">{issues.map((i, n) => <li key={n}>{i.path}: {i.message}</li>)}</ul></CollapsibleContent></Collapsible>
  </div>
}

/**
 * How the configured content looks to players: resources, cards by group and
 * achievements. Publishing readiness lives on Overview; this only points there.
 */
export function PreviewSection({ content, issues, onNavigate }: { content: Content; issues: Issue[]; onNavigate: (section: EditorSection) => void }) {
  const ctx = useMemo(() => {
    try {
      return createContext(presentPack(content.pack), content.rules)
    } catch {
      return null
    }
  }, [content])
  const { pack } = content
  const errors = issues.filter((i) => !isMissingCards(i, content))

  return (
    <div className="flex flex-col gap-10">
      {errors.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground" role="status">
          {errors.length} {errors.length === 1 ? "issue" : "issues"} to fix before publishing. Some content may not appear here until then.
          <Button variant="link" className="h-auto p-0 text-sm" onClick={() => onNavigate("overview")}>Review in Overview</Button>
        </p>
      )}
      {!ctx || issues.some((i) => i.path.includes("resourceKinds")) ? (
        <p className="text-sm text-muted-foreground">The preview appears once the resources are valid.</p>
      ) : (
        <>
          <Section title={pack.labels.resources}>
            <ul className="flex flex-wrap gap-x-6 gap-y-3">
              {pack.resourceKinds.map((k) => (
                <li key={k.id} className="flex items-center gap-2 text-sm">
                  <ResourceDisc kind={k} size="md" />
                  {k.label}
                </li>
              ))}
              <li className="flex items-center gap-2 text-sm">
                <ResourceDisc kind="wild" size="md" />
                {pack.labels.wildcard}
              </li>
            </ul>
            {pack.resourceArt && (
              <span className="flex size-24 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
                <ResourceArtImage art={pack.resourceArt} />
              </span>
            )}
          </Section>
          {pack.cardGroups.map((g) => {
            const cards = pack.cards.filter((c) => c.group === g.id && pack.resourceKinds.some((k) => k.id === c.permanentResource))
            return (
              <Section key={g.id} title={g.label} description={`${cards.length} ${cards.length === 1 ? "card" : "cards"}`}>
                {cards.length ? (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                    {cards.map((c) => (
                      <GameCard key={c.id} ctx={ctx} card={c} />
                    ))}
                  </div>
                ) : (
                  <Button variant="link" className="h-auto self-start p-0 text-sm" onClick={() => onNavigate("cards")}>Add cards to {g.label}</Button>
                )}
              </Section>
            )
          })}
          <Section title={pack.labels.achievements}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {ctx.pack.achievements.map((a) => (
                <li key={a.id} className="flex gap-3 rounded-lg border bg-card p-3 text-sm">
                  <span className="num flex size-9 shrink-0 items-center justify-center rounded-md bg-accent font-semibold text-primary">+{a.points}</span>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-muted-foreground">{a.description}</span>
                    <span className="text-xs text-muted-foreground">{describePredicate(ctx.pack, a.requirement)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  )
}
