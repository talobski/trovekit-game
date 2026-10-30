import { readStored, writeStored, removeStored } from "@/lib/storage"
import { randomActionId } from "@/lib/random-id"
import type { Action, Pack, Rules } from "@/engine/client"
import type { ResourceIcon } from "@/engine/schema"
import type { RoomView } from "../../server/rooms"

export type { RoomView }

export interface Session {
  playerId: string
  token: string
}

export interface ApiError {
  status: number
  code: string
  message: string
  details?: Record<string, unknown>
}

export function isApiError(e: unknown): e is ApiError {
  return !!e && typeof e === "object" && "code" in e && "status" in e
}

const key = (code: string) => `session:${code.toUpperCase()}`

export function loadSession(code: string): Session | null {
  try {
    const raw = readStored(key(code))
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function saveSession(code: string, session: Session) {
  try {
    writeStored(key(code), JSON.stringify(session))
  } catch {
    /* Without storage the session lasts for this tab only. */
  }
}

export function clearSession(code: string) {
  try {
    removeStored(key(code))
  } catch {
    /* ignore */
  }
}

export async function request<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw { status: 0, code: "OFFLINE", message: "Can't reach the game server. Check your connection." } satisfies ApiError
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw { status: res.status, code: data.code ?? "ERROR", message: data.message ?? "Something went wrong", details: data.details } satisfies ApiError
  return data as T
}

export const api = {
  packs: () => request<{ id: string; name: string; packId: string; default: boolean; title: string; icon: ResourceIcon | null; description: string | null }[]>("/api/packs"),
  create: (name: string) => request<Session & { code: string }>("/api/rooms", { body: { name } }),
  join: (code: string, name: string) => request<Session & { code: string }>(`/api/rooms/${code}/join`, { body: { name } }),
  preview: (code: string) => request<{ code: string; name: string; status: RoomView["status"]; players: string[]; maxPlayers: number; title: string; icon: ResourceIcon | null }>(`/api/rooms/${code}/preview`),
  view: (code: string, token: string) => request<RoomView>(`/api/rooms/${code}`, { token }),
  content: (code: string, token: string) => request<{ pack: Pack; rules: Rules; hash: string }>(`/api/rooms/${code}/content`, { token }),
  addBot: (code: string, token: string) => request<RoomView>(`/api/rooms/${code}/add-bot`, { token, body: {} }),
  removeBot: (code: string, token: string, playerId: string) => request<RoomView>(`/api/rooms/${code}/remove-bot`, { token, body: { playerId } }),
  start: (code: string, token: string) => request<RoomView>(`/api/rooms/${code}/start`, { token, body: {} }),
  end: (code: string, token: string) => request<RoomView>(`/api/rooms/${code}/end`, { token, body: {} }),
  leave: (code: string, token: string) => request<{ ok: true }>(`/api/rooms/${code}/leave`, { token, body: {} }),
  act: (code: string, token: string, expectedRevision: number, action: Action) =>
    request<{ replayed: boolean; revision: number; room: RoomView }>(`/api/rooms/${code}/actions`, {
      token,
      body: { actionId: randomActionId(), expectedRevision, action },
    }),
}
