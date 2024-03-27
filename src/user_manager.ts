import { User } from './models';
import { EventEmitter } from 'events';

export class Timer {
  private counter: number;
  private timeoutIds: NodeJS.Timeout[];

  constructor() {
    this.counter = 0;
    this.timeoutIds = [];
  }

  delay(delay: number) {
    return new Promise((r) => {
      this.timeoutIds.push(setTimeout(r, delay));
    });
  }

  async startTimer(): Promise<void> {
    while (this.counter < 1200) {
      await this.delay(1000);
      this.counter += 1;
    }
  }

  getTime(): number {
    return this.counter;
  }

  resetTimer(): void {
    this.counter = 0;
  }

  destroyTimers(): void {
    for (const timerId of this.timeoutIds) {
      clearTimeout(timerId);
    }
  }
}

interface UserManagerInterface {
  getUsers(): User[];
  addUser(user: User): void;
  getUser(sessionid: string): User | undefined;
  removeUser(sessionId: string): string | undefined;
}

export class UserManager implements UserManagerInterface {
  private users: User[];
  changeEmitter: EventEmitter;

  constructor() {
    this.users = [];
    this.changeEmitter = new EventEmitter();
  }

  getUsers(): User[] {
    return this.users;
  }

  addUser(user: User): number {
    this.changeEmitter.emit('change');
    user.heartbeatTimer = new Timer();
    return this.users.push(user);
  }

  getUser(sessionid: string): User | undefined {
    const matchedUser = this.users.find((user) => user.sessionid === sessionid);
    if (matchedUser) {
      return matchedUser;
    } else {
      return undefined;
    }
  }

  removeUser(sessionId: string): string | undefined {
    this.changeEmitter.emit('change');
    const matchedUserIndex: number = this.users.findIndex(
      (user) => user.sessionid === sessionId
    );
    if (matchedUserIndex != -1) {
      if (this.users.splice(matchedUserIndex, 1)) {
        return sessionId;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
}
