import { ConnectionQueueInterface } from './connection_queue_interface';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export class ConnectionQueue implements ConnectionQueueInterface {
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
