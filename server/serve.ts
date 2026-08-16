// Entry point. `npm run serve`
//
// The one place that decides whether this process offers development tools.
// They are opt-in per run — `LONG_NOON_DEV=1 npm run serve` — so a server
// started the ordinary way cannot be talked into forcing the Turning, whoever
// is asking and whatever they send.
import { serve } from './ws';

const port = Number(process.env.PORT ?? 8787);
const devTools = process.env.LONG_NOON_DEV === '1';
// The floor on bot pace, in ms. Exposed here because it is the one number most
// likely to want changing between sessions, and a 5s floor costs real table
// time — see the measurements in CLAUDE.md.
const gap = Number(process.env.LONG_NOON_BOT_GAP ?? '');
const minGapMs = Number.isFinite(gap) && gap >= 0 ? gap : undefined;

serve({ port, devTools, minGapMs }).then((s) => {
  console.log(`The Long Noon — listening on ws://127.0.0.1:${s.port}`);
  if (minGapMs !== undefined) console.log(`Bot pace floored at ${minGapMs}ms.`);
  if (devTools) {
    console.log('Development tools ON: the act controls are live. Not for a real game.');
  }
});
