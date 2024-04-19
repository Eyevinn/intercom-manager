// Custom light assert function because jest breaks node:assert
// see https://github.com/jestjs/jest/issues/7547
export function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    // There is no good way to manipulate the stack trace, so stack traces will point to this line
    throw new Error(message);
  }
}
