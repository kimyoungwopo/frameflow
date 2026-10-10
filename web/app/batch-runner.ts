export type BatchOutcome = { index: number; status: 'done' | 'error'; message?: string };

export async function runBatch<T>(options: {
  items: readonly T[];
  controller: AbortController;
  concurrency: number;
  execute: (item: T, index: number) => Promise<void>;
  isFatal: (error: unknown) => boolean;
  onOutcome?: (outcome: BatchOutcome) => void;
}) {
  const { items, controller, execute, isFatal, onOutcome } = options;
  let cursor = 0;
  let fatal: unknown;
  const outcomes: BatchOutcome[] = [];
  const worker = async () => {
    while (!controller.signal.aborted && cursor < items.length) {
      const index = cursor++;
      try {
        await execute(items[index], index);
        controller.signal.throwIfAborted();
        const outcome: BatchOutcome = { index, status: 'done' };
        outcomes.push(outcome); onOutcome?.(outcome);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isFatal(error)) { fatal = error; controller.abort(error); return; }
        const outcome: BatchOutcome = { index, status: 'error', message: error instanceof Error ? error.message : '이미지 실행에 실패했어요.' };
        outcomes.push(outcome); onOutcome?.(outcome);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, Math.min(2, Math.floor(options.concurrency) || 1))) }, worker));
  if (fatal !== undefined) throw fatal;
  controller.signal.throwIfAborted();
  return outcomes.sort((a, b) => a.index - b.index);
}
