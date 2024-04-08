export interface ConnectionQueueInterface {
  queueAsync<T>(input: () => Promise<T>): Promise<T>;
}
