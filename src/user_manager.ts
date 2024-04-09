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

  addUser(user: User): void {
    this.users.push(user);
    this.emit('change');
  }

  removeUser(sessionId: string): string | undefined {
    const matchedUserIndex: number = this.users.findIndex(
      (user) => user.sessionid === sessionId
    );
    if (matchedUserIndex != -1) {
      const [removedUser] = this.users.splice(matchedUserIndex, 1);
      this.emit('change');
      return removedUser?.sessionid;
    }
    return undefined;
  }
}
