// The transport boundary — and the only file in the project allowed to read a
// clock or touch I/O. Everything beneath it takes `now` as a parameter, which is
// what makes the disconnect timers testable instantly instead of by waiting.
//
// Deliberately thin: move JSON, keep a connection id per socket, drive
// `hub.tick` on an interval. All the decisions live in `hub`/`lobby`/`room`.

import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { Hub, type HubOptions } from './hub';
import type { Envelope } from './protocol';

export interface ServeOptions extends HubOptions {
  port?: number;
  /** How often to advance lobby timers and let bots act. Finer than the bot
   *  pause itself, so pacing lands close to `botDelayMs`. */
  tickMs?: number;
}

export interface Server {
  hub: Hub;
  /** Actual bound port — useful when `port: 0` picks one. */
  port: number;
  close(): Promise<void>;
}

export function serve(opts: ServeOptions = {}): Promise<Server> {
  const hub = new Hub(opts);
  const wss = new WebSocketServer({ port: opts.port ?? 8787 });
  const sockets = new Map<string, WebSocket>();

  const flush = (envelopes: Envelope[]): void => {
    for (const e of envelopes) {
      const sock = sockets.get(e.conn);
      // readyState 1 === OPEN. A closing socket is not an error worth logging.
      if (sock && sock.readyState === 1) sock.send(JSON.stringify(e.msg));
    }
  };

  wss.on('connection', (sock: WebSocket) => {
    const conn = randomUUID();
    sockets.set(conn, sock);

    sock.on('message', (raw: unknown) => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(raw));
      } catch {
        // Not even JSON. `hub.handle` would reject it anyway, but there is no
        // point routing it.
        flush([{ conn, msg: { t: 'error', message: 'Malformed message' } }]);
        return;
      }
      flush(hub.handle(conn, payload, Date.now()));
    });

    sock.on('close', () => {
      sockets.delete(conn);
      flush(hub.disconnect(conn, Date.now()));
    });

    // A dead socket should not take the room with it.
    sock.on('error', () => {
      sockets.delete(conn);
      flush(hub.disconnect(conn, Date.now()));
    });
  });

  const timer = setInterval(() => flush(hub.tick(Date.now())), opts.tickMs ?? 200);
  timer.unref();

  return new Promise((resolve) => {
    wss.on('listening', () => {
      const addr = wss.address();
      resolve({
        hub,
        port: typeof addr === 'object' && addr ? addr.port : (opts.port ?? 8787),
        close: () =>
          new Promise<void>((done) => {
            clearInterval(timer);
            for (const s of sockets.values()) s.close();
            wss.close(() => done());
          }),
      });
    });
  });
}
