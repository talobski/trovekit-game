import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  applyAction,
  createContext,
  projectGame,
  setupGame,
  type Action,
  type GameContext,
  type GameState,
  type PublicGameState,
} from "../src/engine/index.ts"
import { botSeed, chooseBotAction, legalActions, type BotLevel } from "../src/bots/index.ts"
import { recoverRoom } from "./saved-room.ts"
import { packBrand } from "../src/shared/content.ts"
import type { ResourceIcon } from "../src/engine/schema.ts"
import { contentHash, writeJsonAtomic, type Content, type ContentStore } from "./content-store.ts"

export type RoomStatus = "lobby" | "playing" | "finished" | "abandoned"

interface RoomPlayer {
  id: string
  name: string
  /** Empty for bots: no session can ever match a bot. */
  tokenHash: string
  joinedAt: string
  bot?: BotLevel
}

interface ProcessedAction {
  actionId: string
  playerId: string
  revision: number
}

/**
 * Saved room format. Rooms embed a content snapshot and engine state, so a room
 * written in any other format is never loaded: the engine would misread it.
 */
export const ROOM_FORMAT_VERSION = 2

export interface Room {
  formatVersion: typeof ROOM_FORMAT_VERSION
  code: string
  /** Display name (blank input means DEFAULT_ROOM_NAME). */
  name: string
  /**
   * The exact published version this room plays, pinned when the room is
   * created. Only waiting rooms saved before pinning lack it; they cannot start.
   */
  selectedVersion?: string
  createdAt: string
  updatedAt: string
  status: RoomStatus
  hostId: string
  players: RoomPlayer[]
  snapshot: { versionId: string; hash: string; content: Content } | null
  game: GameState | null
  processed: ProcessedAction[]
}

export interface RoomView {
  code: string
  name: string
  status: RoomStatus
  hostId: string
  players: { id: string; name: string; connected: boolean; bot: BotLevel | null }[]
  maxPlayers: number
  minPlayers: number
  /** The room's own pinned version, never the current default. `title` and `icon` name the game to players. */
  content: { hash: string; name: string; version: string; targetPoints: number; title: string; icon: ResourceIcon | null }
  /** Set when a waiting room's content can no longer be used; it can only be left. */
  problem: { code: string; message: string } | null
  game: PublicGameState | null
  revision: number
}

export class RoomError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const HOUR = 3600_000
export const EXPIRY = { lobby: 24 * HOUR, playing: 7 * 24 * HOUR, finished: 24 * HOUR, abandoned: 24 * HOUR }
const MAX_PROCESSED = 200
const MAX_ROOM_BYTES = 8 * 1024 * 1024

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

export interface RoomServiceOptions {
  now?: () => number
  /** Pause before a bot moves, so people can follow along. */
  botDelayMs?: number
  /** Game seeds; random by default. Fixed in tests to make bot games reproducible. */
  seed?: () => string
  maxRooms?: number
  roomIdleMs?: number
}

export const DEFAULT_BOT_DELAY_MS = 1200

export const DEFAULT_ROOM_NAME = "Trovekit Game Room"

/** Room names are optional; blank means the default. */
export function cleanRoomName(input: unknown): string {
  if (input === undefined || input === null) return DEFAULT_ROOM_NAME
  if (typeof input !== "string") throw new RoomError(400, "INVALID_ROOM_NAME", "Enter a room name or leave it blank")
  const name = input.replace(/[\u0000-\u001F\u007F<>]/g, "").replace(/\s+/g, " ").trim()
  if (!name) return DEFAULT_ROOM_NAME
  if ([...name].length > 40) throw new RoomError(400, "INVALID_ROOM_NAME", "Use 40 characters or fewer for the room name")
  return name
}

export function cleanName(input: unknown): string {
  if (typeof input !== "string") throw new RoomError(400, "INVALID_NAME", "Enter a name")
  const name = input.replace(/[\u0000-\u001F\u007F<>]/g, "").replace(/\s+/g, " ").trim()
  if (!name) throw new RoomError(400, "INVALID_NAME", "Enter a name")
  if ([...name].length > 20) throw new RoomError(400, "INVALID_NAME", "Use 20 characters or fewer")
  return name
}

