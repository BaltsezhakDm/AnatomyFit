/** Простой in-memory лимитер попыток (скользящее окно). Достаточно для одного инстанса SQLite-бекенда. */
export class AttemptLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number
  ) {}

  /** Регистрирует попытку; возвращает false, если лимит для ключа исчерпан. */
  hit(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs);
    if (recent.length >= this.maxAttempts) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  clear() {
    this.hits.clear();
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) {
      if (times.every(t => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}
