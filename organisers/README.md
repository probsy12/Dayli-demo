# Dayli for organisers

The organiser dashboard at `/organisers/`: a small single-page app in plain
HTML, CSS and JavaScript (no build step) where organisers sign in, set up a
profile, list events, publish them and see their numbers. The public side of
each event is `/e/<slug>` (`web/e/`), which anyone can open without signing in.

Everything it reads and writes goes through the functions in
`supabase/migrations/20261027000100_public_events.sql` (profile, events,
publishing) and `20261028000100_organiser_analytics.sql` (the numbers,
reminders, alerts); those files are the contract.

The layout is a sidebar on wide screens (Overview · Events · Analytics ·
Profile) and a top bar with a tab row on phones. `app.js` holds sign-in,
the profile wizard, the events list and the event form; `analytics.js`
holds the Overview and Analytics screens and is handed `app.js`'s helpers in
a `ctx` object.

## Signing in and confirming an email

- Email + password through supabase-js (`signUp`, `signInWithPassword`,
  `resetPasswordForEmail` with `redirectTo …/organisers/?reset=1`, then
  `updateUser` on the `#/reset` screen once `PASSWORD_RECOVERY` fires).
- Only a session that came from an emailed code counts as a confirmed address
  (the backend reads `amr` from the token), so before publishing the app sends
  a 6-digit code with `signInWithOtp({ shouldCreateUser: false })`, checks it
  with `verifyOtp({ type: 'email' })` and then calls `organiser_mark_verified()`.
  The same screen doubles as "email me a code instead" for people who already
  use the app and have no password.
- First sign-in with no `organisers` row goes to the profile screen
  (`organiser_upsert`), then to the code screen, then to the events list.

## Routes and the RPCs behind them

| Route                           | What it does                    | Backend                                                                                      |
| ------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| `#/sign-in`                     | sign in / create account / code | Supabase Auth                                                                                |
| `#/verify`                      | confirm the email with a code   | `signInWithOtp`, `verifyOtp`, `organiser_mark_verified()`                                    |
| `#/reset`                       | choose a new password           | `auth.updateUser`                                                                            |
| `#/profile`                     | first time: a 3-step wizard (who you are → confirm email → first event); after: profile, alerts switch, password | `organisers` (select own row), `organiser_upsert(p_name, p_bio, p_website, p_instagram)`, `organiser_set_alerts(p_on)` |
| `#/overview`                    | totals across events, "What to do", coming up | `organiser_overview()`, `organiser_event_analytics(p_id, p_days)` for the next event        |
| `#/events`                      | list with numbers and actions   | `my_public_events()`, `public_event_set_status(p_id, p_status)`, `public_event_delete(p_id)` |
| `#/events/new`, `#/events/<id>` | the event form with a live app preview and a publish checklist; `?from=<id>` copies a past event ("Run it again") | `public_events` (select own row), `public_event_save(p)`, storage bucket `hero` |
| `#/analytics/<id>?tab=&days=`   | tabs Overview · Reach · Timing · People · Tickets · All events | `organiser_event_analytics(p_id, p_days)`, `organiser_overview()`, `public_event_send_reminder(p_event_id)` |

`#/events/<id>/stats` from old links goes to `#/analytics/<id>`.

The public page `web/e/` calls `public_event_by_slug(p_slug)`,
`record_public_event_view(p_event_id, p_source, p_via, p_share_code)` and
`record_public_event_ticket_click(p_event_id, 'web')` with the anon key only.
A `?ref=<code>` on the link is the share code of the person who sent it.

## What the analytics page shows

Every number is a count, a band or the first name of someone who said going
or shared the event; who looked is never stored by name.

- **Overview**: views, interested, going, ticket clicks (with deltas against
  last week); views and new going by day; "What to do", up to three items
  picked by `insights()` in `analytics.js` (a reminder to send, low web
  ticket clicks, a missing ticket link or cover photo, a cluster of
  drop-outs, a weak Discover tap rate, a views drop, a top sharer to thank,
  ahead or behind the previous event); teasers for the other tabs.
- **Reach**: funnel from seen in Discover to ticket clicks; views by source
  and Discover filter; who shared it and what it brought; changed their mind.
- **Timing**: hour-by-weekday heatmap of views; going over time against the
  organiser's previous event; median time from first look to going.
- **People**: distance bands for goers and viewers; new or returning, with
  which earlier events they came to; brought by friends; the going list with
  found-it-via, calendar, tickets and been-before columns.
- **Tickets**: clicks by app and public page with rates and the category
  benchmark; reminders sent and what each brought; the Send a reminder button
  (one per person per week, one per event per day).
- **All events**: every event side by side with the category benchmark;
  "Run it again" on past ones; the alerts switch (milestone pushes at 10, 25,
  50, 100 going and a day-after summary).

Find on map geocodes the address in the browser: a UK postcode goes to
postcodes.io, otherwise OpenStreetMap's Nominatim, then open-meteo's town
lookup as a last resort. Latitude and longitude can also be typed by hand.

## Running it locally

```sh
bash scripts/site/build.sh        # builds everything into dist/site (slow: it exports the app twice)
python3 -m http.server -d dist/site 8775
```

Then open http://127.0.0.1:8775/organisers/ and http://127.0.0.1:8775/e/?s=some-slug.
The pages read the Supabase project from `web/config.js`. For a quick look
without the full build you can also serve `web/` directly; the only thing the
build adds for these pages is favicons and the `/e/<slug>` rewrite in `404.html`.

## vendor/supabase.js

A copy of the supabase-js browser bundle, served from here because the site
loads no third-party scripts. To refresh it after upgrading the package:

```sh
cp node_modules/@supabase/supabase-js/dist/umd/supabase.js web/organisers/vendor/supabase.js
```
