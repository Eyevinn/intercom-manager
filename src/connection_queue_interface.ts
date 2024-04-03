export interface ConnectionQueueInterface {
  isEmpty(): boolean;
  add(createConferencePromise: Promise<void>): void;
  removeFirst(): void;
}
