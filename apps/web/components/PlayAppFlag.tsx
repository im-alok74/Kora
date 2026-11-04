'use client';
import { useEffect } from 'react';
import { capturePlayApp } from '../lib/playApp';

/** Remembers that this session is the Google Play app (see lib/playApp.ts). Renders nothing. */
export default function PlayAppFlag() {
  useEffect(capturePlayApp, []);
  return null;
}
