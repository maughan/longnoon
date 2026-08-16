# The room, as a Durable Object

A port of `server/` onto Cloudflare. **The old server is untouched and still
works** — `npm run serve` runs it exactly as before. Nothing here deletes
anything there, so a playtest can fall back mid-session.

## Why

`server/hub.ts` keeps every room in a `Map` in one process. That means sticky
sessions, instance affinity, and one process holding every game. Here the object
*is* the room: Cloudflare routes every socket for room `abc` to the same object
wherever it lives, and rooms cannot see each other.

## Running it

```bash
npm run dev:server      # wrangler dev, on :8787
npm run test:worker     # the Durable Object suite, in workerd
npm run deploy:server   # wrangler deploy
npm run tunnel          # cloudflared, for a playtest against a local worker
```

The client picks its host from `VITE_PARTY_HOST`, defaulting to
`<hostname>:8787` so local development needs no `.env`. Set it in Vercel for
production and preview.

## The four things this design is about

**1. Hibernation.** An idle object is evicted and woken by the next message,
mid-game. So game state lives in `ctx.storage`, and the connection → seat
mapping lives in `connection.setState`, which Cloudflare persists. A
`Map<connectionId, PlayerId>` would empty silently and players would find
themselves unseated with nothing in any log. `room`/`meta`/`log` on the class are
caches and are named as such; `evictForTest()` clears them so a test can prove
the seat survives.

**2. The log, not the state.** Storage holds `{ seed, seats, marked }` and an
ordered list of commands. The engine guarantees this reconstructs the game
exactly (CLAUDE.md invariant 1). Reasons in order: the state shape changes most
weeks during balance work and a blob needs migrating every time; the log is a few
kilobytes; and every playtest becomes a replay the simulator can load, via
`GET /rooms/:id/replay`.

Bot commands are logged like any other. They have to be — a bot's choice depends
on RNG and on the view at the time, and re-deriving it during a rebuild would
mean running the policy against a half-built state. `GameRoom.botCommand(cursor)`
takes the cursor as a parameter and the object passes the log length, so a bot's
choice is a pure function of the log and a rebuilt room keeps making the same
decisions a room that never slept would have made.

**Measured: a full 4-player game is 428 commands and rebuilds in 213ms**
(0.50ms per command), against a network round trip that already cost more. There
is no state cache beyond the field, and there should not be one until that
number is a problem.

**3. One payload per connection.** `#deliver` walks the connections and sends
each seat its own `playerView` and its own `legalCommands`, filtered through
`visibleEvents`. Never a shared broadcast, not even one that looks safe.

**4. Validate before applying.** `GameRoom.submit` checks `legalCommands` before
`apply`, so a hostile client gets a clean rejection rather than a 500 shaped like
a game rule. Messages are capped at 16KB and rate-limited to 120 per 10s per
connection, with the window in connection state so it survives hibernation too.

## Not ported yet

The **disconnect vote and botify machinery** in `server/lobby.ts`. It holds
presence in `Map`s that would need a serialisable form, and the object already
knows who is connected — `getConnections()` is presence, with no map to persist.
Rebuilding it on alarms is a piece of work in its own right and the old server
still has it. `vote` currently answers with an error rather than pretending.
