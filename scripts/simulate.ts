/**
 * Balance report: Normal bots play full games on a content pack, then
 * head-to-heads against random-move and greedy baselines. Card selection only.
 *   npm run simulate -- [content.json] [gamesPerPlayerCount]
 * The content file is {pack, rules}, e.g. an admin export. Without one, the
 * Starfall test fixture is used.
 */
import { readFileSync } from "node:fs"
import { chooseGreedyAction, chooseNormalAction, chooseRandomAction, playBotGame, type Chooser } from "../src/bots"
import { createContext, points, setupGame } from "../src/engine"
import { validateContent } from "../src/shared/content"

const args = process.argv.slice(2)
const file = args.find((a) => a.endsWith(".json")) ?? new URL("../tests/fixtures/starfall.json", import.meta.url).pathname
const games = Number(args.find((a) => /^\d+$/.test(a)) ?? 500)
const checked = validateContent(JSON.parse(readFileSync(file, "utf8")))
if (!checked.ok) throw new Error(`${file} is not valid content: ${checked.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`)
const ctx = createContext(checked.content.pack, checked.content.rules)
const players = ["A", "B", "C", "D"].map((id) => ({ id, name: id }))
const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(0)}%`
const avg = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)

for (const n of [2, 3, 4]) {
  const rounds: number[] = []
  const winnerPoints: number[] = []
  const fromAchievements: number[] = []
  let ties = 0
  let firstSeatWins = 0
  let passes = 0
  const claims = new Map<string, number>()
  const drawn = new Map<string, number>()
  const winnerClaims = new Map<string, number>()
  let uniqueAcquired = 0
  const unique = new Set(ctx.pack.cardGroups.filter((g) => g.kind === "unique").map((g) => g.id))
  const mix = { collect: 0, reserve: 0, acquire: 0, pass: 0 }
  for (let g = 0; g < games; g++) {
    const state = playBotGame(ctx, setupGame(ctx, players.slice(0, n), `sim-${n}-${g}`), `bot-${n}-${g}`)
    rounds.push(state.players[0].turns)
    const winners = state.result!.winners
    if (winners.length > 1) ties++
    if (winners.includes(state.players[state.firstPlayer].id)) firstSeatWins++
    passes += state.log.filter((e) => e.type === "pass").length
    for (const e of state.log) if (e.type in mix) mix[e.type as keyof typeof mix]++
    for (const p of state.players) {
      if (p.acquired.some((id) => unique.has(ctx.index.cards.get(id)!.group))) uniqueAcquired++
      const total = points(ctx, p)
      if (winners.includes(p.id)) {
        winnerPoints.push(total)
        const ach = p.achievements.reduce((a, id) => a + ctx.pack.achievements.find((x) => x.id === id)!.points, 0)
        fromAchievements.push(total ? ach / total : 0)
        for (const id of p.achievements) winnerClaims.set(id, (winnerClaims.get(id) ?? 0) + 1)
      }
    }
    for (const id of Object.keys(state.claimed)) claims.set(id, (claims.get(id) ?? 0) + 1)
    for (const id of state.achievements) drawn.set(id, (drawn.get(id) ?? 0) + 1)
  }
  console.log(`\n${n} players, ${games} games`)
  console.log(`  rounds per game: avg ${avg(rounds)}, min ${Math.min(...rounds)}, max ${Math.max(...rounds)}`)
  console.log(`  winning points: avg ${avg(winnerPoints)}; share from achievements ${avg(fromAchievements.map((x) => x * 100))}%`)
  console.log(`  shared victories: ${pct(ties, games)}; first seat wins: ${pct(firstSeatWins, games)} (even share ${pct(1, n)})`)
  const uniqueLine = unique.size ? `players signing a unique card: ${pct(uniqueAcquired, games * n)}; ` : ""
  console.log(`  ${uniqueLine}forced passes: ${passes}`)
  const moves = mix.collect + mix.reserve + mix.acquire + mix.pass
  console.log(`  bot moves: collect ${pct(mix.collect, moves)}, reserve ${pct(mix.reserve, moves)}, acquire ${pct(mix.acquire, moves)}, pass ${pct(mix.pass, moves)}`)
  console.log(`  achievement: claimed when drawn / claimant won`)
  for (const a of ctx.pack.achievements) {
    const c = claims.get(a.id) ?? 0
    console.log(`    ${a.name.padEnd(24)} ${pct(c, Math.max(1, drawn.get(a.id) ?? 0)).padStart(5)}  winner ${pct(winnerClaims.get(a.id) ?? 0, Math.max(1, c)).padStart(5)}`)
  }
}

// Head-to-head: one Normal bot against baselines, seats rotating.
const baselines: [string, Chooser][] = [["random", chooseRandomAction], ["greedy", chooseGreedyAction]]
console.log("")
for (const [name, baseline] of baselines) {
  for (const n of [2, 4]) {
    let wins = 0
    for (let g = 0; g < games; g++) {
      const normalSeat = players[g % n].id
      const state = playBotGame(ctx, setupGame(ctx, players.slice(0, n), `h2h-${name}-${n}-${g}`), `h2h-bot-${n}-${g}`, (id) => (id === normalSeat ? chooseNormalAction : baseline), 2000)
      if (state.result!.winners.includes(normalSeat)) wins++
    }
    console.log(`Normal vs ${n - 1} ${name}, ${games} games: Normal wins ${pct(wins, games)} (even share ${pct(1, n)})`)
  }
}
