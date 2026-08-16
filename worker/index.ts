// The Worker entry: route sockets to their room, and serve replays.
//
// Deliberately thin, the same way `server/ws.ts` is. Everything that decides
// anything lives in the Durable Object.

import { routePartykitRequest } from 'partyserver';
import { GameRoomObject, type Env } from './room';

export { GameRoomObject };

/**
 * Who may open a socket.
 *
 * Vercel gives every branch its own generated subdomain, so an allow-list of
 * exact origins passes locally and in production and fails on every preview
 * deploy — which presents as "works on main, broken on the PR" and costs an
 * afternoon. Matched by suffix instead.
 *
 * `null` origin (curl, a native client, some tests) is allowed: origin is a
 * browser mechanism and is not an authentication check. What actually protects
 * a seat is the token, which is made in the object and never derived from
 * anything a replay contains.
 */
const ALLOWED_SUFFIXES = [
  '.vercel.app',        // preview deploys, one subdomain per branch
  'localhost',
  '127.0.0.1',
];

function originAllowed(origin: string | null, env: Env & { ALLOWED_ORIGIN?: string }): boolean {
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (env.ALLOWED_ORIGIN) {
    // An exact production domain, configured per environment.
    for (const allowed of env.ALLOWED_ORIGIN.split(',')) {
      const want = allowed.trim();
      if (want && (host === want || host.endsWith(`.${want}`))) return true;
    }
  }
  return ALLOWED_SUFFIXES.some((s) => host === s || host.endsWith(s));
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    /**
     * GET /rooms/:id/replay — seed and commands, for the simulator.
     *
     * The replay is the persisted form of the game, so this route is free: it
     * is the storage read, not a second representation to keep in step.
     */
    const replay = url.pathname.match(/^\/rooms\/([^/]+)\/replay\/?$/);
    if (replay) {
      const id = env.ROOM.idFromName(replay[1]);
      const stub = env.ROOM.get(id) as unknown as { replay(): Promise<unknown> };
      const data = await stub.replay();
      if (!data) return json({ error: 'No such room' }, 404);
      return json(data);
    }

    if (url.pathname === '/health') return json({ ok: true });

    if (!originAllowed(request.headers.get('Origin'), env)) {
      return new Response('Forbidden origin', { status: 403 });
    }

    // partyserver maps /parties/:namespace/:room onto the object of that name.
    //
    // The room name is passed explicitly as a header. Inside the object,
    // partyserver resolves its own name from `ctx.id.name`, which only recent
    // workerd builds expose — without it the object throws during session setup
    // and the socket closes with 1011 before a single message is exchanged.
    // Naming it here works on every runtime and costs one header.
    const party = url.pathname.match(/^\/parties\/[^/]+\/([^/?]+)/);
    const routed = await routePartykitRequest(
      party
        ? new Request(request, { headers: withRoom(request.headers, party[1]) })
        : request,
      env as never,
      { prefix: 'parties' },
    );
    return routed ?? new Response('Not found', { status: 404, headers: CORS });
  },
} satisfies ExportedHandler<Env>;

function withRoom(headers: Headers, room: string): Headers {
  const next = new Headers(headers);
  next.set('x-partykit-room', room);
  return next;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}
