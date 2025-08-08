export class LatchflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LatchflowError';
  }
}
