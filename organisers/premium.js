/* Dayli admin: Dayli Plus. Plain browser JavaScript, no build.
 * The Premium tab of the admin pages (#/admin?tab=premium): the on/off
 * switch, how long founders keep Plus, the free limits, who has which plan,
 * and giving someone Plus. Numbers from admin_premium() in
 * supabase/migrations/20261031000700_premium.sql. */
window.DayliPremium = function (ctx, ui) {
  'use strict';
  var esc = ctx.esc;
  var $ = ctx.$;
  var rpc = ctx.rpc;
  var friendly = ctx.friendly;
  var kpi = ui.kpi;
  var card = ui.card;
  var fmtN = ui.fmtN;
  var n = ui.n;
  var root = null;

  var PLAN = {
    founder: 'Founders (Plus free)',
    plus: 'Dayli Plus',
    family: 'Plus Family (payers)',
    family_member: 'Plus Family (shared)',
    free: 'Free plan',
  };

  function day(iso) {
    return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  function mount(el) {
    root = el;
    load();
  }

  function load() {
    root.innerHTML = '<p class="muted">Loading…</p>';
    rpc('admin_premium', {})
      .then(draw)
      .catch(function (err) {
        root.innerHTML = ctx.notice('error', esc(friendly(err))) + '<button class="btn" id="pr-retry">Try again</button>';
        $('#pr-retry').onclick = load;
      });
  }

  function draw(d) {
    var by = d.by_plan || {};
    var u = d.usage_this_month || {};
    var on = !!d.enabled;
    root.innerHTML =
      '<div class="card"><div class="row between"><div><h3>Dayli Plus is ' +
      (on ? '<span class="tag ok">on</span>' : '<span class="tag plain">off</span>') +
      '</h3><p class="sub">' +
      (on
        ? 'Free accounts have the free limits and see Dayli Plus in the app. On since ' + esc(day(d.first_enabled_at)) + '.'
        : 'Everyone has everything and nobody sees a price. Switching it on applies the free limits and shows Dayli Plus in the app, on every phone the next time Dayli opens.') +
      '</p></div><button type="button" class="btn ' +
      (on ? '' : 'primary') +
      '" id="pr-toggle">' +
      (on ? 'Switch off' : 'Switch on') +
      '</button></div></div>' +
      '<div class="grid g4">' +
      kpi('People', fmtN(d.people), '') +
      kpi(on ? 'Founders' : 'Would be founders', fmtN(on ? by.founder : d.founders), '<span class="tag plain">' + (d.founders_until ? 'Plus free until ' + esc(day(d.founders_until)) : 'Plus free for life') + '</span>') +
      kpi('Subscribed', fmtN(n(by.plus) + n(by.family)), '<span class="tag plain">' + fmtN(by.family_member) + ' through a family</span>') +
      kpi('Free plan', fmtN(on ? by.free : 0), '<span class="tag plain">' + (on ? 'have the limits' : 'nobody until it is on') + '</span>') +
      '</div>' +
      '<div class="grid g2">' +
      card(
        'Settings',
        'Founders are everyone who joined before Dayli Plus was first switched on.',
        '<form id="pr-form">' +
          '<label class="field"><span>Founders keep Plus</span><select name="founders"><option value="life"' +
          (d.founders_until ? '' : ' selected') +
          '>For life</option><option value="until"' +
          (d.founders_until ? ' selected' : '') +
          '>Until a date</option></select></label>' +
          '<label class="field" id="pr-until-row"' +
          (d.founders_until ? '' : ' hidden') +
          '><span>Until</span><input type="date" name="until" value="' +
          esc(d.founders_until || '') +
          '" /></label>' +
          '<div class="two"><label class="field"><span>Free Ask Dayli a day</span><input type="number" name="ask" min="0" value="' +
          esc(String(d.free_ask_per_day)) +
          '" /></label><label class="field"><span>Free scans a month</span><input type="number" name="scans" min="0" value="' +
          esc(String(d.free_scans_per_month)) +
          '" /></label></div>' +
          '<button class="btn primary" type="submit">Save</button></form>',
      ) +
      card(
        'This month',
        on ? 'Use of the limited features.' : 'Use of the limited features, and who would have hit the free limits if Dayli Plus were on.',
        '<div class="hrow"><span>Ask Dayli questions</span><b>' +
          fmtN(u.ask) +
          '</b></div><div class="hrow"><span>Scans</span><b>' +
          fmtN(u.scan) +
          '</b></div><div class="hrow"><span>People over the Ask Dayli limit on some day</span><b>' +
          fmtN(u.would_hit_ask_limit) +
          '</b></div><div class="hrow"><span>People over the scan limit</span><b>' +
          fmtN(u.would_hit_scan_limit) +
          '</b></div>' +
          '<h3 style="font-size: 15px; margin: 16px 0 6px">Everyone, by plan</h3>' +
          Object.keys(PLAN)
            .filter(function (k) {
              return n(by[k]);
            })
            .map(function (k) {
              return '<div class="hrow"><span>' + esc(PLAN[k]) + '</span><b>' + fmtN(by[k]) + '</b></div>';
            })
            .join(''),
      ) +
      '</div>' +
      card(
        'Give someone Plus',
        'For a friend, a tester or a prize. Store subscriptions are never changed here.',
        '<form id="pr-grant"><div class="two"><label class="field"><span>Their email</span><input type="email" name="email" required /></label>' +
          '<label class="field"><span>Plan</span><select name="plan"><option value="plus">Dayli Plus</option><option value="family">Plus Family</option></select></label></div>' +
          '<label class="field"><span>Until (leave empty for no end)</span><input type="date" name="until" /></label>' +
          '<div class="row"><button class="btn primary" type="submit">Give Plus</button><button class="btn" type="button" id="pr-revoke">Take it back</button></div></form>',
      ) +
      card(
        'Subscriptions',
        'Paid and given plans, newest first.',
        (d.subscriptions || []).length
          ? '<table><tr><th>Who</th><th class="r">Plan</th><th class="r">Billing</th><th class="r">From</th><th class="r">Until</th></tr>' +
              d.subscriptions
                .map(function (s) {
                  return (
                    '<tr><td>' + esc(s.name) + '</td><td class="r">' + esc(s.plan === 'family' ? 'Family' : 'Plus') + '</td><td class="r">' + esc(s.period || '—') + '</td><td class="r">' + esc(s.source) + '</td><td class="r">' + esc(s.until ? day(s.until) : 'no end') + (s.cancelled ? ' <span class="tag warn">cancelled</span>' : '') + '</td></tr>'
                  );
                })
                .join('') +
              '</table>'
          : '<p class="muted small">None yet. Buying arrives with the next App Store and Play build.</p>',
      );
    bind(d);
  }

  function save(d, enabled) {
    var f = $('#pr-form');
    var until = f.founders.value === 'until' ? f.until.value || null : null;
    return rpc('admin_premium_save', {
      p_enabled: enabled,
      p_founders_until: until,
      p_ask_per_day: Number(f.ask.value),
      p_scans_per_month: Number(f.scans.value),
    });
  }

  function bind(d) {
    var f = $('#pr-form');
    f.founders.onchange = function () {
      $('#pr-until-row').hidden = this.value !== 'until';
    };
    f.onsubmit = function (e) {
      e.preventDefault();
      save(d, !!d.enabled).then(
        function () {
          ctx.toast('Saved');
          load();
        },
        function (err) {
          ctx.toast(friendly(err));
        },
      );
    };
    $('#pr-toggle').onclick = function () {
      var turnOn = !d.enabled;
      var msg = turnOn
        ? 'Switch Dayli Plus on? ' + fmtN(d.founders) + ' people who joined before now become founders with Plus free. New people get the free limits.'
        : 'Switch Dayli Plus off? Everyone gets everything again, and the app stops showing prices.';
      if (!confirm(msg)) return;
      save(d, turnOn).then(
        function () {
          ctx.toast(turnOn ? 'Dayli Plus is on' : 'Dayli Plus is off');
          load();
        },
        function (err) {
          ctx.toast(friendly(err));
        },
      );
    };
    var g = $('#pr-grant');
    g.onsubmit = function (e) {
      e.preventDefault();
      rpc('admin_grant_plan', { p_email: g.email.value, p_plan: g.plan.value, p_until: g.until.value || null }).then(
        function () {
          ctx.toast('Plus given');
          load();
        },
        function (err) {
          ctx.toast(/no_such_account/.test(String(err && err.message)) ? 'No account with that email' : friendly(err));
        },
      );
    };
    $('#pr-revoke').onclick = function () {
      if (!g.email.value) return ctx.toast('Enter their email first');
      rpc('admin_grant_plan', { p_email: g.email.value, p_plan: null, p_until: null }).then(
        function () {
          ctx.toast('Taken back');
          load();
        },
        function (err) {
          ctx.toast(friendly(err));
        },
      );
    };
  }

  return { mount: mount };
};
