import { User } from './models';

export interface UserManagerInterface {
  getUsers(): User[];
  addUser(user: User): void;
  removeUser(sessionId: string): string | undefined;
}
