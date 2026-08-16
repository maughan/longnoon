import { useEffect, useState } from "react";
import "./styles/Turning.css";
import turningSound from "./audio/turning.mp3";

/**
 * One clip, built at module scope so the browser has it long before Act I ends.
 *
 * It runs 6.35s against a 5.7s piece, and that overhang is deliberate: the
 * sound carries on over the Act II board after the ink clears, which is the
 * right order for a thing that has just been let through.
 */
const clip = typeof Audio === "undefined" ? null : new Audio(turningSound);
if (clip) {
  clip.preload = "auto";
}

/**
 * The Turning - Act I ends and something starts looking back.
 *
 *   {state.phase === 'turning' && <Turning onComplete={commitTurning} />}
 *
 * THE IDEA
 * The Whispers the table spent in Act I do not just vanish. They detach from
 * the track, fly inward, and arrive as the ring that lets the thing through.
 * A generic summoning circle would be decoration; this one is the scoreboard.
 *
 * WHAT THIS DOES NOT DO
 * It does not flip the players' Signs. That is the existing Card animation
 * with its `order` stagger, fired after onComplete, so the wave scales with
 * however many Signs are actually in play rather than a number faked here.
 *
 * Fires exactly once per game, which is the only reason 5.7s of
 * non-interactive animation is defensible. TURNING_MS must match the tail of
 * the beat sheet in Turning.css, and `turningMs` in server/hub.ts must be at
 * least as long or the bots start moving underneath it.
 */

/** Total run time. Must match the clear delay + duration in Turning.css. */
export const TURNING_MS = 5700;

const CX = 340;
const CY = 196;
const RING = 62;

const STRAIGHT =
  "M0 -46v-16M0 46v16M-46 0h-16M46 0h16M-32.5 -32.5l-11.3-11.3" +
  "M32.5 32.5l11.3 11.3M32.5 -32.5l11.3-11.3M-32.5 32.5l-11.3 11.3";

/* The same eight rays, hooked. Straight lines going crooked reads as wrong
 * without needing to be explained. */
const CURLED =
  "M0 -46c5 -7 3 -13 -4 -17M0 46c-5 7 -3 13 4 17M-46 0c-7 -5 -13 -3 -17 4" +
  "M46 0c7 5 13 3 17 -4M-32.5 -32.5c-2 -8 -6 -11 -13 -11" +
  "M32.5 32.5c2 8 6 11 13 11M32.5 -32.5c8 -2 11 -6 11 -13" +
  "M-32.5 32.5c-8 2 -11 6 -11 13";

/** Watchers: closed eyes scattered off the centre line. */
const WATCHERS = [
  { x: 128, y: 122, s: 1.0, d: 3161 },
  { x: 552, y: 148, s: 0.82, d: 3364 },
  { x: 196, y: 286, s: 0.9, d: 3277 },
  { x: 486, y: 300, s: 1.1, d: 3480 },
  { x: 92, y: 240, s: 0.7, d: 3567 },
  { x: 596, y: 250, s: 0.75, d: 3654 },
];

