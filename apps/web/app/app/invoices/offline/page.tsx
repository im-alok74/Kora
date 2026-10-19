'use client';
import { useEffect, useState } from 'react';
import DocumentEditor from '../../../../components/DocumentEditor';

/** Opens a draft that lives on this device. A fixed path, so the offline copy of the page works for every draft. */
export default function OfflineDraft() {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => { setId(new URLSearchParams(window.location.search).get('d')); }, []);
  if (id === undefined) return <p className="muted">Loading</p>;
  if (!id) return <p className="error" role="alert">No draft was chosen. Go back to the list.</p>;
  return <DocumentEditor localId={id} />;
}