/** An empty library, or no default chosen: new rooms need a default version. */
function noContent(): never {
  throw new RoomError(409, "NO_CONTENT", "No game is available yet. Rooms can be created once a published version is made the default.")
}

type LobbyContent = { ok: true; id: string; content: Content; hash: string } | { ok: false; code: string; message: string }

export class RoomService {
  private readonly rooms = new Map<string, Room>()
  private readonly contexts = new Map<string, GameContext>()
  private readonly dir: string
  private readonly store: ContentStore
  private readonly now: () => number
  /** playerId -> open connection count, per room. Presence only; never persisted. */
  private readonly presence = new Map<string, Map<string, number>>()
  private readonly listeners = new Set<(code: string) => void>()
  private readonly botTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly botDelayMs: number
  private storageHealthy = true
  private recoveryHealthy = true
  private readonly seed: () => string
  private readonly maxRooms: number
  private readonly roomIdleMs: number

  constructor(dataDir: string, store: ContentStore, options: RoomServiceOptions = {}) {
    this.dir = join(dataDir, "rooms")
    this.store = store
    this.now = options.now ?? Date.now
    this.botDelayMs = options.botDelayMs ?? DEFAULT_BOT_DELAY_MS
    this.maxRooms = options.maxRooms ?? 100
    this.roomIdleMs = options.roomIdleMs ?? EXPIRY.playing
    this.seed = options.seed ?? (() => randomBytes(16).toString("hex"))
    mkdirSync(this.dir, { recursive: true })
    this.load()
  }

  private load() {
    for (const file of readdirSync(this.dir)) {
      if (!/^[A-Z0-9]{6}\.json$/.test(file)) continue
      try {
        if (statSync(join(this.dir, file)).size > MAX_ROOM_BYTES) throw new Error("Room exceeds 8 MB")
        const room = JSON.parse(readFileSync(join(this.dir, file), "utf8")) as Room
        // Other formats (including rooms saved before Schema v2) are skipped and left on disk untouched.
        if (room?.formatVersion !== ROOM_FORMAT_VERSION) {
          console.warn(`Skipping room ${file}: unsupported format ${room?.formatVersion ?? "(none)"}`)
          continue
        }
        this.rooms.set(room.code, recoverRoom(room, file))
      } catch (e) {
        this.recoveryHealthy = false
        console.error(`Skipping invalid room ${file}: ${(e as Error).message}`)
      }
    }
    this.sweep()
    if (this.rooms.size > this.maxRooms) throw new Error(`Saved rooms exceed MAX_ROOMS (${this.maxRooms}); raise the limit before starting`)
    // Games interrupted on a bot's turn carry on after a restart.
    for (const room of this.rooms.values()) this.scheduleBot(room)
  }

