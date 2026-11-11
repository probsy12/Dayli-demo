/* Dayli for organisers: the Tickets tab of an event's analytics, for events
 * that sell tickets through Dayli. Plain browser JavaScript, no build.
 * Numbers from organiser_ticket_analytics() in
 * supabase/migrations/20261101000200_tickets_more.sql. Counts and bands
 * only: any breakdown of fewer than 5 buyers is hidden so nobody can be
 * picked out. Built by analytics.js, which passes its chart helpers. */
window.DayliTicketStats = function (ctx, ui) {
  'use strict';
  var esc = ctx.esc;
  var $ = ctx.$;
  var rpc = ctx.rpc;
  var kpi = ui.kpi;
  var card = ui.card;
  var bars = ui.bars;
  var hbars = ui.hbars;
  var axis = ui.axis;
  var fmtN = ui.fmtN;
  var n = ui.n;
  var pct = ui.pct;
  var dayLabel = ui.dayLabel;
  var plural = ui.plural;
  var MIN = 5;

  var SOURCE = {
    share: 'A friend shared it',
    link: 'Your own link',
    web: 'Your public web page',
    search: 'Search in Dayli',
    browse: 'Discover',
    category: 'Discover: by type',
    free: 'Discover: free events',
    today: 'Discover: today',
    weekend: 'Discover: this weekend',
    week: 'Discover: this week',
    month: 'Discover: this month',
    going: 'Their Going list',
    hosting: 'Hosting',
    other: 'Somewhere else',
  };
  var BANDS = [
    ['<1', 'Under 1 km'],
    ['1-3', '1 – 3 km'],
    ['3-10', '3 – 10 km'],
    ['10+', 'Over 10 km'],
  ];

  function money(pence) {
    var p = n(pence);
    return '£' + (p % 100 === 0 && Math.abs(p) >= 10000 ? fmtN(p / 100) : (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  function dayKey(date, tz) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    } catch (e) {
      return date.toISOString().slice(0, 10);
    }
  }
  function timeIn(iso, tz) {
    try {
      return new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', timeZone: tz, hour12: true }).replace(' ', '').toLowerCase();
    } catch (e) {
      return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
  }
  function daysBetween(a, b) {
    return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
  }
  function sum(obj) {
    return Object.keys(obj || {}).reduce(function (s, k) {
      return s + n(obj[k]);
    }, 0);
  }
  function tooFew(what) {
    return '<p class="muted small">Shown once ' + MIN + ' or more people have bought' + (what ? ' ' + what : '') + ', so nobody can be picked out.</p>';
  }
  function table(head, rows) {
    return (
      '<div class="scroll-x"><table><tr>' +
      head
        .map(function (h, i) {
          return '<th' + (i ? ' class="r"' : '') + '>' + h + '</th>';
        })
        .join('') +
      '</tr>' +
      rows
        .map(function (r) {
          return (
            '<tr>' +
            r
              .map(function (c, i) {
                return '<td' + (i ? ' class="r"' : '') + '>' + c + '</td>';
              })
              .join('') +
            '</tr>'
          );
        })
        .join('') +
      '</table></div>'
    );
  }

  // --- the parts ---------------------------------------------------------------------

  function forecast(d, tz) {
    var cap = n(d.event.capacity);
    var sold = n(d.totals.tickets);
    if (d.event.sold_out_at) return { label: 'Sold out', tag: '<span class="tag ok">' + esc(dayLabel(dayKey(new Date(d.event.sold_out_at), tz))) + '</span>' };
    if (!cap) return null;
    var left = Math.max(0, cap - sold);
    var since = Date.now() - 7 * 86400000;
    var week = (d.daily || []).reduce(function (s, x) {
      return new Date(x.day + 'T12:00:00').getTime() >= since ? s + n(x.tickets) : s;
    }, 0);
    var starts = new Date(d.event.starts_at).getTime();
    if (starts < Date.now()) return null;
    if (!week) return { label: '—', tag: '<span class="tag plain">no sales this week</span>' };
    var days = Math.ceil(left / (week / 7));
    var when = Date.now() + days * 86400000;
    if (when >= starts) return { label: 'Not before the night', tag: '<span class="tag warn">' + plural(left, 'place') + ' to sell</span>', text: 'At this week’s pace it won’t sell out before the night: ' + plural(left, 'place') + ' left.' };
    var early = Math.floor((starts - when) / 86400000);
    var date = dayLabel(dayKey(new Date(when), tz));
    return {
      label: esc(date),
      tag: '<span class="tag ' + (early >= 3 ? 'ok' : 'warn') + '">' + (early >= 1 ? plural(early, 'day') + ' before' : 'the day itself') + '</span>',
      text: 'At this week’s pace you’ll sell out around <b>' + esc(date) + '</b>' + (early >= 1 ? ', ' + plural(early, 'day') + ' before the night.' : ', on the day.'),
    };
  }

  function inShort(d, f, tz) {
    var out = [];
    var t = d.totals;
    var cap = n(d.event.capacity);
    out.push(fmtN(t.tickets) + (cap ? ' of ' + fmtN(cap) : '') + ' sold' + (n(t.orders) ? ' in ' + plural(t.orders, 'order') : '') + '.');
    if (f && f.text) out.push(f.text);
    (d.types || []).forEach(function (ty) {
      var follows = (d.types || []).some(function (x) {
        return x.after_type === ty.id;
      });
      if (follows && ty.sold_out_at && ty.first_sale) {
        var dd = daysBetween(ty.first_sale, ty.sold_out_at);
        out.push(esc(ty.name) + ' sold out in ' + plural(dd, 'day') + (dd <= 3 ? ', so next time you could offer more or charge a little more.' : '.'));
      }
    });
    var orders = sum(d.sources);
    if (orders >= MIN && n(d.sources.share)) out.push('Shares from people going brought ' + pct(d.sources.share, orders) + '% of orders.');
    if (n(d.going_no_ticket)) out.push(plural(d.going_no_ticket, 'person', 'people') + ' said going but have no ticket yet.');
    return '<div class="card inshort"><b>In short:</b> ' + out.join(' ') + '</div>';
  }

  function salesChart(d, tz) {
    var daily = {};
    (d.daily || []).forEach(function (x) {
      daily[x.day] = n(daily[x.day]) + n(x.tickets);
    });
    var keys = Object.keys(daily).sort();
    if (!keys.length) return '<p class="muted small">No tickets sold yet.</p>';
    var end = new Date(Math.min(Date.now(), new Date(d.event.ends_at).getTime()));
    var reminders = {};
    (d.reminder_days || []).forEach(function (x) {
      reminders[x] = true;
    });
    var out = [];
    var cur = new Date(keys[0] + 'T12:00:00');
    var stop = dayKey(end, tz);
    for (var i = 0; i < 120; i++) {
      var k = dayKey(cur, tz);
      out.push({ v: n(daily[k]), cls: reminders[k] ? 'o' : '', tip: dayLabel(k, true) + ': ' + plural(n(daily[k]), 'ticket') + (reminders[k] ? ' · reminder sent' : '') });
      if (k >= stop) break;
      cur = new Date(cur.getTime() + 86400000);
    }
    var first = out.length ? dayLabel(keys[0]) : '';
    return (
      bars(out) +
      axis([first, out.length > 2 ? dayLabel(dayKey(new Date(new Date(keys[0] + 'T12:00:00').getTime() + Math.floor(out.length / 2) * 86400000), tz)) : '', dayLabel(stop)]) +
      (Object.keys(reminders).length ? '<p class="muted small" style="margin-top: 6px">Orange: a reminder went out that day.</p>' : '')
    );
  }

  function byTicket(d) {
    var types = (d.types || []).filter(function (ty) {
      return !ty.hidden || n(ty.sold);
    });
    var still = 0;
    var rows = types.map(function (ty) {
      var follows = types.some(function (x) {
        return x.after_type === ty.id;
      });
      var tag = ty.sold_out_at
        ? ' <span class="tag plain">sold out' + (ty.first_sale ? ' in ' + plural(daysBetween(ty.first_sale, ty.sold_out_at), 'day') : '') + '</span>'
        : ty.after_type && !ty.open
          ? ' <span class="tag plain">opens next</span>'
          : '';
      if (ty.quantity && !ty.pay_what_you_like) still += Math.max(0, n(ty.quantity) - n(ty.sold)) * n(ty.price_pence);
      return [
        esc(ty.name) + ' · ' + (ty.pay_what_you_like ? 'pay what you like' : n(ty.price_pence) ? money(ty.price_pence) : 'free') + (ty.with_code ? ' <span class="tag plain">code</span>' : '') + (follows ? '' : ''),
        fmtN(ty.sold) + (ty.quantity ? ' / ' + fmtN(ty.quantity) : '') + tag,
        money(ty.takings_pence),
      ];
    });
    var t = d.totals;
    if (n(t.refunded_orders)) rows.push(['Refunded', plural(t.refunded_orders, 'order'), '−' + money(t.refunded_pence)]);
    return (
      table(['Ticket', 'Sold', 'Takings'], rows) +
      (still ? '<div class="hrow" style="margin-top: 8px"><span>Still to sell if every place goes</span><b>' + money(still) + ' more</b></div>' : '') +
      (n(t.absorbed_fees_pence) ? '<div class="hrow"><span>Booking fees you paid</span><b>' + money(t.absorbed_fees_pence) + '</b></div>' : '')
    );
  }

  function funnel(d) {
    var f = d.funnel || {};
    var steps = [
      ['Saw it in Discover', n(f.seen)],
      ['Opened the event', n(f.opened)],
      ['Started choosing tickets', n(f.chose)],
      ['Went to pay', n(f.checkout)],
      ['Bought', n(f.paid)],
    ];
    var worst = null;
    var rows = steps.map(function (s, i) {
      var prev = i ? steps[i - 1][1] : 0;
      var rate = i && prev ? pct(s[1], prev) : null;
      if (i >= 2 && prev >= 10 && rate !== null && rate < 85 && (!worst || rate < worst.rate)) worst = { rate: rate, from: steps[i - 1][0], to: s[0] };
      return [s[0], fmtN(s[1]), rate === null ? '<span class="muted">—</span>' : rate + '%'];
    });
    var note = '';
    if (worst) {
      note =
        '<p class="small" style="margin-top: 10px"><b>The biggest drop is from “' +
        esc(worst.from.toLowerCase()) +
        '” to “' +
        esc(worst.to.toLowerCase()) +
        '”</b>: ' +
        (100 - worst.rate) +
        '% stop there. ' +
        (worst.to === 'Went to pay'
          ? 'Fewer ticket types or a cheaper option often helps.'
          : worst.to === 'Bought'
            ? 'Some will be checking the price with friends; a reminder can bring them back.'
            : 'Ticket prices aren’t on the event card until people open it.') +
        '</p>';
    }
    return table(['Step', 'People', 'Of the step before'], rows) + note;
  }

  function goingNoTicket(d) {
    var upcoming = d.event.status === 'published' && new Date(d.event.starts_at).getTime() > Date.now();
    var count = n(d.going_no_ticket);
    var can = upcoming && d.remind_ok && n(d.remind_targets) > 0;
    return (
      '<div class="kpi" style="padding: 0"><div class="num">' +
      plural(count, 'person', 'people') +
      '</div></div><p class="small muted">' +
      (count
        ? 'They tapped Going in Dayli but haven’t bought. A reminder is one push notification asking them to get a ticket.'
        : 'Everyone who said going has a ticket.') +
      '</p>' +
      (count
        ? '<div class="actions">' +
          (can
            ? '<button type="button" class="btn primary small" id="tk-remind">Send a reminder to ' + plural(d.remind_targets, 'person', 'people') + '</button>'
            : '<span class="muted small">' +
              (!upcoming ? 'Reminders go for published events that are still to come.' : !d.remind_ok ? 'One reminder a day per event. The next can go tomorrow.' : 'Everyone here has had a reminder this week.') +
              '</span>') +
          '</div>'
        : '')
    );
  }

  function sources(d) {
    var s = d.sources || {};
    var total = sum(s);
    if (total < MIN) return tooFew();
    var rows = Object.keys(s)
      .sort(function (a, b) {
        return n(s[b]) - n(s[a]);
      })
      .map(function (k) {
        return { label: SOURCE[k] || k, v: n(s[k]) };
      });
    return hbars(rows, total);
  }

  function sharers(d) {
    var list = d.sharers || [];
    if (!list.length) return '<p class="muted small">No tickets have come from shares yet. People going can share the event from the app.</p>';
    var top = list.slice(0, 5);
    var rest = list.slice(5);
    var rows = top.map(function (x) {
      return [esc(x.name || 'Someone'), fmtN(x.tickets)];
    });
    if (rest.length)
      rows.push([
        plural(rest.length, 'other'),
        fmtN(
          rest.reduce(function (s2, x) {
            return s2 + n(x.tickets);
          }, 0),
        ),
      ]);
    return table(['Shared by', 'Tickets'], rows);
  }

  function distance(d) {
    var dist = d.distance || {};
    var total = sum(dist);
    if (total < MIN) return tooFew('from the app');
    return hbars(
      BANDS.map(function (b) {
        return { label: b[1], v: n(dist[b[0]]) };
      }),
      total,
    );
  }

  function buyers(d) {
    var b = d.buyers || {};
    var total = n(b.new) + n(b.returning);
    if (total < MIN) return tooFew();
    return hbars(
      [
        { label: 'New to you', v: n(b.new) },
        { label: 'Bought from you before', v: n(b.returning), cls: 'g' },
      ],
      total,
    );
  }

  function groups(d) {
    var g = d.group_sizes || {};
    var total = sum(g);
    if (total < MIN) return tooFew();
    return hbars(
      [
        { label: 'Just them', v: n(g['1']) },
        { label: 'Pairs', v: n(g['2']) },
        { label: '3 or 4', v: n(g['3-4']) },
        { label: '5 or more', v: n(g['5+']) },
      ],
      total,
    );
  }

  function hours(d) {
    var h = d.hours || [];
    var total = h.reduce(function (s, x) {
      return s + n(x);
    }, 0);
    if (total < MIN) return tooFew();
    // The busiest three-hour stretch.
    var best = 0;
    var at = 0;
    for (var i = 0; i < 24; i++) {
      var w = n(h[i]) + n(h[(i + 1) % 24]) + n(h[(i + 2) % 24]);
      if (w > best) {
        best = w;
        at = i;
      }
    }
    var label = function (x) {
      x = x % 24;
      return x === 0 ? '12am' : x < 12 ? x + 'am' : x === 12 ? '12pm' : x - 12 + 'pm';
    };
    return (
      bars(
        h.map(function (v, i) {
          return { v: n(v), tip: label(i) + ': ' + plural(n(v), 'order') };
        }),
        'short',
      ) +
      axis(['12am', '6am', '12pm', '6pm']) +
      '<p class="small muted" style="margin-top: 8px">Most buy between ' + label(at) + ' and ' + label(at + 3) + '. Post then.</p>'
    );
  }

  function night(d, tz) {
    var nt = d.night || {};
    var arrivals = nt.arrivals || [];
    var scans = nt.scans || {};
    var t = d.totals;
    var over = new Date(d.event.ends_at).getTime() < Date.now();
    if (!arrivals.length && !over) return '';
    var away = n(scans.used) + n(scans.refunded) + n(scans.wrong_event) + n(scans.not_found);
    var peak = arrivals.reduce(function (b, x) {
      return !b || n(x.n) > n(b.n) ? x : b;
    }, null);
    var sold = n(t.tickets);
    var came = n(t.checked_in);
    var html =
      '<div class="sec">On the night</div><div class="grid g4">' +
      kpi('Checked in', fmtN(came) + ' <span class="muted" style="font-size: 18px">of ' + fmtN(sold) + '</span>', sold ? '<span class="tag ok">' + pct(came, sold) + '% came</span>' : '') +
      (nt.no_shows !== null && nt.no_shows !== undefined
        ? kpi('No-shows', fmtN(nt.no_shows), '<span class="tag plain">' + pct(nt.no_shows, sold) + '% of tickets</span>')
        : kpi('Still to arrive', fmtN(Math.max(0, sold - came)), '')) +
      kpi('Busiest 15 minutes', peak ? esc(timeIn(peak.at, tz)) : '—', peak ? '<span class="tag plain">' + plural(peak.n, 'arrival') + '</span>' : '') +
      kpi('Turned away at the door', fmtN(away), '') +
      '</div>';
    var slots = [];
    if (arrivals.length) {
      var map = {};
      arrivals.forEach(function (x) {
        map[new Date(x.at).getTime()] = n(x.n);
      });
      var start = new Date(arrivals[0].at).getTime();
      var end = new Date(arrivals[arrivals.length - 1].at).getTime();
      for (var s = start; s <= end && slots.length < 64; s += 900000) slots.push({ v: n(map[s]), cls: peak && s === new Date(peak.at).getTime() ? 'o' : '', tip: timeIn(new Date(s).toISOString(), tz) + ': ' + plural(n(map[s]), 'arrival') });
    }
    html +=
      '<div class="grid g21">' +
      card(
        'Arrivals',
        'People checked in, every 15 minutes.',
        slots.length
          ? bars(slots) + axis([timeIn(arrivals[0].at, tz), timeIn(arrivals[arrivals.length - 1].at, tz)])
          : '<p class="muted small">Nobody was checked in with Dayli.</p>',
      ) +
      card(
        'Turned away',
        'Scans that didn’t let someone in.',
        away
          ? table(
              ['Why', 'Scans'],
              [
                ['Already checked in', fmtN(scans.used)],
                ['Refunded', fmtN(scans.refunded)],
                ['For another event', fmtN(scans.wrong_event)],
                ['Not a Dayli ticket', fmtN(scans.not_found)],
              ].filter(function (r) {
                return r[1] !== '0';
              }),
            ) + (n(scans.used) ? '<p class="small muted" style="margin-top: 8px">A ticket scanned twice often means a screenshot was shared.</p>' : '')
          : '<p class="muted small">Nobody was turned away.</p>',
      ) +
      '</div>';
    return html;
  }

  function afterwards(d) {
    var cb = d.came_back;
    if (!cb || n(cb.buyers) < MIN) return '';
    return card(
      'Came back',
      'Buyers who have since bought for another of your events.',
      '<div class="kpi" style="padding: 0"><div class="num">' + pct(cb.again, cb.buyers) + '%</div></div><p class="small muted">' + plural(cb.again, 'person', 'people') + ' of ' + fmtN(cb.buyers) + '.</p>',
    );
  }

  function compare(d) {
    var list = d.compare || [];
    if (list.length < 2) return '';
    return card(
      'Compared with your other events',
      null,
      table(
        ['Event', 'Sold', 'Sold out in', 'Came', 'Takings'],
        list.map(function (c) {
          return [
            esc(c.title) + (c.id === d.event.id ? ' <span class="tag plain">this one</span>' : ''),
            fmtN(c.sold) + (c.capacity ? ' / ' + fmtN(c.capacity) : ''),
            c.sold_out_at && c.first_sale ? plural(daysBetween(c.first_sale, c.sold_out_at), 'day') : '—',
            c.over && n(c.sold) ? pct(c.came, c.sold) + '%' : '—',
            money(c.takings_pence),
          ];
        }),
      ),
    );
  }

  function askBox() {
    return (
      '<div class="card ai"><h3>Ask Dayli AI about your ticket sales</h3><p class="sub">It reads the numbers on this page, never names.</p>' +
      '<form id="tk-ask" class="row" style="gap: 8px; flex-wrap: nowrap"><input type="text" name="q" maxlength="300" placeholder="e.g. Should I add another release?" aria-label="Ask about your ticket sales" style="min-height: 40px" /><button class="btn small" type="submit">Ask</button></form>' +
      '<div id="tk-answer" class="small" style="margin-top: 10px" hidden></div></div>'
    );
  }

  // --- the tab -----------------------------------------------------------------------

  function renderStats(el, d) {
    var tz = d.event.timezone || 'Europe/London';
    var t = d.totals;
    var f = forecast(d, tz);
    var takings = n(t.gross_pence) - n(t.refunded_pence);
    var cap = n(d.event.capacity);
    var html =
      inShort(d, f, tz) +
      '<div class="sec">Money</div><div class="grid g4">' +
      kpi('Takings', money(takings), n(t.refunded_pence) ? '<span class="tag plain">after refunds</span>' : d.event.fee_absorbed ? '<span class="tag plain">before the booking fee</span>' : '') +
      kpi('Tickets sold', fmtN(t.tickets) + (cap ? ' <span class="muted" style="font-size: 18px">of ' + fmtN(cap) + '</span>' : ''), cap ? '<span class="tag plain">' + fmtN(Math.max(0, cap - n(t.tickets))) + ' left</span>' : '') +
      kpi('Average order', n(t.orders) ? money(Math.round(takings / n(t.orders))) : '—', n(t.orders) ? '<span class="tag plain">' + (n(t.tickets) / n(t.orders)).toFixed(1) + ' tickets</span>' : '') +
      kpi('Sell-out forecast', f ? f.label : '—', f ? f.tag : '<span class="tag plain">set a total to see it</span>') +
      '</div>' +
      '<div class="grid g21">' +
      card('Tickets sold each day', 'By the day they were paid for.', salesChart(d, tz)) +
      card('By ticket', null, byTicket(d)) +
      '</div>' +
      '<div class="sec">Getting people to pay</div><div class="grid g2">' +
      card('From seeing it to buying', 'Where people stop.', funnel(d)) +
      card('Going, but no ticket yet', null, goingNoTicket(d)) +
      '</div>' +
      '<div class="sec">Where buyers come from</div><div class="grid g3">' +
      card('How they found it', 'Share of orders, from what they last opened.', sources(d)) +
      card('Your best sharers', 'People going whose shares led to tickets. First names only.', sharers(d)) +
      card('How far they travel', 'Orders placed in the app.', distance(d)) +
      '</div>' +
      '<div class="sec">Who’s buying</div><div class="grid g3">' +
      card('New or returning', 'Compared with your other events.', buyers(d)) +
      card('Group size', 'Tickets in each order.', groups(d)) +
      card('When they buy', 'Orders by time of day.', hours(d)) +
      '</div>' +
      night(d, tz) +
      afterwards(d) +
      compare(d) +
      askBox() +
      '<p class="muted small" style="margin-top: 14px">Counts only. Any breakdown of fewer than ' + MIN + ' buyers is hidden. Buyer names appear only on your Orders list, for the door.</p>';
    el.innerHTML = html;
    bind(el, d);
  }

  function bind(el, d) {
    var r = $('#tk-remind');
    if (r)
      r.onclick = function () {
        if (!confirm('Send a reminder to everyone going without a ticket?\n\nThey get one push notification. Nobody gets more than one a week.')) return;
        ctx.setBusy(r, true, 'Sending…');
        rpc('public_event_send_ticket_reminder', { p_event_id: d.event.id }).then(
          function (x) {
            ctx.toast('Reminder sent to ' + plural((x && x.sent) || 0, 'person', 'people') + '.');
            mount(el, d.event.id);
          },
          function (err) {
            ctx.setBusy(r, false);
            alert(ctx.friendly(err));
          },
        );
      };
    var form = $('#tk-ask');
    if (form)
      form.onsubmit = function (e) {
        e.preventDefault();
        var q = form.q.value.trim();
        if (!q) return;
        var out = $('#tk-answer');
        var button = form.querySelector('button');
        ctx.setBusy(button, true, '…');
        out.hidden = false;
        out.innerHTML = '<span class="muted">Thinking…</span>';
        ui.askAi({ event_id: d.event.id, question: q }).then(
          function (x) {
            ctx.setBusy(button, false);
            out.innerHTML = '<b>' + esc(q) + '</b><div style="margin-top: 4px">' + esc(x.answer) + '</div>';
            form.q.value = '';
          },
          function (err) {
            ctx.setBusy(button, false);
            out.innerHTML = '<span class="muted">' + esc(ui.aiError(err)) + '</span>';
          },
        );
      };
  }

  /** Loads and shows the tab into el. Resolves with whether the event sells tickets through Dayli. */
  function mount(el, eventId) {
    return rpc('organiser_ticket_analytics', { p_event: eventId }).then(function (d) {
      if (!d || !d.sells) return false;
      renderStats(el, d);
      return true;
    });
  }

  return { mount: mount };
};
