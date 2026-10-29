import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { addClient, assertClientAccess, assignClient, inFirm, listAssignees, unassignClient, addFirmMember, createFirm, demoGstin, importClients, listClients, parseCsv, previewClientImport, resolveFirm, type FirmSession } from '../src/index.js';

let db: TestDb;
let partner: FirmSession, preparer: FirmSession, other: FirmSession;
const g = (n: number, state = '27') => demoGstin(state, String(1000 + n).padStart(4, '0'));

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [p, q, o] = [await mk('p@e.test'), await mk('q@e.test'), await mk('o@e.test')] as [string, string, string];
  const f1 = await createFirm(db.web, p, 'Sharma and Co');
  const f2 = await createFirm(db.web, o, 'Rao Associates');
  await addFirmMember(db.web, p, f1, q, 'preparer');
  [partner, preparer, other] = [await resolveFirm(db.web, p, f1), await resolveFirm(db.web, q, f1), await resolveFirm(db.web, o, f2)];
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('clients', () => {
  it('adds a client with two registrations and lists it', async () => {
    await addClient(db.web, partner, { legalName: 'Alpha Foods', pan: 'ZZZZZ1000Z', sourceSoftware: 'Tally', registrations: [{ gstin: g(1) }, { gstin: g(1, '29'), filingFrequency: 'quarterly' }] });
    const l = await listClients(db.web, partner);
    expect(l.total).toBe(1);
    expect(l.clients[0]!).toMatchObject({ legalName: 'Alpha Foods', sourceSoftware: 'Tally' });
    expect(l.clients[0]!.registrations.map((r) => [r.stateCode, r.filingFrequency])).toEqual([['27', 'monthly'], ['29', 'quarterly']]);
  });
  it('rejects a bad GSTIN, a bad PAN, a duplicate in the firm, and a duplicate in the form', async () => {
    await expect(addClient(db.web, partner, { legalName: 'X', registrations: [{ gstin: '27AAAAA0000A1Z5' }] })).rejects.toThrow(/not valid/);
    await expect(addClient(db.web, partner, { legalName: 'X', pan: 'abc', registrations: [{ gstin: g(2) }] })).rejects.toThrow(/PAN/);
    await expect(addClient(db.web, partner, { legalName: 'Again', registrations: [{ gstin: g(1) }] })).rejects.toThrow(/already one of your clients/);
    await expect(addClient(db.web, partner, { legalName: 'Dup', registrations: [{ gstin: g(3) }, { gstin: g(3) }] })).rejects.toThrow(/twice/);
  });
  it('lets a preparer read but not add; another firm sees nothing and can use the same GSTIN', async () => {
    expect((await listClients(db.web, preparer)).total).toBe(0); // nothing assigned yet
    await expect(() => addClient(db.web, preparer, { legalName: 'Nope', registrations: [{ gstin: g(4) }] })).rejects.toThrow(/firm role/);
    expect((await listClients(db.web, other)).total).toBe(0);
    await addClient(db.web, other, { legalName: 'Alpha Foods (their copy)', registrations: [{ gstin: g(1) }] });
    expect((await listClients(db.web, other)).total).toBe(1);
    expect((await listClients(db.web, partner)).total).toBe(1);
  });
  it('pages a long list and reports the true total', async () => {
    for (let i = 10; i < 15; i++) await addClient(db.web, partner, { legalName: `Client ${i}`, registrations: [{ gstin: g(i) }] });
    const p = await listClients(db.web, partner, { limit: 2, offset: 0 });
    expect(p).toMatchObject({ total: 6, limit: 2 });
    expect(p.clients).toHaveLength(2);
  });
});

