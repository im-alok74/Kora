import { Composition } from 'remotion';
import { KoraInvoice, TOTAL } from './Video';

export const Root = () => (
  <Composition id="KoraInvoice" component={KoraInvoice} durationInFrames={TOTAL} fps={30} width={1080} height={1920} />
);
