import { ChevronDownIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { PredicateSchema, type Pack, type Predicate } from "@/engine/schema"
import type { Issue } from "@/engine/validate"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { FormField, NumberField, SelectField } from "./fields"
import { changeType, CONDITION_TYPES, COUNT_RANGE, explainRequirement, fitsForm, isCondition, MAX_CONDITIONS, requirementProblems, type Condition, type ConditionType } from "./requirement"

const ANY = "any"
const SIZES = [
  { value: ANY, label: "Any" },
  { value: "2", label: "Duo" },
  { value: "3", label: "Trio" },
]

/** Card groups to count from; none chosen keeps the rule's default, any tiered group. */
function GroupsField({ id, pack, value, onChange }: { id: string; pack: Pack; value?: string[]; onChange: (groups?: string[]) => void }) {
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <Label id={`${id}-label`}>Card groups</Label>
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        spacing={1}
        className="flex-wrap"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        value={value ?? []}
        onValueChange={(groups) => onChange(groups.length ? pack.cardGroups.map((g) => g.id).filter((g) => groups.includes(g)) : undefined)}
      >
        {pack.cardGroups.map((g) => (
          <ToggleGroupItem key={g.id} value={g.id}>
            {g.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {value?.length ? "Only cards from the chosen groups count." : "None chosen: cards from any tiered group count."}
      </p>
    </div>
  )
}

/** The fields for one condition. */
function ConditionFields({ id, pack, value, onChange }: { id: string; pack: Pack; value: Condition; onChange: (c: Condition) => void }) {
  const range = COUNT_RANGE[value.type]
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        id={`${id}-type`}
        label="Requirement"
        value={value.type}
        options={CONDITION_TYPES}
        onChange={(type) => onChange(changeType(pack, value, type as ConditionType))}
        className="sm:col-span-2"
      />
      {value.type === "relationships" && (
        <SelectField
          id={`${id}-size`}
          label="Relationship size"
          value={value.size ? String(value.size) : ANY}
          options={SIZES}
          onChange={(size) => {
            const { size: _, ...rest } = value
            onChange(size === ANY ? rest : { ...rest, size: Number(size) })
          }}
        />
      )}
      {value.type === "claimedCategory" && (
        <SelectField
          id={`${id}-category`}
          label="Category"
          value={value.category}
          options={pack.achievementCategories.map((c) => ({ value: c.id, label: c.label }))}
          onChange={(category) => onChange({ ...value, category })}
        />
      )}
      <NumberField id={`${id}-min`} label="Required count" value={value.min} min={range.min} max={range.max} onChange={(min) => onChange({ ...value, min })} />
      {value.type === "cardCount" && (
        <SelectField
          id={`${id}-resource`}
          label="Permanent resource"
          value={value.permanentResource ?? ANY}
          options={[{ value: ANY, label: "Any" }, ...pack.resourceKinds.map((k) => ({ value: k.id, label: k.label }))]}
          onChange={(resource) => {
            const { permanentResource: _, ...rest } = value
            onChange(resource === ANY ? rest : { ...rest, permanentResource: resource })
          }}
        />
      )}
      {(value.type === "cardCount" || value.type === "distinctPermanentResources") && (
        <GroupsField
          id={`${id}-groups`}
          pack={pack}
          value={value.groups}
          onChange={(groups) => {
            const { groups: _, ...rest } = value
            onChange(groups ? { ...rest, groups } : rest)
          }}
        />
      )}
      {value.type === "relationships" && (
        <div className="flex items-center gap-2 sm:col-span-2">
          <Switch
            id={`${id}-disjoint`}
            checked={!!value.disjoint}
            onCheckedChange={(disjoint) => {
              const { disjoint: _, ...rest } = value
              onChange(disjoint ? { ...rest, disjoint: true } : rest)
            }}
          />
          <Label htmlFor={`${id}-disjoint`}>No card shared between relationships</Label>
        </div>
      )}
    </div>
  )
}

const COMBINE = [
  { value: "one", label: "One condition" },
  { value: "all", label: "All of these conditions" },
  { value: "any", label: "Any one of these conditions" },
]

/** The requirement as JSON, kept in step with the form both ways. */
function JsonField({ value, onChange }: { value: Predicate; onChange: (p: Predicate) => void }) {
  const pretty = (p: Predicate) => JSON.stringify(p, null, 2)
  const [text, setText] = useState(() => pretty(value))
  const [error, setError] = useState<string | null>(null)
  // Follow form edits, but never rewrite what is being typed when it already says the same thing.
  useEffect(() => {
    setText((current) => {
      try {
        if (JSON.stringify(JSON.parse(current)) === JSON.stringify(value)) return current
      } catch {
        /* mid-edit: replaced below */
      }
      return pretty(value)
    })
    setError(null)
  }, [value])
  const commit = (next: string) => {
    setText(next)
    let data: unknown
    try {
      data = JSON.parse(next)
    } catch {
      return setError("This is not complete JSON yet.")
    }
    const parsed = PredicateSchema.safeParse(data)
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`).join("; "))
    setError(null)
    onChange(parsed.data)
  }
  return (
    <FormField id="ach-requirement-json" label="Requirement JSON" error={error ?? undefined}>
      <Textarea id="ach-requirement-json" rows={8} spellCheck={false} className="font-mono text-xs" value={text} onChange={(e) => commit(e.target.value)} />
    </FormField>
  )
}

/**
 * The achievement's requirement as a form: one condition, or all or any of
 * several, with a plain reading and the problems that block publishing.
 * Requirements the form cannot show exactly (combinations inside
 * combinations) open as JSON and are never simplified.
 */
export function RequirementEditor({ pack, value, onChange, issues, index }: { pack: Pack; value: Predicate; onChange: (p: Predicate) => void; issues: Issue[]; index: number }) {
  const form = fitsForm(value)
  const [json, setJson] = useState(!form)
  const conditions = isCondition(value) ? [value] : value.of
  const combine = isCondition(value) ? "one" : value.type
  const setCondition = (i: number, c: Condition) => (isCondition(value) ? onChange(c) : onChange({ ...value, of: value.of.map((x, j) => (j === i ? c : x)) }))
  const reading = explainRequirement(pack, value)
  const problems = requirementProblems(pack, value, issues, index)
  return (
    <section aria-label="Requirement" className="flex flex-col gap-4 border-t pt-4">
      {form ? (
        <>
          <SelectField
            id="ach-combine"
            label="Players need"
            value={combine}
            hint={conditions.length > 1 ? "To keep one condition, remove the others first." : undefined}
            options={COMBINE.map((o) => (o.value === "one" && conditions.length > 1 ? { ...o, disabled: true } : o))}
            onChange={(next) => {
              if (next === combine) return
              if (next === "one") return onChange(conditions[0] as Condition)
              onChange({ type: next as "all" | "any", of: conditions })
            }}
          />
          {conditions.map((c, i) =>
            isCondition(value) ? (
              <ConditionFields key="only" id="ach-req" pack={pack} value={c as Condition} onChange={(next) => setCondition(i, next)} />
            ) : (
              <div key={i} role="group" aria-labelledby={`ach-req-${i}-title`} className="flex flex-col gap-3 border-t pt-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 id={`ach-req-${i}-title`} className="text-sm font-medium">
                    Condition {i + 1}
                  </h4>
                  {conditions.length > 1 && (
                    <Button variant="ghost" size="sm" aria-label={`Remove condition ${i + 1}`} onClick={() => !isCondition(value) && onChange({ ...value, of: value.of.filter((_, j) => j !== i) })}>
                      <Trash2Icon /> Remove
                    </Button>
                  )}
                </div>
                <ConditionFields id={`ach-req-${i}`} pack={pack} value={c as Condition} onChange={(next) => setCondition(i, next)} />
              </div>
            ),
          )}
          {!isCondition(value) && conditions.length < MAX_CONDITIONS && (
            <Button variant="outline" className="self-start" onClick={() => onChange({ ...value, of: [...value.of, { type: "cardCount", min: 1 }] })}>
              <PlusIcon /> Add condition
            </Button>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">This requirement combines conditions inside other combinations, which the form cannot show. Edit it as JSON below; it is kept exactly as written.</p>
      )}

      <div className="flex flex-col gap-1 rounded-md bg-muted/60 p-3 text-sm" aria-live="polite" data-requirement-reading>
        {reading.lead && <p className="font-medium">{reading.lead}</p>}
        {reading.lead ? (
          <ul className="list-disc pl-5">
            {reading.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : (
          <p>{reading.lines[0]}</p>
        )}
      </div>
      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-destructive" aria-label="Requirement problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <Collapsible open={json} onOpenChange={setJson}>
        {form && (
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group -ml-3">
              Advanced: edit as JSON
              <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
            </Button>
          </CollapsibleTrigger>
        )}
        <CollapsibleContent className="pt-2">
          <JsonField value={value} onChange={onChange} />
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
