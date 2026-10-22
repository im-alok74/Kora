p = 'apps/web/components/DocumentEditor.tsx'
s = open(p, encoding='utf8').read()


def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b, 1)


# ---- history, keyboard helpers and autosave state
rep("  const inFlight = useRef(false);", """  // Undo and redo for the lines table. Quick typing in one box counts as one step; adding, copying, moving and removing lines each count as their own.
  const linesRef = useRef<Line[]>([]);
  const history = useRef<Line[][]>([]);
  const redoStack = useRef<Line[][]>([]);
  const lastEdit = useRef(0);
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; at?: string; msg?: string }>({ kind: 'idle' });
  const serverIdRef = useRef<string | null>(null);
  const baseRevRef = useRef<number | null>(null);
  const autoFlight = useRef(false);
  const lastSaved = useRef('');
  const dragKey = useRef<number | null>(null);
  const inFlight = useRef(false);""")
rep("  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));", """  linesRef.current = lines;
  const change = (fn: (ls: Line[]) => Line[], structural = false) => {
    const now = Date.now();
    if (structural || now - lastEdit.current > 800) { history.current.push(linesRef.current); if (history.current.length > 100) history.current.shift(); }
    lastEdit.current = structural ? 0 : now;
    redoStack.current = [];
    const next = fn(linesRef.current);
    linesRef.current = next;
    setLines(next);
  };
  const undo = () => { const p = history.current.pop(); if (!p) return; redoStack.current.push(linesRef.current); linesRef.current = p; lastEdit.current = 0; setLines(p); };
  const redo = () => { const n = redoStack.current.pop(); if (!n) return; history.current.push(linesRef.current); linesRef.current = n; lastEdit.current = 0; setLines(n); };
  const setLine = (key: number, patch: Partial<Line>) => change((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  /** Moves keyboard focus to a box on a line, once the screen has drawn it. */
  const focusCell = (key: number, col: string) => setTimeout(() => (document.querySelector(`[data-line="${key}"][data-col="${col}"]`) as HTMLElement | null)?.focus(), 0);
  const addLineAfter = (key: number | null) => {
    const fresh = blankLine();
    change((ls) => { const at = key === null ? ls.length : ls.findIndex((l) => l.key === key) + 1; return [...ls.slice(0, at), fresh, ...ls.slice(at)]; }, true);
    focusCell(fresh.key, 'name');
  };
  const duplicateLine = (key: number) => {
    const copy = { ...linesRef.current.find((l) => l.key === key)!, key: seq++ };
    change((ls) => { const at = ls.findIndex((l) => l.key === key) + 1; return [...ls.slice(0, at), copy, ...ls.slice(at)]; }, true);
    focusCell(copy.key, 'name');
  };
  const moveLine = (key: number, by: number, col = 'name') => {
    change((ls) => {
      const from = ls.findIndex((l) => l.key === key), to = from + by;
      if (from < 0 || to < 0 || to >= ls.length) return ls;
      const next = [...ls]; const [m] = next.splice(from, 1); next.splice(to, 0, m!); return next;
    }, true);
    focusCell(key, col);
  };
  const dropLine = (target: number) => {
    const from = dragKey.current; dragKey.current = null;
    if (from === null || from === target) return;
    change((ls) => { const next = [...ls]; const a = next.findIndex((l) => l.key === from); const [m] = next.splice(a, 1); next.splice(next.findIndex((l) => l.key === target), 0, m!); return next; }, true);
  };
  /** Keys inside the lines table: Enter goes down a row (a new one at the end), Ctrl+D copies, Alt+Up and Alt+Down move, Ctrl+Z undoes. */
  const onLinesKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const key = Number(el.getAttribute('data-line')), col = el.getAttribute('data-col') ?? 'name';
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) { e.preventDefault(); redo(); return; }
    if (Number.isNaN(key)) return;
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateLine(key); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveLine(key, e.key === 'ArrowUp' ? -1 : 1, col); return; }
    if (e.key === 'Enter' && !e.shiftKey && !mod && el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox') {
      e.preventDefault();
      const ls = linesRef.current; const at = ls.findIndex((l) => l.key === key);
      if (at === ls.length - 1) addLineAfter(key); else focusCell(ls[at + 1]!.key, col);
    }
  };""")
rep("      discount: l.discount ?? '', taxRateBp: l.taxRateBp, kind: l.kind ?? 'goods', taxInclusive: !!l.taxInclusive })));\n  };", "      discount: l.discount ?? '', taxRateBp: l.taxRateBp, kind: l.kind ?? 'goods', taxInclusive: !!l.taxInclusive })));\n    history.current = []; redoStack.current = [];\n  };")

