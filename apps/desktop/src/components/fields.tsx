import { useEffect, useState, type ReactNode } from 'react';

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field" title={hint}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/**
 * A number input that only commits valid numbers, so typing "-" or "1." mid-edit doesn't
 * clobber the value. Commits on every valid keystroke so previews update live.
 */
export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  placeholder,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    if (value === undefined) setText('');
    else if (Number(text) !== value) setText(String(value));
    // Only resync when the external value changes.
  }, [value]);
  return (
    <span className="num">
      <input
        type="number"
        value={text}
        placeholder={placeholder}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onChange(v);
        }}
      />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel">
      <header>
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}
