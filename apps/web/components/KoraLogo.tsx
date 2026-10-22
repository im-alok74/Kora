/** Vector shapes let the shared Kora identity animate without moving the wordmark. */
export default function KoraLogo() {
  return <span className="kora-logo">
    <svg viewBox="0 0 240 120" role="img" aria-label="Kora" className="kora-logo-vector">
      <g fill="none" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <g className="kora-logo-shape kora-logo-blue"><path d="M53 24Q59 14 66 24L89 63Q95 73 83 73H36Q24 73 30 63Z" stroke="#0655ed" /></g>
        <g className="kora-logo-shape kora-logo-green"><circle cx="100" cy="48" r="27" stroke="#00ad70" /></g>
        <g className="kora-logo-shape kora-logo-amber"><path d="M133 22Q140 15 147 23L168 45Q175 52 168 59L147 80Q140 87 133 79L113 58Q106 51 113 44Z" stroke="#ffb600" /></g>
        <g className="kora-logo-shape kora-logo-red"><rect x="163" y="26" width="49" height="49" rx="11" transform="rotate(-12 187.5 50.5)" stroke="#ff443e" /></g>
      </g>
      <text x="120" y="113" textAnchor="middle" fill="#111" fontFamily="Arial, Helvetica, sans-serif" fontSize="43" fontWeight="700" letterSpacing="-2">kora</text>
    </svg>
  </span>;
}
