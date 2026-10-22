import type { Metadata } from 'next';
import LegalPage from '../../components/LegalPage';

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

      <h2>How long we keep it</h2>
      <p>Tax law expects invoices and related records to be kept for several years, so issued documents and the activity log are kept while your business exists on Kora and are not deleted on request. When you close your own account, your sign-in details are removed and the records you created stay in your business without your name or contact details. Files and drafts you delete are removed.</p>

      <h2>Your rights</h2>
      <p>You can see your data in Kora, export it from the Data page, correct it, and close your account from the Security page. You can ask us to explain how your data is handled, to correct it, or to erase what the law allows us to erase, and you can withdraw consent where we rely on it. People whose details a business has entered (for example, its customers) should ask that business first; it is the one who decided to record them.</p>

      <h2>Children</h2>
      <p>Kora is for businesses and is not meant for anyone under 18.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we will tell you in the app before it takes effect.</p>

      <h2>Contact and complaints</h2>
      <p>Privacy questions and complaints: <a href="mailto:privacy@kora.example">privacy@kora.example</a> (replace with your grievance officer&rsquo;s address before launch). If you are not satisfied, you may complain to the Data Protection Board of India under the Digital Personal Data Protection Act, 2023.</p>
    </LegalPage>
  );
}
