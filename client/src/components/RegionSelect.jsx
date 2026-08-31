import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { REGION_GROUPS } from '../data/regions.js';

const MENU_MAX_HEIGHT = 340;
const GAP = 6;

const CHEVRON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const SEARCH = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

/**
 * A searchable country picker grouped by continent.
 *
 * A native <select> cannot be typed into, and the list is long enough that
 * scrolling to Uzbekistan is a chore — so this is a listbox with a filter.
 * Keyboard use is kept whole: arrows move, Enter picks, Escape closes, and
 * focus returns to the trigger.
 */
export default function RegionSelect({
  value,
  onChange,
  id,
  disabled = false,
  placeholder = 'Select region',
  compact = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState(null);

  const wrap = useRef(null);
  const menu = useRef(null);
  const search = useRef(null);
  const list = useRef(null);
  const trigger = useRef(null);
  const listId = useId();

  /*
   * The menu is portalled to <body> because the panels it sits inside clip
   * their overflow — an absolutely positioned menu would be cut off at the
   * container edge. Being outside that subtree, it has to be positioned from
   * the trigger's own box instead, and follow it when the page moves.
   */
  const place = useCallback(() => {
    const el = trigger.current;
    if (!el) return;

    const box = el.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - GAP;
    const above = box.top - GAP;
    // Flip upward only when there is genuinely more room there.
    const flip = below < Math.min(MENU_MAX_HEIGHT, 220) && above > below;

    setRect({
      left: box.left,
      width: box.width,
      top: flip ? undefined : box.bottom + GAP,
      bottom: flip ? window.innerHeight - box.top + GAP : undefined,
      maxHeight: Math.min(MENU_MAX_HEIGHT, (flip ? above : below) - 4),
    });
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return REGION_GROUPS;
    return REGION_GROUPS.map((g) => ({
      ...g,
      options: g.options.filter((o) => o.toLowerCase().includes(q)),
    })).filter((g) => g.options.length);
  }, [query]);

  // Flat list of just the selectable rows, which is what the arrows walk.
  const flat = useMemo(() => groups.flatMap((g) => g.options), [groups]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Measured before paint, so the menu never appears in the wrong place first.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    search.current?.focus();

    // The menu lives outside this component's DOM, so "outside" means outside
    // both the trigger and the portalled menu.
    const onPointerDown = (e) => {
      if (wrap.current?.contains(e.target)) return;
      if (menu.current?.contains(e.target)) return;
      setOpen(false);
    };

    // `true` to catch scrolling in any ancestor, not just the window.
    const onScroll = () => place();

    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place]);

  // Keeps the highlighted row in view as the arrows move past the edges.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(option) {
    onChange(option);
    setOpen(false);
    setQuery('');
    trigger.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % flat.length : (i - 1 + flat.length) % flat.length));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[active]) choose(flat[active]);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : flat.length - 1);
    }
  }

  let index = -1;

  return (
    <div className={`region-select${compact ? ' compact' : ''}`} ref={wrap}>
      <button
        id={id}
        ref={trigger}
        type="button"
        className={`region-trigger${open ? ' open' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <span className={value ? '' : 'region-placeholder'}>{value || placeholder}</span>
        {CHEVRON}
      </button>

      {open && rect && createPortal(
        <div
          className="region-menu"
          ref={menu}
          onKeyDown={onKeyDown}
          style={{
            left: rect.left,
            width: Math.max(rect.width, 240),
            // Caps the whole menu, search header included — capping only the
            // option list let the header push the bottom off screen.
            maxHeight: rect.maxHeight,
            ...(rect.top !== undefined ? { top: rect.top } : { bottom: rect.bottom }),
          }}
        >
          <label className="region-search">
            {SEARCH}
            <input
              ref={search}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country…"
              autoComplete="off"
              aria-label="Search country"
              aria-controls={listId}
            />
          </label>

          <div className="region-options" id={listId} role="listbox" ref={list}>
            {flat.length === 0 && <div className="region-empty">No country matches “{query}”.</div>}

            {groups.map((group) => (
              <div key={group.group}>
                <div className="region-group">{group.group}</div>
                {group.options.map((option) => {
                  index += 1;
                  const isActive = index === active;
                  return (
                    <div
                      key={option}
                      role="option"
                      aria-selected={option === value}
                      data-active={isActive}
                      className={`region-option${option === value ? ' selected' : ''}${isActive ? ' active' : ''}`}
                      // mousedown, so the click lands before the outside handler closes us.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(option);
                      }}
                      onMouseEnter={() => setActive(index)}
                    >
                      {option}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
