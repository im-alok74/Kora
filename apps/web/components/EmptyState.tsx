import type { ReactNode } from 'react';
import Icon, { type IconName } from './Icon';

/** What a list says when it has nothing in it: what this is, and the one thing to do next. */
export default function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel empty" data-testid="empty-state">
      <Icon name={icon} size={34} style={{ color: 'var(--text-faint)' }} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
