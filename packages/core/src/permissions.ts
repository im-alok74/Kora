export type Role = 'owner' | 'staff' | 'accountant';

export type Action =
  | 'document.read' | 'document.write' | 'document.issue' | 'document.cancel'
  | 'party.read' | 'party.write' | 'item.read' | 'item.write'
  | 'payment.read' | 'payment.write' | 'expense.read' | 'expense.write'
  | 'report.read' | 'report.export' | 'inbox.read' | 'inbox.upload' | 'inbox.review'
  | 'einvoice.submit' | 'settings.write' | 'member.manage' | 'billing.manage' | 'audit.read';

const READ: Action[] = ['document.read', 'party.read', 'item.read', 'payment.read', 'report.read', 'expense.read', 'inbox.read'];

const GRANTS: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>([
    ...READ, 'document.write', 'document.issue', 'document.cancel', 'party.write', 'item.write',
    'payment.write', 'expense.write', 'report.export', 'inbox.upload', 'inbox.review', 'einvoice.submit', 'settings.write', 'member.manage', 'billing.manage', 'audit.read',
  ]),
  staff: new Set<Action>([
    ...READ, 'document.write', 'document.issue', 'party.write', 'item.write', 'payment.write', 'expense.write', 'inbox.upload', 'einvoice.submit',
  ]),
  // The accountant seat: read everything and export, change nothing, apart from working through the client inbox.
  accountant: new Set<Action>([...READ, 'report.export', 'audit.read', 'inbox.review']),
};

export function can(role: Role, action: Action): boolean {
  return GRANTS[role].has(action);
}

export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) throw new ForbiddenError(action);
}

export class ForbiddenError extends Error {
  constructor(public action: Action) { super(`Your role cannot do this (${action}).`); this.name = 'ForbiddenError'; }
}
export const isForbidden = (e: unknown): e is ForbiddenError => e instanceof Error && e.name === 'ForbiddenError';
