'use client';
import { useMemo, useState } from 'react';
import { gstinCheckChar } from '@kora/tax';
import { amountToWords } from '../../lib/amountWords';
import { inspectGstin, cleanGstin, type GstinReport } from '../../lib/gstinInfo';
import { CopyButton } from './ToolBits';

const MAX_LIST = 200;
/** A well-formed example for trying the tool. It is built to pass the check and does not belong to any business. */
const EXAMPLE = (() => { const f = '27AAAPL1234C1Z'; return f + gstinCheckChar(f); })();

/** One pasted GSTIN may be typed with spaces ("27 AAAPL1234C 1Z5"); several are split by lines, commas or spaces. */
function splitList(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const parts = t.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) { const one = cleanGstin(parts[0]!); if (one.length <= 15 && /\s/.test(parts[0]!)) return [parts[0]!]; return parts[0]!.split(/\s+/); }
  return parts;
}

function GstinDetail({ r }: { r: GstinReport }) {
  return (
    <>
      <p className={`tl-verdict ${r.valid ? 'ok' : 'bad'}`}>{r.valid ? 'This GSTIN has a valid format and check character.' : 'This GSTIN is not valid.'}</p>
      {!r.valid && <ul className="tl-problems">{r.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {r.gstin.length > 0 && (
        <dl className="doc-totals tl-dl">
          <div><dt>GSTIN</dt><dd><code>{r.gstin}</code></dd></div>
          {r.state && <div><dt>State or territory</dt><dd>{r.state.name} (code {r.state.code})</dd></div>}
          {r.pan && <div><dt>PAN of the holder</dt><dd><code>{r.pan}</code>{r.holder ? `, ${r.holder}` : ''}</dd></div>}
          {r.entity && <div><dt>Registration number for this PAN in the state</dt><dd>{r.entity}{r.entity === '1' ? ' (the first)' : ''}</dd></div>}
          {r.checkChar && <div><dt>Check character</dt><dd>{r.checkChar.found}{r.checkChar.found === r.checkChar.expected ? ' (correct)' : ` (should be ${r.checkChar.expected})`}</dd></div>}
        </dl>
      )}
    </>
  );
}

export function GstinValidator() {
  const [text, setText] = useState('');
  const list = useMemo(() => splitList(text), [text]);
  const reports = useMemo(() => list.slice(0, MAX_LIST).map(inspectGstin), [list]);
  const valid = reports.filter((r) => r.valid).length;
  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="gv">GSTIN (or a list, one per line)</label>
        <textarea id="gv" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="27AAAPL1234C1Z5" autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-describedby="gv-h" />
        <p id="gv-h" className="muted">Paste one GSTIN to see what it says, or many to check them all. Spaces and dashes are ignored.</p>
        <div className="tl-actions">
          <button type="button" className="secondary" onClick={() => setText(EXAMPLE)}>Try an example</button>
          {text && <button type="button" className="secondary" onClick={() => setText('')}>Clear</button>}
        </div>
      </form>
      <div className="tl-result" role="status" aria-live="polite">
        {reports.length === 0 && <p className="muted">Enter a GSTIN to check it.</p>}
        {reports.length === 1 && <GstinDetail r={reports[0]!} />}
        {reports.length > 1 && (
          <>
            <p className="tl-big">{valid} of {list.length}<small>look valid{list.length > MAX_LIST ? `. Only the first ${MAX_LIST} were checked.` : ''}</small></p>
            <div className="tl-tablewrap">
              <table className="tl-table">
                <caption className="sr-only">GSTIN check results</caption>
                <thead><tr><th scope="col">GSTIN</th><th scope="col">Result</th><th scope="col">State</th></tr></thead>
                <tbody>{reports.map((r, i) => <tr key={`${r.gstin}${i}`}><td><code>{r.gstin || list[i]}</code></td><td>{r.valid ? 'Valid' : r.problems[0]}</td><td>{r.state?.name ?? ''}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
        <p className="muted">This checks the format and the check character, the same way Kora does when you save a customer. It cannot tell you whether the number is registered or active. For that, search it on the GST portal.</p>
      </div>
    </div>
  );
}

const CASES = [['asis', 'As written'], ['upper', 'UPPERCASE'], ['lower', 'lowercase']] as const;
export function AmountInWords() {
  const [amount, setAmount] = useState('');
  const [letters, setLetters] = useState<(typeof CASES)[number][0]>('asis');
  const r = useMemo(() => (amount.trim() ? amountToWords(amount) : null), [amount]);
  const en = r?.ok ? (letters === 'upper' ? r.english.toUpperCase() : letters === 'lower' ? r.english.toLowerCase() : r.english) : '';
  return (
    <div className="tl-calc">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="aw">Amount (Rs)</label>
        <div className="tl-money"><span aria-hidden="true">Rs</span><input id="aw" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,25,000.50" autoComplete="off" aria-describedby="aw-h" /></div>
        <p id="aw-h" className="muted">Up to Rs 999 crore, with up to 2 decimals for paise. Commas are fine.</p>
        <div className="tl-chips" aria-label="Examples">
          {['1250', '1,00,000', '12,34,567.89', '5,00,00,000'].map((x) => <button key={x} type="button" className="secondary" onClick={() => setAmount(x)}>{x}</button>)}
        </div>
        <label htmlFor="aw-c">English letters</label>
        <select id="aw-c" value={letters} onChange={(e) => setLetters(e.target.value as typeof letters)}>{CASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </form>
      <div className="tl-result" role="status" aria-live="polite">
        {!r ? <p className="muted">Enter an amount to see it in words.</p> : !r.ok ? <p className="error">{r.error}</p> : (
          <>
            <p className="tl-big">{r.digits}<small>in the Indian system (lakh and crore)</small></p>
            <div className="tl-words">
              <h3>In English</h3><p lang="en">{en}</p><CopyButton text={en} what="the English words" />
            </div>
            <div className="tl-words">
              <h3>In Hindi</h3><p lang="hi">{r.hindi}</p><CopyButton text={r.hindi} what="the Hindi words" />
            </div>
          </>
        )}
        <p className="muted">Uses the same wording as the amount in words on a Kora invoice. Check the Hindi spelling against your own style before printing it on a legal document.</p>
      </div>
    </div>
  );
}
