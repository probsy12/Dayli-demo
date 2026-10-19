/* Public event page. Reads ?s=<slug> (or the last path segment), calls the
 * public_event_page(slug) RPC and fills the template in index.html. Plain
 * browser JavaScript, no build. */
(function () {
  var cfg = window.DAYLI_CONFIG || {};
  var params = new URLSearchParams(location.search);
  var slug = params.get('s') || location.pathname.split('/').filter(Boolean).pop() || '';
  if (slug === 'p' || slug === 'index.html') slug = '';

  function show(id, on) {
    document.getElementById(id).hidden = !on;
  }
  function text(id, value) {
    document.getElementById(id).textContent = value;
  }
  function fmtWhen(page) {
    var start = new Date(page.starts_at);
    var end = new Date(page.ends_at);
    var tz = page.timezone || undefined;
    var dateOpts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: tz };
    var timeOpts = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz };
    var day = start.toLocaleDateString(undefined, dateOpts);
    if (page.all_day) {
      var last = new Date(end.getTime() - 1);
      var lastDay = last.toLocaleDateString(undefined, dateOpts);
      return lastDay === day ? day + ' · All day' : day + ' – ' + lastDay;
    }
    return (
      day +
      ' · ' +
      start.toLocaleTimeString(undefined, timeOpts) +
      '–' +
      end.toLocaleTimeString(undefined, timeOpts)
    );
  }

  function render(page) {
    show('loading', false);
    if (!page) {
      show('missing', true);
      return;
    }
    document.title = page.title + ' · Dayli';
    var hero = document.getElementById('hero');
    if (page.hero_image_path) {
      hero.style.backgroundImage =
        'url(' + cfg.supabaseUrl + '/storage/v1/object/public/hero/' + page.hero_image_path + ')';
    } else {
      hero.textContent = (page.title || '?').trim().charAt(0).toUpperCase();
    }
    text('when', fmtWhen(page));
    text('title', page.title);
    if (page.location) {
      text('where', page.location);
      show('where-row', true);
    }
    text('going', page.going === 1 ? '1 person going' : page.going + ' people going');
    if (page.description) {
      text('desc', page.description);
      show('desc-card', true);
    }
    var cta = document.getElementById('cta');
    cta.href = cfg.appStoreUrl || 'dayli://';
    show('page', true);
  }

  if (!slug || !cfg.supabaseUrl) {
    render(null);
    return;
  }
  fetch(cfg.supabaseUrl + '/rest/v1/rpc/public_event_page', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: cfg.supabaseAnonKey,
      authorization: 'Bearer ' + cfg.supabaseAnonKey,
    },
    body: JSON.stringify({ p_slug: slug }),
  })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(render)
    .catch(function () {
      render(null);
    });
})();
