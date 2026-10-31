/* Dayli for organisers: selling tickets through Dayli. Plain browser
 * JavaScript, no build.
 *   #/payouts           connect Stripe (where ticket money is paid), and each event's tickets
 *   #/tickets/<event>   setting tickets up (step by step the first time), then
 *                       ticket types, releases, codes, the fee, orders and refunds
 *   #/checkin/<event>   the door: scan or type ticket codes
 * Admin: the Tickets tab (who may sell, the booking fee, the takings).
 * Data from supabase/migrations/20261101000100_tickets.sql and the
 * stripe-connect, ticket-refund Edge Functions. */
window.DayliTickets = function (ctx) {
  'use strict';
  var esc = ctx.esc;
  var $ = ctx.$;
  var $$ = ctx.$$;
  var rpc = ctx.rpc;
  var render = ctx.render;
  var notice = ctx.notice;
  var friendly = ctx.friendly;
  var toast = ctx.toast;
  var sb = ctx.sb;

  function pounds(pence) {
    return '£' + (Number(pence || 0) / 100).toFixed(2);
  }
  function fee(s) {
    return Number(s.fee_percent) + '% + ' + Number(s.fee_fixed_pence) + 'p';
  }
  function invoke(name, body) {
    return sb.functions.invoke(name, { body: body }).then(function (res) {
      if (res.error) {
        var c = res.error.context;
        if (c && typeof c.json === 'function') {
          return c.json().then(
            function (b) {
              throw new Error((b && b.error) || res.error.message);
            },
            function () {
              throw res.error;
            },
          );
        }
        throw res.error;
      }
      return res.data;
    });
  }
  function stripeError(err) {
    var m = String((err && err.message) || err || '');
    if (/stripe_not_configured/.test(m)) return 'Ticket sales aren’t open yet: Dayli’s Stripe account still needs connecting.';
    if (/not_approved/.test(m)) return 'Selling tickets isn’t switched on for your account yet.';
    return friendly(err);
  }
  function eventTitle(id) {
    return sb
      .from('public_events')
      .select('id, title, status, starts_at')
      .eq('id', id)
      .maybeSingle()
      .then(function (r) {
        return r.data || { id: id, title: 'Your event' };
      });
  }

  // --- Payouts: connect Stripe ---------------------------------------------------------------

  function payouts(query) {
    ctx.loading();
    var check = query && (query.back || query.retry) ? invoke('stripe-connect', { action: 'status' }).catch(function () {}) : Promise.resolve();
    check
      .then(function () {
        return Promise.all([
          sb.from('organisers').select('can_sell_tickets, stripe_account_id, stripe_ready').eq('user_id', ctx.uid()).maybeSingle(),
          sb
            .from('public_events')
            .select('id, title, status, starts_at')
            .eq('organiser_id', ctx.uid())
            .order('starts_at', { ascending: false })
            .limit(50),
          rpc('ticket_fee_settings', {}).catch(function () {
            return { fee_percent: 5, fee_fixed_pence: 30 };
          }),
        ]);
      })
      .then(function (r) {
        var o = (r[0] && r[0].data) || {};
        var events = (r[1] && r[1].data) || [];
        var f = r[2] || { fee_percent: 5, fee_fixed_pence: 30 };
        var status;
        if (!o.can_sell_tickets) {
          status =
            '<h3>Selling tickets through Dayli</h3><p class="sub">Selling tickets isn’t switched on for your account. Email <a href="mailto:hello@daylicalendar.co.uk">hello@daylicalendar.co.uk</a> and we’ll look at it. Until then, keep using your own ticket link on each event.</p>';
        } else if (!o.stripe_account_id) {
          status =
            '<h3>Connect Stripe to get paid</h3><p class="sub">Free tickets work already. For paid ones, ticket money goes straight to your own Stripe account, and Stripe pays it into your bank. Setting up takes about five minutes: your details, your bank account, and a check of who you are.</p><button class="btn primary" id="tk-connect">Connect with Stripe</button>';
        } else if (!o.stripe_ready) {
          status =
            '<h3>Stripe needs a few more details</h3><p class="sub">Finish setting up your Stripe account, then come back here.</p><div class="row"><button class="btn primary" id="tk-connect">Continue with Stripe</button><button class="btn" id="tk-check">Check again</button></div>';
        } else {
          status =
            '<h3>Ready to sell tickets <span class="tag ok">connected</span></h3><p class="sub">Ticket money is paid into your Stripe account, and from there into your bank.</p><button class="btn" id="tk-dash">Open your Stripe dashboard</button>';
        }
        render(
          '<div class="page-head"><div><h1>Tickets & payouts</h1><p class="muted">Sell tickets on your events through Dayli</p></div></div>' +
            '<div class="card">' +
            status +
            '</div>' +
            '<div class="card"><h3>How it works</h3><p class="sub">Buyers pay on Stripe’s secure page in the Dayli app. A booking fee of ' +
            esc(fee(f)) +
            ' is added on top of each paid order, so you receive the full ticket price (or you can choose to pay it yourself). Free tickets have no fee. Buyers get a ticket with a code for the door; you check them in from your phone. You can refund any order, and cancelling an event refunds everyone.</p></div>' +
            (o.can_sell_tickets
              ? '<div class="card"><h3>Your events</h3>' +
                (events.length
                  ? events
                      .map(function (ev) {
                        return (
                          '<div class="hrow"><span>' +
                          esc(ev.title) +
                          (ev.status !== 'published' ? ' <span class="tag plain">' + esc(ev.status) + '</span>' : '') +
                          '</span><a class="btn small" href="#/tickets/' +
                          esc(ev.id) +
                          '">Tickets</a></div>'
                        );
                      })
                      .join('')
                  : '<p class="muted small">No events yet.</p>') +
                '</div>'
              : ''),
        );
        var c = $('#tk-connect');
        if (c)
          c.onclick = function () {
            ctx.setBusy(c, true, 'Opening Stripe…');
            invoke('stripe-connect', { action: 'start' }).then(
              function (d) {
                location.href = d.url;
              },
              function (err) {
                ctx.setBusy(c, false);
                toast(stripeError(err));
              },
            );
          };
        var k = $('#tk-check');
        if (k)
          k.onclick = function () {
            payouts({ back: '1' });
          };
        var d = $('#tk-dash');
        if (d)
          d.onclick = function () {
            invoke('stripe-connect', { action: 'dashboard' }).then(
              function (r) {
                if (r.url) window.open(r.url, '_blank', 'noopener');
                else toast('Stripe has no dashboard for this account yet.');
              },
              function (err) {
                toast(stripeError(err));
              },
            );
          };
      })
      .catch(function (err) {
        render(notice('error', esc(friendly(err))));
      });
  }

  // --- One event's tickets ---------------------------------------------------------------------
  // The first time: a few questions, one at a time (the setup steps). After
  // that, and for "set it up myself": the Tickets screen, with what one ticket
  // costs the buyer and earns the organiser always on show.

  function money(pence) {
    return '£' + (Number(pence || 0) / 100).toFixed(2);
  }
  function moneyRound(pence) {
    var p = Number(pence || 0);
    return p >= 10000 ? '£' + Math.round(p / 100).toLocaleString('en-GB') : money(p);
  }
  function penceOf(v) {
    v = String(v == null ? '' : v).replace(/[£,\s]/g, '');
    if (v === '') return null;
    var x = Math.round(parseFloat(v) * 100);
    return isNaN(x) || x < 0 ? NaN : x;
  }
  function countOf(v) {
    v = String(v == null ? '' : v).trim();
    if (!v) return null;
    var x = parseInt(v, 10);
    return isNaN(x) || x < 1 || String(x) !== v.replace(/^0+(?=\d)/, '') ? NaN : x;
  }
  function poundsIn(p) {
    return p == null || isNaN(p) ? '' : (p / 100).toFixed(2);
  }
  function localInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function fromLocal(v) {
    return v ? new Date(v).toISOString() : null;
  }
  function whenText(v) {
    return v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  }
  function feeOn(pence, s) {
    return pence > 0 ? Math.round((pence * Number(s.fee_percent)) / 100) + Number(s.fee_fixed_pence) : 0;
  }
  function cleanCode(v) {
    return String(v || '').replace(/\s/g, '').toUpperCase();
  }

  // The tickets as the screen edits them ("plan"), from and to the server's types.
  function blankPlan() {
    return {
      mode: 'paid',
      absorb: false,
      capacity: null,
      maxPer: 10,
      description: '',
      salesStart: '',
      salesEnd: '',
      code: '',
      releasesOn: false,
      main: { id: null, name: 'General admission', price: null, quantity: null, sold: 0 },
      releases: [],
      others: [],
    };
  }
  function planFrom(s) {
    var p = blankPlan();
    p.absorb = !!s.fee_absorbed;
    p.capacity = s.capacity || null;
    var types = (s.types || []).filter(function (t) {
      return !t.hidden;
    });
    if (!types.length) return p;
    var byId = {};
    var child = {};
    types.forEach(function (t) {
      byId[t.id] = t;
    });
    types.forEach(function (t) {
      if (t.after_type && byId[t.after_type]) child[t.after_type] = t;
    });
    var item = function (t) {
      return {
        id: t.id,
        name: t.name,
        price: t.price_pence,
        quantity: t.quantity,
        sold: Number(t.sold || 0),
        code: t.access_code || '',
        opens: t.after_type && t.sales_start ? localInput(t.sales_start) : '',
      };
    };
    var head = types.filter(function (t) {
      return child[t.id] && !(t.after_type && byId[t.after_type]);
    })[0];
    var used = {};
    var lead;
    if (head) {
      p.releasesOn = true;
      lead = head;
      for (var c = head; c && !used[c.id]; c = child[c.id]) {
        used[c.id] = true;
        p.releases.push(item(c));
      }
      p.main = null;
    }
    var rest = types.filter(function (t) {
      return !used[t.id];
    });
    if (!head) {
      lead = rest.shift();
      p.main = item(lead);
      p.code = lead.access_code || '';
    }
    p.others = rest.map(item);
    p.mode = lead.pay_what_you_like ? 'pwyl' : lead.price_pence ? 'paid' : 'free';
    p.maxPer = lead.max_per_order || 10;
    p.description = lead.description || '';
    p.salesStart = localInput(lead.sales_start && !lead.after_type ? lead.sales_start : null);
    var last = head ? byId[p.releases[p.releases.length - 1].id] : lead;
    p.salesEnd = localInput(last.sales_end);
    return p;
  }
  function toTypes(p) {
    var out = [];
    var end = fromLocal(p.salesEnd);
    if (p.releasesOn && p.mode !== 'free') {
      p.releases.forEach(function (r, i) {
        var next = p.releases[i + 1];
        out.push({
          id: r.id || null,
          name: r.name,
          price_pence: r.price || 0,
          pay_what_you_like: false,
          quantity: r.quantity,
          max_per_order: p.maxPer,
          description: p.description,
          access_code: '',
          after: i ? i - 1 : null,
          sales_start: i ? fromLocal(r.opens) : fromLocal(p.salesStart),
          sales_end: next && next.opens ? fromLocal(next.opens) : end,
        });
      });
    } else {
      var m = p.main;
      out.push({
        id: m.id || null,
        name: m.name,
        price_pence: p.mode === 'free' ? 0 : m.price || 0,
        pay_what_you_like: p.mode === 'pwyl',
        quantity: m.quantity,
        max_per_order: p.maxPer,
        description: p.description,
        access_code: p.code,
        sales_start: fromLocal(p.salesStart),
        sales_end: end,
      });
    }
    p.others.forEach(function (o) {
      out.push({
        id: o.id || null,
        name: o.name,
        price_pence: o.price || 0,
        pay_what_you_like: false,
        quantity: o.quantity,
        max_per_order: p.maxPer,
        description: '',
        access_code: o.code || '',
        sales_start: fromLocal(p.salesStart),
        sales_end: end,
      });
    });
    return out;
  }
  // What's wrong with the plan, in words, or null.
  function problem(p) {
    var bad = function (x) {
      return typeof x === 'number' && isNaN(x);
    };
    var priced = function (price, what, free) {
      if (price === null || bad(price)) return 'Enter a price for ' + what + '.';
      if (price === 0 && free) return null;
      if (price < 50) return 'A paid ticket must be at least 50p (' + what + ').';
      return null;
    };
    var list = p.releasesOn && p.mode !== 'free' ? p.releases : [p.main];
    if (p.releasesOn && p.mode !== 'free' && p.releases.length < 2) return 'Releases need at least two steps.';
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!String(t.name || '').trim()) return 'Every ticket needs a name.';
      if (bad(t.quantity)) return 'Places must be a whole number (' + t.name + ').';
      if (p.mode === 'paid') {
        var e = priced(t.price, t.name, false);
        if (e) return e;
      } else if (p.mode === 'pwyl') {
        if (t.price === null || bad(t.price) || (t.price > 0 && t.price < 50)) return 'The lowest price must be £0 or at least 50p.';
      }
    }
    for (var j = 0; j < p.others.length; j++) {
      var o = p.others[j];
      if (!String(o.name || '').trim()) return 'Every ticket needs a name.';
      var e2 = priced(o.price, o.name, true);
      if (e2) return e2;
      if (bad(o.quantity)) return 'Places must be a whole number (' + o.name + ').';
      if (o.code && !/^[A-Z0-9]{3,20}$/.test(cleanCode(o.code))) return 'Codes are 3 to 20 letters or numbers (' + o.name + ').';
    }
    if (p.code && !/^[A-Z0-9]{3,20}$/.test(cleanCode(p.code))) return 'Codes are 3 to 20 letters or numbers.';
    if (bad(p.capacity)) return 'Total places must be a whole number.';
    if (bad(p.maxPer) || !p.maxPer || p.maxPer > 50) return 'Most per order is 1 to 50.';
    if (p.salesStart && p.salesEnd && new Date(p.salesEnd) <= new Date(p.salesStart)) return 'Sales must close after they open.';
    return null;
  }
  // What the organiser gets if every limited place sells.
  function ifAllSell(p, s) {
    var total = 0;
    var places = 0;
    var open = false;
    var add = function (price, qty) {
      if (!qty) {
        open = true;
        return;
      }
      var get = p.absorb ? price - feeOn(price, s) : price;
      total += qty * Math.max(0, get);
      places += qty;
    };
    if (p.mode === 'free') return { total: 0, places: 0, open: true };
    if (p.releasesOn) {
      p.releases.forEach(function (r) {
        add(r.price || 0, r.quantity);
      });
    } else add(p.main.price || 0, p.main.quantity);
    p.others.forEach(function (o) {
      if (o.price) add(o.price, o.quantity);
    });
    return { total: total, places: places, open: open };
  }

  function receiptHtml(p, s) {
    if (p.mode === 'free') {
      return (
        '<div class="card tk-sticky"><h3>Free tickets</h3><p class="sub">People book a place in the app and get a ticket with a code for the door. No booking fee, no Stripe needed.</p>' +
        (p.main && p.main.quantity ? '<div class="hrow"><span>Places</span><b>' + p.main.quantity + '</b></div>' : '') +
        '</div>'
      );
    }
    var lead = p.releasesOn
      ? p.releases.filter(function (r) {
          return !r.quantity || r.sold < r.quantity;
        })[0] || p.releases[0]
      : p.main;
    var price = lead && typeof lead.price === 'number' && !isNaN(lead.price) ? lead.price : null;
    var title = (lead && lead.name ? esc(lead.name) : 'One') + ' ticket' + (p.mode === 'pwyl' ? ', at the lowest price' : '');
    if (price === null) return '<div class="card tk-sticky"><h3>' + title + '</h3><p class="muted small">Enter a price to see what buyers pay and what you get.</p></div>';
    var fee = feeOn(price, s);
    var feeText = Number(s.fee_percent) + '% + ' + Number(s.fee_fixed_pence) + 'p';
    var all = ifAllSell(p, s);
    var extra = '';
    if (p.releasesOn) {
      extra =
        '<div class="lab" style="margin-top: 16px">If every release sells out</div>' +
        p.releases
          .map(function (r) {
            return '<div class="hrow"><span>' + (r.quantity || '?') + ' × ' + money(r.price || 0) + '</span><b>' + (r.quantity ? moneyRound(r.quantity * Math.max(0, (r.price || 0) - (p.absorb ? feeOn(r.price || 0, s) : 0))) : '—') + '</b></div>';
          })
          .join('') +
        (all.open ? '' : '<div class="hrow tot"><span>You get</span><span>' + moneyRound(all.total) + '</span></div>');
    } else if (all.places && !all.open) {
      extra = '<p class="small muted" style="margin-top: 12px">Sell all ' + all.places + ' and you get <b style="color: var(--ink)">' + moneyRound(all.total) + '</b>, paid into your bank by Stripe.</p>';
    } else if (p.mode === 'pwyl') {
      extra = '<p class="small muted" style="margin-top: 12px">People can pay more than this. The booking fee is worked out on what they pay.</p>';
    }
    return (
      '<div class="card tk-sticky"><h3>' +
      title +
      '</h3><div class="receipt"><div class="lab">The buyer pays</div><div class="hrow"><span>Ticket</span><b>' +
      money(price) +
      '</b></div><div class="hrow"><span>Booking fee (' +
      feeText +
      ')</span><b>' +
      (p.absorb ? '<span class="muted">you pay it</span>' : money(fee)) +
      '</b></div><div class="hrow tot"><span>Total</span><span>' +
      money(p.absorb ? price : price + fee) +
      '</span></div></div><div class="receipt you"><div class="lab">You receive</div><div class="hrow tot big"><span>' +
      money(p.absorb ? Math.max(0, price - fee) : price) +
      '</span><span class="small muted">per ticket</span></div></div>' +
      (p.absorb && price ? '<p class="small muted" style="margin-top: 10px">The price buyers see is the price they pay. The ' + money(fee) + ' fee comes out of your ' + money(price) + '.</p>' : '') +
      extra +
      '</div>'
    );
  }

  function choiceHtml(mode, attr) {
    var c = function (k, t, sub) {
      return '<button type="button" class="choice' + (mode === k ? ' on' : '') + '" ' + attr + '="' + k + '"><b>' + t + '</b><span>' + sub + '</span></button>';
    };
    return '<div class="choices">' + c('free', 'Free', 'People book a place') + c('paid', 'Paid', 'One price or several') + c('pwyl', 'Pay what you like', 'You set the lowest price') + '</div>';
  }
  function feeSeg(absorb, attr) {
    return (
      '<div class="lab" style="margin-top: 14px">Booking fee</div><div class="seg"><button type="button" class="' +
      (absorb ? '' : 'on') +
      '" ' +
      attr +
      '="0">Buyer pays it on top</button><button type="button" class="' +
      (absorb ? 'on' : '') +
      '" ' +
      attr +
      '="1">I’ll pay it</button></div>'
    );
  }

  // --- The Tickets screen ----------------------------------------------------------------------

  var openSec = {};
  function section(key, title, sub, summary, body, opts) {
    opts = opts || {};
    var isOpen = !opts.soon && (opts.on || openSec[key]);
    return (
      '<div class="tk-acc' +
      (isOpen ? ' open' : '') +
      (opts.soon ? ' soon' : '') +
      '"><button type="button" class="tk-acc-h" data-sec="' +
      key +
      '"' +
      (opts.soon ? ' disabled' : '') +
      '><span class="t"><b>' +
      title +
      '</b><span>' +
      sub +
      '</span></span><span class="sum">' +
      summary +
      '</span>' +
      (opts.toggle ? '<span class="tog' + (opts.on ? '' : ' off') + '" data-toggle="' + key + '"></span>' : opts.soon ? '' : '<span class="chev">' + (isOpen ? '⌄' : '›') + '</span>') +
      '</button>' +
      (isOpen && body ? '<div class="tk-acc-b">' + body + '</div>' : '') +
      '</div>'
    );
  }
  function priceInput(attrs, p) {
    return '<span class="pound"><input type="text" inputmode="decimal" ' + attrs + ' value="' + esc(poundsIn(p)) + '" /></span>';
  }

  function editorHtml(p, s, firstTime) {
    var free = p.mode === 'free';
    var main = p.main;
    var top = '';
    if (!p.releasesOn || free) {
      top =
        '<div class="two">' +
        (free
          ? ''
          : '<label class="field"><span>' +
            (p.mode === 'pwyl' ? 'Lowest price' : 'Price') +
            '</span>' +
            priceInput('class="bigin" data-f="price"', main.price) +
            '</label>') +
        '<label class="field"><span>How many places</span><input type="number" min="1" class="bigin" data-f="quantity" placeholder="No limit" value="' +
        esc(main.quantity || '') +
        '" /></label></div>' +
        (main.sold ? '<p class="muted small">' + main.sold + ' sold so far.' + (main.sold && !free ? ' The price can’t change now.' : '') + '</p>' : '');
    }
    var rel = '';
    if (p.releasesOn && !free) {
      rel =
        '<div class="rel-row hd"><span></span><span>Name</span><span>Price</span><span>Places</span><span>Opens</span><span></span></div>' +
        p.releases
          .map(function (r, i) {
            return (
              '<div class="rel-row"><span class="n">' +
              (i + 1) +
              '</span><input type="text" maxlength="60" data-rel="' +
              i +
              '" data-k="name" value="' +
              esc(r.name) +
              '" />' +
              priceInput('data-rel="' + i + '" data-k="price"' + (r.sold ? ' disabled' : ''), r.price) +
              '<input type="number" min="1" data-rel="' +
              i +
              '" data-k="quantity" placeholder="Any" value="' +
              esc(r.quantity || '') +
              '" />' +
              (i === 0
                ? '<span class="small muted">' + (r.sold ? r.sold + ' sold' : 'First') + '</span>'
                : '<span class="opens"><span class="small muted">When ' + i + ' sells out, or</span><input type="datetime-local" data-rel="' + i + '" data-k="opens" value="' + esc(r.opens || '') + '" /></span>') +
              (p.releases.length > 2 && !r.sold ? '<button type="button" class="linkish" data-rel-remove="' + i + '" aria-label="Remove">✕</button>' : '<span></span>') +
              '</div>'
            );
          })
          .join('') +
        '<button type="button" class="btn small" id="tk-rel-add" style="margin-top: 8px">+ Add a release</button>' +
        '<p class="small muted" style="margin-top: 10px">Each release goes on sale when the one before sells out, or on its date if you set one (the one before then stops). Unsold places don’t carry over.</p>';
    }
    var oth =
      (p.others.length
        ? '<div class="oth-row hd"><span>Name</span><span>Price</span><span>Places</span><span>Code (optional)</span><span></span></div>' +
          p.others
            .map(function (o, i) {
              return (
                '<div class="oth-row"><input type="text" maxlength="60" data-oth="' +
                i +
                '" data-k="name" value="' +
                esc(o.name) +
                '" />' +
                priceInput('data-oth="' + i + '" data-k="price" placeholder="0 = free"' + (o.sold ? ' disabled' : ''), o.price) +
                '<input type="number" min="1" data-oth="' +
                i +
                '" data-k="quantity" placeholder="Any" value="' +
                esc(o.quantity || '') +
                '" /><input type="text" maxlength="20" data-oth="' +
                i +
                '" data-k="code" placeholder="Anyone can buy" value="' +
                esc(o.code || '') +
                '" style="text-transform: uppercase" />' +
                (o.sold ? '<span class="small muted">' + o.sold + ' sold</span>' : '<button type="button" class="linkish" data-oth-remove="' + i + '" aria-label="Remove">✕</button>') +
                '</div>'
              );
            })
            .join('')
        : '<p class="small muted">Add VIP, under-16s, a table for four, or a free guest-list ticket that needs a code.</p>') +
      '<button type="button" class="btn small" id="tk-oth-add" style="margin-top: 8px">+ Add a ticket type</button>' +
      '<div class="row" style="margin-top: 14px; align-items: center"><label class="field" style="margin: 0; flex: none"><span>Total places for the event</span><input type="number" min="1" data-f="capacity" placeholder="No limit" value="' +
      esc(p.capacity || '') +
      '" style="max-width: 140px" /></label><span class="small muted" style="flex: 1">Sales stop at this number whichever tickets sell.</span></div>';
    var who =
      '<div class="seg"><button type="button" class="' +
      (p.code ? '' : 'on') +
      '" data-who="all">Everyone</button><button type="button" class="' +
      (p.code ? 'on' : '') +
      '" data-who="code">Only with a code</button></div>' +
      (p.code !== '' || openSec.whoCode
        ? '<label class="field" style="margin-top: 10px"><span>The code</span><input type="text" maxlength="20" data-f="code" value="' + esc(p.code) + '" placeholder="e.g. CROWN" style="text-transform: uppercase; max-width: 220px" /></label><p class="small muted">People type it on the event page in the app to see this ticket.</p>'
        : '');
    var dates =
      '<div class="two"><label class="field"><span>Sales open</span><input type="datetime-local" data-f="salesStart" value="' +
      esc(p.salesStart) +
      '" /></label><label class="field"><span>Sales close</span><input type="datetime-local" data-f="salesEnd" value="' +
      esc(p.salesEnd) +
      '" /></label></div><p class="small muted">Leave empty: on sale now, until the event starts.</p>';
    var totalTypes = (p.releasesOn && !free ? 1 : 1) + p.others.length;
    return (
      '<div class="grid g2 tk-edit"><div class="card"><h3>What are you charging?</h3>' +
      choiceHtml(p.mode, 'data-mode') +
      top +
      (free ? '' : feeSeg(p.absorb, 'data-absorb')) +
      '<div class="lab" style="margin-top: 22px">More options</div>' +
      (free
        ? ''
        : section('releases', 'Sell in releases', 'Early bird, then a higher price when it sells out', p.releasesOn ? p.releases.length + ' releases' : 'Off', rel, { toggle: true, on: p.releasesOn })) +
      section('types', 'More ticket types', 'VIP, under 16s, a guest list with a code…', totalTypes === 1 ? '1 type' : totalTypes + ' types', oth) +
      (p.releasesOn && !free ? '' : section('who', 'Who can buy', 'Everyone, or only people with a code', p.code ? 'Code ' + esc(cleanCode(p.code)) : 'Everyone', who)) +
      section('dates', 'When sales open and close', 'Normally now until the event starts', p.salesStart || p.salesEnd ? esc((p.salesStart ? whenText(p.salesStart) : 'Now') + ' → ' + (p.salesEnd ? whenText(p.salesEnd) : 'start')) : 'Now → start', dates) +
      section('per', 'Per order', 'How many one person can buy at once', 'Up to ' + p.maxPer, '<label class="field"><span>Most per order</span><input type="number" min="1" max="50" data-f="maxPer" value="' + esc(p.maxPer) + '" style="max-width: 120px" /></label>') +
      section('desc', 'Description buyers see', 'e.g. Standing. Doors 7.30pm. Over 18s.', p.description ? 'Added' : 'None', '<label class="field"><span>Description</span><input type="text" maxlength="200" data-f="description" value="' + esc(p.description) + '" /></label>') +
      section('codes', 'Discount codes', 'Money off for friends, groups or last-minute', '<span class="tag plain">Coming soon</span>', '', { soon: true }) +
      section('wait', 'Waiting list', 'When it sells out, people can join', '<span class="tag plain">Coming soon</span>', '', { soon: true }) +
      section('qs', 'Questions for buyers', 'Dietary needs, names on tickets…', '<span class="tag plain">Coming soon</span>', '', { soon: true }) +
      '<button type="button" class="btn primary block" id="tk-save" style="margin-top: 16px">' +
      (firstTime ? (s.event_status === 'published' ? 'Put tickets on sale' : 'Save tickets') : 'Save changes') +
      '</button></div><div id="tk-receipt">' +
      receiptHtml(p, s) +
      '</div></div>'
    );
  }

  function ordersHtml(s) {
    return (
      '<div class="card"><h3>Orders</h3>' +
      ((s.orders || []).length
        ? '<div class="scroll-x"><table><tr><th>Who</th><th>Tickets</th><th class="r">Paid</th><th class="r">Status</th><th></th></tr>' +
          s.orders
            .map(function (o) {
              return (
                '<tr><td>' +
                esc(o.buyer || '') +
                '</td><td>' +
                esc(o.items || '') +
                '</td><td class="r">' +
                money(o.total_pence) +
                '</td><td class="r">' +
                (o.status === 'paid' ? '<span class="tag ok">paid</span>' : '<span class="tag warn">' + esc(o.status.replace('_', ' ')) + '</span>') +
                '</td><td class="r">' +
                (o.status === 'paid' ? '<button class="btn small" data-refund="' + esc(o.id) + '">Refund</button>' : '') +
                '</td></tr>'
              );
            })
            .join('') +
          '</table></div>'
        : '<p class="muted small">No orders yet.</p>') +
      '</div>'
    );
  }

  function sellingNotice(p, s) {
    if (!s.can_sell)
      return notice('info', 'Selling tickets through Dayli isn’t switched on for your account yet. You can set tickets up now; they go on sale once it is. <a href="#/payouts">More</a>');
    var paid = p.mode !== 'free' || p.others.some(function (o) {
      return o.price;
    });
    if (paid && !s.stripe_ready)
      return notice('info', 'Free tickets go on sale straight away; paid ones once you connect Stripe, so you can be paid. <a href="#/payouts">Connect Stripe</a>');
    if (s.event_status !== 'published') return notice('info', 'Tickets go on sale when you publish the event.');
    return '';
  }

  function eventScreen(id, query) {
    ctx.loading();
    Promise.all([eventTitle(id), rpc('organiser_ticket_sales', { p_event: id })])
      .then(function (r) {
        var ev = r[0];
        var s = r[1];
        var any = (s.types || []).some(function (t) {
          return !t.hidden;
        });
        if (!any && !(query && query.manual)) return wizard(id, ev, s);
        editor(id, ev, s, planFrom(s), !any);
      })
      .catch(function (err) {
        render(notice('error', esc(friendly(err))));
      });
  }

  function editor(id, ev, s, p, firstTime) {
    var tt = s.totals || {};
    render(
      '<div class="page-head"><div><div class="label">' +
      esc(ev.title) +
      '</div><h1>Tickets</h1></div><div class="controls"><a class="btn" href="#/checkin/' +
      esc(id) +
      '">Check in at the door</a><a class="btn" href="#/analytics/' +
      esc(id) +
      '?tab=tickets">Ticket numbers</a><button class="btn" id="tk-csv">Download orders</button></div></div>' +
      '<div id="tk-notice"></div>' +
      (firstTime
        ? ''
        : '<div class="grid g4">' +
          ctx.kpi('Tickets sold', String(tt.tickets || 0), '') +
          ctx.kpi('Checked in', String(tt.checked_in || 0), '') +
          ctx.kpi('Orders', String(tt.orders || 0), '') +
          ctx.kpi('Ticket money', money((tt.gross_pence || 0) - (tt.refunded_pence || 0)), '<span class="tag plain">after refunds</span>') +
          '</div>') +
      '<div id="tk-editor"></div>' +
      ordersHtml(s),
    );
    var draw = function () {
      $('#tk-notice').innerHTML = sellingNotice(p, s);
      $('#tk-editor').innerHTML = editorHtml(p, s, firstTime);
      bindEditor();
    };
    var receipt = function () {
      $('#tk-receipt').innerHTML = receiptHtml(p, s);
    };
    function bindEditor() {
      $$('[data-mode]').forEach(function (b) {
        b.onclick = function () {
          p.mode = b.dataset.mode;
          if (p.mode === 'free' && p.releasesOn) {
            p.main = p.releases[0];
            p.releasesOn = false;
          }
          draw();
        };
      });
      $$('[data-absorb]').forEach(function (b) {
        b.onclick = function () {
          p.absorb = b.dataset.absorb === '1';
          draw();
        };
      });
      $$('[data-sec]').forEach(function (b) {
        b.onclick = function (e) {
          var key = b.dataset.sec;
          if (key === 'releases' && (e.target.dataset.toggle || !p.releasesOn)) return toggleReleases();
          openSec[key] = !openSec[key];
          draw();
        };
      });
      $$('[data-who]').forEach(function (b) {
        b.onclick = function (e) {
          e.stopPropagation();
          openSec.whoCode = b.dataset.who === 'code';
          if (!openSec.whoCode) p.code = '';
          draw();
          var input = $('[data-f=code]');
          if (input) input.focus();
        };
      });
      var set = function (obj, key, el) {
        var v = el.value;
        if (key === 'price') obj.price = penceOf(v);
        else if (key === 'quantity') obj.quantity = countOf(v);
        else if (key === 'code') obj.code = cleanCode(v);
        else obj[key] = v;
      };
      $$('[data-f]').forEach(function (el) {
        el.oninput = function () {
          var k = el.dataset.f;
          if (k === 'price' || k === 'quantity') set(p.main, k, el);
          else if (k === 'capacity') p.capacity = countOf(el.value);
          else if (k === 'maxPer') p.maxPer = countOf(el.value);
          else if (k === 'code') p.code = cleanCode(el.value);
          else p[k] = el.value;
          receipt();
        };
      });
      $$('[data-rel]').forEach(function (el) {
        el.oninput = function () {
          set(p.releases[Number(el.dataset.rel)], el.dataset.k, el);
          receipt();
        };
      });
      $$('[data-oth]').forEach(function (el) {
        el.oninput = function () {
          set(p.others[Number(el.dataset.oth)], el.dataset.k, el);
          receipt();
        };
      });
      $$('[data-rel-remove]').forEach(function (b) {
        b.onclick = function () {
          p.releases.splice(Number(b.dataset.relRemove), 1);
          draw();
        };
      });
      $$('[data-oth-remove]').forEach(function (b) {
        b.onclick = function () {
          p.others.splice(Number(b.dataset.othRemove), 1);
          draw();
        };
      });
      var ra = $('#tk-rel-add');
      if (ra)
        ra.onclick = function () {
          p.releases.push({ id: null, name: p.releases.length === 2 ? 'Final release' : 'Next release', price: null, quantity: null, sold: 0, opens: '' });
          draw();
        };
      var oa = $('#tk-oth-add');
      if (oa)
        oa.onclick = function () {
          p.others.push({ id: null, name: '', price: null, quantity: null, sold: 0, code: '' });
          openSec.types = true;
          draw();
        };
      $('#tk-save').onclick = function () {
        var why = problem(p);
        if (why) return toast(why);
        var btn = $('#tk-save');
        ctx.setBusy(btn, true, 'Saving…');
        rpc('organiser_ticket_types_save', { p_event: id, p_types: toTypes(p), p_settings: { absorb_fee: p.absorb, capacity: p.capacity } }).then(
          function () {
            toast(firstTime ? 'Tickets set up' : 'Saved');
            eventScreen(id, { manual: '1' });
          },
          function (err) {
            ctx.setBusy(btn, false);
            var m = String((err && err.message) || '');
            toast(/bad_code/.test(m) ? 'Codes are 3 to 20 letters or numbers.' : friendly(err));
          },
        );
      };
    }
    function toggleReleases() {
      if (!p.releasesOn) {
        var m = p.main;
        p.releases = [
          { id: m.id, name: m.sold ? m.name : 'Early bird', price: m.price, quantity: m.quantity, sold: m.sold, opens: '' },
          { id: null, name: m.sold || m.name === 'General admission' ? 'Next release' : m.name, price: null, quantity: null, sold: 0, opens: '' },
        ];
        p.main = null;
        p.code = '';
        p.releasesOn = true;
        if (p.mode === 'pwyl') p.mode = 'paid';
      } else {
        if (p.releases.length > 1 && !confirm('Turn releases off? The first release stays as your ticket; the others become separate ticket types on sale at the same time.')) return;
        p.main = p.releases[0];
        p.others = p.releases.slice(1).concat(p.others);
        p.releases = [];
        p.releasesOn = false;
      }
      draw();
    }
    draw();
    bindOrders(id, s, ev);
  }

  function bindOrders(id, s, ev) {
    $$('[data-refund]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Refund this order in full? The buyer gets everything back, booking fee included, and their tickets stop working.')) return;
        ctx.setBusy(b, true, '…');
        invoke('ticket-refund', { order_id: b.dataset.refund }).then(
          function () {
            toast('Refunded');
            eventScreen(id, { manual: '1' });
          },
          function (err) {
            ctx.setBusy(b, false);
            toast(stripeError(err));
          },
        );
      };
    });
    $('#tk-csv').onclick = function () {
      var lines = [['Buyer', 'Tickets', 'Paid (£)', 'Refunded (£)', 'Status', 'Paid at']];
      (s.orders || []).forEach(function (o) {
        lines.push([o.buyer || '', o.items || '', (o.total_pence / 100).toFixed(2), (o.refunded_pence / 100).toFixed(2), o.status, o.paid_at || '']);
      });
      var text =
        '﻿' +
        lines
          .map(function (l) {
            return l
              .map(function (c) {
                c = String(c);
                return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
              })
              .join(',');
          })
          .join('\r\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      a.download = 'orders-' + (ev.title || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 500);
    };
  }

  // --- The setup steps -------------------------------------------------------------------------

  function wizard(id, ev, s) {
    var w = {
      at: 0,
      mode: 'paid',
      places: null,
      noLimit: false,
      kinds: 'one',
      price: null,
      absorb: false,
      early: false,
      ebPrice: null,
      ebQty: null,
      rows: [
        { name: 'Adult', price: null, quantity: null },
        { name: 'Child', price: null, quantity: null },
      ],
      code: false,
      codeName: 'Guest list',
      codeValue: '',
      end: false,
      endAt: '',
    };
    var steps = function () {
      var st = ['how', 'places'];
      if (w.mode === 'paid' && w.kinds === 'few') st.push('kinds');
      else if (w.mode !== 'free') st.push('price');
      if (w.mode === 'paid' && w.kinds === 'one') st.push('early');
      st.push('extras', 'check');
      return st;
    };
    var plan = function () {
      var p = blankPlan();
      p.mode = w.mode;
      p.absorb = w.absorb;
      var places = w.noLimit ? null : w.places;
      if (w.mode === 'free') p.main = { id: null, name: 'Free entry', price: 0, quantity: places, sold: 0 };
      else if (w.mode === 'pwyl') p.main = { id: null, name: 'Pay what you like', price: w.price, quantity: places, sold: 0 };
      else if (w.kinds === 'few') {
        var rows = w.rows.map(function (r) {
          return { id: null, name: r.name, price: r.price, quantity: r.quantity, sold: 0, code: '' };
        });
        p.main = rows.shift();
        p.others = rows;
        p.capacity = places;
      } else if (w.early) {
        p.releasesOn = true;
        p.main = null;
        p.releases = [
          { id: null, name: 'Early bird', price: w.ebPrice, quantity: w.ebQty, sold: 0, opens: '' },
          { id: null, name: 'Standard', price: w.price, quantity: places && w.ebQty ? Math.max(1, places - w.ebQty) : null, sold: 0, opens: '' },
        ];
      } else p.main = { id: null, name: 'General admission', price: w.price, quantity: places, sold: 0 };
      if (w.code) p.others.push({ id: null, name: w.codeName || 'Guest list', price: 0, quantity: null, sold: 0, code: cleanCode(w.codeValue) });
      if (w.end) p.salesEnd = w.endAt;
      return p;
    };
    var opt = function (attr, val, on, title, sub, box) {
      return '<button type="button" class="wopt' + (on ? ' on' : '') + '" ' + attr + '="' + val + '"><span><b>' + title + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</span><i class="' + (box ? 'box' : 'rad') + '"></i></button>';
    };
    var screens = {
      how: function () {
        return (
          '<div class="q">How will people get in?</div><p class="h">You can change this until the first ticket sells.</p>' +
          opt('data-w-mode', 'free', w.mode === 'free', 'Free', 'People book a place, so you know who’s coming') +
          opt('data-w-mode', 'paid', w.mode === 'paid', 'Paid', 'One price, or a few different tickets') +
          opt('data-w-mode', 'pwyl', w.mode === 'pwyl', 'Pay what you like', 'You set the lowest price; people can pay more')
        );
      },
      places: function () {
        return (
          '<div class="q">How many people can come?</div><p class="h">The most you can fit. Sales stop when it’s full.</p>' +
          '<input type="number" min="1" class="bigin" data-w="places" placeholder="e.g. 200" value="' +
          esc(w.noLimit ? '' : w.places || '') +
          '"' +
          (w.noLimit ? ' disabled' : '') +
          ' />' +
          opt('data-w-nolimit', '1', w.noLimit, 'No limit', 'Keep selling until sales close', true) +
          (w.mode === 'paid'
            ? '<div class="lab" style="margin-top: 18px">Is there more than one kind of ticket?</div>' +
              opt('data-w-kinds', 'one', w.kinds === 'one', 'Just one', 'Everyone pays the same') +
              opt('data-w-kinds', 'few', w.kinds === 'few', 'A few kinds', 'e.g. adult and child, standard and VIP')
            : '')
        );
      },
      price: function () {
        var p = plan();
        return (
          '<div class="q">' +
          (w.mode === 'pwyl' ? 'What’s the lowest price?' : 'What does a ticket cost?') +
          '</div><p class="h">' +
          (w.mode === 'pwyl' ? 'People can pay this or more. £0 lets them come for free if they want.' : 'The price you want to get for each ticket.') +
          '</p>' +
          priceInput('class="bigin" data-w="price"', w.price) +
          feeSeg(w.absorb, 'data-w-absorb') +
          '<div id="w-receipt">' +
          receiptHtml(p, s) +
          '</div>'
        );
      },
      kinds: function () {
        return (
          '<div class="q">Your tickets</div><p class="h">A name and price for each kind. Leave places empty to share the total.</p>' +
          '<div class="oth-row hd w3"><span>Name</span><span>Price</span><span>Places</span><span></span></div>' +
          w.rows
            .map(function (r, i) {
              return (
                '<div class="oth-row w3"><input type="text" maxlength="60" data-w-row="' +
                i +
                '" data-k="name" value="' +
                esc(r.name) +
                '" />' +
                priceInput('data-w-row="' + i + '" data-k="price" placeholder="0 = free"', r.price) +
                '<input type="number" min="1" data-w-row="' +
                i +
                '" data-k="quantity" placeholder="Any" value="' +
                esc(r.quantity || '') +
                '" />' +
                (w.rows.length > 2 ? '<button type="button" class="linkish" data-w-row-remove="' + i + '" aria-label="Remove">✕</button>' : '<span></span>') +
                '</div>'
              );
            })
            .join('') +
          '<button type="button" class="btn small" id="w-row-add" style="margin-top: 6px">+ Add another kind</button>' +
          feeSeg(w.absorb, 'data-w-absorb')
        );
      },
      early: function () {
        var places = w.noLimit ? null : w.places;
        return (
          '<div class="q">Want an early bird price?</div><p class="h">A cheaper first batch gets people buying early. The price goes up by itself when they’ve gone.</p>' +
          opt('data-w-early', '1', w.early, 'Yes, start cheaper') +
          (w.early
            ? '<div class="two" style="margin: 4px 0 10px"><label class="field"><span>Early bird price</span>' +
              priceInput('class="bigin" data-w="ebPrice"', w.ebPrice) +
              '</label><label class="field"><span>How many</span><input type="number" min="1" class="bigin" data-w="ebQty" value="' +
              esc(w.ebQty || '') +
              '" /></label></div><div id="w-early-sum">' +
              earlySum(places) +
              '</div><p class="small muted">You can add more steps (a final release, say) on the next screen.</p>'
            : '') +
          opt('data-w-early', '0', !w.early, 'No, one price')
        );
      },
      extras: function () {
        return (
          '<div class="q">Anything else?</div><p class="h">Tick what you want. You can add these later too.</p>' +
          opt('data-w-extra', 'code', w.code, 'A ticket that needs a code', 'Free, for crew, friends or a guest list', true) +
          (w.code
            ? '<div class="two" style="margin: 0 0 10px"><label class="field"><span>Ticket name</span><input type="text" maxlength="60" data-w="codeName" value="' +
              esc(w.codeName) +
              '" /></label><label class="field"><span>The code</span><input type="text" maxlength="20" data-w="codeValue" placeholder="e.g. CROWN" value="' +
              esc(w.codeValue) +
              '" style="text-transform: uppercase" /></label></div>'
            : '') +
          opt('data-w-extra', 'end', w.end, 'A different end to sales', 'Normally when the event starts', true) +
          (w.end ? '<label class="field" style="margin: 0 0 10px"><span>Sales close</span><input type="datetime-local" data-w="endAt" value="' + esc(w.endAt) + '" /></label>' : '') +
          '<button type="button" class="wopt soon" disabled><span><b>Discount codes</b><span>Coming soon</span></span></button>' +
          '<button type="button" class="wopt soon" disabled><span><b>A waiting list</b><span>Coming soon</span></span></button>' +
          '<button type="button" class="wopt soon" disabled><span><b>Questions for buyers</b><span>Coming soon</span></span></button>'
        );
      },
      check: function () {
        var p = plan();
        var st = steps();
        var go = function (k) {
          return '<button type="button" class="linkish small" data-w-go="' + st.indexOf(k) + '">Change</button>';
        };
        var rows = [];
        var places = w.noLimit ? 'No limit' : String(w.places);
        rows.push(['Places', places, go('places')]);
        if (p.releasesOn)
          p.releases.forEach(function (r) {
            rows.push([esc(r.name) + (r.quantity ? ' · ' + r.quantity : ''), money(r.price), go('early')]);
          });
        else if (w.mode === 'paid' && w.kinds === 'few')
          [p.main].concat(p.others.filter(function (o) {
            return !o.code;
          })).forEach(function (r) {
            rows.push([esc(r.name) + (r.quantity ? ' · ' + r.quantity : ''), r.price ? money(r.price) : 'Free', go('kinds')]);
          });
        else rows.push([esc(p.main.name), w.mode === 'free' ? 'Free' : (w.mode === 'pwyl' ? 'From ' : '') + money(p.main.price), go(w.mode === 'free' ? 'how' : 'price')]);
        if (w.code) rows.push([esc(w.codeName || 'Guest list'), 'Code ' + esc(cleanCode(w.codeValue)), go('extras')]);
        if (w.mode !== 'free') rows.push(['Booking fee', w.absorb ? 'You pay it' : 'Buyer pays', go(w.kinds === 'few' && w.mode === 'paid' ? 'kinds' : 'price')]);
        rows.push(['Sales close', w.end && w.endAt ? esc(whenText(w.endAt)) : 'When it starts', go('extras')]);
        var all = ifAllSell(p, s);
        return (
          '<div class="q">Your tickets</div><p class="h">' +
          esc(ev.title) +
          '</p><div class="wsum">' +
          rows
            .map(function (r) {
              return '<div><span>' + r[0] + '</span><b>' + r[1] + ' ' + r[2] + '</b></div>';
            })
            .join('') +
          '</div>' +
          (w.mode !== 'free' && all.places && !all.open ? '<div class="row between" style="margin-top: 12px"><span>If it all sells you get</span><b style="font-size: 20px">' + moneyRound(all.total) + '</b></div>' : '') +
          '<p class="small muted" style="margin-top: 8px">Buyers get tickets on the event page in the Dayli app. You can change anything afterwards on the Tickets screen.</p>' +
          sellingNotice(p, s)
        );
      },
    };
    function earlySum(places) {
      var later = places && w.ebQty ? Math.max(0, places - w.ebQty) : null;
      return (
        '<div class="wrel"><span class="n">1</span><b>Early bird' + (w.ebQty ? ' · ' + w.ebQty : '') + '</b><span>' + (w.ebPrice ? money(w.ebPrice) : '—') + '</span></div>' +
        '<div class="wrel"><span class="n">2</span><b>Then ' + (later ? 'the other ' + later : 'the rest') + '</b><span>' + (w.price ? money(w.price) : '—') + '</span></div>'
      );
    }
    function check(key) {
      var bad = function (x) {
        return x === null || (typeof x === 'number' && isNaN(x));
      };
      if (key === 'places' && !w.noLimit && bad(w.places)) return 'Enter how many people can come, or pick No limit.';
      if (key === 'price') {
        if (bad(w.price)) return 'Enter a price.';
        if (w.mode === 'paid' && w.price < 50) return 'A paid ticket must be at least 50p.';
        if (w.mode === 'pwyl' && w.price > 0 && w.price < 50) return 'The lowest price must be £0 or at least 50p.';
      }
      if (key === 'kinds') {
        for (var i = 0; i < w.rows.length; i++) {
          var r = w.rows[i];
          if (!String(r.name || '').trim()) return 'Give every kind of ticket a name.';
          if (bad(r.price)) return 'Enter a price for ' + r.name + ' (0 for free).';
          if (r.price > 0 && r.price < 50) return 'A paid ticket must be at least 50p (' + r.name + ').';
          if (typeof r.quantity === 'number' && isNaN(r.quantity)) return 'Places must be a whole number (' + r.name + ').';
        }
      }
      if (key === 'early' && w.early) {
        if (bad(w.ebPrice) || w.ebPrice < 50) return 'The early bird price must be at least 50p.';
        if (bad(w.ebQty)) return 'Enter how many early bird tickets.';
        if (!w.noLimit && w.places && w.ebQty >= w.places) return 'Leave some places for after the early bird.';
      }
      if (key === 'extras') {
        if (w.code && !/^[A-Z0-9]{3,20}$/.test(cleanCode(w.codeValue))) return 'The code is 3 to 20 letters or numbers.';
        if (w.end && !w.endAt) return 'Pick when sales close, or untick it.';
      }
      return null;
    }
    function draw() {
      var st = steps();
      if (w.at >= st.length) w.at = st.length - 1;
      var key = st[w.at];
      var last = key === 'check';
      render(
        '<div class="wiz"><div class="row between small muted"><button type="button" class="linkish" id="w-back">' +
          (w.at ? '‹ Back' : '‹ ' + esc(ev.title)) +
          '</button><span>Step ' +
          (w.at + 1) +
          ' of ' +
          st.length +
          '</span></div><div class="wdots">' +
          st
            .map(function (x, i) {
              return '<i class="' + (i <= w.at ? 'on' : '') + '"></i>';
            })
            .join('') +
          '</div>' +
          screens[key]() +
          '<button type="button" class="btn primary block" id="w-next" style="margin-top: 18px">' +
          (last ? (s.event_status === 'published' ? 'Put tickets on sale' : 'Save tickets') : 'Continue') +
          '</button>' +
          (w.at === 0 ? '<button type="button" class="linkish block small" id="w-manual" style="margin-top: 12px">Set it up myself instead</button>' : '') +
          '</div>',
      );
      bindWizard(key);
    }
    function bindWizard(key) {
      var redraw = function () {
        draw();
      };
      $('#w-back').onclick = function () {
        if (w.at) {
          w.at -= 1;
          draw();
        } else ctx.go ? ctx.go('#/payouts') : history.back();
      };
      var manual = $('#w-manual');
      if (manual)
        manual.onclick = function () {
          editor(id, ev, s, blankPlan(), true);
        };
      $$('[data-w-mode]').forEach(function (b) {
        b.onclick = function () {
          w.mode = b.dataset.wMode;
          redraw();
        };
      });
      $$('[data-w-kinds]').forEach(function (b) {
        b.onclick = function () {
          w.kinds = b.dataset.wKinds;
          redraw();
        };
      });
      $$('[data-w-nolimit]').forEach(function (b) {
        b.onclick = function () {
          w.noLimit = !w.noLimit;
          redraw();
        };
      });
      $$('[data-w-absorb]').forEach(function (b) {
        b.onclick = function () {
          w.absorb = b.dataset.wAbsorb === '1';
          redraw();
        };
      });
      $$('[data-w-early]').forEach(function (b) {
        b.onclick = function () {
          w.early = b.dataset.wEarly === '1';
          redraw();
        };
      });
      $$('[data-w-extra]').forEach(function (b) {
        b.onclick = function () {
          w[b.dataset.wExtra] = !w[b.dataset.wExtra];
          redraw();
        };
      });
      $$('[data-w-go]').forEach(function (b) {
        b.onclick = function () {
          w.at = Math.max(0, Number(b.dataset.wGo));
          redraw();
        };
      });
      $$('[data-w]').forEach(function (el) {
        el.oninput = function () {
          var k = el.dataset.w;
          if (k === 'price' || k === 'ebPrice') w[k] = penceOf(el.value);
          else if (k === 'places' || k === 'ebQty') w[k] = countOf(el.value);
          else w[k] = el.value;
          var r = $('#w-receipt');
          if (r) r.innerHTML = receiptHtml(plan(), s);
          var e = $('#w-early-sum');
          if (e) e.innerHTML = earlySum(w.noLimit ? null : w.places);
        };
      });
      $$('[data-w-row]').forEach(function (el) {
        el.oninput = function () {
          var r = w.rows[Number(el.dataset.wRow)];
          var k = el.dataset.k;
          if (k === 'price') r.price = penceOf(el.value);
          else if (k === 'quantity') r.quantity = countOf(el.value);
          else r.name = el.value;
        };
      });
      $$('[data-w-row-remove]').forEach(function (b) {
        b.onclick = function () {
          w.rows.splice(Number(b.dataset.wRowRemove), 1);
          redraw();
        };
      });
      var add = $('#w-row-add');
      if (add)
        add.onclick = function () {
          w.rows.push({ name: '', price: null, quantity: null });
          redraw();
        };
      $('#w-next').onclick = function () {
        var why = check(key);
        if (why) return toast(why);
        if (key !== 'check') {
          w.at += 1;
          return draw();
        }
        var p = plan();
        var problemText = problem(p);
        if (problemText) return toast(problemText);
        var btn = $('#w-next');
        ctx.setBusy(btn, true, 'Saving…');
        rpc('organiser_ticket_types_save', { p_event: id, p_types: toTypes(p), p_settings: { absorb_fee: p.absorb, capacity: p.capacity } }).then(
          function () {
            toast(s.event_status === 'published' && s.can_sell ? 'Tickets are on sale' : 'Tickets saved');
            eventScreen(id, { manual: '1' });
          },
          function (err) {
            ctx.setBusy(btn, false);
            toast(friendly(err));
          },
        );
      };
    }
    draw();
  }

  // --- Check-in at the door ------------------------------------------------------------------------

  var stream = null;
  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      stream = null;
    }
  }

  function checkin(id) {
    stopCamera();
    eventTitle(id).then(function (ev) {
      render(
        '<div class="page-head"><div><h1>Check in</h1><p class="muted">' +
          esc(ev.title) +
          '</p></div><div class="controls"><a class="btn" href="#/tickets/' +
          esc(id) +
          '">Back to tickets</a></div></div>' +
          '<div class="card"><div id="ci-result" class="ci-result">Scan a ticket’s code, or type it.</div>' +
          '<form id="ci-form" class="row" style="margin-top: 12px"><input type="text" name="code" placeholder="Ticket code" autocomplete="off" autocapitalize="characters" style="flex: 1; letter-spacing: 2px" /><button class="btn primary" type="submit">Check</button></form>' +
          '<button class="btn block" id="ci-camera" style="margin-top: 12px">Scan with the camera</button>' +
          '<video id="ci-video" playsinline muted style="width: 100%; border-radius: 14px; margin-top: 12px; display: none"></video></div>',
      );
      var busy = false;
      var last = '';
      function show(r, code) {
        var box = $('#ci-result');
        var who = r.name ? esc(r.name) + (r.type ? ' · ' + esc(r.type) : '') : '';
        var map = {
          ok: ['ok', '✓ Valid — welcome in', who],
          used: ['bad', 'Already checked in', who + (r.at ? ' · at ' + new Date(r.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')],
          refunded: ['bad', 'Refunded — not valid', who],
          wrong_event: ['bad', 'This ticket is for another event', ''],
          not_found: ['bad', 'No ticket with that code', esc(code)],
        };
        var m = map[r.result] || ['bad', 'Couldn’t check that', ''];
        box.className = 'ci-result ' + m[0];
        box.innerHTML = '<b>' + m[1] + '</b>' + (m[2] ? '<div class="small">' + m[2] + '</div>' : '');
        if (navigator.vibrate) navigator.vibrate(m[0] === 'ok' ? 80 : [60, 60, 60]);
      }
      function check(code) {
        code = String(code || '').trim().toUpperCase();
        if (!code || busy) return;
        busy = true;
        rpc('organiser_check_in', { p_event: id, p_code: code })
          .then(function (r) {
            show(r, code);
          })
          .catch(function (err) {
            toast(friendly(err));
          })
          .then(function () {
            busy = false;
          });
      }
      $('#ci-form').onsubmit = function (e) {
        e.preventDefault();
        check(this.code.value);
        this.code.value = '';
      };
      $('#ci-camera').onclick = function () {
        var video = $('#ci-video');
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: 'environment' } })
          .then(function (s) {
            stream = s;
            video.srcObject = s;
            video.style.display = 'block';
            return video.play();
          })
          .then(function () {
            return 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : loadJsQr();
          })
          .then(function (detector) {
            var canvas = document.createElement('canvas');
            var g = canvas.getContext('2d', { willReadFrequently: true });
            function tick() {
              if (!stream || !document.getElementById('ci-video')) return stopCamera();
              var found;
              if (detector && detector.detect) {
                found = detector.detect(video).then(function (codes) {
                  return codes[0] && codes[0].rawValue;
                });
              } else {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                g.drawImage(video, 0, 0);
                var img = g.getImageData(0, 0, canvas.width, canvas.height);
                var r = window.jsQR(img.data, img.width, img.height);
                found = Promise.resolve(r && r.data);
              }
              found.then(function (code) {
                // The same code in front of the camera counts once.
                if (code && code !== last) {
                  last = code;
                  check(code);
                  setTimeout(function () {
                    last = '';
                  }, 3000);
                }
                setTimeout(tick, 250);
              });
            }
            tick();
          })
          .catch(function () {
            toast('The camera isn’t available. Type the code instead.');
          });
      };
    });
  }
  function loadJsQr() {
    if (window.jsQR) return Promise.resolve(null);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'vendor/jsQR.js';
      s.onload = function () {
        resolve(null);
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // --- Admin: who may sell, the fee, the takings ---------------------------------------------------

  function adminMount(el) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    rpc('admin_tickets', {})
      .then(function (d) {
        var t = d.totals || {};
        el.innerHTML =
          '<div class="grid g4">' +
          ctx.kpi('Orders', String(t.orders || 0), '') +
          ctx.kpi('Ticket sales', pounds(t.gross_pence), '<span class="tag plain">to organisers</span>') +
          ctx.kpi('Booking fees', pounds(t.fees_pence), '<span class="tag plain">Dayli’s, before Stripe’s fee</span>') +
          ctx.kpi('Fees this month', pounds(t.this_month_fees_pence), '') +
          '</div>' +
          '<div class="card"><h3>Booking fee</h3><p class="sub">Added on top of each paid order. Stripe’s card fee (about 1.5% + 20p) comes out of it.</p><form id="tk-fee" class="row"><label class="field" style="margin: 0"><span>Percent</span><input type="number" name="pct" step="0.1" min="0" max="50" value="' +
          esc(String(d.fee_percent)) +
          '" style="max-width: 120px" /></label><label class="field" style="margin: 0"><span>Plus (pence)</span><input type="number" name="fixed" min="0" max="1000" value="' +
          esc(String(d.fee_fixed_pence)) +
          '" style="max-width: 120px" /></label><button class="btn primary" type="submit" style="align-self: flex-end">Save</button></form></div>' +
          '<div class="card"><div class="row between"><div><h3>Selling tickets is ' +
          (d.open_to_all ? '<span class="tag ok">open to every organiser</span>' : '<span class="tag plain">by invitation</span>') +
          '</h3><p class="sub">' +
          (d.open_to_all
            ? 'Any organiser can set up tickets: free ones straight away, paid ones once they connect Stripe. You can still stop one below.'
            : 'Only organisers you let sell can set up tickets. New organisers wait for you.') +
          '</p></div><button type="button" class="btn" id="tk-open">' +
          (d.open_to_all ? 'Make it invitation only' : 'Open to every organiser') +
          '</button></div></div>' +
          '<div class="card"><h3>Who can sell tickets</h3><p class="sub">' +
          (d.open_to_all ? 'Everyone can, unless you stop them here.' : 'Switch it on for organisers you trust; they then connect Stripe from Tickets & payouts.') +
          '</p>' +
          ((d.organisers || []).length
            ? '<div class="scroll-x"><table><tr><th>Organiser</th><th class="r">Events</th><th class="r">Tickets sold</th><th class="r">Stripe</th><th></th></tr>' +
              d.organisers
                .map(function (o) {
                  return (
                    '<tr><td>' +
                    esc(o.name) +
                    '</td><td class="r">' +
                    esc(String(o.events)) +
                    '</td><td class="r">' +
                    esc(String(o.tickets_sold)) +
                    '</td><td class="r">' +
                    (o.stripe_ready ? '<span class="tag ok">ready</span>' : o.stripe_connected ? '<span class="tag warn">unfinished</span>' : '—') +
                    '</td><td class="r"><button class="btn small ' +
                    (o.can_sell ? '' : 'primary') +
                    '" data-sell="' +
                    esc(o.id) +
                    '" data-on="' +
                    (o.can_sell ? '0' : '1') +
                    '">' +
                    (o.can_sell ? 'Stop selling' : 'Let them sell') +
                    '</button></td></tr>'
                  );
                })
                .join('') +
              '</table></div>'
            : '<p class="muted small">No organisers yet.</p>') +
          '</div>';
        el.querySelector('#tk-open').onclick = function () {
          var open = !d.open_to_all;
          if (!confirm(open ? 'Open ticket selling to every organiser? Everyone you haven’t stopped can sell straight away.' : 'Make ticket selling invitation only? Organisers who can sell now keep it; new ones wait for you.')) return;
          rpc('admin_ticket_open_save', { p_open: open }).then(
            function () {
              toast(open ? 'Open to every organiser' : 'Invitation only');
              adminMount(el);
            },
            function (err) {
              toast(friendly(err));
            },
          );
        };
        el.querySelector('#tk-fee').onsubmit = function (e) {
          e.preventDefault();
          rpc('admin_ticket_fee_save', { p_percent: Number(this.pct.value), p_fixed_pence: Number(this.fixed.value) }).then(
            function () {
              toast('Fee saved');
              adminMount(el);
            },
            function (err) {
              toast(friendly(err));
            },
          );
        };
        Array.prototype.forEach.call(el.querySelectorAll('[data-sell]'), function (b) {
          b.onclick = function () {
            rpc('admin_ticket_seller', { p_organiser: b.dataset.sell, p_can_sell: b.dataset.on === '1' }).then(
              function () {
                adminMount(el);
              },
              function (err) {
                toast(friendly(err));
              },
            );
          };
        });
      })
      .catch(function (err) {
        el.innerHTML = notice('error', esc(friendly(err)));
      });
  }

  /** Cancelling an event: refund every order (no-op when nothing was sold). */
  function refundAll(eventId) {
    return invoke('ticket-refund', { event_id: eventId, all: true }).catch(function () {
      return null;
    });
  }

  return {
    payouts: payouts,
    eventScreen: eventScreen,
    checkin: checkin,
    stopCamera: stopCamera,
    adminMount: adminMount,
    refundAll: refundAll,
  };
};
