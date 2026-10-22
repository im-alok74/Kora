import type { Metadata } from 'next';
import LegalPage from '../../components/LegalPage';

export const metadata: Metadata = { title: 'Refunds and cancelling', alternates: { canonical: '/refunds' }, description: 'How cancelling a Kora plan and asking for a refund will work.' };

const UPDATED = '22 October 2026';

/** Kora does not charge anyone yet, so this page states the intent and leaves the numbers to be filled in with a lawyer. */
export default function Refunds() {
  return (
    <LegalPage title="Refunds and cancelling" updated={UPDATED}>
      <p>Kora is in early access and does not charge anyone yet. This page explains in plain words how cancelling and refunds are meant to work once paid plans begin. The exact periods and amounts below are marked as placeholders and will be fixed with a lawyer before any charge.</p>

      <h2>Cancelling</h2>
      <p>You can cancel a paid plan at any time from your account. Your plan then runs until the end of the period you have paid for, and after that your business moves to the free plan. You keep access to your records, and you can export your data at any time.</p>

      <h2>Refunds</h2>
      <ul>
        <li>If you were charged by mistake, for example twice for the same period, we will refund the extra charge.</li>
        <li>If you ask within <b>[number of days to be decided]</b> of your first payment on a plan and have not used it much, we intend to refund that payment.</li>
        <li>Charges for a period that has already been used are not usually refunded.</li>
      </ul>
      <p>Where the law gives you a right to a refund, that right stays, whatever this page says.</p>

      <h2>How a refund is paid</h2>
      <p>Refunds go back to the method you paid with. The time it takes to show up depends on your bank or payment provider. <b>[typical number of days to be decided]</b>.</p>

      <h2>Taxes on our own charges</h2>
      <p>Our own invoices to you will show the GST charged. A refund will be matched by a credit note, as with any other invoice.</p>

      <h2>How to ask</h2>
      <p>Write to <a href="mailto:support@kora.example">support@kora.example</a> (replace with your support address before launch) with your business name and the payment you want us to look at.</p>
    </LegalPage>
  );
}
