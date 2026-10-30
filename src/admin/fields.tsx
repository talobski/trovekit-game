import type { ReactNode } from "react"
import { Combobox, type ComboboxOption } from "@/components/combobox"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** Label, control, then a hint or an error: composed from shadcn Field. */
export function FormField({ id, label, hint, error, children, className }: { id: string; label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <Field className={cn("min-w-0", className)} data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {error ? <FieldError id={`${id}-feedback`}>{error}</FieldError> : hint ? <FieldDescription id={`${id}-feedback`}>{hint}</FieldDescription> : null}
    </Field>
  )
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  hint,
  className,
}: {
  id: string
  label: ReactNode
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  hint?: ReactNode
  className?: string
}) {
  return (
    <FormField id={id} label={label} hint={hint} className={className}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Math.trunc(Number(e.target.value)))}
        className="num"
      />
    </FormField>
  )
}

export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  maxLength,
  className,
}: {
  id: string
  label: ReactNode
  value: string
  onChange: (s: string) => void
  hint?: ReactNode
  maxLength?: number
  className?: string
}) {
  return (
    <FormField id={id} label={label} hint={hint} className={className}>
      <Input id={id} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  )
}

/** Short lists: shadcn Select. */
export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  hint,
  className,
}: {
  id: string
  label: ReactNode
  value: string
  onChange: (s: string) => void
  options: { value: string; label: string; prefix?: ReactNode; disabled?: boolean }[]
  hint?: ReactNode
  className?: string
}) {
  return (
    <FormField id={id} label={label} hint={hint} className={className}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.prefix}
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

/** Long or searchable lists: the shadcn Combobox pattern. */
export function ComboboxField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  className,
}: {
  id: string
  label: string
  value: string
  onChange: (s: string) => void
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
}) {
  return (
    <FormField id={id} label={label} className={className}>
      <Combobox
        id={id}
        value={value}
        onValueChange={onChange}
        options={options}
        title={label}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        emptyText={emptyText}
      />
    </FormField>
  )
}

export function Section({ title, description, children, actions }: { title?: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      {(title || description || actions) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

/** A page's one h1. Navigation moves focus to it, so it takes focus without a ring. */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold break-words outline-none">
          {title}
        </h1>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
