import { Icon, type IconName } from "./Icon";
import { PALETTE, DREAD, DREAD_ON_DARK, FAINT_OPACITY } from "./palette";

/**
 * A card face.
 *
 * THE LAYOUT RULE: in a fanned hand you see roughly the left 18% of every
 * card but the top one. So the left strip carries everything needed to make a
 * decision without spreading the hand - cost, family mark, Whisper load, coin
 * value. The title is left-aligned for the same reason: fanning reveals its
 * first few letters. Centred titles look better and are useless in a hand.
 *
 * THE FRAME TELEGRAPHS FAMILY before anything is read, across a table, upside
 * down. Provisions are a closed double rule. A Sign's rule BREAKS at top and
 * bottom - it is never a closed shape. Fevered keeps the identical layout, so
 * you still recognise the card you bought, but it is dark and the break has
 * become a crack.
 *
 * COLOUR IS THE THIRD SIGNAL, after frame and mark. Each family carries two
 * tones - see palette.ts for why text and strokes cannot share one value.
 */

export type CardKind =
  | "kit"
  | "deed"
  | "sign"
  | "fevered"
  | "scar"
  | "trouble"
  | "omen"
  | "mythos";

export interface CardFaceProps {
  kind: CardKind;
  title: string;
  /** Fevered cards show what they used to be. */
  subtitle?: string;
  cost?: number;
  /** Coin value when spent. */
  value?: number;
  body: string;
  flavour?: string;
  footer?: string;
  /** Family mark for the strip: kit, deed, sign, fevered, menace, scar. */
  mark: IconName;
  /**
   * The field illustration. Defaults to `mark`.
   *
   * Separate because they answer different questions — the strip says what
   * FAMILY this is, the field says what THIS card is. They coincide only while
   * the art is a placeholder.
   */
  art?: IconName;
  whispers?: number;
  clear?: number;
  menace?: number;
  width?: number;
}

const W = 250;
const H = 350;