  onChange(listener: (code: string) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get healthy() { return this.storageHealthy && this.recoveryHealthy }

  private persist(room: Room) {
    room.updatedAt = new Date(this.now()).toISOString()
    if (Buffer.byteLength(JSON.stringify(room)) > MAX_ROOM_BYTES) throw new RoomError(503, "ROOM_SIZE_LIMIT", "This room has reached its storage limit; the host can end it")
    try { writeJsonAtomic(join(this.dir, `${room.code}.json`), room) }
    catch (e) {
      this.storageHealthy = false
      this.contexts.delete(room.code)
      console.error("Room persistence failed", e)
      throw new RoomError(503, "STORAGE_UNAVAILABLE", "The server could not save this change. Please retry later.")
    }
    this.storageHealthy = true
    this.rooms.set(room.code, room)
    for (const l of this.listeners) l(room.code)
    this.scheduleBot(room)
  }

  private mutable(code: unknown, token: unknown) {
    const { room, player } = this.authenticate(code, token)
    return { room: structuredClone(room), player }
  }

  /** If a bot is up, let it move after the delay. Each room has at most one pending bot move. */
  private scheduleBot(room: Room, retry = false) {
    const game = room.game
    if (room.status !== "playing" || !game || this.botTimers.has(room.code)) return
    const level = room.players.find((p) => p.id === game.players[game.active].id)?.bot
    if (!level) return
    const revision = game.revision
    const timer = setTimeout(() => {
      this.botTimers.delete(room.code)
      try { this.playBot(room.code, revision) }
      catch (e) {
        console.error(`Bot turn could not be saved in ${room.code}`, e)
        const current = this.rooms.get(room.code)
        if (current) this.scheduleBot(current, true)
      }
    }, retry ? Math.max(5000, this.botDelayMs) : this.botDelayMs)
    timer.unref?.()
    this.botTimers.set(room.code, timer)
  }

  /** A bot turn goes through the same engine as a human turn. */
  private playBot(code: string, revision: number) {
    const saved = this.rooms.get(code)
    const room = saved ? structuredClone(saved) : undefined
    const game = room?.game
    if (!room || !game || room.status !== "playing" || game.revision !== revision) return
    const id = game.players[game.active].id
    const level = room.players.find((p) => p.id === id)?.bot
    if (!level) return
    const ctx = this.context(room)
    let result = applyAction(ctx, game, id, chooseBotAction(level, ctx, game, botSeed(game.seed, revision, game.active)))
    if (!result.ok) {
      // Should not happen: the bot only proposes engine-checked moves. Never leave a game stuck on a bot.
      console.error(`Bot move rejected in ${code}: ${result.error.code}`)
      result = applyAction(ctx, game, id, legalActions(ctx, game)[0])
      if (!result.ok) return
    }
    room.game = result.state
    if (room.game.status === "finished") room.status = "finished"
    this.persist(room)
  }

  /** Stop pending bot moves (server shutdown). */
  dispose() {
    for (const timer of this.botTimers.values()) clearTimeout(timer)
    this.botTimers.clear()
  }

  /** Remove rooms idle past their expiry. Returns removed codes. */
  sweep(): string[] {
    const removed: string[] = []
    for (const room of this.rooms.values()) {
      if (this.now() - Date.parse(room.updatedAt) > Math.min(EXPIRY[room.status], this.roomIdleMs)) {
        try { rmSync(join(this.dir, `${room.code}.json`), { force: true }) }
        catch (e) { this.storageHealthy = false; console.error(`Could not delete expired room ${room.code}`, e) }
        this.release(room.code)
        removed.push(room.code)
      }
    }
    return removed
  }

  private release(code: string) {
    this.rooms.delete(code)
    this.contexts.delete(code)
    this.presence.delete(code)
    clearTimeout(this.botTimers.get(code))
    this.botTimers.delete(code)
    for (const l of this.listeners) l(code)
  }

  /** Used before each live update and heartbeat, including after leave/expiry. */
  hasSession(code: string, playerId: string): boolean {
    try { return this.room(code).players.some(p => p.id === playerId && !p.bot) } catch { return false }
  }

  private newCode(): string {
    for (;;) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("")
      if (!this.rooms.has(code) && !existsSync(join(this.dir, `${code}.json`))) return code
    }
  }

  private room(code: unknown): Room {
    const key = typeof code === "string" ? code.toUpperCase() : ""
    const room = this.rooms.get(key)
    if (!room || this.now() - Date.parse(room.updatedAt) > Math.min(EXPIRY[room.status], this.roomIdleMs))
      throw new RoomError(404, "ROOM_NOT_FOUND", "This room does not exist or has expired")
    return room
  }

  private context(room: Room): GameContext {
    let ctx = this.contexts.get(room.code)
    if (!ctx) {
      if (!room.snapshot) throw new RoomError(409, "NOT_STARTED", "The game has not started")
      ctx = createContext(room.snapshot.content.pack, room.snapshot.content.rules)
      this.contexts.set(room.code, ctx)
    }
    return ctx
  }

