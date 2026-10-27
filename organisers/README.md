# Dayli for organisers

The organiser dashboard at `/organisers/`: a small single-page app in plain
HTML, CSS and JavaScript (no build step) where organisers sign in, set up a
profile, list events, publish them and see their numbers. The public side of
each event is `/e/<slug>` (`web/e/`), which anyone can open without signing in.

Everything it reads and writes goes through the functions in
`supabase/migrations/20261027000100_public_events.sql`; that file is the
contract.

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
| `#/profile`                     | organiser name, bio, links      | `organisers` (select own row), `organiser_upsert(p_name, p_bio, p_website, p_instagram)`     |
| `#/events`                      | list with numbers and actions   | `my_public_events()`, `public_event_set_status(p_id, p_status)`, `public_event_delete(p_id)` |
| `#/events/new`, `#/events/<id>` | the event form                  | `public_events` (select own row), `public_event_save(p)`, storage bucket `hero`              |
| `#/events/<id>/stats`           | views by day and source, going  | `public_event_stats(p_id)`                                                                   |

The public page `web/e/` calls `public_event_by_slug(p_slug)` and
`record_public_event_view(p_event_id, p_source)` with the anon key only.

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
