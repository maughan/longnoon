// The engine's public surface. Nothing here imports from client/ or sim/.
export { setup } from './setup';
export type { SetupOptions } from './setup';
export { apply, start, IllegalCommand, checkTurning, checkWin, addDoom } from './reducer';
export { legalCommands, isLegal } from './legal';
export { playerView } from './view';
export type { ClientState, OpponentView } from './view';
export { signsHeld, deckSize, livingPlayers, opsFor, displayName } from './effects';
export * from './state';
