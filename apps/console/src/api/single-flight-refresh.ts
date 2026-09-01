export class SingleFlightRefresh {
  private active?: Promise<void>;
  private dirty = false;
  private disposed = false;

  constructor(private readonly operation: () => Promise<void>) {}

  request(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.active) {
      this.dirty = true;
      return this.active;
    }

    const active = this.run().finally(() => {
      if (this.active === active) this.active = undefined;
    });
    this.active = active;
    return active;
  }

  clearPending(): void {
    this.dirty = false;
  }

  dispose(): void {
    this.disposed = true;
    this.dirty = false;
  }

  private async run(): Promise<void> {
    let firstError: unknown;
    do {
      this.dirty = false;
      try {
        await this.operation();
      } catch (error) {
        firstError ??= error;
      }
    } while (this.dirty && !this.disposed);

    if (firstError !== undefined) throw firstError;
  }
}
