/* Dayli for organisers: selling tickets through Dayli. Plain browser
 * JavaScript, no build.
 *   #/payouts           connect Stripe (where ticket money is paid), and each event's tickets
 *   #/tickets/<event>   ticket types, sales, orders and refunds for one event
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
            '<h3>Selling tickets through Dayli</h3><p class="sub">This is by invitation while it’s new. Email <a href="mailto:hello@daylicalendar.co.uk">hello@daylicalendar.co.uk</a> and we’ll switch it on for you. Until then, keep using your own ticket link on each event.</p>';
        } else if (!o.stripe_account_id) {
          status =
            '<h3>Connect Stripe to get paid</h3><p class="sub">Ticket money goes straight to your own Stripe account, and Stripe pays it into your bank. Setting up takes about five minutes: your details, your bank account, and a check of who you are.</p><button class="btn primary" id="tk-connect">Connect with Stripe</button>';
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
            ' is added on top of each order, so you receive the full ticket price. Buyers get a ticket with a code for the door; you check them in from your phone. You can refund any order, and cancelling an event refunds everyone.</p></div>' +
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

  function typeRow(t) {
    t = t || {};
    var end = t.sales_end ? new Date(t.sales_end) : null;
    var endLocal = end ? new Date(end.getTime() - end.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    return (
      '<div class="tk-type card" data-id="' +
      esc(t.id || '') +
      '" style="padding: 14px; margin: 10px 0"><div class="two"><label class="field"><span>Ticket name</span><input type="text" name="name" maxlength="60" placeholder="General admission" value="' +
      esc(t.name || '') +
      '" /></label><label class="field"><span>Price (£, 0 for free)</span><input type="number" name="price" min="0" step="0.01" value="' +
      esc(t.price_pence != null ? (t.price_pence / 100).toFixed(2) : '') +
      '"' +
      (t.sold ? ' disabled title="Already sold at this price"' : '') +
      ' /></label></div><div class="three"><label class="field"><span>How many (empty = no limit)</span><input type="number" name="quantity" min="1" value="' +
      esc(t.quantity || '') +
      '" /></label><label class="field"><span>Sales end</span><input type="datetime-local" name="sales_end" value="' +
      esc(endLocal) +
      '" /></label><label class="field"><span>Most per order</span><input type="number" name="max" min="1" max="50" value="' +
      esc(t.max_per_order || 10) +
      '" /></label></div><label class="field"><span>Description (optional)</span><input type="text" name="description" maxlength="200" value="' +
      esc(t.description || '') +
      '" /></label><div class="row between"><span class="muted small">' +
      (t.id ? esc(String(t.sold || 0)) + ' sold' + (t.quantity ? ' of ' + esc(String(t.quantity)) : '') : 'New') +
      '</span><button type="button" class="linkish small" data-remove>Remove</button></div></div>'
    );
  }

  function eventScreen(id) {
    ctx.loading();
    Promise.all([eventTitle(id), rpc('organiser_ticket_sales', { p_event: id })])
      .then(function (r) {
        var ev = r[0];
        var s = r[1];
        var ready = s.can_sell && s.stripe_ready;
        var tt = s.totals || {};
        render(
          '<div class="page-head"><div><h1>Tickets</h1><p class="muted">' +
            esc(ev.title) +
            '</p></div><div class="controls"><a class="btn" href="#/checkin/' +
            esc(id) +
            '">Check in at the door</a><button class="btn" id="tk-csv">Download orders</button></div></div>' +
            (!ready
              ? notice(
                  'info',
                  !s.can_sell
                    ? 'Selling tickets through Dayli isn’t switched on for your account yet. You can set up ticket types now; they go on sale once it is. <a href="#/payouts">More</a>'
                    : 'Connect Stripe so you can be paid, then these tickets go on sale. <a href="#/payouts">Connect Stripe</a>',
                )
              : '') +
            '<div class="grid g4">' +
            ctx.kpi('Tickets sold', String(tt.tickets || 0), '') +
            ctx.kpi('Checked in', String(tt.checked_in || 0), '') +
            ctx.kpi('Orders', String(tt.orders || 0), '') +
            ctx.kpi('Ticket money', pounds((tt.gross_pence || 0) - (tt.refunded_pence || 0)), '<span class="tag plain">after refunds</span>') +
            '</div>' +
            '<div class="card"><h3>Ticket types</h3><p class="sub">Buyers pay a booking fee of ' +
            esc(fee(s)) +
            ' on top, so you receive the full price. A price can’t change once tickets are sold at it.</p><form id="tk-types">' +
            ((s.types || []).filter(function (t) {
              return !t.hidden;
            }).length
              ? s.types
                  .filter(function (t) {
                    return !t.hidden;
                  })
                  .map(typeRow)
                  .join('')
              : typeRow({ name: 'General admission', max_per_order: 10 })) +
            '<div class="row" style="margin-top: 10px"><button type="button" class="btn" id="tk-add">+ Add a ticket type</button><button class="btn primary" type="submit">Save tickets</button></div></form></div>' +
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
                      pounds(o.total_pence) +
                      '</td><td class="r">' +
                      (o.status === 'paid'
                        ? '<span class="tag ok">paid</span>'
                        : '<span class="tag warn">' + esc(o.status.replace('_', ' ')) + '</span>') +
                      '</td><td class="r">' +
                      (o.status === 'paid' ? '<button class="btn small" data-refund="' + esc(o.id) + '">Refund</button>' : '') +
                      '</td></tr>'
                    );
                  })
                  .join('') +
                '</table></div>'
              : '<p class="muted small">No orders yet.</p>') +
            '</div>',
        );
        bindEvent(id, s, ev);
      })
      .catch(function (err) {
        render(notice('error', esc(friendly(err))));
      });
  }

  function bindEvent(id, s, ev) {
    var form = $('#tk-types');
    $('#tk-add').onclick = function () {
      form.querySelector('.row').insertAdjacentHTML('beforebegin', typeRow({ max_per_order: 10 }));
      bindRemove();
    };
    function bindRemove() {
      $$('[data-remove]').forEach(function (b) {
        b.onclick = function () {
          b.closest('.tk-type').remove();
        };
      });
    }
    bindRemove();
    form.onsubmit = function (e) {
      e.preventDefault();
      var types = [];
      var bad = null;
      $$('.tk-type').forEach(function (row) {
        var v = function (n) {
          return row.querySelector('[name=' + n + ']').value.trim();
        };
        if (!v('name')) return;
        var price = Math.round(parseFloat(v('price') || '0') * 100);
        if (isNaN(price) || (price > 0 && price < 50)) bad = 'A paid ticket must be at least 50p.';
        types.push({
          id: row.dataset.id || null,
          name: v('name'),
          price_pence: price,
          quantity: v('quantity') ? parseInt(v('quantity'), 10) : null,
          sales_end: v('sales_end') ? new Date(v('sales_end')).toISOString() : null,
          max_per_order: parseInt(v('max') || '10', 10),
          description: v('description'),
        });
      });
      if (bad) return toast(bad);
      var btn = form.querySelector('button[type=submit]');
      ctx.setBusy(btn, true, 'Saving…');
      rpc('organiser_ticket_types_save', { p_event: id, p_types: types }).then(
        function () {
          toast('Tickets saved');
          eventScreen(id);
        },
        function (err) {
          ctx.setBusy(btn, false);
          toast(friendly(err));
        },
      );
    };
    $$('[data-refund]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Refund this order in full? The buyer gets everything back, booking fee included, and their tickets stop working.')) return;
        ctx.setBusy(b, true, '…');
        invoke('ticket-refund', { order_id: b.dataset.refund }).then(
          function () {
            toast('Refunded');
            eventScreen(id);
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
          '<div class="card"><h3>Who can sell tickets</h3><p class="sub">Switch it on for organisers you trust; they then connect Stripe from Tickets & payouts.</p>' +
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
