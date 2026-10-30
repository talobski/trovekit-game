import { afterEach, expect, it, vi } from "vitest"
import { loadSession, saveSession, clearSession } from "../src/app/api"
import { readStored, removeStored, writeStored } from "../src/lib/storage"

afterEach(() => { vi.unstubAllGlobals() })
/** An in-memory localStorage that records every key the app touches. */
function storage() {
  const values = new Map<string, string>(), touched = new Set<string>()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => { touched.add(k); return values.get(k) ?? null },
    setItem: (k: string, v: string) => { touched.add(k); values.set(k, v) },
    removeItem: (k: string) => { touched.add(k); values.delete(k) },
  })
  return { values, touched }
}
it("saves, restores and clears reconnect sessions by room code", () => {
  const { values } = storage(), session = { playerId: "p", token: "existing-secret" }
  saveSession("ABC123", session)
  expect(values.get("trovekit:session:ABC123")).toBe(JSON.stringify(session))
  expect(loadSession("abc123")).toEqual(session)
  clearSession("ABC123")
  expect(loadSession("ABC123")).toBeNull()
  expect(values.size).toBe(0)
})
it("keeps preferences and sessions under the trovekit namespace only", () => {
  const { values, touched } = storage()
  writeStored("theme", "dark")
  writeStored("last", "ABC123")
  expect(readStored("theme")).toBe("dark")
  expect(readStored("last")).toBe("ABC123")
  removeStored("theme")
  expect(readStored("theme")).toBeNull()
  saveSession("ABC123", { playerId: "p", token: "t" })
  loadSession("ABC123")
  clearSession("ABC123")
  expect([...values.keys()]).toEqual(["trovekit:last"])
  expect([...touched].filter((k) => !k.startsWith("trovekit:"))).toEqual([])
})
