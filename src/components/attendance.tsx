import Link from "next/link";
import { askAttendance, setAttendance } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { calendarEvent, clockLabel, firstName, googleCalendarUrl, meetingWhen, type Profile, type Team } from "@/lib/coaching";
import { calendarDetails, type Checkin } from "@/lib/checkin";

const TZ = process.env.REMINDER_TIMEZONE;

/** Who's in and who's out for a team's next meeting. Members answer here; the coach can email the team. */
export function MeetingCheckin({ team, label, members, viewer, c }: { team: Team; label: string; members: Profile[]; viewer: Profile; c: Checkin }) {
  const answer = new Map(c.rsvps.map((r) => [r.member_id, r.going]));
  const inList = members.filter((m) => answer.get(m.id) === true);
  const outList = members.filter((m) => answer.get(m.id) === false);
  const waiting = members.filter((m) => !answer.has(m.id));
  const when = meetingWhen(c.meeting, new Date(), TZ);
  const coach = viewer.role === "coach";
  const mine = answer.get(viewer.id);
  const joinUrl = c.url || c.standing.url;
  const cal = calendarEvent(team, c.standing, { title: `${label} meeting`, details: calendarDetails(label, c.standing.url), timeZone: TZ });
  const pct = (n: number) => `${members.length ? (n / members.length) * 100 : 0}%`;

  return (
    <section className="card checkin" id={`meeting-${team}`}>
      <div className="checkin-head">
        <div>
          <h2>{when === "tonight" ? "Tonight's meeting" : `Next meeting: ${when}`}</h2>
          <p className="sub"><b className="in-ink">{inList.length} in</b> · <b className="out-ink">{outList.length} out</b> · {waiting.length} haven&apos;t answered</p>
        </div>
        {joinUrl && <a className="btn sun" href={joinUrl} target="_blank" rel="noopener noreferrer">Join the meeting</a>}
      </div>

      <div className="tally" role="img" aria-label={`${inList.length} in, ${outList.length} out, ${waiting.length} no answer yet`}>
        <i className="in" style={{ width: pct(inList.length) }} />
        <i className="out" style={{ width: pct(outList.length) }} />
      </div>

      {!coach && viewer.team === team && (
        <div className="rsvp-ask">
          <span>Will you be there {when}?</span>
          <form action={setAttendance.bind(null, viewer.id, true)}>
            <button className={`btn rsvp in${mine === true ? " picked" : ""}`} type="submit" aria-pressed={mine === true}>✓ I&apos;m in</button>
          </form>
          <form action={setAttendance.bind(null, viewer.id, false)}>
            <button className={`btn rsvp out${mine === false ? " picked" : ""}`} type="submit" aria-pressed={mine === false}>✕ I&apos;m out</button>
          </form>
        </div>
      )}

      {cal ? (
        <div className="cal-add">
          <span>Every {team} at {clockLabel(c.standing.time)}. Add it to your calendar:</span>
          <a className="btn ghost small" href={googleCalendarUrl(cal)} target="_blank" rel="noopener noreferrer">Google Calendar</a>
          <a className="btn ghost small" href={`/calendar/${team}`}>Apple or Outlook</a>
        </div>
      ) : coach && team !== "Example" && (
        <p className="hint">Set this team&apos;s meeting time on the <Link href="/coach/teams">Teams page</Link> so members can add the meeting to their calendars.</p>
      )}

      <div className="rsvp-cols">
        <Column label="In" kind="in" list={inList} viewer={viewer} />
        <Column label="Out" kind="out" list={outList} viewer={viewer} />
        <Column label="No answer yet" kind="wait" list={waiting} viewer={viewer} />
      </div>

      {coach && (
        <form className="rsvp-send" action={askAttendance.bind(null, team)}>
          <label>
            Meeting link (optional)
            <input className="input" name="meeting_url" type="url" inputMode="url" maxLength={500} defaultValue={c.url || c.standing.url || c.lastUrl} placeholder="https://zoom.us/j/… or https://meet.google.com/…" />
          </label>
          <button className="btn" type="submit" disabled={!waiting.length}>
            {c.askedAt ? `Ask again (${waiting.length} to go)` : "Email the team: are you coming?"}
          </button>
          <span className="hint">
            {c.askedAt
              ? `Asked ${new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ }).format(new Date(c.askedAt))}. Asking again only emails people who haven't answered.`
              : "Each person gets I'm in and I'm out buttons, plus the meeting link."}
          </span>
        </form>
      )}
    </section>
  );
}

function Column({ label, kind, list, viewer }: { label: string; kind: "in" | "out" | "wait"; list: Profile[]; viewer: Profile }) {
  return (
    <div className={`rsvp-col ${kind}`}>
      <div className="label">{label} <span>{list.length}</span></div>
      {list.length ? (
        <ul>
          {list.map((m) => (
            <li key={m.id}>
              <Avatar name={m.name} url={m.avatar_url} size={30} />
              <span>{m.id === viewer.id ? "You" : firstName(m.name)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="muted">{kind === "wait" ? "Everyone's answered." : "No one yet."}</p>}
    </div>
  );
}
