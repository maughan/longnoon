// The socket, and everything the client knows about the game.
//
// The client is deliberately dumb: it renders `view` and enables exactly the
// buttons in `legal`. It never derives what is possible, because it cannot —
// `legalCommands` needs `GameState`, and a client only ever holds `playerView`
// output. The server sends the list; the UI obeys it.

import { useCallback, useEffect, useRef, useState } from 'react';
import PartySocket from 'partysocket';
import type { Command, GameEvent, PlayerId } from '../../engine/state';
import type { ClientState } from '../../engine/view';
import type { Inbound, Outbound, TableSeat } from '../../server/protocol';
import { describe, narrate, type Beat } from './beats';

const TOKEN_KEY = 'long-noon.session';

interface Session {
  roomId: string;
  token: string;
}

export interface Net {
  connected: boolean;
  roomId: string | null;
  seat: PlayerId | null;
  view: ClientState | null;
  legal: Command[];
  log: string[];
  /** Append-only; the table plays them out one at a time. */
  beats: Beat[];
  /**
   * The most recent batch, with a counter so a listener can tell a repeat from
   * a new one. Beats merge events into sentences and lose the counts; sound
   * needs the events themselves.
   */
  feed: { seq: number; events: GameEvent[] };
  /**
   * Counts every state the server has sent.
   *
   * Lets a caller tell "the reply to what I just did" from "some state that
   * happened to arrive". Unlike `feed.seq` it moves even for a state carrying
   * no events, which is exactly the case that matters — a card played with
   * nothing to decide.
   */
  rev: number;
  error: string | null;
  /** Whether this server offers the act controls. Off unless asked for. */
  dev: boolean;
  send(msg: Inbound): void;
  /** Open a room with this many chairs. Who fills them is decided at the table. */
  create(seats: number): void;
  join(roomId: string, name: string): void;
  play(command: Command): void;
  /** Give up the seat and return to the menu. */
  leave(): void;
  /** The room before the deal. Null once the game has begun. */
  table: { seats: TableSeat[]; canBegin: boolean } | null;
  setSeat(index: number, kind: 'bot' | 'open'): void;
  begin(marked: boolean): void;
}

/** Remembered across a refresh so a reload does not cost you your seat. */
function remembered(): Session | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/**
 * Which room this socket is for, and where the server lives.
 *
 * The room is part of the ADDRESS now, not something announced in a message:
 * one Durable Object per room means Cloudflare has to know which object to
 * route to before the socket exists. This is the one real change the port
 * forces on the client.
 */
export interface NetTarget {
  /** Durable Object name. Any string; the client makes one for a new room. */
  room: string;
  /** Host only — partysocket adds the scheme and path. */
  host: string;
}

/**
 * Which room this page is for, given its query string.
 *
 * Pure: it decides, it does not navigate. The URL write is a side effect and
 * belongs in an effect, not in a render — see the note in App.tsx.
 */
export function roomFor(search: string, make: () => string = newRoomCode): {
  room: string; fromUrl: boolean;
} {
  const inUrl = new URLSearchParams(search).get('room')?.trim();
  return inUrl ? { room: inUrl, fromUrl: true } : { room: make(), fromUrl: false };
}

