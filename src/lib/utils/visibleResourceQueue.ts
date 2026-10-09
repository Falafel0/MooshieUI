/** Load resources needed by visible cards without starting work for a hidden
 * library. In-flight IPC cannot be aborted, so disposal suppresses its result. */
export function createVisibleResourceQueue<T>(options: {
  load: (key: string) => Promise<T>;
  loaded: (key: string, value: T) => void;
  failed: (key: string, error: unknown) => void;
  concurrency?: number;
}) {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 3));
  let visible = new Set<string>();
  const attempted = new Set<string>();
  const running = new Set<string>();
  let disposed = false;

  function pump() {
    if (disposed) return;
    for (const key of visible) {
      if (running.size >= concurrency) break;
      if (attempted.has(key) || running.has(key)) continue;
      attempted.add(key);
      running.add(key);
      void Promise.resolve().then(async () => {
        if (disposed || !visible.has(key)) {
          attempted.delete(key);
          return;
        }
        try {
          const value = await options.load(key);
          if (!disposed) options.loaded(key, value);
        } catch (error) {
          if (!disposed) options.failed(key, error);
        }
      }).finally(() => {
        running.delete(key);
        pump();
      });
    }
  }

  return {
    setVisible(keys: Iterable<string>) {
      if (disposed) return;
      visible = new Set(keys);
      pump();
    },
    retry(key: string) {
      if (running.has(key) || disposed) return;
      attempted.delete(key);
      pump();
    },
    dispose() { disposed = true; visible.clear(); },
  };
}
