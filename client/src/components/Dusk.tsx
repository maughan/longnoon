import { useEffect, useId, useRef, useState } from "react";
import "./styles/Dusk.css";
import duskSound from "./audio/dusk.mp3";

/**
 * One clip, made once and rewound - not a new Audio per sunset.
 *
 * Built at module scope so the browser fetches it while the game loads rather
 * than at the moment the sun starts falling, and so a second Dusk restarts the
 * sound instead of layering a second copy over the first.
 */
const clip = typeof Audio === "undefined" ? null : new Audio(duskSound);
if (clip) {
  clip.preload = "auto";
}

/**
 * Dusk - the sun crosses from upper left to the horizon at lower right,
 * accelerating the whole way, and jolts when it lands.
 *
 *   <Dusk round={state.round} onSettled={resolveMenace} />
 *
 * Fire it when the round ends, and hold damage resolution until onSettled.
 * The table should be watching the sun to find out what the round cost them;
 * resolving mid-arc throws that away.
 *
 * Self-contained: no other components, no other stylesheet.
 *
 * Two implementation notes worth keeping if you refactor:
 *
 *  - X and Y animate on SEPARATE nested groups. X is near-linear, Y
 *    accelerates. That composition is what produces the parabola. A single
 *    diagonal translate is a straight line no matter what curve you put on it.
 *
 *  - The rays need `transform-box: fill-box` (set in dusk.css). In SVG the
 *    default is view-box, so transform-origin resolves against the root
 *    viewBox and the rays drift off-centre as they scale. Silent failure -
 *    it looks fine at rest and only breaks mid-animation.
 */
export function Dusk({
  round,
  onSettled,
  width = 240,
  duration = 2400,
  volume = 1,
}: {
  /** Change this to replay. Typically the round number. */
  round: number;
  /** Fires when the sun has settled. */
  onSettled?: () => void;
  width?: number;
  /** Milliseconds. Must match the duration in dusk.css if you change it. */
  duration?: number;
  /** Effects level, 0–1. Zero is silence. */
  volume?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const clipId = `dusk-sky-${uid}`;

  // Remount on `round` change so the CSS animation replays. The vanilla
  // remove-class/force-reflow/re-add trick misfires under StrictMode.
  const [key, setKey] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setKey((k) => k + 1);
  }, [round]);

  // The sound starts with the same remount that starts the animation, so the
  // two cannot drift apart however the beat above decides to schedule them.
  useEffect(() => {
    if (volume <= 0 || !clip) return;
    clip.currentTime = 0;
    clip.volume = Math.min(1, 0.85 * volume);
    // Browsers refuse audio until the page has had a gesture. A refused sunset
    // is still a sunset - never let it take the picture down with it.
    void clip.play().catch(() => {});
    // Deliberately no pause on unmount: the clip runs a little past the arc and
    // is better heard out than cut off.
  }, [key, volume]);

  const [done, setDone] = useState(false);
  useEffect(() => {
    setDone(false);
    const t = setTimeout(() => {
      setDone(true);
      onSettled?.();
    }, duration);
    return () => clearTimeout(t);
  }, [key, duration, onSettled]);

  return (
    <svg
      key={key}
      className="ln-dusk"
      viewBox="0 0 240 150"
      role="img"
      aria-label={done ? "Dusk" : "Dusk falling"}
      style={{ width, color: "currentColor" }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="240" height="104" />
        </clipPath>
      </defs>

      {/* Two washes, running opposite ways: the daylight drains out and the
        * night is laid over it. One rect could not do both — it can only fade
        * toward the panel behind it, which is why this used to get BRIGHTER as
        * the sun went down. */}
      <rect
        className="ln-dusk__sky"
        x="0"
        y="0"
        width="240"
        height="104"
        fill="currentColor"
      />
      <rect
        className="ln-dusk__night"
        x="0"
        y="0"
        width="240"
        height="104"
        fill="#000"
      />

      <g clipPath={`url(#${clipId})`}>
        <g className="ln-dusk__x">
          <g className="ln-dusk__y">
            <g transform="translate(186 100)">
              <circle
                className="ln-dusk__disc"
                r="17"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <g
                className="ln-dusk__rays"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="square"
                fill="none"
              >
                <path d="M0 -26v-9M0 26v9M-26 0h-9M26 0h9M-18.4 -18.4l-6.4-6.4M18.4 18.4l6.4 6.4M18.4 -18.4l6.4-6.4M-18.4 18.4l-6.4 6.4" />
              </g>
            </g>
          </g>
        </g>
      </g>

      <g className="ln-dusk__horizon">
        <path
          d="M0 104h240"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="none"
        />
        <path
          d="M12 112h18M40 112h34M84 112h12M104 112h44M158 112h26M192 112h16M216 112h14"
          stroke="currentColor"
          strokeWidth="1.2"
          opacity="0.45"
          fill="none"
        />
      </g>
    </svg>
  );
}

export default Dusk;