# ---- rows
a = s.index("          {lines.map((l, i) => {\n            const idx = lines.filter")
b = s.index("        </tbody>\n      </table>\n      <datalist id=\"hsn-list\">")
rows = """          {lines.map((l, i) => {
            const idx = lines.filter((x) => x.name.trim() || x.rate).findIndex((x) => x.key === l.key);
            return (
              <tr key={l.key} draggable onDragStart={(e) => { dragKey.current = l.key; e.dataTransfer.effectAllowed = 'move'; }} onDragOver={(e) => { if (dragKey.current !== null) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); dropLine(l.key); }}>
                <td className="item-cell" data-label="Description"><span className="drag-grip" aria-hidden="true" title="Drag to move this line">⋮⋮</span><input data-line={l.key} data-col="name" aria-label={`Line ${i + 1} description`} placeholder="Item or service" list="items-list" value={l.name} onChange={(e) => pickName(l.key, e.target.value)} />
                  <div className="item-sub"><div className="sub-field"><span aria-hidden="true">HSN/SAC</span><input data-line={l.key} data-col="hsn" aria-label={`Line ${i + 1} HSN or SAC`} inputMode="numeric" list="hsn-list" placeholder="Code or word" value={l.hsnSac} onChange={(e) => { const v = e.target.value.trim(); const hit = HSN_LIST.find((h) => h.code === v); setLine(l.key, hit?.bp !== undefined && !l.itemId ? { hsnSac: v, taxRateBp: hit.bp, kind: hit.kind } : { hsnSac: e.target.value }); }} /></div>
                    <label className="incl"><input type="checkbox" aria-label={`Line ${i + 1} price includes GST`} checked={l.taxInclusive} onChange={(e) => setLine(l.key, { taxInclusive: e.target.checked })} /> price has GST in it</label></div></td>
                <td className="n" data-label="Quantity"><input data-line={l.key} data-col="qty" aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} /></td>
                <td className="n" data-label="Rate"><input data-line={l.key} data-col="rate" aria-label={`Line ${i + 1} rate`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} /></td>
                <td className="n" data-label="Discount"><input data-line={l.key} data-col="disc" aria-label={`Line ${i + 1} discount`} placeholder="Rs or %" inputMode="text" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} /></td>
                <td data-label="GST"><select aria-label={`Line ${i + 1} GST rate`} value={l.taxRateBp} onChange={(e) => setLine(l.key, { taxRateBp: Number(e.target.value) })}>
                  {TAX_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}</select></td>
                <td className="n line-amount" data-label="Amount">{idx >= 0 && totals?.lines[idx]?.total ? rupees(totals.lines[idx]!.total) : ''}</td>
                <td className="line-remove">
                  <button type="button" className="link" aria-label={`Copy line ${i + 1}`} onClick={() => duplicateLine(l.key)}>Copy</button>{' '}
                  <button type="button" className="link" aria-label={`Move line ${i + 1} up`} disabled={i === 0} onClick={() => moveLine(l.key, -1)}>Up</button>{' '}
                  <button type="button" className="link" aria-label={`Move line ${i + 1} down`} disabled={i === lines.length - 1} onClick={() => moveLine(l.key, 1)}>Down</button>{' '}
                  {lines.length > 1 && <button type="button" className="link" aria-label={`Remove line ${i + 1}`} onClick={() => change((ls) => ls.filter((x) => x.key !== l.key), true)}>Remove</button>}</td>
              </tr>
            );
          })}
"""
s = s[:a] + rows + s[b:]
rep("      <table className=\"t line-table\" aria-label=\"Line items\">", "      <div onKeyDown={onLinesKey}>\n      <table className=\"t line-table\" aria-label=\"Line items\" aria-describedby=\"line-keys\">")
rep("      <datalist id=\"hsn-list\">", "      </div>\n      <p className=\"muted\" id=\"line-keys\" data-testid=\"line-keys\">Enter moves down a line, and adds one at the end. Ctrl+D copies a line. Alt with the up or down arrow moves it. Ctrl+Z undoes, Ctrl+Y redoes.\n        {' '}<button type=\"button\" className=\"link\" onClick={undo}>Undo</button> <button type=\"button\" className=\"link\" onClick={redo}>Redo</button></p>\n      <datalist id=\"hsn-list\">")
rep("onClick={() => setLines((ls) => [...ls, blankLine()])}><Icon name=\"plus\" size={16} />Add line</button>", "onClick={() => addLineAfter(null)}><Icon name=\"plus\" size={16} />Add line</button>")
rep("onClick={() => setLines((ls) => [...ls, { ...blankLine(), name: 'Shipping and handling',", "onClick={() => change((ls) => [...ls, { ...blankLine(), name: 'Shipping and handling',")
rep("taxRateBp: shippingRateBp(ls.filter((x) => x.name.trim() || x.rate).map((x) => x.taxRateBp)) }])}>Add shipping charge</button>", "taxRateBp: shippingRateBp(ls.filter((x) => x.name.trim() || x.rate).map((x) => x.taxRateBp)) }], true)}>Add shipping charge</button>")

