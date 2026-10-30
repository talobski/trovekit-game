import { evaluate, indexPack, type PackIndex } from "./predicates"
import { createRng } from "./rng"
import type { Card, Pack, Rules } from "./schema"

/*
 * Generic, deterministic rules engine. Pure functions over plain JSON state:
 * applyAction never mutates its input, and a rejected action changes nothing.
 * Vocabulary is generic: resource kinds, resources, wildcards, card groups
 * (tiered or unique), reserve, acquire, achievements. Packs supply the labels.
 */

export type ResourceCounts = Record<string, number>

export interface PlayerState {
  id: string
  name: string
  resources: ResourceCounts
  wildcards: number
  reserved: string[]
  acquired: string[]
  achievements: string[]
  turns: number
}

export interface Standing {
  playerId: string
  points: number
  acquired: number
  rank: number
}

export interface GameResult {
  standings: Standing[]
  winners: string[]
}

export type LogEntry =
  | { revision: number; type: "start"; firstPlayer: string }
  | { revision: number; type: "collect"; player: string; resources: ResourceCounts }
  | { revision: number; type: "reserve"; player: string; card: string; wildcard: number }
  | { revision: number; type: "acquire"; player: string; card: string; paid: ResourceCounts; wildcards: number; from: "market" | "reserved" }
  | { revision: number; type: "pass"; player: string }
  | { revision: number; type: "claim"; player: string; achievement: string }
  | { revision: number; type: "discard"; player: string; resources: ResourceCounts; wildcards: number }
  | { revision: number; type: "final-round"; player: string }
  | { revision: number; type: "finish"; winners: string[] }

export interface GameState {
  revision: number
  status: "playing" | "finished"
  seed: string
  players: PlayerState[]
  firstPlayer: number
  active: number
  /** Completed turns across all players. */
  turn: number
  supply: { resources: ResourceCounts; wildcards: number }
  decks: Record<string, string[]>
  market: Record<string, (string | null)[]>
  /** Drawn achievements, in pack order. Claimed ones stay listed; see `claimed`. */
  achievements: string[]
  claimed: Record<string, string>
  finalRound: { triggeredBy: string; turn: number } | null
  result: GameResult | null
  log: LogEntry[]
}

export interface Discard {
  resources?: ResourceCounts
  wildcards?: number
}

export type Action =
  | { type: "collect"; take: ResourceCounts; discard?: Discard }
  | { type: "reserve"; cardId: string; discard?: Discard }
  | { type: "acquire"; cardId: string; wildcards?: ResourceCounts; discard?: Discard }
  | { type: "pass" }

export type ErrorCode =
  | "GAME_OVER"
  | "NOT_A_PLAYER"
  | "NOT_YOUR_TURN"
  | "INVALID_ACTION"
  | "INVALID_COLLECT"
  | "RESERVE_FULL"
  | "NOT_RESERVABLE"
  | "CARD_UNAVAILABLE"
  | "UNIQUE_LIMIT"
  | "CANNOT_AFFORD"
  | "INVALID_PAYMENT"
  | "DISCARD_REQUIRED"
  | "INVALID_DISCARD"
  | "PASS_NOT_ALLOWED"

export interface GameError {
  code: ErrorCode
  message: string
  details?: Record<string, number | string>
}

export type ActionResult = { ok: true; state: GameState; events: LogEntry[] } | { ok: false; error: GameError }

export interface GameContext {
  pack: Pack
  rules: Rules
  index: PackIndex
  kinds: string[]
}

export function createContext(pack: Pack, rules: Rules): GameContext {
  return { pack, rules, index: indexPack(pack), kinds: pack.resourceKinds.map((k) => k.id) }
}

const zeroCounts = (kinds: string[]): ResourceCounts => Object.fromEntries(kinds.map((k) => [k, 0]))
const sum = (counts: ResourceCounts | undefined) => Object.values(counts ?? {}).reduce((a, b) => a + b, 0)