  /** Resolve a session token to a player. Room codes alone never authorize anything. */
  authenticate(code: unknown, token: unknown): { room: Room; player: RoomPlayer } {
    const room = this.room(code)
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new RoomError(401, "UNAUTHORIZED", "Your session for this room is not valid")
    const hash = Buffer.from(hashToken(token), "hex")
    const player = room.players.find((p) => !p.bot && p.tokenHash.length === 64 && timingSafeEqual(Buffer.from(p.tokenHash, "hex"), hash))
    if (!player) throw new RoomError(401, "UNAUTHORIZED", "Your session for this room is not valid")
    return { room, player }
  }

  private addPlayer(room: Room, name: string) {
    const token = randomBytes(32).toString("base64url")
    const player: RoomPlayer = { id: randomUUID(), name, tokenHash: hashToken(token), joinedAt: new Date(this.now()).toISOString() }
    room.players.push(player)
    return { player, token }
  }

  /**
   * A waiting room's pinned version. It never falls back to the current
   * default: a room either plays exactly what it was created with or explains
   * why it cannot. Archiving a pack or changing the default does not affect it.
   */
  private lobbyContent(room: Room): LobbyContent {
    if (!room.selectedVersion) return { ok: false, code: "ROOM_UNPINNED", message: "This room was created before game versions were fixed per room, so it cannot start. Leave it and create a new room." }
    let version: ReturnType<ContentStore["version"]> = null
    // Only verified content is used; anything unreadable (even the index) means unavailable, never a crash.
    try { version = this.store.version(room.selectedVersion) } catch (e) { console.error(`Room ${room.code}: cannot read its version`, e) }
    if (!version) return { ok: false, code: "PACK_UNAVAILABLE", message: "This room's game version is no longer available. Leave it and create a new room." }
    return { ok: true, ...version }
  }

  private selectedContent(room: Room) {
    const content = this.lobbyContent(room)
    if (!content.ok) throw new RoomError(409, content.code, content.message)
    return content
  }

  create(nameInput: unknown, roomNameInput?: unknown, packVersionInput?: unknown) {
    this.sweep()
    if (this.rooms.size >= this.maxRooms) throw new RoomError(503, "ROOM_LIMIT", "The server has reached its room limit; try again later")
    // New public rooms always use the default version; there is no way to request another one.
    if (packVersionInput !== undefined && packVersionInput !== "active") throw new RoomError(400, "INVALID_PACK", "New rooms use the default game")
    const pinned = this.store.active() ?? noContent()
    const name = cleanName(nameInput)
    const roomName = cleanRoomName(roomNameInput)
    const at = new Date(this.now()).toISOString()
    const room: Room = {
      formatVersion: ROOM_FORMAT_VERSION,
      code: this.newCode(),
      name: roomName,
      selectedVersion: pinned.id,
      createdAt: at,
      updatedAt: at,
      status: "lobby",
      hostId: "",
      players: [],
      snapshot: null,
      game: null,
      processed: [],
    }
    const { player, token } = this.addPlayer(room, name)
    room.hostId = player.id
    this.persist(room)
    return { code: room.code, playerId: player.id, token }
  }

  join(code: unknown, nameInput: unknown) {
    const room = structuredClone(this.room(code))
    const name = cleanName(nameInput)
    if (room.status !== "lobby") throw new RoomError(409, room.status === "playing" ? "ROOM_STARTED" : "ROOM_ENDED", room.status === "playing" ? "This game has already started" : "This game has ended")
    const { max } = this.selectedContent(room).content.rules.playerCounts
    if (room.players.length >= max) throw new RoomError(409, "ROOM_FULL", `This room is full (${max} players)`)
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
      throw new RoomError(409, "NAME_TAKEN", "Someone in this room already uses that name")
    const { player, token } = this.addPlayer(room, name)
    this.persist(room)
    return { code: room.code, playerId: player.id, token }
  }

