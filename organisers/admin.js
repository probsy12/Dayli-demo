/* Dayli admin: how the app is growing. Plain browser JavaScript, no build.
 * Shown inside the organiser site to the admin account only (is_admin()),
 * at #/admin?tab=…&days=…. Every number comes from admin_dashboard(p_days)
 * in supabase/migrations/20261028000400_admin_dashboard.sql; Dayli AI reads
 * the same numbers through the admin-insights Edge Function. */
window.DayliAdmin = function (ctx, ui) {
  'use strict';
  var esc = ctx.esc;
  var $ = ctx.$;
  var $$ = ctx.$$;
  var rpc = ctx.rpc;
  var render = ctx.render;
  var notice = ctx.notice;
  var go = ctx.go;
  var friendly = ctx.friendly;
  var kpi = ui.kpi;
  var card = ui.card;
  var bars = ui.bars;
  var hbars = ui.hbars;
  var axis = ui.axis;
  var spark = ui.spark;
  var fmtN = ui.fmtN;
  var n = ui.n;
  var pct = ui.pct;

  var TABS = [
    ['overview', 'Overview'],
    ['people', 'People'],
    ['groups', 'Groups'],
    ['content', 'What they do'],
    ['retention', 'Retention'],
    ['virality', 'Invites'],
    ['events', 'Events'],
    ['notifications', 'Notifications'],
    ['safety', 'Safety'],
    ['ai', 'Dayli AI'],
    ['costs', 'Costs'],
    ['premium', 'Premium'],
  ];
  var RANGES = [
    ['7', '7 days'],
    ['30', '30 days'],
    ['90', '90 days'],
  ];
  var ARRIVAL = {
    organic: 'On their own',
    invite_link: 'Joined a calendar by link',
    phone_invite: 'Invited by phone number',
    friend_request: 'A friend request',
    public_event: 'A public event',
    organiser: 'As an organiser',
  };
  var FEATURE = {
    memories: 'Posted a memory',
    chat: 'Used calendar chat',
    messages: 'Sent a message',
    friends: 'Added a friend',
    ask_dayli: 'Asked Dayli',
    public_events: 'Went to a public event',
    polls: 'Ran a date poll',
    synced: 'Synced a calendar',
    shared_calendar: 'Shared a calendar',
  };
  var KIND = {
    open: 'Opened the app',
    event: 'Added an event',
    memory: 'Posted a memory',
    chat: 'Calendar chat',
    dm: 'Messages',
    comment: 'Event comments',
    photo: 'Event photos',
    poll: 'Date polls',
    going: 'Public events',
    discover: 'Browsed Discover',
    friend: 'Friends',
    story: 'Watched a story',
    ask: 'Asked Dayli',
    join: 'Joined a calendar',
    rsvp: 'RSVPs',
    invite: 'Event invites',
    sync: 'Synced a calendar',
    file: 'Added a file',
    frame: 'Paired a frame',
    page: 'Made an invitation page',
  };
  var SOURCE = { manual: 'Typed in', ai: 'Smart add / Ask Dayli', rsvp: 'From an RSVP', whatsapp: 'WhatsApp', ical: 'Synced', public_event: 'Public event', email: 'Email' };
  var VIEW_SOURCE = { app: 'Discover in the app', friend: 'A friend was going', share: 'Shared link', web: 'Public web page', notification: 'A reminder' };
  var NOTE_TYPE = {
    page_invite: 'Invitation page', page_rsvp: 'Page RSVP', friend_request: 'Friend request', friend_accepted: 'Friend accepted', event_added: 'Event added', event_changed: 'Event changed', member_joined: 'Someone joined', event_comment: 'Event comment', poll_invite: 'Poll invite', poll_closed: 'Poll closed', event_rsvp: 'Event RSVP', rsvp_ask: 'RSVP nudge', event_invite: 'Event invite', event_invite_reply: 'Invite reply', calendar_message: 'Calendar chat', event_deleted: 'Event deleted', calendar_invite: 'Calendar invite', calendar_photo: 'Photo sent', story_posted: 'Memory posted', dm_message: 'Message', public_event_cancelled: 'Event cancelled', public_event_changed: 'Event changed', time_suggested: 'Time suggested', time_suggestion_reply: 'Time reply', public_event_reminder: 'Event reminder', public_event_milestone: 'Milestone', public_event_summary: 'Event summary',
  };

  var state = { data: null, days: '30', loadedAt: 0 };
  // The Costs tab has its own numbers and periods (costs.js).
  var costs = window.DayliCosts(ctx, ui);
  var premium = window.DayliPremium(ctx, ui);

  // --- helpers ---------------------------------------------------------------------

  function label(map, key) {
    return map[key] || String(key || '?').replace(/_/g, ' ');
  }
  function pctOf(a, b) {
    return n(b) ? Math.round((100 * n(a)) / n(b)) + '%' : '—';
  }
  function delta(cur, prev, what) {
    cur = n(cur);
    prev = n(prev);
    what = what || 'vs prior ' + state.days + 'd';
    if (!prev && !cur) return '<span class="tag plain">no change</span>';
    if (!prev) return '<span class="tag info">new · ' + esc(what) + '</span>';
    var d = Math.round(((cur - prev) / prev) * 100);
    if (d === 0) return '<span class="tag plain">level ' + esc(what) + '</span>';
    return d > 0
      ? '<span class="tag ok">▲ ' + d + '% ' + esc(what) + '</span>'
      : '<span class="tag bad">▼ ' + Math.abs(d) + '% ' + esc(what) + '</span>';
  }
  function deltaDown(cur, prev, what) {
    // For things where fewer is better (reports, deletions).
    var t = delta(cur, prev, what);
    return t.replace('tag ok', 'tag _x').replace('tag bad', 'tag ok').replace('tag _x', 'tag bad');
  }
  function obj(o) {
    return o && typeof o === 'object' ? o : {};
  }
  function entries(o, map) {
    o = obj(o);
    return Object.keys(o)
      .map(function (k) {
        return { label: label(map || {}, k), key: k, v: n(o[k]) };
      })
      .sort(function (a, b) {
        return b.v - a.v;
      });
  }
  function sum(rows) {
    return rows.reduce(function (t, r) {
      return t + n(r.v);
    }, 0);
  }
  function dayBars(series, key, tip) {
    return bars(
      series.map(function (r) {
        return { v: r[key], tip: dayText(r.day) + ': ' + fmtN(r[key]) + ' ' + tip };
      }),
    );
  }
  function dayAxis(series) {
    if (!series.length) return '';
    var first = series[0].day;
    var mid = series[Math.floor(series.length / 2)].day;
    var last = series[series.length - 1].day;
    return axis([dayText(first), dayText(mid), dayText(last)]);
  }
  function dayText(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function weekText(iso) {
    return 'w/c ' + dayText(iso);
  }
  function timeText(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function stat(v, l) {
    return '<span class="stat"><span class="v">' + v + '</span><span class="l">' + l + '</span></span>';
  }
  function table(head, rows) {
    return (
      '<table><tr>' +
      head
        .map(function (h, i) {
          return '<th class="' + (i ? 'r' : '') + '">' + h + '</th>';
        })
        .join('') +
      '</tr>' +
      rows
        .map(function (r) {
          return (
            '<tr>' +
            r
              .map(function (c, i) {
                return '<td class="' + (i ? 'r' : '') + '">' + c + '</td>';
              })
              .join('') +
            '</tr>'
          );
        })
        .join('') +
      '</table>'
    );
  }
  function funnel(steps) {
    // steps: [{label, v}] top first; each as a share of the first.
    var top = n(steps[0] && steps[0].v);
    return steps
      .map(function (s, i) {
        var prev = i ? n(steps[i - 1].v) : null;
        return (
          '<div class="hrow"><span>' +
          esc(s.label) +
          '</span><b>' +
          fmtN(s.v) +
          (i && n(prev) ? ' <span class="muted">(' + pctOf(s.v, prev) + ' of the step before)</span>' : '') +
          '</b></div><div class="hbar"><i style="width: ' +
          pct(s.v, top) +
          '%"></i></div>'
        );
      })
      .join('');
  }
  function weekSparkRow(weeks, key, labelText) {
    var vals = weeks.map(function (w) {
      return n(w[key]);
    });
    var last = vals[vals.length - 1] || 0;
    var prev = vals[vals.length - 2] || 0;
    return [
      esc(labelText),
      spark(vals).replace('Views, last 14 days', esc(labelText) + ', 16 weeks'),
      fmtN(last),
      fmtN(prev),
      delta(last, prev, 'vs last week'),
    ];
  }

  // --- data ----------------------------------------------------------------------------

  function load(days, force) {
    if (!force && state.data && state.days === days && Date.now() - state.loadedAt < 120000) return Promise.resolve(state.data);
    return rpc('admin_dashboard', { p_days: Number(days) }).then(function (d) {
      state.data = d;
      state.days = days;
      state.loadedAt = Date.now();
      return d;
    });
  }

  // --- the "what to do next" list -------------------------------------------------------

  function insights(d) {
    var out = [];
    var a = obj(d.active);
    var p = obj(d.people);
    var g = obj(d.groups);
    var v = obj(d.virality);
    var r = obj(d.retention);
    var m = obj(d.marketplace);
    var no = obj(d.notifications);
    var s = obj(d.safety);
    var days = n(d.days);

    if (n(a.active_groups_week_prev) && n(a.active_groups_week) < n(a.active_groups_week_prev)) {
      out.push({
        icon: '📉',
        title: 'Fewer groups were active this week',
        detail: fmtN(a.active_groups_week) + ' calendars had two or more people active, down from ' + fmtN(a.active_groups_week_prev) + ' last week. The north star is slipping: look at Groups for who went quiet, and at Notifications for whether a nudge is landing.',
      });
    }
    if (n(p.new) >= 5 && n(p.onboarded_new) / n(p.new) < 0.7) {
      out.push({
        icon: '🚪',
        title: 'People drop out of setup',
        detail: 'Only ' + pctOf(p.onboarded_new, p.new) + ' of the ' + fmtN(p.new) + ' people who signed up in the last ' + days + ' days finished setting up. Shorten setup, or let them into the calendar before the extras.',
      });
    }
    if (n(g.total) >= 5 && n(g.solo) / n(g.total) > 0.4) {
      out.push({
        icon: '👤',
        title: 'Most calendars have one person in them',
        detail: fmtN(g.solo) + ' of ' + fmtN(g.total) + ' calendars (' + pctOf(g.solo, g.total) + ') have never been shared. Dayli works when two people share one; prompt the invite on the first day and again after the first event.',
      });
    }
    if (n(p.new) >= 5 && n(v.invited_new_users) / n(p.new) < 0.3) {
      out.push({
        icon: '📨',
        title: 'Growth is mostly organic',
        detail: 'Only ' + fmtN(v.invited_new_users) + ' of ' + fmtN(p.new) + ' new people (' + pctOf(v.invited_new_users, p.new) + ') arrived through an invite or a friend. Invites are the cheapest growth there is: make the invite step harder to skip.',
      });
    }
    if (n(v.phone_invites) >= 5 && n(v.phone_invites_claim_pct) < 30) {
      out.push({
        icon: '📱',
        title: 'Phone invites rarely turn into sign-ups',
        detail: 'Only ' + fmtN(v.phone_invites_claim_pct) + '% of phone invites older than three days were claimed. Check the message people receive and the link it lands on.',
      });
    }
    if (n(v.friend_pending) >= 5 && n(v.friend_pending) > n(v.friend_accepted) * 0.3) {
      out.push({
        icon: '⏳',
        title: 'Friend requests sit unanswered',
        detail: fmtN(v.friend_pending) + ' requests are still waiting against ' + fmtN(v.friend_accepted) + ' accepted. A reminder a day later usually clears half of them.',
      });
    }
    // The feature whose first-fortnight users stay best.
    var best = null;
    (r.by_feature || []).forEach(function (f) {
      if (n(f.with_users) < 5 || n(f.without_users) < 5 || f.with_pct == null || f.without_pct == null) return;
      var lift = n(f.with_pct) - n(f.without_pct);
      if (lift >= 15 && (!best || lift > best.lift)) best = { f: f, lift: lift };
    });
    if (best) {
      out.push({
        icon: '🧲',
        title: 'People who ' + label(FEATURE, best.f.feature).toLowerCase() + ' early stay longer',
        detail: fmtN(best.f.with_pct) + '% of those who did it in their first fortnight were still around after four weeks, against ' + fmtN(best.f.without_pct) + '% of those who did not. Put it in the first-run tour.',
      });
    }
    var cohorts = r.cohorts || [];
    var done = cohorts.filter(function (c) {
      return c.weeks && c.weeks[1] != null && n(c.size) >= 5;
    });
    var lastDone = done[done.length - 1];
    if (lastDone && n(lastDone.weeks[1]) < 40) {
      out.push({
        icon: '📆',
        title: 'The first week is where people leave',
        detail: 'Of the ' + fmtN(lastDone.size) + ' people who joined ' + weekText(lastDone.week) + ', ' + fmtN(lastDone.weeks[1]) + '% came back in their second week. The first week decides retention: a second person in the calendar and a first event are what to push.',
      });
    }
    (no.by_type || []).forEach(function (t) {
      if (n(t.n) >= 20 && n(t.read_pct) < 10 && out.length < 8) {
        out.push({
          icon: '🔕',
          title: label(NOTE_TYPE, t.type) + ' notifications go unread',
          detail: fmtN(t.n) + ' were sent in the last ' + days + ' days and ' + fmtN(t.read_pct) + '% were opened. Send fewer of them, or bundle them.',
        });
      }
    });
    if (n(no.push_tokens) >= 10 && n(no.push_stale) / n(no.push_tokens) > 0.3) {
      out.push({
        icon: '📵',
        title: 'Many phones have gone quiet',
        detail: fmtN(no.push_stale) + ' of ' + fmtN(no.push_tokens) + ' registered phones have not opened the app in 30 days. These are the people to win back, and the pushes they get are the only contact left.',
      });
    }
    if (n(m.views) >= 50 && n(m.going_new) / n(m.viewers) < 0.03) {
      out.push({
        icon: '🎟️',
        title: 'Public events get looked at, not joined',
        detail: fmtN(m.viewers) + ' people viewed public events and ' + fmtN(m.going_new) + ' said going (' + pctOf(m.going_new, m.viewers) + '). Covers, prices and the “I’m going” button are the things to look at.',
      });
    }
    if (n(s.reports_open)) {
      out.push({
        icon: '🚩',
        title: fmtN(s.reports_open) + (n(s.reports_open) === 1 ? ' report is waiting' : ' reports are waiting'),
        detail: 'Unhandled reports are in the content_reports table. Each one emailed you when it came in; the link in that email deletes the content.',
      });
    }
    if (n(s.deletions) && n(s.deletions_median_days) <= 7) {
      out.push({
        icon: '🗑️',
        title: 'Accounts are deleted soon after joining',
        detail: fmtN(s.deletions) + ' accounts were deleted in the last ' + days + ' days, typically ' + fmtN(s.deletions_median_days) + ' days old. People who leave that fast did not find a reason to stay: look at what the first screen asks of them.',
      });
    }
    if (!out.length) {
      out.push({
        icon: '✅',
        title: 'Nothing is on fire',
        detail: 'The rules that watch for stalled groups, poor invites, unread notifications, early leavers and quiet weeks all came back clear. Ask Dayli AI for a second opinion.',
      });
    }
    return out.slice(0, 6);
  }
  function insightsHtml(list) {
    return list
      .map(function (it) {
        return '<div class="insight"><div class="ic">' + it.icon + '</div><div><b>' + esc(it.title) + '</b><div class="muted small">' + esc(it.detail) + '</div></div></div>';
      })
      .join('');
  }

  // --- screen ----------------------------------------------------------------------------

  function screen(tab, days) {
    tab = TABS.some(function (t) {
      return t[0] === tab;
    })
      ? tab
      : 'overview';
    days = RANGES.some(function (r) {
      return r[0] === days;
    })
      ? days
      : state.days || '30';
    costs.stop();
    if (tab === 'premium') {
      render(
        '<div class="page-head"><div><h1>Dayli admin</h1><p class="muted">Dayli Plus: the switch, founders, free limits and who has which plan</p></div></div>' +
          tabsHtml(tab, days) +
          '<div id="premium"></div>',
      );
      premium.mount($('#premium'));
      return;
    }
    if (tab === 'costs') {
      render(
        '<div class="page-head"><div><h1>Dayli admin</h1><p class="muted">What Dayli costs to run: your monthly bills and the AI it uses, in pounds</p></div></div>' +
          tabsHtml(tab, days) +
          '<div id="costs"></div>',
      );
      costs.mount($('#costs'));
      return;
    }
    ctx.loading();
    load(days)
      .then(function (d) {
        renderScreen(d, tab, days);
      })
      .catch(function (err) {
        var m = String((err && err.message) || err || '');
        render(
          '<h1>Admin</h1>' +
            notice('error', /not_admin|42501/.test(m) ? 'This account is not on the admin list.' : esc(friendly(err))) +
            '<button class="btn" id="retry">Try again</button>',
        );
        $('#retry').onclick = function () {
          screen(tab, days);
        };
      });
  }

  function tabsHtml(tab, days) {
    return (
      '<div class="tabs scroll">' +
      TABS.map(function (t) {
        return '<a class="' + (t[0] === tab ? 'on' : '') + '" href="#/admin?tab=' + t[0] + '&days=' + days + '">' + t[1] + '</a>';
      }).join('') +
      '</div>'
    );
  }

  function renderScreen(d, tab, days) {
    var head =
      '<div class="page-head"><div><h1>Dayli admin</h1><p class="muted">How Dayli is growing · numbers as of ' +
      esc(timeText(d.generated_at)) +
      ' · the last ' +
      esc(days) +
      ' days against the ' +
      esc(days) +
      ' before</p></div><div class="controls">' +
      RANGES.map(function (r) {
        return '<a class="pill ' + (r[0] === days ? 'on' : '') + '" href="#/admin?tab=' + tab + '&days=' + r[0] + '">' + r[1] + '</a>';
      }).join('') +
      '<button type="button" class="btn small" id="adm-refresh">Refresh</button>' +
      '<button type="button" class="btn small" id="adm-download">Download JSON</button>' +
      '</div></div>' +
      tabsHtml(tab, days);
    var body = '';
    switch (tab) {
      case 'people':
        body = tabPeople(d);
        break;
      case 'groups':
        body = tabGroups(d);
        break;
      case 'content':
        body = tabContent(d);
        break;
      case 'retention':
        body = tabRetention(d);
        break;
      case 'virality':
        body = tabVirality(d);
        break;
      case 'events':
        body = tabEvents(d);
        break;
      case 'notifications':
        body = tabNotifications(d);
        break;
      case 'safety':
        body = tabSafety(d);
        break;
      case 'ai':
        body = tabAi(d);
        break;
      default:
        body = tabOverview(d);
    }
    render(head + body);
    $('#adm-refresh').onclick = function () {
      ctx.loading();
      load(days, true).then(
        function (nd) {
          renderScreen(nd, tab, days);
        },
        function (err) {
          ctx.toast(friendly(err));
          renderScreen(d, tab, days);
        },
      );
    };
    $('#adm-download').onclick = function () {
      var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dayli-admin-' + String(d.today || '').replace(/-/g, '') + '-' + days + 'd.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 500);
    };
    if (tab === 'ai') bindAi(d, days);
  }

  // --- Overview ------------------------------------------------------------------------------

  function tabOverview(d) {
    var a = obj(d.active);
    var p = obj(d.people);
    var series = d.by_day || [];
    var weeks = d.by_week || [];
    var stick = n(a.mau) ? Math.round((100 * n(a.avg_dau_7)) / n(a.mau)) : null;
    return (
      '<div class="grid g5">' +
      kpi('Active groups this week', fmtN(a.active_groups_week), delta(a.active_groups_week, a.active_groups_week_prev, 'vs last week')) +
      kpi('Active people this week', fmtN(a.wau), delta(a.wau, a.wau_prev, 'vs last week')) +
      kpi('New people', fmtN(p.new), delta(p.new, p.new_prev)) +
      kpi('Active this month', fmtN(a.mau), delta(a.mau, a.mau_prev, 'vs the month before')) +
      kpi('Stickiness', stick == null ? '—' : stick + '%', '<span class="tag plain">daily ÷ monthly actives</span>') +
      '</div>' +
      card(
        'What to do next',
        'Rules over the numbers; each says the number behind it',
        insightsHtml(insights(d)),
      ) +
      '<div class="grid g2">' +
      card(
        'Active people by day',
        'Anyone who opened the app or did anything in it, UK days',
        dayBars(series, 'active', 'active') + dayAxis(series),
      ) +
      card(
        'New people by day',
        'Sign-ups; ' + fmtN(p.onboarded_new) + ' of the ' + fmtN(p.new) + ' this period finished setting up',
        dayBars(series, 'new_users', 'signed up') + dayAxis(series),
      ) +
      '</div>' +
      card(
        'Sixteen weeks',
        'Week on week, newest on the right',
        table(
          ['', '', 'This week', 'Last week', ''],
          [
            weekSparkRow(weeks, 'active_groups', 'Active groups'),
            weekSparkRow(weeks, 'active', 'Active people'),
            weekSparkRow(weeks, 'new_users', 'New people'),
            weekSparkRow(weeks, 'events', 'Events added'),
            weekSparkRow(weeks, 'memories', 'Memories posted'),
            weekSparkRow(weeks, 'messages', 'Messages sent'),
            weekSparkRow(weeks, 'invites', 'Invites sent'),
          ],
        ),
      ) +
      '<div class="grid g2">' +
      card(
        'How new people arrived',
        'The last ' + d.days + ' days, from what happened around their sign-up',
        hbars(entries(p.arrival_new, ARRIVAL), sum(entries(p.arrival_new))),
      ) +
      card(
        'Today so far',
        'UK time',
        stat(fmtN(a.dau), 'active today') +
          stat(fmtN(a.dau_yesterday), 'yesterday') +
          stat(fmtN(a.avg_dau_7), 'a day, last 7') +
          stat(fmtN(p.total), 'people in all') +
          stat(fmtN(a.active_groups_month), 'groups active this month'),
      ) +
      '</div>'
    );
  }

  // --- People ------------------------------------------------------------------------------

  function tabPeople(d) {
    var p = obj(d.people);
    var a = obj(d.active);
    var o = obj(a.opens);
    var series = d.by_day || [];
    var kinds = entries(a.by_kind, KIND);
    var hours = (o.by_hour || []).slice();
    var byHour = [];
    for (var h = 0; h < 24; h++) {
      var row = hours.filter(function (x) {
        return n(x.hour) === h;
      })[0];
      byHour.push({ v: row ? row.n : 0, tip: h + ':00 · ' + fmtN(row ? row.n : 0) + ' opens' });
    }
    return (
      '<div class="grid g5">' +
      kpi('People', fmtN(p.total), '<span class="tag plain">since ' + esc(p.first_signup ? dayText(String(p.first_signup).slice(0, 10)) : '—') + '</span>') +
      kpi('New', fmtN(p.new), delta(p.new, p.new_prev)) +
      kpi('Finished setup', pctOf(p.onboarded, p.total), '<span class="tag plain">' + fmtN(p.onboarded) + ' people</span>') +
      kpi('In a shared calendar', pctOf(p.in_shared_calendar, p.total), '<span class="tag plain">' + fmtN(p.in_shared_calendar) + ' people</span>') +
      kpi('Have a friend', pctOf(p.with_friends, p.total), '<span class="tag plain">' + fmtN(p.with_friends) + ' people</span>') +
      '</div>' +
      '<div class="grid g2">' +
      card('Sign-ups by day', 'UK days', dayBars(series, 'new_users', 'signed up') + dayAxis(series)) +
      card(
        'What active people did',
        'People who did each thing in the last ' + d.days + ' days (one person counts in several)',
        hbars(kinds, n(a.period)),
      ) +
      '</div>' +
      '<div class="grid g2">' +
      card('How everyone arrived', 'All time', hbars(entries(p.arrival, ARRIVAL), n(p.total))) +
      card(
        'Profiles',
        'What people have set up',
        hbars(
          [
            { label: 'Push notifications on', v: p.with_push },
            { label: 'Home town set', v: p.with_home },
            { label: 'Phone number added', v: p.with_phone },
            { label: 'Profile photo', v: p.with_avatar },
            { label: 'Findable by contacts', v: p.discoverable },
          ],
          n(p.total),
        ) +
          '<p class="muted small" style="margin-top: 10px">Time zones: ' +
          (p.timezones || [])
            .map(function (t) {
              return esc(t.tz) + ' ' + fmtN(t.n);
            })
            .join(' · ') +
          '</p>',
      ) +
      '</div>' +
      '<div class="grid g3">' +
      card(
        'App opens',
        o.since ? 'Counted since ' + esc(timeText(o.since)) : 'Not counted yet: the app starts reporting opens with the next update',
        stat(fmtN(o.total), 'opens') + stat(fmtN(o.people), 'people') + stat(fmtN(o.per_person), 'each') + stat(fmtN(obj(o.by_source).notification), 'from a notification') + '<div style="margin-top: 8px">' + delta(o.total, o.prev) + '</div>',
      ) +
      card(
        'By platform and version',
        '',
        hbars(
          (o.by_platform || []).map(function (r) {
            return { label: r.platform === 'ios' ? 'iPhone' : r.platform === 'android' ? 'Android' : 'Web', v: r.n, text: fmtN(r.people) + ' people · ' + fmtN(r.n) + ' opens' };
          }),
          n(o.total),
        ) +
          '<div style="height: 10px"></div>' +
          hbars(
            (o.by_version || []).map(function (r) {
              return { label: 'Version ' + r.version, v: r.n, cls: 'b', text: fmtN(r.people) + ' people' };
            }),
            n(o.total),
          ),
      ) +
      card('When the app is opened', 'By hour of the day, UK time', bars(byHour, 'short') + axis(['0:00', '6:00', '12:00', '18:00', '23:00'])) +
      '</div>'
    );
  }

  // --- Groups ---------------------------------------------------------------------------------

  function tabGroups(d) {
    var g = obj(d.groups);
    var a = obj(d.active);
    var sizes = ['1', '2', '3-5', '6-10', '11+'].map(function (k) {
      return { label: k === '1' ? 'Just one person' : k + ' people', v: n(obj(g.sizes)[k]) };
    });
    return (
      '<div class="grid g5">' +
      kpi('Calendars', fmtN(g.total), '<span class="tag plain">' + fmtN(g.new) + ' new this period</span>') +
      kpi('Shared', pctOf(g.shared, g.total), '<span class="tag plain">' + fmtN(g.shared) + ' with 2+ people</span>') +
      kpi('Active this week', fmtN(a.active_groups_week), delta(a.active_groups_week, a.active_groups_week_prev, 'vs last week')) +
      kpi('Gone quiet', fmtN(g.dormant), '<span class="tag plain">had events, none in 30 days</span>') +
      kpi('Never used', fmtN(g.empty), '<span class="tag plain">no events at all</span>') +
      '</div>' +
      '<div class="grid g2">' +
      card('How big groups are', 'People per calendar', hbars(sizes, n(g.total))) +
      card(
        'Joining',
        'People joining a calendar that is not their own',
        stat(fmtN(g.joins), 'joins, last ' + d.days + ' days') +
          stat(fmtN(g.shared_new), 'new calendars already shared') +
          stat(g.hours_to_second_member == null ? '—' : fmtN(g.hours_to_second_member) + 'h', 'until the second person, typically') +
          '<div style="margin-top: 8px">' +
          delta(g.joins, g.joins_prev) +
          '</div>',
      ) +
      '</div>' +
      '<div class="grid g2">' +
      card(
        'What groups use',
        'Calendars that have ever used each thing',
        hbars(
          [
            { label: 'Events in the last 30 days', v: g.with_events_30 },
            { label: 'Memories', v: g.with_photos },
            { label: 'Chat', v: g.with_chat },
            { label: 'A photo frame', v: g.with_frames },
            { label: 'A synced calendar', v: g.with_synced },
          ],
          n(g.total),
        ),
      ) +
      card(
        'Averages',
        '',
        stat(fmtN(g.avg_members), 'people per calendar') + stat(fmtN(g.avg_events), 'events per calendar') + stat(fmtN(g.biggest), 'in the biggest') + stat(fmtN(a.active_groups_month), 'active this month'),
      ) +
      '</div>'
    );
  }

  // --- What they do ---------------------------------------------------------------------------

  function tabContent(d) {
    var c = obj(d.content);
    var ev = obj(c.events);
    var me = obj(c.memories);
    var ms = obj(c.messages);
    var po = obj(c.polls);
    var inv = obj(c.invitations);
    var sy = obj(c.synced);
    var fr = obj(c.frames);
    var ai = obj(d.assistant);
    var series = d.by_day || [];
    return (
      '<div class="grid g5">' +
      kpi('Events added', fmtN(ev.n), delta(ev.n, ev.prev)) +
      kpi('Memories', fmtN(me.n), delta(me.n, me.prev)) +
      kpi('Chat messages', fmtN(ms.chat), delta(ms.chat, ms.chat_prev)) +
      kpi('Direct messages', fmtN(ms.dm), delta(ms.dm, ms.dm_prev)) +
      kpi('Asked Dayli', fmtN(ai.requests), delta(ai.requests, ai.requests_prev)) +
      '</div>' +
      '<div class="grid g3">' +
      card('Events by day', '', dayBars(series, 'events', 'events') + dayAxis(series)) +
      card('Memories by day', '', dayBars(series, 'memories', 'memories') + dayAxis(series)) +
      card('Messages by day', 'Chat and direct messages', dayBars(series, 'messages', 'messages') + dayAxis(series)) +
      '</div>' +
      '<div class="grid g2">' +
      card(
        'How events get in',
        fmtN(ev.creators) + ' people added events, ' + fmtN(ev.per_active_user) + ' each on average',
        hbars(entries(ev.by_source, SOURCE), n(ev.n)),
      ) +
      card(
        'What events carry',
        'Of the ' + fmtN(ev.n) + ' added in the last ' + d.days + ' days',
        hbars(
          [
            { label: 'Repeat', v: ev.recurring },
            { label: 'All day', v: ev.all_day },
            { label: 'A place', v: ev.with_location },
            { label: 'Notes', v: ev.with_notes },
            { label: 'A list', v: ev.with_checklist },
            { label: 'A reminder of their own', v: ev.with_reminder },
            { label: 'A day counter', v: ev.day_counters },
          ],
          n(ev.n),
        ),
      ) +
      '</div>' +
      '<div class="grid g3">' +
      card(
        'Around events',
        '',
        stat(fmtN(ev.files), 'files') + stat(fmtN(ev.tickets), 'tickets') + stat(fmtN(ev.photos), 'photos') + stat(fmtN(ev.comments), 'comments') + stat(fmtN(ev.time_suggestions), 'time suggestions') + stat(fmtN(ev.colour_rules), 'colour rules, all time'),
      ) +
      card(
        'Memories',
        fmtN(me.posters) + ' people posted',
        stat(fmtN(me.stories), 'stories') + stat(fmtN(me.with_caption), 'with a caption') + stat(fmtN(me.story_views), 'story views') + stat(fmtN(me.story_viewers), 'viewers') + stat(fmtN(me.views_per_story), 'views per story') + stat(fmtN(me.total), 'all time'),
      ) +
      card(
        'Messages',
        '',
        stat(fmtN(ms.chat_senders), 'chat senders') + stat(fmtN(ms.chat_calendars), 'calendars chatting') + stat(fmtN(ms.dm_senders), 'DM senders') + stat(fmtN(ms.threads_active), 'threads active') + stat(fmtN(ms.group_threads), 'group chats') + stat(fmtN(ms.dm_story_replies), 'story replies') + stat(fmtN(ms.dm_with_links), 'with a link') + stat(fmtN(ms.mentions), '@mentions'),
      ) +
      '</div>' +
      '<div class="grid g3">' +
      card(
        'Polls and invitations',
        '',
        stat(fmtN(po.created), 'polls') + stat(fmtN(po.closed), 'closed') + stat(fmtN(po.became_events), 'became events') + stat(fmtN(po.votes), 'votes') + '<div style="height: 8px"></div>' +
          stat(fmtN(inv.pages), 'invitation pages') + stat(fmtN(inv.event_invites), 'event invites') + stat(pctOf(inv.event_invites_accepted, inv.event_invites), 'accepted') + stat(fmtN(inv.rsvps), 'RSVPs'),
      ) +
      card(
        'Synced calendars and frames',
        '',
        stat(fmtN(sy.calendars), 'synced calendars') + stat(fmtN(sy.people), 'people') + stat(fmtN(sy.events), 'events pulled in') + stat(fmtN(sy.phone_busy), 'share phone busy times') + '<div style="height: 8px"></div>' +
          stat(fmtN(fr.total), 'frames') + stat(fmtN(fr.seen_7d), 'on this week') + stat(fmtN(fr.new), 'paired recently'),
      ) +
      card(
        'Ask Dayli and smart add',
        fmtN(ai.people) + ' people used it',
        hbars(entries(ai.by_kind, { text: 'Typed', voice: 'Spoken', image: 'A photo or scan', whatsapp: 'WhatsApp', constraints: 'Find a time' }), n(ai.requests)) +
          '<p class="muted small" style="margin-top: 10px">' +
          fmtN(ai.events_by_ai) +
          ' events came from it · ' +
          fmtN(ai.tokens_in) +
          ' tokens in, ' +
          fmtN(ai.tokens_out) +
          ' out · ' +
          entries(ai.by_model)
            .map(function (m) {
              return esc(m.key) + ' ' + fmtN(m.v);
            })
            .join(', ') +
          (ai.inbound && ai.inbound.length
            ? ' · inbound: ' +
              ai.inbound
                .map(function (i) {
                  return esc(i.channel) + ' ' + esc(i.status) + ' ' + fmtN(i.n);
                })
                .join(', ')
            : '') +
          '</p>',
      ) +
      '</div>'
    );
  }

  // --- Retention ------------------------------------------------------------------------------

  function cohortCell(v) {
    if (v == null) return '<td class="r"><span class="muted">·</span></td>';
    var a = Math.max(0.08, n(v) / 100);
    return '<td class="r"><i class="cohort-cell" style="opacity: ' + a.toFixed(2) + '"></i><span>' + fmtN(v) + '%</span></td>';
  }
  function tabRetention(d) {
    var r = obj(d.retention);
    var cohorts = r.cohorts || [];
    var header = '<tr><th>Joined</th><th class="r">People</th>';
    for (var k = 0; k <= 8; k++) header += '<th class="r">Wk ' + k + '</th>';
    header += '</tr>';
    var rows = cohorts
      .map(function (c) {
        return (
          '<tr><td>' +
          esc(weekText(c.week)) +
          '</td><td class="r">' +
          fmtN(c.size) +
          '</td>' +
          (c.weeks || [])
            .map(function (v) {
              return cohortCell(v);
            })
            .join('') +
          '</tr>'
        );
      })
      .join('');
    var byArrival = (r.by_arrival || []).map(function (x) {
      return [esc(label(ARRIVAL, x.arrival)), fmtN(x.users), x.w1_pct == null ? '—' : fmtN(x.w1_pct) + '%', x.w4_pct == null ? '—' : fmtN(x.w4_pct) + '%'];
    });
    var byFeature = (r.by_feature || [])
      .slice()
      .sort(function (a, b) {
        return n(b.with_pct) - n(b.without_pct) - (n(a.with_pct) - n(a.without_pct));
      })
      .map(function (f) {
        var lift = f.with_pct == null || f.without_pct == null ? null : n(f.with_pct) - n(f.without_pct);
        return [
          esc(label(FEATURE, f.feature)),
          fmtN(f.with_users) + ' · ' + (f.with_pct == null ? '—' : fmtN(f.with_pct) + '%'),
          fmtN(f.without_users) + ' · ' + (f.without_pct == null ? '—' : fmtN(f.without_pct) + '%'),
          lift == null ? '—' : '<span class="tag ' + (lift >= 10 ? 'ok' : lift <= -10 ? 'bad' : 'plain') + '">' + (lift > 0 ? '+' : '') + lift + ' pts</span>',
        ];
      });
    return (
      '<div class="grid g3">' +
      kpi('Still here after 4 weeks', r.week4_overall == null ? '—' : fmtN(r.week4_overall) + '%', '<span class="tag plain">people who joined 5+ weeks ago</span>') +
      kpi('Came back', fmtN(r.came_back_after_30), '<span class="tag plain">quiet 30+ days, active again this period</span>') +
      kpi('Cohorts', fmtN(cohorts.length), '<span class="tag plain">sign-up weeks, last 12</span>') +
      '</div>' +
      card(
        'Who comes back',
        'Of the people who joined each week, the share active in each later week. Week 0 is the sign-up week. A dot means that week has not happened yet.',
        '<div class="scroll-x"><table class="cohort">' + header + rows + '</table></div>',
      ) +
      '<div class="grid g2">' +
      card(
        'By how they arrived',
        'People who joined in the last 6 months, at least two weeks ago. Week 1 is their second week; week 4 their fifth.',
        table(['Arrived', 'People', 'Back in wk 1', 'Back in wk 4'], byArrival),
      ) +
      card(
        'By what they did in the first fortnight',
        'Of people who joined 5+ weeks ago: how many were still active after four weeks, with and without each thing.',
        table(['Did this early', 'With · kept', 'Without · kept', 'Lift'], byFeature),
      ) +
      '</div>'
    );
  }

  // --- Invites --------------------------------------------------------------------------------

  function tabVirality(d) {
    var v = obj(d.virality);
    var p = obj(d.people);
    var a = obj(d.active);
    var k = n(a.mau_prev) ? (n(v.invited_new_users) / n(a.mau_prev)).toFixed(2) : null;
    return (
      '<div class="grid g5">' +
      kpi('Brought by others', fmtN(v.invited_new_users), delta(v.invited_new_users, v.invited_new_users_prev)) +
      kpi('Share of new people', pctOf(v.invited_new_users, p.new), '<span class="tag plain">by invite, link or friend</span>') +
      kpi('People inviting', fmtN(v.inviters), '<span class="tag plain">sent any invite this period</span>') +
      kpi('Friends each', fmtN(v.friends_per_person), '<span class="tag plain">' + fmtN(v.friendships) + ' friendships</span>') +
      kpi('K-factor', k == null ? '—' : k, '<span class="tag plain">invited ÷ last month’s actives</span>') +
      '</div>' +
      '<div class="grid g2">' +
      card(
        'Friend requests',
        'Typically answered ' + (v.hours_to_accept == null ? '—' : n(v.hours_to_accept) < 1 ? 'within the hour' : 'in ' + fmtN(v.hours_to_accept) + ' hours'),
        funnel([
          { label: 'Sent', v: v.friend_requests },
          { label: 'Accepted', v: v.friend_accepted },
        ]) +
          '<p class="muted small" style="margin-top: 10px">' +
          fmtN(v.friend_pending) +
          ' still waiting · ' +
          delta(v.friend_requests, v.friend_requests_prev) +
          '</p>',
      ) +
      card(
        'Phone invites',
        'Invites to people not yet on Dayli',
        funnel([
          { label: 'Created', v: v.phone_invites },
          { label: 'Sent by message', v: v.phone_invites_sent },
          { label: 'Claimed at sign-up', v: v.phone_invites_claimed },
        ]) +
          '<p class="muted small" style="margin-top: 10px">' +
          (v.phone_invites_claim_pct == null ? 'Not enough invites yet to say how many get claimed.' : fmtN(v.phone_invites_claim_pct) + '% of invites older than three days have been claimed, over the last six months.') +
          '</p>',
      ) +
      '</div>' +
      '<div class="grid g2">' +
      card(
        'Calendars',
        '',
        funnel([
          { label: 'In-app calendar invites', v: v.calendar_invites },
          { label: 'Joined', v: v.calendar_invites_joined },
        ]) +
          '<div style="height: 10px"></div>' +
          stat(fmtN(v.link_joins), 'joined by link or code') +
          stat(fmtN(v.codes_rotated), 'codes rotated'),
      ) +
      card(
        'Public event shares',
        'Links people shared from the app',
        stat(fmtN(v.event_shares), 'share links made') +
          stat(fmtN(v.event_share_taps), 'taps on them') +
          stat(fmtN(v.event_share_views), 'views from shares') +
          '<p class="muted small" style="margin-top: 10px">' +
          fmtN(v.suggested_friends_on) +
          ' people let contacts find them.</p>',
      ) +
      '</div>'
    );
  }

  // --- Events marketplace ----------------------------------------------------------------------

  function tabEvents(d) {
    var m = obj(d.marketplace);
    var byCat = (m.by_category || []).map(function (c) {
      return [esc(ctx.categoryLabel(c.category)), fmtN(c.events), fmtN(c.views), fmtN(c.going), pctOf(c.going, c.views)];
    });
    var top = (m.top_events || []).map(function (e) {
      return [esc(e.title), esc(e.starts_at ? dayText(String(e.starts_at).slice(0, 10)) : ''), fmtN(e.views), fmtN(e.going)];
    });
    var statuses = obj(m.events);
    return (
      '<div class="grid g5">' +
      kpi('Organisers', fmtN(m.organisers), '<span class="tag plain">' + fmtN(m.organisers_active) + ' with a live event</span>') +
      kpi('Live events', fmtN(m.events_live), '<span class="tag plain">' + fmtN(statuses.draft) + ' drafts · ' + fmtN(statuses.cancelled) + ' cancelled</span>') +
      kpi('Views', fmtN(m.views), delta(m.views, m.views_prev)) +
      kpi('Said going', fmtN(m.going_new), delta(m.going_new, m.going_new_prev)) +
      kpi('Ticket clicks', fmtN(m.ticket_clicks), delta(m.ticket_clicks, m.ticket_clicks_prev)) +
      '</div>' +
      '<div class="grid g2">' +
      card(
        'The funnel',
        'Last ' + d.days + ' days',
        funnel([
          { label: 'Seen in Discover', v: m.impressions },
          { label: 'Viewed', v: m.views },
          { label: 'Said going', v: m.going_new },
          { label: 'Clicked for tickets', v: m.ticket_clicks },
        ]) +
          '<p class="muted small" style="margin-top: 10px">' +
          fmtN(m.viewers) +
          ' different people viewed · ' +
          fmtN(m.on_calendar_pct) +
          '% of goers have it on their calendar · ' +
          fmtN(m.changed_mind) +
          ' changed their mind · ' +
          fmtN(m.goers_new_to_dayli) +
          ' people joined Dayli for an event</p>',
      ) +
      card('Where views come from', '', hbars(entries(m.views_by_source, VIEW_SOURCE), n(m.views)) + '<div style="height: 10px"></div>' + hbars(entries(m.views_by_via, { category: 'A category', free: '“When I’m free”', today: '“Today”', weekend: '“This weekend”', week: '“Next 7 days”', month: '“Next 30 days”', search: 'Search', browse: 'Browsing', going: 'Going list', hosting: 'Hosting', link: 'A link' }).map(function (e) { e.cls = 'b'; return e; }), sum(entries(m.views_by_via)))) +
      '</div>' +
      '<div class="grid g2">' +
      card('By category', '', table(['Category', 'Events', 'Views', 'Going', 'View → going'], byCat)) +
      card('Busiest events', 'By views this period', table(['Event', 'When', 'Views', 'Going'], top)) +
      '</div>' +
      '<div class="grid g3">' +
      card('How far people are', 'Viewers, by distance from the event in km', hbars(['<1', '1-3', '3-10', '10+'].map(function (b) { return { label: b + ' km', v: n(obj(m.distance)[b]) }; }), sum(entries(m.distance)))) +
      card('Listings', '', stat(fmtN(m.events_new), 'created') + stat(fmtN(m.events_published), 'published') + stat(fmtN(m.with_tickets), 'with a ticket link') + stat(fmtN(m.free), 'free') + stat(fmtN(m.with_cover), 'with a cover')) +
      card('Going and reminders', '', stat(fmtN(m.going), 'going in all') + stat(fmtN(m.interested), 'interested') + stat(fmtN(m.goers), 'different goers') + stat(fmtN(m.reminders), 'reminders sent') + stat(fmtN(m.reminder_recipients), 'people reminded')) +
      '</div>'
    );
  }

  // --- Notifications ---------------------------------------------------------------------------

  function tabNotifications(d) {
    var no = obj(d.notifications);
    var rows = (no.by_type || []).map(function (t) {
      return [esc(label(NOTE_TYPE, t.type)), fmtN(t.n), fmtN(t.read_pct) + '%'];
    });
    var pb = obj(no.push_by_platform);
    return (
      '<div class="grid g5">' +
      kpi('Sent', fmtN(no.n), delta(no.n, no.prev)) +
      kpi('Opened', fmtN(no.read_pct) + '%', '<span class="tag plain">' + fmtN(no.per_person) + ' each</span>') +
      kpi('Phones with push', fmtN(no.push_people), '<span class="tag plain">' + fmtN(pb.ios) + ' iPhone · ' + fmtN(pb.android) + ' Android</span>') +
      kpi('Opened from a push', fmtN(no.push_opens), delta(no.push_opens, no.push_opens_prev)) +
      kpi('Quiet phones', fmtN(no.push_stale), '<span class="tag plain">not seen in 30 days</span>') +
      '</div>' +
      '<div class="grid g2">' +
      card('By type', 'In the last ' + d.days + ' days, with the share opened in the app', table(['Type', 'Sent', 'Opened'], rows)) +
      card(
        'Settings people chose',
        '',
        hbars(
          [
            { label: 'Morning brief on', v: no.brief_morning_on },
            { label: 'Evening brief on', v: no.brief_evening_on },
            { label: 'Morning suggestion on', v: no.suggestion_on },
            { label: 'A default reminder set', v: no.smart_reminders },
          ],
          n(obj(d.people).total),
        ) +
          '<p class="muted small" style="margin-top: 10px">Briefs sent this period: ' +
          (entries(no.briefs).length
            ? entries(no.briefs)
                .map(function (b) {
                  return esc(b.key) + ' ' + fmtN(b.v);
                })
                .join(' · ')
            : 'none') +
          ' · ' +
          fmtN(no.muted) +
          ' chats muted · ' +
          fmtN(no.push_tokens) +
          ' phones registered</p>',
      ) +
      '</div>'
    );
  }

  // --- Safety ------------------------------------------------------------------------------------

  function tabSafety(d) {
    var s = obj(d.safety);
    return (
      '<div class="grid g5">' +
      kpi('Reports', fmtN(s.reports), '<span class="tag plain">this period</span>') +
      kpi('Waiting', fmtN(s.reports_open), '<span class="tag ' + (n(s.reports_open) ? 'warn' : 'ok') + '">' + (n(s.reports_open) ? 'needs a look' : 'all handled') + '</span>') +
      kpi('Blocks', fmtN(s.blocks), '<span class="tag plain">' + fmtN(s.blocks_total) + ' all time</span>') +
      kpi('Accounts deleted', fmtN(s.deletions), deltaDown(s.deletions, s.deletions_prev)) +
      kpi('Age at deletion', s.deletions_median_days == null ? '—' : fmtN(s.deletions_median_days) + 'd', '<span class="tag plain">typical account</span>') +
      '</div>' +
      '<div class="grid g2">' +
      card(
        'Reports',
        'All time: ' + fmtN(s.reports_total) + ' on messages and comments, ' + fmtN(s.photo_reports_total) + ' on photos',
        hbars(entries(s.reports_by_kind, { event_comment: 'Event comments', calendar_message: 'Calendar chat', dm_message: 'Messages', public_event: 'Public events' }), n(s.reports_total)) +
          '<p class="muted small" style="margin-top: 10px">Photo reports this period: ' +
          fmtN(s.photo_reports) +
          '. Each report emails you with a one-tap delete link.</p>',
      ) +
      card(
        'Leaving and friction',
        '',
        stat(fmtN(s.deletions_total), 'deleted, all time') +
          stat(fmtN(s.deletions_had_shared), 'had shared a calendar') +
          stat(fmtN(s.rate_limited), 'rate-limit hits') +
          stat(fmtN(s.sync_errors), 'synced calendars failing') +
          '<p class="muted small" style="margin-top: 10px">Deletions are counted with how old the account was and whether it had ever shared a calendar; nothing else is kept.</p>',
      ) +
      '</div>'
    );
  }

  // --- Dayli AI -------------------------------------------------------------------------------------

  var CHAT_KEY = 'dayli_admin_ai_chat';
  function chatHistory() {
    try {
      var h = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]');
      return Array.isArray(h) ? h : [];
    } catch (e) {
      return [];
    }
  }
  function saveChat(h) {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(h.slice(-40)));
    } catch (e) {
      /* private mode */
    }
  }
  function askAdmin(body) {
    return ctx.sb.functions.invoke('admin-insights', { body: body }).then(function (res) {
      if (res.error) {
        var c = res.error && res.error.context;
        if (c && typeof c.json === 'function') {
          return c.json().then(
            function (j) {
              throw new Error((j && j.error) || res.error.message || 'failed');
            },
            function () {
              throw new Error(res.error.message || 'failed');
            },
          );
        }
        throw new Error(res.error.message || 'failed');
      }
      if (res.data && res.data.error) throw new Error(res.data.error);
      return res.data;
    });
  }
  function aiError(err) {
    var m = String((err && err.message) || err || '');
    if (/no_provider/.test(m)) return 'Dayli AI is not switched on for this project yet.';
    if (/not_admin/.test(m)) return 'This account is not on the admin list.';
    if (/llm_|deepseek_|failed/.test(m)) return 'Dayli AI could not read the numbers just now. Try again in a minute.';
    return friendly(err);
  }
  function msgHtml(m) {
    return '<div class="msg ' + (m.role === 'user' ? 'me' : 'ai') + '"><div class="bubble">' + esc(m.content).replace(/\n/g, '<br>') + '</div></div>';
  }
  function tabAi(d) {
    var history = chatHistory();
    return (
      '<div class="card ai"><div class="row between"><div><h3>Dayli AI</h3><p class="sub" id="ai-sub">DeepSeek reads the same numbers as these pages: counts, rates and dates only, no names and no text anyone wrote.</p></div>' +
      '<button type="button" class="btn small" id="ai-read">Read the numbers</button></div>' +
      '<div id="ai-summary" style="margin-top: 12px"></div></div>' +
      '<div class="card"><h3>Talk it through</h3><p class="sub">Ask anything about the numbers for the last ' +
      esc(d.days) +
      ' days. No daily limit. The conversation stays in this browser.</p>' +
      '<div class="chat" id="ai-chat">' +
      (history.length ? history.map(msgHtml).join('') : '<p class="muted small" id="ai-empty">Try “Where are we losing people?”, “What should I build next?” or “Which notification should I turn down?”</p>') +
      '</div>' +
      '<form id="ai-ask" class="row" style="margin-top: 12px"><input type="text" name="q" placeholder="Ask Dayli AI…" autocomplete="off" maxlength="500" /><button class="btn primary" type="submit">Ask</button></form>' +
      '<div class="row" style="margin-top: 8px"><button type="button" class="linkish small" id="ai-clear">Clear the conversation</button></div></div>'
    );
  }
  function bindAi(d, days) {
    var summary = $('#ai-summary');
    var readBtn = $('#ai-read');
    var lastKey = 'dayli_admin_ai_summary_' + days;
    try {
      var cached = JSON.parse(localStorage.getItem(lastKey) || 'null');
      if (cached && cached.at && Date.now() - cached.at < 6 * 3600000) renderSummary(cached.note, true);
    } catch (e) {
      /* ignore */
    }
    function renderSummary(note, cachedNote) {
      var sub = $('#ai-sub');
      if (sub) sub.textContent = (cachedNote ? 'Read ' : 'Read just now, ') + (note.at ? timeText(note.at) : '') + '. Counts and rates only; no names.';
      summary.innerHTML =
        '<p style="font-size: 15px; line-height: 1.55; margin: 0 0 6px">' +
        esc(note.summary) +
        '</p>' +
        (note.suggestions || [])
          .map(function (sg, i) {
            return '<div class="insight"><div class="ic">' + (i + 1) + '</div><div><b>' + esc(sg.title) + '</b><div class="muted small">' + esc(sg.why) + '</div></div></div>';
          })
          .join('');
    }
    readBtn.onclick = function () {
      ctx.setBusy(readBtn, true, 'Reading…');
      summary.innerHTML = '<p class="muted small">One moment.</p>';
      askAdmin({ days: Number(days) })
        .then(function (note) {
          note.at = new Date().toISOString();
          ctx.setBusy(readBtn, false);
          renderSummary(note, false);
          try {
            localStorage.setItem(lastKey, JSON.stringify({ at: Date.now(), note: note }));
          } catch (e) {
            /* ignore */
          }
        })
        .catch(function (err) {
          ctx.setBusy(readBtn, false);
          summary.innerHTML = '<p class="muted small">' + esc(aiError(err)) + '</p>';
        });
    };
    var form = $('#ai-ask');
    var chat = $('#ai-chat');
    form.onsubmit = function (e) {
      e.preventDefault();
      var input = form.querySelector('[name=q]');
      var q = input.value.trim();
      if (!q) return;
      var button = form.querySelector('button');
      var history = chatHistory();
      var empty = $('#ai-empty');
      if (empty) empty.remove();
      chat.insertAdjacentHTML('beforeend', msgHtml({ role: 'user', content: q }));
      chat.insertAdjacentHTML('beforeend', '<div class="msg ai" id="ai-pending"><div class="bubble muted">Thinking…</div></div>');
      chat.scrollTop = chat.scrollHeight;
      input.value = '';
      ctx.setBusy(button, true, '…');
      askAdmin({ days: Number(days), question: q, history: history.slice(-12) })
        .then(function (r) {
          ctx.setBusy(button, false);
          var pending = $('#ai-pending');
          if (pending) pending.remove();
          history.push({ role: 'user', content: q });
          history.push({ role: 'assistant', content: r.answer });
          saveChat(history);
          chat.insertAdjacentHTML('beforeend', msgHtml({ role: 'assistant', content: r.answer }));
          chat.scrollTop = chat.scrollHeight;
        })
        .catch(function (err) {
          ctx.setBusy(button, false);
          var pending = $('#ai-pending');
          if (pending) pending.innerHTML = '<div class="bubble muted">' + esc(aiError(err)) + '</div>';
        });
    };
    $('#ai-clear').onclick = function () {
      saveChat([]);
      chat.innerHTML = '<p class="muted small" id="ai-empty">Cleared.</p>';
    };
  }

  return { screen: screen };
};