describe('assignment scope', () => {
  it('shows a preparer only assigned clients, and refuses direct access to others', async () => {
    const all = (await listClients(db.web, partner, { limit: 200 })).clients;
    const alpha = all.find((c) => c.legalName === 'Alpha Foods')!, other6 = all.find((c) => c.legalName === 'Client 10')!;
    await assignClient(db.web, partner, alpha.id, preparer.userId);
    const mine = await listClients(db.web, preparer);
    expect(mine.total).toBe(1);
    expect(mine.clients.map((c) => c.legalName)).toEqual(['Alpha Foods']);
    expect((await listAssignees(db.web, partner, alpha.id)).map((a) => a.email)).toEqual(['q@e.test']);
    await expect(listAssignees(db.web, preparer, other6.id)).rejects.toThrow(/not found/);
    await expect(inFirm(db.web, preparer, 'client.read', (tx) => assertClientAccess(tx, preparer, other6.id))).rejects.toThrow(/not found/);
    await expect(assignClient(db.web, preparer, other6.id, preparer.userId)).rejects.toThrow(/firm role/);
  });
  it('lets a manager see all, and will not assign to someone outside the firm', async () => {
    const [{ id: outsider }] = await db.owner`insert into app_user (email) values ('x@e.test') returning id` as unknown as [{ id: string }];
    const alpha = (await listClients(db.web, partner, { limit: 200 })).clients.find((c) => c.legalName === 'Alpha Foods')!;
    await expect(assignClient(db.web, partner, alpha.id, outsider)).rejects.toThrow(/not an active member/);
  });
  it('removes access when the assignment is removed', async () => {
    const alpha = (await listClients(db.web, partner, { limit: 200 })).clients.find((c) => c.legalName === 'Alpha Foods')!;
    await unassignClient(db.web, partner, alpha.id, preparer.userId);
    expect((await listClients(db.web, preparer)).total).toBe(0);
  });
  it('does not let another firm touch this firm client', async () => {
    const alpha = (await listClients(db.web, partner, { limit: 200 })).clients.find((c) => c.legalName === 'Alpha Foods')!;
    await expect(assignClient(db.web, other, alpha.id, other.userId)).rejects.toThrow(/not found/);
  });
});

describe('csv import', () => {
  const head = 'legal_name,gstin,pan,source_software,filing_frequency\n';
  it('reads quoted commas, quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\r\n')).toEqual([['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
  });
  it('previews 150 rows, flags the bad ones, and writes nothing', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => `Co ${i},${g(100 + i)},,Excel,monthly`);
    rows[5] = 'Bad Co,27AAAAA0000A1Z5,,,';
    rows[6] = `Dup Co,${g(106)},,,\nDup Again,${g(106)},,,`;
    const before = (await listClients(db.web, partner)).total;
    const p = await previewClientImport(db.web, partner, head + rows.join('\n'));
    expect(p.counts).toEqual({ new: 149, exists: 0, error: 2 });
    expect(p.lines.find((l) => l.legalName === 'Bad Co')).toMatchObject({ status: 'error', line: 7 });
    expect((await listClients(db.web, partner)).total).toBe(before);
    await expect(importClients(db.web, partner, head + rows.join('\n'))).rejects.toThrow(/nothing was added/);
    expect((await listClients(db.web, partner)).total).toBe(before);
  });
  it('imports a clean file, groups rows by name, and a second run adds nothing', async () => {
    const csv = head + [`Zeta Ltd,${g(200)},,Tally,monthly`, `Zeta Ltd,${g(200, '29')},,Tally,quarterly`, `Eta Ltd,${g(201)},,,`, `Alpha Foods,${g(1)},,,`].join('\n');
    expect(await importClients(db.web, partner, csv)).toEqual({ added: 2, skipped: 1 });
    expect((await listClients(db.web, partner, { limit: 200 })).clients.find((c) => c.legalName === 'Zeta Ltd')!.registrations).toHaveLength(2);
    expect(await importClients(db.web, partner, csv)).toEqual({ added: 0, skipped: 4 });
  });
  it('refuses a file without the needed columns, and one that is too long', async () => {
    await expect(previewClientImport(db.web, partner, 'name,tax\nA,B')).rejects.toThrow(/legal_name/);
    const long = head + Array.from({ length: 501 }, (_, i) => `C${i},${g(i)}`).join('\n');
    await expect(previewClientImport(db.web, partner, long)).rejects.toThrow(/at most 500/);
  });
  it('does not let a preparer import', async () => {
    await expect(() => importClients(db.web, preparer, head + `X,${g(300)}`)).rejects.toThrow(/firm role/);
  });
});