  leave(code: unknown, token: unknown) {
    const { room, player } = this.mutable(code, token)
    if (room.status !== "lobby") throw new RoomError(409, "ROOM_STARTED", "You cannot leave a game in progress. The host can end it.")
    room.players = room.players.filter((p) => p.id !== player.id)
    const human = room.players.find((p) => !p.bot)
    if (!human) {
      try { rmSync(join(this.dir, `${room.code}.json`), { force: true }) }
      catch (e) {
        this.storageHealthy = false
        console.error("Room deletion failed", e)
        throw new RoomError(503, "STORAGE_UNAVAILABLE", "The server could not save this change. Please retry later.")
      }
      this.storageHealthy = true
      this.release(room.code)
      return
    }
    if (room.hostId === player.id) room.hostId = human.id
    this.persist(room)
  }

  /** Host adds a bot seat in the lobby. Bots count toward the player limit. */
  addBot(code: unknown, token: unknown, level: BotLevel = "normal") {
    const { room, player } = this.mutable(code, token)
    if (room.hostId !== player.id) throw new RoomError(403, "NOT_HOST", "Only the host can add bots")
    if (room.status !== "lobby") throw new RoomError(409, "ROOM_STARTED", "This game has already started")
    const { max } = this.selectedContent(room).content.rules.playerCounts
    if (room.players.length >= max) throw new RoomError(409, "ROOM_FULL", `This room is full (${max} players)`)
    const taken = new Set(room.players.map((p) => p.name.toLowerCase()))
    let n = 1
    while (taken.has(`bot ${n}`)) n++
    room.players.push({ id: randomUUID(), name: `Bot ${n}`, tokenHash: "", joinedAt: new Date(this.now()).toISOString(), bot: level })
    this.persist(room)
  }

  removeBot(code: unknown, token: unknown, botId: unknown) {
    const { room, player } = this.mutable(code, token)
    if (room.hostId !== player.id) throw new RoomError(403, "NOT_HOST", "Only the host can remove bots")
    if (room.status !== "lobby") throw new RoomError(409, "ROOM_STARTED", "This game has already started")
    if (!room.players.some((p) => p.id === botId && p.bot)) throw new RoomError(404, "NOT_A_BOT", "That bot is not in this room")
    room.players = room.players.filter((p) => p.id !== botId)
    this.persist(room)
  }

  start(code: unknown, token: unknown) {
    const { room, player } = this.mutable(code, token)
    if (room.hostId !== player.id) throw new RoomError(403, "NOT_HOST", "Only the host can start the game")
    if (room.status !== "lobby") throw new RoomError(409, "ROOM_STARTED", "This game has already started")
    const active = this.selectedContent(room)
    const { min, max } = active.content.rules.playerCounts
    if (room.players.length < min || room.players.length > max)
      throw new RoomError(409, "PLAYER_COUNT", `Games need ${min}-${max} players`)
    const content = structuredClone(active.content)
    room.snapshot = { versionId: active.id, hash: contentHash(content), content }
    this.contexts.delete(room.code)
    room.game = setupGame(this.context(room), room.players.map((p) => ({ id: p.id, name: p.name })), this.seed())
    room.status = "playing"
    this.persist(room)
  }

  /** Host ends a game early (for example when a player has gone). No winner is declared. */
  end(code: unknown, token: unknown) {
    const { room, player } = this.mutable(code, token)
    if (room.hostId !== player.id) throw new RoomError(403, "NOT_HOST", "Only the host can end the game")
    if (room.status !== "playing") throw new RoomError(409, "NOT_PLAYING", "There is no game in progress")
    room.status = "abandoned"
    this.persist(room)
  }

