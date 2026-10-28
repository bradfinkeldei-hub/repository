"use client";

import "./globals.css";
import ErrorPage from "./error";

// Errors from the root layout, such as the View as bar's "Exit member view"
// button on a page opened before an update, skip error.tsx and land here.
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body><ErrorPage {...props} /></body>
    </html>
  );
}
