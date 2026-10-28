import Link from "next/link";

export const metadata = { title: "Privacy policy and terms · The Coaching Circle" };

/** Public page, linked from Google's sign-in screen. Keep in step with the copy on the Carrd site. */
export default function PrivacyPage() {
  return (
    <div className="wrap legal">
      <Link href="/" className="linkbtn">← The Coaching Circle</Link>
      <h1>Privacy policy</h1>
      <p className="muted">Last updated October 28, 2026</p>
      <p>The Coaching Circle is a private, invite-only web app for Sparkz of Courage group life coaching. Members use it to share their life wheel, what they are creating, what they are being held accountable to, and their personal mission with their coaching team. This policy explains what we collect, how we use it, and the choices members have.</p>
      <h2>Information we collect</h2>
      <ul>
        <li>Sign-in details: your email address and, if you choose one, a password (stored only in scrambled form). If you sign in with Google, we receive your name and email address from Google. We do not receive your Google password or any other Google data.</li>
        <li>Profile information you choose to share: name, life wheel ratings, who you are going to be, what you are creating, your accountability commitment, and your mission.</li>
        <li>Reminder preferences: whether you want a weekly email reminder and which day.</li>
      </ul>
      <h2>How we use information</h2>
      <ul>
        <li>To sign you in and show your profile to the members of your coaching team and to your coach.</li>
        <li>To send the weekly email reminder you asked for.</li>
      </ul>
      <p>We do not sell personal information, and we do not use it for advertising.</p>
      <h2>Who can see your information</h2>
      <p>Your profile is visible only to the members of your own team and to your coach. Your email address is visible only to you and your coach. The app is not visible to the public.</p>
      <h2>Service providers</h2>
      <p>The app is hosted on Cloudflare, stores data with Supabase, and sends email through Google Gmail. These providers process information only to run the app.</p>
      <h2>Keeping and deleting information</h2>
      <p>Information stays in the app until you edit it or ask for it to be removed. To have your account and all of its information deleted, ask your coach.</p>

      <h1 id="terms">Terms of service</h1>
      <p>These terms apply to The Coaching Circle, a private, invite-only web app run by Brad for Sparkz of Courage group life coaching. By signing in, you agree to them.</p>
      <h2>Who can use it</h2>
      <p>The app is for people their coach has invited. Keep your sign-in to yourself, and don&apos;t share your password.</p>
      <h2>Your content</h2>
      <p>You own what you write in the app. By sharing it, you let the members of your team and your coach see it. Be kind and respectful. What teammates share is in confidence: please don&apos;t copy it or share it outside the group.</p>
      <h2>Not professional advice</h2>
      <p>Coaching and this app are not therapy, medical, legal, or financial advice. If you need that kind of help, please contact a qualified professional.</p>
      <h2>Changes and access</h2>
      <p>The app is provided as is, and it may change or occasionally be unavailable. Your coach can remove an account, for example if someone leaves the group or doesn&apos;t follow these terms. You can ask to have your account deleted at any time.</p>
      <h2>Contact</h2>
      <p>Questions about this policy or these terms can go to your coach, Brad.</p>
    </div>
  );
}
