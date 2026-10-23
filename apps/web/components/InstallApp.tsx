'use client';
import { useEffect, useState } from 'react';

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type Os = 'windows' | 'mac' | 'android' | 'ios' | 'other';

function detect(): Os {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac/i.test(ua)) return 'mac';
  return 'other';
}

/** "Install from your browser": the one-click install where the browser offers it, and the right steps where it does not. Also marks the card for this device. */
export default function InstallApp() {
  const [os, setOs] = useState<Os>('other');
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const o = detect();
    setOs(o);
    const cards = document.querySelectorAll<HTMLElement>(`[data-os="${o}"]`);
    cards.forEach((el) => el.classList.add('mine'));
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as Prompt); };
    const onInstalled = () => { setDone(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone) setDone(true);
    // Visitors should be able to install before signing in; do not warm private pages here.
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { cards.forEach((el) => el.classList.remove('mine')); window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setMessage(choice.outcome === 'accepted' ? 'Installation requested. Your browser will finish setting up Kora.' : 'Installation cancelled. You can still use Kora in your browser.');
    } catch {
      setMessage('Installation could not start. Use the install option in your browser menu, or continue in your browser.');
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }

  if (done) return <p className="ok" role="status">Kora is installed on this device. Open it from your apps or your home screen.</p>;
  if (prompt) return <button type="button" className="btn" disabled={busy} onClick={() => void install()}>{busy ? 'Opening installer…' : 'Install Kora on this device'}</button>;
  if (message) return <p role="status">{message} <a href="/app">Open Kora</a></p>;
  if (os === 'ios') return <p className="muted">On an iPhone or iPad, open this site in Safari, tap the Share button, then <b>Add to Home Screen</b>.</p>;
  if (os === 'mac') return <p className="muted">In Safari, choose <b>File, then Add to Dock</b>. In Chrome or Edge, use the install icon at the right end of the address bar.</p>;
  return <p className="muted">Look for the install icon at the right end of the address bar in Chrome or Edge, or open the browser menu and choose <b>Install Kora</b>.</p>;
}
