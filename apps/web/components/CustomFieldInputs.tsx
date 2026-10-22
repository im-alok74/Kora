'use client';

export type CustomDef = { id: string; entity: string; label: string; kind: 'text' | 'number' | 'date' | 'dropdown'; options: string[] | null; show_on_pdf: boolean };

/** One labelled input per custom field, by kind. Answers are kept by field id. Used on documents and on customers. */
export default function CustomFieldInputs({ defs, values, onChange, idPrefix, disabled }: {
  defs: CustomDef[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void; idPrefix: string; disabled?: boolean;
}) {
  if (defs.length === 0) return null;
  const set = (id: string, v: string) => onChange({ ...values, [id]: v });
  return (
    <div className="grid2" data-testid="custom-fields">
      {defs.map((d) => {
        const id = `${idPrefix}-${d.id}`;
        return (
          <div key={d.id}>
            <label htmlFor={id}>{d.label}</label>
            {d.kind === 'dropdown' ? (
              <select id={id} value={values[d.id] ?? ''} disabled={disabled} onChange={(e) => set(d.id, e.target.value)}>
                <option value="">Not set</option>{(d.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input id={id} type={d.kind === 'date' ? 'date' : 'text'} inputMode={d.kind === 'number' ? 'decimal' : undefined} maxLength={200}
                value={values[d.id] ?? ''} disabled={disabled} onChange={(e) => set(d.id, e.target.value)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
