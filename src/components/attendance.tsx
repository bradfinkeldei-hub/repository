import Link from "next/link";
import { askAttendance, saveMeetingLink, setAttendance } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { ASSUMED, calendarEvent, clockLabel, firstName, googleCalendarUrl, meetingWhen, zonedTime, zoneLabel, type Profile, type Team } from "@/lib/coaching";
import { YourTime } from "@/components/client";
import { calendarDetails, type Checkin } from "@/lib/checkin";

const TZ = process.env.REMINDER_TIMEZONE;

/**
 * A team's next meeting. Everyone counts as attending unless they mark themselves
 * absent (an attendance row with going = false). The coach can email a reminder.
 */
export function MeetingCheckin({ team, label, members, viewer, c }: { team: Team; label: string; members: Profile[]; viewer: Profile; c: Checkin }) {
  const absent = new Set(c.rsvps.filter((r) => !r.going).map((r) => r.member_id));
  const inList = members.filter((m) => !absent.has(m.id));
  const outList = members.filter((m) => absent.has(m.id));
  const when = meetingWhen(c.meeting, new Date(), TZ);
  const coach = viewer.role === "coach";
  const imOut = absent.has(viewer.id);
  const joinUrl = c.url || c.standing.url;
  const cal = calendarEvent(team, c.standing, { title: `${label} meeting`, details: calendarDetails(label, c.standing.url), timeZone: TZ });
  const pct = (n: number) => `${members.length ? (n / members.length) * 100 : 0}%`;

  return (
    <section className="card checkin" id={`meeting-${team}`}>
      <div className="checkin-head">
        <div>
          <h2>{when === "tonight" ? "Tonight's meeting" : `Next meeting: ${when}`}</h2>
          <p className="sub"><b className="in-ink">{inList.length} attending</b> · <b className="out-ink">{outList.length} absent</b></p>
        </div>
        {joinUrl && <a className="btn sun" href={joinUrl} target="_blank" rel="noopener noreferrer">Join the meeting</a>}
      </div>

      <div className="tally" role="img" aria-label={`${inList.length} attending, ${outList.length} absent`}>
        <i className="in" style={{ width: pct(inList.length) }} />
        <i className="out" style={{ width: pct(outList.length) }} />
      </div>

      {!coach && viewer.team === team && (
        <div className={`rsvp-ask${imOut ? " is-out" : ""}`}>
          {imOut ? (
            <>
              <span>You&apos;re marked absent {when}. Thanks for letting the group know.</span>
              <form action={setAttendance.bind(null, viewer.id, true)}>
                <button className="btn rsvp in" type="submit">✓ I can make it after all</button>
              </form>
            </>
          ) : (
            <>
              <p className="assumed">{ASSUMED}</p>
              <form action={setAttendance.bind(null, viewer.id, false)}>
                <button className="btn rsvp out" type="submit">✕ Mark me absent</button>
              </form>
            </>
          )}
        </div>
      )}

      {cal ? (
        <div className="cal-add">
          <span>
            Every {team} at {clockLabel(c.standing.time)} {zoneLabel(cal.timeZone)}
            <YourTime at={zonedTime(c.meeting, c.standing.time, cal.timeZone).toISOString()} meetingZone={cal.timeZone} />. Add it to your calendar:
          </span>
          <a className="btn ghost small" href={googleCalendarUrl(cal)} target="_blank" rel="noopener noreferrer">Google Calendar</a>
          <a className="btn ghost small" href={`/calendar/${team}`}>Apple or Outlook</a>
        </div>
      ) : coach && team !== "Example" && (
        <p className="hint">Set this team&apos;s meeting time on the <Link href="/coach/teams">Teams page</Link> so members can add the meeting to their calendars.</p>
      )}

      <div className="rsvp-cols two">
        <Column label="Attending" kind="in" list={inList} viewer={viewer} />
        <Column label="Absent" kind="out" list={outList} viewer={viewer} />
      </div>

      {coach && (
        <form className="rsvp-send" action={askAttendance.bind(null, team)}>
          <label>
            Meeting link (optional)
            <input className="input" name="meeting_url" type="url" inputMode="url" maxLength={500} defaultValue={c.url || c.standing.url || c.lastUrl} placeholder="https://zoom.us/j/… or https://meet.google.com/…" />
          </label>
          <div className="rsvp-btns">
            <button className="btn" type="submit" disabled={!inList.length}>
              {c.askedAt ? "Send the reminder again" : "Email the team a reminder"}
            </button>
            <button className="btn ghost" type="submit" formAction={saveMeetingLink.bind(null, team)} formNoValidate>Save link</button>
          </div>
          <label className="save-link">
            <input type="checkbox" name="save_link" defaultChecked={!c.standing.url || (c.url || c.lastUrl) === c.standing.url} />
            Use this link for future meetings too
          </label>
          <span className="hint">
            {c.askedAt
              ? `Reminded ${new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ }).format(new Date(c.askedAt))}. `
              : ""}
            The reminder goes to everyone not marked absent, with the meeting link and a &ldquo;Mark me absent&rdquo; button.
            {c.standing.url ? " This team has a saved link, so it fills in here every week." : " Save link keeps it for every week without emailing anyone."}
          </span>
        </form>
      )}
    </section>
  );
}

/** The coach can mark anyone absent (say when they texted instead), or back to attending. */
function CoachAnswer({ m, kind }: { m: Profile; kind: "in" | "out" }) {
  const first = firstName(m.name);
  return (
    <span className="rsvp-set">
      {kind === "out"
        ? <form action={setAttendance.bind(null, m.id, true)}><button className="rsvp-mini in" type="submit" aria-label={`Mark ${first} attending`} title={`Mark ${first} attending`}>✓</button></form>
        : <form action={setAttendance.bind(null, m.id, false)}><button className="rsvp-mini out" type="submit" aria-label={`Mark ${first} absent`} title={`Mark ${first} absent`}>✕</button></form>}
    </span>
  );
}

function Column({ label, kind, list, viewer }: { label: string; kind: "in" | "out"; list: Profile[]; viewer: Profile }) {
  return (
    <div className={`rsvp-col ${kind}`}>
      <div className="label">{label} <span>{list.length}</span></div>
      {list.length ? (
        <ul>
          {list.map((m) => (
            <li key={m.id}>
              <Avatar name={m.name} url={m.avatar_url} size={30} />
              <span>{m.id === viewer.id ? "You" : firstName(m.name)}</span>
              {viewer.role === "coach" && <CoachAnswer m={m} kind={kind} />}
            </li>
          ))}
        </ul>
      ) : <p className="muted">{kind === "out" ? "No one's marked absent." : "No one yet."}</p>}
    </div>
  );
}
