import { ConfirmRsvp } from "./confirm";

/** The first emails' links: /rsvp?m=&d=&a=&k= */
export default async function Rsvp({ searchParams }: { searchParams: Promise<{ m?: string; d?: string; a?: string; k?: string }> }) {
  const { m = "", d = "", a, k = "" } = await searchParams;
  return <ConfirmRsvp m={m} d={d} a={a} k={k} />;
}
