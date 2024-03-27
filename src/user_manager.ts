import { User } from './models';
import { EventEmitter } from 'events';

interface UserManagerInterface {
  getUsers(): User[];
  addUser(user: User): void;
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
    return this.users.push(user);
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
