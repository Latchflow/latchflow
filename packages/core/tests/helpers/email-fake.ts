// Minimal fake email transport for unit/integration tests (no network)
export type SentEmail = { to: string; subject: string; html?: string; text?: string };

const mailbox: SentEmail[] = [];

export function sendEmail(msg: SentEmail) {
  mailbox.push(msg);
}

export function getLastEmail(): SentEmail | undefined {
  return mailbox[mailbox.length - 1];
}

export function clearMailbox() {
  mailbox.length = 0;
}
