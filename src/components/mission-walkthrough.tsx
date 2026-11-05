"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveMission } from "@/app/actions";
import { isShared, SHARE_IN_GROUP } from "@/lib/focus";

const STEPS = ["welcome", "matters", "difference", "best", "write"] as const;
type Step = (typeof STEPS)[number];

/** A few short questions that lead up to writing a one-sentence mission. Only the mission itself is saved. */
export function MissionWalkthrough({ memberId, firstName, initial, doneHref, forCoach }: {
  memberId: string; firstName: string; initial: string; doneHref: string; forCoach?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initial ? "write" : "welcome");
  const [notes, setNotes] = useState({ matters: "", difference: "", best: "" });
  const [mission, setMission] = useState(initial);
  const [error, setError] = useState("");
  /** They said they already have a mission, so the questions were skipped. */
  const [skipped, setSkipped] = useState(false);
  const [saving, start] = useTransition();
  const i = STEPS.indexOf(step);
  const you = forCoach ? firstName : "you";
  const your = forCoach ? "their" : "your";

  function go(n: number) { setError(""); setStep(STEPS[Math.max(0, Math.min(STEPS.length - 1, n))]); window.scrollTo({ top: 0 }); }
  function next() {
    if (step !== "welcome" && step !== "write" && !notes[step].trim()) { setError("Write an answer to go on, even a few words."); return; }
    go(i + 1);
  }
  function finish() {
    if (!mission.trim()) { setError("Write your mission to save it."); return; }
    start(async () => {
      const r = await saveMission(memberId, mission);
      if (!r.ok) { setError(r.error ?? "That didn't save."); return; }
      router.push(doneHref); router.refresh();
    });
  }
  const note = (k: keyof typeof notes, placeholder: string) => (
    <textarea className="input" rows={3} maxLength={300} value={notes[k]} placeholder={placeholder}
      onChange={(e) => { setNotes((x) => ({ ...x, [k]: e.target.value })); setError(""); }} />
  );

  return (
    <div className="walk">
      <div className="walk-top">
        <span>{i > 0 ? `${i} of 4 · Mission` : "My mission"}</span>
        <span className="walk-dots" aria-hidden="true">{[1, 2, 3, 4].map((d) => <i key={d} className={d <= i ? "on" : ""} />)}</span>
      </div>
      {forCoach && <p className="notice walk-practice">You&apos;re writing {firstName}&apos;s mission. It shows on their card.</p>}

      <section className="walk-screen" aria-live="polite">
        {step === "welcome" && (
          <>
            <h1>Let&apos;s write {forCoach ? `${firstName}'s` : "your"} mission</h1>
            <p>A mission is the bigger why behind everything {you} work on in this group. Three quick questions will help {forCoach ? "them" : "you"} put it into one sentence.</p>
            <p className="hint">About 3 minutes. Only the sentence at the end goes on {your} card.</p>
          </>
        )}
        {step === "matters" && (
          <>
            <h1>What matters most to {forCoach ? "them" : "you"} in life?</h1>
            <p className="hint">A few words is enough. Example: my family, freedom, being honest.</p>
            {note("matters", "Write your own here")}
          </>
        )}
        {step === "difference" && (
          <>
            <h1>Who {forCoach ? "do they" : "do you"} want to make a difference for, and how?</h1>
            <p className="hint">Example: my kids, by showing them it&apos;s never too late to start something new.</p>
            {note("difference", "Write your own here")}
          </>
        )}
        {step === "best" && (
          <>
            <h1>When {forCoach ? "they're" : "you're"} at {your} best, what {forCoach ? "are they" : "are you"} doing?</h1>
            <p className="hint">Example: helping someone solve a problem, outside, with people I love.</p>
            {note("best", "Write your own here")}
          </>
        )}
        {step === "write" && (
          <>
            <h1>{skipped ? `Write ${forCoach ? "their" : "your"} mission` : "Now put it in one sentence"}</h1>
            {(notes.matters || notes.difference || notes.best) && (
              <ul className="walk-summary">
                {notes.matters && <li><span>What matters: <b>{notes.matters}</b></span></li>}
                {notes.difference && <li><span>Making a difference: <b>{notes.difference}</b></span></li>}
                {notes.best && <li><span>At {your} best: <b>{notes.best}</b></span></li>}
              </ul>
            )}
            <div className="walk-examples">
              <span>An example to compare with:</span>
              <ul><li>My mission is to raise kind, brave kids and build a business that gives us freedom.</li></ul>
            </div>
            {skipped && <p className="hint">One or two sentences is plenty. Want help putting it into words? <button type="button" className="linkish" onClick={() => { setSkipped(false); go(1); }}>Answer the three questions</button></p>}
            <textarea className="input" rows={3} maxLength={600} readOnly={isShared(mission)} value={mission} placeholder="My mission is to…"
              onChange={(e) => { setMission(e.target.value); setError(""); }} />
            <label className="walk-share">
              <input type="checkbox" checked={isShared(mission)} onChange={(e) => setMission(e.target.checked ? SHARE_IN_GROUP : "")} />
              <span>I&apos;ll share it in the group <small>(it&apos;s kind of private to me)</small></span>
            </label>
          </>
        )}
        {error && <p className="walk-error" role="alert">{error}</p>}
      </section>

      <div className="walk-nav">
        {i > 0 && <button type="button" className="btn ghost" onClick={() => go(skipped && step === "write" ? 0 : i - 1)} disabled={saving}>Back</button>}
        {step === "welcome" && (
          <button type="button" className="btn ghost" onClick={() => { setSkipped(true); go(STEPS.indexOf("write")); }}>
            {forCoach ? "They already have a mission" : "I already have a mission"}
          </button>
        )}
        {step === "write"
          ? <button type="button" className="btn" onClick={finish} disabled={saving}>{saving ? "Saving…" : forCoach ? "Save their mission" : "Save my mission"}</button>
          : <button type="button" className="btn" onClick={next}>{step === "welcome" ? "Let's start" : "Next"}</button>}
      </div>
    </div>
  );
}