/** A short, readable room code. Not a secret: seats are held by token. */
export function newRoomCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function useNet(target: NetTarget): Net {
  const sock = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [seat, setSeat] = useState<PlayerId | null>(null);
  const [view, setView] = useState<ClientState | null>(null);
  const [legal, setLegal] = useState<Command[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [feed, setFeed] = useState<{ seq: number; events: GameEvent[] }>(
    { seq: 0, events: [] },
  );
  const [rev, setRev] = useState(0);
  const [tableState, setTable] = useState<Net['table']>(null);
  const [error, setError] = useState<string | null>(null);
  const [dev, setDev] = useState(false);

  // The socket handler is installed once, so anything it reads must be a ref.
  const seatRef = useRef<PlayerId | null>(null);
  const activeRef = useRef<PlayerId | null>(null);
  const dealt = useRef(false);
  const beatId = useRef(0);

  const send = useCallback((msg: Inbound) => {
    sock.current?.readyState === WebSocket.OPEN
      && sock.current.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    /**
     * partysocket, not a bare WebSocket.
     *
     * Durable Objects hibernate, and a plain socket surfaces that to the player
     * as a disconnect they have to recover from by reloading. This reconnects
     * with backoff and replays the rejoin below, so a hibernation is invisible.
     */
    const ws = new PartySocket({
      host: target.host,
      party: 'room',            // the ROOM binding, lowercased
      room: target.room,
    }) as unknown as WebSocket;
    sock.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // A refresh should put you back in your chair, not in the lobby.
      const prev = remembered();
      if (prev) ws.send(JSON.stringify({ t: 'rejoin', ...prev } satisfies Inbound));
    };
    ws.onclose = () => setConnected(false);

    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as Outbound;
      switch (msg.t) {
        case 'created':
          setRoomId(msg.roomId);
          break;
        case 'joined':
          setRoomId(msg.roomId);
          setSeat(msg.seat);
          seatRef.current = msg.seat;
          setDev(msg.dev);
          setError(null);
          localStorage.setItem(
            TOKEN_KEY,
            JSON.stringify({ roomId: msg.roomId, token: msg.token }),
          );
          break;
        case 'table':
          setRoomId(msg.roomId);
          setTable({ seats: msg.seats, canBegin: msg.canBegin });
          break;
        case 'state': {
          // The deal has happened; the waiting room is over.
          setTable(null);
          setView(msg.view);
          setRev((n) => n + 1);
          setLegal(msg.legal);
          const seatNow = seatRef.current;
          if (msg.events.length) {
            setLog((l) => [
              ...msg.events.map((e) => describe(e, msg.view, seatNow)).reverse(),
              ...l,
            ].slice(0, 60));
          }
          // The first state is the deal: a burst of setup events nobody needs
          // narrated, and no turn change to announce because there was no turn
          // before it.
          if (dealt.current && msg.events.length) {
            setFeed((f) => ({ seq: f.seq + 1, events: msg.events }));
          }
          if (dealt.current) {
            const fresh = narrate(
              msg.events, msg.view, seatNow, activeRef.current,
              () => (beatId.current += 1),
            );
            // Append-only, deliberately not capped. The cap used to be
            // `.slice(-40)`, and the consumer indexes into this array with a
            // counter that only goes up — so once 40 beats had been produced,
            // every new one pushed an old one off the front, the length stopped
            // growing, the counter passed it, and the overlay went silent for
            // the rest of the game. Beats are a few small strings each; a whole
            // game is a handful of kilobytes.
            if (fresh.length) setBeats((b) => [...b, ...fresh]);
          }
          dealt.current = true;
          activeRef.current = msg.view.activePlayer;
          break;
        }
        case 'lobby':
          setLog((l) => [`— ${msg.event.t.toLowerCase().replace(/_/g, ' ')}`, ...l]);
          break;
        case 'error':
          // A stale token from a closed room should not strand you.
          if (msg.message === 'Cannot rejoin' || msg.message === 'No such room') {
            localStorage.removeItem(TOKEN_KEY);
          } else setError(msg.message);
          break;
        default:
          break;
      }
    };

    return () => ws.close();
  }, [target.host, target.room]);

  return {
    connected, roomId, seat, view, legal, log, beats, feed, rev, error, dev, send,
    table: tableState,
    setSeat: (index, kind) => send({ t: 'seat', index, kind }),
    begin: (marked) => send({ t: 'begin', marked }),
    create: (seats) => send({ t: 'create', seats }),
    // `roomId` is still accepted by the server and ignored — the object it
    // reached IS the room. Kept in the message so the wire protocol did not
    // have to change shape for the port.
    join: (id, name) => send({ t: 'join', roomId: id, name }),
    play: (command) => send({ t: 'command', command }),
    leave: () => {
      send({ t: 'leave' });
      // Reset locally rather than waiting to be told. The server's answer to a
      // leave is silence — the seat is simply released — and a menu that waited
      // for a reply that never comes would hang on a dropped connection.
      localStorage.removeItem(TOKEN_KEY);
      seatRef.current = null;
      activeRef.current = null;
      dealt.current = false;
      setSeat(null);
      setView(null);
      setLegal([]);
      setLog([]);
      setBeats([]);
      setRoomId(null);
      setTable(null);
      setError(null);
    },
  };
}
