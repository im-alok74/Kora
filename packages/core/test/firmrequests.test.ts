import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addClient, addDefaultChecklist, addFirmMember, addRequest, addStaffVersion, assignClient, createFirm, createUploadLink, demoGstin, generateEngagements, getVersionFile,
  listClients, listEngagements, listRequests, loadUploadPage, resolveFirm, revokeUploadLink, uploadLinkState, uploadViaLink, type FirmSession,
} from '../src/index.js';

let db: TestDb;
let partner: FirmSession, prep: FirmSession, other: FirmSession;
let e1: string, e2: string;
const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`).toString('base64');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('rest')]).toString('base64');

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [p, q, o] = [await mk('p@e.test'), await mk('q@e.test'), await mk('o@e.test')] as [string, string, string];
  const f = await createFirm(db.web, p, 'Sharma and Co');
  const f2 = await createFirm(db.web, o, 'Rao');
  await addFirmMember(db.web, p, f, q, 'preparer');
  [partner, prep, other] = await Promise.all([resolveFirm(db.web, p, f), resolveFirm(db.web, q, f), resolveFirm(db.web, o, f2)]);
  await addClient(db.web, partner, { legalName: 'Alpha Foods', registrations: [{ gstin: demoGstin('27', '5001') }] });
  await addClient(db.web, partner, { legalName: 'Beta Traders', registrations: [{ gstin: demoGstin('27', '5002') }] });
  await generateEngagements(db.web, partner, '2026-08');
  const l = (await listEngagements(db.web, partner)).engagements;
  e1 = l.find((x) => x.clientName === 'Alpha Foods' && x.service === 'gstr1')!.id;
  e2 = l.find((x) => x.clientName === 'Beta Traders' && x.service === 'gstr1')!.id;
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('checklist', () => {
  it('adds the standard items once, and one extra item, and refuses a repeat', async () => {
    expect(await addDefaultChecklist(db.web, partner, e1)).toBe(3);
    expect(await addDefaultChecklist(db.web, partner, e1)).toBe(0);
    await addRequest(db.web, partner, e1, { label: 'GSTR-2B download', dueDate: '2026-09-05' });
    await expect(addRequest(db.web, partner, e1, { label: 'gstr-2b DOWNLOAD' })).rejects.toThrow(/already on the list/);
    const r = await listRequests(db.web, partner, e1);
    expect(r).toHaveLength(4);
    expect(r.every((x) => x.status === 'requested' && x.versions.length === 0)).toBe(true);
    expect(r[3]).toMatchObject({ label: 'GSTR-2B download', dueDate: '2026-09-05' });
  });
  it('keeps an unassigned preparer and another firm out', async () => {
    await expect(listRequests(db.web, prep, e1)).rejects.toThrow(/not found/);
    await expect(listRequests(db.web, other, e1)).rejects.toThrow(/not found/);
    await expect(addRequest(db.web, other, e1, { label: 'x' })).rejects.toThrow(/not found/);
    const alpha = (await listClients(db.web, partner)).clients.find((c) => c.legalName === 'Alpha Foods')!;
    await assignClient(db.web, partner, alpha.id, prep.userId);
    expect(await listRequests(db.web, prep, e1)).toHaveLength(4);
  });
});

describe('the client link', () => {
  let token: string, bank: string;
  it('shows the client only this work, and nothing for a wrong token', async () => {
    ({ token } = await createUploadLink(db.web, partner, e1));
    const page = await loadUploadPage(db.web, token);
    expect(page).toMatchObject({ firm: 'Sharma and Co', client: 'Alpha Foods', work: 'GSTR-1 for 2026-08' });
    expect(page!.items).toHaveLength(4);
    expect(JSON.stringify(page)).not.toContain('Beta');
    expect(await loadUploadPage(db.web, 'nonsense')).toBeNull();
    expect(await uploadLinkState(db.web, partner, e1)).toMatchObject({ active: true });
    bank = page!.items.find((i) => /Bank/.test(i.label))!.id;
  });
  it('takes a file, marks the item received, and keeps every version', async () => {
    await uploadViaLink(db.web, token, bank, { name: 'bank.pdf', type: 'application/pdf', dataBase64: pdf('one') });
    await uploadViaLink(db.web, token, bank, { name: 'bank2.pdf', type: 'application/pdf', dataBase64: pdf('two') });
    const item = (await listRequests(db.web, partner, e1)).find((x) => x.id === bank)!;
    expect(item.status).toBe('received');
    expect(item.versions.map((v) => v.fileName)).toEqual(['bank2.pdf', 'bank.pdf']);
    expect(item.versions[0]).toMatchObject({ uploadedVia: 'link', contentType: 'application/pdf' });
    const f = await getVersionFile(db.web, partner, item.versions[1]!.id);
    expect(f!.data.toString()).toBe('%PDF-1.4 one');
    const [row] = await db.owner`select sha256, size_bytes from document_version where id = ${item.versions[1]!.id}`;
    expect(row!.size_bytes).toBe(12);
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('refuses bad files', async () => {
    await expect(uploadViaLink(db.web, token, bank, { name: 'a.exe', type: 'application/x-msdownload', dataBase64: pdf('x') })).rejects.toThrow(/JPEG or PNG/);
    await expect(uploadViaLink(db.web, token, bank, { name: 'a.pdf', type: 'application/pdf', dataBase64: png })).rejects.toThrow(/real file/);
    await expect(uploadViaLink(db.web, token, bank, { name: 'a.pdf', type: 'application/pdf', dataBase64: '' })).rejects.toThrow();
  });
  it('refuses an item that belongs to another piece of work', async () => {
    await addDefaultChecklist(db.web, partner, e2);
    const other2 = (await listRequests(db.web, partner, e2))[0]!.id;
    await expect(uploadViaLink(db.web, token, other2, { name: 'a.pdf', type: 'application/pdf', dataBase64: pdf('x') })).rejects.toThrow(/could not be saved/);
  });
  it('stops working when revoked, expired or replaced', async () => {
    await revokeUploadLink(db.web, partner, e1);
    expect(await loadUploadPage(db.web, token)).toBeNull();
    await expect(uploadViaLink(db.web, token, bank, { name: 'a.pdf', type: 'application/pdf', dataBase64: pdf('x') })).rejects.toThrow(/not valid/);
    const a = (await createUploadLink(db.web, partner, e1)).token;
    const b = (await createUploadLink(db.web, partner, e1)).token;
    expect(await loadUploadPage(db.web, a)).toBeNull();
    expect(await loadUploadPage(db.web, b)).not.toBeNull();
    await db.owner`update upload_link set expires_at = now() - interval '1 minute' where engagement_id = ${e1}`;
    expect(await loadUploadPage(db.web, b)).toBeNull();
    expect(await uploadLinkState(db.web, partner, e1)).toEqual({ active: false });
  });
  it('lets a firm member add a file for the client, and another firm cannot download it', async () => {
    const bankReq = (await listRequests(db.web, partner, e1)).find((x) => /Sales/.test(x.label))!;
    const vid = await addStaffVersion(db.web, partner, bankReq.id, { name: 'sales.png', type: 'image/png', dataBase64: png });
    expect((await listRequests(db.web, partner, e1)).find((x) => x.id === bankReq.id)).toMatchObject({ status: 'received' });
    expect((await getVersionFile(db.web, partner, vid))!.type).toBe('image/png');
    expect(await getVersionFile(db.web, other, vid)).toBeNull();
  });
});

describe('upload quota on the client link', () => {
  it('stops one link filling storage: 10 files per item, 40 per piece of work, 50 MB in all; staff are not limited', async () => {
    await addRequest(db.web, partner, e2, { label: 'Fourth item' });
    await addRequest(db.web, partner, e2, { label: 'Fifth item' });
    const { token } = await createUploadLink(db.web, partner, e2);
    const ids = (await loadUploadPage(db.web, token))!.items.map((i) => i.id);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    const [a, b, c, d, e] = ids;
    for (let i = 0; i < 10; i++) await uploadViaLink(db.web, token, a!, { name: `a${i}.pdf`, type: 'application/pdf', dataBase64: pdf(`a${i}`) });
    await expect(uploadViaLink(db.web, token, a!, { name: 'a11.pdf', type: 'application/pdf', dataBase64: pdf('x') })).rejects.toThrow(/most files this link allows/);   // per item
    for (const item of [b!, c!, d!]) for (let i = 0; i < 10; i++) await uploadViaLink(db.web, token, item, { name: `f${i}.pdf`, type: 'application/pdf', dataBase64: pdf(`${item}${i}`) });
    await expect(uploadViaLink(db.web, token, e!, { name: 'fifth.pdf', type: 'application/pdf', dataBase64: pdf('fifth') })).rejects.toThrow(/most files this link allows/);   // 40 in all
    expect(await addStaffVersion(db.web, partner, e!, { name: 'staff.pdf', type: 'application/pdf', dataBase64: pdf('staff') })).toBeTruthy();                                  // staff are not limited
  });
  it('refuses once the bytes through the link pass 50 MB', async () => {
    const { token } = await createUploadLink(db.web, partner, e1);
    const item = (await loadUploadPage(db.web, token))!.items[0]!.id;
    await db.owner`update document_version set size_bytes = 2097152 where request_id in (select id from document_request where engagement_id = ${e1}) and uploaded_via = 'link'`;
    await db.owner`insert into document_version (firm_id, request_id, file_name, content_type, size_bytes, sha256, data, uploaded_via)
                   select firm_id, id, 'big.pdf', 'application/pdf', 2097152, repeat('a', 64), '\x25'::bytea, 'link' from document_request where engagement_id = ${e1} limit 1 offset 1`;
    // push the engagement total towards the byte cap with direct rows so the test stays fast
    for (let i = 0; i < 24; i++) await db.owner`insert into document_version (firm_id, request_id, file_name, content_type, size_bytes, sha256, data, uploaded_via)
                   select firm_id, id, ${'filler' + i + '.pdf'}, 'application/pdf', 2097152, repeat('b', 64), '\x25'::bytea, 'link' from document_request where engagement_id = ${e1} and id <> ${item} limit 1`;
    await expect(uploadViaLink(db.web, token, item, { name: 'over.pdf', type: 'application/pdf', dataBase64: pdf('over') })).rejects.toThrow(/most files this link allows/);
  });
});
