import { BotIcon, CheckIcon, CopyIcon, LoaderCircleIcon, PlusIcon, XIcon } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { rank, type GameContext, type GameState } from "@/engine/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { ResourceIcon } from "@/engine/schema"
import { api, clearSession, isApiError, loadSession, saveSession, type ApiError, type RoomView, type Session } from "../api"
import { GameTitle, useDocumentTitle } from "../brand"
import { Board } from "../game/board"
import { noun } from "../game/presentation"
import { navigate } from "../router"
import { useRoom } from "../use-room"
import { rememberRoom } from "./home"

/** "Room ABC123": the code is the room's name. Screen readers hear it letter by letter. */
export function RoomCode({ code }: { code: string }) {
  return (
    <>
      Room{" "}
      <span className="num tracking-[0.15em]" aria-hidden>
        {code}
      </span>
      <span className="sr-only">{code.split("").join(" ")}</span>
    </>
  )
}

/** A room's game as players see it: its own pinned pack, never the current default. */
type RoomGame = { title: string; icon: ResourceIcon | null }

function Shell({ children, code, game }: { children: React.ReactNode; code?: string; game?: RoomGame }) {
  useDocumentTitle(game?.title)
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-form items-center justify-between gap-3 px-4">
          <GameTitle title={game?.title} icon={game?.icon} />
          {code && <span className="num shrink-0 text-sm tracking-[0.15em] text-muted-foreground">{code}</span>}
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-form flex-1 flex-col gap-6 px-4 py-8">{children}</main>
    </div>
  )
}

function Problem({ title, message, code }: { title: string; message: string; code?: string }) {
  return (
    <Shell code={code}>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{message}</p>
      <Button size="lg" onClick={() => navigate("/")}>
        Back to home
      </Button>
    </Shell>
  )
}

export function RoomScreen({ code }: { code: string }) {
  const [session, setSession] = useState<Session | null>(() => loadSession(code))
  useEffect(() => {
    if (session) rememberRoom(code)
  }, [code, session])
  if (!session) return <JoinGate code={code} onJoined={setSession} />
  return (
    <LiveRoom
      key={session.token}
      code={code}
      session={session}
      onSessionLost={() => {
        clearSession(code)
        setSession(null)
      }}
    />
  )
}

function JoinGate({ code, onJoined }: { code: string; onJoined: (s: Session) => void }) {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.preview>> | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    api.preview(code).then(setPreview, (e) => setError(isApiError(e) ? e : { status: 0, code: "ERROR", message: "Could not load this room" }))
  }, [code])

  if (error) return <Problem code={code} title={error.code === "ROOM_NOT_FOUND" ? "Room not found" : "Can't open this room"} message={error.message} />
  if (!preview)
    return (
      <Shell code={code}>
        <Loading />
      </Shell>
    )
  if (preview.status !== "lobby")
    return (
      <Problem
        code={code}
        title={preview.status === "playing" ? "This game has started" : "This game has ended"}
        message={preview.status === "playing" ? "Only its players can rejoin, from the device they joined on." : "Start a new room to play again."}
      />
    )

  const full = preview.players.length >= preview.maxPlayers
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setFormError(null)
    try {
      const r = await api.join(code, name)
      const s = { playerId: r.playerId, token: r.token }
      saveSession(code, s)
      onJoined(s)
    } catch (err) {
      setFormError(isApiError(err) ? err.message : "Could not join")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell code={code} game={preview}>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">
          Join <RoomCode code={code} />
        </h1>
        <p className="text-muted-foreground">
          {preview.players.length ? `With ${preview.players.join(", ")}.` : "Nobody here yet."} {preview.players.length} of {preview.maxPlayers} seats taken.
        </p>
      </div>
      {full ? (
        <Alert>
          <AlertTitle>This room is full</AlertTitle>
          <AlertDescription>Ask the host to start a new room.</AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="join-name">Your name</Label>
            <Input id="join-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="nickname" required className="h-11" autoFocus />
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button type="submit" size="lg" disabled={busy || !name.trim()}>
            Join
          </Button>
        </form>
      )}
    </Shell>
  )
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground" role="status">
      <LoaderCircleIcon className="size-4 animate-spin" /> Loading room
    </div>
  )
}

