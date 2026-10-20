import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { addAttachment, addMember, createBusiness, createParty, getAttachment, listAttachments, removeAttachment, resolveTenant, saveDraft, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession, accountant: TenantSession, other: TenantSession, docId: string;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n').toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('rest')]).toString('base64');

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [o, a, x] = [await mk('o@a.test'), await mk('a@a.test'), await mk('x@a.test')];
  const bid = await createBusiness(db.web, o, { legalName: 'Attach Co', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, o, bid, a, 'accountant');
  owner = await resolveTenant(db.web, o, bid); accountant = await resolveTenant(db.web, a, bid);
  other = await resolveTenant(db.web, x, await createBusiness(db.web, x, { legalName: 'Other', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
  const c = await createParty(db.web, owner, { kind: 'customer', name: 'Buyer', stateCode: '27' });
  docId = (await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: c, lines: [{ name: 'Item', hsnSac: '998313', quantity: '1', rate: '100', taxRateBp: 1800, kind: 'service' }] })).id;
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('attachments on a document', () => {
  it('stores, lists and returns a file exactly as given', async () => {
    const { id } = await addAttachment(db.web, owner, docId, { name: 'PO 7781.pdf', type: 'application/pdf', dataBase64: PDF });
    const list = await listAttachments(db.web, owner, docId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ file_name: 'PO 7781.pdf', content_type: 'application/pdf' });
    const f = (await getAttachment(db.web, owner, docId, id))!;
    expect(f.type).toBe('application/pdf');
    expect(f.data.toString('base64')).toBe(PDF);
  });
  it('refuses a wrong type, a file that is not what it says, an empty file and a big one', async () => {
    await expect(addAttachment(db.web, owner, docId, { name: 'a.exe', type: 'application/x-msdownload', dataBase64: PDF })).rejects.toThrow(/JPEG or PNG picture, or a PDF/);
    await expect(addAttachment(db.web, owner, docId, { name: 'fake.pdf', type: 'application/pdf', dataBase64: PNG })).rejects.toThrow(/does not look like a real file/);
    await expect(addAttachment(db.web, owner, docId, { name: 'e.pdf', type: 'application/pdf', dataBase64: '' })).rejects.toThrow();
    const big = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(2 * 1024 * 1024)]).toString('base64');
    await expect(addAttachment(db.web, owner, docId, { name: 'big.pdf', type: 'application/pdf', dataBase64: big })).rejects.toThrow(/larger than 2 MB/);
  });
  it('allows three and no more, until one is removed', async () => {
    await addAttachment(db.web, owner, docId, { name: 'two.png', type: 'image/png', dataBase64: PNG });
    await addAttachment(db.web, owner, docId, { name: 'three.png', type: 'image/png', dataBase64: PNG });
    await expect(addAttachment(db.web, owner, docId, { name: 'four.png', type: 'image/png', dataBase64: PNG })).rejects.toThrow(/at most 3/);
    const first = (await listAttachments(db.web, owner, docId))[0]!;
    await removeAttachment(db.web, owner, docId, first.id as string);
    await addAttachment(db.web, owner, docId, { name: 'four.png', type: 'image/png', dataBase64: PNG });
    expect(await listAttachments(db.web, owner, docId)).toHaveLength(3);
  });
  it('cleans an unsafe file name', async () => {
    await removeAttachment(db.web, owner, docId, (await listAttachments(db.web, owner, docId))[0]!.id as string);
    const { id } = await addAttachment(db.web, owner, docId, { name: '../../etc/pass"wd<script>.pdf', type: 'application/pdf', dataBase64: PDF });
    const name = (await listAttachments(db.web, owner, docId)).find((f) => f.id === id)!.file_name as string;
    expect(name).not.toMatch(/[\/"<>]/);
  });
  it('lets an accountant read but not add or remove, and keeps other businesses out', async () => {
    expect((await listAttachments(db.web, accountant, docId)).length).toBeGreaterThan(0);
    await expect(addAttachment(db.web, accountant, docId, { name: 'x.pdf', type: 'application/pdf', dataBase64: PDF })).rejects.toThrow();
    const one = (await listAttachments(db.web, owner, docId))[0]!;
    await expect(removeAttachment(db.web, accountant, docId, one.id as string)).rejects.toThrow();
    expect(await listAttachments(db.web, other, docId)).toEqual([]);
    expect(await getAttachment(db.web, other, docId, one.id as string)).toBeNull();
    await expect(addAttachment(db.web, other, docId, { name: 'x.pdf', type: 'application/pdf', dataBase64: PDF })).rejects.toThrow(/Document not found/);
  });
  it('is removed with the document and says so when the file is not there', async () => {
    await expect(removeAttachment(db.web, owner, docId, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(/not found/i);
    const c = (await db.owner`select party_id from document where id = ${docId}`)[0]!.party_id as string;
    const d2 = (await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: c, lines: [{ name: 'Item', hsnSac: '998313', quantity: '1', rate: '10', taxRateBp: 1800, kind: 'service' }] })).id;
    await addAttachment(db.web, owner, d2, { name: 'p.pdf', type: 'application/pdf', dataBase64: PDF });
    await db.owner`delete from document where id = ${d2}`;
    expect((await db.owner`select count(*)::int as n from document_file where document_id = ${d2}`)[0]!.n).toBe(0);
  });
});
