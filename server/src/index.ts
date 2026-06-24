import "dotenv/config"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { auth } from "./routes/auth.js"
import { lobby } from "./routes/lobby.js"
import { game } from "./routes/game.js"
import { matchmaking } from "./routes/matchmaking.js"
import { replay } from "./routes/replay.js"
import { feedback } from "./routes/feedback.js"
import { startMatchmakingPoller } from "./services/matchmakingService.js"

const app = new Hono()

app.use("*", logger())

// Static allowlist: local dev + any explicit origins from CLIENT_URL
// (comma-separated, so prod + staging can both be listed). Vercel preview
// deploys get matched dynamically below since their subdomain rotates per push.
const allowedOrigins = new Set(
  [
    "http://localhost:5173",
    ...(process.env["CLIENT_URL"] ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  ],
)

// Matches the Vercel production + preview domains for the UI project, e.g.
// https://lorcana-sim-ui.vercel.app and https://lorcana-sim-ui-<hash>-<scope>.vercel.app
const VERCEL_PREVIEW = /^https:\/\/lorcana-sim-ui[a-z0-9-]*\.vercel\.app$/

app.use(
  "*",
  cors({
    // Reflect the request origin only when it's allowed; returning the matched
    // origin (not "*") is required because credentials:true forbids wildcard.
    origin: (origin) => {
      if (!origin) return undefined
      if (allowedOrigins.has(origin) || VERCEL_PREVIEW.test(origin)) {
        return origin
      }
      return undefined
    },
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
app.route("/feedback", feedback)

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
