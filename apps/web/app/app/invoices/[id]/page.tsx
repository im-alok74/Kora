'use client';
import LateFeePanel from '../../../../components/LateFeePanel';
import EwayPanel from '../../../../components/EwayPanel';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { formatMoney } from '@kora/tax';
import { api, DOC_LABEL, rupees } from '../../../../lib/client';

type Doc = Record<string, any>;
const RECEIVABLE = ['tax_invoice', 'bill_of_supply', 'debit_note'];
const EST_LABEL: Record<string, string> = { draft: 'Draft', open: 'Open', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', invoiced: 'Invoiced', cancelled: 'Cancelled' };
const EST_CHIP: Record<string, string> = { draft: 'draft', open: 'issued', accepted: 'paid', declined: 'cancelled', expired: 'cancelled', invoiced: 'paid', cancelled: 'cancelled' };
const METHODS: [string, string][] = [['cash', 'Cash'], ['upi', 'UPI'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['card', 'Card'], ['netbanking', 'Net banking'], ['tds', 'TDS deducted by customer'], ['other', 'Other']];

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<{ document: Doc; lines: Doc[]; deliveries: Doc[]; estimate?: Doc | null } | null>(null);
  const [html, setHtml] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState('whatsapp');
  const [to, setTo] = useState('');
  const [link, setLink] = useState('');
  const [payLink, setPayLink] = useState('');
  const [views, setViews] = useState(0);
  const [kora, setKora] = useState<{ buyer: string; status: string; sellerCancelled: boolean; reason: string | null } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [role, setRole] = useState('');
  const [payments, setPayments] = useState<Doc[]>([]);
  const [files, setFiles] = useState<Doc[]>([]);
  const [held, setHeld] = useState('0');
  const [notes, setNotes] = useState<{ id: string; body: string; createdAt: string; author: string; mine: boolean }[]>([]);
  const [note, setNote] = useState('');
  const [pay, setPay] = useState({ amount: '', method: 'cash', receivedOn: '', note: '' });
  const toTyped = useRef(false);
  const amountTyped = useRef(false); // a refresh must never overwrite what the user is typing
  const [einv, setEinv] = useState<{ current: Doc | null; history: Doc[] } | null>(null);
  const [fix, setFix] = useState({ gstin: '', name: '', line1: '', city: '', pincode: '' });
  const [cancelE, setCancelE] = useState({ open: false, reason: '2', remark: '' });

  const load = useCallback(async () => {
    const d = await api(`/api/documents/${id}`);
    setData(d);
    setHtml((await api(`/api/documents/${id}/html`)).html);
    api(`/api/documents/${id}/files`).then((r) => setFiles(r.files)).catch(() => {});
    api(`/api/documents/${id}/comments`).then((r) => setNotes(r.comments)).catch(() => {});
    if (d.document.party_id && d.document.status === 'issued') api(`/api/parties/${d.document.party_id}/credit`).then((r) => setHeld(r.totalPaise)).catch(() => {});
    if (d.document.einvoice_status && d.document.einvoice_status !== 'none') setEinv(await api(`/api/documents/${id}/einvoice`));
    if (d.document.status !== 'draft') {
      setViews((await api(`/api/documents/${id}/share`)).stats.views);
      api(`/api/documents/${id}/network`).then((r) => setKora(r.delivery)).catch(() => {});
      if (RECEIVABLE.includes(d.document.doc_type)) {
        setPayments((await api(`/api/documents/${id}/payments`)).payments);
        const o = BigInt(d.document.grand_total_paise) - BigInt(d.document.amount_settled_paise);
        if (!amountTyped.current) setPay((p) => ({ ...p, amount: o > 0n ? `${o / 100n}.${(o % 100n).toString().padStart(2, '0')}` : '' }));
      }
    }
    return d;
  }, [id]);

  useEffect(() => {
    load().then(async (d) => {
      if (d.document.party_id) {
        const p = (await api(`/api/parties/${d.document.party_id}`)).party;
        if (!toTyped.current) setTo((p.phone ?? '').toString());
      }
    }).catch((e) => setErr(e.message));
    api('/api/business').then((b) => setRole(b.role));
    const why = new URLSearchParams(window.location.search).get('payfail');
    if (why) setErr(`The invoice was issued, but recording the payment did not work: ${why}. Record it below.`);
  }, [load]);

  // While the worker is registering the e-invoice, keep the screen current.
  const waiting = data?.document.einvoice_status === 'pending' || data?.document.einvoice_status === 'registering';
  useEffect(() => {
    if (!waiting) return;
    const h = setInterval(() => { void load(); }, 2000);
    return () => clearInterval(h);
  }, [waiting, load]);

  const run = async (fn: () => Promise<void>) => {
    setErr(''); setMsg(''); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  /** The worker sends in the background. Wait for the result so the person sees it. */
  const waitForDelivery = async (deliveryId: string) => {
    setMsg('Sending');
    for (let i = 0; i < 60; i++) {
      const d = await api(`/api/deliveries/${deliveryId}`);
      if (d.status === 'sent') { setMsg(`Sent by ${channel}.`); await load(); return; }
      if (d.status === 'failed') { setMsg(''); setErr(`Could not send: ${d.error_message}`); await load(); return; }
      if (d.error_message && i > 2) setMsg(`Not sent yet (${d.error_message}). Trying again automatically.`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setMsg('Still sending in the background. It will show under Send history when it goes through.');
    await load();
  };

  if (!data) return <p className="muted">{err || 'Loading'}</p>;
  const d = data.document;
  const label = DOC_LABEL[d.doc_type];
  const foreignCur = d.currency && d.currency !== 'INR' ? (d.currency as string) : null;
  const money = (p: string | bigint) => (foreignCur ? formatMoney(BigInt(p), foreignCur) : rupees(p));
  const isDraft = d.status === 'draft', isIssued = d.status === 'issued';
  const canIssue = role === 'owner' || role === 'staff';
  const receivable = RECEIVABLE.includes(d.doc_type);
  const est = d.doc_type === 'estimate' ? (data.estimate ?? null) : null;
  const estAnswerable = !!est && isIssued && !['invoiced', 'expired'].includes(est.status);
  const outstanding = isIssued && receivable ? BigInt(d.grand_total_paise) - BigInt(d.amount_settled_paise) : 0n;
  const today = new Date().toISOString().slice(0, 10);
  const lateDays = d.due_date && d.due_date < today ? Math.round((Date.parse(today) - Date.parse(d.due_date)) / 86_400_000) : 0;
  const sentOk = data.deliveries.some((x) => x.status === 'sent');
  const steps: { name: string; note: string; done: boolean }[] = [
    { name: 'Created', note: d.doc_date, done: true },
    { name: 'Issued', note: isDraft ? 'Not yet' : (d.number ?? ''), done: !isDraft },
    { name: 'Sent', note: sentOk ? 'Delivered' : 'Not sent yet', done: sentOk },
    { name: 'Viewed', note: views > 0 ? `Opened ${views} time${views === 1 ? '' : 's'}` : 'Not opened yet', done: views > 0 },
    ...(receivable ? [{ name: 'Paid', note: d.payment_status === 'paid' ? 'In full' : d.payment_status === 'part_paid' ? 'Part paid' : 'Waiting', done: d.payment_status === 'paid' }] : []),
  ];

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb"><a href="/app/invoices">Documents</a><span aria-hidden="true">/</span><span aria-current="page">{label} {d.number ?? ''}</span></nav>
      <div className="doc-head">
        <div>
          <h1>{label} {d.number ?? ''}</h1>
          {d.subject && <p className="doc-subject">{d.subject}</p>}
          <div className="meta">
          {est ? <span className={`chip ${EST_CHIP[est.status] ?? 'issued'}`} data-testid="estimate-status">{EST_LABEL[est.status] ?? est.status}</span> : (
          <span className={`chip ${d.status === 'issued' && d.payment_status === 'paid' ? 'paid' : d.status}`}>
            {d.status === 'draft' ? 'Draft' : d.status === 'cancelled' ? 'Cancelled' : d.payment_status === 'paid' ? 'Paid' : d.payment_status === 'part_paid' ? 'Part paid' : 'Issued'}</span>)}
          <span className="muted">{d.party_name ?? 'Walk-in customer'} · {d.doc_date}{d.reference ? ` · PO ${d.reference}` : ''}{foreignCur ? ` · ${money(d.grand_total_paise)} at 1 ${foreignCur} = Rs ${(Number(d.exchange_rate_micro) / 1_000_000).toString()}` : ''}{est && d.due_date ? ` · valid until ${d.due_date}` : ''}</span>
          </div>
        </div>
        {(isDraft || d.status === 'cancelled' || !receivable) && (
          <div className="doc-amount">
            <div className="big">{money(d.grand_total_paise)}</div>
          </div>
        )}
        <div className="row doc-actions">
          <a className="btn secondary" href="/app/invoices">Back</a>
          {isDraft && canIssue && <a className="btn secondary" href={`/app/invoices/${id}/edit`}>Edit</a>}
          {isDraft && canIssue && <button disabled={busy} onClick={() => run(async () => { await api(`/api/documents/${id}/issue`, { body: {} }); await load(); setMsg(`${label} issued.`); })}>Issue</button>}
          {isDraft && canIssue && <button className="danger" disabled={busy} onClick={() => run(async () => { await api(`/api/documents/${id}`, { method: 'DELETE' }); window.location.href = '/app/invoices'; })}>Delete draft</button>}
          {estAnswerable && canIssue && est!.decision !== 'accepted' && <button className="secondary" disabled={busy} onClick={() => run(async () => { await api(`/api/documents/${id}/estimate`, { body: { action: 'accept' } }); await load(); setMsg('Marked as accepted.'); })}>Mark accepted</button>}
          {estAnswerable && canIssue && est!.decision !== 'declined' && <button className="secondary" disabled={busy} onClick={() => run(async () => { await api(`/api/documents/${id}/estimate`, { body: { action: 'decline' } }); await load(); setMsg('Marked as declined.'); })}>Mark declined</button>}
          {estAnswerable && canIssue && est!.status !== 'declined' && <button disabled={busy} onClick={() => run(async () => { const r = await api(`/api/documents/${id}/estimate`, { body: { action: 'convert' } }); window.location.href = `/app/invoices/${r.id}/edit`; })}>Convert to invoice</button>}
          {est?.converted_to_id && <a className="btn secondary" href={`/app/invoices/${est.converted_to_id}`}>View invoice {est.converted_number ?? '(draft)'}</a>}
          {canIssue && !['credit_note', 'debit_note'].includes(d.doc_type) && <button className="secondary" disabled={busy} onClick={() => run(async () => { const r = await api(`/api/documents/${id}/duplicate`, { body: {} }); window.location.href = `/app/invoices/${r.id}/edit`; })}>Duplicate</button>}
          <a className="btn secondary" href={`/api/documents/${id}/pdf`} target="_blank" rel="noreferrer">Download PDF</a>
        </div>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {kora && <p className="muted" data-testid="kora-delivery" style={{ margin: '0 0 12px' }}>Sent through Kora to {kora.buyer}: {kora.sellerCancelled ? 'you cancelled it' : kora.status === 'new' ? 'waiting for them to accept' : kora.status === 'accepted' ? 'they accepted it' : `they rejected it${kora.reason ? ` (${kora.reason})` : ''}`}.</p>}

      {!isDraft && d.status !== 'cancelled' && receivable && (
        <div className="doc-stats" aria-label="Amounts">
          <div><span className="k">Total</span><b>{money(d.grand_total_paise)}</b></div>
          <div><span className="k">Received</span><b className="good">{rupees(d.amount_settled_paise)}</b></div>
          <div className={outstanding > 0n ? 'owing' : ''}><span className="k">Balance due</span><b>{rupees(outstanding)}</b></div>
          <div><span className="k">Due date</span><b>{d.due_date ?? 'On receipt'}</b>{lateDays > 0 && outstanding > 0n && <span className="late">{lateDays} day{lateDays === 1 ? '' : 's'} late</span>}</div>
        </div>
      )}
      {d.status !== 'cancelled' && (
        <ol className="timeline" aria-label="Progress">
          {steps.map((st) => <li key={st.name} className={st.done ? 'done' : ''}><span className="dot" aria-hidden="true" /><b>{st.name}</b><span className="muted">{st.note}</span></li>)}
        </ol>
      )}

      <div className="doc-layout">
        <div className="paper-stage">
  <iframe className="preview" title="Document preview" sandbox="" srcDoc={html} />
        </div>
        <div className="doc-side">
      {isIssued && ['tax_invoice', 'bill_of_supply'].includes(d.doc_type) && outstanding > 0n && <LateFeePanel invoiceId={id} canWrite={canIssue} />}
      {d.einvoice_status && d.einvoice_status !== 'none' && einv?.current && (
        <div className="panel" data-testid="einvoice">
          <h2>E-invoice</h2>
          {(d.einvoice_status === 'pending' || d.einvoice_status === 'registering') && (
            <p role="status"><b>Registering with the GST portal.</b> This invoice is not legally complete until the IRN arrives.
              {einv.current.error_message ? ` The portal did not answer (${einv.current.error_message}). Trying again automatically.` : ''}</p>
          )}
          {d.einvoice_status === 'registered' && (
            <>
              <p className="ok"><b>Registered.</b> The IRN and QR code are printed on the invoice.</p>
              <p style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>IRN {einv.current.irn}<br />Ack no {einv.current.ack_no} · {new Date(einv.current.ack_date).toLocaleString('en-IN')}</p>
              {isIssued && new Date(einv.current.cancel_deadline) > new Date() && role === 'owner' && (
                <>
                  <p className="muted">You can cancel this e-invoice until {new Date(einv.current.cancel_deadline).toLocaleString('en-IN')}. After that, correct it with a credit note.</p>
                  <button className="danger" onClick={() => setCancelE({ ...cancelE, open: !cancelE.open })}>Cancel e-invoice</button>
                  {cancelE.open && (
                    <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/documents/${id}/einvoice/cancel`, { body: { reason: cancelE.reason, remark: cancelE.remark } }); await load(); setMsg('E-invoice and invoice cancelled.'); }); }}>
                      <div className="row">
                        <div><label htmlFor="cr">Reason</label><select id="cr" value={cancelE.reason} onChange={(e) => setCancelE({ ...cancelE, reason: e.target.value })}><option value="1">Duplicate</option><option value="2">Data entry mistake</option><option value="3">Order cancelled</option><option value="4">Other</option></select></div>
                        <div><label htmlFor="crm">Remark</label><input id="crm" maxLength={100} value={cancelE.remark} onChange={(e) => setCancelE({ ...cancelE, remark: e.target.value })} required /></div>
                        <button className="danger" style={{ flex: 'none' }} disabled={busy}>Confirm cancellation</button>
                      </div>
                    </form>
                  )}
                </>
              )}
              {isIssued && new Date(einv.current.cancel_deadline) <= new Date() && <p className="muted">The 24-hour window to cancel has passed. To correct this invoice, raise a credit note.</p>}
            </>
          )}
          {(d.einvoice_status === 'rejected') && (
            <>
              <p className="error" role="alert"><b>Not registered.</b> This invoice is not legally complete as an e-invoice yet.</p>
              <ul className="plain">{(einv.current.problems ?? []).map((pr: Doc, i: number) => (
                <li key={i} style={{ display: 'block' }}><b>{pr.message}</b><br /><span className="muted">{pr.fix}</span></li>))}</ul>
              {canIssue && (
                <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
                  const body = Object.fromEntries(Object.entries(fix).filter(([, v]) => v.trim() !== ''));
                  if (Object.keys(body).length) await api(`/api/documents/${id}/einvoice/correct`, { body });
                  await api(`/api/documents/${id}/einvoice/resubmit`, { body: {} });
                  setFix({ gstin: '', name: '', line1: '', city: '', pincode: '' });
                  await load(); setMsg('Resubmitted. Registering again.');
                }); }}>
                  <h3>Correct the buyer's details, then resubmit</h3>
                  <p className="muted">Fill only what needs to change. The state cannot change; if it is wrong, cancel this invoice and issue a new one.</p>
                  <div className="row">
                    <div><label htmlFor="fg">Buyer GSTIN</label><input id="fg" maxLength={15} value={fix.gstin} onChange={(e) => setFix({ ...fix, gstin: e.target.value })} /></div>
                    <div><label htmlFor="fn">Buyer legal name</label><input id="fn" value={fix.name} onChange={(e) => setFix({ ...fix, name: e.target.value })} /></div>
                  </div>
                  <div className="row">
                    <div><label htmlFor="fl">Address line 1</label><input id="fl" value={fix.line1} onChange={(e) => setFix({ ...fix, line1: e.target.value })} /></div>
                    <div><label htmlFor="fc">City</label><input id="fc" value={fix.city} onChange={(e) => setFix({ ...fix, city: e.target.value })} /></div>
                    <div><label htmlFor="fp">Pincode</label><input id="fp" inputMode="numeric" maxLength={6} value={fix.pincode} onChange={(e) => setFix({ ...fix, pincode: e.target.value })} /></div>
                  </div>
                  <button disabled={busy}>Resubmit e-invoice</button>
                </form>
              )}
            </>
          )}
          {einv.history.length > 0 && <p className="muted">{einv.history.length} earlier attempt{einv.history.length === 1 ? '' : 's'}.</p>}
        </div>
      )}

      {isIssued && ['tax_invoice', 'bill_of_supply', 'delivery_challan'].includes(d.doc_type) && <EwayPanel documentId={id} canWrite={canIssue} />}

      {isIssued && receivable && (
        <div className="panel">
          <h2>Payments</h2>
          {payments.length > 0 && (
            <table className="t" style={{ marginBottom: 12 }}>
              <thead><tr><th>Date</th><th>Method</th><th className="n">Applied</th><th>Note</th><th /></tr></thead>
              <tbody>{payments.map((p) => (
                <tr key={p.allocation_id}><td>{p.received_on ?? ''}</td>
                  <td>{p.credit_note_number ? `Credit note ${p.credit_note_number}` : p.gateway ? `${p.method} via ${p.gateway}` : p.method}</td>
                  <td className="n">{rupees(p.allocated_paise)}</td><td>{p.note ?? ''}</td>
                  <td className="n">{p.payment_id && <a href={`/api/payments/${p.payment_id}/receipt`} target="_blank" rel="noreferrer">Receipt</a>} {role === 'owner' && p.payment_id && !p.gateway && <button className="link" onClick={() => run(async () => { await api(`/api/payments/${p.payment_id}`, { method: 'DELETE' }); await load(); })}>Remove</button>}</td></tr>))}</tbody>
            </table>
          )}
          {outstanding > 0n ? (
            <>
              <p><b>{rupees(outstanding)}</b> still due.</p>
              {canIssue && BigInt(held) > 0n && (
                <p><button className="secondary" style={{ marginTop: 0 }} disabled={busy} onClick={() => run(async () => { const r = await api(`/api/documents/${id}/apply-credit`, { body: {} }); await load(); setMsg(`Applied Rs ${r.applied} held for this customer.`); })}>
                  Apply {rupees(BigInt(held) < outstanding ? held : outstanding)} held for this customer</button></p>)}
              {canIssue && (
                <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/documents/${id}/payments`, { body: { amount: pay.amount, method: pay.method, receivedOn: pay.receivedOn || undefined, note: pay.note || undefined } }); amountTyped.current = false; await load(); setMsg('Payment recorded.'); }); }}>
                  <div className="row">
                    <div><label htmlFor="pa">Amount received (Rs)</label><input id="pa" inputMode="decimal" value={pay.amount} onChange={(e) => { amountTyped.current = true; setPay({ ...pay, amount: e.target.value }); }} required /></div>
                    <div><label htmlFor="pm">Method</label><select id="pm" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                    <div><label htmlFor="pd">Date received</label><input id="pd" type="date" value={pay.receivedOn} onChange={(e) => setPay({ ...pay, receivedOn: e.target.value })} /></div>
                    <div><label htmlFor="pn">Note</label><input id="pn" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
                    <button style={{ flex: 'none' }} disabled={busy}>Record payment</button>
                  </div>
                </form>
              )}
              {canIssue && (
                <div className="row" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
                  <button className="secondary" style={{ flex: 'none' }} disabled={busy} onClick={() => run(async () => { const r = await api(`/api/documents/${id}/payment-link`, { body: {} }); setPayLink(r.url); })}>Create payment link</button>
                  <button className="secondary" style={{ flex: 'none' }} disabled={busy} onClick={() => run(async () => { const r = await api(`/api/documents/${id}/remind`, { body: { channel, to } }); await waitForDelivery(r.deliveryId); })}>Send reminder</button>
                </div>
              )}
              {payLink && <p className="muted" style={{ wordBreak: 'break-all' }}>Payment link: <a href={payLink} target="_blank" rel="noreferrer">{payLink}</a></p>}
            </>
          ) : <p className="ok">Fully paid.</p>}
        </div>
      )}

      {isIssued && canIssue && (
        <div className="panel">
          <h2>Send</h2>
          <div className="row">
            <div><label htmlFor="ch">Send by</label>
              <select id="ch" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></select></div>
            <div><label htmlFor="to">{channel === 'email' ? 'Email address' : 'Mobile number'}</label>
              <input id="to" value={to} onChange={(e) => { toTyped.current = true; setTo(e.target.value); }} /></div>
            <button style={{ flex: 'none' }} disabled={busy} onClick={() => run(async () => {
              const r = await api(`/api/documents/${id}/send`, { body: { channel, to } });
              await waitForDelivery(r.deliveryId);
            })}>Send</button>
            <button className="secondary" style={{ flex: 'none' }} disabled={busy} onClick={() => run(async () => {
              const r = await api(`/api/documents/${id}/share`, { body: {} }); setLink(r.url);
              try { await navigator.clipboard.writeText(r.url); setMsg('Link copied.'); } catch { setMsg('Link created.'); }
            })}>Copy link</button>
          </div>
          {link && <p className="muted" style={{ wordBreak: 'break-all' }}>{link}</p>}
          <p className="muted">Opened {views} time{views === 1 ? '' : 's'} by the customer.</p>
          {data.deliveries.length > 0 && (
            <>
              <h3>Send history</h3>
              <ul className="plain">{data.deliveries.map((x) => (
                <li key={x.id}><span>{x.channel} to {x.to_address}</span><span className={x.status === 'failed' ? 'error' : 'muted'}>{x.status}{x.error_message ? `: ${x.error_message}` : ''}</span></li>))}</ul>
            </>
          )}
        </div>
      )}

      <div className="panel" aria-label="Team notes">
        <h2>Team notes</h2>
        <p className="muted">Notes for the people in your business. The customer never sees them.</p>
        {notes.length > 0 && (
          <ul className="plain notes">{notes.map((n) => (
            <li key={n.id}><div><b>{n.author}</b> <span className="muted">{new Date(n.createdAt).toLocaleString('en-IN')}</span><p>{n.body}</p></div>
              {(n.mine || role === 'owner') && canIssue && <button className="link" aria-label={`Remove the note by ${n.author}`} onClick={() => run(async () => { await api(`/api/documents/${id}/comments/${n.id}`, { method: 'DELETE' }); await load(); })}>Remove</button>}</li>))}</ul>)}
        {canIssue && (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/documents/${id}/comments`, { body: { body: note } }); setNote(''); await load(); }); }}>
            <label htmlFor="tn">Add a note</label>
            <textarea id="tn" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: customer promised to pay on Friday" />
            <button disabled={busy || !note.trim()}>Add note</button>
          </form>)}
      </div>

      {d.status !== 'cancelled' && (
        <div className="panel" aria-label="Attachments">
          <h2>Attachments</h2>
          <p className="muted">Supporting files for your team, such as a purchase order or a signed quote. JPEG, PNG or PDF, up to 2 MB each, at most three.</p>
          {files.length > 0 && (
            <ul className="plain">{files.map((f) => (
              <li key={f.id}><a href={`/api/documents/${id}/files/${f.id}`} target="_blank" rel="noreferrer">{f.file_name}</a>
                <span className="muted">{Math.max(1, Math.round(Number(f.size_bytes) / 1024))} KB {canIssue && <button className="link" onClick={() => run(async () => { await api(`/api/documents/${id}/files/${f.id}`, { method: 'DELETE' }); await load(); })} aria-label={`Remove ${f.file_name}`}>Remove</button>}</span></li>))}</ul>)}
          {canIssue && files.length < 3 && (
            <><label htmlFor="af">Add a file</label>
              <input id="af" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                void run(async () => {
                  const data = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => bad(new Error('The file could not be read.')); r.readAsDataURL(f); });
                  await api(`/api/documents/${id}/files`, { body: { name: f.name, type: f.type, data } });
                  await load(); setMsg('File attached.');
                });
              }} /></>)}
        </div>
      )}

      {isIssued && canIssue && ['tax_invoice', 'bill_of_supply'].includes(d.doc_type) && (
        <div className="panel">
          <h2>Correct this invoice</h2>
          <p className="muted">An issued invoice cannot be edited. Raise a note against it instead.</p>
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            {(['credit_note', 'debit_note'] as const).map((k) => (
              <button key={k} className="secondary" style={{ flex: 'none' }} disabled={busy} onClick={() => run(async () => {
                const r = await api(`/api/documents/${id}/note`, { body: { kind: k } }); window.location.href = `/app/invoices/${r.id}/edit`;
              })}>Start a {(DOC_LABEL[k] ?? k).toLowerCase()}</button>))}
            {role === 'owner' && <button className="danger" style={{ flex: 'none' }} onClick={() => setCancelling((v) => !v)}>Cancel this invoice</button>}
          </div>
          {cancelling && (
            <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/documents/${id}/cancel`, { body: { reason } }); setCancelling(false); await load(); }); }}>
              <label htmlFor="rs">Reason for cancelling</label>
              <input id="rs" value={reason} onChange={(e) => setReason(e.target.value)} required />
              <button className="danger" disabled={busy}>Confirm cancellation</button>
              <p className="muted">The number stays used. If the customer has already paid, raise a credit note instead.</p>
            </form>
          )}
        </div>
      )}
        </div>
      </div>
      {d.status === 'cancelled' && <p className="muted">Cancelled: {d.cancel_reason}</p>}

    </>
  );
}
