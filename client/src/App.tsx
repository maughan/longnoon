import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { card, SIGN_IDS, TUNING } from "../../content/cards";
import { opsFor, effectiveClear, effectiveMenace } from "../../engine/effects";
import type {
  Card,
  CardInstance,
  Command,
  GameEvent,
  StreetSlot,
  PlayerId,
} from "../../engine/state";
import type { ClientState } from "../../engine/view";
import { useNet, roomFor, type Net } from "./net";
import { GLOSSARY, Rules, Term, Tooltips } from "./glossary";
import { describeOps, cardKeywords, thirdLine } from "./cardText";
import { nameOf as whoIs, type Beat } from "./beats";
import { Icon, type IconName } from "./components/Icon";
import {
  CardFace,
  type CardFaceProps,
  type CardKind,
} from "./components/CardFace";
import cardBack from "./components/images/card-back.svg";
import { Dusk } from "./components/Dusk";
import { Turning } from "./components/Turning";
import { createCoinPool, type CoinPool } from "./coinPool";
import {
  createCardSounds,
  DEAL_STAGGER_MS,
  type CardSounds,
} from "./cardSounds";
import { duskReport, isDusk, type DuskReport } from "./duskReport";
import {
  BEDS,
  createAmbience,
  type Ambience,
  type BedName,
} from "./components/Ambience";
import { useSettings, type SoundSettings } from "./settings";
import { iconForCard, iconForStatus, TERM_ICONS } from "./icons";

/**
 * Where the server is.
 *
 * Configured per environment because the client is on Vercel and the server is
 * on Cloudflare — they are not the same origin in production and only look like
 * it in development. The local default keeps `npm run dev:server` working with
 * no .env at all.
 */
const PARTY_HOST =
  import.meta.env.VITE_PARTY_HOST ?? `${location.hostname}:8787`;

/**
 * The room, from the URL.
 *
 * A Durable Object is addressed by name, so the room has to be known before the
 * socket opens — it cannot be handed back in a `created` message the way it was
 * when one process held every room in a Map.
 *
 * The decision is pure (`roomFor`) and the URL is written in an effect below.
 * It used to call `history.replaceState` inside a `useState` initializer, which
 * runs DURING RENDER and which StrictMode invokes twice — two independent
 * derivations of the same code, one going into the socket and one into the
 * address bar, with nothing keeping them equal. That is the class of bug where
 * the URL says one room and you are sitting in another.
 */
function useRoomUrl(net: Net, room: string): void {
  // One writer, after render, and it prefers what the SERVER called the room —
  // so the address bar cannot claim a room the socket never opened.
  useEffect(() => {
    const named = net.roomId ?? room;
    const current = new URLSearchParams(location.search).get("room");
    if (current === named) return;
    history.replaceState(null, "", `?room=${encodeURIComponent(named)}`);
  }, [net.roomId, room]);
}

export default function App() {
  // The room has to be known before `useNet` opens the socket, so it is read
  // from the URL first and the address bar is reconciled afterwards.
  const [room] = useState(() => roomFor(location.search).room);
  const net = useNet({ room, host: PARTY_HOST });
  useRoomUrl(net, room);
  return (
    <Tooltips>
      {net.seat && net.view ? (
        <Game net={net} />
      ) : net.seat && net.table ? (
        <Waiting net={net} />
      ) : (
        <Lobby net={net} />
      )}
    </Tooltips>
  );
}

// ------------------------------------------------------------------ lobby

