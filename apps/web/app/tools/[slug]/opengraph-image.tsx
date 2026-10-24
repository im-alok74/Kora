import { ImageResponse } from 'next/og';
import { TOOLS, toolBySlug } from '../../../lib/tools';

export const alt = 'A free Kora tool';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamicParams = false;
export const generateStaticParams = () => TOOLS.map((t) => ({ slug: t.slug }));

/** One share card per tool: its name and what it does, in the Kora colours, so a link to a tool does not show the generic card. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const t = toolBySlug((await params).slug);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 80, background: '#eaf3fd', color: '#171b20' }}>
        <div style={{ display: 'flex', fontSize: 36, fontWeight: 800, color: '#106cd9' }}>kora  |  Free tool, no signup</div>
        <div style={{ display: 'flex', fontSize: 76, fontWeight: 700, lineHeight: 1.08, marginTop: 28, letterSpacing: -2 }}>{t?.title ?? 'Free business tools'}</div>
        <div style={{ display: 'flex', fontSize: 32, marginTop: 28, color: '#3d464f', lineHeight: 1.35 }}>{t?.summary ?? 'Small tools that run in your browser.'}</div>
        <div style={{ display: 'flex', fontSize: 26, marginTop: 36, color: '#106cd9' }}>Runs in your browser. Nothing is uploaded.</div>
      </div>
    ),
    size,
  );
}
