import { useMemo, useState, type ReactNode } from "react"
import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleIcon } from "lucide-react"
import type { Issue } from "@/engine/validate"
import type { PackSummary, VersionSummary } from "@/shared/content"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { Section } from "../fields"
import { shortDate } from "../lifecycle"
import type { Change, Content } from "../model"
import { packRoute, routeHash, type Section as WorkspaceSection } from "../routes"
import { setupSteps, type StepState } from "../setup"
import { isMissingCards, publishingStatus } from "../validation"
import { IssueList } from "./preview"

const STATE: Record<StepState, { icon: typeof CircleIcon; label: string; className: string }> = {
  done: { icon: CircleCheckIcon, label: "Done", className: "text-success" },
  todo: { icon: CircleIcon, label: "To do", className: "text-muted-foreground" },
  attention: { icon: CircleAlertIcon, label: "Needs attention", className: "text-destructive" },
  pending: { icon: CircleDashedIcon, label: "Not checked yet", className: "text-muted-foreground" },
}

interface OverviewProps {
  content: Content
  issues: Issue[]
  summary: PackSummary | null
  /** This pack's published versions, newest first. */
  versions: VersionSummary[]
  /** The library's default version, whichever pack it belongs to. */
  defaultVersion: VersionSummary | null
  dirty: boolean
  savedDraft: boolean
  changesFromLatest: Change[] | null
  onNavigate: (section: WorkspaceSection) => void
  onMakeDefault: (versionId: string) => Promise<void>
}

/**
 * A pack's home. Before its first published version it is a setup checklist
 * derived from the pack's data; afterwards it manages the pack's draft,
 * versions and default. Creating another draft never brings the checklist back.
 */
export function OverviewSection(props: OverviewProps) {
  return props.versions.length ? <PackStatus {...props} /> : <SetupChecklist {...props} />
}

const link = (packId: string, section: WorkspaceSection) => routeHash(packRoute(packId, section))

function SetupChecklist({ content, issues, onNavigate }: OverviewProps) {
  const steps = useMemo(() => setupSteps(content), [content])
  const blocking = issues.filter((i) => !isMissingCards(i, content))
  return (
    <Section title="Set up your pack" description="Work in any order and save your draft at any point. Players see nothing until you publish a version and make it the default.">
      <ol className="flex flex-col divide-y rounded-lg border" aria-label="Setup steps">
        {steps.map((step) => {
          const { icon: Icon, label, className } = STATE[step.state]
          const last = step.id === "publish"
          return (
            <li key={step.id} className="flex gap-3 p-4">
              <Icon className={cn("mt-0.5 size-5 shrink-0", className)} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="font-medium">
                  {step.title}
                  <span className="sr-only">: {label}</span>
                </p>
                <p className={cn("text-sm break-words", step.state === "attention" ? "text-destructive" : "text-muted-foreground")}>{step.detail}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                  {step.links.map((l) => (
                    <a key={l.section} href={link(content.pack.id, l.section)} className="text-sm font-medium text-primary underline underline-offset-4 hover:decoration-2">
                      {l.label}
                    </a>
                  ))}
                </div>
                {last && blocking.length > 0 && (
                  <div className="pt-3">
                    <IssueList issues={blocking} content={content} onNavigate={onNavigate} />
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

function Row({ term, children, action }: { term: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words sm:col-start-1">{children}</dd>
      {action && <dd className="flex flex-wrap gap-2 pt-2 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:pt-0">{action}</dd>}
    </div>
  )
}

function PackStatus({ content, issues, summary, versions, defaultVersion, dirty, savedDraft, changesFromLatest, onNavigate, onMakeDefault }: OverviewProps) {
  const [confirm, setConfirm] = useState<VersionSummary | null>(null)
  const packId = content.pack.id
  const latest = versions.find((v) => v.id === summary?.published) ?? versions[0]
  const ownDefault = defaultVersion?.packId === packId ? defaultVersion : null
  const archived = summary?.archived ?? false
  const unpublished = changesFromLatest?.length ?? 0
  const errors = issues.filter((i) => !isMissingCards(i, content))
  return (
    <div className="flex flex-col gap-10">
      <Section>
        <dl aria-label="Pack status" className="flex flex-col divide-y rounded-lg border">
          <Row term="Editor">{dirty ? "Unsaved changes. Save a draft to keep them." : "No unsaved changes"}</Row>
          <Row term="Draft">
            {savedDraft ? "Saved draft, not published" : `No saved draft. Editing starts from ${latest.packVersion}.`}
            {unpublished > 0 && (
              <span className="block text-sm text-muted-foreground">
                {unpublished} {unpublished === 1 ? "change" : "changes"} from {latest.packVersion}, ready to publish with Publish version.{" "}
                <a href={link(packId, "versions")} className="font-medium text-primary underline underline-offset-4 hover:decoration-2">Review changes</a>
              </span>
            )}
          </Row>
          <Row term="Latest published" action={<Button size="sm" variant="outline" asChild><a href={link(packId, "versions")}>Version history</a></Button>}>
            {latest.packVersion} · {shortDate(latest.createdAt)}
            <span className="block text-sm text-muted-foreground break-words">{latest.note}</span>
          </Row>
          <Row
            term="New rooms use"
            action={!archived && ownDefault?.id !== latest.id && <Button size="sm" variant="outline" onClick={() => setConfirm(latest)}>Make {latest.packVersion} default</Button>}
          >
            {ownDefault ? `This pack, ${ownDefault.packVersion}${ownDefault.id !== latest.id ? " (an older version)" : ""}` : defaultVersion ? `Another pack: ${defaultVersion.packName} ${defaultVersion.packVersion}` : "No default yet. Players cannot create rooms."}
          </Row>
          {archived && (
            <Row term="Archived" action={<Button size="sm" variant="outline" asChild><a href={link(packId, "settings")}>Settings</a></Button>}>
              Its versions cannot be made the default until you restore it.
            </Row>
          )}
        </dl>
      </Section>

      {issues.length > 0 && (
        <Section title="Before publishing">
          <p id="overview-readiness" className={cn("text-sm", errors.length ? "text-destructive" : "text-muted-foreground")}>{publishingStatus(content, issues)}</p>
          <IssueList issues={issues} content={content} onNavigate={onNavigate} />
        </Section>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make {confirm?.packName} {confirm?.packVersion} the default for new rooms?</AlertDialogTitle>
            <AlertDialogDescription>Rooms already created keep their version. Drafts and published versions are not changed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm) void onMakeDefault(confirm.id) }}>Make default</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
