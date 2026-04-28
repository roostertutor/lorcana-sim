import "dotenv/config"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { auth } from "./routes/auth.js"
import { lobby } from "./routes/lobby.js"
import { game } from "./routes/game.js"
import { matchmaking } from "./routes/matchmaking.js"
import { replay } from "./routes/replay.js"
import { startMatchmakingPoller } from "./services/matchmakingService.js"

const app = new Hono()

app.use("*", logger())
app.use(
  "*",
  cors({
    origin: [
      "http://localhost:5173",
      process.env["CLIENT_URL"] ?? "http://localhost:5173",
    ],
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  }),
)

app.get("/health", (c) => c.json({ ok: true }))

app.route("/auth", auth)
app.route("/lobby", lobby)
app.route("/game", game)
app.route("/matchmaking", matchmaking)
app.route("/replay", replay)

import { serve } from "@hono/node-server"

const port = parseInt(process.env["PORT"] ?? "3001", 10)

serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`)
})

// Poll-based safety net for matchmaking pairing — runs every 60s, catches
// edge cases where the inline-on-INSERT path missed a peer (race between
// two near-simultaneous joins, or a peer who joined before we registered).
// Idempotent — safe even if two server processes run it (the
// `claimEntries` DELETE is the atomic gate).
startMatchmakingPoller(60_000)
