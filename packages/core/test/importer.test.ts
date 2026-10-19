import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinCheckChar } from '@kora/tax';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, commitImport, createBusiness, createParty, exportBackup, listItems, listParties, parseCsv, previewImport, readStoredZip, resolveTenant,
  ForbiddenError, ValidationError, type TenantSession,
} from '../src/index.js';

describe('CSV reading', () => {
  it('handles quotes, doubled quotes, line breaks inside quotes, both line endings and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"two\nlines",z')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', 'z']]);
    expect(parseCsv('a,b\n\n\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('a,,c\n,,')).toEqual([['a', '', 'c'], ['', '', '']]);
    expect(parseCsv('')).toEqual([]);
  });
  it('says when a quote is never closed instead of swallowing the rest of the file', () => {
    expect(() => parseCsv('a,b\n"oops,1\n2,3')).toThrow(/never closed/);
  });
});

describe('importing customers and items', () => {
  let db: TestDb;
  let owner: TenantSession, staff: TenantSession, accountant: TenantSession, other: TenantSession;
  const g = (state: string, mid: string) => { const b = `${state}${mid}1Z`; return b + gstinCheckChar(b); };
  const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };

  beforeAll(async () => {
    db = await makeTestDb();
    const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
    const [u, s, a, o] = [await mk('o@e.test'), await mk('s@e.test'), await mk('a@e.test'), await mk('x@e.test')];
    const bid = await createBusiness(db.web, u, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
    await addMember(db.web, u, bid, s, 'staff'); await addMember(db.web, u, bid, a, 'accountant');
    owner = await resolveTenant(db.web, u, bid); staff = await resolveTenant(db.web, s, bid); accountant = await resolveTenant(db.web, a, bid);
    other = await resolveTenant(db.web, o, await createBusiness(db.web, o, { legalName: 'Other Co', gstin: g('29', 'AAPFU0939F'), stateCode: '29', registrationType: 'regular' }));
    await createParty(db.web, owner, { kind: 'customer', name: 'Existing Traders', gstin: g('29', 'BBBCC1234D') });
  }, 60_000);
  afterAll(async () => { await db?.drop(); });

  const GOOD = g('27', 'CCCCC1234D');
  const customersCsv = [
    'Customer Name,Mobile,State,GST Number,E-mail,Address,City,Pin Code,Notes',
    `Asha Stores,98765 43210,Maharashtra,${GOOD},asha@example.com,12 Main Road,Pune,411001,vip`,
    'Bimal Traders,9000000001,29,,,,Bengaluru,560001,',
    'Chitra & Sons,,Tamil Nadu,,,,,,',
    '"Dev, ""The"" Shop",,Delhi,,,,,,',
    'नमस्ते स्टोर्स,,Gujarat,,,,,,',
  ].join('\r\n');

  it('previews each row, maps friendly headers, and names what it ignored', async () => {
    const p = await previewImport(db.web, owner, 'customers', customersCsv);
    expect(p.columns.ignored).toEqual(['Notes']);
    expect(p.columns.mapped).toEqual(expect.arrayContaining(['name', 'phone', 'state', 'gstin', 'email', 'address', 'city', 'pincode']));
    expect(p.counts).toEqual({ total: 5, ok: 5, duplicate: 0, error: 0 });
    expect(p.rows.map((r) => r.name)).toEqual(['Asha Stores', 'Bimal Traders', 'Chitra & Sons', 'Dev, "The" Shop', 'नमस्ते स्टोर्स']);
  });

  it('flags the rows that cannot be imported, with the line number and a reason, and skips duplicates', async () => {
    const csv = [
      'name,gstin,state,email',
      `Good One,${g('27', 'DDDDD1234D')},,`,
      'No State,,,',
      'Bad State,,Atlantis,',
      'Bad GSTIN,27AAPFU0939F1Z0,,',
      'Bad Email,,Kerala,not-an-email',
      `Dupe By GSTIN,${g('29', 'BBBCC1234D')},,`,
      'existing TRADERS,,Kerala,',
      'Twice,,Kerala,', 'twice,,Kerala,',
      ',,Kerala,',
    ].join('\n');
    const p = await previewImport(db.web, owner, 'customers', csv);
    const by = Object.fromEntries(p.rows.map((r) => [r.line, r]));
    expect(by[2]!.status).toBe('ok');
    expect(by[3]).toMatchObject({ status: 'error', message: expect.stringContaining('state') });
    expect(by[4]).toMatchObject({ status: 'error', message: expect.stringContaining('Atlantis') });
    expect(by[5]!.status).toBe('error');
    expect(by[6]).toMatchObject({ status: 'error', message: expect.stringContaining('email') });
    expect(by[7]).toMatchObject({ status: 'duplicate' });                    // same GSTIN as an existing customer
    expect(by[8]).toMatchObject({ status: 'duplicate' });                    // same name, any case
    expect([by[9]!.status, by[10]!.status]).toEqual(['ok', 'duplicate']);    // the second of two in the same file
    expect(by[11]).toMatchObject({ status: 'error', message: expect.stringContaining('required') });
    expect(p.counts).toEqual({ total: 10, ok: 2, duplicate: 3, error: 5 });
  });

  it('asks for the one column it needs, and refuses a file that is not a spreadsheet of the right size', async () => {
    expect((await fails(previewImport(db.web, owner, 'customers', 'mobile,city\n1,2'))).message).toMatch(/column called name/);
    expect(await fails(previewImport(db.web, owner, 'customers', ''))).toBeInstanceOf(ValidationError);
    expect(await fails(previewImport(db.web, owner, 'customers', 'name\n"never closed'))).toBeInstanceOf(ValidationError);
    expect(await fails(previewImport(db.web, owner, 'customers', 'name\n' + 'x'.repeat(1_000_001)))).toBeInstanceOf(ValidationError);
    expect((await fails(previewImport(db.web, owner, 'customers', 'name\n' + Array.from({ length: 2001 }, (_, i) => `c${i}`).join('\n')))).message).toMatch(/2001 rows/);
    expect(await fails(previewImport(db.web, owner, 'customers', Array.from({ length: 41 }, (_, i) => `c${i}`).join(',') + '\n'))).toBeInstanceOf(ValidationError);
    expect(await fails(previewImport(db.web, owner, 'vendors' as never, 'name\nx'))).toBeInstanceOf(ValidationError);
  });

  it('imports the good rows once, reports the bad ones, and adds nothing the second time', async () => {
    const csv = customersCsv + '\r\nBroken Row,,Atlantis,,,,,,';
    const r1 = await commitImport(db.web, staff, 'customers', csv);                // staff may import
    expect(r1).toMatchObject({ created: 5, skipped: 0, failed: 1 });
    expect(r1.problems).toEqual([{ line: 7, name: 'Broken Row', message: expect.stringContaining('Atlantis') }]);
    const list = await listParties(db.web, owner, { limit: 100 });
    const asha = list.find((p) => p.name === 'Asha Stores')!;
    expect(asha).toMatchObject({ state_code: '27', gstin: GOOD, email: 'asha@example.com' });
    expect(asha.billing_address).toMatchObject({ line1: '12 Main Road', city: 'Pune', pincode: '411001' });
    expect(list.find((p) => p.name === 'Bimal Traders')).toMatchObject({ state_code: '29', phone: '9000000001' });
    expect(list.find((p) => p.name === 'Dev, "The" Shop')).toBeTruthy();
    expect(list.find((p) => p.name === 'नमस्ते स्टोर्स')).toMatchObject({ state_code: '24' });

    const r2 = await commitImport(db.web, owner, 'customers', csv);
    expect(r2).toMatchObject({ created: 0, skipped: 5, failed: 1 });
    expect((await listParties(db.web, owner, { limit: 100 })).length).toBe(list.length);
    expect((await db.owner`select count(*)::int as n from data_export where kind = 'import_customers'`)[0]!.n).toBe(2);
  });

  it('is for people who can add customers, and does not touch another business', async () => {
    expect(await fails(commitImport(db.web, accountant, 'customers', 'name,state\nZed,Kerala'))).toBeInstanceOf(ForbiddenError);
    expect((await previewImport(db.web, accountant, 'customers', 'name,state\nZed,Kerala')).counts.ok).toBe(1);   // looking is allowed, importing is not
    expect((await commitImport(db.web, other, 'customers', 'name,state\nAsha Stores,Kerala')).created).toBe(1);   // a name only clashes inside one business
    expect((await listParties(db.web, other, { q: 'Asha' })).length).toBe(1);
  });

  it('reads items, with a percent sign or without, a type, and a price', async () => {
    const csv = ['Item,Type,HSN/SAC,UOM,GST %,Selling Price', 'Widget,Goods,8471,NOS,18%,250.50', 'Consulting,Service,998313,HRS,18,2000', 'Bread,,1905,KG,0,40', 'Gadget,product,8517,,12.00,999.99'].join('\n');
    const p = await previewImport(db.web, owner, 'items', csv);
    expect(p.counts).toEqual({ total: 4, ok: 4, duplicate: 0, error: 0 });
    expect(await commitImport(db.web, owner, 'items', csv)).toMatchObject({ created: 4, skipped: 0, failed: 0 });
    const items = await listItems(db.web, owner);
    expect(items.find((i) => i.name === 'Consulting')).toMatchObject({ kind: 'service', hsn_sac: '998313', unit: 'HRS', default_rate_bp: 1800, price_paise: '200000' });
    expect(items.find((i) => i.name === 'Bread')).toMatchObject({ kind: 'goods', default_rate_bp: 0 });
    expect(items.find((i) => i.name === 'Gadget')).toMatchObject({ kind: 'goods', unit: 'NOS', default_rate_bp: 1200, price_paise: '99999' });
    expect(await commitImport(db.web, owner, 'items', csv)).toMatchObject({ created: 0, skipped: 4 });
  });

  it('refuses a GST rate that is not allowed, a bad percentage, a bad type and a bad price', async () => {
    const p = await previewImport(db.web, owner, 'items', ['name,type,gst,price,hsn', 'A,goods,7,10,', 'B,goods,abc,10,', 'C,gadget,18,10,', 'D,goods,18,ten,', 'E,goods,18,10,12', 'F,goods,18,10,12345678'].join('\n'));
    expect(p.rows.map((r) => r.status)).toEqual(['error', 'error', 'error', 'error', 'error', 'ok']);
    expect(p.rows[0]!.message).toContain('not a GST rate Kora allows');
    expect(p.rows[1]!.message).toContain('not a GST percentage');
    expect(p.rows[2]!.message).toContain('goods or service');
  });

  it('takes the protective quote off a cell its own export added, so a file can go out and come back', async () => {
    const csv = `name,state\r\n'=Strange Name,Kerala\r\n'@Handle,Kerala`;
    expect((await commitImport(db.web, owner, 'customers', csv)).created).toBe(2);
    expect((await listParties(db.web, owner, { q: 'Strange' }))[0]!.name).toBe('=Strange Name');
  });

  it('round-trips: a backup exported from one business imports into another', async () => {
    const zip = readStoredZip((await exportBackup(db.web, owner)).buffer);
    const csv = zip.find((e) => e.name === 'customers.csv')!.data.toString('utf8');
    const before = (await listParties(db.web, owner, { limit: 500 })).map((p) => p.name).sort();
    const fresh = await db.owner`insert into app_user (email) values ('fresh@e.test') returning id`;
    const fb = await createBusiness(db.web, fresh[0]!.id as string, { legalName: 'Fresh Co', gstin: g('07', 'AAPFU0939F'), stateCode: '07', registrationType: 'regular' });
    const t = await resolveTenant(db.web, fresh[0]!.id as string, fb);
    const out = await commitImport(db.web, t, 'customers', csv);
    expect(out.failed).toBe(0);
    expect(out.created).toBe(before.length);
    expect((await listParties(db.web, t, { limit: 500 })).map((p) => p.name).sort()).toEqual(before);
  });

  it('imports a few hundred rows without trouble', async () => {
    const csv = 'name,state\n' + Array.from({ length: 300 }, (_, i) => `Bulk Customer ${i},Kerala`).join('\n');
    expect(await commitImport(db.web, owner, 'customers', csv)).toMatchObject({ created: 300, failed: 0 });
  }, 60_000);
});
