import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { IconChevronDown } from './icons';
import styles from './SearchableSelect.module.scss';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  options: ReadonlyArray<SearchableSelectOption>;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  id?: string;
}

const VIEWPORT_MARGIN = 8;
const DROPDOWN_OFFSET = 6;
const DROPDOWN_MAX_HEIGHT = 280;
const DROPDOWN_Z_INDEX = 2010;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const tokenize = (query: string): string[] =>
  query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const matchesQuery = (option: SearchableSelectOption, tokens: string[]): boolean => {
  if (tokens.length === 0) return true;
  const haystack = `${option.label} ${option.value}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
};

const resolveDropdownStyle = (element: HTMLElement): CSSProperties => {
  const rect = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(Math.max(rect.width, 180), Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2));
  const left = clamp(
    rect.left,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
  );
  const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN - DROPDOWN_OFFSET;
  const spaceAbove = rect.top - VIEWPORT_MARGIN - DROPDOWN_OFFSET;
  const direction = spaceBelow >= DROPDOWN_MAX_HEIGHT || spaceBelow >= spaceAbove ? 'down' : 'up';
  const maxHeight = Math.max(
    0,
    Math.min(DROPDOWN_MAX_HEIGHT, direction === 'down' ? spaceBelow : spaceAbove)
  );

  return direction === 'down'
    ? {
        position: 'fixed',
        top: rect.bottom + DROPDOWN_OFFSET,
        left,
        width,
        maxHeight,
        zIndex: DROPDOWN_Z_INDEX,
      }
    : {
        position: 'fixed',
        bottom: viewportHeight - rect.top + DROPDOWN_OFFSET,
        left,
        width,
        maxHeight,
        zIndex: DROPDOWN_Z_INDEX,
      };
};

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder = 'Type to filter…',
  emptyMessage = 'No matches',
  className,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  fullWidth = true,
  size = 'md',
  id,
}: SearchableSelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const listboxId = `${selectId}-listbox`;
  const searchId = `${selectId}-search`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);
  const isOpen = open && !disabled;

  const tokens = useMemo(() => tokenize(query), [query]);
  const filteredOptions = useMemo(() => {
    // Always keep the empty "All" option visible so users can clear without
    // wiping the search box first.
    const emptyOptions = options.filter((option) => option.value === '');
    const matched = options.filter(
      (option) => option.value !== '' && matchesQuery(option, tokens)
    );
    return tokens.length === 0 ? options.slice() : [...emptyOptions, ...matched];
  }, [options, tokens]);

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value]
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const displayText = selected?.label ?? placeholder ?? '';
  const isPlaceholder = !selected && Boolean(placeholder);

  const resolvedHighlightedIndex =
    highlightedIndex >= 0 && highlightedIndex < filteredOptions.length
      ? highlightedIndex
      : filteredOptions.length > 0
        ? Math.max(
            0,
            filteredOptions.findIndex((option) => option.value === value)
          )
        : -1;

  useEffect(() => {
    if (!open || disabled) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
      setHighlightedIndex(-1);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [disabled, open]);

  const updateDropdownStyle = useCallback(() => {
    if (!wrapRef.current) return;
    setDropdownStyle(resolveDropdownStyle(wrapRef.current));
  }, []);

  const scheduleDropdownStyleUpdate = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateDropdownStyle();
    });
  }, [updateDropdownStyle]);

  useLayoutEffect(() => {
    if (!isOpen) {
      if (rafRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    updateDropdownStyle();

    const handleViewportChange = () => {
      scheduleDropdownStyleUpdate();
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && wrapRef.current
        ? new ResizeObserver(() => {
            scheduleDropdownStyleUpdate();
          })
        : null;

    if (resizeObserver && wrapRef.current) {
      resizeObserver.observe(wrapRef.current);
    }

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      resizeObserver?.disconnect();
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isOpen, scheduleDropdownStyleUpdate, updateDropdownStyle]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setHighlightedIndex((prev) => {
      if (filteredOptions.length === 0) return -1;
      if (prev >= 0 && prev < filteredOptions.length) return prev;
      const selectedFiltered = filteredOptions.findIndex((option) => option.value === value);
      return selectedFiltered >= 0 ? selectedFiltered : 0;
    });
  }, [filteredOptions, isOpen, value]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHighlightedIndex(-1);
  }, []);

  const commitSelection = useCallback(
    (nextIndex: number) => {
      const nextOption = filteredOptions[nextIndex];
      if (!nextOption) return;
      onChange(nextOption.value);
      close();
    },
    [close, filteredOptions, onChange]
  );

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      if (filteredOptions.length === 0) return;
      const base = resolvedHighlightedIndex >= 0 ? resolvedHighlightedIndex : direction > 0 ? -1 : 0;
      const nextIndex = (base + direction + filteredOptions.length) % filteredOptions.length;
      setHighlightedIndex(nextIndex);
    },
    [filteredOptions.length, resolvedHighlightedIndex]
  );

  const handleTriggerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;

      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'Enter':
        case ' ':
          event.preventDefault();
          setOpen(true);
          return;
        case 'Escape':
          if (!isOpen) return;
          event.preventDefault();
          close();
          return;
        default:
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            setOpen(true);
            setQuery(event.key);
          }
          return;
      }
    },
    [close, disabled, isOpen]
  );

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveHighlight(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          moveHighlight(-1);
          return;
        case 'Home':
          if (filteredOptions.length === 0) return;
          event.preventDefault();
          setHighlightedIndex(0);
          return;
        case 'End':
          if (filteredOptions.length === 0) return;
          event.preventDefault();
          setHighlightedIndex(filteredOptions.length - 1);
          return;
        case 'Enter':
          event.preventDefault();
          if (resolvedHighlightedIndex >= 0) {
            commitSelection(resolvedHighlightedIndex);
          }
          return;
        case 'Escape':
          event.preventDefault();
          close();
          wrapRef.current?.querySelector('button')?.focus();
          return;
        case 'Tab':
          close();
          return;
        default:
          return;
      }
    },
    [close, commitSelection, filteredOptions.length, moveHighlight, resolvedHighlightedIndex]
  );

  useEffect(() => {
    if (!isOpen || resolvedHighlightedIndex < 0) return;
    const highlightedOption = document.getElementById(
      `${selectId}-option-${resolvedHighlightedIndex}`
    );
    highlightedOption?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, resolvedHighlightedIndex, selectId]);

  const dropdown =
    isOpen && dropdownStyle ? (
      <div
        ref={dropdownRef}
        className={styles.dropdown}
        style={dropdownStyle}
        role="presentation"
      >
        <div className={styles.searchWrap}>
          <input
            ref={searchRef}
            id={searchId}
            className={styles.searchInput}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-controls={listboxId}
            aria-autocomplete="list"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <div
          className={styles.options}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
        >
          {filteredOptions.length === 0 ? (
            <div className={styles.empty}>{emptyMessage}</div>
          ) : (
            filteredOptions.map((opt, index) => {
              const active = opt.value === value;
              const highlighted = index === resolvedHighlightedIndex;
              return (
                <button
                  key={`${opt.value}::${opt.label}`}
                  id={`${selectId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`${styles.option} ${active ? styles.optionActive : ''} ${highlighted ? styles.optionHighlighted : ''}`.trim()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => commitSelection(index)}
                >
                  {opt.label}
                </button>
              );
            })
          )}
        </div>
      </div>
    ) : null;

  return (
    <>
      <div
        className={`${styles.wrap} ${fullWidth ? styles.wrapFullWidth : ''} ${className ?? ''}`}
        ref={wrapRef}
      >
        <button
          id={selectId}
          type="button"
          className={`${styles.trigger} ${size === 'sm' ? styles.triggerSm : ''}`.trim()}
          onClick={
            disabled
              ? undefined
              : () => {
                  setOpen((prev) => {
                    if (prev) {
                      setQuery('');
                      setHighlightedIndex(-1);
                      return false;
                    }
                    return true;
                  });
                }
          }
          onKeyDown={handleTriggerKeyDown}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={
            isOpen && resolvedHighlightedIndex >= 0
              ? `${selectId}-option-${resolvedHighlightedIndex}`
              : undefined
          }
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
        >
          <span className={`${styles.triggerText} ${isPlaceholder ? styles.placeholder : ''}`}>
            {displayText}
          </span>
          <span className={styles.triggerIcon} aria-hidden="true">
            <IconChevronDown size={14} />
          </span>
        </button>
      </div>
      {dropdown &&
        (typeof document === 'undefined' ? dropdown : createPortal(dropdown, document.body))}
    </>
  );
}
