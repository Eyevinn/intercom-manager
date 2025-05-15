import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export class ConnectionQueue {
  // eslint-disable-next-line
  private queue: Array<[string, () => Promise<any>]>;
  private emitter = new EventEmitter();

  constructor() {
    this.queue = [];
  }

  private async processQueue() {
    if (this.queue.length > 0) {
      const item = this.queue[0];

      if (!item) {
        throw new Error('No item to process');
      }

      let result = null;
      let error = null;

      try {
        result = await item[1]();
      } catch (e) {
        error = e;
      }

      this.emitter.emit(item[0], {
        error,
        result
      });

      this.queue.shift();

      await this.processQueue();
    }
  }

  async queueAsync<T>(item: () => Promise<T>): Promise<T> {
    const id = uuidv4();

    this.queue.push([id, item]);

    const queuePromise = new Promise<T>((resolve, reject) => {
      // eslint-disable-next-line
      const cb = (data: any) => {
        if (data.error) {
          reject(data.error);
        } else {
          resolve(data.result);
        }

        this.emitter.off(id, cb);
      };

      this.emitter.on(id, cb);
    });

    if (this.queue.length === 1) {
      this.processQueue();
    }

    return queuePromise;
  }
}
