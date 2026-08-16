/**
 * The one error the engine throws.
 *
 * It lives in its own module rather than in `reducer.ts` because `effects.ts`
 * needs it too, and `reducer.ts` already imports `effects.ts` — a class reached
 * through an import cycle is initialised late and `new IllegalCommand(...)`
 * becomes "is not a constructor" at some random call depth.
 *
 * `reducer.ts` re-exports it, so every existing import still resolves.
 */
export class IllegalCommand extends Error {}
