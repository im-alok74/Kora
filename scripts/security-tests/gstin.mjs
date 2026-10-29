const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function gstin(state = '27', digits4 = '1234') {
  const b = `${state}ZZZZZ${String(digits4).padStart(4, '0')}Z1Z`;
  let t = 0;
  for (let i = 0; i < 14; i++) { const v = C.indexOf(b[i]) * (i % 2 === 0 ? 1 : 2); t += Math.floor(v / 36) + (v % 36); }
  return b + C[(36 - (t % 36)) % 36];
}
