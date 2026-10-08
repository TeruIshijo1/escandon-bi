import { useEffect, useId, useRef, useState } from 'react';
import { areaWash } from './areaColors';

export default function AreaSwitcher({ value, areas, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const id = useId();
  const selected = areas.find(item => item.value === value);

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const closeOutside = event => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, id]);

  const showOptions = () => {
    setActiveIndex(Math.max(0, areas.findIndex(item => item.value === value)));
    setOpen(true);
  };
  const choose = item => {
    onChange(item.value);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const handleKeys = event => {
    if (event.key === 'Tab') { setOpen(false); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    else if (event.key === 'Enter' || event.key === ' ') choose(areas[activeIndex]);
    else if (event.key === 'Home') setActiveIndex(0);
    else if (event.key === 'End') setActiveIndex(areas.length - 1);
    else setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + areas.length) % areas.length);
  };

  return (
    <div className="area-switcher" ref={containerRef}>
      <span id={`${id}-label`} className="area-switcher__label">Área del hospital</span>
      <button
        type="button" ref={triggerRef} className="area-switcher__trigger"
        disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined} aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => open ? setOpen(false) : showOptions()}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); showOptions(); }
        }}
      >
        <span className="area-switcher__value">
          <span className="area-switcher__dot" style={{ background: selected?.color }} aria-hidden="true" />
          <span id={`${id}-value`}>{selected?.label || value}</span>
        </span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div id={`${id}-list`} role="listbox" tabIndex={-1} ref={listRef}
          aria-labelledby={`${id}-label`} aria-activedescendant={`${id}-option-${activeIndex}`}
          className="area-switcher__menu" onKeyDown={handleKeys}>
          {areas.map((item, index) => (
            <div key={item.value} id={`${id}-option-${index}`} role="option"
              aria-selected={value === item.value}
              className={`area-switcher__option${index === activeIndex ? ' is-active' : ''}`}
              style={{ '--option-wash': areaWash(item.color) }}
              onPointerMove={() => setActiveIndex(index)} onClick={() => choose(item)}>
              <span className="area-switcher__dot" style={{ background: item.color }} aria-hidden="true" />
              <span>{item.label}</span>
              {value === item.value && <span className="area-switcher__check" aria-hidden="true">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
