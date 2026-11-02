/** Stage prepared references until a frame can present them together. */
export class FactoryModelPresentation<T> {
  private items: T[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private requestFrame: () => void,
    private maxItems = 4,
    private maxDelayMs = 1000,
  ) {}

  add(item: T) {
    if (this.stopped) return;
    this.items.push(item);
    if (this.timer === undefined) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (!this.stopped && this.items.length) this.requestFrame();
      }, this.maxDelayMs);
    }
    if (this.items.length >= this.maxItems) this.requestFrame();
  }

  requestFinalFrame() {
    if (!this.stopped && this.items.length) this.requestFrame();
  }

  take() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    return this.items.splice(0);
  }

  dispose() {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.items = [];
  }
}
