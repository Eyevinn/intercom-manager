import { ConnectionQueueInterface } from './connection_queue_interface';

export class ConnectionQueue implements ConnectionQueueInterface {
  private queue: Promise<void>[];
  constructor() {
    this.queue = [];
  }

  isEmpty(): boolean {
    if (this.queue.length === 0) {
      return true;
    } else {
      return false;
    }
  }

  add(createConferencePromise: Promise<void>): void {
    this.queue.push(createConferencePromise);
  }

  removeFirst(): void {
    this.queue.splice(0, 1);
  }
}
