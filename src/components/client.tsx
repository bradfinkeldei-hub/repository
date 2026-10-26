"use client";

import { useState, useTransition } from "react";

export function AutoSubmitSelect({ label, value, options, action }: {
  label: string;
  value: string;
  options: [string, string][];
  action: (value: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  return (
    <select
      className="inline-select"
      aria-label={label}
      defaultValue={value}
      disabled={pending}
      onChange={(e) => { const v = e.target.value; start(() => action(v)); }}
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function AutoSubmitCheckbox({ id, label, checked, action }: {
  id: string;
  label: string;
  checked: boolean;
  action: (done: boolean) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  return (
    <input
      type="checkbox"
      id={id}
      aria-label={label}
      defaultChecked={checked}
      disabled={pending}
      onChange={(e) => { const v = e.target.checked; start(() => action(v)); }}
    />
  );
}

export function RangeField({ name, label, initial }: { name: string; label: string; initial: number }) {
  const [v, setV] = useState(initial);
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" name={name} min={1} max={10} value={v} onChange={(e) => setV(Number(e.target.value))} style={{ accentColor: "var(--accent)" }} />
      <output style={{ fontWeight: 700, textAlign: "right" }}>{v}</output>
    </label>
  );
}

export function ReminderFields({ enabled, day }: { enabled: boolean; day: string }) {
  const [on, setOn] = useState(enabled);
  return (
    <>
      <label className="check">
        <input type="checkbox" name="reminder_enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Email me each week to work on my commitment
      </label>
      {on && (
        <label>
          Reminder day
          <select name="reminder_day" defaultValue={day}>
            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => <option key={d}>{d}</option>)}
          </select>
          <span className="hint">Reminders go to the email you sign in with. Only you and your coach can see it.</span>
        </label>
      )}
      {!on && <input type="hidden" name="reminder_day" value={day} />}
    </>
  );
}