export function Turning({
  onComplete,
  whispers = 12,
  volume = 1,
}: {
  onComplete?: () => void;
  /** Pip count. Should match your Whisper threshold. */
  whispers?: number;
  /** Effects level, 0–1. Zero is silence. */
  volume?: number;
}) {
  const [gone, setGone] = useState(false);

  // Started by the mount that starts the animation, so the two cannot drift.
  // Deliberately not stopped on unmount — see the note on the clip above.
  useEffect(() => {
    if (volume <= 0 || !clip) return;
    clip.currentTime = 0;
    clip.volume = Math.min(1, 0.9 * volume);
    // Refused audio must never take the picture down with it.
    void clip.play().catch(() => {});
  }, [volume]);

  useEffect(() => {
    const t = setTimeout(() => {
      setGone(true);
      onComplete?.();
    }, TURNING_MS);
    return () => clearTimeout(t);
  }, [onComplete]);

  if (gone) return null;

  const gap = 26;
  const startX = CX - ((whispers - 1) * gap) / 2;
  const startY = 72;

  return (
    <div
      className="ln-turning"
      role="status"
      aria-live="polite"
      aria-label="The Turning"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        pointerEvents: "none",
        zIndex: 40,
      }}
    >
      <svg
        className="ln-t-root"
        viewBox="0 0 680 380"
        style={{ width: "100%", height: "100%" }}
      >
        <defs>
          <clipPath id="ln-t-clip">
            <rect x="0" y="0" width="680" height="380" />
          </clipPath>
        </defs>

        <g clipPath="url(#ln-t-clip)">
          <circle
            className="ln-t-flood"
            cx={CX}
            cy={CY}
            r="10"
            fill="var(--t-ink)"
          />

          {/* 1. the Whispers, leaving the track */}
          {Array.from({ length: whispers }, (_, i) => {
            const theta = (i / whispers) * Math.PI * 2 - Math.PI / 2;
            const sx = startX + i * gap;
            return (
              <circle
                key={i}
                className="ln-t-pip"
                cx={sx}
                cy={startY}
                r={5.5}
                style={{
                  ["--dx" as string]: `${CX + RING * Math.cos(theta) - sx}px`,
                  ["--dy" as string]: `${CY + RING * Math.sin(theta) - startY}px`,
                  animationDelay: `${(whispers - 1 - i) * 38}ms`,
                }}
              />
            );
          })}

          {/* 2. the seal they become */}
          <g className="ln-t-seal">
            <g
              transform={`translate(${CX} ${CY})`}
              stroke="var(--t-ink)"
              fill="none"
              strokeWidth="1.1"
            >
              <circle r={RING} opacity="0.5" />
              <circle r={RING + 9} opacity="0.28" strokeDasharray="3 7" />
              {Array.from({ length: whispers }, (_, i) => {
                const a = (i / whispers) * 360 - 90;
                return (
                  <g key={i} transform={`rotate(${a}) translate(${RING} 0)`}>
                    <path d="M0 -6v12" opacity="0.55" />
                    {i % 3 === 0 && (
                      <path
                        d="M6 0l6 -5v10z"
                        fill="var(--t-ink)"
                        stroke="none"
                        opacity="0.7"
                      />
                    )}
                    {i % 3 === 1 && <path d="M6 -4l7 4-7 4" opacity="0.6" />}
                  </g>
                );
              })}
            </g>
          </g>

          {/* 3. the disc */}
          <g transform={`translate(${CX} ${CY})`}>
            <g
              className="ln-t-rays-straight"
              stroke="var(--t-ink)"
              strokeWidth="2.2"
              strokeLinecap="square"
              fill="none"
            >
              <path d={STRAIGHT} />
            </g>
            <g
              className="ln-t-rays-curled"
              stroke="var(--t-ink)"
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
            >
              <path d={CURLED} />
            </g>
            <circle className="ln-t-disc" r="30" strokeWidth="2.2" />

            {/* split behind the door, so what remains reads as the crack it came from */}
            <path
              className="ln-t-split"
              d="M0 -30v60"
              stroke="var(--t-paper)"
              strokeWidth="2"
              fill="none"
            />
            <g className="ln-t-door">
              <path
                d="M-21 44V15a21 21 0 0 1 42 0v29z"
                fill="var(--t-paper)"
                stroke="var(--t-paper)"
                strokeWidth="1.5"
              />
              {/* what is behind the door */}
              <g className="ln-t-eye" transform="translate(0 22)">
                <ellipse rx="14" ry="9.5" fill="var(--t-ink)" opacity="0.12" />
                <path
                  d="M-14 0c5 -8 23 -8 28 0c-5 8 -23 8 -28 0z"
                  fill="none"
                  stroke="var(--t-ink)"
                  strokeWidth="1.3"
                />
                <ellipse
                  className="ln-t-pupil"
                  rx="3"
                  ry="8.4"
                  fill="var(--t-ink)"
                />
              </g>
            </g>
          </g>

          {/* 4. the others */}
          {WATCHERS.map((w, i) => (
            <g
              key={i}
              className="ln-t-watcher"
              transform={`translate(${w.x} ${w.y}) scale(${w.s})`}
              style={{ animationDelay: `${w.d}ms` }}
            >
              <path
                d="M-15 0c5 -8.5 25 -8.5 30 0c-5 8.5 -25 8.5 -30 0z"
                fill="none"
                stroke="var(--t-paper)"
                strokeWidth="1.3"
              />
              <ellipse rx="2.6" ry="6.4" fill="var(--t-paper)" />
            </g>
          ))}

          {/* 5. the words */}
          <g className="ln-t-mark">
            <text
              x={CX}
              y="312"
              textAnchor="middle"
              fill="var(--t-paper)"
              style={{
                font: "500 13px ui-sans-serif, system-ui, sans-serif",
                letterSpacing: "0.42em",
              }}
            >
              THE TURNING
            </text>
          </g>
          <g className="ln-t-liturgy">
            <text
              x={CX}
              y="334"
              textAnchor="middle"
              fill="var(--t-paper)"
              opacity="0.55"
              style={{
                font: "400 10.5px ui-serif, Georgia, serif",
                letterSpacing: "0.22em",
                fontStyle: "italic",
              }}
            >
              and the noon did not end
            </text>
          </g>
        </g>

        {/* the dropped frames, over everything */}
        <rect
          className="ln-t-skip"
          x="0"
          y="0"
          width="680"
          height="380"
          fill="var(--t-ink)"
        />
      </svg>
    </div>
  );
}

export default Turning;
