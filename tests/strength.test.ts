import { describe, expect, it } from "vitest"
import { createContext, setupGame, type PlayerState } from "../src/engine"
import { resourceStrength, strengthColumns } from "../src/app/game/strength"
import { gemPack } from "./fixtures"
import { starfallContent } from "./fixtures/starfall"

const { pack, rules } = starfallContent()
const ctx = createContext(pack, rules)
const fresh = (): PlayerState => structuredClone(setupGame(ctx, [{ id: "a", name: "Ana" }, { id: "b", name: "Ben" }], "strength").players[0])
const cardWith = (kind: string) => pack.cards.find((c) => c.permanentResource === kind)!.id
const totals = (p: PlayerState, c = ctx) => Object.fromEntries(resourceStrength(c, p).kinds.map((k) => [k.kind, k.total]))

describe("resource strength (held Prospects plus permanent contribution)", () => {
  it("counts held Prospects even with nothing recruited (the ticket's screenshot case)", () => {
    const p = fresh()
    p.resources = { ...p.resources, ember: 1, tide: 1, spark: 1 }
    expect(totals(p)).toEqual({ ember: 1, tide: 1, gale: 0, stone: 0, spark: 1 })
  })

  it("adds recruited cards' permanent contribution, and keeps wildcards separate", () => {
    const p = fresh()
    p.resources = { ...p.resources, tide: 2 }
    p.acquired = [cardWith("tide")]
    p.wildcards = 1
    const s = resourceStrength(ctx, p)
    expect(s.kinds.find((k) => k.kind === "tide")).toEqual({ kind: "tide", held: 2, permanent: 1, total: 3 })
    expect(s.wildcards).toBe(1)
    // Wildcards are never spread across kinds.
    expect(s.kinds.filter((k) => k.kind !== "tide").every((k) => k.total === 0)).toBe(true)
  })

  it("is all zeros for a new player, and follows spending and collecting", () => {
    const p = fresh()
    expect(resourceStrength(ctx, p)).toEqual({ kinds: ctx.kinds.map((kind) => ({ kind, held: 0, permanent: 0, total: 0 })), wildcards: 0 })
    p.resources = { ...p.resources, stone: 3 }
    p.acquired = [cardWith("stone"), cardWith("gale")]
    expect(totals(p)).toMatchObject({ stone: 4, gale: 1 })
    p.resources = { ...p.resources, stone: 0 } // spent
    expect(totals(p)).toMatchObject({ stone: 1, gale: 1 })
  })

  it("works for another pack's kinds", () => {
    const other = gemPack()
    const sctx = createContext(other, rules)
    const p = structuredClone(setupGame(sctx, [{ id: "a", name: "Ana" }, { id: "b", name: "Ben" }], "s").players[0])
    p.resources = { ...p.resources, sapphire: 2 }
    p.acquired = [other.cards.find((c) => c.permanentResource === "sapphire")!.id]
    expect(totals(p, sctx)).toEqual({ ruby: 0, sapphire: 3, emerald: 0, onyx: 0, pearl: 0 })
  })
})

describe("Resource strength order", () => {
  const order = (p: PlayerState) => strengthColumns(ctx, p).map((c) => `${c.id}:${c.total}`)

  it("keeps the pack's order, wildcards last, while everything is zero", () => {
    expect(order(fresh())).toEqual(["ember:0", "tide:0", "gale:0", "stone:0", "spark:0", "wild:0"])
  })

  it("puts the strongest first, counting permanent contribution and wildcards", () => {
    const p = fresh()
    p.resources = { ...p.resources, tide: 1, spark: 2 }
    p.acquired = [cardWith("spark"), cardWith("stone"), pack.cards.filter((c) => c.permanentResource === "stone")[1].id]
    p.wildcards = 2
    // spark 3, stone 2, wild 2, tide 1; ties keep the configured order (stone before wildcards).
    expect(order(p)).toEqual(["spark:3", "stone:2", "wild:2", "tide:1", "ember:0", "gale:0"])
  })

  it("keeps equal totals in configured order, and reorders as strength changes", () => {
    const p = fresh()
    p.resources = { ...p.resources, gale: 1, ember: 1 }
    expect(order(p).slice(0, 2)).toEqual(["ember:1", "gale:1"])
    p.resources.gale = 2
    expect(order(p).slice(0, 2)).toEqual(["gale:2", "ember:1"])
    // Display only: the underlying totals are the same numbers resourceStrength reports.
    expect(Object.fromEntries(strengthColumns(ctx, p).filter((c) => c.id !== "wild").map((c) => [c.id, c.total]))).toEqual(totals(p))
  })
})

