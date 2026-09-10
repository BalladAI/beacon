# @balladlabs/beacon

Ballad's site beacon as a package. Drop it into your site and Ballad can tell which post brought a visit, and the signup after it. First-party, about 2 KB, no cookies, no dependencies.

It is the same beacon Ballad serves as a `<script>` tag at `https://app.balladlabs.com/b.js`, packaged for sites built with a bundler. The two are wire-compatible: you can move between them without losing a visitor's first touch.

## Install

```bash
npm install @balladlabs/beacon
```

Your site token is under **Settings → Site** in Ballad.

## Next.js (App Router)

```tsx
// app/layout.tsx
import { BalladBeacon } from "@balladlabs/beacon/react";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <BalladBeacon site={process.env.NEXT_PUBLIC_BALLAD_SITE_TOKEN} />
      </body>
    </html>
  );
}
```

The component renders nothing, starts the beacon on mount, and reports client-side navigations on its own.

## Any site with a bundler

```ts
import { init } from "@balladlabs/beacon";

init({ site: "YOUR_SITE_TOKEN" });
```

Call it once, as early as you like. It is safe to call on the server (it does nothing there).

## Conversions

Tell Ballad when the thing you care about happens:

```ts
import { track } from "@balladlabs/beacon";

track("signup");
```

`track` can be called before `init` — the call is queued and sent once the beacon starts. Or skip the code and mark the element:

```html
<button data-ballad-track="signup">Get started</button>
<form data-ballad-track="demo_request">…</form>
```

Event names are short identifiers: letters, digits, `_` and `-`, up to 40 characters.

### Say who converted

If you tell Ballad who signed up, the conversion becomes a contact — with the post that first brought them and the last one before they converted — which Ballad can hand to your CRM.

```ts
track("signup", { email: user.email, name: user.name, company: user.company });
```

Only the email is required; nothing identifying is sent unless you pass it. For a plain form, let the beacon read the email input itself:

```html
<form data-ballad-track="signup" data-ballad-identify>
  <input type="email" name="email" />
  …
</form>
```

`window.ballad.track("signup")` keeps working too, for code written against the script tag.

## What it sends

- A `landing` once per tab, with the page, any `?ref=` token from a Ballad link, and the referring site's host.
- A `pageview` on each later navigation.
- A `conversion` with the visitor's first and last touch, so Ballad can attribute it — and an identity (email, name, company) only when you pass one.

Nothing else. No user agent, no IP, no identifier you didn't choose to send. The first and last touch live in `localStorage` on your own domain for 90 days. Visitors with Global Privacy Control on are never stored.

## Options

```ts
init({
  site: "YOUR_SITE_TOKEN",
  endpoint: "https://app.balladlabs.com", // default; only change for a mirror
  trackNavigation: true, // pushState / replaceState / popstate → pageview
  trackAttributes: true, // data-ballad-track clicks and submits
  respectGpc: true, // never store a touch under Global Privacy Control
});
```

`init` returns the beacon (`{ site, track, destroy }`), or `null` outside a browser. Calling it again for the same site returns the running beacon.

## Content Security Policy

If your site sets a CSP, allow the app origin for requests:

```
connect-src https://app.balladlabs.com
```

No `script-src` entry is needed — the code ships with your bundle.

## TypeScript

Types are included. `Payload`, `Touch`, `TouchRecord`, `BeaconOptions` and `Beacon` are exported for anyone who wants them.

## License

MIT
