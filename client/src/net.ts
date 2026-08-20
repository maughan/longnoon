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
import type { Inbound, Outbound, Speed, TableSeat } from '../../server/protocol';
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
  /** Seats nobody is driving. Public — the table watched them being filled. */
  bots: PlayerId[];
  /** Bot pacing, and whether this seat owns it. */
  speed: Speed;
  isHost: boolean;
  send(msg: Inbound): void;
  /** Hold a message for the next socket to open. See the note at the ref. */
  queue(msg: Inbound): void;
  /** Open a room with this many chairs. Who fills them is decided at the table. */
  create(seats: number): void;
  join(roomId: string, name: string): void;
  play(command: Command): void;
  /** Give up the seat and return to the menu. */
  leave(): void;
  /** Host only: end the table for everyone. */
  close(): void;
  /** The room before the deal. Null once the game has begun. */
  table: { seats: TableSeat[]; canBegin: boolean } | null;
  setSeat(index: number, kind: 'bot' | 'open'): void;
  begin(marked: boolean): void;
}

const PLAYER_KEY = 'long-noon.player';

/**
 * This browser's passport, made once and kept for good.
 *
 * The seat token is per session and per room, and it goes when the tab does.
 * The report this exists for: a player dropped, tried to come back, and was
 * told the room was FULL — every chair was accounted for, one of them was
 * theirs, and they had nothing left to prove it with. The passport is that
 * proof, and unlike the token it is never cleared: not on a failed rejoin, not
 * on leaving, not on an error.
 *
 * `randomUUID`, so it is unguessable. It is a bearer credential — whoever holds
 * it can take that chair and read its hidden role — which is also why the
 * server keeps it out of every payload.
 */