export function setupGame(ctx: GameContext, players: { id: string; name: string }[], seed: string): GameState {
  const { rules, pack, kinds } = ctx
  const n = players.length
  if (n < rules.playerCounts.min || n > rules.playerCounts.max)
    throw new Error(`This ruleset supports ${rules.playerCounts.min}-${rules.playerCounts.max} players`)
  const key = String(n) as "2" | "3" | "4"
  const rng = createRng(seed)

  const decks: Record<string, string[]> = {}
  const market: Record<string, (string | null)[]> = {}
  for (const group of pack.cardGroups) {
    const deck = rng.shuffle(pack.cards.filter((c) => c.group === group.id).map((c) => c.id))
    const slots = group.kind === "tiered" ? rules.market.tieredSlots : rules.market.uniqueSlots
    market[group.id] = Array.from({ length: slots }, () => deck.shift() ?? null)
    decks[group.id] = deck
  }

  const drawn = new Set(rng.shuffle(pack.achievements.map((a) => a.id)).slice(0, rules.achievementsDrawn[key]))
  const achievements = pack.achievements.filter((a) => drawn.has(a.id)).map((a) => a.id)

  const supplyResources = Object.fromEntries(kinds.map((k) => [k, rules.resourceSupply[key] - rules.startingResources * n]))
  const firstPlayer = rng.int(n)

  return {
    revision: 0,
    status: "playing",
    seed,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      resources: Object.fromEntries(kinds.map((k) => [k, rules.startingResources])),
      wildcards: 0,
      reserved: [],
      acquired: [],
      achievements: [],
      turns: 0,
    })),
    firstPlayer,
    active: firstPlayer,
    turn: 0,
    supply: { resources: supplyResources, wildcards: rules.wildcardSupply },
    decks,
    market,
    achievements,
    claimed: {},
    finalRound: null,
    result: null,
    log: [{ revision: 0, type: "start", firstPlayer: players[firstPlayer].id }],
  }
}

// ---------------------------------------------------------------------------
// Derived values

export function permanentResources(ctx: GameContext, player: PlayerState): ResourceCounts {
  const out = zeroCounts(ctx.kinds)
  for (const id of player.acquired) {
    const card = ctx.index.cards.get(id)
    if (card) out[card.permanentResource] = (out[card.permanentResource] ?? 0) + 1
  }
  return out
}

export function points(ctx: GameContext, player: PlayerState): number {
  let total = 0
  for (const id of player.acquired) total += ctx.index.cards.get(id)?.points ?? 0
  for (const id of player.achievements) total += ctx.pack.achievements.find((a) => a.id === id)?.points ?? 0
  return total
}

export function heldTotal(player: PlayerState): number {
  return sum(player.resources) + player.wildcards
}

/** Cost still owed per kind after permanent discounts. */
export function dueCost(ctx: GameContext, player: PlayerState, card: Card): ResourceCounts {
  const permanent = permanentResources(ctx, player)
  const out: ResourceCounts = {}
  for (const kind of ctx.kinds) {
    const due = Math.max(0, (card.cost[kind] ?? 0) - (permanent[kind] ?? 0))
    if (due > 0) out[kind] = due
  }
  return out
}

export interface Payment {
  resources: ResourceCounts
  wildcards: ResourceCounts
  wildcardTotal: number
}

/**
 * Resolve how a player pays for a card. With no explicit wildcard allocation,
 * held resources are used first and wildcards cover any shortfall.
 */
