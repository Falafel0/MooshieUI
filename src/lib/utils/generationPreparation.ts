export type GenerationPreparationPhase = "inputs" | "style_nodes" | "dependencies" | "submitting";

export class GenerationPreparationCancelled extends Error {
  constructor() {
    super("Generation preparation cancelled");
    this.name = "GenerationPreparationCancelled";
  }
}

/** A verification belongs to one click, not to a potentially replaced Python environment. */
export function onceWithinGenerationRun<T>(task: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => pending ??= Promise.resolve().then(task);
}

/** Check cancellation on both sides of each wait before any later upload or submit. */
export function createGenerationPreparation(
  isCancelled: () => boolean,
  onPhase: (phase: GenerationPreparationPhase | null) => void,
  options: { now?: () => number; log?: (message: string) => void } = {},
) {
  const now = options.now ?? (() => performance.now());
  const log = options.log ?? (message => console.info(message));
  const started = now();
  let phase: GenerationPreparationPhase | null = null;
  let phaseStarted = started;
  let activeDuration = 0;
  const assertActive = () => {
    if (isCancelled()) throw new GenerationPreparationCancelled();
  };
  const endPhase = () => {
    if (phase) {
      const duration = now() - phaseStarted;
      activeDuration += duration;
      log(`[generate:prepare] ${phase}: ${Math.round(duration)} ms`);
    }
  };
  const setPhase = (next: GenerationPreparationPhase | null) => {
    assertActive();
    if (phase !== next) {
      endPhase();
      phase = next;
      phaseStarted = now();
      onPhase(next);
    }
  };
  return {
    assertActive,
    isCancelled,
    phase: setPhase,
    async wait<T>(next: GenerationPreparationPhase, task: () => Promise<T>): Promise<T> {
      setPhase(next);
      const result = await task();
      assertActive();
      return result;
    },
    finish() {
      endPhase();
      log(`[generate:prepare] ${isCancelled() ? "cancelled" : "finished"}: ${Math.round(activeDuration)} ms preparation, ${Math.round(now() - started)} ms elapsed`);
      phase = null;
    },
  };
}
