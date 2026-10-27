/* Public event page. Reads ?s=<slug> (or the last path segment), calls the
 * public_event_by_slug(slug) RPC with the anon key and fills the template in
 * index.html. Plain browser JavaScript, no build. */
(function () {
  var cfg = window.DAYLI_CONFIG || {};
  var params = new URLSearchParams(location.search);
  var slug = params.get('s') || location.pathname.split('/').filter(Boolean).pop() || '';
  if (slug === 'e' || slug === 'index.html') slug = '';
  slug = slug.toLowerCase().trim();

  function el(id) {
    return document.getElementById(id);
  }
  function show(id, on) {
    el(id).hidden = !on;
  }
  function text(id, value) {
    el(id).textContent = value;
  }
  function setMeta(property, content) {
    var m = document.querySelector('meta[property="' + property + '"]');
    if (m) m.setAttribute('content', content || '');
  }
  function toast(message) {
    var t = el('toast');
    t.textContent = message;
    t.classList.add('on');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      t.classList.remove('on');
    }, 2200);
  }

  function fmt(date, opts, tz) {
    try {
      opts.timeZone = tz || undefined;
      return new Intl.DateTimeFormat('en-GB', opts).format(date);
    } catch (e) {
      delete opts.timeZone;
      return new Intl.DateTimeFormat('en-GB', opts).format(date);
    }
  }
  function fmtWhen(ev, long) {
    var start = new Date(ev.starts_at);
    var end = new Date(ev.ends_at);
    var tz = ev.timezone;
    var dateOpts = long
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : { weekday: 'short', day: 'numeric', month: 'short' };
    var timeOpts = { hour: '2-digit', minute: '2-digit', hour12: false };
    var day = fmt(start, dateOpts, tz);
    var endDay = fmt(end, dateOpts, tz);
    var from = fmt(start, timeOpts, tz);
    var to = fmt(end, timeOpts, tz);
    if (day === endDay) return day + ' · ' + from + '–' + to;
    return day + ', ' + from + ' – ' + endDay + ', ' + to;
  }
  function fmtPrice(ev) {
    if (ev.is_free || ev.price_from_pence == null) return 'Free';
    var amount = ev.price_from_pence / 100;
    try {
      return (
        'From ' +
        new Intl.NumberFormat('en-GB', {
          style: 'currency',
          currency: ev.currency || 'GBP',
        }).format(amount)
      );
    } catch (e) {
      return 'From ' + amount.toFixed(2) + ' ' + (ev.currency || 'GBP');
    }
  }
  function link(href, label) {
    var a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label;
    return a;
  }
  function websiteHref(url) {
    return /^https?:\/\//i.test(url) ? url : 'https://' + url;
  }

  function render(ev) {
    show('loading', false);
    if (!ev || !ev.id) {
      show('missing', true);
      document.title = 'Event not available · Dayli';
      return;
    }
    document.title = ev.title + ' · Dayli';
    setMeta('og:title', ev.title);
    setMeta(
      'og:description',
      fmtWhen(ev, false) + (ev.venue_name ? ' · ' + ev.venue_name : '') + ' · ' + fmtPrice(ev),
    );

    var hero = el('hero');
    if (ev.cover_image_path) {
      var img = cfg.supabaseUrl + '/storage/v1/object/public/hero/' + ev.cover_image_path;
      hero.style.backgroundImage = 'url("' + img + '")';
      setMeta('og:image', img);
    } else {
      hero.textContent = (ev.title || '?').trim().charAt(0).toUpperCase();
    }
    show('cancelled', ev.status === 'cancelled');
    text('when', fmtWhen(ev, false));
    text('when-long', fmtWhen(ev, true));
    text('title', ev.title);

    var by = el('by');
    by.textContent = '';
    if (ev.organiser_name) {
      by.appendChild(document.createTextNode('Organised by ' + ev.organiser_name));
      if (ev.organiser_website) {
        by.appendChild(document.createTextNode(' · '));
        by.appendChild(link(websiteHref(ev.organiser_website), 'Website'));
      }
      if (ev.organiser_instagram) {
        var handle = String(ev.organiser_instagram).replace(/^@/, '');
        by.appendChild(document.createTextNode(' · '));
        by.appendChild(link('https://instagram.com/' + encodeURIComponent(handle), '@' + handle));
      }
    }

    if (ev.venue_name || ev.address) {
      text('venue', ev.venue_name || '');
      var addr = el('address');
      if (ev.address) {
        addr.textContent = ev.address;
        addr.href = 'https://maps.google.com/?q=' + encodeURIComponent(ev.address);
      } else {
        addr.hidden = true;
      }
      show('where-row', true);
    }
    text('price', fmtPrice(ev));
    if (ev.min_age != null && ev.min_age > 0) {
      text('age', ev.min_age + '+');
      show('age-row', true);
    }
    if (ev.accessibility) {
      text('access', ev.accessibility);
      show('access-row', true);
    }
    var n = Number(ev.going_count) || 0;
    text(
      'going',
      n === 0
        ? 'Be the first to say you’re going'
        : n === 1
          ? '1 person going'
          : n + ' people going',
    );
    if (ev.description) {
      text('desc', ev.description);
      show('desc-card', true);
    }
    var tags = el('tags');
    (ev.tags || []).forEach(function (tag) {
      var li = document.createElement('li');
      li.textContent = tag;
      tags.appendChild(li);
    });

    if (ev.ticket_url && /^https?:\/\//i.test(ev.ticket_url) && ev.status !== 'cancelled') {
      el('tickets').href = ev.ticket_url;
      el('tickets').addEventListener('click', function () {
        // Counted for the organiser; never who.
        try {
          rpc('record_public_event_ticket_click', { p_event_id: ev.id, p_source: 'web' }).catch(
            function () {},
          );
        } catch (e) {
          /* fire and forget */
        }
      });
      show('tickets', true);
    }
    var add = el('add');
    add.href = 'dayli://public-events/' + encodeURIComponent(ev.id);
    add.addEventListener('click', function () {
      // If the app isn't installed nothing happens, so offer the website.
      setTimeout(function () {
        if (!document.hidden) {
          toast('Don’t have Dayli yet? Get the app first.');
          add.textContent = 'Get the app';
          add.href = cfg.appStoreUrl || '../';
        }
      }, 1500);
    });

    el('share').addEventListener('click', function () {
      var url = location.origin + '/e/' + ev.slug + '?via=share';
      if (navigator.share) {
        navigator
          .share({ title: ev.title, text: fmtWhen(ev, false), url: url })
          .catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () {
            toast('Link copied');
          },
          function () {
            toast(url);
          },
        );
      } else {
        prompt('Copy this link', url);
      }
    });

    show('event', true);
    recordView(ev.id);
  }

  function rpc(name, body) {
    return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: cfg.supabaseAnonKey,
        authorization: 'Bearer ' + cfg.supabaseAnonKey,
      },
      body: JSON.stringify(body),
    });
  }
  function recordView(id) {
    var source = params.get('via') === 'share' ? 'share' : 'web';
    var ref = (params.get('ref') || '').replace(/[^a-z0-9]/gi, '').slice(0, 8) || null;
    try {
      rpc('record_public_event_view', {
        p_event_id: id,
        p_source: source,
        p_via: ref ? 'link' : null,
        p_share_code: ref,
      }).catch(function () {});
    } catch (e) {
      /* fire and forget */
    }
  }

  if (!slug || !cfg.supabaseUrl) {
    render(null);
    return;
  }
  rpc('public_event_by_slug', { p_slug: slug })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(render)
    .catch(function () {
      render(null);
    });
})();
