// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from './ColorPicker';

function Harness({ onChange = vi.fn() }: { onChange?: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return <><ColorPicker color="#8b5cf6" label="Team 1" open={open} onToggle={() => setOpen((value) => !value)} onClose={() => setOpen(false)} onChange={onChange} /><button>Outside</button></>;
}

describe('ColorPicker', () => {
  it('closes on outside pointer and Escape', () => {
    render(<Harness />); const trigger = screen.getByRole('button', { name: 'Team 1 color' });
    fireEvent.click(trigger); expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('selects a swatch and closes', () => {
    const onChange = vi.fn(); render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Team 1 color' })); fireEvent.click(screen.getByRole('button', { name: 'Select #14b8a6' }));
    expect(onChange).toHaveBeenCalledWith('#14b8a6'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