function LiveRoom({ code, session, onSessionLost }: { code: string; session: Session; onSessionLost: () => void }) {
  const { room, content, error, connection, act } = useRoom(code, session)
  const [showBoard, setShowBoard] = useState(false)

  useEffect(() => {
    if (error?.code === "UNAUTHORIZED") onSessionLost()
  }, [error, onSessionLost])

  // Turn toasts belong to the board; clear them when the game ends.
  const over = room?.status === "finished" || room?.status === "abandoned"
  useEffect(() => {
    if (over) toast.dismiss()
  }, [over])

  if (error && error.code !== "UNAUTHORIZED") return <Problem code={code} title={error.code === "ROOM_NOT_FOUND" ? "Room not found" : "Something went wrong"} message={error.message} />
  if (!room)
    return (
      <Shell code={code}>
        <Loading />
      </Shell>
    )

  const leave = () => navigate("/")
  const end = async () => {
    try {
      await api.end(code, session.token)
    } catch (e) {
      toast.error(isApiError(e) ? e.message : "Could not end the game")
    }
  }

  if (room.status === "lobby") return <Lobby room={room} session={session} code={code} onLeft={onSessionLost} />
  if (!content || !room.game)
    return (
      <Shell code={code} game={room.content}>
        <Loading />
      </Shell>
    )
  if (room.status === "playing" || showBoard)
    return (
      <>
        <Board ctx={content} room={room} meId={session.playerId} connection={connection} act={act} onLeave={leave} onEnd={end} readOnly={room.status !== "playing"} />
        {showBoard && (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background p-3 lg:static lg:border-0">
            <Button className="mx-auto flex w-full max-w-form" size="lg" onClick={() => setShowBoard(false)}>
              Back to results
            </Button>
          </div>
        )}
      </>
    )
  return <Results ctx={content} room={room} meId={session.playerId} onBoard={() => setShowBoard(true)} />
}

