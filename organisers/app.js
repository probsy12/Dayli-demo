/* Dayli for organisers: a small single-page app in plain browser JavaScript.
 * Routes live in the hash (#/overview, #/events, #/events/new, #/events/<id>,
 * #/analytics/<id>?tab=…, #/profile). Data comes from the Supabase project in
 * ../config.js through supabase-js (vendor/supabase.js) and the RPCs in
 * supabase/migrations/20261027000100_public_events.sql and
 * 20261028000100_organiser_analytics.sql. The Overview and Analytics screens
 * live in analytics.js; the admin's growth dashboard (#/admin) in admin.js. */
(function () {
  'use strict';

  var cfg = window.DAYLI_CONFIG || {};
  var app = document.getElementById('app');
  var side = document.getElementById('side');
  var topbar = document.getElementById('topbar');
  var tabsNav = document.getElementById('tabs-nav');
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
    admin: false, // on the admin list (is_admin()); shows the Admin section
    pendingEmail: null, // an address we've just emailed a code to
    codeSent: false,
    recovery: false,
    events: null,
    overview: null,
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
        return sb.rpc('is_admin').then(
          function (r) {
            state.admin = r.data === true;
            return state.organiser;
          },
          function () {
            state.admin = false;
            return state.organiser;
          },
        );
      });
  }
  function isVerified() {
    return !!(state.organiser && state.organiser.email_verified_at);
  }

  // Where a signed-in person should be: profile first, then a confirmed
  // email, then their events.
  function homeHash() {
    if (!state.organiser) return state.admin ? '#/admin' : '#/profile';
    if (!isVerified()) return '#/verify';
    return '#/overview';
  }

  // The sidebar (wide screens) or top bar + tabs (narrow) show once signed in.
  var menuOpen = false;
  function setShell(signedIn, current) {
    document.body.classList.toggle('auth', !signedIn);
    side.hidden = !signedIn;
    topbar.hidden = !signedIn;
    tabsNav.hidden = !signedIn;
    var links = Array.prototype.slice.call(document.querySelectorAll('a[data-route]'));
    links.forEach(function (a) {
      a.classList.toggle('on', a.dataset.route === current);
      if (a.dataset.route === 'admin') a.hidden = !state.admin;
    });
    var account = document.getElementById('account');
    if (signedIn && account) {
      account.innerHTML =
        '<b>' +
        esc(state.organiser ? state.organiser.name : 'New organiser') +
        '</b><span>' +
        esc(email() || '') +
        (state.organiser ? (isVerified() ? ' · verified' : ' · not confirmed') : '') +
        '</span>';
    }
    closeMenu();
  }
  function closeMenu() {
    menuOpen = false;
    var sheet = document.getElementById('menu-sheet');
    if (sheet) sheet.remove();
    document.getElementById('menu').setAttribute('aria-expanded', 'false');
  }
  document.getElementById('menu').onclick = function () {
    if (menuOpen) return closeMenu();
    menuOpen = true;
    this.setAttribute('aria-expanded', 'true');
    var sheet = document.createElement('div');
    sheet.className = 'menu-sheet';
    sheet.id = 'menu-sheet';
    sheet.innerHTML =
      '<a href="#/overview">Overview</a><a href="#/events">Events</a><a href="#/analytics">Analytics</a><a href="#/payouts">Tickets &amp; payouts</a><a href="#/profile">Profile</a>' +
      (state.admin ? '<a href="#/admin">Admin</a>' : '') +
      '<a href="#/events/new">+ New event</a><button type="button" class="linkish" id="menu-sign-out" style="padding: 12px">Sign out</button>';
    document.body.appendChild(sheet);
    document.getElementById('menu-sign-out').onclick = signOut;
  };

  // --- router ----------------------------------------------------------------

  function route() {
    if (!state.ready) return;
    var hash = location.hash.replace(/^#/, '');
    if (hash.charAt(0) !== '/') hash = '/overview';
    var parts = hash.split('?')[0].split('/').filter(Boolean);
    var query = {};
    (hash.split('?')[1] || '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      query[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = decodeURIComponent(i < 0 ? '' : kv.slice(i + 1));
    });
    var signedIn = !!state.session;
    if (parts[0] !== 'checkin') tickets.stopCamera();
    setShell(signedIn && state.organiser !== undefined, parts[0]);

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
      case 'overview':
        if (!state.organiser) return screenProfile(true);
        setShell(true, 'overview');
        return analytics.screenOverview();
      case 'analytics':
        if (!state.organiser) return screenProfile(true);
        setShell(true, 'analytics');
        return analytics.screenAnalytics(parts[1] || null, query.tab, query.days);
      case 'admin':
        if (!state.admin) return go(homeHash());
        setShell(true, 'admin');
        return admin.screen(query.tab, query.days);
      case 'payouts':
        if (!state.organiser) return screenProfile(true);
        setShell(true, 'payouts');
        return tickets.payouts(query);
      case 'tickets':
      case 'checkin':
        if (!state.organiser) return screenProfile(true);
        if (!parts[1]) return go('#/payouts');
        setShell(true, 'payouts');
        return parts[0] === 'tickets' ? tickets.eventScreen(parts[1], query) : tickets.checkin(parts[1]);
      case 'events':
        if (!state.organiser) return screenProfile(true);
        setShell(true, 'events');
        if (parts[1] === 'new') return screenForm(null, query.from || null);
        if (parts[1] && parts[2] === 'stats') return go('#/analytics/' + parts[1]);
        if (parts[1]) return screenForm(parts[1]);
        return screenEvents();
      default:
        return go('#/overview');
    }
  }

  var analytics = window.DayliAnalytics({
    sb: sb,
    esc: esc,
    $: $,
    $$: $$,
    rpc: rpc,
    render: render,
    loading: loading,
    notice: notice,
    toast: toast,
    go: go,
    friendly: friendly,
    state: state,
    SITE: SITE,
    setBusy: setBusy,
    copyText: copyText,
    isVerified: isVerified,
    fmtWhen: fmtWhen,
    statusBadge: statusBadge,
    categoryLabel: categoryLabel,
    isoToZoned: isoToZoned,
    safeTz: safeTz,
  });
  var tickets = window.DayliTickets({
    sb: sb,
    esc: esc,
    $: $,
    $$: $$,
    rpc: rpc,
    render: render,
    loading: loading,
    notice: notice,
    toast: toast,
    friendly: friendly,
    setBusy: setBusy,
    uid: uid,
    kpi: analytics.ui.kpi,
    go: go,
  });
  var admin = window.DayliAdmin(
    {
      tickets: tickets,
      sb: sb,
      esc: esc,
      $: $,
      $$: $$,
      rpc: rpc,
      render: render,
      loading: loading,
      notice: notice,
      toast: toast,
      go: go,
      friendly: friendly,
      setBusy: setBusy,
      categoryLabel: categoryLabel,
    },
    analytics.ui,
  );

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
            go('#/overview');
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
        (state.session ? '<a href="#/overview">Later</a>' : '<a href="#/sign-in">Back</a>') +
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
          go(state.afterVerify || '#/overview');
          state.afterVerify = null;
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
    var initialsOf = function (name) {
      return (name || '?')
        .split(/\s+/)
        .map(function (w) {
          return w.charAt(0);
        })
        .join('')
        .slice(0, 2)
        .toUpperCase();
    };
    var initials = initialsOf(o.name || email());
    var logoUrl = o.logo_path ? coverUrl(o.logo_path) : '';
    var mark = function (id, size) {
      return (
        '<span class="pa-logo" id="' +
        id +
        '" style="width: ' +
        size +
        'px; height: ' +
        size +
        'px; font-size: ' +
        Math.round(size * 0.4) +
        'px' +
        (logoUrl ? '; background-image: url(&quot;' + esc(logoUrl) + '&quot;)' : '') +
        '">' +
        (logoUrl ? '' : esc(initials)) +
        '</span>'
      );
    };
    var steps = first
      ? '<div class="steps"><b>1</b><span>Who you are</span><em></em><b class="off">2</b><span class="off">Confirm email</span><em></em><b class="off">3</b><span class="off">First event</span></div>'
      : '';
    var section = function (title, sub, body) {
      return '<div class="pa-sec"><div><h2>' + title + '</h2><p>' + sub + '</p></div><div>' + body + '</div></div>';
    };
    var form =
      '<form id="profile-form" novalidate>' +
      section(
        'Who you are',
        'Your name or your venue’s, as people will know it. Shown on every event you list.',
        '<div class="pa-logo-row">' +
          mark('avatar', 76) +
          '<div><label class="btn" style="cursor: pointer">Upload a logo<input type="file" name="logo" accept="image/png,image/jpeg,image/webp" hidden /></label>' +
          '<button type="button" class="btn ghost" id="logo-remove"' +
          (logoUrl ? '' : ' hidden') +
          '>Remove</button><div class="muted small" style="margin-top: 6px">Square works best, at least 400 px. Until then your initials stand in.</div></div></div>' +
          '<label class="field"><span>Organiser name</span><input type="text" name="name" maxlength="80" required placeholder="You, your venue or your group" value="' +
          esc(o.name) +
          '" /></label>' +
          '<label class="field"><span>About</span><textarea name="bio" maxlength="1000" placeholder="Stand-up nights in East London pubs since 2019.">' +
          esc(o.bio) +
          '</textarea><div class="hint" id="bio-count"></div></label>',
      ) +
      section(
        'Where to find you',
        'Optional links shown under your name.',
        '<div class="two"><label class="field"><span>Website</span><input type="url" name="website" maxlength="200" placeholder="https://" value="' +
          esc(o.website) +
          '" /></label><label class="field"><span>Instagram</span><input type="text" name="instagram" maxlength="60" placeholder="@yourname" value="' +
          esc(o.instagram) +
          '" /></label></div>',
      ) +
      '<div class="notice error" id="err" hidden></div>' +
      '<div class="pa-save"><button class="btn primary" type="submit">' +
      (first ? 'Continue' : 'Save profile') +
      '</button></div></form>';
    var account = first
      ? ''
      : section(
          'Your account',
          'Signed in as <b>' + esc(email()) + '</b>. ' + (isVerified() ? 'Email confirmed.' : 'Email not confirmed yet: <a href="#/verify">confirm it</a> before publishing.'),
          '<label class="switch"><input type="checkbox" id="alerts"' +
            (o.alerts === false ? '' : ' checked') +
            ' /> Push me when an event reaches 10, 25, 50, 100 going, and a summary the day after each event.</label>' +
            '<p class="muted small" style="margin: 12px 0">The same email works in the Dayli app, where your events show under Events → Hosting. The app signs in with an emailed code.</p>' +
            '<details><summary class="btn small" style="display: inline-flex">Change password</summary>' +
            '<form id="pw-form" novalidate style="margin-top: 12px; max-width: 360px">' +
            '<label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" minlength="8" /></label>' +
            '<div class="notice error" id="pw-err" hidden></div>' +
            '<button class="btn small" type="submit">Save password</button></form></details>',
        );
    var preview =
      '<div class="pa-stick"><div class="label" style="margin-bottom: 10px">How you’ll appear</div>' +
      '<div class="pa-card"><div class="pa-banner"></div><div class="pa-card-body"><div class="pa-who">' +
      mark('pv-avatar', 48) +
      '<div><b id="pv-name">' +
      esc(o.name || 'Your name') +
      '</b><div class="muted small">Organiser on Dayli</div></div></div><p id="pv-bio">' +
      esc(o.bio || 'A few words about you.') +
      '</p><div id="pv-links"></div></div></div>' +
      '<p class="muted small" style="margin-top: 12px">Under every event you list, in the app and on its web page.</p></div>';
    render(
      '<div class="pa"><div class="pa-kick">Profile</div><h1>' +
        (first ? 'Welcome to Dayli' : 'Your organiser profile') +
        '</h1><p class="pa-lead">' +
        (first ? 'Tell people who you are. You can change it any time.' : 'Shown on every event you list. Keep it short and friendly.') +
        '</p>' +
        (forced ? notice('info', 'Set up your profile to start listing events.') : '') +
        steps +
        '<div class="pa-cols"><div>' +
        form +
        account +
        '</div><div>' +
        preview +
        '</div></div></div>',
    );
    var err = $('#err');
    var logoFile = null;
    var logoPath = o.logo_path || null;
    function setMark(url, ini) {
      ['#avatar', '#pv-avatar'].forEach(function (sel) {
        var el = $(sel);
        el.style.backgroundImage = url ? 'url("' + url + '")' : '';
        el.textContent = url ? '' : ini;
      });
    }
    function syncPreview() {
      var name = $('[name=name]').value.trim();
      var bio = $('[name=bio]').value.trim();
      $('#pv-name').textContent = name || 'Your name';
      $('#pv-bio').textContent = bio || 'A few words about you.';
      $('#bio-count').textContent = bio.length ? bio.length + ' of 1000' : '';
      if (!logoFile && !logoPath) setMark('', initialsOf(name));
      var links = [];
      var site = $('[name=website]').value.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
      var ig = $('[name=instagram]').value.trim().replace(/^@/, '');
      if (site) links.push(site);
      if (ig) links.push('@' + ig);
      $('#pv-links').innerHTML = links
        .map(function (l) {
          return '<span class="pa-chip">' + esc(l) + '</span>';
        })
        .join('');
    }
    $('#profile-form').oninput = syncPreview;
    syncPreview();
    $('[name=logo]').onchange = function () {
      var file = this.files && this.files[0];
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return showError(err, 'Choose a PNG, JPEG or WebP picture.');
      if (file.size > 5 * 1024 * 1024) return showError(err, 'That picture is over 5 MB. Choose a smaller one.');
      logoFile = file;
      setMark(URL.createObjectURL(file), '');
      $('#logo-remove').hidden = false;
    };
    $('#logo-remove').onclick = function () {
      logoFile = null;
      logoPath = null;
      $('[name=logo]').value = '';
      this.hidden = true;
      setMark('', initialsOf($('[name=name]').value.trim()));
    };
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
          state.organiser = row || state.organiser || { name: name };
          if (!logoFile && logoPath === (o.logo_path || null)) return row;
          var up = Promise.resolve(logoPath);
          if (logoFile) {
            var ext = logoFile.type === 'image/png' ? 'png' : logoFile.type === 'image/webp' ? 'webp' : 'jpg';
            var path = uid() + '/logo-' + Date.now() + '.' + ext;
            up = sb.storage
              .from('hero')
              .upload(path, logoFile, { upsert: true, contentType: logoFile.type })
              .then(function (res) {
                if (res.error) throw new Error('We couldn’t upload the logo: ' + (res.error.message || 'try again.'));
                return path;
              });
          }
          return up.then(function (p) {
            return rpc('organiser_logo_set', { p_path: p }).then(function () {
              state.organiser.logo_path = p;
              logoPath = p;
              logoFile = null;
            });
          });
        })
        .then(function () {
          setBusy(button, false);
          state.overview = null;
          toast('Profile saved.');
          if (first) {
            if (isVerified()) return go('#/events/new');
            state.afterVerify = '#/events/new';
            go('#/verify');
          }
        })
        .catch(function (ex) {
          setBusy(button, false);
          showError(err, friendly(ex));
        });
    };
    var alerts = $('#alerts');
    if (alerts) {
      alerts.onchange = function () {
        rpc('organiser_set_alerts', { p_on: alerts.checked })
          .then(function (on) {
            if (state.organiser) state.organiser.alerts = on;
            toast(on ? 'Alerts on.' : 'Alerts off.');
          })
          .catch(function (ex) {
            alert(friendly(ex));
          });
      };
    }
    var pw = $('#pw-form');
    if (pw) {
      pw.onsubmit = function (e) {
        e.preventDefault();
        var pwErr = $('#pw-err');
        pwErr.hidden = true;
        var password = $('#pw-form [name=password]').value;
        if (password.length < 8) return showError(pwErr, 'Use a password of at least 8 characters.');
        var button = $('button[type=submit]', pw);
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
      '<div class="page-head"><div><div class="label">Events</div><h1>Your events</h1><p class="muted">' +
      (state.organiser ? 'Listed as <b>' + esc(state.organiser.name) + '</b>.' : '') +
      '</p></div><a class="btn primary" href="#/events/new">+ New event</a></div>' +
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
        '<a class="btn small" href="#/analytics/' +
        esc(ev.id) +
        '">Analytics</a>' +
        (state.organiser && state.organiser.can_sell_tickets
          ? '<a class="btn small" href="#/tickets/' + esc(ev.id) + '">Tickets</a>'
          : '') +
        (past && ev.status !== 'draft'
          ? '<a class="btn small" href="#/events/new?from=' + esc(ev.id) + '">Run it again</a>'
          : '') +
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
          '”?\n\nEveryone who said they’re going or interested will be told, and the event comes off their calendars.' +
          (state.organiser && state.organiser.can_sell_tickets
            ? ' Anyone who bought a ticket through Dayli gets a full refund.'
            : '') +
          ' You can’t undo this for them.',
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
        return status === 'cancelled' ? tickets.refundAll(ev.id) : null;
      })
      .then(function () {
        state.overview = null;
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
        state.overview = null;
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

  function screenForm(id, from) {
    if (!id && !from) return renderForm(null);
    loading();
    sb.from('public_events')
      .select('*')
      .eq('id', id || from)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        if (res.data && from) {
          // Run it again: the same event with no date, as a new draft.
          var copy = Object.assign({}, res.data);
          delete copy.id;
          copy.status = 'draft';
          copy.starts_at = null;
          copy.ends_at = null;
          return renderForm(copy, true);
        }
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

  // A small street map from OpenStreetMap tiles, with the pin in the middle.
  // Clicking the map moves the pin there. No library: tiles are placed by hand.
  function drawMap(el, lat, lon, zoom, onPick) {
    var w = el.clientWidth || 300;
    var h = el.clientHeight || 200;
    var n = Math.pow(2, zoom) * 256;
    var rad = (lat * Math.PI) / 180;
    var cx = ((lon + 180) / 360) * n;
    var cy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
    var left = cx - w / 2;
    var top = cy - h / 2;
    var max = Math.pow(2, zoom);
    var html = '';
    for (var tx = Math.floor(left / 256); tx <= Math.floor((left + w) / 256); tx++) {
      for (var ty = Math.floor(top / 256); ty <= Math.floor((top + h) / 256); ty++) {
        if (ty < 0 || ty >= max) continue;
        var wx = ((tx % max) + max) % max;
        html +=
          '<img alt="" draggable="false" onerror="this.style.visibility=\'hidden\'" src="https://tile.openstreetmap.org/' +
          zoom + '/' + wx + '/' + ty +
          '.png" style="left: ' + Math.round(tx * 256 - left) + 'px; top: ' + Math.round(ty * 256 - top) + 'px" />';
      }
    }
    el.innerHTML =
      html +
      '<span class="po-pin"></span><span class="po-zoom"><button type="button" data-z="1" aria-label="Zoom in">+</button><button type="button" data-z="-1" aria-label="Zoom out">−</button></span>' +
      '<span class="po-attr">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></span>';
    Array.prototype.forEach.call(el.querySelectorAll('[data-z]'), function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        drawMap(el, lat, lon, Math.max(3, Math.min(18, zoom + Number(b.dataset.z))), onPick);
      };
    });
    el.onclick = function (e) {
      if (e.target.closest && e.target.closest('.po-zoom, .po-attr')) return;
      var r = el.getBoundingClientRect();
      var px = left + (e.clientX - r.left);
      var py = top + (e.clientY - r.top);
      var nlon = (px / n) * 360 - 180;
      var nlat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI;
      onPick(nlat, nlon, zoom);
    };
  }

  var ENTRY = [
    ['none', 'Free, just turn up', 'No tickets. People say they’re going in the app.'],
    ['dayli', 'Tickets through Dayli', 'Free or paid tickets with a code for the door. You set them up next.'],
    ['external', 'Tickets sold elsewhere', 'Link to your own ticket page, like Eventbrite or Skiddle.'],
  ];

  function renderForm(ev, copying) {
    var editing = !!ev && !copying;
    ev = ev || {};
    var tz = safeTz(ev.timezone || 'Europe/London');
    var starts = isoToZoned(ev.starts_at, tz);
    var ends = isoToZoned(ev.ends_at, tz);
    var pounds = ev.price_from_pence != null ? (ev.price_from_pence / 100).toFixed(2) : '';
    var mode = ev.ticketing || (ev.ticket_url || ev.is_free === false ? 'external' : 'none');
    var cover = ev.cover_image_path ? coverUrl(ev.cover_image_path) : '';
    var category = ev.category || 'other';
    var tile = function (label, body) {
      return '<div class="po-tile"><b>' + label + '</b>' + body + '</div>';
    };
    render(
      '<div class="po">' +
        '<div class="page-head"><div><div class="label">' +
        (editing ? 'Edit event' : copying ? 'Run it again' : 'New event') +
        '</div></div><div class="controls"><a class="btn" href="#/events">Back</a></div></div>' +
        (editing && ev.status === 'published' ? notice('info', 'This event is live. If you change the time or place, everyone going will be told.') : '') +
        (copying ? notice('info', 'Everything but the date is copied from the last one. Set when it is and save.') : '') +
        '<form id="event-form" novalidate>' +
        // The poster: picture, title typed on it, and what people see at a glance.
        '<div class="po-hero" id="pv-cover"' +
        (cover ? ' style="background-image: url(&quot;' + esc(cover) + '&quot;)"' : '') +
        '><div class="po-hero-actions"><label class="po-glass">Change picture<input type="file" name="cover" accept="image/*" hidden /></label>' +
        '<button type="button" class="po-glass" id="cover-remove"' +
        (cover ? '' : ' hidden') +
        '>Remove</button></div>' +
        '<div class="po-hero-text"><div class="po-kicker" id="pv-kicker"></div>' +
        '<input type="text" name="title" class="po-title" maxlength="120" required placeholder="Your event title" value="' +
        esc(ev.title) +
        '" /><div class="po-pills" id="pv-pills"></div></div></div>' +
        '<input type="hidden" name="cover_image_path" value="' +
        esc(ev.cover_image_path) +
        '" />' +
        '<div class="po-tiles">' +
        tile(
          'When',
          '<div class="po-two"><input type="date" name="starts_date" required value="' + starts.date + '" aria-label="Start date" /><input type="time" name="starts_time" required value="' + starts.time + '" aria-label="Start time" /></div>' +
            '<div class="po-two"><input type="date" name="ends_date" required value="' + ends.date + '" aria-label="End date" /><input type="time" name="ends_time" required value="' + ends.time + '" aria-label="End time" /></div>' +
            '<select name="timezone" aria-label="Time zone">' + options(TIMEZONES, tz) + '</select>',
        ) +
        tile(
          'Where',
          '<input type="text" name="venue_name" maxlength="120" placeholder="Venue, e.g. The Old Crown" value="' + esc(ev.venue_name) + '" />' +
            '<input type="text" name="address" maxlength="300" placeholder="Address and postcode" value="' + esc(ev.address) + '" />' +
            '<button type="button" class="btn small" id="geocode">Find on map</button> <span class="muted small" id="geo-status"></span>',
        ) +
        tile('Getting in', '<div class="po-entry-sum" id="entry-sum"></div><a class="small" href="#entry" id="entry-jump">Change</a>') +
        '</div>' +
        '<div class="po-body"><div>' +
        '<section class="po-block"><h3>What’s it about?</h3>' +
        '<textarea name="description" class="po-desc" maxlength="4000" placeholder="What happens, who it’s for, what to bring.">' +
        esc(ev.description) +
        '</textarea><div class="po-chips" id="cats">' +
        CATEGORIES.map(function (c) {
          return '<button type="button" class="po-chip' + (c[0] === category ? ' on' : '') + '" data-cat="' + c[0] + '">' + esc(c[1]) + '</button>';
        }).join('') +
        '</div><input type="hidden" name="category" value="' +
        esc(category) +
        '" /><label class="field" style="margin-top: 12px"><span>Tags (optional, comma separated)</span><input type="text" name="tags" placeholder="jazz, live, outdoors" value="' +
        esc((ev.tags || []).join(', ')) +
        '" /></label></section>' +
        '<section class="po-block" id="entry"><h3>How do people get in?</h3>' +
        ENTRY.map(function (m) {
          return '<button type="button" class="po-opt' + (m[0] === mode ? ' on' : '') + '" data-mode="' + m[0] + '"><span><b>' + m[1] + '</b><span>' + m[2] + '</span></span><i></i></button>';
        }).join('') +
        '<div id="ext-fields"' +
        (mode === 'external' ? '' : ' hidden') +
        '><div class="two"><label class="field"><span>From (cheapest ticket, optional)</span><input type="number" name="price" step="0.01" min="0" placeholder="12.00" value="' +
        esc(pounds) +
        '" /></label><label class="field"><span>Currency</span><select name="currency">' +
        options(CURRENCIES, ev.currency || 'GBP') +
        '</select></label></div><label class="field"><span>Ticket link</span><input type="url" name="ticket_url" maxlength="500" placeholder="https://" value="' +
        esc(ev.ticket_url) +
        '" /></label></div>' +
        '<p class="muted small" id="dayli-note"' +
        (mode === 'dayli' ? '' : ' hidden') +
        '>' +
        (editing
          ? 'Prices, early bird, codes and orders are on this event’s <a href="#/tickets/' + esc(ev.id) + '">Tickets screen</a>. The “from” price here follows your tickets.'
          : 'After saving you’ll set up the tickets: free or paid, how many, an early bird, codes. The “from” price follows your tickets.') +
        '</p></section>' +
        '<section class="po-block"><h3>Good to know</h3><div class="po-three">' +
        '<label class="field"><span>Minimum age</span><input type="number" name="min_age" min="0" max="99" step="1" placeholder="Any" value="' +
        esc(ev.min_age) +
        '" /></label><label class="field"><span>Capacity</span><input type="number" name="capacity" min="1" step="1" placeholder="No limit" value="' +
        esc(ev.capacity) +
        '" /></label><label class="field"><span>Accessibility</span><input type="text" name="accessibility" maxlength="500" placeholder="Step-free, hearing loop…" value="' +
        esc(ev.accessibility) +
        '" /></label></div></section>' +
        '</div><div class="po-side">' +
        '<section class="po-block po-mapcard"><div class="po-map" id="po-map"></div><div class="muted small" id="map-hint" style="padding: 12px 16px"></div>' +
        '<input type="hidden" name="lat" value="' +
        esc(ev.lat) +
        '" /><input type="hidden" name="lon" value="' +
        esc(ev.lon) +
        '" /></section>' +
        '<section class="po-block"><h3 style="font-size: 17px">Before you publish</h3><ul class="checklist" id="checklist"></ul>' +
        '<div class="notice error" id="err" hidden></div>' +
        '<button class="btn primary block" type="submit">' +
        (editing ? 'Save changes' : mode === 'dayli' ? 'Save and set up tickets' : 'Save as draft') +
        '</button><p class="muted small" style="margin: 10px 0 0">You publish from the Events list.</p></section>' +
        '</div></div></form></div>',
    );
    var form = $('#event-form');
    var err = $('#err');
    var coverFile = null;
    var endsTouched = !!ev.ends_at;
    var zoom = 16;

    function priceText() {
      if (mode === 'none') return 'Free';
      if (mode === 'dayli') return ev.ticketing === 'dayli' ? fmtPrice(ev) : 'Tickets on Dayli';
      var amount = parseFloat($('[name=price]').value);
      return isNaN(amount) ? 'Tickets' : fmtPrice({ is_free: false, price_from_pence: Math.round(amount * 100), currency: $('[name=currency]').value || 'GBP' });
    }
    function syncPreview() {
      var title = $('[name=title]').value.trim();
      var venue = $('[name=venue_name]').value.trim();
      var age = $('[name=min_age]').value.trim();
      var tzNow = $('[name=timezone]').value;
      var iso = zonedToIso($('[name=starts_date]').value, $('[name=starts_time]').value, tzNow);
      var endIso = zonedToIso($('[name=ends_date]').value, $('[name=ends_time]').value, tzNow);
      var when = iso ? new Date(iso) : null;
      var kicker = [categoryLabel($('[name=category]').value).toUpperCase()];
      if (age) kicker.push(age + '+');
      $('#pv-kicker').textContent = kicker.join(' · ');
      var pills = [];
      if (when && !isNaN(when.getTime())) {
        var s = isoToZoned(iso, tzNow);
        var e2 = endIso ? isoToZoned(endIso, tzNow) : null;
        pills.push(when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: safeTz(tzNow) }) + ', ' + s.time + (e2 && e2.date === s.date ? '–' + e2.time : ''));
      }
      if (venue) pills.push(venue);
      pills.push(priceText());
      $('#pv-pills').innerHTML = pills
        .map(function (p) {
          return '<span>' + esc(p) + '</span>';
        })
        .join('');
      var m = ENTRY.filter(function (x) {
        return x[0] === mode;
      })[0];
      $('#entry-sum').innerHTML = '<div class="po-big">' + esc(priceText()) + '</div><div class="muted small">' + esc(m[1]) + '</div>';
      var hasPlace = $('[name=lat]').value !== '' && $('[name=lon]').value !== '';
      var future = when && when.getTime() > Date.now();
      var hasCover = !!(coverFile || $('[name=cover_image_path]').value);
      var words = $('[name=description]').value.trim().split(/\s+/).filter(Boolean).length;
      var ticket = $('[name=ticket_url]').value.trim();
      var items = [
        [!!title, title ? 'Has a title' : 'Needs a title'],
        [hasPlace, hasPlace ? 'Pin on the map' : 'Find the venue on the map'],
        [!!future, future ? 'Date to come' : 'Needs a date to come'],
        [isVerified(), isVerified() ? 'Email confirmed' : 'Confirm your email'],
        [hasCover, hasCover ? 'Has a picture' : 'A picture gets more taps'],
        [words >= 30, words >= 30 ? 'A good description' : 'A few more words about it'],
        mode === 'external'
          ? [!!ticket, ticket ? 'Ticket link added' : 'Add the ticket link']
          : mode === 'dayli'
            ? [ev.ticketing === 'dayli', ev.ticketing === 'dayli' ? 'Tickets through Dayli' : 'Set up tickets after saving']
            : [true, 'Free to attend'],
      ];
      $('#checklist').innerHTML = items
        .map(function (it) {
          return '<li class="' + (it[0] ? 'done' : '') + '">' + esc(it[1]) + '</li>';
        })
        .join('');
    }
    function showMap() {
      var lat = parseFloat($('[name=lat]').value);
      var lon = parseFloat($('[name=lon]').value);
      var box = $('#po-map');
      if (isNaN(lat) || isNaN(lon)) {
        box.onclick = null;
        box.innerHTML = '<div class="po-map-empty">Type the address and press <b>Find on map</b>.<br />People find events by place, so it needs a pin before it’s published.</div>';
        $('#map-hint').textContent = '';
        return;
      }
      drawMap(box, lat, lon, zoom, function (nlat, nlon, z) {
        zoom = z;
        $('[name=lat]').value = nlat.toFixed(6);
        $('[name=lon]').value = nlon.toFixed(6);
        showMap();
        syncPreview();
      });
      $('#map-hint').textContent = 'Not quite right? Click the map where the entrance is.';
    }
    form.oninput = syncPreview;
    form.onchange = syncPreview;
    $$('[data-cat]').forEach(function (b) {
      b.onclick = function () {
        $$('[data-cat]').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
        $('[name=category]').value = b.dataset.cat;
        syncPreview();
      };
    });
    $$('[data-mode]').forEach(function (b) {
      b.onclick = function () {
        mode = b.dataset.mode;
        $$('[data-mode]').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
        $('#ext-fields').hidden = mode !== 'external';
        $('#dayli-note').hidden = mode !== 'dayli';
        if (!editing) $('button[type=submit]', form).textContent = mode === 'dayli' ? 'Save and set up tickets' : 'Save as draft';
        syncPreview();
      };
    });
    $('#entry-jump').onclick = function (e) {
      e.preventDefault();
      $('#entry').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    // End follows the start by two hours until someone changes it by hand.
    function syncEnd() {
      var tzNow = $('[name=timezone]').value;
      var iso = zonedToIso($('[name=starts_date]').value, $('[name=starts_time]').value, tzNow);
      if (!iso || endsTouched) return;
      var end = isoToZoned(new Date(new Date(iso).getTime() + 2 * 3600000).toISOString(), tzNow);
      $('[name=ends_date]').value = end.date;
      $('[name=ends_time]').value = end.time;
    }
    $('[name=starts_date]').addEventListener('change', syncEnd);
    $('[name=starts_time]').addEventListener('change', syncEnd);
    $('[name=ends_date]').addEventListener('change', function () {
      endsTouched = true;
    });
    $('[name=ends_time]').addEventListener('change', function () {
      endsTouched = true;
    });
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
      $('#pv-cover').style.backgroundImage = 'url("' + URL.createObjectURL(file) + '")';
      $('#cover-remove').hidden = false;
      syncPreview();
    };
    $('#cover-remove').onclick = function () {
      coverFile = null;
      $('[name=cover]').value = '';
      $('[name=cover_image_path]').value = '';
      $('#pv-cover').style.backgroundImage = '';
      this.hidden = true;
      syncPreview();
    };
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
            status.textContent = 'We couldn’t place that address. Add the town or postcode, or click the map.';
            return;
          }
          $('[name=lat]').value = found.lat.toFixed(6);
          $('[name=lon]').value = found.lon.toFixed(6);
          status.textContent = 'Found.';
          zoom = 16;
          showMap();
          syncPreview();
        },
        function () {
          setBusy(button, false);
          status.textContent = 'The map service didn’t answer. Try again.';
        },
      );
    };
    showMap();
    syncPreview();

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
      if (new Date(endsAt) <= new Date(startsAt)) return showError(err, 'The end has to come after the start.');
      var tags = v('tags')
        .split(',')
        .map(function (t) {
          return t.trim().slice(0, 30);
        })
        .filter(Boolean);
      if (tags.length > 8) return showError(err, 'Up to 8 tags, please.');
      var pence = null;
      var ticket = '';
      if (mode === 'external') {
        var amount = v('price') === '' ? NaN : parseFloat(v('price'));
        if (v('price') !== '' && (isNaN(amount) || amount < 0)) return showError(err, 'The “from” price doesn’t look right.');
        pence = isNaN(amount) ? null : Math.round(amount * 100);
        ticket = v('ticket_url');
        if (ticket && !/^https?:\/\//i.test(ticket)) {
          if (/^[\w.-]+\.[a-z]{2,}/i.test(ticket)) ticket = 'https://' + ticket;
          else return showError(err, 'The ticket link must start with http:// or https://.');
        }
      }
      var lat = v('lat') === '' ? null : parseFloat(v('lat'));
      var lon = v('lon') === '' ? null : parseFloat(v('lon'));
      var capacity = v('capacity') === '' ? null : parseInt(v('capacity'), 10);
      if (capacity !== null && (isNaN(capacity) || capacity < 1)) return showError(err, 'Capacity must be a whole number above 0.');
      var minAge = v('min_age') === '' ? null : parseInt(v('min_age'), 10);
      if (minAge !== null && (isNaN(minAge) || minAge < 0 || minAge > 99)) return showError(err, 'Minimum age must be between 0 and 99.');

      var button = $('button[type=submit]', form);
      setBusy(button, true, 'Saving…');
      var upload = Promise.resolve($('[name=cover_image_path]').value || null);
      if (coverFile) {
        var ext = (coverFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        var path = uid() + '/public-events/' + Date.now() + '.' + ext;
        upload = sb.storage
          .from('hero')
          .upload(path, coverFile, { upsert: true, contentType: coverFile.type })
          .then(function (res) {
            if (res.error) throw new Error('We couldn’t upload the picture: ' + (res.error.message || 'try again.'));
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
            capacity: capacity,
            min_age: minAge,
            accessibility: v('accessibility') || null,
          };
          // With Dayli tickets the price comes from the tickets themselves.
          if (mode !== 'dayli') {
            payload.is_free = mode === 'none' || pence === null;
            payload.price_from_pence = mode === 'none' ? null : pence;
            payload.currency = v('currency') || 'GBP';
            payload.ticket_url = mode === 'external' ? ticket || null : null;
          }
          if (editing) payload.id = ev.id;
          return rpc('public_event_save', { p: payload });
        })
        .then(function (saved) {
          var id = (saved && saved.id) || ev.id;
          return rpc('public_event_ticketing_set', { p_id: id, p_mode: mode }).then(function () {
            return saved;
          });
        })
        .then(function (saved) {
          setBusy(button, false);
          state.events = null;
          state.overview = null;
          var id = (saved && saved.id) || ev.id;
          if (mode === 'dayli' && ev.ticketing !== 'dayli') {
            toast('Saved. Now the tickets.');
            return go('#/tickets/' + id);
          }
          if (editing) toast('Saved.');
          else if (saved && saved.lat != null) toast('Saved as a draft. Publish it when you’re ready.');
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

  // --- start ----------------------------------------------------------------------

  function signOut() {
    sb.auth.signOut().catch(function () {});
    state.session = null;
    state.organiser = undefined;
    state.events = null;
    state.overview = null;
    go('#/sign-in');
  }
  document.getElementById('sign-out').onclick = signOut;

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
        state.overview = null;
        if (state.ready) go('#/sign-in');
        return;
      }
      if (event === 'SIGNED_IN' && uid() !== before) {
        state.organiser = undefined;
        state.events = null;
        state.overview = null;
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
