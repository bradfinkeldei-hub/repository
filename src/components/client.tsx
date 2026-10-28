"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

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

/** unrated: the area has no score yet, and nothing is sent for it until the slider is moved. */
export function RangeField({ name, label, initial, unrated }: { name: string; label: string; initial: number; unrated?: boolean }) {
  const [v, setV] = useState(initial);
  const [touched, setTouched] = useState(!unrated);
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" name={touched ? name : undefined} min={1} max={10} value={v} onChange={(e) => { setV(Number(e.target.value)); setTouched(true); }} style={{ accentColor: "var(--accent)", opacity: touched ? 1 : 0.35 }} />
      <output style={{ fontWeight: 700, textAlign: "right" }}>{touched ? v : "–"}</output>
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

/** Picks a photo, crops it square, shrinks it to 320px and uploads it. */
export function PhotoPicker({ userId, hasPhoto, save, remove }: {
  userId: string;
  hasPhoto: boolean;
  save: (path: string) => Promise<{ error?: string }>;
  remove: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const blob = await squareJpeg(file, 320);
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await createClient().storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const res = await save(path);
      if (res.error) setError(res.error);
    } catch {
      setError("That photo didn't upload. Try a different one.");
    }
    setBusy(false);
  }
  return (
    <div className="row">
      <label className="btn ghost small" style={{ cursor: busy ? "wait" : "pointer" }}>
        {busy ? "Uploading…" : hasPhoto ? "Change photo" : "Add a photo"}
        <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {hasPhoto && !busy && <button className="linkbtn" type="button" onClick={() => { setBusy(true); remove().finally(() => setBusy(false)); }}>Remove photo</button>}
      {error && <span className="hint" role="alert" style={{ color: "var(--alert)" }}>{error}</span>}
    </div>
  );
}

async function squareJpeg(file: File, size: number): Promise<Blob> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85));
}

/** The account menu in the header. Closes on a pick, a tap outside, or Escape. */
export function Menu({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", close); };
  }, []);
  return (
    <details className="menu" ref={ref}>
      <summary aria-label="Account menu">{label}<span className="caret" aria-hidden="true" /></summary>
      <div className="menu-list" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) ref.current!.open = false; }}>{children}</div>
    </details>
  );
}


/** Up to three commitment fields: one to start, with a button to add the others. */
export function CommitmentFields({ initial, max }: { initial: string[]; max: number }) {
  const [list, setList] = useState(initial.length ? initial : [""]);
  return (
    <div className="commit-fields">
      {list.map((v, i) => (
        <div key={i} className="commit-field">
          <input type="text" name="commitment" defaultValue={v} maxLength={200} aria-label={`Commitment ${i + 1}`}
            placeholder={i === 0 ? "e.g. Work out 4 mornings this week" : "e.g. Read 20 pages a night"} />
          {i > 0 && <button className="linkbtn" type="button" onClick={() => setList(list.filter((_, j) => j !== i))}>Remove</button>}
        </div>
      ))}
      {list.length < max && (
        <button className="btn ghost small" type="button" style={{ alignSelf: "flex-start" }} onClick={() => setList([...list, ""])}>+ Add another commitment</button>
      )}
    </div>
  );
}