export function resolvePayment(
  ctx: GameContext,
  player: PlayerState,
  card: Card,
  wildcards?: ResourceCounts
): { ok: true; payment: Payment } | { ok: false; error: GameError } {
  const due = dueCost(ctx, player, card)
  const resources: ResourceCounts = {}
  const wild: ResourceCounts = {}
  if (wildcards) {
    for (const [kind, n] of Object.entries(wildcards)) {
      if (!ctx.kinds.includes(kind) || !Number.isInteger(n) || n < 0)
        return { ok: false, error: { code: "INVALID_PAYMENT", message: "Wildcard allocation is not valid" } }
      if (n > (due[kind] ?? 0))
        return { ok: false, error: { code: "INVALID_PAYMENT", message: "Wildcards exceed the amount due" } }
    }
  }
  for (const [kind, n] of Object.entries(due)) {
    const held = player.resources[kind] ?? 0
    const w = wildcards ? (wildcards[kind] ?? 0) : Math.max(0, n - held)
    const t = n - w
    if (t > held)
      return { ok: false, error: { code: "CANNOT_AFFORD", message: "Not enough resources to acquire this card" } }
    if (t > 0) resources[kind] = t
    if (w > 0) wild[kind] = w
  }
  const wildcardTotal = sum(wild)
  if (wildcardTotal > player.wildcards)
    return { ok: false, error: { code: "CANNOT_AFFORD", message: "Not enough resources to acquire this card" } }
  return { ok: true, payment: { resources, wildcards: wild, wildcardTotal } }
}

export function uniqueCount(ctx: GameContext, player: PlayerState): number {
  return player.acquired.filter((id) => {
    const card = ctx.index.cards.get(id)
    return card && ctx.index.groupKind.get(card.group) === "unique"
  }).length
}

function findInMarket(state: GameState, cardId: string): { group: string; slot: number } | null {
  for (const [group, slots] of Object.entries(state.market)) {
    const slot = slots.indexOf(cardId)
    if (slot >= 0) return { group, slot }
  }
  return null
}

export type CollectCheck = { ok: true } | { ok: false; error: GameError }

export function checkCollect(ctx: GameContext, state: GameState, take: ResourceCounts): CollectCheck {
  const { collect } = ctx.rules
  const bad = (message: string): CollectCheck => ({ ok: false, error: { code: "INVALID_COLLECT", message } })
  const picked: string[] = []
  for (const [kind, n] of Object.entries(take)) {
    if (!ctx.kinds.includes(kind) || !Number.isInteger(n) || n < 0) return bad("Unknown resource selection")
    if (n > 0) picked.push(kind)
    if (n > (state.supply.resources[kind] ?? 0)) return bad("Not enough of that resource in the supply")
  }
  if (!picked.length) return bad("Choose at least one resource")
  if (picked.length === 1 && take[picked[0]] === collect.pair) {
    if ((state.supply.resources[picked[0]] ?? 0) < collect.pairMinSupply)
      return bad(`Taking ${collect.pair} of one kind needs at least ${collect.pairMinSupply} in the supply`)
    return { ok: true }
  }
  if (picked.some((k) => take[k] !== 1)) return bad(`Take ${collect.distinct} different resources or ${collect.pair} of one kind`)
  if (picked.length === collect.distinct) return { ok: true }
  const availableKinds = ctx.kinds.filter((k) => (state.supply.resources[k] ?? 0) > 0).length
  if (collect.allowPartialDistinct && availableKinds < collect.distinct && picked.length <= availableKinds) return { ok: true }
  return bad(`Take ${collect.distinct} different resources or ${collect.pair} of one kind`)
}

export function canCollect(ctx: GameContext, state: GameState): boolean {
  const { collect } = ctx.rules
  const available = ctx.kinds.filter((k) => (state.supply.resources[k] ?? 0) > 0)
  if (available.length >= collect.distinct) return true
  if (ctx.kinds.some((k) => (state.supply.resources[k] ?? 0) >= Math.max(collect.pairMinSupply, collect.pair))) return true
  return collect.allowPartialDistinct && available.length > 0
}

export function canReserveAny(ctx: GameContext, state: GameState, player: PlayerState): boolean {
  if (player.reserved.length >= ctx.rules.reserveCap) return false
  return ctx.pack.cardGroups.some((g) => g.kind === "tiered" && state.market[g.id]?.some(Boolean))
}

