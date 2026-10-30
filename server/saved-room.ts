import { z } from "zod"
import { validateContent, type Content } from "../src/shared/content.ts"
import { contentHash } from "./content-store.ts"
import type { Room } from "./rooms.ts"

const id = z.string().min(1).max(128)
const count = z.number().int().min(0).max(1_000_000_000)
const counts = z.record(id, count)
const ids = z.array(id).max(400)
const date = z.string().refine(s => Number.isFinite(Date.parse(s)))
const player = z.strictObject({ id, name: z.string().min(1).max(80), resources: counts, wildcards: count, reserved: ids, acquired: ids, achievements: ids, turns: count })
const base = { revision: count }
const log = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("start"), firstPlayer: id }),
  z.strictObject({ ...base, type: z.literal("collect"), player: id, resources: counts }),
  z.strictObject({ ...base, type: z.literal("reserve"), player: id, card: id, wildcard: count }),
  z.strictObject({ ...base, type: z.literal("acquire"), player: id, card: id, paid: counts, wildcards: count, from: z.enum(["market", "reserved"]) }),
  z.strictObject({ ...base, type: z.literal("pass"), player: id }),
  z.strictObject({ ...base, type: z.literal("claim"), player: id, achievement: id }),
  z.strictObject({ ...base, type: z.literal("discard"), player: id, resources: counts, wildcards: count }),
  z.strictObject({ ...base, type: z.literal("final-round"), player: id }),
  z.strictObject({ ...base, type: z.literal("finish"), winners: ids }),
])
const game = z.strictObject({
  revision: count, status: z.enum(["playing", "finished"]), seed: id,
  players: z.array(player).min(2).max(4), firstPlayer: count, active: count, turn: count,
  supply: z.strictObject({ resources: counts, wildcards: count }),
  decks: z.record(id, ids), market: z.record(id, z.array(id.nullable()).max(400)),
  achievements: ids, claimed: z.record(id, id),
  finalRound: z.strictObject({ triggeredBy: id, turn: count }).nullable(),
  result: z.strictObject({ standings: z.array(z.strictObject({ playerId: id, points: count, acquired: count, rank: count })).max(4), winners: ids }).nullable(),
  // The entire file is byte-limited before parsing, matching the live writer.
  log: z.array(log),
})
const envelope = z.strictObject({
  formatVersion: z.literal(2), code: z.string().regex(/^[A-Z0-9]{6}$/), name: z.string().min(1).max(160),
  selectedVersion: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(), createdAt: date, updatedAt: date,
  status: z.enum(["lobby", "playing", "finished", "abandoned"]), hostId: id,
  players: z.array(z.strictObject({ id, name: z.string().min(1).max(80), tokenHash: z.string().regex(/^([a-f0-9]{64})?$/), joinedAt: date, bot: z.literal("normal").optional() })).min(1).max(4),
  snapshot: z.strictObject({ versionId: id, hash: z.string().regex(/^[a-f0-9]{64}$/), content: z.unknown() }).nullable(),
  game: game.nullable(), processed: z.array(z.strictObject({ actionId: id, playerId: id, revision: count })).max(200),
})

/** Validate persisted data before it can reach timers, auth or clients. Bad files
 * are reported and left intact for the operator; no migration is attempted.
 */
export function recoverRoom(input: unknown, filename: string): Room {
  const room = envelope.parse(input)
  if (`${room.code}.json` !== filename || !room.players.some(p => p.id === room.hostId && !p.bot) || new Set(room.players.map(p => p.id)).size !== room.players.length || room.players.some(p => p.bot ? p.tokenHash !== "" : p.tokenHash.length !== 64)) throw new Error("Invalid room identity or sessions")
  if ((room.status === "lobby") !== (room.game === null && room.snapshot === null)) throw new Error("Invalid room phase")
  if (room.snapshot) {
    if (room.selectedVersion && room.snapshot.versionId !== room.selectedVersion) throw new Error("Snapshot does not match the room's pinned version")
    const checked = validateContent(room.snapshot.content)
    if (!checked.ok || contentHash(checked.content) !== room.snapshot.hash) throw new Error("Invalid content snapshot")
    room.snapshot.content = checked.content
    const state = room.game
    if (!state || state.active >= state.players.length || state.firstPlayer >= state.players.length || state.players.length !== room.players.length || state.players.some((p, i) => p.id !== room.players[i].id)) throw new Error("Invalid game seats")
    if ((room.status === "finished") !== (state.status === "finished")) throw new Error("Invalid game status")
    const { pack } = checked.content
    const cards = new Set(pack.cards.map(c => c.id)), achievements = new Set(pack.achievements.map(a => a.id))
    const groups = new Set(pack.cardGroups.map(g => g.id)), kinds = new Set(pack.resourceKinds.map(k => k.id))
    const validCounts = (values: Record<string, number>) => Object.keys(values).length === kinds.size && Object.keys(values).every(k => kinds.has(k))
    if (!validCounts(state.supply.resources) || state.players.some(p => !validCounts(p.resources) || [...p.acquired, ...p.reserved].some(c => !cards.has(c)) || p.achievements.some(a => !achievements.has(a))) || state.achievements.some(a => !achievements.has(a))) throw new Error("Invalid game references")
    for (const stacks of [state.market, state.decks]) {
      if (Object.keys(stacks).length !== groups.size || Object.entries(stacks).some(([g, cs]) => !groups.has(g) || cs.some(c => c !== null && !cards.has(c)))) throw new Error("Invalid game decks")
    }
  }
  return room as Omit<typeof room, "snapshot"> & { snapshot: { versionId: string; hash: string; content: Content } | null }
}
