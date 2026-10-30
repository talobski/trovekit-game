/** Used only at creation. Renaming a pack must never change its identifier. */
export function newPackId(name: string, existing: Iterable<string>): string {
  const base = name.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48).replace(/^-+|-+$/g, "") || "pack"
  const taken = new Set(existing)
  let id = base
  for (let n = 2; taken.has(id); n++) {
    const suffix = `-${n}`
    id = `${base.slice(0, 48 - suffix.length).replace(/-+$/g, "")}${suffix}`
  }
  return id
}
