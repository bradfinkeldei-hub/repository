import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is per-person and rendered on request, so no page cache is needed.
export default defineCloudflareConfig({});
