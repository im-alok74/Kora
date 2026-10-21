'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

const STEPS = [
  { name: 'Create', icon: 'invoice', title: 'A great first impression. Every invoice.', description: 'Add your customer and line items. Kora calculates the tax and puts your business front and centre.' },
  { name: 'Send', icon: 'chat', title: 'From your desk to their inbox.', description: 'Share a polished invoice PDF or a payment link. Keep every customer conversation moving.' },
  { name: 'Receive', icon: 'rupee', title: 'Less chasing. More getting paid.', description: 'Give customers a UPI QR and a clear view of what is due. Track payments in one place.' },
] as const;

function InvoicePaper() {
  return <div className="k-invoice-paper">
    <div className="k-paper-heading"><div><span className="k-studio-logo">a.</span><b>Acme Studio</b><small>Design that makes a difference.</small></div><div><strong>TAX INVOICE</strong><small>#INV-0042</small><span className="k-status">Issued</span></div></div>
    <div className="k-paper-address"><div><small>BILL TO</small><b>Maple & Co.</b><span>Bengaluru, Karnataka</span></div><div><small>INVOICE DATE</small><b>21 Oct 2026</b><span>Due on 28 Oct 2026</span></div></div>
    <table><caption className="sr-only">Illustrative invoice items</caption><thead><tr><th>Item description</th><th>Qty</th><th>Amount</th></tr></thead><tbody><tr><td><b>Brand identity design</b><small>Logo, colours & brand guidelines</small></td><td>1</td><td>₹12,000.00</td></tr><tr><td><b>Social media creatives</b><small>Launch collection · 6 designs</small></td><td>1</td><td>₹4,500.00</td></tr></tbody></table>
    <div className="k-paper-totals"><div><span>Subtotal</span><b>₹16,500.00</b></div><div><span>CGST (9%)</span><span>₹1,485.00</span></div><div><span>SGST (9%)</span><span>₹1,485.00</span></div><div><strong>Total</strong><strong>₹19,470.00</strong></div></div>
    <div className="k-paper-foot"><span>Thank you for your business!</span><span>Made with <b>kora</b></span></div>
  </div>;
}

export default function InvoiceShowcase() {
  const [active, setActive] = useState(0);
  const story = useRef<HTMLDivElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const manualUntil = useRef(0);
  const [scrollDriven, setScrollDriven] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1025px) and (min-height: 720px) and (prefers-reduced-motion: no-preference)');
    const updateMedia = () => setScrollDriven(media.matches);
    updateMedia();
    media.addEventListener('change', updateMedia);
    return () => media.removeEventListener('change', updateMedia);
  }, []);

  useEffect(() => {
    if (!scrollDriven) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!story.current || !sticky.current || performance.now() < manualUntil.current) return;
      const travel = story.current.offsetHeight - sticky.current.offsetHeight;
      const progress = Math.max(0, Math.min(1, (96 - story.current.getBoundingClientRect().top) / Math.max(1, travel)));
      setActive(Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length)));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, [scrollDriven]);

  function selectStep(index: number) {
    setActive(index);
    if (!scrollDriven || !story.current || !sticky.current) return;
    manualUntil.current = performance.now() + 1000;
    const travel = story.current.offsetHeight - sticky.current.offsetHeight;
    // Target the middle of each scroll segment, away from the transition boundary.
    const target = window.scrollY + story.current.getBoundingClientRect().top - 96 + travel * ((index + .5) / STEPS.length);
    window.scrollTo({ top: target, behavior: 'smooth' });
  }

  const step = STEPS[active] ?? STEPS[0];
  return <section className="k-showcase" id="product-preview" aria-labelledby="preview-title">
    <div className="k-section-intro"><h2 id="preview-title">Invoicing, from start to finish</h2><p>Create an invoice, share it with your customer, and track the payment.</p></div>
    <div ref={story} className={`k-scroll-story${scrollDriven ? ' is-scroll-driven' : ''}`}>
    <div ref={sticky} className="k-story-sticky">
    <div className="k-preview-tabs" role="tablist" aria-label="Explore invoicing steps">{STEPS.map((item, i) => <button key={item.name} type="button" role="tab" id={`preview-tab-${i}`} aria-selected={active === i} aria-controls="preview-panel" tabIndex={active === i ? 0 : -1} onClick={() => selectStep(i)} onKeyDown={event => {
      let next: number | undefined;
      if (event.key === 'ArrowRight') next = (i + 1) % STEPS.length;
      if (event.key === 'ArrowLeft') next = (i + STEPS.length - 1) % STEPS.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = STEPS.length - 1;
      if (next !== undefined) { event.preventDefault(); document.getElementById(`preview-tab-${next}`)?.focus({ preventScroll: true }); selectStep(next); }
    }}><Icon name={item.icon} size={19} />{item.name}</button>)}</div>
    <div className={`k-preview-stage k-stage-${active}`} id="preview-panel" role="tabpanel" aria-labelledby={`preview-tab-${active}`} tabIndex={0}>
      <div className="k-preview-copy" key={`copy-${active}`}><h3>{step.title}</h3><p>{step.description}</p><a href="/login?signup=1">Create an invoice <Icon name="arrow" size={18} /></a><small>Illustrative preview · Sample business and figures</small></div>
      <div className="k-app-preview"><div className="k-preview-chrome"><span><i /><i /><i /></span><b>kora <span>/ {active === 0 ? 'Invoices' : active === 1 ? 'Share invoice' : 'Payments received'}</span></b><Icon name="settings" size={15} /></div>
        <div className="k-preview-content" key={active}>
          {active === 0 ? <><div className="k-preview-toolbar"><span>Invoice <b>#INV-0042</b></span><span className="k-preview-tag">Ready to share <Icon name="check" size={12} /></span></div><InvoicePaper /></> : active === 1 ? <div className="k-message-preview"><span className="k-message-avatar"><Icon name="chat" size={30} /></span><h4>Your invoice is ready to go.</h4><p>To: Maple & Co.</p><div className="k-message-bubble"><p>Hello! Here&apos;s your invoice for the brand identity and launch creatives.</p><div><Icon name="invoice" size={32} /><span><b>Invoice INV-0042.pdf</b><small>₹19,470.00 · Due 28 Oct 2026</small></span></div><p>Thank you for choosing Acme Studio.</p></div><span className="k-preview-tag">PDF + payment link <Icon name="check" size={14} /></span></div> : <div className="k-payment-preview"><span className="k-payment-check"><Icon name="check" size={36} /></span><p>Payment received</p><h4>₹19,470.00</h4><span>One more invoice. All taken care of.</span><dl><div><dt>Customer</dt><dd>Maple & Co.</dd></div><div><dt>Invoice</dt><dd>INV-0042</dd></div><div><dt>Payment method</dt><dd>UPI</dd></div><div><dt>Balance due</dt><dd>₹0.00</dd></div></dl><span className="k-preview-tag"><Icon name="check" size={14} /> Matched to your invoice</span></div>}
        </div>
      </div>
    </div>
    </div>
    </div>
    <div className="k-reassurance"><span><Icon name="shield" size={18} />Your business data stays yours</span><span><Icon name="phone" size={18} />At your desk or on the go</span><span><Icon name="percent" size={18} />Built around Indian GST</span></div>
  </section>;
}
