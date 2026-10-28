import { LoginForm } from "./form";

/** GOOGLE_CLIENT_ID is a runtime variable, so it can be set in Cloudflare without a rebuild. */
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <LoginForm error={error} googleClientId={process.env.GOOGLE_CLIENT_ID} />;
}
