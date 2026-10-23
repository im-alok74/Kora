/** A folded invoice and payment dot: documents moving into settled business. */
export default function KoraLogo() {
  return <span className="kora-logo">
    <svg viewBox="0 0 198 64" role="img" aria-label="Kora" className="kora-logo-vector">
      <g className="kora-document-mark">
        <path d="M14 6H35L49 20V35A18 18 0 0 0 31 53H14A7 7 0 0 1 7 46V13A7 7 0 0 1 14 6Z" fill="#087f78" />
        <path d="M35 6V15A5 5 0 0 0 40 20H49Z" fill="#71d9c4" />
        <path className="kora-ledger-lines" d="M17 27H36M17 35H29M17 43H24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" pathLength="1" />
        <circle className="kora-payment-dot" cx="47" cy="51" r="10" fill="#24b79d" />
      </g>
      {/* Custom rounded lettering stays consistent without a font download. */}
      <g aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path className="kora-wordmark-letter" d="M78 13V49M97 26L79 38M84 35L99 49" />
        <circle className="kora-wordmark-letter" cx="118" cy="37" r="12" />
        <path className="kora-wordmark-letter" d="M141 49V26M141 36Q143 24 154 26" />
        <path className="kora-wordmark-letter" d="M186 26V49M186 37A12 12 0 1 0 162 37A12 12 0 1 0 186 37" />
      </g>
    </svg>
  </span>;
}
