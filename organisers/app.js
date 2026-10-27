/* Dayli for organisers: a small single-page app in plain browser JavaScript.
 * Routes live in the hash (#/events, #/events/new, #/events/<id>, …). Data
 * comes from the Supabase project in ../config.js through supabase-js
 * (vendor/supabase.js) and the RPCs in
 * supabase/migrations/20261027000100_public_events.sql. */
(function () {
  'use strict';

  var cfg = window.DAYLI_CONFIG || {};
  var app = document.getElementById('app');
  var nav = document.getElementById('nav');
  var SITE = 'https://daylicalendar.co.uk';
  var APP_NOTE_KEY = 'dayli_organisers_app_note_seen';

  var sb = null;
  try {
    if (window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey) {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    }
  } catch (e) {
    sb = null;
  }

  var state = {
    ready: false,
    session: null,
    organiser: undefined, // undefined = not loaded yet, null = none
    pendingEmail: null, // an address we've just emailed a code to
    codeSent: false,
    recovery: false,
    events: null,
    afterVerify: null,
  };

  var CATEGORIES = [
    ['music', 'Music'],
    ['comedy', 'Comedy'],
    ['family', 'Family & kids'],
    ['food_drink', 'Food & drink'],
    ['sport_fitness', 'Sport & fitness'],
    ['arts_theatre', 'Arts & theatre'],
    ['classes', 'Classes'],
    ['nightlife', 'Nightlife'],
    ['community', 'Community'],
    ['other', 'Other'],
  ];
  var TIMEZONES = [
    ['Europe/London', 'United Kingdom (London)'],
    ['Europe/Dublin', 'Ireland (Dublin)'],
    ['Europe/Paris', 'France (Paris)'],
    ['Europe/Berlin', 'Germany (Berlin)'],
    ['Europe/Madrid', 'Spain (Madrid)'],
    ['Europe/Lisbon', 'Portugal (Lisbon)'],
    ['America/New_York', 'US East (New York)'],
    ['America/Los_Angeles', 'US West (Los Angeles)'],
    ['Australia/Sydney', 'Australia (Sydney)'],
    ['UTC', 'UTC'],
  ];
  var CURRENCIES = ['GBP', 'EUR', 'USD'];

  // --- small helpers -------------------------------------------------------

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function $(selector, root) {
    return (root || app).querySelector(selector);
  }
  function $$(selector, root) {
    return Array.prototype.slice.call((root || app).querySelectorAll(selector));
  }
  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }
  function toast(message) {
    var t = document.getElementById('toast');
    t.textContent = message;
    t.classList.add('on');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      t.classList.remove('on');
    }, 2600);
  }
  function render(html, narrow) {
    app.className = narrow ? 'narrow' : '';
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }
  function loading(message) {
    render('<p class="muted">' + esc(message || 'Loading…') + '</p>');
  }
  function notice(kind, html) {
    return '<div class="notice ' + kind + '">' + html + '</div>';
  }
  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = label || 'One moment…';
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
    }
  }
  function showError(box, message) {
    if (!box) return toast(message);
    box.hidden = false;
    box.textContent = message;
  }
  function uid() {
    return state.session && state.session.user ? state.session.user.id : null;
  }
  function email() {
    return state.session && state.session.user ? state.session.user.email : null;
  }
  function coverUrl(path) {
    return cfg.supabaseUrl + '/storage/v1/object/public/hero/' + path;
  }
  function categoryLabel(key) {
    for (var i = 0; i < CATEGORIES.length; i++)
      if (CATEGORIES[i][0] === key) return CATEGORIES[i][1];
    return 'Other';
  }

  // Server errors come back with a code in message and sometimes a hint.
  function friendly(error) {
    if (!error) return 'Something went wrong.';
    var message = String(error.message || error || '');
    var known = {
      no_place: 'Add the venue and use Find on map so people can find it.',
      in_the_past: 'The event has already ended, so it can’t be published.',
      email_unverified: 'Confirm your email first: we send a code to the address, you type it in.',
      not_an_organiser: 'Set up your organiser profile first.',
      not_authenticated: 'You’ve been signed out. Please sign in again.',
      not_found: 'We couldn’t find that event. It may have been deleted.',
      rate_limit: 'You’ve made a lot of events today. Try again tomorrow.',
      bad_status: 'That isn’t a status we know.',
      ticket_url_check: 'The ticket link must start with http:// or https://.',
      ends_at: 'The end has to come after the start.',
      slug_check: 'The title needs at least a few letters or numbers.',
      title_check: 'The title can be up to 120 characters.',
      description_check: 'The description can be up to 4,000 characters.',
      tags_check: 'Up to 8 tags, please.',
      'Failed to fetch': 'We couldn’t reach Dayli. Check your connection and try again.',
      'Load failed': 'We couldn’t reach Dayli. Check your connection and try again.',
      NetworkError: 'We couldn’t reach Dayli. Check your connection and try again.',
      'Invalid login credentials': 'That email and password don’t match.',
      'Email not confirmed': 'Confirm your email first.',
      'Signups not allowed for otp': 'We couldn’t find an account for that email.',
      'Token has expired or is invalid': 'That code is wrong or has expired. Ask for a new one.',
      otp_expired: 'That code has expired. Ask for a new one.',
      'rate limit': 'Too many tries. Wait a minute and try again.',
      'Rate limit': 'Too many tries. Wait a minute and try again.',
      'Password should be': 'Use a password of at least 8 characters.',
      'User already registered': 'There’s already an account for that email. Sign in instead.',
      'JWT expired': 'You’ve been signed out. Please sign in again.',
    };
    for (var key in known) {
      if (message.indexOf(key) !== -1) return known[key];
    }
    if (error.hint) return error.hint;
    return message || 'Something went wrong.';
  }

  function rpc(name, args) {
    return sb.rpc(name, args || {}).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  // --- dates and time zones ------------------------------------------------

  function tzParts(date, tz) {
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);
    var o = {};
    parts.forEach(function (p) {
      o[p.type] = p.value;
    });
    return {
      year: +o.year,
      month: +o.month,
      day: +o.day,
      hour: +o.hour % 24,
      minute: +o.minute,
      second: +o.second,
    };
  }
  // Offset of tz from UTC at an instant, in milliseconds.
  function tzOffsetMs(date, tz) {
    var p = tzParts(date, tz);
    var asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
  }
  // 'YYYY-MM-DD' + 'HH:MM' in tz -> ISO instant (correct across clock changes).
  function zonedToIso(dateStr, timeStr, tz) {
    if (!dateStr || !timeStr) return null;
    var d = dateStr.split('-').map(Number);
    var t = timeStr.split(':').map(Number);
    var guess = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1] || 0);
    var off1 = tzOffsetMs(new Date(guess), tz);
    var instant = guess - off1;
    var off2 = tzOffsetMs(new Date(instant), tz);
    if (off2 !== off1) instant = guess - off2;
    return new Date(instant).toISOString();
  }
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }
  // ISO instant -> { date: 'YYYY-MM-DD', time: 'HH:MM' } in tz.
  function isoToZoned(iso, tz) {
    if (!iso) return { date: '', time: '' };
    var p = tzParts(new Date(iso), tz);
    return {
      date: p.year + '-' + pad(p.month) + '-' + pad(p.day),
      time: pad(p.hour) + ':' + pad(p.minute),
    };
  }
  function safeTz(tz) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz }).format(new Date());
      return tz;
    } catch (e) {
      return 'Europe/London';
    }
  }
  function fmtWhen(startsAt, endsAt, tz) {
    tz = safeTz(tz || 'Europe/London');
    var start = new Date(startsAt);
    var end = new Date(endsAt);
    var dateOpts = {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: tz,
    };
    var timeOpts = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz };
    var day = start.toLocaleDateString('en-GB', dateOpts);
    var endDay = end.toLocaleDateString('en-GB', dateOpts);
    var from = start.toLocaleTimeString('en-GB', timeOpts);
    var to = end.toLocaleTimeString('en-GB', timeOpts);
    return day === endDay
      ? day + ' · ' + from + '–' + to
      : day + ' ' + from + ' – ' + endDay + ' ' + to;
  }
  function fmtPrice(ev) {
    if (ev.is_free || ev.price_from_pence == null) return 'Free';
    try {
      return (
        'From ' +
        new Intl.NumberFormat('en-GB', {
          style: 'currency',
          currency: ev.currency || 'GBP',
        }).format(ev.price_from_pence / 100)
      );
    } catch (e) {
      return 'From ' + (ev.price_from_pence / 100).toFixed(2) + ' ' + ev.currency;
    }
  }

  // --- session and organiser ----------------------------------------------

  function loadOrganiser() {
    if (!uid()) {
      state.organiser = null;
      return Promise.resolve(null);
    }
    return sb
      .from('organisers')
      .select('*')
      .eq('user_id', uid())
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        state.organiser = res.data || null;
        return state.organiser;
      });
  }
  function isVerified() {
    return !!(state.organiser && state.organiser.email_verified_at);
  }

  // Where a signed-in person should be: profile first, then a confirmed
  // email, then their events.
  function homeHash() {
    if (!state.organiser) return '#/profile';
    if (!isVerified()) return '#/verify';
    return '#/events';
  }

  // --- router ----------------------------------------------------------------

  function route() {
    if (!state.ready) return;
    var hash = location.hash.replace(/^#/, '');
    if (hash.charAt(0) !== '/') hash = '/events';
    var parts = hash.split('?')[0].split('/').filter(Boolean);
    var signedIn = !!state.session;
    nav.hidden = !signedIn;
    $$('a[data-route]', nav).forEach(function (a) {
      a.classList.toggle('on', a.dataset.route === parts[0]);
    });

    if (parts[0] === 'reset') return screenReset();
    if (!signedIn) {
      if (parts[0] === 'sign-in' || parts[0] === 'create-account') {
        return screenSignIn(parts[0] === 'create-account' ? 'create' : 'signin');
      }
      if (parts[0] === 'verify' && state.pendingEmail) return screenVerify();
      return screenSignIn('signin');
    }
    if (state.organiser === undefined) {
      loading();
      return loadOrganiser().then(route, function (err) {
        render(
          notice('error', esc(friendly(err))) + '<button class="btn" id="retry">Try again</button>',
          true,
        );
        $('#retry').onclick = function () {
          loading();
          loadOrganiser().then(route, function () {
            route();
          });
        };
      });
    }
    switch (parts[0]) {
      case 'sign-in':
      case 'create-account':
        return go(homeHash());
      case 'verify':
        return screenVerify();
      case 'profile':
        return screenProfile();
      case 'events':
        if (!state.organiser) return screenProfile(true);
        if (parts[1] === 'new') return screenForm(null);
        if (parts[1] && parts[2] === 'stats') return screenStats(parts[1]);
        if (parts[1]) return screenForm(parts[1]);
        return screenEvents();
      default:
        return go('#/events');
    }
  }

  // --- sign in / create account --------------------------------------------

  function screenSignIn(mode) {
    render(
      '<h1>Dayli for organisers</h1>' +
        '<p class="muted">List your events so people nearby can find them, say they’re going and keep them in their calendars.</p>' +
        '<div class="tabs"><button type="button" data-mode="signin" class="' +
        (mode === 'signin' ? 'on' : '') +
        '">Sign in</button><button type="button" data-mode="create" class="' +
        (mode === 'create' ? 'on' : '') +
        '">Create account</button></div>' +
        '<form class="card" id="auth-form" novalidate>' +
        '<label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required /></label>' +
        '<div class="notice error" id="err" hidden></div>' +
        '<button class="btn primary block" type="button" id="code">' +
        (mode === 'create' ? 'Create account with an emailed code' : 'Email me a code to sign in') +
        '</button>' +
        '<div class="hint">We email a 6-digit code; no password needed. The same email as the Dayli app works here.</div>' +
        '<div class="actions"><button type="button" class="linkish" id="use-password">' +
        (mode === 'create' ? 'Set a password instead' : 'Sign in with a password instead') +
        '</button></div>' +
        '<div id="pw-block" hidden>' +
        '<label class="field"><span>Password</span><input type="password" name="password" autocomplete="' +
        (mode === 'create' ? 'new-password' : 'current-password') +
        '" minlength="8" />' +
        (mode === 'create' ? '<div class="hint">At least 8 characters.</div>' : '') +
        '</label>' +
        '<button class="btn block" type="submit">' +
        (mode === 'create' ? 'Create account with this password' : 'Sign in with password') +
        '</button>' +
        (mode === 'signin'
          ? '<div class="actions"><button type="button" class="linkish" id="forgot">Forgot password?</button></div>'
          : '') +
        '</div></form>' +
        '<p class="muted small">Signed up in the Dayli app? You already have an account: just email yourself a code. You can add a password later from your profile.</p>',
      true,
    );
    $$('.tabs button').forEach(function (b) {
      b.onclick = function () {
        var keep = $('[name=email]').value;
        screenSignIn(b.dataset.mode);
        $('[name=email]').value = keep;
      };
    });
    var form = $('#auth-form');
    var err = $('#err');
    $('#use-password').onclick = function () {
      var block = $('#pw-block');
      block.hidden = !block.hidden;
      if (!block.hidden) $('[name=password]').focus();
    };
    form.onsubmit = function (e) {
      e.preventDefault();
      err.hidden = true;
      var address = $('[name=email]').value.trim();
      var password = $('[name=password]').value;
      if (!/^\S+@\S+\.\S+$/.test(address)) return showError(err, 'Enter your email address.');
      if ($('#pw-block').hidden) return $('#code').click();
      if (mode === 'create' && password.length < 8)
        return showError(err, 'Use a password of at least 8 characters.');
      if (!password) return showError(err, 'Enter your password.');
      var button = $('button[type=submit]', form);
      setBusy(button, true);
      var p =
        mode === 'create'
          ? sb.auth.signUp({ email: address, password: password })
          : sb.auth.signInWithPassword({ email: address, password: password });
      p.then(function (res) {
        setBusy(button, false);
        var user = res.data && res.data.user;
        var exists =
          (res.error && mode === 'create' && /already|registered/i.test(res.error.message)) ||
          (!res.error && mode === 'create' && user && user.identities && user.identities.length === 0);
        if (exists) {
          // They signed up in the app (an emailed code, no password): send a
          // code and carry on, rather than turning them away.
          return codeInstead(address, button, 'You already have a Dayli account. We’ve emailed you a code to sign in with.');
        }
        if (res.error) {
          if (mode === 'signin' && /Invalid login credentials/i.test(res.error.message)) {
            return showError(
              err,
              'That email and password don’t match. If you signed up in the Dayli app you may not have a password yet: use “Email me a code to sign in”.',
            );
          }
          return showError(err, friendly(res.error));
        }
        if (!res.data || !res.data.session) {
          // Confirmation by email is on: the code route proves the address.
          state.pendingEmail = address;
          state.codeSent = false;
          return go('#/verify');
        }
        state.session = res.data.session;
        state.organiser = undefined;
        loadOrganiser().then(
          function () {
            go(homeHash());
          },
          function () {
            go('#/events');
          },
        );
      }).catch(function (ex) {
        setBusy(button, false);
        showError(err, friendly(ex));
      });
    };
    function codeInstead(address, button, message) {
      setBusy(button, true, 'Sending…');
      sendCode(address, mode === 'create').then(
        function () {
          setBusy(button, false);
          state.pendingEmail = address;
          state.codeSent = true;
          if (message) toast(message);
          go('#/verify');
        },
        function (ex) {
          setBusy(button, false);
          showError(
            err,
            /Signups not allowed|not found/i.test(ex.message || '')
              ? 'We couldn’t find an account for that email. Switch to “Create account”.'
              : friendly(ex),
          );
        },
      );
    }
    $('#code').onclick = function () {
      err.hidden = true;
      var address = $('[name=email]').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(address)) return showError(err, 'Enter your email address first.');
      codeInstead(address, $('#code'), null);
    };
    var forgot = $('#forgot');
    if (forgot) {
      forgot.onclick = function () {
        err.hidden = true;
        var address = $('[name=email]').value.trim();
        if (!/^\S+@\S+\.\S+$/.test(address))
          return showError(err, 'Enter your email address first.');
        setBusy(forgot, true, 'Sending…');
        sb.auth
          .resetPasswordForEmail(address, { redirectTo: location.origin + '/organisers/?reset=1' })
          .then(function (res) {
            setBusy(forgot, false);
            if (res.error) return showError(err, friendly(res.error));
            toast('Check your email for a link to choose a new password.');
          })
          .catch(function (ex) {
            setBusy(forgot, false);
            showError(err, friendly(ex));
          });
      };
    }
  }

  function sendCode(address, create) {
    return sb.auth
      .signInWithOtp({ email: address, options: { shouldCreateUser: Boolean(create) } })
      .then(function (res) {
        if (res.error) throw res.error;
      });
  }

  // --- confirm your email ----------------------------------------------------

  function screenVerify() {
    var address = state.pendingEmail || email();
    if (!address) return go('#/sign-in');
    var sent = state.codeSent && state.pendingEmail === address;
    render(
      '<h1>Confirm your email</h1>' +
        '<p class="muted">Before an event goes live we check the address is yours, so people know who’s behind it. We email a 6-digit code to <b>' +
        esc(address) +
        '</b>; type it in here. The email is called “Your Dayli code”.</p>' +
        '<div class="card">' +
        '<div id="step-send"' +
        (sent ? ' hidden' : '') +
        '><button class="btn primary block" id="send">Email me a code</button></div>' +
        '<form id="step-code" novalidate' +
        (sent ? '' : ' hidden') +
        '>' +
        '<label class="field"><span>Code from the email</span><input class="code-input" type="text" name="token" inputmode="numeric" autocomplete="one-time-code" maxlength="8" /></label>' +
        '<div class="notice error" id="err" hidden></div>' +
        '<button class="btn primary block" type="submit">Confirm</button>' +
        '<div class="actions" style="justify-content: space-between">' +
        '<button type="button" class="linkish" id="resend">Send a new code</button>' +
        (state.session ? '<a href="#/events">Later</a>' : '<a href="#/sign-in">Back</a>') +
        '</div></form></div>' +
        (isVerified() ? notice('info', 'Your email is already confirmed.') : ''),
      true,
    );
    var err = $('#err');
    function send(button) {
      setBusy(button, true, 'Sending…');
      sendCode(address).then(
        function () {
          setBusy(button, false);
          state.pendingEmail = address;
          state.codeSent = true;
          $('#step-send').hidden = true;
          $('#step-code').hidden = false;
          $('[name=token]').focus();
          toast('Code sent. Check your inbox (and junk folder).');
        },
        function (ex) {
          setBusy(button, false);
          $('#step-code').hidden = false;
          showError(err, friendly(ex));
        },
      );
    }
    $('#send').onclick = function () {
      send(this);
    };
    $('#resend').onclick = function () {
      send(this);
    };
    $('#step-code').onsubmit = function (e) {
      e.preventDefault();
      err.hidden = true;
      var token = $('[name=token]').value.replace(/\D/g, '');
      if (token.length < 6) return showError(err, 'Enter the 6-digit code from the email.');
      var button = $('button[type=submit]');
      setBusy(button, true, 'Checking…');
      sb.auth
        .verifyOtp({ email: address, token: token, type: 'email' })
        .then(function (res) {
          if (res.error) throw res.error;
          state.session = res.data.session || state.session;
          state.pendingEmail = null;
          state.codeSent = false;
          // The new session came from an emailed code, which is what counts.
          return rpc('organiser_mark_verified').catch(function () {
            return false;
          });
        })
        .then(function () {
          return loadOrganiser().catch(function () {});
        })
        .then(function () {
          setBusy(button, false);
          if (!state.organiser) {
            toast('Email confirmed. Now tell people who you are.');
            return go('#/profile');
          }
          toast(isVerified() ? 'Email confirmed. You can publish events.' : 'Signed in.');
          go('#/events');
        })
        .catch(function (ex) {
          setBusy(button, false);
          showError(err, friendly(ex));
        });
    };
  }

  // --- reset password --------------------------------------------------------

  function screenReset() {
    if (!state.session) {
      render(
        '<h1>Choose a new password</h1>' +
          notice(
            'warn',
            'This link has expired or was already used. Go back to <a href="#/sign-in">sign in</a> and use “Forgot password?” again.',
          ),
        true,
      );
      return;
    }
    render(
      '<h1>Choose a new password</h1>' +
        '<form class="card" id="reset-form" novalidate>' +
        '<label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" minlength="8" /><div class="hint">At least 8 characters.</div></label>' +
        '<label class="field"><span>Again, to be sure</span><input type="password" name="again" autocomplete="new-password" /></label>' +
        '<div class="notice error" id="err" hidden></div>' +
        '<button class="btn primary block" type="submit">Save password</button></form>',
      true,
    );
    var err = $('#err');
    $('#reset-form').onsubmit = function (e) {
      e.preventDefault();
      err.hidden = true;
      var password = $('[name=password]').value;
      if (password.length < 8) return showError(err, 'Use a password of at least 8 characters.');
      if (password !== $('[name=again]').value)
        return showError(err, 'The two passwords don’t match.');
      var button = $('button[type=submit]');
      setBusy(button, true, 'Saving…');
      sb.auth
        .updateUser({ password: password })
        .then(function (res) {
          setBusy(button, false);
          if (res.error) return showError(err, friendly(res.error));
          state.recovery = false;
          toast('Password saved.');
          go(homeHash());
        })
        .catch(function (ex) {
          setBusy(button, false);
          showError(err, friendly(ex));
        });
    };
  }

  // --- organiser profile -------------------------------------------------------

  function screenProfile(forced) {
    var o = state.organiser || {};
    var first = !state.organiser;
    render(
      '<h1>' +
        (first ? 'Tell people who you are' : 'Your organiser profile') +
        '</h1>' +
        '<p class="muted">' +
        (first
          ? 'This shows on every event you list. You can change it any time.'
          : 'Shown on every event you list.') +
        '</p>' +
        (forced ? notice('info', 'Set up your profile to start listing events.') : '') +
        '<form class="card" id="profile-form" novalidate>' +
        '<label class="field"><span>Name (your name, venue or group)</span><input type="text" name="name" maxlength="80" required value="' +
        esc(o.name) +
        '" /></label>' +
        '<label class="field"><span>A few words about you (optional)</span><textarea name="bio" maxlength="1000">' +
        esc(o.bio) +
        '</textarea></label>' +
        '<div class="two">' +
        '<label class="field"><span>Website (optional)</span><input type="url" name="website" maxlength="200" placeholder="https://" value="' +
        esc(o.website) +
        '" /></label>' +
        '<label class="field"><span>Instagram (optional)</span><input type="text" name="instagram" maxlength="60" placeholder="@yourname" value="' +
        esc(o.instagram) +
        '" /></label></div>' +
        '<div class="notice error" id="err" hidden></div>' +
        '<button class="btn primary" type="submit">' +
        (first ? 'Save and continue' : 'Save') +
        '</button></form>' +
        '<div class="card"><h3>Your account</h3>' +
        '<p class="muted small">Signed in as <b>' +
        esc(email()) +
        '</b>. Email ' +
        (isVerified()
          ? 'confirmed.'
          : 'not confirmed yet: <a href="#/verify">confirm it</a> before publishing.') +
        '</p>' +
        '<p class="muted small">The same email works in the Dayli app, where your events show under Events → Hosting. The app signs in with an emailed code, not this password.</p>' +
        '<details><summary class="small">Change password</summary>' +
        '<form id="pw-form" novalidate style="margin-top: 10px">' +
        '<label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" minlength="8" /></label>' +
        '<div class="notice error" id="pw-err" hidden></div>' +
        '<button class="btn small" type="submit">Save password</button></form></details></div>',
      true,
    );
    var err = $('#err');
    $('#profile-form').onsubmit = function (e) {
      e.preventDefault();
      err.hidden = true;
      var name = $('[name=name]').value.trim();
      if (!name) return showError(err, 'Enter a name.');
      var website = $('[name=website]').value.trim();
      if (website && !/^https?:\/\//i.test(website)) website = 'https://' + website;
      var button = $('button[type=submit]', $('#profile-form'));
      setBusy(button, true, 'Saving…');
      rpc('organiser_upsert', {
        p_name: name,
        p_bio: $('[name=bio]').value.trim() || null,
        p_website: website || null,
        p_instagram: $('[name=instagram]').value.trim().replace(/^@/, '') || null,
      })
        .then(function (row) {
          setBusy(button, false);
          state.organiser = row || state.organiser || { name: name };
          toast('Profile saved.');
          if (first) go(isVerified() ? '#/events' : '#/verify');
        })
        .catch(function (ex) {
          setBusy(button, false);
          showError(err, friendly(ex));
        });
    };
    $('#pw-form').onsubmit = function (e) {
      e.preventDefault();
      var pwErr = $('#pw-err');
      pwErr.hidden = true;
      var password = $('#pw-form [name=password]').value;
      if (password.length < 8) return showError(pwErr, 'Use a password of at least 8 characters.');
      var button = $('button[type=submit]', $('#pw-form'));
      setBusy(button, true, 'Saving…');
      sb.auth
        .updateUser({ password: password })
        .then(function (res) {
          setBusy(button, false);
          if (res.error) return showError(pwErr, friendly(res.error));
          $('#pw-form [name=password]').value = '';
          toast('Password saved.');
        })
        .catch(function (ex) {
          setBusy(button, false);
          showError(pwErr, friendly(ex));
        });
    };
  }

  // --- events list -----------------------------------------------------------

  function loadEvents() {
    return rpc('my_public_events').then(function (rows) {
      state.events = rows || [];
      return state.events;
    });
  }

  function screenEvents() {
    loading();
    loadEvents().then(renderEvents, function (err) {
      render(
        '<div class="page-head"><h1>Your events</h1></div>' +
          notice('error', esc(friendly(err))) +
          '<button class="btn" id="retry">Try again</button>',
      );
      $('#retry').onclick = screenEvents;
    });
  }

  function statusBadge(status) {
    var label =
      status === 'published' ? 'Published' : status === 'cancelled' ? 'Cancelled' : 'Draft';
    return '<span class="badge ' + esc(status) + '">' + label + '</span>';
  }

  function renderEvents() {
    var rows = state.events || [];
    var appNote = '';
    try {
      if (!localStorage.getItem(APP_NOTE_KEY)) {
        appNote = notice(
          'info',
          '<b>Good to know:</b> the same email works in the Dayli app, where your events show under Events → Hosting. The app signs in with an emailed code, not this password. <button type="button" class="linkish" id="note-ok">Got it</button>',
        );
      }
    } catch (e) {
      appNote = '';
    }
    var verifyNote = isVerified()
      ? ''
      : notice(
          'warn',
          'Drafts are fine, but to publish you need to <a href="#/verify">confirm your email</a> first.',
        );
    var html =
      '<div class="page-head"><div><h1>Your events</h1><p class="muted">' +
      (state.organiser ? 'Listed as <b>' + esc(state.organiser.name) + '</b>.' : '') +
      '</p></div><a class="btn primary" href="#/events/new">New event</a></div>' +
      appNote +
      verifyNote;
    if (!rows.length) {
      html +=
        '<div class="card empty"><h2>No events yet</h2><p class="muted">Make your first one: a title, a time and a place is enough to start.</p><a class="btn primary" href="#/events/new">New event</a></div>';
    }
    rows.forEach(function (ev) {
      var cover = ev.cover_image_path
        ? '<div class="cover" style="background-image: url(&quot;' +
          esc(coverUrl(ev.cover_image_path)) +
          '&quot;)"></div>'
        : '<div class="cover">' + esc((ev.title || '?').trim().charAt(0).toUpperCase()) + '</div>';
      var link = SITE + '/e/' + ev.slug;
      var past = new Date(ev.ends_at).getTime() < Date.now();
      html +=
        '<div class="card event" data-id="' +
        esc(ev.id) +
        '">' +
        cover +
        '<div><h3>' +
        esc(ev.title) +
        '</h3><div class="muted small">' +
        esc(fmtWhen(ev.starts_at, ev.ends_at, ev.timezone)) +
        (ev.venue_name ? ' · ' + esc(ev.venue_name) : '') +
        ' · ' +
        esc(fmtPrice(ev)) +
        '</div><div style="margin-top: 6px">' +
        statusBadge(ev.status) +
        (past ? ' <span class="badge">Past</span>' : '') +
        '</div>' +
        '<div class="numbers"><span><b>' +
        ev.views +
        '</b> views</span><span><b>' +
        ev.going +
        '</b> going</span><span><b>' +
        ev.interested +
        '</b> interested</span><span><b>' +
        ev.calendar_adds +
        '</b> calendar adds</span></div></div>' +
        '<div class="event-foot">' +
        (ev.status === 'draft'
          ? '<div class="linkrow">Publish to get a public link.</div>'
          : '<div class="linkrow"><code>' +
            esc(link) +
            '</code><button type="button" class="btn small" data-act="copy" data-link="' +
            esc(link) +
            '">Copy</button><a class="btn small" href="' +
            esc(link) +
            '" target="_blank" rel="noopener">Open</a></div>') +
        '<div class="actions">' +
        '<a class="btn small" href="#/events/' +
        esc(ev.id) +
        '">Edit</a>' +
        '<a class="btn small" href="#/events/' +
        esc(ev.id) +
        '/stats">Stats</a>' +
        (ev.status === 'draft'
          ? '<button type="button" class="btn small primary" data-act="published">Publish</button>'
          : '') +
        (ev.status === 'published'
          ? '<button type="button" class="btn small" data-act="draft">Unpublish</button>' +
            '<button type="button" class="btn small danger" data-act="cancelled">Cancel event</button>'
          : '') +
        (ev.status === 'cancelled'
          ? '<button type="button" class="btn small" data-act="draft">Back to draft</button>'
          : '') +
        '<button type="button" class="btn small danger" data-act="delete">Delete</button>' +
        '</div></div></div>';
    });
    render(html);
    var ok = $('#note-ok');
    if (ok) {
      ok.onclick = function () {
        try {
          localStorage.setItem(APP_NOTE_KEY, '1');
        } catch (e) {
          /* fine */
        }
        ok.closest('.notice').remove();
      };
    }
    $$('[data-act]').forEach(function (button) {
      button.onclick = function () {
        var card = button.closest('.event');
        var id = card && card.dataset.id;
        var act = button.dataset.act;
        if (act === 'copy') return copyText(button.dataset.link);
        var ev = rows.filter(function (r) {
          return r.id === id;
        })[0];
        if (!ev) return;
        if (act === 'delete') return deleteEvent(ev, button);
        setStatus(ev, act, button);
      };
    });
  }

  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () {
          toast('Link copied');
        },
        function () {
          prompt('Copy this link', value);
        },
      );
    } else {
      prompt('Copy this link', value);
    }
  }

  function setStatus(ev, status, button) {
    if (status === 'cancelled') {
      var ok = confirm(
        'Cancel “' +
          ev.title +
          '”?\n\nEveryone who said they’re going or interested will be told, and the event comes off their calendars. You can’t undo this for them.',
      );
      if (!ok) return;
    }
    if (status === 'published' && !isVerified()) {
      toast('Confirm your email first.');
      return go('#/verify');
    }
    setBusy(button, true);
    rpc('public_event_set_status', { p_id: ev.id, p_status: status })
      .then(function () {
        toast(
          status === 'published'
            ? 'Published. People can find it now.'
            : status === 'cancelled'
              ? 'Cancelled. Everyone going has been told.'
              : 'Taken off the public list.',
        );
        screenEvents();
      })
      .catch(function (err) {
        setBusy(button, false);
        var message = friendly(err);
        if (/email_unverified/.test(err.message || '')) {
          toast(message);
          return go('#/verify');
        }
        alert(message);
      });
  }

  function deleteEvent(ev, button) {
    var ok = confirm(
      'Delete “' +
        ev.title +
        '”?' +
        (ev.status === 'published'
          ? '\n\nIt’s published, so everyone going will be told it’s cancelled and it comes off their calendars.'
          : '') +
        '\n\nThis can’t be undone.',
    );
    if (!ok) return;
    setBusy(button, true);
    rpc('public_event_delete', { p_id: ev.id })
      .then(function () {
        toast('Deleted.');
        screenEvents();
      })
      .catch(function (err) {
        setBusy(button, false);
        alert(friendly(err));
      });
  }

  // --- event form --------------------------------------------------------------

  function options(list, selected) {
    return list
      .map(function (item) {
        var value = Array.isArray(item) ? item[0] : item;
        var label = Array.isArray(item) ? item[1] : item;
        return (
          '<option value="' +
          esc(value) +
          '"' +
          (value === selected ? ' selected' : '') +
          '>' +
          esc(label) +
          '</option>'
        );
      })
      .join('');
  }

  function screenForm(id) {
    if (!id) return renderForm(null);
    loading();
    sb.from('public_events')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data) {
          render(
            '<h1>Edit event</h1>' +
              notice('error', 'We couldn’t find that event.') +
              '<a class="btn" href="#/events">Back to your events</a>',
          );
          return;
        }
        renderForm(res.data);
      })
      .catch(function (err) {
        render(
          '<h1>Edit event</h1>' +
            notice('error', esc(friendly(err))) +
            '<a class="btn" href="#/events">Back to your events</a>',
        );
      });
  }

  function renderForm(ev) {
    var editing = !!ev;
    ev = ev || {};
    var tz = safeTz(ev.timezone || 'Europe/London');
    var starts = isoToZoned(ev.starts_at, tz);
    var ends = isoToZoned(ev.ends_at, tz);
    var pounds = ev.price_from_pence != null ? (ev.price_from_pence / 100).toFixed(2) : '';
    render(
      '<div class="page-head"><h1>' +
        (editing ? 'Edit event' : 'New event') +
        '</h1><a class="btn small" href="#/events">Back</a></div>' +
        (editing && ev.status === 'published'
          ? notice(
              'info',
              'This event is live. If you change the time or place, everyone going will be told.',
            )
          : '') +
        '<form id="event-form" novalidate>' +
        '<section class="card"><h2>What</h2>' +
        '<label class="field"><span>Title</span><input type="text" name="title" maxlength="120" required value="' +
        esc(ev.title) +
        '" /></label>' +
        '<div class="two">' +
        '<label class="field"><span>Category</span><select name="category">' +
        options(CATEGORIES, ev.category || 'other') +
        '</select></label>' +
        '<label class="field"><span>Tags (optional, comma separated)</span><input type="text" name="tags" placeholder="jazz, live, outdoors" value="' +
        esc((ev.tags || []).join(', ')) +
        '" /><div class="hint">Up to 8.</div></label></div>' +
        '<label class="field"><span>Description</span><textarea name="description" maxlength="4000" placeholder="What happens, who it’s for, what to bring.">' +
        esc(ev.description) +
        '</textarea></label>' +
        '<div class="field-label">Cover picture (optional)</div>' +
        '<div class="cover-preview" id="cover-preview"' +
        (ev.cover_image_path
          ? ' style="background-image: url(&quot;' + esc(coverUrl(ev.cover_image_path)) + '&quot;)"'
          : '') +
        '></div>' +
        '<div class="actions" style="margin-top: 0; margin-bottom: 8px"><input type="file" name="cover" accept="image/*" />' +
        '<button type="button" class="btn small" id="cover-remove"' +
        (ev.cover_image_path ? '' : ' hidden') +
        '>Remove picture</button></div>' +
        '<input type="hidden" name="cover_image_path" value="' +
        esc(ev.cover_image_path) +
        '" />' +
        '</section>' +
        '<section class="card"><h2>When</h2>' +
        '<div class="two">' +
        '<label class="field"><span>Starts</span><input type="date" name="starts_date" required value="' +
        starts.date +
        '" /></label>' +
        '<label class="field"><span>Time</span><input type="time" name="starts_time" required value="' +
        starts.time +
        '" /></label>' +
        '<label class="field"><span>Ends</span><input type="date" name="ends_date" required value="' +
        ends.date +
        '" /></label>' +
        '<label class="field"><span>Time</span><input type="time" name="ends_time" required value="' +
        ends.time +
        '" /></label></div>' +
        '<label class="field"><span>Time zone</span><select name="timezone">' +
        options(TIMEZONES, tz) +
        '</select></label>' +
        '</section>' +
        '<section class="card"><h2>Where</h2>' +
        '<label class="field"><span>Venue name</span><input type="text" name="venue_name" maxlength="120" placeholder="The Old Crown" value="' +
        esc(ev.venue_name) +
        '" /></label>' +
        '<label class="field"><span>Address</span><input type="text" name="address" maxlength="300" placeholder="12 High Street, Hackney, London E8 1AA" value="' +
        esc(ev.address) +
        '" /></label>' +
        '<div class="actions" style="margin: 0 0 12px"><button type="button" class="btn" id="geocode">Find on map</button><span class="muted small" id="geo-status"></span></div>' +
        '<div class="two">' +
        '<label class="field"><span>Latitude</span><input type="number" name="lat" step="any" min="-90" max="90" value="' +
        esc(ev.lat) +
        '" /></label>' +
        '<label class="field"><span>Longitude</span><input type="number" name="lon" step="any" min="-180" max="180" value="' +
        esc(ev.lon) +
        '" /></label></div>' +
        '<div class="hint" id="geo-check"></div>' +
        '<div class="hint">People find events by place, so an event needs a pin on the map before it can be published. Find on map fills these in; you can also type them.</div>' +
        '</section>' +
        '<section class="card"><h2>Tickets</h2>' +
        '<label class="check"><input type="checkbox" name="is_free"' +
        (ev.is_free === false ? '' : ' checked') +
        ' /> Free to attend</label>' +
        '<div class="two" id="price-row"' +
        (ev.is_free === false ? '' : ' hidden') +
        '>' +
        '<label class="field"><span>From (price of the cheapest ticket)</span><input type="number" name="price" step="0.01" min="0" placeholder="12.00" value="' +
        esc(pounds) +
        '" /></label>' +
        '<label class="field"><span>Currency</span><select name="currency">' +
        options(CURRENCIES, ev.currency || 'GBP') +
        '</select></label></div>' +
        '<label class="field"><span>Ticket link (optional)</span><input type="url" name="ticket_url" maxlength="500" placeholder="https://" value="' +
        esc(ev.ticket_url) +
        '" /><div class="hint">Where tickets are sold. We don’t take payments.</div></label>' +
        '<div class="two">' +
        '<label class="field"><span>Capacity (optional)</span><input type="number" name="capacity" min="1" step="1" value="' +
        esc(ev.capacity) +
        '" /></label>' +
        '<label class="field"><span>Minimum age (optional)</span><input type="number" name="min_age" min="0" max="99" step="1" placeholder="18" value="' +
        esc(ev.min_age) +
        '" /></label></div>' +
        '<label class="field"><span>Accessibility notes (optional)</span><textarea name="accessibility" maxlength="500" placeholder="Step-free entrance, accessible toilet, hearing loop…" style="min-height: 72px">' +
        esc(ev.accessibility) +
        '</textarea></label>' +
        '</section>' +
        '<div class="notice error" id="err" hidden></div>' +
        '<div class="form-foot"><button class="btn primary" type="submit">' +
        (editing ? 'Save changes' : 'Save as draft') +
        '</button><a class="btn" href="#/events">Cancel</a></div>' +
        '</form>',
    );
    var form = $('#event-form');
    var err = $('#err');
    var coverFile = null;
    var endsTouched = !!ev.ends_at;

    // End follows the start by two hours until someone changes it by hand.
    function syncEnd() {
      var tzNow = $('[name=timezone]').value;
      var iso = zonedToIso($('[name=starts_date]').value, $('[name=starts_time]').value, tzNow);
      if (!iso) return;
      if (endsTouched) return;
      var end = isoToZoned(new Date(new Date(iso).getTime() + 2 * 3600000).toISOString(), tzNow);
      $('[name=ends_date]').value = end.date;
      $('[name=ends_time]').value = end.time;
    }
    $('[name=starts_date]').onchange = syncEnd;
    $('[name=starts_time]').onchange = syncEnd;
    $('[name=ends_date]').onchange = $('[name=ends_time]').onchange = function () {
      endsTouched = true;
    };
    // Changing the zone keeps the clock times, so the instant moves with it.
    $('[name=is_free]').onchange = function () {
      $('#price-row').hidden = this.checked;
    };
    $('[name=cover]').onchange = function () {
      var file = this.files && this.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        showError(err, 'Choose a picture (JPEG, PNG or WebP).');
        this.value = '';
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        showError(err, 'That picture is over 8 MB. Choose a smaller one.');
        this.value = '';
        return;
      }
      coverFile = file;
      $('#cover-preview').style.backgroundImage = 'url("' + URL.createObjectURL(file) + '")';
      $('#cover-remove').hidden = false;
    };
    $('#cover-remove').onclick = function () {
      coverFile = null;
      $('[name=cover]').value = '';
      $('[name=cover_image_path]').value = '';
      $('#cover-preview').style.backgroundImage = '';
      this.hidden = true;
    };
    function updateGeoCheck() {
      var lat = parseFloat($('[name=lat]').value);
      var lon = parseFloat($('[name=lon]').value);
      var box = $('#geo-check');
      if (isNaN(lat) || isNaN(lon)) {
        box.innerHTML = '';
        return;
      }
      box.innerHTML =
        'Looks right? <a href="https://maps.google.com/?q=' +
        lat +
        ',' +
        lon +
        '" target="_blank" rel="noopener">Check the pin on Google Maps</a>.';
    }
    $('[name=lat]').oninput = $('[name=lon]').oninput = updateGeoCheck;
    updateGeoCheck();
    $('#geocode').onclick = function () {
      var address = $('[name=address]').value.trim();
      var venue = $('[name=venue_name]').value.trim();
      var status = $('#geo-status');
      if (!address) {
        status.textContent = 'Type the address first.';
        return;
      }
      var button = this;
      setBusy(button, true, 'Looking…');
      status.textContent = '';
      geocode(address, venue).then(
        function (found) {
          setBusy(button, false);
          if (!found) {
            status.textContent =
              'We couldn’t place that address. Try adding the town or postcode, or type the latitude and longitude.';
            return;
          }
          $('[name=lat]').value = found.lat.toFixed(6);
          $('[name=lon]').value = found.lon.toFixed(6);
          status.textContent = 'Found' + (found.label ? ': ' + found.label : '.');
          updateGeoCheck();
        },
        function () {
          setBusy(button, false);
          status.textContent =
            'The map service didn’t answer. Try again, or type the latitude and longitude.';
        },
      );
    };

    form.onsubmit = function (e) {
      e.preventDefault();
      err.hidden = true;
      var v = function (name) {
        return $('[name=' + name + ']').value.trim();
      };
      var title = v('title');
      if (!title) return showError(err, 'Give the event a title.');
      var tzNow = v('timezone');
      var startsAt = zonedToIso(v('starts_date'), v('starts_time'), tzNow);
      var endsAt = zonedToIso(v('ends_date'), v('ends_time'), tzNow);
      if (!startsAt) return showError(err, 'Enter when it starts.');
      if (!endsAt) return showError(err, 'Enter when it ends.');
      if (new Date(endsAt) <= new Date(startsAt))
        return showError(err, 'The end has to come after the start.');
      var tags = v('tags')
        .split(',')
        .map(function (t) {
          return t.trim().slice(0, 30);
        })
        .filter(Boolean);
      if (tags.length > 8) return showError(err, 'Up to 8 tags, please.');
      var isFree = $('[name=is_free]').checked;
      var pence = null;
      if (!isFree) {
        var amount = parseFloat(v('price'));
        if (isNaN(amount) || amount < 0)
          return showError(err, 'Enter the price of the cheapest ticket, or tick Free.');
        pence = Math.round(amount * 100);
      }
      var ticket = v('ticket_url');
      if (ticket && !/^https?:\/\//i.test(ticket)) {
        if (/^[\w.-]+\.[a-z]{2,}/i.test(ticket)) ticket = 'https://' + ticket;
        else return showError(err, 'The ticket link must start with http:// or https://.');
      }
      var lat = v('lat') === '' ? null : parseFloat(v('lat'));
      var lon = v('lon') === '' ? null : parseFloat(v('lon'));
      if ((lat === null) !== (lon === null))
        return showError(err, 'Enter both latitude and longitude, or neither.');
      if (lat !== null && (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180))
        return showError(err, 'Those coordinates don’t look right.');
      var capacity = v('capacity') === '' ? null : parseInt(v('capacity'), 10);
      if (capacity !== null && (isNaN(capacity) || capacity < 1))
        return showError(err, 'Capacity must be a whole number above 0.');
      var minAge = v('min_age') === '' ? null : parseInt(v('min_age'), 10);
      if (minAge !== null && (isNaN(minAge) || minAge < 0 || minAge > 99))
        return showError(err, 'Minimum age must be between 0 and 99.');

      var button = $('button[type=submit]', form);
      setBusy(button, true, 'Saving…');
      var upload = Promise.resolve($('[name=cover_image_path]').value || null);
      if (coverFile) {
        var ext =
          (coverFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') ||
          'jpg';
        var path = uid() + '/public-events/' + Date.now() + '.' + ext;
        upload = sb.storage
          .from('hero')
          .upload(path, coverFile, { upsert: true, contentType: coverFile.type })
          .then(function (res) {
            if (res.error)
              throw new Error(
                'We couldn’t upload the picture: ' + (res.error.message || 'try again.'),
              );
            return path;
          });
      }
      upload
        .then(function (coverPath) {
          var payload = {
            title: title,
            category: v('category'),
            tags: tags,
            description: v('description') || null,
            cover_image_path: coverPath,
            starts_at: startsAt,
            ends_at: endsAt,
            timezone: tzNow,
            venue_name: v('venue_name') || null,
            address: v('address') || null,
            lat: lat,
            lon: lon,
            is_free: isFree,
            price_from_pence: pence,
            currency: v('currency') || 'GBP',
            ticket_url: ticket || null,
            capacity: capacity,
            min_age: minAge,
            accessibility: v('accessibility') || null,
          };
          if (editing) payload.id = ev.id;
          return rpc('public_event_save', { p: payload });
        })
        .then(function (saved) {
          setBusy(button, false);
          state.events = null;
          if (editing) toast('Saved.');
          else if (saved && saved.lat != null)
            toast('Saved as a draft. Publish it when you’re ready.');
          else toast('Saved as a draft. Add the place before publishing.');
          go('#/events');
        })
        .catch(function (ex) {
          setBusy(button, false);
          showError(err, friendly(ex));
          err.scrollIntoView({ block: 'center' });
        });
    };
  }

  // Address -> { lat, lon, label }. UK postcodes first (postcodes.io), then
  // OpenStreetMap, then a town lookup as a last resort. null when nothing fits.
  var UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
  function getJson(url) {
    return fetch(url, { headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function geocode(address, venue) {
    var m = address.match(UK_POSTCODE);
    var first = m
      ? getJson(
          'https://api.postcodes.io/postcodes/' + encodeURIComponent(m[1].replace(/\s+/g, '')),
        )
          .then(function (data) {
            var r = data && data.result;
            if (r && typeof r.latitude === 'number')
              return {
                lat: r.latitude,
                lon: r.longitude,
                label: [r.admin_district, r.postcode].filter(Boolean).join(', '),
              };
            return null;
          })
          .catch(function () {
            return null;
          })
      : Promise.resolve(null);
    return first
      .then(function (found) {
        if (found) return found;
        var q = (venue ? venue + ', ' : '') + address;
        return getJson(
          'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
            encodeURIComponent(q),
        )
          .then(function (list) {
            var r = list && list[0];
            if (r && r.lat)
              return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), label: r.display_name };
            if (venue) {
              return getJson(
                'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
                  encodeURIComponent(address),
              ).then(function (again) {
                var s = again && again[0];
                return s && s.lat
                  ? { lat: parseFloat(s.lat), lon: parseFloat(s.lon), label: s.display_name }
                  : null;
              });
            }
            return null;
          })
          .catch(function () {
            return null;
          });
      })
      .then(function (found) {
        if (found) return found;
        var parts = address.split(',').map(function (s) {
          return s.trim();
        });
        var town =
          parts.length > 1
            ? parts[parts.length - 1].replace(UK_POSTCODE, '').trim() || parts[parts.length - 2]
            : parts[0];
        if (!town) return null;
        return getJson(
          'https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(town),
        ).then(function (data) {
          var r = data && data.results && data.results[0];
          if (!r) return null;
          return {
            lat: r.latitude,
            lon: r.longitude,
            label:
              [r.name, r.admin1, r.country].filter(Boolean).join(', ') +
              ' (town centre: check the pin)',
          };
        });
      });
  }

  // --- stats -------------------------------------------------------------------

  function screenStats(id) {
    loading();
    var meta = (state.events || []).filter(function (r) {
      return r.id === id;
    })[0];
    var metaP = meta
      ? Promise.resolve(meta)
      : sb
          .from('public_events')
          .select('id, title, slug, status, timezone, starts_at, ends_at')
          .eq('id', id)
          .maybeSingle()
          .then(function (res) {
            if (res.error) throw res.error;
            return res.data;
          });
    Promise.all([metaP, rpc('public_event_stats', { p_id: id })])
      .then(function (results) {
        var ev = results[0];
        var stats = results[1];
        if (!ev || !stats) {
          render(
            '<h1>Stats</h1>' +
              notice('error', 'We couldn’t find that event.') +
              '<a class="btn" href="#/events">Back to your events</a>',
          );
          return;
        }
        renderStats(ev, stats);
      })
      .catch(function (err) {
        render(
          '<h1>Stats</h1>' +
            notice('error', esc(friendly(err))) +
            '<a class="btn" href="#/events">Back to your events</a>',
        );
      });
  }

  function renderStats(ev, stats) {
    var tz = safeTz(ev.timezone || 'Europe/London');
    var byDay = {};
    (stats.by_day || []).forEach(function (d) {
      byDay[d.day] = Number(d.views) || 0;
    });
    var days = [];
    var max = 0;
    for (var i = 29; i >= 0; i--) {
      var date = new Date(Date.now() - i * 86400000);
      var key = isoToZoned(date.toISOString(), tz).date;
      var n = byDay[key] || 0;
      if (n > max) max = n;
      days.push({ key: key, n: n, date: date });
    }
    var bars = days
      .map(function (d) {
        var h = max ? Math.max(d.n ? 3 : 0, Math.round((d.n / max) * 100)) : 0;
        var label = d.date.toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: tz,
        });
        return (
          '<div class="bar" data-tip="' +
          esc(label + ': ' + d.n + (d.n === 1 ? ' view' : ' views')) +
          '"><i style="height: ' +
          h +
          '%"></i></div>'
        );
      })
      .join('');
    var sources = stats.by_source || {};
    var sourceTotal = ['app', 'web', 'share'].reduce(function (sum, k) {
      return sum + (Number(sources[k]) || 0);
    }, 0);
    var sourceLabels = { app: 'In the app', web: 'Website', share: 'Shared link' };
    var sourceRows = ['app', 'web', 'share']
      .map(function (k) {
        var n = Number(sources[k]) || 0;
        var pct = sourceTotal ? Math.round((n / sourceTotal) * 100) : 0;
        return (
          '<div class="source"><span>' +
          sourceLabels[k] +
          '</span><span class="track"><i style="width: ' +
          pct +
          '%"></i></span><span class="v">' +
          n +
          '</span></div>'
        );
      })
      .join('');
    var names = stats.going_names || [];
    function tile(n, label) {
      return (
        '<div class="tile"><div class="n">' +
        esc(n) +
        '</div><div class="l">' +
        label +
        '</div></div>'
      );
    }
    render(
      '<div class="page-head"><div><h1>' +
        esc(ev.title) +
        '</h1><p class="muted">' +
        esc(fmtWhen(ev.starts_at, ev.ends_at, ev.timezone)) +
        ' · ' +
        statusBadge(ev.status) +
        '</p></div><a class="btn small" href="#/events">Back</a></div>' +
        '<div class="tiles">' +
        tile(stats.views || 0, 'Views') +
        tile(stats.unique_viewers || 0, 'People who looked') +
        tile(stats.going || 0, 'Going') +
        tile(stats.interested || 0, 'Interested') +
        tile(stats.calendar_adds || 0, 'Calendar adds') +
        '</div>' +
        '<div class="card"><h3>Views in the last 30 days</h3>' +
        (max
          ? '<div class="chart" role="img" aria-label="Views by day">' +
            bars +
            '</div><div class="chart-axis"><span>' +
            esc(
              days[0].date.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                timeZone: tz,
              }),
            ) +
            '</span><span>Today</span></div>'
          : '<p class="muted">No views yet. Share the link to get the word out.</p>') +
        '</div>' +
        '<div class="card"><h3>Where views came from</h3>' +
        (sourceTotal
          ? '<div class="sources">' + sourceRows + '</div>'
          : '<p class="muted">Nothing yet.</p>') +
        '</div>' +
        '<div class="card"><h3>Who’s going</h3>' +
        (names.length
          ? '<ul class="names">' +
            names
              .map(function (n) {
                return '<li>' + esc(n) + '</li>';
              })
              .join('') +
            '</ul>'
          : '<p class="muted">No one has said they’re going yet.</p>') +
        '</div>' +
        '<p class="muted small">We only keep numbers about views, never who looked. First names of people going are shown because they chose to say so.</p>',
    );
  }

  // --- start ----------------------------------------------------------------------

  document.getElementById('sign-out').onclick = function () {
    sb.auth.signOut().catch(function () {});
    state.session = null;
    state.organiser = undefined;
    state.events = null;
    go('#/sign-in');
  };

  window.addEventListener('hashchange', route);

  if (!sb) {
    state.ready = true;
    render(
      '<h1>Dayli for organisers</h1>' +
        notice('error', 'This page can’t start: its settings are missing. Try again later.'),
      true,
    );
    return;
  }

  if (/[?&]reset=1/.test(location.search)) state.recovery = true;

  sb.auth.onAuthStateChange(function (event, session) {
    // Supabase asks that we don't call it from inside this callback.
    setTimeout(function () {
      if (event === 'INITIAL_SESSION') return;
      var before = uid();
      state.session = session;
      if (event === 'PASSWORD_RECOVERY') {
        state.recovery = true;
        return go('#/reset');
      }
      if (event === 'SIGNED_OUT') {
        state.organiser = undefined;
        state.events = null;
        if (state.ready) go('#/sign-in');
        return;
      }
      if (event === 'SIGNED_IN' && uid() !== before) {
        state.organiser = undefined;
        state.events = null;
        if (state.ready) {
          if (state.recovery) return go('#/reset');
          route();
        }
      }
    }, 0);
  });

  sb.auth
    .getSession()
    .then(function (res) {
      state.session = (res.data && res.data.session) || null;
    })
    .catch(function () {
      state.session = null;
    })
    .then(function () {
      state.ready = true;
      if (state.recovery) {
        history.replaceState(null, '', location.pathname + '#/reset');
      }
      route();
    });
})();
