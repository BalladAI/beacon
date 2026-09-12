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

Only the email is required; nothing identifying is sent unless you pass it, and never when the visitor signals Global Privacy Control — the conversion is still counted, anonymously. For a plain form, let the beacon read the inputs itself:

```html
<form data-ballad-track="signup" data-ballad-identify>
  <input type="email" name="email" />
  …
</form>
```

The rule for what an identified form sends, exactly: the email from `input[type="email"]`, else `input[name="email"]`; the name from `input[name="name"]`, else `input[autocomplete="name"]`; the company from `input[name="company"]`, else `input[autocomplete="organization"]`. Nothing else on the form is read, and a form without the attribute sends no identity at all.

`window.ballad.track("signup")` keeps working too, for code written against the script tag.

### Properties

A third argument carries flat properties — strings, numbers and booleans, up to 20 keys — that a Ballad segment can read ("did `upgraded` where plan = pro, within 30 days"):

```ts
track("upgraded", { email: user.email }, { plan: "pro", seats: 3 });
```

## Accounts

If one person can belong to several companies, teams or workspaces in your product, tell Ballad which one an event happened in. `group` is Segment's idea: your own id for the account, a name, and traits set once for everyone in it.

```ts
import { group, identify } from "@balladlabs/beacon";

identify({ email: user.email });
group(workspace.id, { name: workspace.name, plan: workspace.plan });
```

The group is sent with the identity last passed to `identify` or `track` on the page — before or after, the beacon waits for one — and every later `track` on the page carries the account id, so "created a workspace, never published" reads per account rather than per email. A later `group` call with new traits merges them. Under Global Privacy Control nothing is sent. Script tag: `window.ballad.group(id, { name })`.

When the person leaves — a self-service "leave team", or deleting the workspace from their own browser — call the opposite:

```ts
import { ungroup } from "@balladlabs/beacon";

ungroup(workspace.id);
```

Ballad records `left_account` in that account and drops the membership; later `track` calls on the page stop carrying the id. A removal done by someone else never passes through the leaver's browser, so report those server-side with the `ungroup_contact` agent tool instead.

## Say who a returning visitor is

Signups the beacon saw before your form passed an email — or any visitor who
comes back — can still become a person in Ballad. Call `identify` when a user
logs in:

```ts
import { identify } from "@balladlabs/beacon";

identify({ email: user.email, name: user.name, company: user.company });
```

The beacon sends the identity together with the first and last Ballad touch
it kept in that browser (90 days), so the person appears on the People tab
with the post that first brought them. Nothing is counted as a conversion.
Under Global Privacy Control nothing is sent. Before `init` the call is
queued, and `window.ballad.identify({ email })` works for script-tag sites.

## Hand the touch to your app

If people read your site on one origin and sign up on another (say
`www.example.com` and `app.example.com`), the touch the browser kept on the
site can't be seen from the app. Tell the site's beacon where the visitor is
going, and mount the beacon on the app too:

```tsx
// on the marketing site
<BalladBeacon site={token} handoff={["app.example.com"]} />

// in the app (same site token)
<BalladBeacon site={token} />
```

Links to a handoff host get a short `bt` parameter carrying the stored touch.
The app's beacon adopts it on arrival, strips it from the URL, and from then
on `track("signup", { email })` or `identify(...)` in the app report the post
that first brought the person. An origin that already has a touch of its own
keeps it. Nothing is carried under Global Privacy Control. Script tag:
`data-handoff="app.example.com"`.

## What it sends

- A `landing` once per tab, with the page, any `?ref=` token from a Ballad link, and the referring site's host.
- A `pageview` on each later navigation.
- Once you have passed an identity on the page (`identify`, or `track` with one, queued before load included), the landing and later pageviews on that page carry it too, so a known person's reads show on their record and "last seen" moves. It is held in memory for the page only; nothing identifying is ever written to the browser.
- A `conversion` with the visitor's first and last touch, so Ballad can attribute it — and an identity (email, name, company), properties, and the current account id only when you pass them.
- A `group` (the identified person belongs to this account, with its traits) only when you call `group`, and an `ungroup` (they left it) only when you call `ungroup`.

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
