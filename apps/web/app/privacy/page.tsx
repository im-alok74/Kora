import type { Metadata } from 'next';
import LegalPage from '../../components/LegalPage';
import { PRIVACY_EMAIL, PRIVACY_IS_PLACEHOLDER } from '../../lib/contact';

export const metadata: Metadata = { title: 'Privacy policy', alternates: { canonical: '/privacy' }, description: 'What data Kora keeps, why, and who can see it.' };

const UPDATED = '20 October 2026';

/** Written to match what the software actually does. A lawyer should review and adapt it before launch. */
export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated={UPDATED}>
      <p>This explains what Kora keeps about you and the people you do business with, why, and who can see it. For the data you enter about your customers, you decide what goes in and Kora processes it on your behalf.</p>

      <h2>What we keep</h2>
      <ul>
        <li><b>Your sign-in details:</b> your mobile number or email, when you signed in, and which devices are signed in (the network address and browser description). One-time codes are kept only as a one-way hash and are deleted when they expire or are used.</li>
        <li><b>Your business records:</b> the business name, GSTIN, address and bank or UPI details you enter; and the customers, vendors, items, invoices, payments, expenses, purchase bills, matters, files and notes you create or receive.</li>
        <li><b>Records of what happened:</b> an activity log of changes made in your business, and a security log of sign-ins and changes to your sign-in methods, so you can see them.</li>
        <li><b>Technical records:</b> error reports and server logs, which do not contain passwords, codes or the contents of your documents.</li>
      </ul>
      <p>We use only the cookies Kora needs: one to keep you signed in and one to remember which of your businesses you are working in. We do not use advertising or tracking cookies.</p>

      <h2>Why we use it</h2>
      <p>To run Kora for you: to sign you in, to make and send your documents, to take and match payments, to prepare reports and return data, to keep your records safe, and to keep the service secure. We do not sell your data and we do not use it for advertising.</p>

      <h2>Who can see it</h2>
      <ul>
        <li><b>People you add to your business</b>, with the access their role gives them. An owner can make a matter private to chosen people.</li>
        <li><b>Another business on Kora</b>, only in these cases: an invoice you issue to a customer whose GSTIN belongs to a Kora business is delivered to that business, and a business you choose to list shows its name, GSTIN, city, description and chosen catalogue items to other Kora businesses. Nothing else about your business is shared.</li>
        <li><b>Companies that help us run Kora</b>, only for the purpose: hosting and database services, message and email delivery, payment gateways, the GST system through a GST partner, error reporting and file storage.</li>
        <li><b>Authorities</b>, where the law requires it.</li>
      </ul>

      <h2>Where it is kept and how it is protected</h2>
      <p>Data is kept in a managed database with encryption in transit. Each business&rsquo;s records are separated from every other business&rsquo;s by the database itself. Authenticator secrets and API keys are stored in protected form. Backups are encrypted. No system is perfectly safe; if we learn of a breach that affects you we will tell you and the authorities as the law requires.</p>

      <h2>Your rights under the Digital Personal Data Protection Act</h2>
      <p>Signed in, open <a href="/app/privacy">Privacy</a> in the menu. There you can:</p>
      <ul>
        <li><b>Give or withdraw your consent</b> for each optional use of your data (product news by email, account alerts by SMS and WhatsApp). Withdrawing is as easy as giving, and it takes effect straight away.</li>
        <li><b>Get a copy of your data</b> as a file, and see which businesses and devices are linked to you.</li>
        <li><b>Ask us to correct or erase your personal data</b>, make a complaint, or <b>name another person</b> to exercise your rights if you die or cannot. We answer within 30 days, and the page shows each request and when the answer is due.</li>
        <li><b>Close your account</b> from <a href="/app/security">Security</a>. It removes your number, email and sign-in details at once.</li>
      </ul>
      <p>Invoices and related records are tax records. Indian law expects them to be kept for several years, so they stay with the business that issued them, without a link to your personal details after you close your account. We tell you plainly when a request cannot be met for that reason.</p>

      <h2>How long we keep it</h2>
      <p>Sign-in codes and sessions are removed after they expire. The security log is kept while your account is open. Finished background jobs and delivery records are removed after 30 to 180 days. Consent records are kept for as long as the law may need us to show them. When you close your account, your personal details are erased as described above.</p>

      <h2>If something goes wrong</h2>
      <p>If personal data is lost or exposed, we keep a record of it, tell the Data Protection Board of India and the people affected as the law requires, and say what we are doing about it.</p>

      <h2>Children</h2>
      <p>Kora is for businesses and is not meant for anyone under 18. We do not knowingly keep the personal data of children. If you believe a child has an account, write to the address below and we will remove it.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we will tell you in the app before it takes effect.</p>

      <h2>Contact and complaints</h2>
      <p>Privacy questions and complaints: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>{PRIVACY_IS_PLACEHOLDER ? ' (replace with your grievance officer’s address before launch)' : ''}. If you are not satisfied, you may complain to the Data Protection Board of India under the Digital Personal Data Protection Act, 2023.</p>
    </LegalPage>
  );
}
