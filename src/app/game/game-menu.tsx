import { useState } from "react"
import type { GameContext } from "@/engine/client"
import { ResponsiveSheet } from "@/components/responsive-sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useTheme } from "@/lib/theme"
import type { RoomView } from "../api"
import { GameLog } from "./activity"
import { noun } from "./presentation"
import { seatsOf } from "./scoreboard"

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label="Theme"
      value={theme}
      // A single toggle group can be emptied; keep one theme selected.
      onValueChange={(v) => v && setTheme(v as typeof theme)}
    >
      {(["light", "dark", "system"] as const).map((t) => (
        <ToggleGroupItem key={t} value={t} className="capitalize">
          {t}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function GameMenu({
  ctx,
  room,
  meId,
  open,
  onOpenChange,
  onLeave,
  onEnd,
}: {
  ctx: GameContext
  room: RoomView
  meId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onLeave: () => void
  onEnd: () => Promise<void>
}) {
  const [confirm, setConfirm] = useState(false)
  const { rules, pack } = ctx
  const isHost = room.hostId === meId
  const playing = room.status === "playing"
  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={onOpenChange} title={`Room ${room.code}`} description={`${pack.name} ${pack.version}`} focusBody>
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Rules</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              <li>
                On your turn, {pack.labels.collect}, {pack.labels.reserve} or {pack.labels.acquire}.
              </li>
              <li>
                {pack.labels.collect}: {rules.collect.distinct} different {pack.labels.resources.toLowerCase()}, or {rules.collect.pair} of one kind when {rules.collect.pairMinSupply}+ remain.
              </li>
              <li>
                {pack.labels.reserve}: hold a face-up {noun(pack, "card")} for later and take a {pack.labels.wildcard.toLowerCase()} if one is left. Up to {rules.reserveCap}.
              </li>
              <li>
                {pack.labels.acquire}: pay the cost minus your permanent discounts. {pack.labels.wildcards} cover any kind.
              </li>
              <li>Hold at most {rules.holdingCap} at the end of a turn.</li>
              <li>
                Reaching {rules.targetPoints} {pack.labels.points.toLowerCase()} starts the final round. Everyone gets the same number of turns.
              </li>
            </ul>
          </section>
          <Separator />
          <section className="flex flex-col gap-2 lg:hidden">
            <h3 className="text-sm font-semibold">Recent</h3>
            {room.game && <GameLog ctx={ctx} game={room.game} seats={seatsOf(room)} limit={20} />}
          </section>
          <Separator className="lg:hidden" />
          <section className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Theme</h3>
            <ThemeSwitch />
          </section>
          <Separator />
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={onLeave}>
              Back to home
            </Button>
            {isHost && playing && (
              <Button variant="ghost" className="text-destructive hover:bg-transparent hover:text-destructive hover:underline" onClick={() => setConfirm(true)}>
                End game for everyone
              </Button>
            )}
          </div>
        </div>
      </ResponsiveSheet>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this game?</AlertDialogTitle>
            <AlertDialogDescription>The game stops for everyone and no winner is declared. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep playing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                await onEnd()
                onOpenChange(false)
              }}
            >
              End game
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
