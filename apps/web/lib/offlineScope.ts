'use client';

export type OfflineScope = { userId: string; businessId: string };
let scope: OfflineScope | null = null;
export function setOfflineScope(next: OfflineScope) { scope = next; }
export const getOfflineScope = () => scope;
export const offlineDatabaseName = (s: OfflineScope) => `kora-offline:${s.userId}:${s.businessId}`;
export function tenantHeaders(): Record<string, string> {
  return scope ? { 'x-kora-business': scope.businessId, 'x-kora-user': scope.userId } : {};
}
