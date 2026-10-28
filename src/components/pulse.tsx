import { firstName, meetingDate, shortDate, teamLabel, type Pulse, type Team, type TeamNames } from "@/lib/coaching";

const pct = (r: number | null) => (r == null ? "–" : `${Math.round(r * 100)}%`);

/** The team's week at a glance: commitments kept, follow-through, streaks and wins. The coach also sees who could use a nudge. */
export function TeamPulse({ team, p, names, ownTeam, coach }: { team: Team; p: Pulse; names?: TeamNames; ownTeam?: boolean; coach?: boolean }) {
  const top = p.streaks[0];
  const open = p.total - p.kept;
  return (
    <section className="card pulse">
      <div>
        <h2>{ownTeam ? "Our week" : `${teamLabel(team, names)} this week`}</h2>
        <p className="sub">How the team is showing up for each other.</p>
      </div>

      <div className="pulse-stats">
        <div className="stat">
          <b>{p.kept} of {p.total}</b>
          <span>commitments checked off</span>
          <div className="meter" role="img" aria-label={`${p.kept} of ${p.total} commitments checked off`}>
            <i style={{ width: `${p.total ? (p.kept / p.total) * 100 : 0}%` }} />
          </div>
          <span className="muted">{p.allDone} of {p.committed} {p.committed === 1 ? "person" : "people"} all done</span>
        </div>
        <div className="stat">
          <b>{pct(p.rate)}</b>
          <span>follow-through, last {p.weeks.length} weeks</span>
          <ol className="bars" aria-hidden="true">
            {p.weeks.map((w) => (
              <li key={w.week} title={`${shortDate(meetingDate(w.week, team))}: ${pct(w.rate)}`}>
                <i style={{ height: w.rate == null ? 0 : `${Math.max(w.rate * 100, 4)}%` }} />
              </li>
            ))}
          </ol>
        </div>
        <div className="stat">
          <b>{top ? <>🔥 {top.weeks}</> : "–"}</b>
          <span>{top ? `weeks in a row for ${firstName(top.name)}` : "no streaks going yet"}</span>
          {p.streaks.length > 1 && (
            <span className="muted">
              Also on a roll: {p.streaks.slice(1, 4).map((s) => `${firstName(s.name)} ${s.weeks}`).join(", ")}
              {p.streaks.length > 4 ? ` +${p.streaks.length - 4}` : ""}
            </span>
          )}
        </div>
      </div>

      {(p.kudos > 0 || p.milestones.length > 0) && (
        <div className="pulse-wins">
          <span className="label">Worth celebrating</span>
          <ul>
            {p.kudos > 0 && <li>👏 <b>{p.kudos}</b> kudos given this week</li>}
            {p.milestones.slice(0, 3).map((m, i) => <li key={i}>⭐ <b>{firstName(m.name)}</b> {m.title}</li>)}
          </ul>
        </div>
      )}

      {coach ? (
        p.nudges.length > 0 && (
          <div className="pulse-nudge">
            <span className="label">Could use a nudge · only you see this</span>
            <ul>{p.nudges.map((n) => <li key={n.id + n.why}>{n.why}</li>)}</ul>
          </div>
        )
      ) : open > 0 && (
        <p className="pulse-cheer">{open} {open === 1 ? "commitment is" : "commitments are"} still open this week. A kudos goes a long way.</p>
      )}
    </section>
  );
}
