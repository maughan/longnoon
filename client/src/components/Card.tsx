import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * Re-triggering a CSS animation in React.
 *
 * The vanilla trick - remove the class, read offsetWidth to force reflow, add
 * it back - fights React's rendering model and misfires under StrictMode's
 * double-invoke. Change a `key` instead: React unmounts and remounts the node,
 * and a fresh node runs its animation from the start. This is the idiomatic
 * fix and the one thing most likely to waste an afternoon otherwise.
 */
export function useReplayKey(trigger: unknown) {
  const [key, setKey] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setKey((k) => k + 1);
  }, [trigger]);
  return key;
}

// ---------------------------------------------------------------------------

interface CardProps {
  name: string;
  feveredName?: string;
  /** Comes from engine state (CardInstance.fevered) - never from a click. */
  fevered: boolean;
  whispers?: number;
  /** Stagger index. At the Turning every Sign turns at once; offset them. */
  order?: number;
}

/**
 * The Fevering animates on a STATE CHANGE, not a user action. The engine flips
 * `instance.fevered` at the Turning and the card reacts. Don't wire this to a
 * click handler or it stops meaning anything.
 *
 * Requires an ancestor with `perspective`. Without it the rotateY renders flat
 * and the whole effect silently does nothing - the most common gotcha here.
 */
export function Card({
  name,
  feveredName,
  fevered,
  whispers = 0,
  order = 0,
}: CardProps) {
  const key = useReplayKey(fevered);
  const [turning, setTurning] = useState(false);

  useEffect(() => {
    if (key === 0) return;
    const t = setTimeout(() => setTurning(true), order * 140);
    return () => clearTimeout(t);
  }, [key, order]);

  useEffect(() => {
    if (!turning) return;
    const t = setTimeout(() => setTurning(false), 1200);
    return () => clearTimeout(t);
  }, [turning]);

  return (
    <div style={{ perspective: 900 }}>
      <div
        key={key}
        className={`ln-card${turning ? " is-fevering" : ""}`}
        style={{
          width: 132,
          height: 186,
          transform: fevered && !turning ? "rotateY(180deg)" : undefined,
        }}
      >
        <div className="ln-card__face">
          <Icon name="sign" size={42} />
          <div className="cardname">{name}</div>
          {whispers > 0 && (
            <span style={{ display: "inline-flex", gap: 2 }}>
              {Array.from({ length: whispers }, (_, i) => (
                <Icon key={i} name="whisper" size={14} />
              ))}
            </span>
          )}
        </div>
        <div className="ln-card__face ln-card__face--fevered">
          <Icon name="fevered" size={42} />
          <div className="cardname">{feveredName ?? name}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The shared clock. Nothing pulses until the threshold, so when it finally
 * does, it reads as a warning rather than as chrome.
 */
export function WhisperTrack({
  whispers,
  threshold = 12,
}: {
  whispers: number;
  threshold?: number;
}) {
  const pips = Array.from({ length: threshold + 1 }, (_, i) => i);
  return (
    <svg
      viewBox={`0 0 ${(threshold + 1) * 25 + 4} 40`}
      role="img"
      aria-label={`${whispers} of ${threshold} whispers`}
      style={{ width: (threshold + 1) * 25 + 4 }}
    >
      {pips.map((i) => {
        const lit = i < whispers;
        const isThreshold = i === threshold;
        return (
          <circle
            key={i}
            cx={12 + i * 25}
            cy={20}
            r={6}
            className={[
              "ln-pip",
              isThreshold ? "is-threshold" : "",
              lit ? "is-lit" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

/**
 * Damage. Renders a torn card that flies to the boneyard, then unmounts itself.
 * Driven by the DAMAGED event from the engine, not by local state.
 */
export function TornCard({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 560);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div
      className="ln-torn"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 76,
        height: 108,
        border: "1px solid var(--ln-ink)",
        background: "#f2eee4",
        pointerEvents: "none",
      }}
    />
  );
}