export function canAcquire(ctx: GameContext, state: GameState, player: PlayerState, cardId: string): GameError | null {
  const card = ctx.index.cards.get(cardId)
  const inMarket = findInMarket(state, cardId)
  if (!card || (!inMarket && !player.reserved.includes(cardId)))
    return { code: "CARD_UNAVAILABLE", message: "That card is not available to you" }
  if (ctx.index.groupKind.get(card.group) === "unique" && uniqueCount(ctx, player) >= ctx.rules.uniqueLimitPerPlayer)
    return { code: "UNIQUE_LIMIT", message: "Your collection already has one" }
  const pay = resolvePayment(ctx, player, card)
  return pay.ok ? null : pay.error
}

export function canAcquireAny(ctx: GameContext, state: GameState, player: PlayerState): boolean {
  const candidates = [...Object.values(state.market).flat(), ...player.reserved].filter((c): c is string => !!c)
  return candidates.some((id) => !canAcquire(ctx, state, player, id))
}

export function hasLegalAction(ctx: GameContext, state: GameState, player: PlayerState): boolean {
  return canCollect(ctx, state) || canReserveAny(ctx, state, player) || canAcquireAny(ctx, state, player)
}

export function rank(ctx: GameContext, state: GameState): GameResult {
  const rows = state.players.map((p) => ({ playerId: p.id, points: points(ctx, p), acquired: p.acquired.length }))
  const byFewest = ctx.rules.tieBreak === "fewest-acquired"
  const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    b.points - a.points || (byFewest ? a.acquired - b.acquired : 0)
  const sorted = rows.slice().sort(cmp)
  const standings: Standing[] = sorted.map((row) => ({ ...row, rank: 1 + sorted.filter((o) => cmp(o, row) < 0).length }))
  return { standings, winners: standings.filter((s) => s.rank === 1).map((s) => s.playerId) }
}

// ---------------------------------------------------------------------------
// Actions

function fail(code: ErrorCode, message: string, details?: GameError["details"]): ActionResult {
  return { ok: false, error: { code, message, details } }
}

