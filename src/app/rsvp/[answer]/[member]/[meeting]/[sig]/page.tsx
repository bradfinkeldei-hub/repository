import { ConfirmRsvp } from "../../../../confirm";

/** The email's links: /rsvp/in/<member>/<date>/<signature> */
export default async function RsvpLink({ params }: { params: Promise<{ answer: string; member: string; meeting: string; sig: string }> }) {
  const { answer, member, meeting, sig } = await params;
  return <ConfirmRsvp m={member} d={meeting} a={answer} k={sig} />;
}
