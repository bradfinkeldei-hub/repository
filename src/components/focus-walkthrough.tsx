"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveFocus } from "@/app/actions";
import { FOCUS_STEPS, type FocusAnswers, type FocusStep } from "@/lib/focus";

/** The seven questions, counted for the "3 of 7" label. "pick" belongs to question 1. */
const QUESTION: Partial<Record<FocusStep, number>> = { topic: 1, pick: 1, outcome: 2, measure: 3, meaning: 4, start: 5, summary: 6, held: 7 };
const TITLE: Partial<Record<FocusStep, string>> = {
  topic: "Topic", pick: "Topic", outcome: "Outcome", measure: "Measurement", meaning: "Meaning", start: "Starting point", summary: "Check", held: "Accountability",
};

export function FocusWalkthrough({ memberId, firstName, coachName, initial, startAt, doneHref, practice, forCoach }: {
  /** Whose card this is. Empty for your own. */
  memberId: string;
  firstName: string;
  coachName: string;
  initial: FocusAnswers;
  startAt: FocusStep;
  doneHref: string;
  /** The coach trying it out: says so, and nothing reaches the board. */
  practice?: boolean;
  /** The coach filling in a member's answers. */
  forCoach?: boolean;
}) {
  const router = useRouter();
  const [a, setA] = useState<FocusAnswers>({ ...initial, topics: initial.topics.length ? initial.topics : [""] });
  const [step, setStep] = useState<FocusStep>(startAt);
  const [backTo, setBackTo] = useState<FocusStep | null>(null);
  const [error, setError] = useState("");
  const [saving, start] = useTransition();
  const set = <K extends keyof FocusAnswers>(k: K, v: FocusAnswers[K]) => { setA((x) => ({ ...x, [k]: v })); setError(""); };

  const topics = a.topics.map((t) => t.trim()).filter(Boolean);
  const you = forCoach ? firstName : "you";
  const your = forCoach ? `${firstName}'s` : "your";

  function save(next: FocusStep, finish = false, patch: Partial<FocusAnswers> = {}) {
    const answers = { ...a, ...patch, topics, step: FOCUS_STEPS.indexOf(next) };
    if (Object.keys(patch).length) setA((x) => ({ ...x, ...patch }));
    start(async () => {
      const r = await saveFocus(memberId, answers, finish);
      if (!r.ok) { setError(r.error ?? "That didn't save."); return; }
      if (finish) { router.push(doneHref); router.refresh(); return; }
      setStep(next);
      window.scrollTo({ top: 0 });
    });
  }

  /** Where Next goes from each screen, or an error if the answer is still blank. */
  function next() {
    if (backTo && step !== "summary" && step !== "held" && step !== "topic") {
      if (!valid()) return;
      setBackTo(null);
      return save("summary");
    }
    if (!valid()) return;
    const order: Record<FocusStep, FocusStep> = {
      welcome: "topic", topic: topics.length > 1 ? "pick" : "outcome", pick: "outcome", outcome: "measure",
      measure: "meaning", meaning: "start", start: "summary", summary: "held", held: "held",
    };
    if (step === "topic" && topics.length === 1) {
      if (backTo) setBackTo(null);
      return save(backTo ? "summary" : "outcome", false, { focus: topics[0] });
    }
    save(order[step]);
  }

  function back() {
    const order: Partial<Record<FocusStep, FocusStep>> = {
      topic: "welcome", pick: "topic", outcome: topics.length > 1 ? "pick" : "topic", measure: "outcome",
      meaning: "measure", start: "meaning", summary: "start", held: "summary",
    };
    setError("");
    if (backTo) { setBackTo(null); setStep("summary"); return; }
    if (order[step]) setStep(order[step]!);
  }

  function valid() {
    const blank: Partial<Record<FocusStep, boolean>> = {
      topic: !topics.length, pick: !topics.includes(a.focus), outcome: !a.outcome.trim(),
      measure: !a.measure.trim(), meaning: !a.meaning.trim(), start: !a.start_point.trim(), held: !a.held_by.trim(),
    };
    if (blank[step]) { setError("Write an answer to go on."); return false; }
    return true;
  }

  function fix(s: FocusStep) { setBackTo(s); setStep(s); setError(""); }

  const q = QUESTION[step];

  return (
    <div className="walk">
      <div className="walk-top">
        <span>{q ? `${q} of 7 · ${TITLE[step]}` : practice ? "Practice run" : "Welcome"}</span>
        <span className="walk-dots" aria-hidden="true">{[1, 2, 3, 4, 5, 6, 7].map((i) => <i key={i} className={q && i <= q ? "on" : ""} />)}</span>
      </div>
      {practice && <p className="notice walk-practice">You&apos;re trying the questions as the coach. Your answers are saved to your own practice card and don&apos;t show on the board.</p>}
      {forCoach && <p className="notice walk-practice">You&apos;re filling in {firstName}&apos;s answers. They see them on their card.</p>}

      <section className="walk-screen" aria-live="polite">
        {step === "welcome" && (
          <>
            <h1>Welcome to the group{forCoach ? "" : `, ${firstName}`}</h1>
            <p>Before your first meeting, seven short questions help {coachName} and your group understand what you&apos;re here for. Your answers become your card on the Group board.</p>
            <p className="hint">About 5 minutes. Your answers save as you go, so you can stop and finish later.</p>
          </>
        )}

        {step === "topic" && (
          <>
            <h1>What would {you} like to change in {forCoach ? "their" : "your"} life, or create, through being part of this group?</h1>
            <p className="hint">If there&apos;s more than one thing, add each one on its own line.</p>
            <div className="walk-topics">
              {a.topics.map((t, i) => (
                <div className="walk-topic" key={i}>
                  <input className="input" id={`topic-${i}`} aria-label={`Topic ${i + 1}`} value={t} maxLength={300} autoFocus={i === a.topics.length - 1}
                    placeholder={i === 0 ? "e.g. Get more clients for my business" : "Another thing"}
                    onChange={(e) => set("topics", a.topics.map((x, j) => (j === i ? e.target.value : x)))} />
                  {a.topics.length > 1 && (
                    <button type="button" className="walk-remove" aria-label={`Remove topic ${i + 1}`} title="Remove"
                      onClick={() => set("topics", a.topics.filter((_, j) => j !== i))}>×</button>
                  )}
                </div>
              ))}
            </div>
            {a.topics.length < 10 && <button type="button" className="linkish" onClick={() => set("topics", [...a.topics, ""])}>+ Add another</button>}
          </>
        )}

        {step === "pick" && (
          <>
            <h1>{forCoach ? `${firstName} mentioned` : "You mentioned"} {topics.length} things. Which one {forCoach ? "do they" : "do you"} want to focus on for now?</h1>
            <div className="walk-pick" role="radiogroup" aria-label="Pick one to focus on">
              {topics.map((t) => (
                <button type="button" key={t} role="radio" aria-checked={a.focus === t} className={a.focus === t ? "sel" : ""} onClick={() => set("focus", t)}>{t}</button>
              ))}
            </div>
            <p className="hint">The others go on {your} Later list, so nothing gets lost.</p>
          </>
        )}

        {step === "outcome" && (
          <>
            <h1>When it comes to &ldquo;{a.focus}&rdquo;, what would {you} like to have created by the end of our time together?</h1>
            <textarea className="input" id="outcome" rows={3} maxLength={600} value={a.outcome} onChange={(e) => set("outcome", e.target.value)}
              placeholder="e.g. A simple, repeatable way to find new clients" />
          </>
        )}

        {step === "measure" && (
          <>
            <h1>How will {you} know {forCoach ? "they've" : "you've"} achieved that?</h1>
            <p className="hint">Make it a finish line {you} can actually reach. Example: someone wanting to get clients would leave with two ideas.</p>
            <textarea className="input" id="measure" rows={3} maxLength={600} value={a.measure} onChange={(e) => set("measure", e.target.value)} />
          </>
        )}

        {step === "meaning" && (
          <>
            <h1>What will it mean to {forCoach ? "them" : "you"} to have that?</h1>
            <p className="hint">How will having it change {forCoach ? "their" : "your"} life?</p>
            <textarea className="input" id="meaning" rows={4} maxLength={600} value={a.meaning} onChange={(e) => set("meaning", e.target.value)} />
          </>
        )}

        {step === "start" && (
          <>
            <h1>Where should we start to get this outcome?</h1>
            <p className="hint">This also becomes {your} first weekly commitment, so make it something {you} can do before the next meeting.</p>
            <textarea className="input" id="start" rows={3} maxLength={300} value={a.start_point} onChange={(e) => set("start_point", e.target.value)}
              placeholder="e.g. List the people who already know what I do and reach out to five of them" />
          </>
        )}

        {step === "summary" && (
          <>
            <h1>Here&apos;s what I heard</h1>
            <ul className="walk-summary">
              <li><span>{forCoach ? `${firstName} wants` : "You want"} to work on <b>{a.focus}</b>.</span><button type="button" className="linkish" onClick={() => fix(topics.length > 1 ? "pick" : "topic")}>Change</button></li>
              <li><span>{forCoach ? "They want" : "You want"} to create <b>{a.outcome}</b>.</span><button type="button" className="linkish" onClick={() => fix("outcome")}>Change</button></li>
              <li><span>{forCoach ? "They'll" : "You'll"} know {forCoach ? "they've" : "you've"} got it when <b>{a.measure}</b>.</span><button type="button" className="linkish" onClick={() => fix("measure")}>Change</button></li>
            </ul>
            <h2>Do I have that right?</h2>
            {topics.length > 1 && <p className="hint">Saved for later: {topics.filter((t) => t !== a.focus).join(", ")}.</p>}
          </>
        )}

        {step === "held" && (
          <>
            <h1>How {forCoach ? "do they" : "do you"} want to be held accountable for this?</h1>
            <p className="hint">In {forCoach ? "their" : "your"} own words. Example: a text from someone in my group every Friday asking how it went.</p>
            <textarea className="input" id="held" rows={3} maxLength={400} value={a.held_by} onChange={(e) => set("held_by", e.target.value)} />
          </>
        )}

        {error && <p className="walk-error" role="alert">{error}</p>}
      </section>

      <div className="walk-nav">
        {step !== "welcome" && <button type="button" className="btn ghost" onClick={back} disabled={saving}>{backTo ? "Cancel" : "Back"}</button>}
        {step === "summary" ? (
          <button type="button" className="btn" onClick={next} disabled={saving}>Yes, that&apos;s it</button>
        ) : step === "held" ? (
          <button type="button" className="btn" onClick={() => valid() && save("held", true)} disabled={saving}>{saving ? "Building…" : forCoach ? "Save their card" : "Build my card"}</button>
        ) : (
          <button type="button" className="btn" onClick={next} disabled={saving}>{saving ? "Saving…" : step === "welcome" ? "Let's start" : backTo ? "Back to summary" : "Next"}</button>
        )}
      </div>
    </div>
  );
}