export function applyAction(ctx: GameContext, input: GameState, playerId: string, action: Action): ActionResult {
  if (input.status !== "playing") return fail("GAME_OVER", "The game is over")
  const seat = input.players.findIndex((p) => p.id === playerId)
  if (seat < 0) return fail("NOT_A_PLAYER", "You are not in this game")
  if (seat !== input.active) return fail("NOT_YOUR_TURN", "It is not your turn")
  if (!action || typeof action !== "object") return fail("INVALID_ACTION", "Unknown action")

  const state = structuredClone(input) as GameState
  const player = state.players[seat]
  const revision = state.revision + 1
  const events: LogEntry[] = []
  const { rules } = ctx

  switch (action.type) {
    case "collect": {
      const take = action.take ?? {}
      const check = checkCollect(ctx, state, take)
      if (!check.ok) return { ok: false, error: check.error }
      const taken: ResourceCounts = {}
      for (const [kind, n] of Object.entries(take)) {
        if (!n) continue
        state.supply.resources[kind] -= n
        player.resources[kind] = (player.resources[kind] ?? 0) + n
        taken[kind] = n
      }
      events.push({ revision, type: "collect", player: player.id, resources: taken })
      break
    }
    case "reserve": {
      if (player.reserved.length >= rules.reserveCap)
        return fail("RESERVE_FULL", `You can hold at most ${rules.reserveCap} reserved cards`)
      const at = findInMarket(state, action.cardId)
      if (!at) return fail("CARD_UNAVAILABLE", "That card is not in the market")
      if (ctx.index.groupKind.get(at.group) !== "tiered") return fail("NOT_RESERVABLE", "That card cannot be reserved")
      state.market[at.group][at.slot] = state.decks[at.group].shift() ?? null
      player.reserved.push(action.cardId)
      const wildcard = Math.min(rules.wildcardsOnReserve, state.supply.wildcards)
      state.supply.wildcards -= wildcard
      player.wildcards += wildcard
      events.push({ revision, type: "reserve", player: player.id, card: action.cardId, wildcard })
      break
    }
    case "acquire": {
      const blocked = canAcquire(ctx, state, player, action.cardId)
      if (blocked && blocked.code !== "CANNOT_AFFORD") return { ok: false, error: blocked }
      const card = ctx.index.cards.get(action.cardId)!
      const pay = resolvePayment(ctx, player, card, action.wildcards)
      if (!pay.ok) return { ok: false, error: pay.error }
      for (const [kind, n] of Object.entries(pay.payment.resources)) {
        player.resources[kind] -= n
        state.supply.resources[kind] += n
      }
      player.wildcards -= pay.payment.wildcardTotal
      state.supply.wildcards += pay.payment.wildcardTotal
      const at = findInMarket(state, card.id)
      if (at) state.market[at.group][at.slot] = state.decks[at.group].shift() ?? null
      else player.reserved = player.reserved.filter((id) => id !== card.id)
      player.acquired.push(card.id)
      events.push({
        revision,
        type: "acquire",
        player: player.id,
        card: card.id,
        paid: pay.payment.resources,
        wildcards: pay.payment.wildcardTotal,
        from: at ? "market" : "reserved",
      })
      break
    }
    case "pass": {
      if (hasLegalAction(ctx, state, player)) return fail("PASS_NOT_ALLOWED", "You can still take an action")
      events.push({ revision, type: "pass", player: player.id })
      break
    }
    default:
      return fail("INVALID_ACTION", "Unknown action")
  }

  // Shared achievements: first qualifying player claims, in pack order, once.
  for (const id of state.achievements) {
    if (state.claimed[id]) continue
    const achievement = ctx.pack.achievements.find((a) => a.id === id)!
    if (evaluate(ctx.index, achievement.requirement, player)) {
      state.claimed[id] = player.id
      player.achievements.push(id)
      events.push({ revision, type: "claim", player: player.id, achievement: id })
    }
  }

  // Holding cap: the action must carry an exact discard selection when over the cap.
  const discard = "discard" in action ? action.discard : undefined
  const excess = heldTotal(player) - rules.holdingCap
  if (excess > 0) {
    if (!discard) return fail("DISCARD_REQUIRED", `Return ${excess} to stay at ${rules.holdingCap}`, { count: excess })
    const resources = discard.resources ?? {}
    const wildcards = discard.wildcards ?? 0
    if (!Number.isInteger(wildcards) || wildcards < 0 || wildcards > player.wildcards)
      return fail("INVALID_DISCARD", "Discard selection is not valid", { count: excess })
    for (const [kind, n] of Object.entries(resources)) {
      if (!ctx.kinds.includes(kind) || !Number.isInteger(n) || n < 0 || n > (player.resources[kind] ?? 0))
        return fail("INVALID_DISCARD", "Discard selection is not valid", { count: excess })
    }
    if (sum(resources) + wildcards !== excess)
      return fail("INVALID_DISCARD", `Return exactly ${excess}`, { count: excess })
    const returned: ResourceCounts = {}
    for (const [kind, n] of Object.entries(resources)) {
      if (!n) continue
      player.resources[kind] -= n
      state.supply.resources[kind] += n
      returned[kind] = n
    }
    player.wildcards -= wildcards
    state.supply.wildcards += wildcards
    events.push({ revision, type: "discard", player: player.id, resources: returned, wildcards })
  } else if (discard && (sum(discard.resources) > 0 || (discard.wildcards ?? 0) > 0)) {
    return fail("INVALID_DISCARD", "Nothing needs to be returned")
  }

  player.turns += 1
  state.turn += 1
  state.revision = revision

  if (!state.finalRound && points(ctx, player) >= rules.targetPoints) {
    state.finalRound = { triggeredBy: player.id, turn: state.turn }
    events.push({ revision, type: "final-round", player: player.id })
  }

  const next = (state.active + 1) % state.players.length
  if (state.finalRound && next === state.firstPlayer) {
    state.status = "finished"
    state.result = rank(ctx, state)
    events.push({ revision, type: "finish", winners: state.result.winners })
  } else {
    state.active = next
  }

  state.log.push(...events)
  return { ok: true, state, events }
}