function Lobby({ room, session, code, onLeft }: { room: RoomView; session: Session; code: string; onLeft: () => void }) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const isHost = room.hostId === session.playerId
  const link = `${location.origin}/r/${room.code}`
  const host = room.players.find((p) => p.id === room.hostId)
  const enough = room.players.length >= room.minPlayers

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Copy failed. Select the link and copy it.")
    }
  }
  const start = async () => {
    setBusy(true)
    try {
      await api.start(code, session.token)
    } catch (e) {
      toast.error(isApiError(e) ? e.message : "Could not start")
    } finally {
      setBusy(false)
    }
  }
  const addBot = async () => {
    try {
      await api.addBot(code, session.token)
    } catch (e) {
      toast.error(isApiError(e) ? e.message : "Could not add a bot")
    }
  }
  const removeBot = async (playerId: string) => {
    try {
      await api.removeBot(code, session.token, playerId)
    } catch (e) {
      toast.error(isApiError(e) ? e.message : "Could not remove the bot")
    }
  }
  const leave = async () => {
    try {
      await api.leave(code, session.token)
    } catch {
      /* Leaving is best effort. */
    }
    onLeft()
    navigate("/")
  }

  // The room's game version cannot be used (for example a room saved before versions were pinned): it can only be left.
  if (room.problem)
    return (
      <Shell game={room.content}>
        <h1 className="text-2xl font-semibold">
          <RoomCode code={room.code} />
        </h1>
        <Alert>
          <AlertTitle>This room cannot start</AlertTitle>
          <AlertDescription>{room.problem.message}</AlertDescription>
        </Alert>
        <div className="mt-auto flex flex-col gap-2">
          <Button size="lg" onClick={leave}>
            Leave room
          </Button>
        </div>
      </Shell>
    )

  return (
    <Shell game={room.content}>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">
          <RoomCode code={room.code} />
        </h1>
        <p className="text-muted-foreground">
          {room.content.title} · First to {room.content.targetPoints}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite">Invite link</Label>
        <div className="flex gap-2">
          <Input id="invite" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1" />
          <Button variant="outline" size="lg" onClick={copy} aria-label="Copy invite link" className="px-4">
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span className="sr-only sm:not-sr-only">{copied ? "Copied" : "Copy"}</span>
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-2" aria-labelledby="players">
        <div className="flex items-baseline justify-between">
          <h2 id="players" className="text-base font-semibold">
            Players
          </h2>
          <span className="text-sm text-muted-foreground">
            {room.players.length} of {room.maxPlayers}
          </span>
        </div>
        <ul className="divide-y rounded-lg border bg-card">
          {room.players.map((p) => (
            <li key={p.id} className={cn("flex min-h-12 items-center gap-3 px-4", p.bot && isHost ? "py-1.5 pr-2" : "py-3")}>
              {p.bot ? (
                <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <span className={cn("size-2 shrink-0 rounded-full", p.connected ? "bg-success" : "bg-muted-foreground/40")} aria-label={p.connected ? "Online" : "Offline"} role="img" />
              )}
              <span className="flex-1 truncate">
                {p.name}
                {p.id === session.playerId && <span className="text-muted-foreground"> (you)</span>}
              </span>
              {p.id === room.hostId && <span className="text-sm text-muted-foreground">Host</span>}
              {p.bot && <span className="text-sm text-muted-foreground capitalize">{p.bot}</span>}
              {p.bot && isHost && (
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.name}`} onClick={() => removeBot(p.id)}>
                  <XIcon />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {isHost && room.players.length < room.maxPlayers && (
          <Button variant="outline" onClick={addBot} className="self-start">
            <PlusIcon /> Add bot
          </Button>
        )}
      </section>

      <div className="mt-auto flex flex-col gap-2">
        {isHost ? (
          <>
            <Button size="lg" disabled={!enough || busy} onClick={start}>
              Start game
            </Button>
            {!enough && <p className="text-center text-sm text-muted-foreground">Needs at least {room.minPlayers} players. Invite someone or add a bot.</p>}
          </>
        ) : (
          <p className="text-center text-sm text-muted-foreground">Waiting for {host?.name ?? "the host"} to start.</p>
        )}
        <Button variant="ghost" onClick={leave}>
          Leave room
        </Button>
      </div>
    </Shell>
  )
}

function Results({ ctx, room, meId, onBoard }: { ctx: GameContext; room: RoomView; meId: string; onBoard: () => void }) {
  const game = room.game!
  const abandoned = room.status === "abandoned"
  const result = game.result ?? rank(ctx, game as unknown as GameState)
  const name = (id: string) => (id === meId ? "You" : (game.players.find((p) => p.id === id)?.name ?? "?"))
  const winners = result.winners
  const top = result.standings.filter((s) => s.rank === 1)
  const byTiebreak = !abandoned && result.standings.length > 1 && result.standings[0].points === result.standings.find((s) => s.rank > 1)?.points

  let title = "Game ended"
  if (!abandoned) title = winners.length > 1 ? "Shared victory" : winners[0] === meId ? "You win" : `${name(winners[0])} wins`
  let detail = "The host ended the game early. No winner is declared."
  if (!abandoned) {
    if (winners.length > 1) detail = `${winners.map(name).join(" and ")} tied on ${top[0].points} ${ctx.pack.labels.points.toLowerCase()} and ${top[0].acquired} ${ctx.pack.labels.acquired.toLowerCase()} ${noun(ctx.pack, "cards")}.`
    else if (byTiebreak) detail = `Tied on ${top[0].points} ${ctx.pack.labels.points.toLowerCase()}, decided by fewest ${ctx.pack.labels.acquired.toLowerCase()} ${noun(ctx.pack, "cards")}.`
    else detail = `${top[0].points} ${ctx.pack.labels.points.toLowerCase()} after ${game.players[0].turns} rounds.`
  }

  return (
    <Shell code={room.code} game={room.content}>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl">{title}</h1>
        <p className="text-muted-foreground">{detail}</p>
      </div>
      <ol className="divide-y rounded-lg border bg-card" aria-label="Final standings">
        {result.standings.map((s) => (
          <li key={s.playerId} className="flex items-center gap-4 px-4 py-3">
            <span className="num w-6 text-lg font-semibold text-muted-foreground">{s.rank}</span>
            <span className={cn("flex-1 truncate", s.rank === 1 && !abandoned && "font-semibold")}>{name(s.playerId)}</span>
            <span className="text-right">
              <span className="num block text-xl leading-none font-semibold">{s.points}</span>
              <span className="text-xs text-muted-foreground">
                {s.acquired} {ctx.pack.labels.acquired.toLowerCase()}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-auto flex flex-col gap-2">
        <Button size="lg" onClick={() => navigate("/")}>
          New game
        </Button>
        <Button size="lg" variant="outline" onClick={onBoard}>
          View final board
        </Button>
      </div>
    </Shell>
  )
}