export function CardFace({
  kind,
  title,
  subtitle,
  cost,
  value,
  body,
  flavour,
  footer,
  mark,
  art,
  whispers = 0,
  clear,
  menace,
  width = 250,
}: CardFaceProps) {
  const fever = kind === "fevered";
  const isMark = kind === "sign" || kind === "fevered";

  const pal = PALETTE[kind];
  const bg = pal.paper;
  const ink = pal.ink;
  const accent = pal.accent;
  // Whispers keep their own colour on every card type. Corruption is the same
  // currency wherever it appears and must not take on its host's hue.
  const dread = fever ? DREAD_ON_DARK : DREAD;

  // A Fevered card is the same card, marked. The strip and the field must agree
  // about that or it reads as two different cards on one face.
  const family: IconName = isMark ? (fever ? "fevered" : "sign") : mark;
  const field: IconName = art ?? (isMark ? family : mark);

  /**
   * The strip is a stack, not a set of fixed slots.
   *
   * Laid out with a running cursor because which entries a card has varies:
   * a Sign has cost + whispers, a Threat has Clear + Menace, and the fixed
   * positions this replaced put the Whisper glyph on top of the Menace number
   * on every Threat that had both. Anything added here goes through `slot`.
   */
  let y = 22;
  const slot = (h: number) => {
    const at = y;
    y += h;
    return at;
  };
  const costY = cost !== undefined ? slot(40) : 0;
  const familyY = slot(32);
  const clearY = clear !== undefined ? slot(48) : 0;
  const menaceY = menace !== undefined ? slot(48) : 0;
  const whisperY = whispers > 0 ? slot(28 + whispers * 15) : 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={width}
      style={{ display: "block", color: ink }}
    >
      <rect width={W} height={H} rx={6} fill={bg} />

      {isMark ? (
        <>
          <path
            d={`M96 9H15a6 6 0 0 0-6 6v${H - 30}a6 6 0 0 0 6 6h81M154 9h81a6 6 0 0 1 6 6v${H - 30}a6 6 0 0 1-6 6h-81`}
            fill="none"
            stroke={accent}
            strokeWidth={1.6}
          />
          {fever && (
            <>
              <path
                d="M96 9l-9 7 11 6-8 5"
                fill="none"
                stroke={accent}
                strokeWidth={1.2}
              />
              <path
                d="M154 341l9-7-11-6 8-5"
                fill="none"
                stroke={accent}
                strokeWidth={1.2}
              />
            </>
          )}
          <rect
            x={14}
            y={14}
            width={W - 28}
            height={H - 28}
            fill="none"
            stroke={accent}
            strokeWidth={0.6}
            opacity={0.55}
            strokeDasharray="5 6"
          />
        </>
      ) : (
        <>
          <rect
            x={9}
            y={9}
            width={W - 18}
            height={H - 18}
            rx={3}
            fill="none"
            stroke={accent}
            strokeWidth={1.6}
          />
          <rect
            x={14}
            y={14}
            width={W - 28}
            height={H - 28}
            fill="none"
            stroke={accent}
            strokeWidth={0.6}
            opacity={0.7}
          />
        </>
      )}

      {/* the strip */}
      <line
        x1={47}
        y1={22}
        x2={47}
        y2={H - 22}
        stroke={accent}
        strokeWidth={0.6}
        opacity={0.55}
      />

      {cost !== undefined && (
        <>
          <circle
            cx={28}
            cy={costY + 14}
            r={14}
            fill="none"
            stroke={ink}
            strokeWidth={1.4}
          />
          <text
            x={28}
            y={costY + 20}
            textAnchor="middle"
            fill={ink}
            style={{ font: "bold 17px ui-serif, Georgia, serif" }}
          >
            {cost}
          </text>
        </>
      )}

      {/* Always. Every card belongs to a family, including the ones with no
          price — this used to hang off `cost`, so no Threat ever showed one. */}
      <g transform={`translate(17 ${familyY})`} style={{ color: accent }}>
        <Icon name={family} size={23} />
      </g>

      {clear !== undefined && (
        <>
          <g transform={`translate(17 ${clearY})`}>
            <Icon name="clear" size={23} />
          </g>
          <text
            x={28}
            y={clearY + 40}
            textAnchor="middle"
            fill={ink}
            style={{ font: "bold 15px ui-serif, Georgia, serif" }}
          >
            {clear}
          </text>
        </>
      )}
      {menace !== undefined && (
        <>
          <g transform={`translate(17 ${menaceY})`}>
            <Icon name="menace" size={23} />
          </g>
          <text
            x={28}
            y={menaceY + 40}
            textAnchor="middle"
            fill={ink}
            style={{ font: "bold 15px ui-serif, Georgia, serif" }}
          >
            {menace}
          </text>
        </>
      )}

      {/* Whisper load: one glyph for WHAT, dots for HOW MANY. The spiral at pip
          size read as a row of letter C and could not be counted at a glance,
          which was its only job. */}
      {whispers > 0 && (
        <>
          <g transform={`translate(18 ${whisperY})`} style={{ color: dread }}>
            <Icon name="whisper" size={20} />
          </g>
          {Array.from({ length: whispers }, (_, i) => (
            <circle
              key={i}
              cx={28}
              cy={whisperY + 32 + i * 15}
              r={4.6}
              fill={dread}
            />
          ))}
        </>
      )}

      {value !== undefined && (
        <>
          <g transform={`translate(17 ${H - 62})`}>
            <Icon name="grit" size={23} />
          </g>
          <text
            x={28}
            y={H - 22}
            textAnchor="middle"
            fill={ink}
            style={{ font: "bold 16px ui-serif, Georgia, serif" }}
          >
            {value}
          </text>
        </>
      )}

      {/* title, left-aligned so a fan shows its opening letters */}
      {wrap(title.toUpperCase(), 17).map((line, i, all) => (
        <text
          key={i}
          x={58}
          y={(all.length === 1 ? 40 : 32) + i * 17}
          fill={ink}
          style={{
            font: "bold 15px ui-sans-serif, system-ui, sans-serif",
            letterSpacing: "1.1px",
          }}
        >
          {line}
        </text>
      ))}
      {subtitle && (
        <text
          x={58}
          y={70}
          fill={ink}
          opacity={FAINT_OPACITY}
          style={{ font: "italic 9px ui-serif, Georgia, serif" }}
        >
          {subtitle}
        </text>
      )}

      {/* field. The icon is a PLACEHOLDER - in production every card wants its
          own illustration. Two threats sharing the claw mark works as a family
          signal and reads as a shortage side by side in the Street. */}
      {isMark ? (
        <path
          d="M150 86L212 148 150 210 88 148z"
          fill="none"
          stroke={accent}
          strokeWidth={0.7}
          opacity={0.7}
        />
      ) : kind !== "scar" ? (
        <rect
          x={90}
          y={92}
          width={120}
          height={112}
          fill="none"
          stroke={accent}
          strokeWidth={0.7}
          opacity={0.6}
        />
      ) : null}
      <g transform="translate(109 107)" style={{ color: accent }}>
        <Icon name={field} size={82} strokeWidth={1.9} />
      </g>

      <line
        x1={24}
        y1={226}
        x2={W - 24}
        y2={226}
        stroke={accent}
        strokeWidth={0.8}
        opacity={0.8}
      />
      {wrap(body, 30).map((line, i) => (
        <text
          key={i}
          x={W / 2}
          y={250 + i * 14}
          textAnchor="middle"
          fill={ink}
          style={{ font: "10px ui-sans-serif, system-ui, sans-serif" }}
        >
          {line}
        </text>
      ))}

      {flavour &&
        wrap(flavour, 36).map((line, i, all) => (
          <text
            key={i}
            x={W / 2}
            y={H - 52 - (all.length - 1 - i) * 12}
            textAnchor="middle"
            fill={ink}
            opacity={FAINT_OPACITY}
            style={{ font: "italic 9px ui-serif, Georgia, serif" }}
          >
            {line}
          </text>
        ))}

      {footer && (
        <text
          x={W / 2}
          y={H - 24}
          textAnchor="middle"
          fill={ink}
          opacity={FAINT_OPACITY}
          style={{
            font: "8px ui-sans-serif, system-ui, sans-serif",
            letterSpacing: "2.2px",
          }}
        >
          {footer.toUpperCase()}
        </text>
      )}
    </svg>
  );
}

function wrap(text: string, perLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= perLine) cur = (cur + " " + w).trim();
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export default CardFace;
