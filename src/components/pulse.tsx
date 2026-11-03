import { firstName, meetingDate, shortDate, teamLabel, type Pulse, type Team, type TeamNames } from "@/lib/coaching";

const pct = (r: number | null) => (r == null ? "–" : `${Math.round(r * 100)}%`);

/** The team's week at a glance: commitments kept, follow-through, streaks and wins. The coach also sees who could use a nudge. */
export function TeamPulse({ team, p, names, ownTeam, coach }: { team: Team; p: Pulse; names?: TeamNames; ownTeam?: boolean; coach?: boolean }) {
  const top = p.streaks[0];
  const wins = [
    p.kudos > 0 ? <>👏 <b>{p.kudos}</b> kudos</> : null,
    ...p.milestones.slice(0, 2).map((m) => <>⭐ <b>{firstName(m.name)}</b> {m.title}</>),
  ].filter(Boolean);
  return (
    <section className="card pulse">
      <h2>{ownTeam ? "Our week" : `${teamLabel(team, names)} this week`}</h2>

      <div className="pulse-strip">
        <div className="pstat">
          <b>{p.kept}<small>/{p.total}</small></b>
          <span>checked off</span>
          <div className="meter" role="img" aria-label={`${p.kept} of ${p.total} commitments checked off`}>
            <i style={{ width: `${p.total ? (p.kept / p.total) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="pstat">
          <b>{pct(p.rate)}</b>
          <span>follow-through</span>
          <ol className="bars" aria-label={`Follow-through, last ${p.weeks.length} weeks`}>
            {p.weeks.map((w) => (
              <li key={w.week} title={`${shortDate(meetingDate(w.week, team))}: ${pct(w.rate)}`}>
                <i style={{ height: w.rate == null ? 0 : `${Math.max(w.rate * 100, 4)}%` }} />
              </li>
            ))}
          </ol>
        </div>
        <div className="pstat">
          <b>{top ? <>🔥{top.weeks}</> : "–"}</b>
          <span>{top ? `${firstName(top.name)}'s streak` : "no streaks yet"}</span>
        </div>
      </div>

      {wins.length > 0 && (
        <p className="pulse-wins">{wins.map((w, i) => <span key={i}>{w}</span>)}</p>
      )}

      {coach && p.nudges.length > 0 && (
        <details className="pulse-nudge">
          <summary>Could use a nudge ({p.nudges.length}) · only you see this</summary>
          <ul>{p.nudges.map((n) => <li key={n.id + n.why}>{n.why}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
