import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { auth } from "./routes/auth.js"
import { lobby } from "./routes/lobby.js"
import { game } from "./routes/game.js"

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
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
)

app.get("/health", (c) => c.json({ ok: true }))

app.route("/auth", auth)
app.route("/lobby", lobby)
app.route("/game", game)

const port = parseInt(process.env["PORT"] ?? "3001", 10)

export default {
  port,
  fetch: app.fetch,
}
