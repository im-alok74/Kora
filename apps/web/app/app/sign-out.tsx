'use client';
import Icon from '../../components/Icon';
import { api } from '../../lib/client';
import { clearLocalData, listDrafts } from '../../lib/offline';

export default function SignOut() {
  return (
    <button className="link" onClick={async () => {
      const waiting = (await listDrafts()).length;
      if (waiting && !window.confirm(`${waiting} draft${waiting === 1 ? ' is' : 's are'} saved on this device and not yet synced. Signing out will delete ${waiting === 1 ? 'it' : 'them'}. Sign out anyway?`)) return;
      await api('/api/auth/logout', { method: 'POST', body: {} });
      await clearLocalData();
      window.location.href = '/';
    }}>
      <Icon name="logout" size={17} />Sign out
    </button>
  );
}