function Lobby({ net }: { net: Net }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [seats, setSeats] = useState(4);
  const room = code || net.roomId || "";

  return (
    <main className="lobby">
      <h1>The Long Noon</h1>
      <p className="tagline">
        A posse holding a frontier town together, and something underneath it
        waking up.
      </p>

      {!net.connected && <p className="warn">Looking for the table…</p>}
      {net.error && <p className="warn">{net.error}</p>}

      <div className="rule" />
      <h2>Open a table</h2>
      <div>
        <label>
          Chairs{" "}
          <input
            type="number"
            min={3}
            max={5}
            value={seats}
            onChange={(e) => setSeats(+e.target.value)}
          />
        </label>
      </div>
      <p className="hint">
        Three to five. Who fills them — people or bots — is decided at the table
        once everyone has arrived.
      </p>
      <div>
        <button className="primary" onClick={() => net.create(seats)}>
          Open
        </button>
        {net.roomId && (
          <span className="code">
            {" "}
            · room <strong>{net.roomId}</strong>
          </span>
        )}
      </div>

      <div className="rule" />
      <h2>Pull up a chair</h2>
      <div>
        <label>
          Name <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Room <input value={room} onChange={(e) => setCode(e.target.value)} />
        </label>
        <button
          className="primary"
          disabled={!room || !name}
          onClick={() => net.join(room, name)}
        >
          Sit down
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- waiting

/**
 * The room before the deal.
 *
 * Everyone here sees the same thing and can change any empty chair, because
 * this is a co-operative game being set up by people who are talking to each
 * other. A host with exclusive rights would only be one more person to wait for.
 */
function Waiting({ net }: { net: Net }) {
  const { seats, canBegin } = net.table!;
  const [traitor, setTraitor] = useState(true);
  const waiting = seats.filter((s) => s.kind === "open").length;

  return (
    <main className="lobby waiting">
      <h1>The Long Noon</h1>
      <p className="tagline">
        Room <strong className="code">{net.roomId}</strong> — give that to
        whoever else is playing.
      </p>

      {net.error && <p className="warn">{net.error}</p>}

      <div className="rule" />
      <h2>The table</h2>
      <ol className="chairs">
        {seats.map((s, i) => (
          <li key={s.id} className={s.kind}>
            <span className="who">
              {s.kind === "human" && (
                <>
                  {s.name}
                  {s.id === net.seat && <span className="chip sign">you</span>}
                </>
              )}
              {s.kind === "bot" && (
                <>
                  {s.name} <BotTag />
                </>
              )}
              {s.kind === "open" && <em>empty chair</em>}
            </span>
            {s.kind === "open" && (
              <button onClick={() => net.setSeat(i, "bot")}>Seat a bot</button>
            )}
            {s.kind === "bot" && (
              <button onClick={() => net.setSeat(i, "open")}>Open it up</button>
            )}
          </li>
        ))}
      </ol>

      <p className="hint">
        {waiting > 0
          ? `Waiting on ${waiting} more. Seat a bot in any chair nobody is coming to — or open one back up if someone turns up late.`
          : "Every chair is filled."}
      </p>

      <div className="rule" />
      <label>
        <input
          type="checkbox"
          checked={traitor}
          onChange={(e) => setTraitor(e.target.checked)}
        />
        One of you is <Icon name="marked" size={15} />{" "}
        <Term k="marked">Marked</Term>
      </label>
      <p className="hint">
        Play the first session without a traitor, and do not tell anyone. If the
        deck builder is not tense on its own, the traitor is covering for it.
      </p>

      <div>
        <button
          className="primary"
          disabled={!canBegin}
          onClick={() => net.begin(traitor)}
        >
          Deal
        </button>{" "}
        <button onClick={net.leave}>Leave</button>
      </div>
    </main>
  );
}

// ------------------------------------------------------------------- game

function Game({ net }: { net: Net }) {
  const v = net.view!;
  const yours = net.legal.length > 0;
  const [showGlossary, setGlossary] = useState(false);
  const [showMarket, setMarket] = useState(false);
  const [turning, endTurning] = useTurningMoment(v.act);
  /**
   * One append-only queue, in arrival order.
   *
   * Single-source now that the Dusk/Turning rehearsal buttons are gone, but
   * still not the same array as `net.beats`: the overlay holds a POSITION in
   * this list, and `net.beats` is emptied on leaving a room. Append-only is the
   * only shape that survives a consumer holding an index into it — this used to
   * merge two growing arrays, and every beat the server sent shifted the others
   * one place right, so an index already shown pointed at something new.
   */
  const [queue, enqueue] = useState<Beat[]>([]);
  const taken = useRef(0);
  useEffect(() => {
    if (net.beats.length <= taken.current) return;
    const fresh = net.beats.slice(taken.current);
    taken.current = net.beats.length;
    enqueue((q) => [...q, ...fresh]);
  }, [net.beats]);
  const [showSettings, setSettings] = useState(false);
  const [readingBoard, setReadingBoard] = useState(false);
  /**
   * The card being looked at closely.
   *
   * Its own gesture, deliberately: clicking a card already means "buy" on the
   * shelf and "aim at this" in the Street, and dragging one means play. A
   * fourth meaning for the same click would make every one of them a guess.
   */
  const [zoom, setZoom] = useState<{
    def: Card;
    fevered: boolean;
    slot?: StreetSlot;
  } | null>(null);
  /**
   * The last Dusk, held until this player has read it.
   *
   * Dismissed locally and only by whoever dismissed it. CLAUDE.md rules out an
   * acknowledgement step — waiting for everyone costs pace against the
   * 40-minute target, and in a hidden-role game how long someone spends reading
   * a Dusk is itself a tell.
   */
  const [dusk, setDusk] = useState<DuskReport | null>(null);
  const readDusk = useRef(0);
  /**
   * Whether the hand behind the sheet is a new one.
   *
   * Only then is there a deal to replay when the report comes down — remounting
   * the fan otherwise would re-deal the same five cards a player has been
   * holding all along.
   */
  const dealtUnderDusk = useRef(false);
  const [dealNonce, setDealNonce] = useState(0);
  useEffect(() => {
    if (net.feed.seq === readDusk.current) return;
    readDusk.current = net.feed.seq;
    if (isDusk(net.feed.events)) {
      setDusk(duskReport(net.feed.events, v, net.seat));
      dealtUnderDusk.current = net.feed.events.some(
        (e) => e.t === "DREW" && e.player === net.seat,
      );
    }
  }, [net.feed, v, net.seat]);
  const sound = useSettings();
  useCoins(net.feed, net.seat, sound.effectsLevel);
  useCardSounds(
    net.feed,
    net.seat,
    sound.effectsLevel,
    v.handSize ?? TUNING.handSize,
    !!dusk,
  );
  // Act I only. The bed belongs to the Long Season; once the Turning has
  // happened the silence underneath Act II is doing its own work.
  // The bed gets out of the way for the two scored moments. Dusk hands it back
  // afterwards; the Turning does not, because Act I is over by then.
  const [dusking, setDusking] = useState(false);
  const onDusk = useCallback((on: boolean) => setDusking(on), []);
  useAmbience(
    v.winner ? null : v.act === "trouble" ? "act1" : "act2",
    sound.musicLevel,
    dusking || turning || !!dusk,
  );

  /**
   * When a choice is open, the targets are the things themselves — a Threat in
   * the Street, a player in the posse. Picking from a list of buttons at the
   * bottom of the screen is filling in a form; clicking the Threat is playing.
   */
  const resolve = (key: string) =>
    net.play({ t: "RESOLVE_CHOICE", choiceId: v.pending!.id, picks: [key] });
  const targets = v.pending
    ? new Set(v.pending.options.map((o) => o.key))
    : null;
  const canTarget = (key: string) => !!targets?.has(key);
  /** Options with nothing on screen to click — the Threat deck, mostly. */
  const offscreen = (v.pending?.options ?? []).filter((o) => {
    if (/^\d+$/.test(o.key)) return false; // a Street slot
    if (o.key === "vessel") return false; // the Vessel
    return !v.opponents.some((x) => x.id === o.key) && o.key !== v.you!.id;
  });

  const byUid = useMemo(() => {
    const m = new Map<string, Command[]>();
    for (const c of net.legal) {
      const uid =
        c.t === "PLAY_CARD"
          ? c.uid
          : c.t === "SPEND_GRIT"
            ? c.uids[0]
            : c.t === "REVENANT_WHISPER"
              ? c.uid
              : null;
      if (uid) m.set(uid, [...(m.get(uid) ?? []), c]);
    }
    return m;
  }, [net.legal]);

  const [drag, setDrag] = useState<Drag | null>(null);
  /**
   * The slot a card was dropped on, held until the server asks where it went.
   *
   * Dropping a Winchester on a Threat is one gesture but two commands —
   * PLAY_CARD, then RESOLVE_CHOICE once the server offers targets. Answering
   * that prompt with the slot the player already pointed at is the whole reason
   * to drag onto a Threat rather than onto the felt. It is only ever used when
   * the server actually offers that slot as an option, so it cannot smuggle in
   * a target the rules did not.
   */
  const aimed = useRef<{ key: string; after: number } | null>(null);

  useEffect(() => {
    const want = aimed.current;
    if (!want) return;
    // Wait for OUR reply. Without this, any state arriving between the drop and
    // the server's answer — a bot acting, a beat — would consume the aim, and
    // any state after it could hand a stale target to an unrelated prompt.
    if (net.rev <= want.after) return;
    aimed.current = null;
    if (v.pending?.options.some((o) => o.key === want.key)) {
      net.play({
        t: "RESOLVE_CHOICE",
        choiceId: v.pending.id,
        picks: [want.key],
      });
    }
    // Not offered: leave the prompt up and let them choose properly.
  }, [v.pending, net.rev, net]);

  const buys = net.legal.filter((c) => c.t === "BUY");
  const loose = net.legal.filter(
    (c) =>
      ![
        "PLAY_CARD",
        "SPEND_GRIT",
        "BUY",
        "REVENANT_WHISPER",
        "RESOLVE_CHOICE",
      ].includes(c.t),
  );

  return (
    <div className="app">
      <TopBar
        v={v}
        yours={yours}
        dev={net.dev}
        onAct={(action) => net.send({ t: "dev", action })}
        onGlossary={() => setGlossary(true)}
        onSettings={() => setSettings(true)}
      />

      <div className="felt">
        <div
          className={`centre ${drag?.play ? "takes" : ""}`}
          onDragOver={drag?.play ? (e) => e.preventDefault() : undefined}
          onDrop={
            drag?.play
              ? (e) => {
                  e.preventDefault();
                  net.play(drag.play!);
                  setDrag(null);
                }
              : undefined
          }
        >
          <Street
            v={v}
            canTarget={canTarget}
            onTarget={resolve}
            drag={drag}
            onZoom={(def, slot) => setZoom({ def, fevered: false, slot })}
            onDropOn={(slot) => {
              // Remember where it was pointed before the card is even played.
              aimed.current = { key: String(slot), after: net.rev };
              net.play(drag!.play!);
              setDrag(null);
            }}
          />
        </div>
        <aside className="side">
          <Posse
            v={v}
            canTarget={canTarget}
            onTarget={resolve}
            bots={net.bots}
          />
          <div className="chronicle">
            <h2>The chronicle</h2>
            <ol>
              {net.log.map((l, i) => (
                <li key={i}>
                  <Rules text={l} />
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>

      <Hand
        v={v}
        byUid={byUid}
        loose={loose}
        yours={yours}
        onPlay={net.play}
        onMarket={() => setMarket(true)}
        buyable={buys.length}
        drag={drag}
        onDrag={setDrag}
        onZoom={(def, fevered) => setZoom({ def, fevered })}
        dealNonce={dealNonce}
        holdDeal={!!dusk && dealtUnderDusk.current}
      />

      {v.pending && (
        <div className="choice">
          <h2>{v.pending.prompt}</h2>
          {offscreen.length > 0 ? (
            <div className="opts">
              {offscreen.map((o) => (
                <button
                  key={o.key}
                  className="primary"
                  onClick={() => resolve(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">Click what you mean.</p>
          )}
        </div>
      )}

      {showMarket && (
        <MarketPanel
          v={v}
          buys={buys}
          onPlay={net.play}
          onClose={() => setMarket(false)}
          onZoom={(def, fevered) => setZoom({ def, fevered })}
        />
      )}

      {turning && (
        // The piece draws itself in ink on paper and floods to dark, so it
        // needs a paper ground under it — on the felt the opening beats would
        // be black on black. The white cut is also the point: Act I stops.
        <div className="turning-stage">
          <Turning
            whispers={v.whisperThreshold}
            onComplete={endTurning}
            volume={sound.effectsLevel}
          />
        </div>
      )}

      {v.winner && !readingBoard && (
        <div className="verdict">
          <h1>{v.winner === "posse" ? "The town holds" : "The long noon"}</h1>
          <p className="muted">
            {v.winner === "posse"
              ? "The Vessel is buried. Whatever it was, it is under the ground again."
              : "Doom ran out the clock. It was always going to be someone."}
          </p>
          <Verdict v={v} bots={net.bots} />
          <div className="opts">
            {/* Reading the final board is most of the post-mortem in a
             * hidden-role game — who was Marked, who was carrying what. */}
            <button onClick={() => setReadingBoard(true)}>
              Look at the table
            </button>
            <button className="primary" onClick={net.leave}>
              Back to the menu
            </button>
          </div>
        </div>
      )}
      {v.winner && readingBoard && (
        <button className="verdict-back" onClick={() => setReadingBoard(false)}>
          The result
        </button>
      )}

      <Announce beats={queue} sound={sound.effectsLevel} onDusk={onDusk} />

      {dusk && (
        <DuskSheet
          report={dusk}
          volume={sound.effectsLevel}
          onClose={() => {
            setDusk(null);
            // Deal now, in front of them, rather than having dealt behind it.
            if (dealtUnderDusk.current) {
              dealtUnderDusk.current = false;
              setDealNonce((n) => n + 1);
            }
          }}
        />
      )}

      {zoom && (
        <CardZoom
          {...zoom}
          omenMenace={v.omenMenace}
          onClose={() => setZoom(null)}
        />
      )}
      {showSettings && (
        <SettingsPanel
          s={sound}
          handSize={v.handSize}
          onClose={() => setSettings(false)}
        />
      )}
      {showGlossary && <GlossaryPanel onClose={() => setGlossary(false)} />}
    </div>
  );
}

/**
 * Who everyone turned out to be.
 *
 * Roles reveal at the Turning, so by the end this is public — but it is spread
 * across a rail nobody reads while the verdict is up, and it is the first thing
 * anyone asks about afterwards.
 */
function Verdict({ v, bots }: { v: ClientState; bots: PlayerId[] }) {
  const me = v.you!;
  const seats = [
    { name: "You", role: me.role, status: me.status, id: me.id },
    ...v.opponents.map((o) => ({
      name: o.name,
      role: o.role,
      status: o.status,
      id: o.id,
    })),
  ];
  return (
    <dl className="whowas">
      {seats.map((p) => (
        <div key={p.id}>
          <dt>
            {p.name}
            {bots.includes(p.id) && <BotTag size={12} />}
          </dt>
          <dd>
            {p.role === "marked" && (
              <>
                <Icon name="marked" size={13} /> Marked
              </>
            )}
            {p.role !== "marked" && p.role !== null && "Faithful"}
            {p.role === null && "never revealed"}
            {v.vessel === p.id && (
              <>
                {" · "}
                <Icon name="vessel" size={13} /> the Vessel
              </>
            )}
            {p.status === "revenant" && (
              <>
                {" · "}
                <Icon name="revenant" size={13} /> fell
              </>
            )}
            {p.status === "gone" && (
              <>
                {" · "}
                <Icon name="grave" size={13} /> gone
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Everything Dusk did, on one page.
 *
 * Dismissed locally: the game does not wait for the table to agree it has been
 * read. See CLAUDE.md — an acknowledgement step costs pace and, worse, leaks a
 * timing tell in a game where one player is hiding something.
 */
function DuskSheet({
  report,
  volume,
  onClose,
}: {
  report: DuskReport;
  volume: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const section = (title: string, lines: DuskReport["menace"]) =>
    lines.length > 0 && (
      <section key={title}>
        <h2>{title}</h2>
        <ul>
          {lines.map((l, i) => (
            <li
              key={i}
              className={[l.yours ? "yours" : "", l.dire ? "dire" : ""]
                .filter(Boolean)
                .join(" ")}
            >
              <Icon name={l.icon} size={15} />
              <Rules text={l.text} />
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="sheet dusksheet" onClick={onClose}>
      <div className="sheet-inner" onClick={(e) => e.stopPropagation()}>
        <div className="dusk-head">
          <Dusk
            round={report.round}
            width={420}
            duration={DUSK_MS}
            volume={volume}
          />
          <h1>Dusk</h1>
          <p className="muted">
            {report.quiet
              ? "The Street was quiet. Nothing came due."
              : `Round ${report.round} collects what it is owed.`}
          </p>
        </div>

        <div className="dusk-body">
          {section("What it cost", report.menace)}
          {section("What arrived", report.arrivals)}
          {section("What got worse", report.escalated)}
          {section("The tracks", report.tracks)}
        </div>

        <div className="opts">
          <button className="primary" onClick={onClose}>
            Ride on
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The table says what it just did.
 *
 * Beats queue rather than interrupt — a bot acting every 900ms would otherwise
 * overwrite its own sentence before it could be read. When the queue backs up
 * the hold shortens instead of dropping beats, so the story stays complete and
 * simply moves faster.
 */
/**
 * The longest a beat stays up.
 *
 * A new beat replaces it sooner; nothing extends it. Lingering until superseded
 * was tried and read as clutter — with bots on a five-second floor it meant
 * something was on screen almost permanently, and a message that is always
 * there stops being read.
 */
const MAX_HOLD_MS = 2400;

/**
 * The least a beat may be shown for, so a burst cannot flash past.
 *
 * Only reached when something is already waiting behind it; otherwise the beat
 * lingers. Dusk's floor is the length of its own animation and clip.
 */
function minHold(b: Beat, waiting: number): number {
  if (b.kind === "dusk") return DUSK_HOLD;
  if (b.kind === "turn") return 1600;
  return waiting > 3 ? 1100 : 1400;
}

/** Must match `duration` in components/styles/Dusk.css. */
const DUSK_MS = 2400;
/**
 * How long the Dusk beat stays up.
 *
 * Longer than the arc, because dusk.mp3 runs 3.19s and the sun landing in
 * silence with the last of the sound cut off is worse than a moment's hold.
 * Raising this means raising `duskMs` in server/hub.ts to match, or the bots
 * start moving again underneath it.
 */
const DUSK_HOLD = 3400;

function Announce({
  beats,
  sound,
  onDusk,
}: {
  beats: Beat[];
  sound: number;
  onDusk: (on: boolean) => void;
}) {
  const [at, setAt] = useState(0);
  const [now, setNow] = useState<Beat | null>(null);
  // When the current beat went up, so a beat arriving behind it can cut the
  // lingering one short instead of granting it a fresh hold.
  const shownAt = useRef(0);

  useEffect(() => {
    // Arriving mid-game should not replay the backlog.
    if (at === 0 && beats.length > 1) {
      setAt(beats.length - 1);
      return;
    }
    if (now || at >= beats.length) return;
    // Everything a Dusk produced is in the Dusk report; showing it here as well
    // plays the same news twice, behind the sheet that is already saying it.
    if (beats[at].fromDusk) {
      setAt(at + 1);
      return;
    }
    setNow(beats[at]);
    setAt(at + 1);
  }, [beats, at, now]);

  useEffect(() => {
    if (now) shownAt.current = performance.now();
  }, [now]);

  useEffect(() => {
    if (!now) return;
    const waiting = beats.length - at;
    const elapsed = performance.now() - shownAt.current;
    const left = Math.max(0, minHold(now, waiting) - elapsed);
    // Something behind it: show it for its minimum and move on. Nothing behind
    // it: hold to the cap and clear.
    //
    // `elapsed` is what makes the arriving beat cut this one short rather than
    // grant it a fresh hold: this effect re-runs when the queue grows, and
    // without it every new arrival would restart the clock.
    const ms = waiting > 0 ? left : Math.max(left, MAX_HOLD_MS - elapsed);
    const t = setTimeout(() => setNow(null), ms);
    return () => clearTimeout(t);
  }, [now, beats.length, at]);

  // The bed above needs to know the sun is falling. Reported rather than
  // guessed, because the beat queue decides when a Dusk actually reaches the
  // screen and that is not when the event arrived.
  const dusk = now?.kind === "dusk";
  useEffect(() => {
    onDusk(dusk);
  }, [dusk, onDusk]);

  if (!now) return null;
  return (
    <div className={`beat ${now.kind}`} key={now.id} aria-live="polite">
      {now.kind === "dusk" ? (
        // No onSettled: the engine resolved Dusk before this ever arrived. The
        // sun is reporting what happened, not gating it — a client that held
        // the rules back on an animation would be a client with rules in it.
        <Dusk round={now.id} width={230} duration={DUSK_MS} volume={sound} />
      ) : (
        now.icon && <Icon name={now.icon} size={26} className="beatmark" />
      )}
      <strong>{now.title}</strong>
      {now.detail && (
        <em>
          <Rules text={now.detail} />
        </em>
      )}
    </div>
  );
}

/**
 * The sound a card makes when it is played.
 *
 * Driven off the event feed rather than off your own click, so the whole table
 * is audible — a bot firing the Six-Gun should sound like a shot, not like
 * nothing. A card that needs a target sounds when the target is chosen, which
 * is why `cardSounds` carries state between batches rather than being a
 * function of one.
 * Kept apart from `useCoins` because they answer to different events and would
 * otherwise be one function doing two jobs badly.
 */
function useCardSounds(
  feed: Net["feed"],
  seat: PlayerId | null,
  level: number,
  /** From the view: what counts as a whole hand rather than a single draw. */
  handSize: number,
  /** True while the Dusk report is up. Draws wait for it. */
  duskOpen: boolean,
): void {
  const sounds = useRef<CardSounds | null>(null);
  const seen = useRef(0);
  /**
   * Draws that arrived under the Dusk sheet.
   *
   * The Dusk batch carries the whole of the next round with it — Dusk resolves,
   * the round begins, and the first player is dealt a hand, all in one message.
   * So the deal happened behind the report: the sound played to a covered
   * table and the cards were already lying there when the sheet came down.
   * Held here and played when the player has actually looked away from it.
   */
  const held = useRef<GameEvent[]>([]);

  useEffect(() => {
    if (feed.seq === seen.current) return;
    // Marked seen even when muted, or unmuting would replay an old batch.
    seen.current = feed.seq;
    if (level <= 0) return;
    sounds.current ??= createCardSounds();

    // Judged from the batch, not from `duskOpen`: the sheet and this hook are
    // told about the same message in the same commit, so reading the flag here
    // would be a race with whichever effect ran first.
    if (isDusk(feed.events)) {
      held.current = feed.events.filter((e) => e.t === "DREW");
      sounds.current.hear(
        feed.events.filter((e) => e.t !== "DREW"),
        seat,
        level,
        handSize,
      );
      return;
    }
    sounds.current.hear(feed.events, seat, level, handSize);
  }, [feed, seat, level, handSize]);

  // The sheet is down: deal.
  useEffect(() => {
    if (duskOpen || !held.current.length) return;
    const pending = held.current;
    held.current = [];
    if (level <= 0) return;
    sounds.current ??= createCardSounds();
    sounds.current.hear(pending, seat, level, handSize);
  }, [duskOpen, seat, level, handSize]);
}

/**
 * Coins, on the two moments money changes hands: a card cashed in for Grit, and
 * a card bought.
 *
 * Driven off the event feed rather than off the button you pressed, so the
 * whole table is audible — a bot buying the Colt should sound like something
 * happening, not like nothing. Other people's coins play quieter than your own,
 * which is roughly how a table sounds anyway.
 */
function useCoins(
  feed: Net["feed"],
  seat: PlayerId | null,
  level: number,
): void {
  const pool = useRef<CoinPool | null>(null);
  const seen = useRef(0);

  useEffect(() => {
    if (feed.seq === seen.current) return;
    // Marked seen even when muted, or unmuting would replay an old batch.
    seen.current = feed.seq;
    if (level <= 0) return;
    // Built on first use: constructing six Audio elements before anyone has
    // sat down is work for a page that may never make a sound.
    pool.current ??= createCoinPool();

    let mine = 0;
    let theirs = 0;
    let bought: { by: PlayerId; sign: boolean } | null = null;
    for (const e of feed.events) {
      // GRIT covers both ways coins arrive: cashing a card in, and a card that
      // simply gives you Grit. Both are money on the table.
      if (e.t === "GRIT") {
        if (e.player === seat) mine += e.amount;
        else theirs += e.amount;
      }
      if (e.t === "BOUGHT") {
        bought = { by: e.player, sign: card(e.cardId).type === "sign" };
      }
    }
    // Buying is money leaving, and reads as one payment rather than a count.
    // A Sign gets its own sound: at this table it is the purchase that costs
    // everyone something, and it should be audible from across the room.
    if (bought?.sign) pool.current.sign(level * (bought.by === seat ? 1 : 0.7));
    else if (bought) pool.current.play(level * (bought.by === seat ? 1 : 0.55));
    if (mine) pool.current.playMany(Math.min(mine, 5), level);
    if (theirs) pool.current.playMany(Math.min(theirs, 5), level * 0.5);
  }, [feed, seat, level]);
}

/**
 * The ambience bed, one per Act, handing over at the Turning.
 *
 * Two effects rather than one. Starting is a lifecycle event and happens twice
 * a game at most, but the volume changes whenever the player drags a slider —
 * folded together, every drag would try to start a second copy of a loop
 * slightly out of phase with the first, which sounds precisely like a broken
 * loop.
 */
function useAmbience(
  bed: BedName | null,
  volume: number,
  ducked = false,
): void {
  const beds = useRef<Partial<Record<BedName, Ambience>>>({});
  const wanted = volume > 0 ? bed : null;

  // Read inside the lifecycle effect without being a dependency of it: making
  // it one would re-run start(), which resets the volume and fights the duck.
  const duckNow = useRef(ducked);
  duckNow.current = ducked;

  useEffect(() => {
    // Whatever is not wanted goes, including the outgoing half of a hand-over.
    for (const [name, live] of Object.entries(beds.current)) {
      // The Turning ends Act I and ducks at the same instant. Leaving on the
      // long fade would put Act I music under the first third of the piece.
      if (name !== wanted) live?.fadeOut(duckNow.current ? 0.4 : 2.5);
    }
    if (!wanted) return;
    beds.current[wanted] ??= createAmbience(BEDS[wanted]);
    // Starting silent under a duck: the volume effect below brings it up when
    // the scored moment has finished, rather than fading in underneath it.
    const level = duckNow.current ? 0 : volume;
    // Never swallow this. The whole failure mode here is silence, and silence
    // is also what success sounds like before the fade-in finishes.
    void beds.current[wanted].start(level).catch((err) => {
      console.warn(`The ${wanted} bed did not start:`, err);
    });
    // `volume` is deliberately not a dependency — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  useEffect(() => {
    if (!wanted) return;
    beds.current[wanted]?.setVolume(ducked ? 0 : volume, ducked ? 0.35 : 1.6);
  }, [wanted, volume, ducked]);

  // An AudioContext outlives React unless it is told not to — and the refs must
  // be cleared with it. StrictMode mounts, disposes and remounts in
  // development; leaving a disposed bed behind meant the remount found a
  // truthy value, skipped `??=`, and called start() on a closed context.
  useEffect(
    () => () => {
      for (const live of Object.values(beds.current)) live?.dispose();
      beds.current = {};
    },
    [],
  );
}

/**
 * The Turning is the game's hinge — it should land as an event, not a repaint.
 *
 * No timer of its own: the animation knows how long it is and says so through
 * `onComplete`. That callback MUST be stable — `Turning` keys its 3.1s timeout
 * on it, so a fresh arrow every render would restart the piece on every state
 * update and it would never finish.
 */
function useTurningMoment(
  act: ClientState["act"],
): readonly [boolean, () => void] {
  const [seen, setSeen] = useState(act);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (seen === "trouble" && act === "mythos") setShown(true);
    setSeen(act);
  }, [act, seen]);
  const end = useCallback(() => setShown(false), []);
  // No manual trigger. The act changing is the only thing that opens this —
  // including via the dev "-> Act II" button, which goes through the server and
  // comes back as a real Turning rather than playing the animation on its own.
  return [shown, end] as const;
}

// ------------------------------------------------------------------ parts

function TopBar({
  v,
  yours,
  onGlossary,
  onSettings,
  dev,
  onAct,
}: {
  v: ClientState;
  yours: boolean;
  onGlossary: () => void;
  onSettings: () => void;
  dev: boolean;
  onAct: (action: "turning" | "restart") => void;
}) {
  const me = v.you!;
  return (
    <header className="bar">
      <div className="act">
        {v.act === "trouble" ? "The Long Season" : "The Mythos"}
        <small>round {v.round}</small>
      </div>

      {/*
        One bar, both acts. What waits at the top of it changes — the Turning,
        then Doom — and the caption says which, because a bar that resets with
        no explanation reads as a bug rather than as a clock.
      */}
      <Track
        icon="whisper"
        label={<Term k="whispers" />}
        now={v.whispers}
        max={v.whisperThreshold}
        note={
          v.act === "trouble"
            ? undefined
            : `+${v.nextFillDoom} Doom when it fills` +
              (v.whisperFills ? ` · filled ${v.whisperFills}× so far` : "")
        }
      />
      {v.act === "mythos" && (
        <Track
          icon="doom"
          label={<Term k="doom" />}
          now={v.doom}
          max={v.doomTarget}
          tone="doom"
        />
      )}
      {v.vessel && (
        <Track
          icon="vessel"
          label={<Term k="vessel">Burial</Term>}
          now={v.vesselDamage}
          max={v.vesselClear}
          tone="vessel"
        />
      )}

      <div className="self">
        <span className="coin">
          <Icon name="grit" size={17} />
          <b>{me.grit}</b> <Term k="grit" />
        </span>
        <span className="coin">
          <b>{v.actionsLeft}</b> <span className="muted">actions</span>
        </span>
        <span className={`turnflag ${yours ? "mine" : "busy"}`}>
          {v.winner
            ? "the game is over"
            : yours
              ? "your move"
              : v.activePlayer === me.id
                ? "resolving"
                : `${whoIs(v, v.activePlayer, me.id)}'s Turn`}
        </span>
        {dev && (
          // These change the game, and only exist when the server was started
          // with them on.
          <span className="devbox" title="Development tools">
            {v.act === "trouble" ? (
              <button
                className="pilebtn warn"
                onClick={() => onAct("turning")}
                title="Force the Turning for real: names the Vessel, turns every
Sign, flips the Street. Not a legal move — a development tool."
              >
                → Act II
              </button>
            ) : (
              <button
                className="pilebtn warn"
                onClick={() => onAct("restart")}
                title="Deal a fresh game. There is no way back from the Turning,
so Act I means a new deal."
              >
                → Act I (new deal)
              </button>
            )}
          </span>
        )}
        <button
          className="pilebtn cog"
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
        >
          <Cog />
        </button>
        <button className="pilebtn" onClick={onGlossary}>
          Rules
        </button>
      </div>
    </header>
  );
}

/**
 * Beads on a string.
 *
 * One pip per point where the total is small enough to count — which is the
 * whole reason to prefer them to a bar. A bar says "about two thirds"; pips say
 * "four of six", and four of six is the number a player is actually deciding
 * against. Only a track too long to count (Doom at 50) is scaled.
 */
function Pips({ now, max, tone }: { now: number; max: number; tone?: string }) {
  const countable = max > 0 && max <= MAX_PIPS;
  const count = countable ? max : MAX_PIPS;
  const lit = countable
    ? Math.min(now, max)
    : Math.round((Math.min(now, max) / Math.max(max, 1)) * count);
  return (
    <div className={`pips ${tone ?? ""}`}>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={`pip ${i < lit ? "on" : ""}`} />
      ))}
    </div>
  );
}

const MAX_PIPS = 20;

/** Beads on a string read as a track. A progress bar reads as a download. */
function Track({
  icon,
  label,
  now,
  max,
  note,
  tone = "whisper",
}: {
  icon: IconName;
  label: React.ReactNode;
  now: number;
  max: number;
  /** What happens when it fills, when that is not obvious. */
  note?: string;
  tone?: string;
}) {
  /*
    Coerced, because this has now shipped "/NaN" twice.
    A field the running server does not yet send arrives as `undefined`, and
    every arithmetic path downstream — Math.max, the Pips division — turns that
    into NaN and prints it. The track is the most-read thing on the screen and
    it should degrade to a wrong number rather than to a broken one.
  */
  const at = Number.isFinite(now) ? Math.max(0, now) : 0;
  const of = Number.isFinite(max) && max > 0 ? max : 1;
  return (
    <div className={`track ${tone}`} title={note}>
      <Icon name={icon} size={15} />
      <span>
        {label} {at}/{of}
      </span>
      <Pips now={at} max={of} />
    </div>
  );
}

function Street({
  v,
  canTarget,
  onTarget,
  drag,
  onDropOn,
  onZoom,
}: {
  v: ClientState;
  canTarget: (k: string) => boolean;
  onTarget: (k: string) => void;
  drag: Drag | null;
  onDropOn: (slot: number) => void;
  onZoom: (def: Card, slot: StreetSlot) => void;
}) {
  return (
    <section className="stage">
      <h2>
        <Icon name="street" size={15} /> The Street
      </h2>
      <div className="street">
        {v.street.map((slot, i) => {
          if (!slot)
            return (
              <div key={i} className="slot vacant">
                quiet, for now
              </div>
            );
          const def = card(slot.instance.cardId);
          // The lived value, not the printed one. A Threat that has escalated
          // needs more damage than its card says, and a bar measured against
          // the printed total reads full while the Threat is still standing.
          const clear = effectiveClear(slot) ?? 0;
          const hot = canTarget(String(i));
          const takes = !!drag?.play;
          return (
            <div
              key={i}
              role={hot ? "button" : undefined}
              tabIndex={hot ? 0 : undefined}
              onClick={hot ? () => onTarget(String(i)) : undefined}
              onKeyDown={
                hot
                  ? (e) => e.key === "Enter" && onTarget(String(i))
                  : undefined
              }
              onDragOver={
                takes
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  : undefined
              }
              onDrop={
                takes
                  ? (e) => {
                      // Stop it reaching the felt behind, which would play the card
                      // with no aim and then ask where it went.
                      e.preventDefault();
                      e.stopPropagation();
                      onDropOn(i);
                    }
                  : undefined
              }
              className={[
                "slot",
                def.type === "omen" ? "omen" : "",
                hot ? "hot" : "",
                takes ? "takes" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <CardFace
                {...faceOf(def, false, { slot, omenMenace: v.omenMenace })}
                width={168}
              />
              {/* Damage taken is state, not the card, so it sits under it. An
               * Omen has no Clear value and gets no bar — the absence is the
               * point. */}
              {effectiveClear(slot) !== undefined && (
                <div
                  className="wound"
                  title={`${slot.damage} of ${clear} damage`}
                >
                  {/* Pips, not a bar: "two of five" is the number a player is
                   * deciding against — whether one more card finishes it. A
                   * bar makes them estimate that. */}
                  <Pips now={slot.damage} max={clear} tone="hurt small" />
                </div>
              )}
              {slot.menaceCancelled && (
                <div className="hush">silenced this round</div>
              )}
              <button
                className="lens"
                title="Look at this Threat closely"
                aria-label={`Look closely at ${def.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onZoom(def, slot);
                }}
              >
                <LensMark />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The market is somewhere you go, not something in the way of the table. */
function MarketPanel({
  v,
  buys,
  onPlay,
  onClose,
  onZoom,
}: {
  v: ClientState;
  buys: Command[];
  onPlay: (c: Command) => void;
  onClose: () => void;
  onZoom: (def: Card, fevered: boolean) => void;
}) {
  const [tab, setTab] = useState<"provisions" | "signs">("provisions");
  const ids =
    tab === "provisions" ? v.provisionRow.map((ci) => ci.cardId) : SIGN_IDS;
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-inner" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h1>The market</h1>
          <button
            className={tab === "provisions" ? "primary" : ""}
            onClick={() => setTab("provisions")}
          >
            <Icon name="kit" size={14} /> <Term k="provisions">Provisions</Term>{" "}
            · {v.provisionsLeft} left
          </button>
          <button
            className={tab === "signs" ? "primary" : ""}
            onClick={() => setTab("signs")}
          >
            <Icon name="sign" size={14} /> <Term k="signs">Signs</Term> · always
            available
          </button>
          <span className="coin">
            <Icon name="grit" size={17} />
            <b>{v.you!.grit}</b> <Term k="grit" />
          </span>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="shelf">
          {ids.map((id, i) => {
            const buy = buys.find((c) => c.t === "BUY" && c.cardId === id);
            return (
              <PlayCard
                key={`${id}-${i}`}
                def={card(id)}
                fevered={false}
                dim={!buy}
                actions={buy ? [{ cmd: buy, label: "Buy" }] : []}
                onPlay={onPlay}
                onPick={buy ? () => onPlay(buy) : undefined}
                onZoom={() => onZoom(card(id), false)}
                market
              />
            );
          })}
          {!ids.length && <span className="muted">the shelves are bare</span>}
        </div>
      </div>
    </div>
  );
}

function Posse({
  v,
  canTarget,
  onTarget,
  bots,
}: {
  v: ClientState;
  canTarget: (k: string) => boolean;
  onTarget: (k: string) => void;
  bots: PlayerId[];
}) {
  /** The Vessel is named by its own key, not by the player id. */
  const keyFor = (id: string) =>
    canTarget(id)
      ? id
      : v.vessel === id && canTarget("vessel")
        ? "vessel"
        : null;
  return (
    <div className="posse">
      <h2>The posse</h2>
      <div className="who">
        {v.opponents.map((o) => {
          const hot = keyFor(o.id);
          return (
            <div
              key={o.id}
              role={hot ? "button" : undefined}
              tabIndex={hot ? 0 : undefined}
              onClick={hot ? () => onTarget(hot) : undefined}
              onKeyDown={
                hot ? (e) => e.key === "Enter" && onTarget(hot) : undefined
              }
              className={`seat ${v.activePlayer === o.id ? "acting" : ""} ${hot ? "hot" : ""}`}
            >
              <div className="top">
                <strong>{o.name}</strong>
                {bots.includes(o.id) && <BotTag />}
                {/* One chip for what the seat IS — StatusChip covers the
                    Vessel now, so the separate "the Vessel" chip that used to
                    sit beside `oldOne` is gone. */}
                {o.status !== "posse" && <StatusChip status={o.status} />}
                {o.role === "marked" && (
                  <span className="chip sign">
                    <Icon name="marked" size={12} /> Marked
                  </span>
                )}
              </div>
              <div className="vitals">
                <span className="stat" title={vitalsTitle(o)}>
                  <Icon name="kit" size={13} />
                  {cardsLeft(o)} left
                </span>{" "}
                · {o.handCount} in hand
                {o.signsHeld ? (
                  <>
                    {" "}
                    ·{" "}
                    <span className="stat">
                      <Icon name="sign" size={13} />
                      {o.signsHeld}
                    </span>
                  </>
                ) : null}
                {o.scars ? (
                  <>
                    {" "}
                    ·{" "}
                    <span className="stat bad">
                      <Icon name="scar" size={13} />
                      {o.scars}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
        <SelfSeat v={v} canTarget={canTarget} onTarget={onTarget} />
      </div>
    </div>
  );
}

/**
 * Everything a player still has, which in this game is their life.
 *
 * Deck-as-health (DESIGN.md §5): you fall when you would draw and cannot, and
 * `refill` shuffles the discard back under you first — so what is keeping
 * somebody standing is the deck PLUS the discard, plus the hand that joins the
 * discard at the end of their turn. The draw pile alone says nothing: a player
 * showing "2 deck" may have twenty cards and be perfectly safe.
 *
 * The boneyard is the one pile that does not come back, so it is not counted.
 */
function cardsLeft(p: {
  deckCount: number;
  handCount: number;
  discard: unknown[];
}): number {
  return p.deckCount + p.handCount + p.discard.length;
}

function vitalsTitle(p: {
  deckCount: number;
  handCount: number;
  discard: unknown[];
  boneyard: unknown[];
}): string {
  return (
    `${p.deckCount} in the deck, ${p.discard.length} in the discard, ` +
    `${p.handCount} in hand — all of it comes back around` +
    (p.boneyard.length ? `. ${p.boneyard.length} gone for good.` : ".")
  );
}

/** What has become of someone, said once rather than in two places. */
/**
 * What a seat IS, in one chip.
 *
 * Labelled, not printed raw. This used to render the status string straight
 * out of the engine, so a possessed seat was tagged `oldOne` — the camelCase
 * identifier — beside a second chip reading "the Vessel". Two tags on one seat,
 * with no difference between them because there is no difference: the Vessel
 * is the player and the Old One is what is using them.
 *
 * There is one chip now and it is this one. Anything that wants to say "this
 * seat is the Vessel" says it here, and the label map is the only place the
 * word is written.
 */
const STATUS_LABEL: Record<string, string> = {
  vessel: "the Vessel",
  revenant: "Revenant",
  gone: "gone",
  posse: "posse",
};

function StatusChip({
  status,
}: {
  status: ClientState["you"] extends null
    ? never
    : NonNullable<ClientState["you"]>["status"];
}) {
  const ico = iconForStatus(status);
  return (
    <span className={`chip ${status === "vessel" ? "sign" : "bad"}`}>
      {ico && <Icon name={ico} size={12} />}{" "}
      <Rules text={STATUS_LABEL[status] ?? status} />
    </span>
  );
}

/** You are a target too — Salt Line wards a player, and it may well be you. */
function SelfSeat({
  v,
  canTarget,
  onTarget,
}: {
  v: ClientState;
  canTarget: (k: string) => boolean;
  onTarget: (k: string) => void;
}) {
  const me = v.you!;
  const hot = canTarget(me.id)
    ? me.id
    : v.vessel === me.id && canTarget("vessel")
      ? "vessel"
      : null;
  return (
    <div
      role={hot ? "button" : undefined}
      tabIndex={hot ? 0 : undefined}
      onClick={hot ? () => onTarget(hot) : undefined}
      onKeyDown={hot ? (e) => e.key === "Enter" && onTarget(hot) : undefined}
      className={`seat mine ${v.activePlayer === me.id ? "acting" : ""} ${hot ? "hot" : ""}`}
    >
      <div className="top">
        <strong>You</strong>
        {me.role === "marked" && (
          <span className="chip sign">
            <Icon name="marked" size={12} /> Marked
          </span>
        )}
        {me.status !== "posse" && <StatusChip status={me.status} />}
        {v.vessel === me.id && (
          <span className="chip sign">
            <Icon name="vessel" size={12} /> the Vessel
          </span>
        )}
      </div>
      <div className="vitals">
        <span
          className="stat"
          title={vitalsTitle({
            deckCount: me.deckCount,
            handCount: me.hand.length,
            discard: me.discard,
            boneyard: me.boneyard,
          })}
        >
          <Icon name="kit" size={13} />
          {cardsLeft({
            deckCount: me.deckCount,
            handCount: me.hand.length,
            discard: me.discard,
          })}{" "}
          left
        </span>{" "}
        · {me.hand.length} in hand
        {me.scars ? (
          <>
            {" "}
            ·{" "}
            <span className="stat bad">
              <Icon name="scar" size={13} />
              {me.scars}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Hand({
  v,
  byUid,
  loose,
  yours,
  onPlay,
  onMarket,
  buyable,
  drag,
  onDrag,
  onZoom,
  dealNonce,
  holdDeal,
}: {
  v: ClientState;
  byUid: Map<string, Command[]>;
  loose: Command[];
  yours: boolean;
  onPlay: (c: Command) => void;
  onMarket: () => void;
  buyable: number;
  drag: Drag | null;
  onDrag: (d: Drag | null) => void;
  onZoom: (def: Card, fevered: boolean) => void;
  /** Bumped to deal the current hand again, once the Dusk report is closed. */
  dealNonce: number;
  /**
   * Do not show the hand yet.
   *
   * The Dusk batch deals the next hand along with everything else, so the cards
   * were lying face up behind the report — dimly, through the scrim, and fully
   * the moment it closed. Animating them afterwards only replayed something the
   * player had already been shown.
   */
  holdDeal: boolean;
}) {
  const me = v.you!;

  /**
   * Cards that were not in the hand a moment ago.
   *
   * React keys the fan by uid, so a newly dealt card mounts and an untouched
   * one does not — but every card in a fresh hand mounts in the SAME commit,
   * which is why they all appeared at once. Numbering the arrivals lets each
   * one wait its turn.
   *
   * Tracked against the previous hand rather than a set of everything ever
   * seen: a card goes to the discard, gets shuffled back and is drawn again
   * under the same uid, and the second time it is new again.
   */
  const inHand = me.hand.map((ci) => ci.uid);
  const previous = useRef<{ nonce: number; uids: string[] }>({
    nonce: dealNonce,
    uids: [],
  });
  // A new nonce means "deal this hand again": every card counts as an arrival,
  // and the fan below is keyed by it so they remount and animate.
  const replay = previous.current.nonce !== dealNonce;
  const arrivals = replay
    ? inHand
    : inHand.filter((uid) => !previous.current.uids.includes(uid));
  useEffect(() => {
    // While held, forget nothing: the hand behind the report must still count
    // as new when it is finally shown.
    if (holdDeal) return;
    previous.current = { nonce: dealNonce, uids: inHand };
  });
  return (
    <section className="hand">
      <div className="hand-head">
        <h2 style={{ margin: 0 }}>Your hand</h2>
        {/* <button className={buyable ? "primary" : ""} onClick={onMarket}>
          Market{buyable ? ` · ${buyable} affordable` : ""}
        </button> */}
        {loose.map((c, i) => (
          <button
            key={i}
            className={c.t === "END_TURN" ? "" : "primary"}
            onClick={() => onPlay(c)}
          >
            {labelFor(c)}
          </button>
        ))}
        <div className="piles">
          <Pile
            label="Boneyard"
            icon="grave"
            n={me.boneyard.length}
            cards={me.boneyard}
            hint={GLOSSARY.boneyard.long}
            omenMenace={v.omenMenace}
            onZoom={onZoom}
          />
          {me.scars > 0 && (
            <Pile
              label="Scars"
              icon="scar"
              n={me.scars}
              hint={GLOSSARY.scars.long}
            />
          )}
        </div>
      </div>

      {/* Deck left, hand between, discard right — where they would be on the
       * table in front of you. The two piles are the same object the rules
       * care about, so they are cards here and not buttons. */}
      <div className="hand-row">
        <DeckStack
          n={me.deckCount}
          cards={me.deck}
          omenMenace={v.omenMenace}
          onZoom={onZoom}
        />
        <div className="fan" key={dealNonce}>
          {holdDeal
            ? null
            : me.hand.map((ci) => (
                <PlayCard
                  key={ci.uid}
                  def={card(ci.cardId)}
                  fevered={ci.fevered}
                  dim={!yours}
                  actions={(byUid.get(ci.uid) ?? []).map((cmd) => ({
                    cmd,
                    label: labelFor(cmd),
                  }))}
                  onPlay={onPlay}
                  dealt={arrivals.indexOf(ci.uid) * DEAL_STAGGER_MS}
                  drag={dragOf(ci, byUid)}
                  onDrag={onDrag}
                  onZoom={() => onZoom(card(ci.cardId), ci.fevered)}
                />
              ))}
          {!holdDeal && !me.hand.length && (
            <span
              style={{
                display: "flex",
                justifySelf: "center",
                alignSelf: "center",
                margin: "0 auto",
              }}
              className="muted"
            >
              empty-handed
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Counter
            drag={drag}
            onSell={(cmd) => {
              onPlay(cmd);
              onDrag(null);
            }}
            onOpen={onMarket}
            grit={me.grit}
            buyable={buyable}
          />
          <DiscardPile
            cards={me.discard}
            omenMenace={v.omenMenace}
            onZoom={onZoom}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * The counter you take a card to when you want its Grit.
 *
 * Beside the hand rather than across the room, because cashing in is the most
 * frequent thing anyone does — roughly half of every turn — and a gesture you
 * make forty times a game should be short. It doubles as the way into the
 * market, so buying and selling happen at the same place.
 */
function Counter({
  drag,
  onSell,
  onOpen,
  grit,
  buyable,
}: {
  drag: Drag | null;
  onSell: (c: Command) => void;
  onOpen: () => void;
  grit: number;
  /** How many cards on the shelf you can currently afford. */
  buyable: number;
}) {
  const takes = !!drag?.cash;
  const [over, setOver] = useState(false);
  return (
    <div className="pilespot">
      <button
        className={`counter ${takes ? "takes" : ""} ${over && takes ? "over" : ""}`}
        onClick={onOpen}
        title={
          takes
            ? `Cash this card in for ${drag!.worth} Grit`
            : "Drop a card here to cash it in. Click to open the market."
        }
        onDragOver={
          takes
            ? (e) => {
                e.preventDefault();
                setOver(true);
              }
            : undefined
        }
        onDragLeave={takes ? () => setOver(false) : undefined}
        onDrop={
          takes
            ? (e) => {
                e.preventDefault();
                setOver(false);
                onSell(drag!.cash!);
              }
            : undefined
        }
      >
        <Icon name="grit" size={26} />
        <span className="cta">
          {takes
            ? `cash in for ${drag!.worth} Grit`
            : buyable
              ? `market · ${buyable}`
              : "market"}
        </span>
      </button>
      <div className="pilelabel">
        <Term k="grit">Grit</Term> <strong>{grit}</strong>
      </div>
    </div>
  );
}

/**
 * Your deck, face down, as tall as it is deep.
 *
 * Deck-as-health means the pile size IS the vital sign, so it is drawn rather
 * than counted: a stack that visibly thins as the game takes cards off you
 * says more than a number going down. The contents open on a click — you built
 * this deck and may review it — but never the order.
 */
function DeckStack({
  n,
  cards,
  omenMenace,
  onZoom,
}: {
  n: number;
  cards: CardInstance[];
  omenMenace: number;
  onZoom: (def: Card, fevered: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  // Four leaves at a full deck, one when it is nearly over.
  const layers = Math.max(1, Math.min(4, Math.ceil(n / 4)));
  return (
    <div className="pilespot">
      {n === 0 ? (
        <div className="deckstack empty" title="Nothing left to draw">
          <span className="face">gone</span>
        </div>
      ) : (
        <button
          className={`deckstack thick-${layers}`}
          onClick={() => setOpen(!open)}
          title="What you built. Click to review it — the order stays hidden."
        >
          {/* The real back, at the same 250x350 as every face — so the deck is
           * visibly the same object as the cards that come off it. */}
          <img className="face" src={cardBack} alt="" draggable={false} />
        </button>
      )}
      <div className="pilelabel">
        <Term k="deck">Deck</Term> <strong>{n}</strong>
      </div>
      {open && n > 0 && (
        <PileSheet
          title="Your deck"
          hint="Everything still to come, in alphabetical order — never the order you will draw it in."
          cards={cards}
          omenMenace={omenMenace}
          onZoom={onZoom}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * What you have already played, face up and drained of colour.
 *
 * Face up because it is public at a real table and because the top card is a
 * tell about what you just did. Desaturated because it is out of play — the
 * eye should find the hand first, every time.
 */
function DiscardPile({
  cards,
  omenMenace,
  onZoom,
}: {
  cards: CardInstance[];
  omenMenace: number;
  onZoom: (def: Card, fevered: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const top = cards[cards.length - 1];
  const def = top ? card(top.cardId) : null;
  const layers = Math.max(1, Math.min(3, Math.ceil(cards.length / 4)));
  return (
    <div className="pilespot">
      {!def ? (
        <div className="discard empty">
          <span className="face">nothing yet</span>
        </div>
      ) : (
        <button
          className={`discard thick-${layers}`}
          onClick={() => setOpen(!open)}
          title={`${cards.length} discarded. Click to see them all.`}
        >
          <span className="face">
            <CardFace {...faceOf(def, top!.fevered)} width={102} />
          </span>
        </button>
      )}
      <div className="pilelabel">
        Discard <strong>{cards.length}</strong>
      </div>
      {open && (
        <PileSheet
          title="Your discard"
          hint="Played and spent. It all comes back when the deck runs dry."
          cards={cards}
          omenMenace={omenMenace}
          onZoom={onZoom}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * A pile, spread out on the table.
 *
 * This was a text list in a small popover, which asked the player to translate
 * "Salt Line at the Door ×2" back into the card they actually know by its face.
 * A pile is a stack of cards; opening it should show cards.
 *
 * **Alphabetical, and that is a rule rather than a preference.** The deck is in
 * here, and its order is secret — sorting by anything the game decides (draw
 * order, when it was acquired) would leak it through the back door. Alphabetical
 * is information the player already has, so it cannot leak anything, and it is
 * also the only order in which you can find a specific card without reading
 * every one.
 *
 * Every copy is drawn, not collapsed to a count. Deck-as-health means eight
 * Saddlebags is a fact about your position, and eight faces in a row says it
 * more directly than "×8" does — the same way it would look spread on a table.
 */
function PileSheet({
  title,
  hint,
  cards,
  omenMenace,
  onZoom,
  onClose,
}: {
  title: string;
  hint?: string;
  cards: CardInstance[];
  omenMenace: number;
  onZoom: (def: Card, fevered: boolean) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  /*
    Sorted by the name actually PRINTED on the face, which for a Fevered Sign is
    its Fevered name — "The Line Has Been Crossed", not "Salt Line at the Door".
    Sorting by `card().name` instead would produce a grid that looks unsorted to
    the only person reading it. `faceOf` is the one translation point between a
    rule and a face, so the sort key comes from there rather than being worked
    out a second time here.

    localeCompare, so an apostrophe or an accent does not throw a card to one end.
  */
  const sorted = [...cards]
    .map((ci) => ({ ci, def: card(ci.cardId) }))
    .map((e) => ({ ...e, face: faceOf(e.def, e.ci.fevered, { omenMenace }) }))
    .sort((a, b) => a.face.title.localeCompare(b.face.title));

  return (
    <div className="sheet" onClick={onClose}>
      <div
        className="sheet-inner pilesheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h1>{title}</h1>
          <span className="pilesheet-count">
            {cards.length} card{cards.length === 1 ? "" : "s"}
          </span>
          <button style={{ marginLeft: "auto" }} onClick={onClose}>
            Close
          </button>
        </div>
        {hint && <p className="pilesheet-note">{hint}</p>}
        <div className="shelf">
          {sorted.length === 0 ? (
            <p className="pilesheet-note">Nothing in here.</p>
          ) : (
            sorted.map(({ ci, def, face }) => (
              <button
                key={ci.uid}
                className="shelfcard"
                onClick={() => onZoom(def, ci.fevered)}
                title="Look closer"
              >
                <CardFace {...face} width={132} />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** One card, front side up. */
/**
 * Everything the drag layer needs to know about the card in the air.
 *
 * The client still never decides what is legal — `net.legal` does, delivered by
 * the server. A drop zone accepts a card only if the matching command is in
 * that seat's own list, so dragging cannot invent a move the rules never
 * offered. This is presentation over `legal`, not a second rulebook.
 */
interface Drag {
  uid: string;
  /** The card's Grit value, so the counter can name its price. */
  worth: number;
  /** The commands this card actually has, taken from `legal`. */
  play: Command | null;
  cash: Command | null;
}

function dragOf(ci: CardInstance, byUid: Map<string, Command[]>): Drag {
  const cmds = byUid.get(ci.uid) ?? [];
  return {
    uid: ci.uid,
    // What the counter will pay for it. Carried on the drag because the counter
    // never learns which card is over it — only that something is.
    worth: card(ci.cardId).grit,
    play: cmds.find((c) => c.t === "PLAY_CARD") ?? null,
    cash: cmds.find((c) => c.t === "SPEND_GRIT") ?? null,
  };
}

/**
 * One card you can do something with: the face, plus its buttons.
 *
 * The face itself is `components/CardFace` and is pure — no rules, no state, no
 * handlers. Everything interactive lives out here, which is what lets the same
 * drawing serve a hand, a shelf, a Street slot and a discard pile.
 */
function PlayCard({
  def,
  fevered,
  actions,
  onPlay,
  dim,
  market,
  width,
  drag,
  onDrag,
  onPick,
  onZoom,
  dealt,
}: {
  def: Card;
  fevered: boolean;
  actions: { cmd: Command; label: ReactNode }[];
  onPlay: (c: Command) => void;
  dim?: boolean;
  market?: boolean;
  width?: number;
  /** Present for a card in your hand: what it can do, and where it may go. */
  drag?: Drag;
  onDrag?: (d: Drag | null) => void;
  /**
   * Clicking the card itself does its one obvious thing.
   *
   * For the shelf, that is buying. A card in hand has two obvious things —
   * play it or cash it in — which is exactly why that one is dragged instead.
   */
  onPick?: () => void;
  /** Look at this card closely. Its own control, not another meaning for click. */
  onZoom?: () => void;
  /** Milliseconds to wait before landing. Negative for a card already here. */
  dealt?: number;
}) {
  const playable = actions.length > 0;
  const canDrag = !!drag && (!!drag.play || !!drag.cash);
  return (
    <div
      className={[
        "card",
        def.type,
        fevered ? "fevered" : "",
        playable ? "playable" : "",
        dim ? "spent" : "",
        canDrag ? "draggable" : "",
        onPick ? "pickable" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role={onPick ? "button" : undefined}
      tabIndex={onPick ? 0 : undefined}
      onClick={onPick}
      onKeyDown={onPick ? (e) => e.key === "Enter" && onPick() : undefined}
      style={
        dealt !== undefined && dealt >= 0
          ? { animationDelay: `${dealt}ms` }
          : undefined
      }
      draggable={canDrag}
      onDragStart={
        canDrag
          ? (e) => {
              // Firefox refuses to start a drag without payload, even one nobody
              // reads — the card itself travels through React state.
              e.dataTransfer.setData("text/plain", drag!.uid);
              e.dataTransfer.effectAllowed = "move";
              onDrag?.(drag!);
            }
          : undefined
      }
      onDragEnd={canDrag ? () => onDrag?.(null) : undefined}
    >
      <CardFace {...faceOf(def, fevered, { market })} width={width ?? 120} />
      {onZoom && (
        <button
          className="lens"
          title="Look at this card closely"
          aria-label={`Look closely at ${def.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onZoom();
          }}
        >
          <LensMark />
        </button>
      )}
      {/* Buttons are the keyboard path, not the mouse one: hidden until the
       * card is focused, so tabbing still reaches every move while a pointer
       * user gets an uncluttered card to drag. */}
      {playable && (
        <div className="acts">
          {actions.map((a, i) => (
            <button key={i} onClick={() => onPlay(a.cmd)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Pile({
  label,
  icon,
  n,
  cards,
  hint,
  omenMenace,
  onZoom,
}: {
  label: string;
  icon?: IconName;
  n: number;
  cards?: CardInstance[];
  hint?: string;
  omenMenace?: number;
  onZoom?: (def: Card, fevered: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const can = !!cards?.length;
  return (
    <div className="pile">
      <button
        className="pilebtn"
        disabled={!can}
        title={hint}
        onClick={() => setOpen(!open)}
      >
        {icon && <Icon name={icon} size={12} />} {label} <strong>{n}</strong>
      </button>
      {open && can && (
        <PileSheet
          title={label}
          hint={hint}
          cards={cards!}
          omenMenace={omenMenace ?? 0}
          onZoom={onZoom ?? (() => {})}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * A cogwheel, drawn here rather than added to the icon set.
 *
 * components/iconsgen.ts is generated by assets/build_icons.py and says not to
 * edit it by hand — anything added there is lost on the next run. If a cog is
 * ever cut properly, swap this for <Icon name="cog" /> and delete it.
 */
/** A magnifier. Drawn here for the same reason as the cog and the bot below. */
function LensMark({ size = 13 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10.5" cy="10.5" r="6.2" />
      <path d="M15.2 15.2L20 20" />
    </svg>
  );
}

/**
 * One card, big, with the rules its symbols stand for.
 */
function CardZoom({
  def,
  fevered,
  slot,
  omenMenace,
  onClose,
}: {
  def: Card;
  fevered: boolean;
  slot?: StreetSlot;
  omenMenace: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const keys = cardKeywords(def, fevered, slot);
  const turning = def.fevered && !fevered;

  return (
    <div className="sheet zoom" onClick={onClose}>
      <div className="sheet-inner" onClick={(e) => e.stopPropagation()}>
        <div className="zoom-body">
          <div className="zoom-card">
            <CardFace
              {...faceOf(def, fevered, { slot, omenMenace })}
              width={330}
            />
            {slot && (
              <p className="muted">
                Standing in the Street: {slot.damage} damage taken
                {slot.escalation > 0 &&
                  `, and worse by ${slot.escalation} for
                  every Dusk it has survived`}
                .
              </p>
            )}
          </div>

          <div className="zoom-terms">
            {turning && (
              <div className="zoom-turn">
                <h2>
                  At the <Term k="turning">Turning</Term>
                </h2>
                <p>
                  <strong>{def.fevered!.name}</strong> —{" "}
                  <Rules text={describeOps(opsFor(def, true))} />
                </p>
              </div>
            )}
            <h2>What the marks mean</h2>
            <dl>
              {keys.map((k) => (
                <div key={k}>
                  <dt>
                    {TERM_ICONS[k] && <Icon name={TERM_ICONS[k]} size={15} />}
                    {GLOSSARY[k]!.term}
                  </dt>
                  <dd>
                    <strong>{GLOSSARY[k]!.short}</strong>{" "}
                    <Rules text={GLOSSARY[k]!.long} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="opts">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A bot, drawn here for the same reason as the cog below.
 *
 * `components/iconsgen.ts` is generated by assets/build_icons.py and anything
 * added by hand is lost on the next run. Cut a real one and this becomes
 * `<Icon name="bot" />`.
 *
 * Drawn to the set's grammar so it does not read as a foreign object: a 24 box,
 * currentColor, 1.6 stroke, square caps.
 */
function BotMark({ size = 13 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="4.6" y="8.4" width="14.8" height="11" />
      <path d="M12 4.4v4M9.4 12.6v2.2M14.6 12.6v2.2" />
      <circle cx="12" cy="3.6" r="1.3" />
    </svg>
  );
}

/** A seat nobody is driving, said the same way everywhere it is said. */
function BotTag({ size = 13 }: { size?: number }) {
  return (
    <span className="bottag" title="Played by a bot">
      <BotMark size={size} /> bot
    </span>
  );
}

function Cog() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4M5.9 5.9l1.7 1.7M16.4 16.4l1.7 1.7M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7" />
    </svg>
  );
}

/**
 * Sound settings.
 *
 * Two levels rather than one, because "too loud to talk over" and "the coins
 * are too sharp" are different complaints and one slider cannot answer both.
 * The effects slider plays a coin as you let go of it, so the level can be
 * judged by ear instead of by number.
 */
function SettingsPanel({
  s,
  handSize: fromView,
  onClose,
}: {
  s: SoundSettings;
  /** From the view when there is one. */
  handSize: number | undefined;
  onClose: () => void;
}) {
  /**
   * A sound test must not depend on the server.
   *
   * It did, and a server that had not yet learned to send `handSize` made the
   * "Deal a hand" button silent — the one button whose whole job is telling you
   * whether silence means broken. The content is bundled with the client, so
   * the fallback is always there.
   */
  const handSize = fromView ?? TUNING.handSize;
  const demo = useRef<CoinPool | null>(null);
  const demoCards = useRef<CardSounds | null>(null);
  const level = s.muted ? 0 : s.effects;

  const tryIt = () => {
    if (level <= 0) return;
    demo.current ??= createCoinPool();
    demo.current.play(level);
  };

  /**
   * Hear one effect on demand.
   *
   * Each of these fires the SAME path the game uses — the card sounds are
   * driven by feeding `hear` the events the engine would emit, not by calling
   * a clip directly. A button that plays the file regardless would happily
   * sound while the wiring behind it was broken, which is the one thing it is
   * here to detect.
   */
  const hear = (events: GameEvent[]) => {
    if (level <= 0) return;
    demoCards.current ??= createCardSounds();
    demoCards.current.hear(events, "p0", level, handSize);
  };

  const EFFECTS: [string, () => void][] = [
    ["Coin", tryIt],
    [
      "Sign bought",
      () => {
        if (level <= 0) return;
        demo.current ??= createCoinPool();
        demo.current.sign(level);
      },
    ],
    ["Shuffle", () => hear([{ t: "RESHUFFLED", player: "p0", n: 9 }])],
    ["Draw", () => hear([{ t: "DREW", player: "p0", n: 1 }])],
    ["Deal a hand", () => hear([{ t: "DREW", player: "p0", n: handSize }])],
    [
      "Discard a card",
      () => hear([{ t: "DISCARDED", player: "p0", n: 1, hand: false }]),
    ],
    [
      "Discard a hand",
      () => hear([{ t: "DISCARDED", player: "p0", n: handSize, hand: true }]),
    ],
    [
      "Six-Gun",
      () =>
        hear([
          { t: "PLAYED", player: "p0", cardId: "six-gun", fevered: false },
          { t: "THREAT_DAMAGED", slot: 0, amount: 1 },
        ]),
    ],
    [
      "Winchester",
      () =>
        hear([
          { t: "PLAYED", player: "p0", cardId: "winchester", fevered: false },
          { t: "THREAT_DAMAGED", slot: 0, amount: 2 },
        ]),
    ],
    [
      "Lantern Oil",
      () =>
        hear([
          { t: "PLAYED", player: "p0", cardId: "lantern-oil", fevered: false },
          { t: "THREAT_DAMAGED", slot: 0, amount: 2 },
        ]),
    ],
    [
      "Dynamite",
      () =>
        hear([
          { t: "PLAYED", player: "p0", cardId: "dynamite", fevered: false },
          { t: "THREAT_CLEARED", slot: 0, cardId: "barons-men" },
        ]),
    ],
  ];
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-inner narrow" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h1>Settings</h1>
          <button style={{ marginLeft: "auto" }} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="settings">
          <label className="row">
            <input
              type="checkbox"
              checked={s.muted}
              onChange={(e) => s.set({ muted: e.target.checked })}
            />
            <span>Silence everything</span>
          </label>
          <p className="hint">
            Leaves both levels where they are, so unmuting puts the table back
            the way you had it.
          </p>

          <Slider
            label="Music"
            hint="The Long Season plays under Act I only."
            value={s.music}
            disabled={s.muted}
            onChange={(music) => s.set({ music })}
          />

          <Slider
            label="Effects"
            hint="Coins, the sunset, the Turning."
            value={s.effects}
            disabled={s.muted}
            onChange={(effects) => s.set({ effects })}
            onSettle={tryIt}
          />

          <div className="hearit">
            <span className="name">Hear one</span>
            <div className="row">
              {EFFECTS.map(([label, play]) => (
                <button key={label} disabled={level <= 0} onClick={play}>
                  {label}
                </button>
              ))}
            </div>
            <p className="hint">
              Each plays through the same path the game uses, so a silent button
              means the wiring is broken and not just the volume.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  disabled,
  onChange,
  onSettle,
}: {
  label: string;
  hint: string;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  onSettle?: () => void;
}) {
  return (
    <div className={`slider ${disabled ? "off" : ""}`}>
      <div className="row">
        <span className="name">{label}</span>
        <span className="pct">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        disabled={disabled}
        style={{ ["--fill" as string]: `${Math.round(value * 100)}%` }}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onPointerUp={onSettle}
        onKeyUp={onSettle}
      />
      <p className="hint">{hint}</p>
    </div>
  );
}

function GlossaryPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="glossary" onClick={onClose}>
      <div className="inner" onClick={(e) => e.stopPropagation()}>
        <h1>How this game works</h1>
        <p className="muted">Click anywhere to close.</p>
        <dl>
          {Object.entries(GLOSSARY).map(([k, e]) => (
            <div key={e.term}>
              <dt>
                {TERM_ICONS[k] && <Icon name={TERM_ICONS[k]} size={17} />}
                {e.term}
              </dt>
              <dd>
                <strong>{e.short}</strong> <Rules text={e.long} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ utils

/**
 * A engine Card, as a face.
 *
 * The single translation point between the rules and how a card looks. Every
 * surface goes through it — hand, market, Street, discard — so a card cannot
 * look like one thing in your hand and another on the table.
 */
function faceOf(
  def: Card,
  fevered: boolean,
  opts: {
    /** On the shelf you need the price; in your hand you need what it is worth. */
    market?: boolean;
    /**
     * The Street slot this card is standing in, if it is standing in one.
     *
     * Clear and Menace are printed on the card but LIVED on the slot: a Threat
     * left standing gains a step every Dusk, and that lives in
     * `StreetSlot.escalation` because `Card` is a template shared by every copy
     * — including the ones still face down. Without the slot this drew the
     * printed numbers for ever, so a Threat that had grown from Clear 4 to 6
     * still read 4 and the wound bar filled against the wrong total.
     */
    slot?: StreetSlot;
    /** Needed to read an Omen's Menace, which is a TUNING value, not printed. */
    omenMenace?: number;
  } = {},
): CardFaceProps {
  const isSign = def.type === "sign";
  const turned = isSign && fevered;
  const face = turned && def.fevered ? def.fevered : null;
  const threat = def.type === "trouble" || def.type === "mythos";
  return {
    kind: (turned ? "fevered" : def.type) as CardKind,
    title: face ? face.name : def.name,
    // A Fevered card says what it used to be, or nobody recognises the card
    // they bought two rounds ago.
    subtitle: face ? `was ${def.name}` : undefined,
    cost: opts.market ? def.cost : undefined,
    value: opts.market || threat || def.type === "omen" ? undefined : def.grit,
    body:
      // Empty, not a dash, when there is genuinely nothing. Every Threat has no
      // `ops` — Clear, Menace, Bounty and Toll are their own fields — so a
      // placeholder here put a stray em-dash on every card in the Street.
      thirdLine(def, fevered) || (def.passive ? "A standing promise." : ""),
    // On the shelf, what a Sign becomes is the whole decision, and it wins the
    // slot: rules before atmosphere. Everywhere else the card gets its line.
    flavour:
      opts.market && def.fevered
        ? `At the Turning: ${def.fevered.name} — ${describeOps(opsFor(def, true))}`
        : def.flavour,
    footer: FAMILY[def.type],
    mark: iconForCard(def, fevered),
    whispers: def.whispers,
    clear: opts.slot ? effectiveClear(opts.slot) : def.clear,
    menace: opts.slot
      ? effectiveMenace(opts.slot, opts.omenMenace ?? 0)
      : def.menace,
  };
}

const FAMILY: Record<Card["type"], string> = {
  kit: "Provision",
  deed: "Provision",
  sign: "Sign",
  scar: "Scar",
  trouble: "Trouble",
  omen: "Omen",
  mythos: "Mythos",
  vessel: "The Vessel",
};

function labelFor(c: Command): ReactNode {
  switch (c.t) {
    case "PLAY_CARD":
      return "Play";
    case "SPEND_GRIT":
      return "Cash in";
    case "BUY":
      return "Buy";
    case "END_TURN":
      return "End turn";
    case "PAY_TOLL":
      return "Pay the price";
    case "REVENANT_WHISPER":
      return "Whisper";
    case "BECKON":
      return `Beckon ${c.target}`;
    default:
      return c.t;
  }
}
