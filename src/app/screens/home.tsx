import { readStored, writeStored } from "@/lib/storage"
import { ArrowRightIcon } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { api, isApiError, loadSession, saveSession } from "../api"
import { ThemeSwitch } from "../game/game-menu"
import { navigate, ROOM_CODE } from "../router"
import { useDocumentTitle } from "../brand"
import { RESOURCE_ICON_COMPONENTS } from "../game/resource"
import { cn } from "@/lib/utils"

function lastRoom(): string | null {
  try {
    const code = readStored("last")
    return code && loadSession(code) ? code : null
  } catch {
    return null
  }
}

export function rememberRoom(code: string) {
  try {
    writeStored("last", code)
  } catch {
    /* ignore */
  }
}

export function Home() {
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The default game, if any: null while loading; empty until one is set up in the admin.
  const [packs, setPacks] = useState<Awaited<ReturnType<typeof api.packs>> | null>(null)
  useEffect(() => {
    api.packs().then(setPacks).catch(() => setPacks([]))
  }, [])
  const noPacks = packs?.length === 0
  // The default game names the page; the platform name when none is set up.
  const game = packs?.[0]
  const GameIcon = game?.icon ? RESOURCE_ICON_COMPONENTS[game.icon] : null
  useDocumentTitle(game?.title)
  const last = lastRoom()

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.create(name)
      saveSession(r.code, { playerId: r.playerId, token: r.token })
      rememberRoom(r.code)
      navigate(`/r/${r.code}`)
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not create a room")
    } finally {
      setBusy(false)
    }
  }

  const join = (e: FormEvent) => {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    if (!ROOM_CODE.test(c)) return setError("Room codes have 6 letters and numbers")
    navigate(`/r/${c}`)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-form flex-col gap-8 px-4 py-10 sm:py-16">
      <div className="flex flex-col gap-3">
        <h1 className="flex min-w-0 items-start gap-3 text-4xl">
          {game ? (
            <>
              {/* Level with the first line when a long title wraps. */}
              {GameIcon && <GameIcon className="mt-0.5 size-9 shrink-0" aria-hidden />}
              <span className="min-w-0 break-words">{game.title}</span>
            </>
          ) : (
            // Loading keeps the heading's space, so the page does not jump.
            <span className={cn(!packs && "invisible")}>Trovekit Game</span>
          )}
        </h1>
        {/* The default game's own description; the platform's introduction when it has none. */}
        {packs && (
          <p className="break-words text-muted-foreground">
            {game?.description ?? `${game ? "" : "An open-source card strategy game you can make your own. "}Play with 2 to 4 players. Collect resources, acquire cards that make the next ones cheaper, and claim achievements.`}
          </p>
        )}
      </div>

      {last && (
        <a
          href={`/r/${last}`}
          onClick={(e) => (e.preventDefault(), navigate(`/r/${last}`))}
          className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm font-medium outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Continue room {last}
          <ArrowRightIcon className="size-4" />
        </a>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={create} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Start a room</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="nickname" required className="h-11" />
        </div>
        {noPacks && (
          <div className="flex flex-col gap-1 rounded-lg border border-dashed px-4 py-3 text-sm">
            <p className="font-medium">No game available yet</p>
            <p className="text-muted-foreground">Rooms can be created once a game is set up in the admin. You can still join an existing room.</p>
          </div>
        )}
        <Button type="submit" size="lg" disabled={busy || !name.trim() || !packs?.length}>
          Create room
        </Button>
      </form>

      <Separator />

      <form onSubmit={join} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Join a room</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">Room code</Label>
          <Input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="num h-11 tracking-[0.2em] uppercase"
            required
          />
        </div>
        <Button type="submit" size="lg" variant="outline" disabled={code.trim().length !== 6}>
          Join
        </Button>
      </form>

      <footer className="mt-auto flex flex-col gap-3 pt-6 text-sm text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>Theme</span>
          <ThemeSwitch />
        </div>
        {game && <p className="text-xs">Built on Trovekit Game, an open-source card strategy game.</p>}
      </footer>
    </main>
  )
}