export function passport(): string {
  try {
    const held = localStorage.getItem(PLAYER_KEY);
    if (held) return held;
    const made = crypto.randomUUID();
    localStorage.setItem(PLAYER_KEY, made);
    return made;
  } catch {
    // Storage refused — private browsing, or a locked-down profile. A fresh id
    // each time is no worse than the behaviour before there was one.
    return crypto.randomUUID();
  }
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

/**
 * Sitting down: send it now, or move the socket first?
 *
 * Pure, and separated from the component for the same reason `roomFor` is —
 * this is the decision the bug was in, and a decision that only exists inside a
 * click handler is a decision nothing can check.
 *
 * The rule: a `join` naming a room the socket is not open to cannot be sent.
 * The room is part of the ADDRESS — one Durable Object per room — so the server
 * takes it from the object the message reached and ignores the field. Sending
 * anyway is not a no-op, it is a join to the WRONG room, which is exactly what
 * was reported: a typed code ignored and the player seated at the table the
 * link named.
 *
 * Returns `null` for nothing worth doing.
 */
export function joinPlan(
  current: string, code: string,
): { room: string; move: boolean } | null {
  const room = code.trim();
  if (!room) return null;
  return { room, move: room !== current };
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
  /*
    The same counter as a ref, for the double-fire guard below.

    The socket handler is installed once, so anything it reads must be a ref —
    and the guard has to compare against the CURRENT count, not the one that
    was current when a callback was created.
  */
  const revRef = useRef(0);
  const [tableState, setTable] = useState<Net['table']>(null);
  const [error, setError] = useState<string | null>(null);
  const [dev, setDev] = useState(false);
  const [bots, setBots] = useState<PlayerId[]>([]);
  /**
   * Bot pacing, and whether this seat may change it.
   *
   * Server state, not a local preference: the pauses happen there, so a client
   * could only ever delay what it already has — never speed it up.
   */
  const [speed, setSpeed] = useState<Speed>('normal');
  const [isHost, setIsHost] = useState(false);

  // The socket handler is installed once, so anything it reads must be a ref.
  const seatRef = useRef<PlayerId | null>(null);
  const activeRef = useRef<PlayerId | null>(null);
  const beatId = useRef(0);

  const send = useCallback((msg: Inbound) => {
    sock.current?.readyState === WebSocket.OPEN
      && sock.current.send(JSON.stringify(msg));
  }, []);

  /**
   * One message held for the NEXT socket to open.
   *
   * Changing rooms is changing the socket — the room is part of the address,
   * because one Durable Object per room means the routing happens before the
   * connection exists. So "join room X" cannot be sent down the socket that is
   * open to room Y; it has to wait for the one that replaces it.
   *
   * This is the bug it fixes: typing a different room code and pressing Sit
   * Down sent `join` with that id down the EXISTING socket, and the server
   * takes the room from the object the message reached, not from the field.
   * You were put back in the room the URL named, with nothing to say otherwise.
   */
  const queued = useRef<Inbound | null>(null);
  /** The last command sent, and the state count it was sent against. */
  const sent = useRef<{ key: string; rev: number } | null>(null);
  const queue = useCallback((msg: Inbound) => { queued.current = msg; }, []);

  /**
   * Back to the menu, whatever brought us here.
   *
   * One function for leaving and for being closed on, because the two used to
   * be the same twelve lines and only one of them was maintained. Clears the
   * token too: a seat you gave up, or a room that no longer exists, is not
   * something a page reload should try to reclaim.
   */
  const toMenu = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    seatRef.current = null;
    activeRef.current = null;
    setSeat(null);
    setView(null);
    setLegal([]);
    setLog([]);
    setBeats([]);
    setRoomId(null);
    setTable(null);
    setError(null);
  }, []);

  useEffect(() => {
    /**
     * partysocket, not a bare WebSocket.
     *
     * Durable Objects hibernate, and a plain socket surfaces that to the player
     * as a disconnect they have to recover from by reloading. This reconnects
     * with backoff and replays the rejoin below, so a hibernation is invisible.
     */
    // Whatever the last room called itself, it is not this one. Cleared here
    // rather than left to the reply, or the address bar keeps naming the room
    // you just left for as long as the new socket takes to answer — and for
    // ever if it refuses. This effect does not re-run on partysocket's own
    // reconnects, only on a real change of address.
    setRoomId(null);
    const ws = new PartySocket({
      host: target.host,
      party: 'room',            // the ROOM binding, lowercased
      room: target.room,
    }) as unknown as WebSocket;
    sock.current = ws;

    ws.onopen = () => {
      setConnected(true);
      /*
        An explicit join wins over the remembered one.

        Both would otherwise go out on the same socket: a token from the room
        you just left is refused here anyway — tokens are per room — but sending
        both makes the outcome depend on which error arrives first.
      */
      if (queued.current) {
        ws.send(JSON.stringify(queued.current));
        queued.current = null;
        return;
      }
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
          setSpeed(msg.speed);
          setIsHost(msg.host);
          setError(null);
          localStorage.setItem(
            TOKEN_KEY,
            JSON.stringify({ roomId: msg.roomId, token: msg.token }),
          );
          break;
        // Being shown the door is not an error — take the menu, quietly.
        case 'closed':
          toMenu();
          setError(msg.reason);
          break;
        case 'table':
          setRoomId(msg.roomId);
          setTable({ seats: msg.seats, canBegin: msg.canBegin });
          setSpeed(msg.speed);
          setIsHost(msg.host !== null && msg.host === seatRef.current);
          break;
        // Its own message so a mid-game change does not arrive as a `table`,
        // which would send everyone back to the waiting room.
        case 'speed':
          setSpeed(msg.speed);
          setIsHost(msg.you);
          break;
        case 'state': {
          // The deal has happened; the waiting room is over.
          setTable(null);
          setView(msg.view);
          setBots(msg.bots ?? []);
          setRev((n) => n + 1);
          revRef.current += 1;
          setLegal(msg.legal);
          const seatNow = seatRef.current;
          if (msg.events.length) {
            setLog((l) => [
              ...msg.events
                .map((e) => describe(e, msg.view, seatNow))
                // Some events are bookkeeping and describe to nothing rather
                // than to a line of the record.
                .filter(Boolean)
                .reverse(),
              ...l,
            ].slice(0, 60));
          }
          // The deal now arrives WITH its events, and it should be narrated
          // and heard like any other — it is the hand people look at hardest.
          // A later resync carries no events at all, so there is no backlog to
          // guard against.
          if (msg.events.length) {
            setFeed((f) => ({ seq: f.seq + 1, events: msg.events }));
          }
          {
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
          activeRef.current = msg.view.activePlayer;
          break;
        }
        case 'lobby':
          setLog((l) => [`— ${msg.event.t.toLowerCase().replace(/_/g, ' ')}`, ...l]);
          break;
        case 'error':
          /*
            A failed rejoin is quiet, and it costs you nothing.

            The rejoin above is sent by the client on every open, not by the
            player — so its failure is not news, and it must not destroy
            anything. This used to delete the stored token, which is how a
            player ended up with no claim on a seat that was still theirs: a
            reconnect that raced the room into existence answered `No such
            room`, the token went, and from then on the room was simply "full".
            Both of these are transient by nature — the object may not exist
            YET, and a token that is wrong for this room is still right for the
            room it came from.

            Nothing prunes the token now except leaving on purpose (`toMenu`).
            A stale one is harmless: the rejoin fails, this says nothing, and
            the passport is what gets the chair back.
          */
          /*
            A refused command frees the guard.

            The double-fire guard blocks an identical command until the board
            moves, and a rejection does not move it — so without this, one
            refused press would make that press dead for the rest of the turn.
          */
          sent.current = null;
          if (msg.message === 'Cannot rejoin' || msg.message === 'No such room') break;
          setError(msg.message);
          break;
        default:
          break;
      }
    };

    return () => ws.close();
  }, [target.host, target.room]);

  return {
    connected, roomId, seat, view, legal, log, beats, feed, rev, error, dev, bots,
    speed, isHost, send, queue,
    table: tableState,
    setSeat: (index, kind) => send({ t: 'seat', index, kind }),
    begin: (marked) => send({ t: 'begin', marked }),
    create: (seats) => send({ t: 'create', seats }),
    // `roomId` is still accepted by the server and ignored — the object it
    // reached IS the room. Kept in the message so the wire protocol did not
    // have to change shape for the port.
    join: (id, name) => send({ t: 'join', roomId: id, name, player: passport() }),
    /*
      One command, one press.

      From a playtest: "a card was bought from the market but it seemed to cost
      more Grit than stated". The engine charges exactly the printed cost — a
      test asserts it for every purchasable card — but nothing stopped the SAME
      command being sent twice before the answer to the first arrived, and two
      BUYs are two legal purchases at full price each. A card in the market
      sheet is bought by clicking it, and a double-click on a card is a natural
      gesture, so the second charge looked like the first one costing double.

      It got easier to hit when buying stopped costing an action: the action
      count used to run out and block the repeat.

      Identical commands only, and only while one is in flight — a second,
      DIFFERENT action is a real decision and must not be swallowed. `rev`
      counts states received, so "the board has not moved since I sent this"
      is the window.
    */
    play: (command) => {
      const key = JSON.stringify(command);
      if (sent.current?.key === key && sent.current.rev === revRef.current) return;
      sent.current = { key, rev: revRef.current };
      send({ t: 'command', command });
    },
    leave: () => {
      send({ t: 'leave' });
      // Reset locally rather than waiting to be told. The server's answer to a
      // leave is silence — the seat is simply released — and a menu that waited
      // for a reply that never comes would hang on a dropped connection.
      toMenu();
    },
    /**
     * Host only: end the table for everybody.
     *
     * The local reset waits for the server's `closed` here, unlike `leave` —
     * the difference is that this one has an answer coming, and resetting
     * first would leave the host on the menu while the table they were
     * closing may not have heard.
     */
    close: () => send({ t: 'close' }),
  };
}
