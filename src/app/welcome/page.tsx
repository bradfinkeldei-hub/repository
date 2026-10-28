import Link from "next/link";
import { requireProfile } from "@/lib/session";
import { BOOKING_ENABLED, teamLabel } from "@/lib/coaching";

const STEPS: [string, string][] = [
  ["Start with who you're going to be", "A way of being, not a to-do: \"I am going to be calm, a leader, joyful.\" It comes first because everything you do grows out of it."],
  ["Name what you're creating", "The one thing you're building right now. Then rate 8 areas of your life from 1 to 10 to see your life wheel."],
  ["Make up to 3 commitments a week", "Specific things you'll do before the next meeting, like \"Walk 4 mornings\". Tap each one when it's done. Done weeks build your streak and earn milestones."],
  ["Cheer each other on", "Every card has Kudos & comments underneath. A \"new\" badge shows when someone writes to you, and you can close your own thread anytime."],
];

const MORE: [string, string][] = [
  ["Meeting check-in", "Tap In or Out for the next meeting, join it, or add it to your calendar."],
  ["Our week", "How the whole team is showing up this week."],
  ["My progress", "Your streak and every commitment, meeting by meeting."],
  ["Missions", "The bigger \"why\" you and your teammates are living into."],
];

/** First screen for new members, and the "How it works" guide. */
export default async function WelcomePage() {
  const { me, names } = await requireProfile();
  const coach = process.env.COACH_NAME || "your coach";
  const isCoach = me.role === "coach";
  const empty = Object.keys(me.wheel ?? {}).length === 0;
  return (
    <div className="wrap welcome">
      <div>
        <span className="label">The Coaching Circle</span>
        <h1>Welcome{me.name ? `, ${me.name.split(" ")[0]}` : ""}! Here&apos;s how it works.</h1>
      </div>
      <p className="muted">
        {isCoach ? "This is what your members see when they first sign in." : me.team
          ? `You're on the ${teamLabel(me.team, names)}. Only your teammates and ${coach} can see what you share.`
          : `${coach} will add you to your team soon. Until then, you can fill in your profile.`}
      </p>
      <ol className="steps">
        {STEPS.map(([title, text]) => <li key={title}><b>{title}</b><span>{text}</span></li>)}
        {BOOKING_ENABLED && <li><b>Feeling stuck? Book a call</b><span>You get one free one-on-one call with {coach} each month. Extra sessions are $150.</span></li>}
      </ol>
      <div className="welcome-more">
        <span className="label">Also on your team page</span>
        <ul>{MORE.map(([title, text]) => <li key={title}><b>{title}:</b> {text}</li>)}</ul>
      </div>
      <div className="row">
        <Link className="btn" href="/profile">{empty ? "Fill in my profile" : "Edit my profile"}</Link>
        <Link className="linkbtn" href={isCoach ? "/coach" : "/team"}>{empty ? "Just look around first" : "Back to my team"}</Link>
      </div>
      <p className="muted" style={{ fontSize: "0.88rem", margin: 0 }}>It takes about 5 minutes. You can change anything later, and open this guide again from <b>How it works</b> at the top.</p>
    </div>
  );
}
