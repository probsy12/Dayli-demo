/* Dayli for organisers: the Overview and Analytics screens. Plain browser
 * JavaScript, no build. app.js hands over its helpers in `ctx` and calls
 * screenOverview() / screenAnalytics(id, tab, days). Data comes from
 * organiser_overview() and organiser_event_analytics(id, days) in
 * supabase/migrations/20261028000100_organiser_analytics.sql. */
window.DayliAnalytics = function (ctx) {
  'use strict';
  var esc = ctx.esc;
  var $ = ctx.$;
  var $$ = ctx.$$;
  var rpc = ctx.rpc;
  var render = ctx.render;
  var notice = ctx.notice;
  var toast = ctx.toast;
  var go = ctx.go;
  var friendly = ctx.friendly;
  var state = ctx.state;

  var TABS = [
    ['overview', 'Overview'],
    ['reach', 'Reach'],
    ['timing', 'Timing'],
    ['people', 'People'],
    ['tickets', 'Tickets'],
    ['all', 'All events'],
  ];
  var RANGES = [
    ['7', 'Last 7 days'],
    ['30', 'Last 30 days'],
    ['90', 'Last 90 days'],
    ['all', 'All time'],
  ];
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var VIA_LABELS = {
    category: 'a category',
    free: '“When I’m free”',
    today: '“Today”',
    weekend: '“This weekend”',
    week: '“Next 7 days”',
    month: '“Next 30 days”',
    search: 'search',
    browse: 'browsing',
    going: 'their Going list',
    hosting: 'Hosting',
    link: 'a link',
  };
  var SOURCE_LABELS = {
    app: 'Discover in the app',
    friend: 'A friend was going',
    share: 'Shared link',
    web: 'Public page',
    notification: 'A reminder',
  };

  // --- small helpers ----------------------------------------------------------

  function n(x) {
    var v = Number(x);
    return isFinite(v) ? v : 0;
  }
  function fmtN(x) {
    return n(x).toLocaleString('en-GB');
  }
  function pct(a, b) {
    return b ? Math.round((n(a) / n(b)) * 100) : 0;
  }
  function pctText(a, b) {
    return b ? pct(a, b) + '%' : '—';
  }
  function dayLabel(iso, withWeekday) {
    var d = iso instanceof Date ? iso : new Date(iso + (String(iso).length === 10 ? 'T12:00:00' : ''));
    if (isNaN(d.getTime())) return String(iso);
    var s = d.getDate() + ' ' + MONTHS[d.getMonth()];
    return withWeekday ? DOW[(d.getDay() + 6) % 7] + ' ' + s : s;
  }
  function daysUntil(iso) {
    return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
  }
  function plural(count, word, words) {
    return fmtN(count) + ' ' + (n(count) === 1 ? word : words || word + 's');
  }
  function tagDelta(cur, prev, what) {
    cur = n(cur);
    prev = n(prev);
    if (!cur && !prev) return '';
    if (!prev) return '<span class="tag ok">▲ ' + fmtN(cur) + ' this week</span>';
    var d = Math.round(((cur - prev) / prev) * 100);
    if (d === 0) return '<span class="tag plain">same as last week</span>';
    return d > 0
      ? '<span class="tag ok">▲ ' + d + '% vs last week</span>'
      : '<span class="tag bad">▼ ' + Math.abs(d) + '% vs last week</span>';
  }
  function kpi(label, value, tag) {
    return (
      '<div class="card kpi"><div class="label">' +
      label +
      '</div><div class="num">' +
      value +
      '</div>' +
      (tag || '') +
      '</div>'
    );
  }
  function card(title, sub, body, more) {
    return (
      '<div class="card"><h3>' +
      title +
      '</h3>' +
      (sub ? '<p class="sub">' + sub + '</p>' : '') +
      body +
      (more ? '<div class="more"><span>' + more[0] + '</span><a href="' + more[1] + '">' + more[2] + ' ›</a></div>' : '') +
      '</div>'
    );
  }
  // Vertical bars: items [{v, tip, cls}]
  function bars(items, cls) {
    var max = 0;
    items.forEach(function (it) {
      if (n(it.v) > max) max = n(it.v);
    });
    return (
      '<div class="bars ' +
      (cls || '') +
      '">' +
      items
        .map(function (it) {
          var h = max ? Math.max(n(it.v) ? 3 : 0, Math.round((n(it.v) / max) * 100)) : 0;
          return (
            '<i style="height: ' +
            h +
            '%" class="' +
            (it.cls || '') +
            '" data-tip="' +
            esc(it.tip || '') +
            '"></i>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  // Horizontal bars: rows [{label, v, cls}], as a share of total.
  function hbars(rows, total) {
    return rows
      .map(function (r) {
        return (
          '<div class="hrow"><span>' +
          esc(r.label) +
          '</span><b>' +
          (r.text || pctText(r.v, total)) +
          '</b></div><div class="hbar"><i class="' +
          (r.cls || '') +
          '" style="width: ' +
          pct(r.v, total) +
          '%"></i></div>'
        );
      })
      .join('');
  }
  function axis(labels) {
    return (
      '<div class="axis">' +
      labels
        .map(function (l) {
          return '<span>' + esc(l) + '</span>';
        })
        .join('') +
      '</div>'
    );
  }
  function initial(name) {
    return esc((name || '?').trim().charAt(0).toUpperCase());
  }
  function av(name, i) {
    var colours = ['var(--accent)', 'var(--blue)', 'var(--orange)', 'var(--muted)'];
    return (
      '<span class="avatar sm" style="background: ' +
      colours[(i || 0) % colours.length] +
      '">' +
      initial(name) +
      '</span>'
    );
  }

  // The days of the window as keys, oldest first.
  function dayKeys(days, tz) {
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      out.push(ctx.isoToZoned(new Date(Date.now() - i * 86400000).toISOString(), tz).date);
    }
    return out;
  }

  // --- the "What to do" list --------------------------------------------------

  // Three things worth the organiser's time, from everything the numbers
  // say. Each: {icon, title, detail, action: {label, href} | {label, act}}.
  function insights(a) {
    var out = [];
    if (!a) return out;
    var ev = a.event;
    var t = a.totals;
    var upcoming = ev.status === 'published' && new Date(ev.starts_at).getTime() > Date.now();
    var busiest = busiestSlot(a.heat);

    if (upcoming && a.remind && a.remind.ok && n(a.remind.targets) > 0) {
      var last = (a.reminders || [])[0];
      out.push({
        icon: '🔔',
        title: plural(a.remind.targets, 'person interested hasn’t', 'people interested haven’t') + ' said yes.',
        detail:
          (busiest ? 'They mostly look ' + busiest + '. ' : '') +
          (last ? 'The last reminder brought ' + plural(last.going_after, 'going', 'going') + '.' : 'A nudge reaches everyone who said interested.'),
        action: { label: 'Send a reminder', act: 'remind' },
      });
    }
    if (ev.ticket_url && n(a.tickets.web_views) >= 10 && n(a.tickets.app_views) >= 10) {
      var webRate = n(a.tickets.web) / n(a.tickets.web_views);
      var appRate = n(a.tickets.app) / n(a.tickets.app_views);
      if (appRate > 0 && webRate < appRate * 0.5) {
        out.push({
          icon: '🎟',
          title: 'Ticket clicks from the public page are low.',
          detail: Math.round(webRate * 100) + '% of web visitors click, ' + Math.round(appRate * 100) + '% in the app. Check the link opens on a phone.',
          action: { label: 'Open the page', href: ctx.SITE + '/e/' + ev.slug, blank: true },
        });
      }
    }
    if (upcoming && !ev.ticket_url && a.priced) {
      out.push({
        icon: '🎟',
        title: 'No ticket link yet.',
        detail: 'People who say going have nowhere to buy. Add the link where tickets are sold.',
        action: { label: 'Edit event', href: '#/events/' + ev.id },
      });
    }
    var cm = clusterChangedMind(a.changed_mind);
    if (cm) {
      out.push({
        icon: '↩️',
        title: plural(cm.n, 'person', 'people') + ' dropped out around ' + dayLabel(cm.day) + '.',
        detail: 'Did the time, place or price change then? A quick note to everyone going helps.',
      });
    }
    var b = a.benchmarks || {};
    if (n(a.discover.seen) >= 100 && b.tap_rate) {
      var tap = n(a.discover.opened) / n(a.discover.seen);
      if (tap < n(b.tap_rate) * 0.7) {
        out.push({
          icon: '👀',
          title: 'Fewer people open it than other ' + ctx.categoryLabel(ev.category).toLowerCase() + ' events.',
          detail: Math.round(tap * 100) + '% tap it in Discover against ' + Math.round(n(b.tap_rate) * 100) + '% on average. A clearer title or a better photo usually fixes this.',
          action: { label: 'Edit event', href: '#/events/' + ev.id },
        });
      }
    }
    if (!ev.cover_image_path && upcoming) {
      out.push({
        icon: '🖼',
        title: 'No cover photo.',
        detail: 'Events with a photo get more taps in Discover.',
        action: { label: 'Add one', href: '#/events/' + ev.id },
      });
    }
    var sh = (a.sharers || [])[0];
    if (sh && n(sh.views) >= 5) {
      out.push({
        icon: '📣',
        title: esc(sh.name) + '’s share brought ' + plural(sh.views, 'view') + (n(sh.going) ? ' and ' + plural(sh.going, 'person going', 'people going') : '') + '.',
        detail: 'A thank-you goes a long way.',
      });
    }
    if (n(t.views_prev_7d) >= 20 && n(t.views_7d) < n(t.views_prev_7d) * 0.6 && upcoming) {
      out.push({
        icon: '📉',
        title: 'Views fell this week.',
        detail: fmtN(t.views_7d) + ' against ' + fmtN(t.views_prev_7d) + ' the week before. Share the link again, or post it somewhere new.',
        action: { label: 'Copy the link', act: 'copy' },
      });
    }
    var prev = a.buildup && a.buildup.previous;
    var ahead = aheadOfPrevious(a.buildup);
    if (prev && ahead !== null && upcoming) {
      out.push({
        icon: ahead >= 0 ? '📈' : '🐢',
        title: (ahead >= 0 ? Math.abs(ahead) + ' ahead of ' : Math.abs(ahead) + ' behind ') + esc(prev.title) + ' at this point.',
        detail: ahead >= 0 ? 'On track to beat its ' + plural(prev.final, 'going', 'going') + '.' : prev.title + ' finished on ' + plural(prev.final, 'going', 'going') + '. A reminder or a share now closes the gap.',
      });
    }
    if (!out.length && upcoming && n(t.views) < 20) {
      out.push({
        icon: '📣',
        title: 'Early days: ' + plural(t.views, 'view') + ' so far.',
        detail: 'Share the link with people who’d come, and ask them to share it on.',
        action: { label: 'Copy the link', act: 'copy' },
      });
    }
    return out.slice(0, 3);
  }

  // "Thursday 7–9pm": the busiest hour and its neighbours.
  function busiestSlot(heat) {
    if (!heat || !heat.length) return null;
    var best = null;
    heat.forEach(function (h) {
      if (!best || n(h.n) > n(best.n)) best = h;
    });
    if (!best || n(best.n) < 3) return null;
    var h = n(best.hour);
    var days = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
    return 'on ' + days[n(best.dow)] + ' around ' + hourText(h);
  }
  function hourText(h) {
    var hh = h % 12 || 12;
    return hh + (h < 12 ? 'am' : 'pm');
  }
  // Three or more drop-outs within three days.
  function clusterChangedMind(rows) {
    if (!rows || !rows.length) return null;
    var best = null;
    rows.forEach(function (r, i) {
      var sum = 0;
      var d0 = new Date(r.day + 'T12:00:00').getTime();
      rows.forEach(function (s) {
        var d = new Date(s.day + 'T12:00:00').getTime();
        if (d >= d0 && d <= d0 + 2 * 86400000) sum += n(s.n);
      });
      if (sum >= 3 && (!best || sum > best.n)) best = { day: r.day, n: sum, i: i };
    });
    return best;
  }
  // Going now minus the previous event's going at the same days-before.
  function aheadOfPrevious(buildup) {
    if (!buildup || !buildup.previous || !buildup.points || !buildup.points.length) return null;
    var last = buildup.points[buildup.points.length - 1];
    var same = null;
    (buildup.previous.points || []).forEach(function (p) {
      if (n(p.days_before) === n(last.days_before)) same = p;
    });
    if (!same) {
      // Nearest earlier point.
      (buildup.previous.points || []).forEach(function (p) {
        if (n(p.days_before) >= n(last.days_before) && (!same || n(p.days_before) < n(same.days_before))) same = p;
      });
    }
    return same ? n(last.going) - n(same.going) : null;
  }
  function insightsHtml(list) {
    if (!list.length) return '<p class="muted small" style="margin: 8px 0 0">Nothing needs you right now. Check back after a few more views.</p>';
    return list
      .map(function (it, i) {
        var act = '';
        if (it.action && it.action.href) {
          act =
            '<a class="btn small act" href="' +
            esc(it.action.href) +
            '"' +
            (it.action.blank ? ' target="_blank" rel="noopener"' : '') +
            '>' +
            esc(it.action.label) +
            '</a>';
        } else if (it.action && it.action.act) {
          act = '<button type="button" class="btn small primary act" data-act="' + esc(it.action.act) + '" data-i="' + i + '">' + esc(it.action.label) + '</button>';
        }
        return (
          '<div class="insight"><div class="ic">' +
          it.icon +
          '</div><div><b>' +
          it.title +
          '</b><div class="muted small">' +
          it.detail +
          '</div></div>' +
          act +
          '</div>'
        );
      })
      .join('');
  }
  function bindInsightActions(a, reload) {
    $$('[data-act]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.act === 'copy') return ctx.copyText(ctx.SITE + '/e/' + a.event.slug);
        if (b.dataset.act === 'remind') return sendReminder(a.event.id, b, reload);
      };
    });
  }
  function sendReminder(id, button, reload) {
    if (!confirm('Send a reminder to everyone who said interested but not going?\n\nThey get one push notification. Nobody gets more than one a week.')) return;
    ctx.setBusy(button, true, 'Sending…');
    rpc('public_event_send_reminder', { p_event_id: id })
      .then(function (r) {
        toast('Reminder sent to ' + plural((r && r.sent) || 0, 'person', 'people') + '.');
        reload();
      })
      .catch(function (err) {
        ctx.setBusy(button, false);
        alert(friendly(err));
      });
  }

  // --- loading ------------------------------------------------------------------

  function loadOverview() {
    return rpc('organiser_overview').then(function (o) {
      state.overview = o || { totals: {}, events: [], benchmarks: {} };
      return state.overview;
    });
  }
  function loadAnalytics(id, days) {
    return rpc('organiser_event_analytics', { p_id: id, p_days: days === 'all' ? null : parseInt(days, 10) }).then(function (a) {
      if (a) {
        a.priced = !!(state.overview && state.overview.events || []).filter(function (e) { return e.id === id && !e.is_free; }).length;
      }
      return a;
    });
  }
  // The event to open analytics for when none is named: the next upcoming
  // published one, else the most recent.
  function focusEvent(events) {
    var now = Date.now();
    var up = events
      .filter(function (e) {
        return e.status === 'published' && new Date(e.ends_at).getTime() >= now;
      })
      .sort(function (a, b) {
        return new Date(a.starts_at) - new Date(b.starts_at);
      });
    if (up.length) return up[0];
    var pub = events.filter(function (e) {
      return e.status !== 'draft';
    });
    return pub[0] || events[0] || null;
  }

  // --- Overview screen ---------------------------------------------------------

  function screenOverview() {
    ctx.loading();
    loadOverview()
      .then(function (o) {
        var focus = focusEvent(o.events);
        if (!focus || focus.status === 'draft') return renderOverview(o, focus, null);
        return loadAnalytics(focus.id, '30').then(
          function (a) {
            renderOverview(o, focus, a);
          },
          function () {
            renderOverview(o, focus, null);
          },
        );
      })
      .catch(function (err) {
        render(notice('error', esc(friendly(err))) + '<button class="btn" id="retry">Try again</button>');
        $('#retry').onclick = screenOverview;
      });
  }

  function renderOverview(o, focus, a) {
    var t = o.totals || {};
    var events = o.events || [];
    var now = Date.now();
    var upcoming = events
      .filter(function (e) {
        return new Date(e.ends_at).getTime() >= now && e.status !== 'cancelled';
      })
      .sort(function (x, y) {
        return new Date(x.starts_at) - new Date(y.starts_at);
      });
    var todo = a ? insights(a) : [];
    // Things about the account and drafts come first.
    var house = [];
    if (!ctx.isVerified()) {
      house.push({ icon: '✉️', title: 'Confirm your email to publish.', detail: 'We send a code to your address; you type it in.', action: { label: 'Confirm', href: '#/verify' } });
    }
    events.forEach(function (e) {
      if (e.status === 'draft' && new Date(e.ends_at).getTime() >= now) {
        house.push({
          icon: '📝',
          title: esc(e.title) + ' is still a draft.',
          detail: e.lat == null ? 'Add the venue and find it on the map, then publish.' : 'Publish it so people can find it.',
          action: { label: e.lat == null ? 'Finish it' : 'Open', href: '#/events/' + e.id },
        });
      }
    });
    var list = house.concat(todo).slice(0, 3);
    var greeting = state.organiser ? 'Hello, ' + esc(state.organiser.name) : 'Overview';

    var html =
      '<div class="page-head"><div><div class="label">Overview</div><h1>' +
      greeting +
      '</h1><p class="muted">' +
      (events.length ? plural(events.length, 'event') + ' · ' + plural(t.going, 'person going', 'people going') + ' across everything' : 'Nothing listed yet.') +
      '</p></div><a class="btn primary" href="#/events/new">+ New event</a></div>';

    if (!events.length) {
      html +=
        '<div class="card empty"><h2>List your first event</h2><p class="muted">A title, a time and a place is enough to start. You can publish when you’re ready.</p><a class="btn primary" href="#/events/new">New event</a></div>';
      render(html);
      return;
    }

    html +=
      '<div class="grid g4">' +
      kpi('Views, 30 days', fmtN(t.views), tagDelta(t.views_7d, t.views_prev_7d)) +
      kpi('Going', fmtN(t.going), '<span class="tag info">' + fmtN(t.interested) + ' interested</span>') +
      kpi('Seen in Discover', fmtN(t.seen), n(t.seen) ? '<span class="tag plain">' + pct(t.views, t.seen) + '% opened</span>' : '') +
      kpi('Ticket clicks', fmtN(t.ticket_clicks), n(t.going) ? '<span class="tag plain">' + pct(t.ticket_clicks, t.going) + '% of going</span>' : '') +
      '</div>';

    html += '<div class="grid g21">';
    html += card(
      'What to do',
      focus && a ? 'Mostly about ' + esc(focus.title) + ', your next event' : 'Across your events',
      insightsHtml(list),
      focus && a ? ['See all its numbers', '#/analytics/' + focus.id, 'Analytics'] : null,
    );
    html += card(
      'Coming up',
      upcoming.length ? plural(upcoming.length, 'event') : 'No upcoming events',
      upcoming.length
        ? upcoming
            .slice(0, 5)
            .map(function (e) {
              return (
                '<div class="insight"><div class="grow"><a href="#/analytics/' +
                esc(e.id) +
                '" style="font-weight: 700; text-decoration: none; color: var(--ink)">' +
                esc(e.title) +
                '</a><div class="muted small">' +
                esc(ctx.fmtWhen(e.starts_at, e.ends_at, e.timezone)) +
                ' · ' +
                ctx.statusBadge(e.status) +
                '</div><div class="numbers"><span><b>' +
                fmtN(e.views) +
                '</b> views</span><span><b>' +
                fmtN(e.going) +
                '</b> going</span><span><b>' +
                fmtN(e.interested) +
                '</b> interested</span></div></div><div style="width: 90px">' +
                spark(e.spark) +
                '</div></div>'
              );
            })
            .join('')
        : '<p class="muted small">Make one with the button above.</p>',
      ['All your events', '#/events', 'Events'],
    );
    html += '</div>';
    render(html);
    if (a) bindInsightActions(a, screenOverview);
  }

  function spark(values) {
    if (!values || !values.length) return '';
    var max = 0;
    values.forEach(function (v) {
      if (n(v) > max) max = n(v);
    });
    return (
      '<div class="spark" title="Views, last 14 days">' +
      values
        .map(function (v) {
          return '<i style="height: ' + (max ? Math.max(n(v) ? 6 : 2, Math.round((n(v) / max) * 100)) : 2) + '%"></i>';
        })
        .join('') +
      '</div>'
    );
  }

  // --- Dayli AI ----------------------------------------------------------------------

  function askAi(body) {
    return ctx.sb.functions.invoke('organiser-insights', { body: body }).then(function (res) {
      if (res.error) {
        // supabase-js wraps non-2xx replies; the body has our error code.
        var ctxBody = res.error && res.error.context;
        if (ctxBody && typeof ctxBody.json === 'function') {
          return ctxBody.json().then(
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
    if (/rate_limited/.test(m)) return 'You have used today’s Dayli AI allowance. It resets tomorrow.';
    if (/llm_|deepseek_|failed/.test(m)) return 'Dayli AI could not read the numbers just now. Try again in a minute.';
    return friendly(err);
  }
  function renderAiNote(note, a, reload) {
    var body = $('#ai-body');
    var sub = $('#ai-sub');
    if (!body) return;
    var when = note.created_at ? new Date(note.created_at) : null;
    sub.textContent =
      'DeepSeek read today’s numbers' +
      (when ? ' at ' + when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '') +
      '. Counts and rates only; no names.';
    var acts = { remind: ['Send a reminder', 'remind'], edit: ['Edit event', null], copy: ['Copy the link', 'copy'] };
    body.innerHTML =
      '<p style="font-size: 15px; line-height: 1.55; margin: 0 0 6px">' +
      esc(note.summary) +
      '</p>' +
      (note.suggestions || [])
        .map(function (sg, i) {
          var act = acts[sg.action];
          var button = '';
          if (act && sg.action === 'edit') button = '<a class="btn small act" href="#/events/' + esc(a.event.id) + '">Edit event</a>';
          else if (act && (sg.action !== 'remind' || (a.remind && a.remind.ok)))
            button = '<button type="button" class="btn small primary act" data-act="' + act[1] + '" data-i="ai' + i + '">' + act[0] + '</button>';
          return '<div class="insight"><div class="ic">' + (i + 1) + '</div><div><b>' + esc(sg.title) + '</b><div class="muted small">' + esc(sg.why) + '</div></div>' + button + '</div>';
        })
        .join('');
    var refresh = $('#ai-refresh');
    if (refresh) refresh.hidden = false;
    bindInsightActions(a, reload);
  }
  function loadAi(a, reload) {
    var card = $('#ai-card');
    if (!card || !ctx.sb || !ctx.sb.functions) return;
    var id = a.event.id;
    function fetchNote(refresh) {
      $('#ai-sub').textContent = refresh ? 'Reading again…' : 'Reading your numbers…';
      $('#ai-body').innerHTML = '<p class="muted small">One moment.</p>';
      askAi({ event_id: id, refresh: !!refresh })
        .then(function (note) {
          renderAiNote(note, a, reload);
        })
        .catch(function (err) {
          $('#ai-sub').textContent = '';
          $('#ai-body').innerHTML = '<p class="muted small">' + esc(aiError(err)) + '</p>';
          var refreshBtn = $('#ai-refresh');
          if (refreshBtn) refreshBtn.hidden = false;
        });
    }
    if (n(a.totals.views) < 10 && !a.reminders.length) {
      $('#ai-sub').textContent = 'Early days.';
      $('#ai-body').innerHTML = '<p class="muted small">Dayli AI starts once the event has a few views. Share the link to get the first ones.</p>';
    } else fetchNote(false);
    $('#ai-refresh').onclick = function () {
      fetchNote(true);
    };
    $('#ai-ask').onsubmit = function (e) {
      e.preventDefault();
      var input = $('#ai-ask [name=q]');
      var q = input.value.trim();
      if (!q) return;
      var button = $('#ai-ask button');
      var out = $('#ai-answer');
      ctx.setBusy(button, true, '…');
      out.hidden = false;
      out.innerHTML = '<span class="muted">Thinking…</span>';
      askAi({ event_id: id, question: q })
        .then(function (r) {
          ctx.setBusy(button, false);
          out.innerHTML = '<b>' + esc(q) + '</b><div style="margin-top: 4px">' + esc(r.answer) + '</div>';
          input.value = '';
        })
        .catch(function (err) {
          ctx.setBusy(button, false);
          out.innerHTML = '<span class="muted">' + esc(aiError(err)) + '</span>';
        });
    };
  }

  // --- Analytics screen ------------------------------------------------------------

  function screenAnalytics(id, tab, days) {
    tab = tab || 'overview';
    days = days || '30';
    ctx.loading();
    var listP = state.overview ? Promise.resolve(state.overview) : loadOverview();
    listP
      .then(function (o) {
        var events = o.events || [];
        var ev = null;
        events.forEach(function (e) {
          if (e.id === id) ev = e;
        });
        if (!ev) ev = focusEvent(events);
        if (!ev) {
          render(
            '<div class="page-head"><h1>Analytics</h1></div><div class="card empty"><h2>No events yet</h2><p class="muted">Numbers show up here once you list an event.</p><a class="btn primary" href="#/events/new">New event</a></div>',
          );
          return;
        }
        if (ev.id !== id) return go('#/analytics/' + ev.id + (tab !== 'overview' ? '?tab=' + tab : ''));
        if (tab === 'all') return renderAnalytics(ev, null, o, tab, days);
        return loadAnalytics(ev.id, days).then(function (a) {
          if (!a) throw new Error('not_found');
          renderAnalytics(ev, a, o, tab, days);
        });
      })
      .catch(function (err) {
        render('<h1>Analytics</h1>' + notice('error', esc(friendly(err))) + '<a class="btn" href="#/events">Back to your events</a>');
      });
  }

  function renderAnalytics(ev, a, o, tab, days) {
    var tz = ctx.safeTz(ev.timezone || 'Europe/London');
    var events = o.events || [];
    var reload = function () {
      state.overview = null;
      screenAnalytics(ev.id, tab, days);
    };
    var dtu = daysUntil(ev.starts_at);
    var sub =
      esc(ctx.fmtWhen(ev.starts_at, ev.ends_at, ev.timezone)) +
      (ev.status === 'published' ? (dtu > 0 ? ' · ' + plural(dtu, 'day') + ' to go' : dtu === 0 ? ' · today' : ' · over') : ' · ' + ctx.statusBadge(ev.status));

    var head =
      '<div class="page-head"><div><div class="label">Analytics</div><h1>' +
      esc(ev.title) +
      '</h1><p class="muted small">' +
      sub +
      '</p></div><div class="controls"><select class="dd" id="pick-event" aria-label="Event">' +
      events
        .map(function (e) {
          return '<option value="' + esc(e.id) + '"' + (e.id === ev.id ? ' selected' : '') + '>' + esc(e.title) + '</option>';
        })
        .join('') +
      '</select><select class="dd" id="pick-range" aria-label="Time range"' +
      (tab === 'all' ? ' hidden' : '') +
      '>' +
      RANGES.map(function (r) {
        return '<option value="' + r[0] + '"' + (r[0] === days ? ' selected' : '') + '>' + r[1] + '</option>';
      }).join('') +
      '</select><a class="btn small" href="#/events/' +
      esc(ev.id) +
      '">Edit</a></div></div>';
    var tabs =
      '<div class="seg" style="margin-bottom: 14px">' +
      TABS.map(function (t) {
        return '<button type="button" data-tab="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</button>';
      }).join('') +
      '</div>';

    var body = '';
    if (tab === 'all') body = tabAll(o);
    else if (!a) body = notice('warn', 'No numbers yet.');
    else if (tab === 'overview') body = tabOverview(a, tz, days);
    else if (tab === 'reach') body = tabReach(a, tz);
    else if (tab === 'timing') body = tabTiming(a, tz);
    else if (tab === 'people') body = tabPeople(a, tz);
    else if (tab === 'tickets') body = tabTickets(a, tz);

    render(
      head +
        tabs +
        body +
        '<p class="muted small" style="margin-top: 14px">We only keep counts, bands and the first names of people who said going or shared it. Who looked is never stored by name.</p>',
    );
    $('#pick-event').onchange = function () {
      go('#/analytics/' + this.value + '?tab=' + tab + '&days=' + days);
    };
    $('#pick-range').onchange = function () {
      go('#/analytics/' + ev.id + '?tab=' + tab + '&days=' + this.value);
    };
    $$('[data-tab]').forEach(function (b) {
      b.onclick = function () {
        go('#/analytics/' + ev.id + '?tab=' + b.dataset.tab + '&days=' + days);
      };
    });
    if (a) bindInsightActions(a, reload);
    if (a && tab === 'overview') loadAi(a, reload);
    var alerts = $('#alerts');
    if (alerts) {
      alerts.onchange = function () {
        rpc('organiser_set_alerts', { p_on: alerts.checked })
          .then(function (on) {
            if (state.organiser) state.organiser.alerts = on;
            toast(on ? 'Alerts on.' : 'Alerts off.');
          })
          .catch(function (err) {
            alert(friendly(err));
          });
      };
    }
  }

  // Views (green) and net going (orange) by day, over the window.
  function byDayChart(a, tz, days) {
    var span = days === 'all' ? 90 : parseInt(days, 10);
    var keys = dayKeys(span, tz);
    var map = {};
    (a.by_day || []).forEach(function (d) {
      map[d.day] = d;
    });
    var views = keys.map(function (k) {
      var d = map[k];
      return { v: d ? n(d.views) : 0, tip: dayLabel(k, true) + ': ' + plural(d ? d.views : 0, 'view'), cls: new Date(k) < new Date(a.event.published_at || 0) ? 'lo' : '' };
    });
    var going = keys.map(function (k) {
      var d = map[k];
      return { v: d ? Math.max(0, n(d.going)) : 0, tip: dayLabel(k, true) + ': ' + plural(d ? Math.max(0, n(d.going)) : 0, 'new going', 'new going'), cls: 'o' };
    });
    var any = views.some(function (x) {
      return x.v;
    });
    if (!any)
      return '<p class="muted small">No views in this period yet. Share the link to get the word out.</p>';
    return (
      bars(views) +
      bars(going, 'short') +
      axis([dayLabel(keys[0]), dayLabel(keys[Math.floor(keys.length / 2)]), 'Today'])
    );
  }

  // The Dayli AI card: filled in after render by loadAi().
  function aiCardHtml(ev) {
    return (
      '<div class="card ai" id="ai-card" data-event="' +
      esc(ev.id) +
      '"><div class="row between"><div><h3>Dayli AI</h3><p class="sub" id="ai-sub">Reading your numbers…</p></div>' +
      '<button type="button" class="linkish small" id="ai-refresh" hidden>Refresh</button></div>' +
      '<div id="ai-body"><p class="muted small">One moment.</p></div>' +
      '<form id="ai-ask" class="row" style="margin-top: 12px; gap: 8px; flex-wrap: nowrap"><input type="text" name="q" maxlength="300" placeholder="Ask about your numbers, e.g. why did views drop on Tuesday?" aria-label="Ask about your numbers" style="min-height: 40px" /><button class="btn small" type="submit">Ask</button></form>' +
      '<div id="ai-answer" class="small" style="margin-top: 10px" hidden></div></div>'
    );
  }

  function tabOverview(a, tz, days) {
    var t = a.totals;
    var ev = a.event;
    var list = insights(a);
    var html =
      aiCardHtml(ev) +
      '<div class="grid g4">' +
      kpi('Views', fmtN(t.views), tagDelta(t.views_7d, t.views_prev_7d)) +
      kpi('Interested', fmtN(t.interested), n(t.unique_viewers) ? '<span class="tag info">' + pct(t.interested, t.unique_viewers) + '% of viewers</span>' : '') +
      kpi('Going', fmtN(t.going), n(t.going_7d) ? '<span class="tag ok">▲ ' + fmtN(t.going_7d) + ' this week</span>' : '') +
      (ev.ticket_url
        ? kpi('Ticket clicks', fmtN(t.ticket_clicks), n(t.going) ? '<span class="tag warn">' + pct(t.ticket_clicks, t.going) + '% of going</span>' : '')
        : kpi('On calendars', fmtN(t.calendar_adds), n(t.going) ? '<span class="tag ok">' + pct(t.calendar_adds, t.going) + '% of going</span>' : '')) +
      '</div>';
    html += '<div class="grid g21">';
    html += card(
      'Views and going, day by day',
      '<span class="legend"><i></i>views <i class="o"></i>new going</span>',
      byDayChart(a, tz, days),
      ['See the funnel and where people came from', '#/analytics/' + ev.id + '?tab=reach&days=' + days, 'Reach'],
    );
    html += card('What to do', 'Three things worth your time this week', insightsHtml(list));
    html += '</div>';

    // Teasers.
    var srcTotal = 0;
    var bySource = {};
    (a.sources || []).forEach(function (s) {
      srcTotal += n(s.n);
      bySource[s.source] = (bySource[s.source] || 0) + n(s.n);
    });
    var distGoing = a.distance.going || {};
    var near = n(distGoing['<1']) + n(distGoing['1-3']);
    var distAll = Object.keys(distGoing).reduce(function (s, k) {
      return s + n(distGoing[k]);
    }, 0);
    var ahead = aheadOfPrevious(a.buildup);
    var prev = a.buildup && a.buildup.previous;
    html += '<div class="grid g3">';
    html += card(
      'Where from',
      null,
      srcTotal
        ? hbars(
            [
              { label: 'Discover', v: n(bySource.app) + n(bySource.friend), cls: '' },
              { label: 'Shared by people', v: n(bySource.share), cls: 'o' },
              { label: 'Public page and search', v: n(bySource.web) + n(bySource.notification), cls: 'b' },
            ],
            srcTotal,
          )
        : '<p class="muted small">Nothing yet.</p>',
      ['', '#/analytics/' + ev.id + '?tab=reach&days=' + days, 'Reach'],
    );
    html += card(
      'Who’s going',
      null,
      '<div><span class="stat"><span class="v">' +
        fmtN(t.going) +
        '</span><span class="l">going</span></span>' +
        (n(t.going) ? '<span class="stat"><span class="v">' + pct(a.audience.returning, t.going) + '%</span><span class="l">came before</span></span>' : '') +
        (distAll ? '<span class="stat"><span class="v">' + pct(near, distAll) + '%</span><span class="l">within 3 miles</span></span>' : '') +
        '</div>' +
        (a.going_list.length
          ? '<div class="small" style="margin-top: 10px">' +
            a.going_list
              .slice(0, 4)
              .map(function (g, i) {
                return av(g.name, i);
              })
              .join('') +
            '<span class="muted">' +
            a.going_list
              .slice(0, 4)
              .map(function (g) {
                return esc(g.name);
              })
              .join(', ') +
            (a.going_list.length > 4 ? ' and ' + (a.going_list.length - 4) + ' more' : '') +
            '</span></div>'
          : '<p class="muted small" style="margin-top: 8px">No one yet.</p>'),
      ['', '#/analytics/' + ev.id + '?tab=people&days=' + days, 'People'],
    );
    html += card(
      prev ? 'Against your ' + esc(prev.title) : 'How going builds up',
      null,
      curve(a.buildup, 90) +
        (prev && ahead !== null
          ? '<div class="small" style="margin-top: 6px">' +
            (ahead >= 0 ? '<span class="tag ok">▲ ' + ahead + ' ahead at this point</span>' : '<span class="tag bad">▼ ' + Math.abs(ahead) + ' behind at this point</span>') +
            '</div>'
          : '<div class="muted small" style="margin-top: 6px">Going, day by day, up to the event.</div>'),
      ['', '#/analytics/' + ev.id + '?tab=timing&days=' + days, 'Timing'],
    );
    html += '</div>';
    return html;
  }

  function tabReach(a, tz) {
    var t = a.totals;
    var ev = a.event;
    var d = a.discover;
    var b = a.benchmarks || {};
    var tap = n(d.seen) ? Math.round((n(d.opened) / n(d.seen)) * 100) : null;
    var shortText = [];
    if (n(d.seen)) {
      shortText.push(
        fmtN(d.seen) + ' people saw it in Discover and ' + tap + '% tapped' +
          (b.tap_rate ? (tap >= Math.round(n(b.tap_rate) * 100) ? ', above' : ', below') + ' the ' + ctx.categoryLabel(ev.category).toLowerCase() + ' average of ' + Math.round(n(b.tap_rate) * 100) + '%' : '') + '.',
      );
    } else shortText.push('Nobody has seen it in Discover yet.');
    var topVia = Object.keys(d.via || {}).sort(function (x, y) {
      return n(d.via[y]) - n(d.via[x]);
    })[0];
    if (topVia) shortText.push('Most found it under ' + VIA_LABELS[topVia] + '.');
    if (n(t.share_views)) shortText.push('Shares brought ' + pct(t.share_views, t.views) + '% of all views.');

    var html = '<div class="card inshort"><b>In short:</b> ' + shortText.join(' ') + '</div>';

    // Funnel as a table.
    var steps = [
      ['Seen in Discover', n(d.seen), null],
      ['Opened it', n(t.views), n(d.seen)],
      ['Unique people', n(t.unique_viewers), null],
      ['Interested', n(t.interested), n(t.unique_viewers)],
      ['Going', n(t.going), n(t.unique_viewers)],
    ];
    if (ev.ticket_url) steps.push(['Clicked tickets', n(t.ticket_clicks), n(t.going)]);
    var funnel =
      '<table><tr><th>Step</th><th class="r">People</th><th class="r">Of previous</th></tr>' +
      steps
        .map(function (s) {
          return '<tr><td>' + s[0] + '</td><td class="r">' + fmtN(s[1]) + '</td><td class="r">' + (s[2] ? pct(s[1], s[2]) + '%' : '<span class="muted">—</span>') + '</td></tr>';
        })
        .join('') +
      '</table>';

    // Sources with the Discover filter folded in.
    var total = 0;
    var rows = [];
    var viaMap = {};
    (a.sources || []).forEach(function (s) {
      total += n(s.n);
      if (s.source === 'app' || s.source === 'friend') {
        var k = s.source === 'friend' ? 'friend' : 'via:' + (s.via || 'browse');
        viaMap[k] = (viaMap[k] || 0) + n(s.n);
      } else viaMap[s.source] = (viaMap[s.source] || 0) + n(s.n);
    });
    Object.keys(viaMap)
      .sort(function (x, y) {
        return viaMap[y] - viaMap[x];
      })
      .forEach(function (k) {
        var label = k.indexOf('via:') === 0 ? 'Discover · ' + VIA_LABELS[k.slice(4)] : SOURCE_LABELS[k] || k;
        var cls = k.indexOf('via:') === 0 ? '' : k === 'share' || k === 'friend' ? 'o' : k === 'web' ? 'b' : 'g';
        rows.push({ label: label, v: viaMap[k], cls: cls });
      });
    var sources = total ? hbars(rows, total) : '<p class="muted small">Nothing yet.</p>';

    var sharers = a.sharers.length
      ? '<table><tr><th>Shared by</th><th class="r">Shares</th><th class="r">Views</th><th class="r">Going</th></tr>' +
        a.sharers
          .map(function (s, i) {
            return '<tr><td>' + av(s.name, i) + esc(s.name) + '</td><td class="r">' + fmtN(s.taps) + '</td><td class="r">' + fmtN(s.views) + '</td><td class="r">' + fmtN(s.going) + '</td></tr>';
          })
          .join('') +
        '</table>'
      : '<p class="muted small">No one has shared it from the app yet. Ask the people going to pass it on.</p>';

    var cm = a.changed_mind || [];
    var cmTotal = cm.reduce(function (s, r) {
      return s + n(r.n);
    }, 0);
    var cmHtml;
    if (!cmTotal) cmHtml = '<p class="muted small">Nobody has taken back a “going” yet.</p>';
    else {
      var keys = dayKeys(30, tz);
      var map = {};
      cm.forEach(function (r) {
        map[r.day] = n(r.n);
      });
      cmHtml =
        bars(
          keys.map(function (k) {
            return { v: map[k] || 0, cls: 'bad', tip: dayLabel(k, true) + ': ' + plural(map[k] || 0, 'person', 'people') };
          }),
          'tiny',
        ) +
        axis([dayLabel(keys[0]), 'Today']) +
        '<div class="small" style="margin-top: 8px"><b>' +
        plural(cmTotal, 'person', 'people') +
        '</b> said going and then took it back' +
        (clusterChangedMind(cm) ? ', most around ' + dayLabel(clusterChangedMind(cm).day) + '. Did something change then?' : '.') +
        '</div>';
    }

    html += '<div class="grid g2">';
    html += card('From seen to going', 'Each step as a share of the one before', funnel);
    html += card('Where from', 'Views by source and Discover filter', sources);
    html += '</div><div class="grid g2">';
    html += card('Who shared it', 'Views and going each share brought', sharers);
    html += card('Changed their mind', 'Going, then removed it · last 30 days', cmHtml);
    html += '</div>';
    return html;
  }

  function tabTiming(a, tz) {
    var heat = a.heat || [];
    var max = 0;
    var grid = {};
    heat.forEach(function (h) {
      grid[h.dow + ':' + h.hour] = n(h.n);
      if (n(h.n) > max) max = n(h.n);
    });
    var heatHtml = '';
    if (!max) heatHtml = '<p class="muted small">Not enough views in the last 30 days to see a pattern.</p>';
    else {
      heatHtml = '<div class="heat">';
      for (var d = 0; d < 7; d++) {
        heatHtml += '<span>' + DOW[d] + '</span>';
        for (var h = 0; h < 24; h++) {
          var v = grid[d + ':' + h] || 0;
          heatHtml += '<i style="opacity: ' + (0.08 + (v / max) * 0.92).toFixed(2) + '" title="' + DOW[d] + ' ' + hourText(h) + ': ' + plural(v, 'view') + '"></i>';
        }
      }
      heatHtml +=
        '</div><div class="heat" style="margin-top: 4px"><span></span><span style="grid-column: span 6">00</span><span style="grid-column: span 6">06</span><span style="grid-column: span 6">12</span><span style="grid-column: span 5">18</span><span>23</span></div>';
      var busy = busiestSlot(heat);
      if (busy) heatHtml += '<div class="small" style="margin-top: 10px">Busiest <b>' + busy + '</b>. That’s when to publish and to send reminders.</div>';
    }
    var prev = a.buildup && a.buildup.previous;
    var ahead = aheadOfPrevious(a.buildup);
    var buildHtml =
      curve(a.buildup, 120) +
      '<div class="small" style="margin-top: 8px">' +
      (prev
        ? (ahead !== null ? (ahead >= 0 ? '<span class="tag ok">▲ ' + ahead + ' ahead of ' + esc(prev.title) + ' at this point</span>' : '<span class="tag bad">▼ ' + Math.abs(ahead) + ' behind ' + esc(prev.title) + ' at this point</span>') : '') +
          ' <span class="muted">' + esc(prev.title) + ' finished on ' + plural(prev.final, 'going', 'going') + '.</span>'
        : '<span class="muted">Your next event will show against this one.</span>') +
      (a.hours_to_decide != null
        ? '<div style="margin-top: 6px">People take <b>' + hoursText(a.hours_to_decide) + '</b> from first look to saying going, on average.</div>'
        : '') +
      '</div>';
    return (
      '<div class="grid g21">' +
      card('When people look', 'Views by hour and weekday · last 30 days · ' + esc(tz.replace('_', ' ')), heatHtml) +
      card('How going builds up', prev ? 'Against your ' + esc(prev.title) : 'Day by day up to the event', buildHtml) +
      '</div>'
    );
  }
  function hoursText(h) {
    h = n(h);
    if (h < 1) return 'under an hour';
    if (h < 48) return Math.round(h) + ' hours';
    return (h / 24).toFixed(1).replace(/\.0$/, '') + ' days';
  }

  // Cumulative going against days before the event, with the previous
  // event's curve dashed behind it.
  function curve(buildup, height) {
    var pts = (buildup && buildup.points) || [];
    var prev = (buildup && buildup.previous && buildup.previous.points) || [];
    if (!pts.length) return '<p class="muted small">Nothing yet.</p>';
    var maxDays = 0;
    var maxGoing = 1;
    pts.concat(prev).forEach(function (p) {
      if (n(p.days_before) > maxDays) maxDays = n(p.days_before);
      if (n(p.going) > maxGoing) maxGoing = n(p.going);
    });
    var W = 300;
    var H = 100;
    function xy(p) {
      var x = 10 + ((maxDays - n(p.days_before)) / Math.max(1, maxDays)) * (W - 20);
      var y = H - 10 - (n(p.going) / maxGoing) * (H - 25);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }
    var last = pts[pts.length - 1];
    var lastXY = xy(last).split(',');
    return (
      '<svg class="curve" viewBox="0 0 ' + W + ' ' + H + '" style="height: ' + (height || 120) + 'px" role="img" aria-label="Going over time">' +
      (prev.length ? '<polyline fill="none" stroke="var(--border)" stroke-width="2" stroke-dasharray="4 3" points="' + prev.map(xy).join(' ') + '"/>' : '') +
      '<polyline fill="none" stroke="var(--accent)" stroke-width="3" points="' + pts.map(xy).join(' ') + '"/>' +
      '<circle cx="' + lastXY[0] + '" cy="' + lastXY[1] + '" r="4" fill="var(--accent)"/>' +
      '<text x="' + Math.min(W - 60, parseFloat(lastXY[0]) + 6) + '" y="' + Math.max(10, parseFloat(lastXY[1]) - 6) + '" font-size="10" fill="var(--accent)" font-weight="700">' + fmtN(last.going) + ' going</text>' +
      '</svg>' +
      axis(['−' + maxDays + ' days', '−' + Math.round(maxDays / 2), 'event'])
    );
  }

  function tabPeople(a, tz) {
    var t = a.totals;
    var bands = ['<1', '1-3', '3-10', '10+'];
    var bandLabel = { '<1': 'Under 1 mile', '1-3': '1–3 miles', '3-10': '3–10 miles', '10+': 'Further' };
    function bandRows(obj) {
      var total = bands.reduce(function (s, k) {
        return s + n(obj[k]);
      }, 0);
      if (!total) return '<p class="muted small">Not known yet: distance comes from where people search in Discover.</p>';
      return hbars(
        bands.map(function (k) {
          return { label: bandLabel[k], v: n(obj[k]), text: fmtN(obj[k]) };
        }),
        total,
      );
    }
    var distance =
      '<div class="label" style="margin-bottom: 6px">Going</div>' +
      bandRows(a.distance.going || {}) +
      '<div class="label" style="margin: 12px 0 6px">Everyone who looked</div>' +
      bandRows(a.distance.viewers || {});

    var au = a.audience;
    var returning =
      '<div><span class="stat"><span class="v">' + fmtN(n(t.going) - n(au.returning)) + '</span><span class="l">new to you</span></span><span class="stat"><span class="v">' + fmtN(au.returning) + '</span><span class="l">came before</span></span>' +
      (n(t.going) && n(au.returning) ? '<span class="tag ok">' + pct(au.returning, t.going) + '% return</span>' : '') +
      '</div>' +
      (au.before && au.before.length
        ? '<div class="small" style="margin-top: 10px">' +
          au.before
            .map(function (b) {
              return fmtN(b.n) + ' also went to <b>' + esc(b.title) + '</b>';
            })
            .join(', ') +
          '.</div>'
        : '') +
      '<div class="small" style="margin-top: 8px"><b>Brought by friends:</b> ' + plural(au.brought_by_friends, 'person', 'people') + ' said going after a friend shared it or was going.</div>';

    var list = a.going_list || [];
    var table = list.length
      ? '<table><tr><th>Name</th><th>Said yes</th><th class="hide-p">Found it via</th><th>Calendar</th>' +
        (a.event.ticket_url ? '<th class="hide-p">Tickets</th>' : '') +
        '<th class="hide-p">Been before</th></tr>' +
        list
          .map(function (g, i) {
            var via = g.source === 'share' ? 'Shared link' : g.source === 'friend' ? 'A friend' : g.source === 'web' ? 'Public page' : g.source === 'notification' ? 'Reminder' : g.via ? 'Discover, ' + VIA_LABELS[g.via] : g.source ? 'Discover' : '—';
            return (
              '<tr><td>' + av(g.name, i) + esc(g.name) + '</td><td>' + dayLabel(g.said_yes, true) + '</td><td class="hide-p">' + via + '</td><td>' + (g.on_calendar ? '✓' : '—') + '</td>' +
              (a.event.ticket_url ? '<td class="hide-p">' + (g.ticket ? '✓' : '—') + '</td>' : '') +
              '<td class="hide-p">' + (g.before ? esc(g.before) : '—') + '</td></tr>'
            );
          })
          .join('') +
        '</table>'
      : '<p class="muted small">No one has said they’re going yet.</p>';

    return (
      '<div class="grid g2">' +
      card('How far they come from', 'By where people searched, as bands', distance) +
      card('New or returning', 'Compared with your past events', returning) +
      '</div>' +
      card('Who’s going', plural(list.length, 'person', 'people') + ' · first names, because they chose to say so', table)
    );
  }

  function tabTickets(a, tz) {
    var t = a.totals;
    var tk = a.tickets;
    var b = a.benchmarks || {};
    var ev = a.event;
    var html = '';
    if (!ev.ticket_url) {
      html += card(
        'Tickets',
        null,
        '<p class="small">This event has no ticket link, so there’s nothing to count here. ' +
          (a.priced ? 'It has a price, so add the link where people buy.' : 'For a free event you can still add a booking link.') +
          '</p><a class="btn small" href="#/events/' + esc(ev.id) + '">Edit event</a>',
      );
    } else {
      var rate = n(t.going) ? pct(tk.app + tk.web, t.going) : null;
      var bench = b.ticket_rate ? Math.round(n(b.ticket_rate) * 100) : null;
      html += card(
        'Ticket clicks',
        'Taps on your ticket link',
        '<div><span class="stat"><span class="v">' + fmtN(n(tk.app) + n(tk.web)) + '</span><span class="l">clicks</span></span>' +
          (rate !== null ? '<span class="stat"><span class="v">' + rate + '%</span><span class="l">of going</span></span>' : '') +
          (bench !== null && rate !== null ? '<span class="tag ' + (rate >= bench ? 'ok' : 'warn') + '">' + ctx.categoryLabel(ev.category).toLowerCase() + ' average ' + bench + '%</span>' : '') +
          '</div>' +
          '<table style="margin-top: 10px"><tr><th>From</th><th class="r">Views</th><th class="r">Clicks</th><th class="r">Rate</th></tr>' +
          '<tr><td>App</td><td class="r">' + fmtN(tk.app_views) + '</td><td class="r">' + fmtN(tk.app) + '</td><td class="r">' + pctText(tk.app, tk.app_views) + '</td></tr>' +
          '<tr><td>Public page</td><td class="r">' + fmtN(tk.web_views) + '</td><td class="r">' + fmtN(tk.web) + '</td><td class="r">' + pctText(tk.web, tk.web_views) + '</td></tr></table>' +
          '<p class="muted small" style="margin: 10px 0 0">Clicks open your ticket page; sales happen there, so we can’t count them.</p>',
      );
    }
    var rem = a.reminders || [];
    var r = a.remind || {};
    var upcoming = ev.status === 'published' && new Date(ev.starts_at).getTime() > Date.now();
    var remindBody =
      (rem.length
        ? '<table><tr><th>Sent</th><th class="r">To</th><th class="r">Then going</th><th class="r hide-p">Then tickets</th></tr>' +
          rem
            .map(function (x) {
              return '<tr><td>' + dayLabel(x.sent_at, true) + '</td><td class="r">' + fmtN(x.recipients) + '</td><td class="r"><span class="tag ok">+' + fmtN(x.going_after) + '</span></td><td class="r hide-p">+' + fmtN(x.tickets_after) + '</td></tr>';
            })
            .join('') +
          '</table>'
        : '<p class="small">A reminder is one push notification to everyone who said interested but not going. It asks whether they’re coming.</p>') +
      '<div class="actions">' +
      (upcoming
        ? r.ok
          ? '<button type="button" class="btn primary" data-act="remind">Send a reminder to ' + plural(r.targets, 'person', 'people') + '</button>'
          : '<span class="muted small">' +
            (n(r.targets) === 0 ? 'Nobody to remind right now: everyone interested has had one this week, or there is no one interested.' : 'One reminder a day per event. The next can go tomorrow.') +
            '</span>'
        : '<span class="muted small">Reminders go for published events that are still to come.</span>') +
      '</div><p class="muted small" style="margin: 10px 0 0">One per person per week, one per event per day.</p>';
    html += card('Reminders', 'What each nudge did', remindBody);
    return html;
  }

  function tabAll(o) {
    var events = o.events || [];
    var now = Date.now();
    var bench = o.benchmarks || {};
    var cats = Object.keys(bench).filter(function (c) {
      return bench[c] && bench[c].going_rate;
    });
    var benchLine = cats.length
      ? cats
          .map(function (c) {
            return ctx.categoryLabel(c) + ' events on Dayli convert ' + Math.round(n(bench[c].going_rate) * 100) + '% of views to going';
          })
          .join(' · ')
      : 'Benchmarks appear once enough events of a kind have run on Dayli.';
    var rows = events
      .slice()
      .sort(function (a, b) {
        return new Date(b.starts_at) - new Date(a.starts_at);
      })
      .map(function (e) {
        var past = new Date(e.ends_at).getTime() < now;
        var rate = n(e.views) ? pct(e.going, e.views) : null;
        var bc = bench[e.category] && bench[e.category].going_rate ? Math.round(n(bench[e.category].going_rate) * 100) : null;
        var status = e.status === 'cancelled' ? '<span class="tag bad">Cancelled</span>' : e.status === 'draft' ? '<span class="tag plain">Draft</span>' : past ? '<a href="#/events/new?from=' + esc(e.id) + '" class="small" style="font-weight: 700; text-decoration: none">Run it again ›</a>' : '<span class="tag info">Upcoming</span>';
        return (
          '<tr><td><a href="#/analytics/' + esc(e.id) + '" style="font-weight: 700; text-decoration: none; color: var(--ink)">' + esc(e.title) + '</a></td><td class="hide-p">' + dayLabel(e.starts_at, true) + '</td>' +
          '<td class="r hide-p">' + fmtN(e.seen) + '</td><td class="r">' + fmtN(e.views) + '</td><td class="r">' + fmtN(e.going) + '</td>' +
          '<td class="r">' + (rate === null ? '<span class="muted">—</span>' : bc !== null ? '<span class="tag ' + (rate >= bc ? 'ok' : 'warn') + '">' + rate + '%</span>' : rate + '%') + '</td>' +
          '<td class="r hide-p">' + (e.ticket_url ? fmtN(e.ticket_clicks) : '<span class="muted">—</span>') + '</td>' +
          '<td class="r hide-p">' + (n(e.going) ? pct(e.returning, e.going) + '%' : '<span class="muted">—</span>') + '</td>' +
          '<td class="r">' + status + '</td></tr>'
        );
      })
      .join('');
    var t = o.totals || {};
    var alerts = state.organiser && state.organiser.alerts !== false;
    return (
      '<div class="grid g5">' +
      kpi('Events', fmtN(t.events)) +
      kpi('Views', fmtN(t.views), tagDelta(t.views_7d, t.views_prev_7d)) +
      kpi('Going', fmtN(t.going)) +
      kpi('Ticket clicks', fmtN(t.ticket_clicks)) +
      kpi('View → going', n(t.views) ? pct(t.going, t.views) + '%' : '—') +
      '</div>' +
      card(
        'Side by side',
        benchLine,
        '<table><tr><th>Event</th><th class="hide-p">Date</th><th class="r hide-p">Seen</th><th class="r">Views</th><th class="r">Going</th><th class="r">View → going</th><th class="r hide-p">Tickets</th><th class="r hide-p">Returning</th><th></th></tr>' +
          rows +
          '</table>',
      ) +
      card(
        'Alerts',
        'Pushes to your phone, through the Dayli app',
        '<label class="switch"><input type="checkbox" id="alerts"' +
          (alerts ? ' checked' : '') +
          ' /> Tell me when an event reaches 10, 25, 50, 100 going, and send a summary the day after each event.</label>',
      )
    );
  }

  return {
    screenOverview: screenOverview,
    screenAnalytics: screenAnalytics,
    loadOverview: loadOverview,
    focusEvent: focusEvent,
    spark: spark,
    // The chart and card helpers, shared with admin.js.
    ui: { kpi: kpi, card: card, bars: bars, hbars: hbars, axis: axis, spark: spark, fmtN: fmtN, n: n, pct: pct, pctText: pctText, tagDelta: tagDelta },
  };
};
