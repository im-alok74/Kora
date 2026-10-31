import { describe, expect, it } from 'vitest';
import { checkUpload, scanUpload } from '../src/index.js';

const png = (tail = '') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('some image data'), Buffer.from([0, 0, 0, 0]), Buffer.from('IEND'), Buffer.from([0xae, 0x42, 0x60, 0x82]), Buffer.from(tail, 'latin1')]);
const jpg = (tail = '') => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg data'), Buffer.from([0xff, 0xd9]), Buffer.from(tail, 'latin1')]);
const b64 = (b: Buffer) => b.toString('base64');

describe('scanUpload', () => {
  it('accepts ordinary pictures and PDFs, including a cut-off picture and a PDF that mentions JavaScript on its own', () => {
    expect(scanUpload(png(), 'image/png')).toBeNull();
    expect(scanUpload(jpg(), 'image/jpeg')).toBeNull();
    expect(scanUpload(Buffer.from('%PDF-1.4 plain invoice'), 'application/pdf')).toBeNull();
    expect(scanUpload(Buffer.from('%PDF-1.4 /JavaScript in a form field only'), 'application/pdf')).toBeNull();
    expect(scanUpload(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('rest')]), 'image/png')).toBeNull();
  });
  it('flags the virus-test string anywhere', () => {
    expect(scanUpload(Buffer.from(String.raw`%PDF-1.4 X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`), 'application/pdf')).not.toBeNull();
  });
  it('flags PDFs that launch programs, carry other files, or run a script on opening', () => {
    for (const t of ['%PDF-1.4 /Launch /Win', '%PDF-1.4 /EmbeddedFile /Type', '%PDF-1.4 /RichMedia', '%PDF-1.4 /OpenAction << /S /JavaScript >>']) expect(scanUpload(Buffer.from(t), 'application/pdf'), t).not.toBeNull();
  });
  it('flags a program, an archive, a page or a script hidden after the end of a picture, and a page inside a cut-off one', () => {
    for (const tail of ['MZ\x90\x00 program', 'PK\x03\x04 archive', '<script>alert(1)</script>', '<html><body>x', '%PDF-1.4 other file', '#!/bin/sh\nrm -rf /']) {
      expect(scanUpload(png(tail), 'image/png'), `png ${tail.slice(0, 6)}`).not.toBeNull();
      expect(scanUpload(jpg(tail), 'image/jpeg'), `jpg ${tail.slice(0, 6)}`).not.toBeNull();
    }
    expect(scanUpload(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('<script>x</script>')]), 'image/png')).not.toBeNull();
  });
});

describe('checkUpload uses the scan', () => {
  it('refuses a flagged file with a plain sentence, and still takes a clean one', () => {
    expect(() => checkUpload({ name: 'a.png', type: 'image/png', dataBase64: b64(png('<script>alert(1)</script>')) })).toThrow(/looks unsafe/);
    expect(checkUpload({ name: 'a.png', type: 'image/png', dataBase64: b64(png()) }).name).toBe('a.png');
  });
});

describe('clamScan', async () => {
  const { createServer } = await import('node:net');
  const { clamScan } = await import('../src/index.js');
  // A stand-in for clamd: reads the INSTREAM stream and answers FOUND when it contains "VIRUS", otherwise OK.
  const fake = (reply?: string) => new Promise<{ port: number; close: () => void; seen: () => number }>((resolve) => {
    let bytes = 0;
    const srv = createServer((s) => {
      const parts: Buffer[] = [];
      s.on('data', (c) => { parts.push(c); const all = Buffer.concat(parts); if (all.subarray(-4).equals(Buffer.alloc(4))) { bytes = all.length; s.end(`${reply ?? (all.includes('VIRUS') ? 'stream: Eicar FOUND' : 'stream: OK')}\0`); } });
    }).listen(0, '127.0.0.1', () => resolve({ port: (srv.address() as { port: number }).port, close: () => srv.close(), seen: () => bytes }));
  });
  it('does nothing without CLAMAV_HOST', async () => { expect(await clamScan(Buffer.from('VIRUS'), {})).toBeNull(); });
  it('streams the file to clamd and refuses a found virus, accepts a clean one', async () => {
    const s = await fake();
    const env = { CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(s.port) };
    expect(await clamScan(Buffer.from('clean file'), env)).toBeNull();
    expect(await clamScan(Buffer.from('a VIRUS inside'), env)).not.toBeNull();
    expect(s.seen()).toBeGreaterThan(10);
    s.close();
  });
  it('lets the upload go on when clamd is down, unless CLAMAV_REQUIRED=1', async () => {
    const env = { CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: '1' };
    expect(await clamScan(Buffer.from('x'), env)).toBeNull();
    expect(await clamScan(Buffer.from('x'), { ...env, CLAMAV_REQUIRED: '1' })).toMatch(/paused/);
  });
});
