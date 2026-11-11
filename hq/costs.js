/* Dayli admin: what Dayli costs to run. Plain browser JavaScript, no build.
 * The Costs tab of the admin pages (#/admin?tab=costs). Monthly bills typed
 * in here (a new price counts from the day it starts), AI use measured on
 * every call and priced per model, cost per person, any period by day, week
 * or month, an Excel download, and a live feed of AI calls.
 * Numbers from admin_costs_report() and admin_ai_feed() in
 * supabase/migrations/20261031000400_admin_costs.sql. */
window.DayliCosts = function (ctx, ui) {
  'use strict';
  var esc = ctx.esc;
  var $ = ctx.$;
  var rpc = ctx.rpc;
  var friendly = ctx.friendly;
  var kpi = ui.kpi;
  var card = ui.card;
  var hbars = ui.hbars;
  var axis = ui.axis;
  var fmtN = ui.fmtN;
  var n = ui.n;

  var PERIODS = [
    ['today', 'Today'],
    ['7d', '7 days'],
    ['month', 'This month'],
    ['last_month', 'Last month'],
    ['30d', '30 days'],
    ['90d', '90 days'],
    ['year', 'This year'],
    ['12m', '12 months'],
  ];
  var GROUPS = [
    ['day', 'Daily'],
    ['week', 'Weekly'],
    ['month', 'Monthly'],
  ];
  var FEATURE = {
    'smart-add': 'Smart add (typed or spoken)',
    photo: 'Smart add from a photo',
    scan: 'Screenshot / letter scan',
    'ask-dayli': 'Ask Dayli',
    suggestion: 'Home suggestion',
    'daily-brief': 'Morning & evening brief',
    'find-time': 'Find a time',
    'whatsapp-email': 'WhatsApp & email in',
    'admin-insights': 'Admin Dayli AI',
    'organiser-insights': 'Organiser Dayli AI',
    other: 'Other',
  };

  var KEY = 'dayli_admin_costs';
  var state = loadPrefs();
  var feedTimer = null;
  var root = null;

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { period: p.period || 'month', group: p.group || null };
    } catch (e) {
      return { period: 'month', group: null };
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ period: state.period, group: state.group }));
    } catch (e) {
      /* ignore */
    }
  }

  // --- dates (UK days, as the report counts them) --------------------------------------

  function ukToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  }
  function addDays(iso, days) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function range(period) {
    var today = ukToday();
    var y = today.slice(0, 4);
    var m = today.slice(0, 7);
    switch (period) {
      case 'today':
        return [today, today];
      case '7d':
        return [addDays(today, -6), today];
      case 'last_month': {
        var first = m + '-01';
        var lastOfPrev = addDays(first, -1);
        return [lastOfPrev.slice(0, 7) + '-01', lastOfPrev];
      }
      case '30d':
        return [addDays(today, -29), today];
      case '90d':
        return [addDays(today, -89), today];
      case 'year':
        return [y + '-01-01', today];
      case '12m':
        return [addDays(today, -364), today];
      default:
        return [m + '-01', today];
    }
  }
  function autoGroup(period) {
    if (period === '90d') return 'week';
    if (period === 'year' || period === '12m') return 'month';
    return 'day';
  }
  function dayText(iso) {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function longDay(iso) {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function bucketText(b, group) {
    if (group === 'month')
      return new Date(b.start + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    if (group === 'week') return 'w/c ' + dayText(b.start);
    return dayText(b.start);
  }
  function clock(iso) {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // --- money ---------------------------------------------------------------------------------

  function gbp(v) {
    v = n(v);
    if (v > 0 && v < 0.01) return '£' + v.toFixed(4);
    return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function per(total, people) {
    return n(people) ? gbp(n(total) / n(people)) : '—';
  }

  // --- screen ---------------------------------------------------------------------------------

  function mount(el) {
    root = el;
    stopFeed();
    load();
  }

  function load() {
    var r = range(state.period);
    var group = state.group || autoGroup(state.period);
    root.innerHTML = '<p class="muted">Adding it up…</p>';
    rpc('admin_costs_report', { p_from: r[0], p_to: r[1], p_group: group })
      .then(function (d) {
        draw(d, group);
      })
      .catch(function (err) {
        root.innerHTML =
          ctx.notice('error', esc(friendly(err))) + '<button class="btn" id="cost-retry">Try again</button>';
        $('#cost-retry').onclick = load;
      });
  }

  function draw(d, group) {
    var buckets = d.buckets || [];
    var items = d.items || [];
    var fixed = 0;
    var ai = 0;
    var calls = 0;
    buckets.forEach(function (b) {
      fixed += n(b.fixed);
      ai += n(b.ai);
      calls += n(b.ai_calls);
    });
    var total = fixed + ai;
    var monthly = items.reduce(function (t, it) {
      return t + (it.ended_on ? 0 : n(it.monthly));
    }, 0);
    var empty = !monthly;

    root.innerHTML =
      '<div class="row between" style="margin-bottom: 14px">' +
      '<div class="row">' +
      PERIODS.map(function (p) {
        return '<button type="button" class="pill ' + (p[0] === state.period ? 'on' : '') + '" data-period="' + p[0] + '">' + p[1] + '</button>';
      }).join('') +
      '</div><div class="row">' +
      GROUPS.map(function (g) {
        return '<button type="button" class="pill ' + (g[0] === group ? 'on' : '') + '" data-group="' + g[0] + '">' + g[1] + '</button>';
      }).join('') +
      '<button type="button" class="btn small" id="cost-csv">Download for Excel</button>' +
      '</div></div>' +
      (empty
        ? ctx.notice('info', 'Fill in what you pay each month under <b>Monthly bills</b>: the usual services are listed at £0, with what they normally cost in the notes.')
        : '') +
      '<div class="grid g5">' +
      kpi('Total cost', gbp(total), '<span class="tag plain">' + esc(longDay(d.from)) + ' – ' + esc(longDay(d.to)) + '</span>') +
      kpi('Monthly bills', gbp(monthly), '<span class="tag plain">a month, as set below</span>') +
      kpi('AI use', gbp(ai), '<span class="tag plain">' + fmtN(calls) + ' calls, measured</span>') +
      kpi('Per active person', per(total, d.active_people), '<span class="tag plain">' + fmtN(d.active_people) + ' used Dayli</span>') +
      kpi('Per account', per(total, d.accounts), '<span class="tag plain">' + fmtN(d.accounts) + ' accounts</span>') +
      '</div>' +
      card(
        'Cost over time',
        'Bills (each day carries its share of that month&#39;s price) and AI use, ' + esc(group === 'day' ? 'by day' : group === 'week' ? 'by week from Monday' : 'by month'),
        stacked(buckets, group) + timeTable(buckets, group),
      ) +
      '<div class="grid g2">' +
      card('Monthly bills', 'What you pay each month. Change a price when it goes up: it counts from the date you give, and the days before keep the old one.', billsHtml(items)) +
      card('Where it goes', 'This period, by service', whereHtml(items, ai, total, d.ai_by_feature || [])) +
      '</div>' +
      card(
        'AI live <span class="live-dot"></span>',
        'Every AI call Dayli makes, as it happens: which feature, which model, tokens and cost. No messages or names are kept.',
        '<div id="ai-feed"><p class="muted small">Loading…</p></div>',
      ) +
      card('AI prices', 'US dollars per million tokens, as the providers publish them. A model uses the row it starts with (&ldquo;deepseek&rdquo; covers every DeepSeek model).', pricesHtml(d.prices || [], d.usd_to_gbp));

    bind(d, group);
    startFeed();
  }

  // Bills and AI stacked per bucket.
  function stacked(buckets, group) {
    var max = 0;
    buckets.forEach(function (b) {
      max = Math.max(max, n(b.fixed) + n(b.ai));
    });
    var cols = buckets
      .map(function (b) {
        var f = max ? (n(b.fixed) / max) * 100 : 0;
        var a = max ? (n(b.ai) / max) * 100 : 0;
        var tip = bucketText(b, group) + ': ' + gbp(n(b.fixed) + n(b.ai)) + ' (bills ' + gbp(b.fixed) + ', AI ' + gbp(b.ai) + ')';
        return '<div class="sb" data-tip="' + esc(tip) + '"><i class="ai" style="height: ' + a + '%"></i><i class="fx" style="height: ' + f + '%"></i></div>';
      })
      .join('');
    var labels = buckets.length
      ? [bucketText(buckets[0], group), buckets.length > 2 ? bucketText(buckets[Math.floor(buckets.length / 2)], group) : '', bucketText(buckets[buckets.length - 1], group)]
      : [];
    return (
      '<div class="sbars">' + cols + '</div>' + axis(labels) +
      '<div class="legend" style="margin-top: 6px"><i></i>Bills<i class="o"></i>AI use</div>'
    );
  }

  function timeTable(buckets, group) {
    var rows = buckets
      .slice()
      .reverse()
      .map(function (b) {
        var t = n(b.fixed) + n(b.ai);
        return '<tr><td>' + esc(bucketText(b, group)) + '</td><td class="r">' + gbp(b.fixed) + '</td><td class="r">' + gbp(b.ai) + '</td><td class="r"><b>' + gbp(t) + '</b></td><td class="r">' + fmtN(b.active) + '</td><td class="r">' + per(t, b.active) + '</td></tr>';
      })
      .join('');
    return (
      '<div class="scroll-x" style="margin-top: 14px; max-height: 360px; overflow-y: auto"><table><tr><th></th><th class="r">Bills</th><th class="r">AI</th><th class="r">Total</th><th class="r">Active people</th><th class="r">Per active person</th></tr>' +
      rows +
      '</table></div>'
    );
  }

  function billsHtml(items) {
    var rows = items
      .map(function (it) {
        var history = (it.rates || []).slice(1, 3).map(function (r) {
          return gbp(r.monthly) + ' from ' + longDay(r.from);
        });
        return (
          '<tr class="' + (it.ended_on ? 'muted' : '') + '"><td><b>' + esc(it.name) + '</b><div class="muted small">' + esc(it.category) +
          (it.ended_on ? ' · stopped ' + esc(longDay(it.ended_on)) : '') +
          (it.notes ? ' · ' + esc(it.notes) : '') +
          (history.length ? '<br>Before: ' + esc(history.join(', ')) : '') +
          '</div></td><td class="r"><b>' + gbp(it.monthly) + '</b></td><td class="r">' + gbp(it.period) +
          '</td><td class="r nowrap"><button type="button" class="linkish small" data-edit="' + esc(it.id) + '">Edit</button>' +
          (it.ended_on ? '' : ' · <button type="button" class="linkish small" data-end="' + esc(it.id) + '">Stop</button>') +
          '</td></tr>'
        );
      })
      .join('');
    return (
      '<div class="scroll-x"><table><tr><th>Service</th><th class="r">A month</th><th class="r">This period</th><th></th></tr>' + rows + '</table></div>' +
      '<form id="cost-form" style="margin-top: 16px"><input type="hidden" name="id" />' +
      '<h3 id="cost-form-title" style="font-size: 16px; margin: 0 0 10px">Add a cost</h3>' +
      '<div class="two"><label class="field"><span>Service</span><input type="text" name="name" maxlength="80" required placeholder="e.g. Supabase" /></label>' +
      '<label class="field"><span>Category</span><input type="text" name="category" maxlength="40" placeholder="Hosting, AI, Email…" /></label></div>' +
      '<div class="two"><label class="field"><span>£ a month</span><input type="number" name="monthly" min="0" step="0.01" required /></label>' +
      '<label class="field"><span>From</span><input type="date" name="from" /></label></div>' +
      '<label class="field"><span>Notes</span><input type="text" name="notes" maxlength="300" placeholder="Plan, billing day, yearly price…" /></label>' +
      '<p class="hint" style="margin: -6px 0 12px">Billed yearly? Enter the year&#39;s price divided by 12. In dollars? Convert to pounds.</p>' +
      '<div class="row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="cost-cancel">Clear</button></div></form>'
    );
  }

  function whereHtml(items, ai, total, features) {
    var rows = items
      .filter(function (it) {
        return n(it.period) > 0;
      })
      .map(function (it) {
        return { label: it.name, v: n(it.period), text: gbp(it.period) };
      });
    if (ai > 0) rows.push({ label: 'AI use (measured)', v: ai, text: gbp(ai), cls: 'o' });
    rows.sort(function (a, b) {
      return b.v - a.v;
    });
    var byFeature = features.length
      ? '<h3 style="font-size: 15px; margin: 18px 0 8px">AI by feature</h3>' +
        hbars(
          features.map(function (f) {
            return { label: (FEATURE[f.feature] || f.feature) + ' · ' + fmtN(f.calls) + ' calls', v: n(f.cost), text: gbp(f.cost), cls: 'o' };
          }),
          ai,
        )
      : '';
    return (rows.length ? hbars(rows, total) : '<p class="muted small">Nothing yet for this period.</p>') + byFeature;
  }

  function pricesHtml(prices, rate) {
    return (
      '<div class="scroll-x"><table><tr><th>Model (starts with)</th><th class="r">Input</th><th class="r">Cached input</th><th class="r">Output</th><th></th></tr>' +
      prices
        .map(function (p) {
          return (
            '<tr data-model="' + esc(p.model) + '"><td><b>' + esc(p.model) + '</b></td>' +
            ['input', 'cached', 'output']
              .map(function (k) {
                return '<td class="r"><input type="number" min="0" step="0.001" class="price" data-k="' + k + '" value="' + esc(String(p[k])) + '" /></td>';
              })
              .join('') +
            '<td class="r"><button type="button" class="btn small" data-save-price>Save</button></td></tr>'
          );
        })
        .join('') +
      '<tr data-model=""><td><input type="text" placeholder="New model, e.g. gpt-5" class="price-model" /></td>' +
      ['input', 'cached', 'output']
        .map(function (k) {
          return '<td class="r"><input type="number" min="0" step="0.001" class="price" data-k="' + k + '" /></td>';
        })
        .join('') +
      '<td class="r"><button type="button" class="btn small" data-save-price>Add</button></td></tr>' +
      '</table></div>' +
      '<form id="usd-form" class="row" style="margin-top: 14px"><label class="field" style="margin: 0"><span>$1 is worth (£)</span><input type="number" name="rate" min="0.01" max="10" step="0.0001" value="' +
      esc(String(rate)) +
      '" style="max-width: 140px" /></label><button class="btn small" type="submit" style="align-self: flex-end">Save</button></form>'
    );
  }

  // --- actions ------------------------------------------------------------------------------

  function bind(d, group) {
    root.querySelectorAll('[data-period]').forEach(function (b) {
      b.onclick = function () {
        state.period = b.getAttribute('data-period');
        state.group = null;
        savePrefs();
        load();
      };
    });
    root.querySelectorAll('[data-group]').forEach(function (b) {
      b.onclick = function () {
        state.group = b.getAttribute('data-group');
        savePrefs();
        load();
      };
    });
    $('#cost-csv').onclick = function () {
      download(d, group);
    };

    var form = $('#cost-form');
    var byId = {};
    (d.items || []).forEach(function (it) {
      byId[it.id] = it;
    });
    form.from.value = ukToday();
    root.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () {
        var it = byId[b.getAttribute('data-edit')];
        form.id.value = it.id;
        form.name.value = it.name;
        form.category.value = it.category;
        form.monthly.value = n(it.monthly).toFixed(2);
        form.from.value = ukToday();
        form.notes.value = it.notes || '';
        $('#cost-form-title').textContent = 'Change ' + it.name;
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        form.monthly.focus();
      };
    });
    root.querySelectorAll('[data-end]').forEach(function (b) {
      b.onclick = function () {
        var it = byId[b.getAttribute('data-end')];
        if (!confirm('Stop counting ' + it.name + ' from today? Days before keep its cost.')) return;
        rpc('admin_cost_end', { p_id: it.id }).then(load, function (err) {
          ctx.toast(friendly(err));
        });
      };
    });
    $('#cost-cancel').onclick = function () {
      form.reset();
      form.id.value = '';
      form.from.value = ukToday();
      $('#cost-form-title').textContent = 'Add a cost';
    };
    form.onsubmit = function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      ctx.setBusy(btn, true, 'Saving…');
      rpc('admin_cost_save', {
        p_id: form.id.value || null,
        p_name: form.name.value,
        p_category: form.category.value,
        p_monthly: Number(form.monthly.value),
        p_from: form.from.value || null,
        p_notes: form.notes.value,
      }).then(
        function () {
          ctx.toast('Saved');
          load();
        },
        function (err) {
          ctx.setBusy(btn, false);
          ctx.toast(friendly(err));
        },
      );
    };

    root.querySelectorAll('[data-save-price]').forEach(function (b) {
      b.onclick = function () {
        var tr = b.closest('tr');
        var model = tr.getAttribute('data-model') || (tr.querySelector('.price-model') || {}).value || '';
        var v = {};
        tr.querySelectorAll('.price').forEach(function (i) {
          v[i.getAttribute('data-k')] = Number(i.value || 0);
        });
        if (!model.trim()) return ctx.toast('Give the model a name');
        rpc('admin_ai_price_save', { p_model: model, p_input: v.input, p_cached: v.cached, p_output: v.output }).then(
          function () {
            ctx.toast('Price saved');
            load();
          },
          function (err) {
            ctx.toast(friendly(err));
          },
        );
      };
    });
    $('#usd-form').onsubmit = function (e) {
      e.preventDefault();
      rpc('admin_usd_rate_save', { p_usd_to_gbp: Number(this.rate.value) }).then(
        function () {
          ctx.toast('Rate saved');
          load();
        },
        function (err) {
          ctx.toast(friendly(err));
        },
      );
    };
  }

  // --- Excel download (CSV, which Excel and Numbers open) -------------------------------------

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function money(v) {
    return n(v).toFixed(2);
  }
  function download(d, group) {
    var items = (d.items || []).filter(function (it) {
      return (d.buckets || []).some(function (b) {
        return b.by_item && b.by_item[it.id];
      });
    });
    var lines = [];
    lines.push(['Dayli costs', longDay(d.from) + ' to ' + longDay(d.to), 'by ' + group, 'pounds (GBP)']);
    lines.push([]);
    lines.push(
      ['From', 'To']
        .concat(
          items.map(function (it) {
            return it.name;
          }),
        )
        .concat(['Bills', 'AI use', 'AI calls', 'Total', 'Active people', 'Accounts', 'Per active person', 'Per account']),
    );
    (d.buckets || []).forEach(function (b) {
      var t = n(b.fixed) + n(b.ai);
      lines.push(
        [b.start, b.end]
          .concat(
            items.map(function (it) {
              return money(b.by_item && b.by_item[it.id]);
            }),
          )
          .concat([
            money(b.fixed),
            n(b.ai).toFixed(4),
            n(b.ai_calls),
            money(t),
            n(b.active),
            n(b.accounts),
            n(b.active) ? money(t / n(b.active)) : '',
            n(b.accounts) ? (t / n(b.accounts)).toFixed(4) : '',
          ]),
      );
    });
    lines.push([]);
    lines.push(['Monthly bills']);
    lines.push(['Service', 'Category', 'A month now', 'This period', 'Stopped', 'Price history', 'Notes']);
    (d.items || []).forEach(function (it) {
      lines.push([
        it.name,
        it.category,
        money(it.monthly),
        money(it.period),
        it.ended_on || '',
        (it.rates || [])
          .map(function (r) {
            return money(r.monthly) + ' from ' + r.from;
          })
          .join('; '),
        it.notes || '',
      ]);
    });
    lines.push([]);
    lines.push(['AI by feature', 'Calls', 'Cost']);
    (d.ai_by_feature || []).forEach(function (f) {
      lines.push([FEATURE[f.feature] || f.feature, n(f.calls), n(f.cost).toFixed(4)]);
    });
    var text =
      '﻿' +
      lines
        .map(function (l) {
          return l.map(csvCell).join(',');
        })
        .join('\r\n');
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dayli-costs-' + d.from.replace(/-/g, '') + '-' + d.to.replace(/-/g, '') + '-' + group + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  // --- AI live ------------------------------------------------------------------------------

  function stopFeed() {
    if (feedTimer) clearTimeout(feedTimer);
    feedTimer = null;
  }
  function startFeed() {
    stopFeed();
    var tick = function () {
      var el = document.getElementById('ai-feed');
      // Left the Costs tab: stop.
      if (!el) return stopFeed();
      if (document.hidden) {
        feedTimer = setTimeout(tick, 10000);
        return;
      }
      rpc('admin_ai_feed', { p_limit: 40 })
        .then(function (f) {
          var now = document.getElementById('ai-feed');
          if (now) now.innerHTML = feedHtml(f);
        })
        .catch(function () {
          /* try again next time */
        })
        .then(function () {
          if (document.getElementById('ai-feed')) feedTimer = setTimeout(tick, 10000);
        });
    };
    tick();
  }
  function feedHtml(f) {
    var h = f.last_hour || {};
    var t = f.today || {};
    var m = f.month || {};
    var rows = (f.recent || [])
      .map(function (r) {
        var tokens = fmtN(r.input) + (n(r.cached) ? ' <span class="muted">(' + fmtN(r.cached) + ' cached)</span>' : '');
        return (
          '<tr class="' + (r.ok ? '' : 'bad-row') + '"><td class="nowrap">' + esc(clock(r.at)) + '</td><td>' + esc(FEATURE[r.feature] || r.feature) +
          (r.ok ? '' : ' <span class="tag bad">failed</span>') +
          '</td><td class="muted small">' + esc(r.model) + '</td><td class="r">' + tokens + '</td><td class="r">' + fmtN(r.output) +
          '</td><td class="r">' + (r.ms != null ? (n(r.ms) / 1000).toFixed(1) + 's' : '—') + '</td><td class="r">' + gbp(r.cost) + '</td></tr>'
        );
      })
      .join('');
    return (
      '<div class="grid g3" style="margin-bottom: 12px">' +
      kpi('Last hour', gbp(h.cost), '<span class="tag plain">' + fmtN(h.calls) + ' calls</span>') +
      kpi('Today', gbp(t.cost), '<span class="tag plain">' + fmtN(t.calls) + ' calls</span>') +
      kpi('This month', gbp(m.cost), '<span class="tag plain">' + fmtN(m.calls) + ' calls</span>') +
      '</div>' +
      (rows
        ? '<div class="scroll-x" style="max-height: 420px; overflow-y: auto"><table><tr><th>Time</th><th>Feature</th><th>Model</th><th class="r">Tokens in</th><th class="r">Out</th><th class="r">Took</th><th class="r">Cost</th></tr>' +
          rows +
          '</table></div>'
        : '<p class="muted small">No AI calls yet. They show here as people use Smart add, Ask Dayli and the rest.</p>') +
      '<p class="muted small" style="margin-top: 8px">Updated ' + esc(clock(f.now)) + ' · refreshes every 10 seconds while this page is open.</p>'
    );
  }

  return { mount: mount, stop: stopFeed };
};
