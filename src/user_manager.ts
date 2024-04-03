import { User } from './models';
import { EventEmitter } from 'events';
import { UserManagerInterface } from './user_manager_interface';

export class UserManager extends EventEmitter implements UserManagerInterface {
  private users: User[];
  constructor() {
    super();
    this.users = [];
  }

  getUsers(): User[] {
    return this.users;
  }

  addUser(user: User): number {
    this.emit('change');
    return this.users.push(user);
  }

  removeUser(sessionId: string): string | undefined {
    this.emit('change');
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
