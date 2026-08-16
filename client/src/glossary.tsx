// The rules, at the moment you need them — the parts that draw something.
//
// The glossary data and the keyword matching live in glossaryData.ts.
export { GLOSSARY, keywordsIn, type Entry } from './glossaryData';

import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react';
import { Icon } from './components/Icon';
import { GLOSSARY, type Entry } from './glossaryData';
import { KEY_OF, PATTERN } from './glossaryData';
import { TERM_ICONS } from './icons';

// ------------------------------------------------------------------ tooltip

interface Hover { entry: Entry; key: string; x: number; y: number }

const TipContext = createContext<{
  show(e: Entry, key: string, at: DOMRect): void;
  hide(): void;
}>({ show: () => {}, hide: () => {} });

/** Wrap the app once. Renders a single tooltip, positioned at the keyword. */
export function Tooltips({ children }: { children: ReactNode }) {
  const [hover, setHover] = useState<Hover | null>(null);

  const api = useMemo(() => ({
    show(entry: Entry, key: string, at: DOMRect) {
      setHover({ entry, key, x: at.left + at.width / 2, y: at.top });
    },
    hide() { setHover(null); },
  }), []);

  return (
    <TipContext.Provider value={api}>
      {children}
      {hover && (
        <div className="tip" style={tipPosition(hover)} role="tooltip">
          <strong>
            {TERM_ICONS[hover.key] && <Icon name={TERM_ICONS[hover.key]} size={16} />}
            {hover.entry.term}
          </strong>
          <em>{hover.entry.short}</em>
          <span>{hover.entry.long}</span>
        </div>
      )}
    </TipContext.Provider>
  );
}

/** Keep the bubble on screen — keywords sit inside rails and near edges. */
function tipPosition(h: Hover): React.CSSProperties {
  const width = 300;
  const half = width / 2;
  const x = Math.min(Math.max(h.x, half + 8), window.innerWidth - half - 8);
  const above = h.y > 240;
  return {
    width,
    left: x,
    top: above ? undefined : h.y + 24,
    bottom: above ? window.innerHeight - h.y + 10 : undefined,
    transform: 'translateX(-50%)',
  };
}

/** One keyword: readable in place, explained on hover or focus. */
export function Term({ k, children }: { k: string; children?: ReactNode }) {
  const tip = useContext(TipContext);
  const entry = GLOSSARY[k];
  const enter = useCallback((e: React.SyntheticEvent<HTMLElement>) => {
    if (entry) tip.show(entry, k, e.currentTarget.getBoundingClientRect());
  }, [entry, k, tip]);

  if (!entry) return <>{children}</>;
  return (
    <span
      className="kw" tabIndex={0} role="button" aria-label={`${entry.term}: ${entry.short}`}
      onMouseEnter={enter} onFocus={enter}
      onMouseLeave={tip.hide} onBlur={tip.hide}
    >{children ?? entry.term}</span>
  );
}

export function Rules({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(PATTERN)) {
      const at = m.index ?? 0;
      if (at > last) out.push(text.slice(last, at));
      const key = KEY_OF.get(m[0].toLowerCase());
      out.push(key ? <Term key={`${at}`} k={key}>{m[0]}</Term> : m[0]);
      last = at + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text]);
  return <>{parts}</>;
}