  act(code: unknown, token: unknown, body: unknown) {
    const { room, player } = this.mutable(code, token)
    const { actionId, expectedRevision, action } = (body ?? {}) as { actionId?: unknown; expectedRevision?: unknown; action?: unknown }
    if (typeof actionId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(actionId))
      throw new RoomError(400, "INVALID_REQUEST", "Missing action id")
    const seen = room.processed.find((p) => p.actionId === actionId)
    if (seen) {
      if (seen.playerId !== player.id) throw new RoomError(409, "DUPLICATE_ACTION", "That action id was already used")
      return { replayed: true, revision: seen.revision }
    }
    if (room.status === "abandoned") throw new RoomError(409, "ROOM_ENDED", "The host ended this game")
    if (room.status !== "playing" || !room.game) throw new RoomError(409, room.status === "lobby" ? "NOT_STARTED" : "ROOM_ENDED", room.status === "lobby" ? "The game has not started" : "This game has ended")
    if (expectedRevision !== room.game.revision)
      throw new RoomError(409, "STALE_REVISION", "The game moved on. Your view has been refreshed.", { revision: room.game.revision })
    const result = applyAction(this.context(room), room.game, player.id, action as Action)
    if (!result.ok) throw new RoomError(422, result.error.code, result.error.message, result.error.details)
    room.game = result.state
    if (room.game.status === "finished") room.status = "finished"
    room.processed.push({ actionId, playerId: player.id, revision: room.game.revision })
    if (room.processed.length > MAX_PROCESSED) room.processed.splice(0, room.processed.length - MAX_PROCESSED)
    this.persist(room)
    return { replayed: false, revision: room.game.revision }
  }

  content(code: unknown, token: unknown): Content & { hash: string } {
    const { room } = this.authenticate(code, token)
    if (room.snapshot) return { ...room.snapshot.content, hash: room.snapshot.hash }
    const active = this.selectedContent(room)
    return { ...active.content, hash: active.hash }
  }

  view(code: unknown, token: unknown): RoomView {
    return this.viewOf(this.authenticate(code, token).room)
  }

  /** Public summary for the join screen: no game state, no player ids. */
  preview(code: unknown) {
    const room = this.room(code)
    const lobby = room.snapshot ? null : this.lobbyContent(room)
    const content = room.snapshot?.content ?? (lobby?.ok ? lobby.content : null)
    const { max } = content?.rules.playerCounts ?? { max: room.players.length }
    return { code: room.code, name: room.name, status: room.status, players: room.players.map((p) => p.name), maxPlayers: max, ...(content ? packBrand(content.pack) : { title: "", icon: null }) }
  }

  viewOf(room: Room): RoomView {
    // Never throws: views are also pushed to every socket on each change.
    const lobby = room.snapshot ? null : this.lobbyContent(room)
    const content = room.snapshot ?? (lobby?.ok ? lobby : null)
    const connected = this.presence.get(room.code)
    return {
      code: room.code,
      name: room.name,
      status: room.status,
      hostId: room.hostId,
      players: room.players.map((p) => ({ id: p.id, name: p.name, connected: !!p.bot || (connected?.get(p.id) ?? 0) > 0, bot: p.bot ?? null })),
      minPlayers: content?.content.rules.playerCounts.min ?? room.players.length,
      maxPlayers: content?.content.rules.playerCounts.max ?? room.players.length,
      content: content
        ? { hash: content.hash, name: content.content.pack.name, version: content.content.pack.version, targetPoints: content.content.rules.targetPoints, ...packBrand(content.content.pack) }
        : { hash: "", name: "", version: "", targetPoints: 0, title: "", icon: null },
      problem: lobby && !lobby.ok ? { code: lobby.code, message: lobby.message } : null,
      game: room.game ? projectGame(room.game) : null,
      revision: room.game?.revision ?? 0,
    }
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code)
  }

  connect(code: string, playerId: string) {
    const map = this.presence.get(code) ?? new Map<string, number>()
    map.set(playerId, (map.get(playerId) ?? 0) + 1)
    this.presence.set(code, map)
    for (const l of this.listeners) l(code)
  }

  disconnect(code: string, playerId: string) {
    const map = this.presence.get(code)
    if (!map) return
    const count = (map.get(playerId) ?? 0) - 1
    if (count > 0) map.set(playerId, count); else map.delete(playerId)
    if (!map.size) this.presence.delete(code)
    for (const l of this.listeners) l(code)
  }
}
