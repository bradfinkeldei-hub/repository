import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;

// Lets `next dev` read the settings in wrangler.jsonc and .dev.vars.
initOpenNextCloudflareForDev();
