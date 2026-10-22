import type { Metadata } from 'next';
import LegalPage from '../../components/LegalPage';

export const metadata: Metadata = { title: 'Terms of use', alternates: { canonical: '/terms' }, description: 'The terms on which Kora is offered.' };

const UPDATED = '20 October 2026';

/** Plain-language terms. A lawyer should review and adapt them before launch. */
export default function Terms() {
  return (
    <LegalPage title="Terms of use" updated={UPDATED}>

      <h2>What Kora is</h2>
      <p>Kora is software for issuing GST documents, collecting payments, keeping purchase and expense records, and preparing data for your accountant. It prepares documents and return data. It does not file returns, it does not give tax or legal advice, and it does not replace your accountant. You, with the professionals who advise you, remain responsible for every document you issue and every return you file.</p>

      <h2>Your account</h2>
      <p>You sign in with a mobile number or email and a one-time code, and you can add an authenticator app for a second step. Keep your devices and codes private. You are responsible for what is done through your account, including by people you add to your business. Tell us at once if you think someone else has got in.</p>

      <h2>Your data</h2>
      <p>The invoices, customers, items and records you put into Kora belong to you. We use them only to run the service for you, as described in the <a href="/privacy">privacy policy</a>. You can export your data at any time from the Data page. Issued invoices and the activity log cannot be edited or deleted, because the law expects those records to stay as they were.</p>

      <h2>What you agree to</h2>
      <ul>
        <li>Give correct information about your business and your customers.</li>
        <li>Use Kora only for lawful business. Do not issue false or fake invoices, and do not use Kora to claim tax credit you are not entitled to.</li>
        <li>Do not try to reach another business&rsquo;s data, to overload the service, or to find weaknesses without our written permission.</li>
        <li>Only send messages to people you are allowed to contact. You are the sender of the invoices and reminders you send, and you are responsible for their content and for any consent they need.</li>
      </ul>

      <h2>Third-party services</h2>
      <p>Kora can use other companies to send messages, take payments and talk to the GST system. Those services have their own terms, and they can be unavailable. When one of them fails, Kora shows you what happened and tries again where it is safe to do so. We are not responsible for the actions of the GST portal, banks, payment gateways or messaging companies.</p>

      <h2>Availability and changes</h2>
      <p>We work to keep Kora available and your data safe, and we take backups, but we cannot promise it will never be interrupted or free of mistakes. Features, limits and prices may change. If we change something that affects you materially, we will tell you before it takes effect. Prices, where they apply, will be shown before you pay.</p>

      <h2>Limits on our responsibility</h2>
      <p>To the extent the law allows, Kora is provided as it is, and we are not liable for indirect or consequential loss, for lost profits, or for penalties or interest that result from a return, invoice or payment made with data that was wrong. Our total liability for any claim is limited to the amount you paid us for the service in the three months before the claim. Nothing here limits liability that the law does not allow to be limited.</p>

      <h2>Ending your use</h2>
      <p>You can stop using Kora at any time and export your data first. You can close your own account from the Security page; a business that has no owner left needs an owner to close it. We may suspend an account that breaks these terms or puts others at risk. Records the law requires us to keep may be kept after an account is closed.</p>

      <h2>Law and disputes</h2>
      <p>These terms are governed by the laws of India. Courts in the city where our registered office is have exclusive jurisdiction, unless the law gives you the right to go elsewhere.</p>

      <h2>Contact</h2>
      <p>Questions about these terms: <a href="mailto:support@kora.example">support@kora.example</a> (replace with your support address before launch).</p>
    </LegalPage>
  );
}