# ---- autosave
rep("  const label = DOC_LABEL[docType] ?? 'document';", "  const label = DOC_LABEL[docType] ?? 'document';", ) if False else None
rep("  // Live totals. The server is the authority;", """  // Autosave. Once there is something worth keeping, the draft is saved a couple of seconds after the last change and the screen says so.
  // Existing drafts are saved in place; a new one is made on the first save and then updated. Nothing is issued by this.
  const payloadKey = JSON.stringify(payload);
  useEffect(() => { if (serverId) serverIdRef.current = serverId; if (baseRev !== null) baseRevRef.current = baseRev; }, [serverId, baseRev]);
  useEffect(() => { if (ready && !lastSaved.current && (draftId || localIdProp)) lastSaved.current = payloadKey; }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || !online || busy || local?.conflict) return;
    if (payloadKey === lastSaved.current) return;
    if (!payload.lines.some((l) => l.name.trim() && l.rate)) return;
    const h = setTimeout(async () => {
      if (inFlight.current || autoFlight.current) return;
      autoFlight.current = true; setSaveState({ kind: 'saving' });
      try {
        const body = { ...payload, clientRef, ...(baseRevRef.current !== null ? { baseRev: baseRevRef.current } : {}) };
        const r = await api(serverIdRef.current ? `/api/documents/${serverIdRef.current}` : '/api/documents', { method: serverIdRef.current ? 'PUT' : 'POST', body });
        serverIdRef.current = r.id; baseRevRef.current = r.rev ?? baseRevRef.current; setServerId(r.id); if (r.rev !== undefined) setBaseRev(r.rev);
        lastSaved.current = payloadKey;
        setSaveState({ kind: 'saved', at: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) });
      } catch (e) {
        setSaveState({ kind: 'error', msg: e instanceof ApiError && e.status === 409 ? 'This draft was changed on another device.' : (e as Error).message });
      } finally { autoFlight.current = false; }
    }, 2500);
    return () => clearTimeout(h);
  }, [payloadKey, ready, online, busy, local]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live totals. The server is the authority;""")
# save(): wait for an autosave in flight, then use the freshest ids
rep("    if (inFlight.current) return;\n    if (pctToBp(tcsPct)", "    if (inFlight.current) return;\n    for (let i = 0; i < 100 && autoFlight.current; i++) await new Promise((r) => setTimeout(r, 100));\n    if (pctToBp(tcsPct)")
rep("      const body = { ...payload, clientRef, ...(baseRev !== null ? { baseRev } : {}) };\n      let r: any;\n      try {\n        r = await api(serverId ? `/api/documents/${serverId}` : '/api/documents', { method: serverId ? 'PUT' : 'POST', body });", "      const sid = serverIdRef.current ?? serverId, rev = baseRevRef.current ?? baseRev;\n      const body = { ...payload, clientRef, ...(rev !== null ? { baseRev: rev } : {}) };\n      let r: any;\n      try {\n        r = await api(sid ? `/api/documents/${sid}` : '/api/documents', { method: sid ? 'PUT' : 'POST', body });")
# status line next to the title
rep("{!online && <p className=\"warn\" role=\"status\" data-testid=\"offline-note\">", "<p className=\"muted save-status\" role=\"status\" aria-live=\"polite\" data-testid=\"save-status\">{saveState.kind === 'saving' ? 'Saving the draft' : saveState.kind === 'saved' ? `Draft saved at ${saveState.at}` : saveState.kind === 'error' ? `Not saved yet: ${saveState.msg}` : 'The draft saves by itself once you have added an item.'}</p>\n      {!online && <p className=\"warn\" role=\"status\" data-testid=\"offline-note\">")
open(p, 'w', encoding='utf8').write(s)
