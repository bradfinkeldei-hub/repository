import { meetingDate, shortDate, type Progress, type ProgressWeek, type Team } from "@/lib/coaching";

const STATUS: Record<ProgressWeek["status"], string> = { done: "Followed through", missed: "Not marked done", open: "This week, still open" };

/** A row of squares, one per meeting week, oldest on the left. */
export function WeekStrip({ p, team, last = 12, small = false }: { p: Progress; team: Team | null; last?: number; small?: boolean }) {
  const weeks = p.weeks.slice(-last);
  if (!weeks.length) return <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>No weeks tracked yet.</p>;
  return (
    <ol className={`strip${small ? " small" : ""}`} aria-label="Meeting by meeting">
      {weeks.map((w) => {
        const label = `${shortDate(meetingDate(w.week, team))}: ${STATUS[w.status]}`;
        return (
          <li key={w.week} className={w.status} title={label}>
            <span className="sr">{label}</span>
            {!small && <small aria-hidden="true">{shortDate(meetingDate(w.week, team)).replace(" ", " ")}</small>}
          </li>
        );
      })}
    </ol>
  );
}

export function StripKey() {
  return (
    <div className="stripkey" aria-hidden="true">
      <span><i className="done" />Followed through</span>
      <span><i className="missed" />Not marked done</span>
      <span><i className="open" />This week</span>
    </div>
  );
}

export function ProgressStats({ p }: { p: Progress }) {
  const rate = p.total ? Math.round((p.done / p.total) * 100) : null;
  return (
    <div className="stats">
      <div className="stat"><b>{p.streak}</b><span>{p.streak === 1 ? "week" : "weeks"} in a row</span></div>
      <div className="stat"><b>{p.best}</b><span>best streak</span></div>
      <div className="stat"><b>{p.done} of {p.total}</b><span>meetings followed through</span></div>
      <div className="stat"><b>{rate == null ? "–" : `${rate}%`}</b><span>follow-through rate</span></div>
    </div>
  );
}

/** The streak line on a teammate's accountability card. */
export function MiniProgress({ p, team }: { p: Progress; team: Team | null }) {
  if (!p.weeks.length) return null;
  return (
    <div className="miniprog">
      <WeekStrip p={p} team={team} last={8} small />
      <span className="muted">{p.streak ? `${p.streak}-week streak` : `${p.done} of ${p.total} done`}</span>
    </div>
  );
}
