import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { addMember, addToInbox, createBusiness, getInboxFile, listInbox, removeFromInbox, resolveTenant, reviewInbox, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, ca: TenantSession, other: TenantSession;
const PDF = Buffer.from('%PDF-1.4 test').toString('base64');
const add = (t: TenantSession, over: Partial<Parameters<typeof addToInbox>[2]> = {}) => addToInbox(db.web, t, { title: 'Sept rent bill', name: 'rent.pdf', type: 'application/pdf', dataBase64: PDF, ...over });

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [o, s, c, x] = [await mk('o@e.test'), await mk('s@e.test'), await mk('c@e.test'), await mk('x@e.test')];
  const bid = await createBusiness(db.web, o, { legalName: 'Acme', gstin: null, stateCode: '27', registrationType: 'unregistered' });
  await addMember(db.web, o, bid, s, 'staff'); await addMember(db.web, o, bid, c, 'accountant');
  owner = await resolveTenant(db.web, o, bid); staff = await resolveTenant(db.web, s, bid); ca = await resolveTenant(db.web, c, bid);
  other = await resolveTenant(db.web, x, await createBusiness(db.web, x, { legalName: 'Other', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('client inbox', () => {
  it('lets the business send a file, and the accountant read, review and reopen it', async () => {
    const { id } = await add(staff, { note: 'Paid in cash' });
    const [i] = await listInbox(db.web, ca);
    expect(i).toMatchObject({ id, title: 'Sept rent bill', status: 'new', uploaded_by_email: 's@e.test', note: 'Paid in cash' });
    expect((await getInboxFile(db.web, ca, id))?.data.toString()).toBe('%PDF-1.4 test');
    await reviewInbox(db.web, ca, id, { status: 'rejected', reviewNote: 'Bill is cut off at the bottom' });
    expect((await listInbox(db.web, staff))[0]).toMatchObject({ status: 'rejected', review_note: 'Bill is cut off at the bottom', reviewed_by_email: 'c@e.test' });
    await reviewInbox(db.web, ca, id, { status: 'done' });
    expect((await listInbox(db.web, staff, { status: 'done' }))[0]).toMatchObject({ id, review_note: null });
    await reviewInbox(db.web, ca, id, { status: 'new' });
    expect((await listInbox(db.web, staff, { status: 'new' })).some((r) => r.id === id)).toBe(true);
  });

  it('keeps roles apart: the accountant cannot send, staff cannot review, and a rejection needs a reason', async () => {
    await expect(add(ca)).rejects.toThrow(/cannot do this/);
    const { id } = await add(owner);
    await expect(reviewInbox(db.web, staff, id, { status: 'done' })).rejects.toThrow(/cannot do this/);
    await expect(reviewInbox(db.web, ca, id, { status: 'rejected' })).rejects.toThrow(/Say what is wrong/);
  });

  it('refuses files that are not what they claim, empty files and big files', async () => {
    await expect(add(staff, { dataBase64: Buffer.from('not a pdf').toString('base64') })).rejects.toThrow(/real file/);
    await expect(add(staff, { type: 'text/html' })).rejects.toThrow(/JPEG or PNG/);
    await expect(add(staff, { dataBase64: '' })).rejects.toThrow();
    await expect(add(staff, { dataBase64: Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(2 * 1024 * 1024)]).toString('base64') })).rejects.toThrow(/larger than 2 MB/);
    await expect(add(staff, { title: '  ' })).rejects.toThrow(/Title/);
  });

  it('lets the sender take back a new item, but not someone else, and shows nothing to other businesses', async () => {
    const { id } = await add(staff);
    await expect(removeFromInbox(db.web, ca, id)).rejects.toThrow(/Only the person/);
    await removeFromInbox(db.web, staff, id);
    expect((await listInbox(db.web, owner)).some((r) => r.id === id)).toBe(false);
    const { id: id2 } = await add(owner);
    expect(await listInbox(db.web, other)).toEqual([]);
    expect(await getInboxFile(db.web, other, id2)).toBeNull();
    await expect(reviewInbox(db.web, other, id2, { status: 'done' })).rejects.toThrow(/not found/);
  });
});
