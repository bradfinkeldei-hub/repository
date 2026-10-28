import Link from "next/link";
import { requireProfile } from "@/lib/session";
import { BOOKING_ENABLED, teamLabel } from "@/lib/coaching";

const STEPS: [string, string][] = [
  ["Fill in your profile", "Rate 8 areas of your life from 1 to 10 (your life wheel), and write the one thing you're creating right now."],
  ["Pick your commitment", "Name one specific thing you'll do before the next meeting, like \"Work out 4 mornings\", so your team can check in on it. Turn on a weekly email reminder in Settings if you'd like one."],
  ["Check in each week", "On the Accountability tab, tap \"Mark this week done\" when you've shown up for it. My progress shows your streak and every commitment, meeting by meeting."],
  ["Share your mission", "Write the bigger \"why\" you're living into. Your team's missions are on the Missions tab."],
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
      <div className="row">
        <Link className="btn" href="/profile">{empty ? "Fill in my profile" : "Edit my profile"}</Link>
        <Link className="linkbtn" href={isCoach ? "/coach" : "/team"}>{empty ? "Just look around first" : "Back to my team"}</Link>
      </div>
      <p className="muted" style={{ fontSize: "0.88rem", margin: 0 }}>It takes about 5 minutes. You can change anything later, and open this guide again from <b>How it works</b> at the top.</p>
    </div>
  );
}
