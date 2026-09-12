import { useEffect, useRef, useState } from 'react';

const PALETTE = ['#8b5cf6', '#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#f43f5e', '#ec4899', '#a855f7'];

export function ColorPicker({ color, label, open, onToggle, onClose, onChange }: {
  color: string; label: string; open: boolean; onToggle: () => void; onClose: () => void; onChange: (color: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState(color);
  const valid = /^#[0-9a-f]{6}$/i.test(draft);

  useEffect(() => setDraft(color), [color]);
  useEffect(() => {
    if (!open) return;
    const close = () => { onClose(); requestAnimationFrame(() => triggerRef.current?.focus()); };
    const pointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    const focus = (event: FocusEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', pointer); document.addEventListener('keydown', key); document.addEventListener('focusin', focus);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); document.removeEventListener('focusin', focus); };
  }, [open, onClose]);

  const choose = (value: string) => { onChange(value.toLowerCase()); onClose(); requestAnimationFrame(() => triggerRef.current?.focus()); };
  return <div className="color-picker" ref={rootRef}>
    <button ref={triggerRef} type="button" className="color-trigger" aria-label={`${label} color`} aria-haspopup="dialog" aria-expanded={open} onClick={onToggle} style={{ '--swatch': color } as React.CSSProperties}><span /></button>
    {open && <div className="color-popover" role="dialog" aria-label={`${label} color palette`}>
      <div className="swatch-grid">{PALETTE.map((value) => <button key={value} type="button" className={value.toLowerCase() === color.toLowerCase() ? 'selected' : undefined} aria-label={`Select ${value}`} aria-pressed={value.toLowerCase() === color.toLowerCase()} style={{ '--swatch': value } as React.CSSProperties} onClick={() => choose(value)}><span /></button>)}</div>
      <label>Custom hex<div className="hex-row"><input value={draft} maxLength={7} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && valid) choose(draft); }} aria-invalid={!valid} /><button type="button" disabled={!valid} onClick={() => choose(draft)}>Apply</button></div></label>
    </div>}
  </div>;
}
