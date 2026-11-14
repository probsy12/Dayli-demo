/* Dayli HQ: the shell around teams, games and events. Asks what someone runs
 * (hq_prefs, supabase/migrations/20261111000400_hq_prefs.sql) and builds the
 * menus, the switcher and the home page from that; Settings changes it.
 *   #/welcome            1. your name (a new account) and what you run
 *   #/welcome/people     2. bring people in (invite links; a new team)
 *   #/new-team           add a team
 *   #/settings           what you run, account
 *   #/home               the first thing you run
 *   #/games[/<id>]       social games: add players, Bibs v Colours, who's paid
 * Only at /hq/ (app.js). */
(function () {
  'use strict';

  window.DayliHQ = function (ctx) {
    var esc = ctx.esc;
    var $ = ctx.$;
    var $$ = ctx.$$;
    var rpc = ctx.rpc;
    var render = ctx.render;
    var loading = ctx.loading;
    var notice = ctx.notice;
    var toast = ctx.toast;
    var go = ctx.go;
    var friendly = ctx.friendly;
    var setBusy = ctx.setBusy;
    var state = ctx.state;
    var SITE = ctx.SITE;
    var CTX_KEY = 'dayli_hq_context';
    // An Edge Function; its own error code (e.g. 'already_paid') when it fails.
    function invoke(name, body) {
      return ctx.sb.functions.invoke(name, { body: body }).then(function (res) {
        if (!res.error) return res.data;
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
      });
    }

    var RUNS = [
      {
        key: 'teams',
        title: 'A team or club',
        text: 'A squad that plays together all season, with fixtures and a manager.',
        points: ['Fixtures, results, training', 'Who’s available, pick the team', 'Collect subs and match fees'],
        like: 'Like: Sunday league side, netball team, kids’ club',
        colour: '#6e56cf',
        bg: '#ede8fb',
        icon: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4"/>',
      },
      {
        key: 'games',
        title: 'Social games',
        text: 'Pick-up games anyone can join: one-off or every week, first come first served.',
        points: ['Share one link, spaces fill up', 'Waiting list, bibs and colours', 'Track who’s paid'],
        like: 'Like: Thursday five-a-side, Sunday basketball, padel doubles',
        colour: '#3a61c9',
        bg: '#e8eefb',
        icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/>',
      },
      {
        key: 'events',
        title: 'Events',
        text: 'Things the public can find and go to, with tickets if you like.',
        points: ['List events people nearby find', 'Sell tickets, check in at the door', 'See who’s coming and from where'],
        like: 'Like: quiz night, yoga class, tournament, market',
        colour: '#d9741c',
        bg: '#fff4e8',
        icon: '<path d="M3 8h18v3a2 2 0 000 4v3H3v-3a2 2 0 000-4z M14 8v10"/>',
      },
    ];
    var SPORTS = [
      ['football', 'Football'],
      ['netball', 'Netball'],
      ['rugby', 'Rugby'],
      ['cricket', 'Cricket'],
      ['hockey', 'Hockey'],
      ['basketball', 'Basketball'],
      ['volleyball', 'Volleyball'],
      ['other', 'Something else'],
    ];
    var COLOURS = ['#6E56CF', '#2F6B4F', '#3A61C9', '#D9741C', '#B4432F', '#1C1A17'];

    var hq = null; // { runs: [], onboarded, has: {teams, games, events}, teams: [...] }

    // --- data -------------------------------------------------------------------

    function load(force) {
      if (hq && !force) return Promise.resolve(hq);
      return Promise.all([
        rpc('hq_prefs_get'),
        rpc('my_teams').catch(function () {
          return [];
        }),
      ]).then(function (r) {
        var p = r[0] || { runs: [], onboarded: false, has: {} };
        hq = {
          runs: p.runs || [],
          onboarded: !!p.onboarded,
          has: p.has || {},
          teams: (r[1] || []).filter(function (t) {
            return t.my_role === 'manager' && !t.sample;
          }),
        };
        return hq;
      });
    }
    function runs(k) {
      return !!hq && hq.runs.indexOf(k) >= 0;
    }
    function reset() {
      hq = null;
    }

    // Which thing the menus are about: a team, games or events.
    function context() {
      var m = location.hash.match(/^#\/teams\/([0-9a-f-]{36})/);
      if (m) return 'team:' + m[1];
      var h = location.hash.split('?')[0];
      if (/^#\/games/.test(h)) return 'games';
      if (/^#\/(overview|events|analytics|payouts|tickets|checkin|profile)/.test(h)) return 'events';
      var saved = null;
      try {
        saved = localStorage.getItem(CTX_KEY);
      } catch (e) {
        saved = null;
      }
      if (saved && valid(saved)) return saved;
      return firstContext();
    }
    function valid(c) {
      if (!hq) return false;
      if (c === 'games') return runs('games');
      if (c === 'events') return runs('events');
      var id = c.slice(5);
      return (
        runs('teams') &&
        hq.teams.some(function (t) {
          return t.calendar_id === id;
        })
      );
    }
    function firstContext() {
      if (!hq) return null;
      if (runs('teams') && hq.teams.length) return 'team:' + hq.teams[0].calendar_id;
      if (runs('games')) return 'games';
      if (runs('events')) return 'events';
      return null;
    }
    function remember(c) {
      try {
        localStorage.setItem(CTX_KEY, c);
      } catch (e) {
        /* private mode: fine */
      }
    }
    function contextHome(c) {
      if (!c) return runs('teams') ? '#/new-team' : '#/settings';
      if (c === 'games') return '#/games';
      if (c === 'events') return state.organiser ? '#/overview' : '#/profile';
      return '#/teams/' + c.slice(5);
    }
    function homeHash() {
      if (!hq || !hq.onboarded) return '#/welcome';
      return contextHome(context());
    }

    // --- the menus ----------------------------------------------------------------

    function crest(name, colour, size) {
      var s = size || 34;
      var ini = String(name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(function (w) {
          return w.charAt(0).toUpperCase();
        })
        .join('');
      return (
        '<span class="hq-cr" style="width:' +
        s +
        'px;height:' +
        s +
        'px;font-size:' +
        Math.round(s * 0.38) +
        'px;background:' +
        esc(colour || '#2f6b4f') +
        '">' +
        esc(ini) +
        '</span>'
      );
    }
    var ICON = {
      fixtures: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
      squad: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4"/>',
      money: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20"/>',
      home: '<path d="M3 12l9-8 9 8M5 10v10h14V10"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      ticket: '<path d="M4 8h16v3a2 2 0 000 4v3H4v-3a2 2 0 000-4z"/>',
      person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
      ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
      shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
      more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      list: '<path d="M5 6h14M5 12h14M5 18h9"/>',
      card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M7 15h4"/>',
      phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
      help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
      out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    };
    function link(href, icon, label, on) {
      return (
        '<a href="' +
        href +
        '" class="' +
        (on ? 'on' : '') +
        '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        ICON[icon] +
        '</svg>' +
        esc(label) +
        '</a>'
      );
    }
    function menuLinks(c, bare) {
      var h = location.hash.split('?')[0];
      var out = '';
      if (c && c.indexOf('team:') === 0) {
        var id = c.slice(5);
        var base = '#/teams/' + id;
        out +=
          link(base, 'home', 'Home', h === base) +
          link(base + '/fixtures', 'fixtures', 'Fixtures & results', h === base + '/fixtures' || h.indexOf(base + '/fixture/') === 0 || h === base + '/new') +
          link(base + '/squad', 'squad', 'Squad', h === base + '/squad') +
          link(base + '/payments', 'money', 'Payments', h === base + '/payments');
      } else if (c === 'games') {
        out +=
          link('#/games', 'ball', 'Social games', /^#\/games/.test(h) && !/^#\/games\/owed/.test(h)) +
          link('#/games/owed', 'money', 'Owed to you', /^#\/games\/owed/.test(h));
      } else if (c === 'events') {
        out +=
          link('#/overview', 'home', 'Overview', h === '#/overview') +
          link('#/events', 'fixtures', 'Events', /^#\/events/.test(h)) +
          link('#/analytics', 'chart', 'Analytics', /^#\/analytics/.test(h)) +
          link('#/payouts', 'ticket', 'Tickets & payouts', /^#\/(payouts|tickets|checkin)/.test(h)) +
          link('#/profile', 'person', 'Profile', h === '#/profile');
      }
      if (bare) return out;
      out += '<div class="hq-navgap"></div>' + link('#/settings', 'gear', 'Settings', h === '#/settings');
      if (state.admin) out += link('#/admin', 'shield', 'Admin', /^#\/admin/.test(h));
      return out;
    }
    // Phones: the pages of what you're running now along the bottom, and More,
    // where you switch to another team, the games or the events.
    function bottomBar(c) {
      var h = location.hash.split('?')[0];
      var item = function (href, icon, label, on, cls) {
        return (
          '<a href="' +
          href +
          '" class="' +
          (on ? 'on' : '') +
          (cls ? ' ' + cls : '') +
          '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          ICON[icon] +
          '</svg><span>' +
          label +
          '</span></a>'
        );
      };
      var out = '';
      if (c && c.indexOf('team:') === 0) {
        var base = '#/teams/' + c.slice(5);
        out +=
          item(base, 'home', 'Home', h === base) +
          item(base + '/fixtures', 'fixtures', 'Fixtures', h === base + '/fixtures' || h.indexOf(base + '/fixture/') === 0 || h === base + '/new') +
          item(base + '/squad', 'squad', 'Squad', h === base + '/squad') +
          item(base + '/payments', 'money', 'Payments', h === base + '/payments');
      } else if (c === 'games') {
        out +=
          item('#/games', 'ball', 'Games', /^#\/games/.test(h) && !/^#\/games\/owed/.test(h)) +
          item('#/games/owed', 'money', 'Owed', /^#\/games\/owed/.test(h));
      } else if (c === 'events') {
        out +=
          item('#/overview', 'home', 'Overview', h === '#/overview') +
          item('#/events', 'fixtures', 'Events', /^#\/events/.test(h)) +
          item('#/payouts', 'ticket', 'Tickets', /^#\/(payouts|tickets|checkin)/.test(h)) +
          item('#/analytics', 'chart', 'Analytics', /^#\/analytics/.test(h));
      }
      out += item('#/more', 'more', 'More', /^#\/(more|settings|admin)/.test(h));
      return out;
    }
    function switcherItems(c) {
      var out = '';
      if (runs('teams')) {
        out += '<div class="hq-dd-lb">YOUR TEAMS</div>';
        out += hq.teams.length
          ? hq.teams
              .map(function (t) {
                return (
                  '<a class="hq-dd-it' +
                  (c === 'team:' + t.calendar_id ? ' on' : '') +
                  '" href="#/teams/' +
                  esc(t.calendar_id) +
                  '">' +
                  crest(t.name, t.color, 30) +
                  '<span>' +
                  esc(t.name) +
                  '<small>Manager · ' +
                  t.players +
                  ' in the squad</small></span></a>'
                );
              })
              .join('')
          : '<div class="hq-dd-empty">No teams yet</div>';
      }
      if (runs('games'))
        out +=
          '<div class="hq-dd-lb">GAMES</div><a class="hq-dd-it' +
          (c === 'games' ? ' on' : '') +
          '" href="#/games">' +
          crest('G', '#3a61c9', 30) +
          '<span>Social games<small>One-off and weekly</small></span></a>';
      if (runs('events'))
        out +=
          '<div class="hq-dd-lb">EVENTS</div><a class="hq-dd-it' +
          (c === 'events' ? ' on' : '') +
          '" href="#/overview">' +
          crest(state.organiser ? state.organiser.name : 'E', '#1c1a17', 30) +
          '<span>' +
          esc(state.organiser ? state.organiser.name : 'Your events') +
          '<small>Events and tickets</small></span></a>';
      if (runs('teams')) out += '<a class="hq-dd-add" href="#/new-team">+ Add a team</a>';
      if (runs('games')) out += '<a class="hq-dd-add" href="#/games/new">+ New social game</a>';
      if (runs('events')) out += '<a class="hq-dd-add" href="#/events/new">+ New event</a>';
      if (
        RUNS.some(function (r) {
          return !runs(r.key);
        })
      )
        out += '<a class="hq-dd-add" href="#/settings">Run something else too…</a>';
      return out;
    }
    function current(c) {
      if (!c) return { name: 'Dayli HQ', sub: 'Pick what you run', colour: '#2f6b4f' };
      if (c === 'games') return { name: 'Social games', sub: 'One-off and weekly', colour: '#3a61c9' };
      if (c === 'events')
        return {
          name: state.organiser ? state.organiser.name : 'Your events',
          sub: 'Events and tickets',
          colour: '#1c1a17',
        };
      var t = hq.teams.filter(function (x) {
        return 'team:' + x.calendar_id === c;
      })[0];
      return t
        ? { name: t.name, sub: sportName(t.sport) + (t.format && /^\d+$/.test(t.format) ? ' · ' + t.format + '-a-side' : ''), colour: t.color }
        : { name: 'Team', sub: '', colour: '#2f6b4f' };
    }
    function sportName(s) {
      var f = SPORTS.filter(function (x) {
        return x[0] === s;
      })[0];
      return f ? (f[0] === 'other' ? 'Team' : f[1]) : String(s || 'Team');
    }
    function upsell() {
      var missing = RUNS.filter(function (r) {
        return !runs(r.key);
      });
      if (!missing.length) return '';
      var r = missing[0];
      var lines = {
        teams: ['Running a full team too?', 'Fixtures, a squad and subs…'],
        games: ['Run social games too?', 'Five-a-side, padel, board games…'],
        events: ['Also run events?', 'Quiz night, tournament, fun day…'],
      }[r.key];
      return (
        '<div class="hq-up"><b>' +
        esc(lines[0]) +
        '</b>' +
        esc(lines[1]) +
        ' <a href="#/settings">Turn it on</a></div>'
      );
    }

    // Draws the sidebar (wide) and the tabs (narrow) for where we are.
    function drawMenus() {
      if (!hq) return;
      var c = context();
      if (c) remember(c);
      var cur = current(c);
      var nav = document.getElementById('nav');
      var tabs = document.getElementById('tabs-nav');
      var sw = document.getElementById('hq-switch');
      if (!sw) {
        sw = document.createElement('div');
        sw.id = 'hq-switch';
        nav.parentNode.insertBefore(sw, nav);
      }
      sw.innerHTML =
        '<button type="button" class="hq-sw" id="hq-sw-btn" aria-expanded="false">' +
        crest(cur.name, cur.colour, 36) +
        '<span class="grow"><b>' +
        esc(cur.name) +
        '</b><small>' +
        esc(cur.sub) +
        '</small></span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 10l5 5 5-5"/></svg></button><div class="hq-dd" id="hq-dd" hidden>' +
        switcherItems(c) +
        '</div>';
      nav.innerHTML = menuLinks(c);
      nav.classList.add('hq-nav');
      // Phones: the bottom bar carries the pages, so no tabs along the top.
      tabs.innerHTML = '';
      tabs.classList.add('hq-empty-tabs');
      // Phones: where you are, in the top corner; tap it to switch (More).
      var topbar = document.getElementById('topbar');
      var chip = document.getElementById('hq-ctx');
      if (topbar && !chip) {
        chip = document.createElement('a');
        chip.id = 'hq-ctx';
        chip.className = 'hq-ctx';
        chip.href = '#/more';
        topbar.insertBefore(chip, document.getElementById('menu'));
      }
      if (chip) {
        chip.innerHTML = crest(cur.name, cur.colour, 24) + '<span>' + esc(cur.name) + '</span>';
        chip.setAttribute('aria-label', 'You’re in ' + cur.name + '. Switch');
      }
      var bar = document.getElementById('hq-bottom');
      if (!bar) {
        bar = document.createElement('nav');
        bar.id = 'hq-bottom';
        bar.className = 'hq-bottom';
        document.body.appendChild(bar);
      }
      bar.innerHTML = bottomBar(c);
      var up = document.getElementById('hq-upsell');
      if (!up) {
        up = document.createElement('div');
        up.id = 'hq-upsell';
        nav.parentNode.insertBefore(up, nav.nextSibling);
      }
      up.innerHTML = upsell();
      var btn = document.getElementById('hq-sw-btn');
      var dd = document.getElementById('hq-dd');
      btn.onclick = function (e) {
        e.stopPropagation();
        dd.hidden = !dd.hidden;
        btn.setAttribute('aria-expanded', String(!dd.hidden));
      };
      document.addEventListener(
        'click',
        function () {
          dd.hidden = true;
        },
        { once: true },
      );
    }
    // More (phones): switch to another thing you run, then your account.
    function screenMore() {
      if (!hq) return;
      var c = context();
      var tiles = [];
      if (runs('teams'))
        hq.teams.forEach(function (t) {
          tiles.push({
            href: '#/teams/' + t.calendar_id,
            key: 'team:' + t.calendar_id,
            name: t.name,
            colour: t.color,
            sub: sportName(t.sport) + ' · ' + t.players + ' in the squad',
          });
        });
      if (runs('games')) tiles.push({ href: '#/games', key: 'games', name: 'Social games', colour: '#3a61c9', sub: 'One-off and weekly' });
      if (runs('events'))
        tiles.push({
          href: state.organiser ? '#/overview' : '#/profile',
          key: 'events',
          name: state.organiser ? state.organiser.name : 'Your events',
          colour: '#1c1a17',
          sub: 'Events and tickets',
        });
      var adds = [];
      if (runs('teams')) adds.push(['#/new-team', '+ Add a team']);
      if (runs('games')) adds.push(['#/games/new', '+ New social game']);
      if (runs('events')) adds.push(['#/events/new', '+ New event']);
      if (
        RUNS.some(function (r) {
          return !runs(r.key);
        })
      )
        adds.push(['#/settings', 'Run something else too…']);
      var row = function (href, icon, title, sub, extra) {
        return (
          '<a class="hq-mo-row" href="' +
          href +
          '"' +
          (extra || '') +
          '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          ICON[icon] +
          '</svg><span class="grow">' +
          esc(title) +
          (sub ? '<small>' + esc(sub) + '</small>' : '') +
          '</span><i>›</i></a>'
        );
      };
      var mail = ctx.email ? ctx.email() : '';
      render(
        '<div class="hq-more"><h1 class="hq-mo-h">More</h1>' +
          '<div class="hq-mo-me">' +
          crest(state.organiser ? state.organiser.name : mail || 'You', '#2f6b4f', 40) +
          '<span class="grow"><b>' +
          esc(state.organiser ? state.organiser.name : 'Your account') +
          '</b><small>' +
          esc(mail || '') +
          '</small></span></div>' +
          '<div class="hq-mo-lb">SWITCH TO</div><div class="hq-mo-tiles">' +
          tiles
            .map(function (t) {
              var here = t.key === c;
              return (
                '<a class="hq-mo-tile' +
                (here ? ' on' : '') +
                '" href="' +
                esc(t.href) +
                '">' +
                crest(t.name, t.colour, 44) +
                (here ? '<span class="hq-mo-here">YOU’RE HERE</span>' : '') +
                '<b>' +
                esc(t.name) +
                '</b><small>' +
                esc(t.sub) +
                '</small></a>'
              );
            })
            .join('') +
          '</div>' +
          (adds.length
            ? '<div class="hq-mo-adds">' +
              adds
                .map(function (a) {
                  return '<a href="' + a[0] + '">' + esc(a[1]) + '</a>';
                })
                .join('') +
              '</div>'
            : '') +
          '<div class="hq-mo-lb">ACCOUNT</div><div class="hq-mo-list">' +
          row('#/settings', 'list', 'What you run', 'Teams, social games, events') +
          row('#/settings', 'gear', 'Settings', '') +
          (state.admin ? row('#/admin', 'shield', 'Admin', '') : '') +
          row(SITE + '/app/', 'phone', 'Open the Dayli app', 'Your own calendar', ' target="_blank" rel="noopener"') +
          row('mailto:hello@daylicalendar.co.uk', 'help', 'Help', 'hello@daylicalendar.co.uk') +
          '<button type="button" class="hq-mo-row out" id="hq-mo-out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          ICON.out +
          '</svg><span class="grow">Sign out</span></button></div></div>',
      );
      $('#hq-mo-out').onclick = ctx.signOut;
    }

    function menuSheet() {
      if (!hq) return '';
      var c = context();
      return switcherItems(c) + '<div class="hq-navgap"></div>' + menuLinks(c);
    }

    // --- welcome ---------------------------------------------------------------------

    var chosen = null; // the choice while going through the welcome steps
    var myName = null; // the account's name ('' until they give one)
    var TICK =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';

    function steps(n) {
      var names = ['What you run', 'Bring people in'];
      return (
        '<div class="hq-steps">' +
        names
          .map(function (name, i) {
            var cls = i + 1 < n ? 'done' : i + 1 === n ? 'on' : '';
            return (
              (i ? '<span class="hq-line"></span>' : '') +
              '<div class="hq-st ' +
              cls +
              '"><span class="n">' +
              (i + 1 < n ? '✓' : i + 1) +
              '</span>' +
              name +
              '</div>'
            );
          })
          .join('') +
        '</div>'
      );
    }
    function topBar(n) {
      return (
        '<div class="hq-top"><div class="hq-brand"><img src="../img/icon.svg" alt="" /> Dayli <span>HQ</span></div>' +
        steps(n) +
        '<button type="button" class="linkish" id="hq-out">Sign out</button></div>'
      );
    }
    function wireTop() {
      var b = $('#hq-out');
      if (b) b.onclick = ctx.signOut;
    }

    // The account's name. An account made here starts without one; players and
    // guests see it on games, teams and events.
    function uid() {
      return state.session && state.session.user ? state.session.user.id : null;
    }
    function loadName() {
      if (myName !== null) return Promise.resolve(myName);
      return ctx.sb
        .from('profiles')
        .select('display_name')
        .eq('id', uid())
        .maybeSingle()
        .then(function (r) {
          myName = (r.data && r.data.display_name) || '';
          return myName;
        });
    }
    function saveName(name) {
      var patch = { display_name: name };
      return ctx.sb
        .from('profiles')
        .update(patch)
        .eq('id', uid())
        .then(function (r) {
          if (r.error) throw r.error;
          myName = name;
        });
    }

    function screenWelcome() {
      loading();
      Promise.all([load(true), loadName()]).then(
        function () {
          // Nothing ticked for someone new: they say what they run.
          if (!chosen) chosen = hq.runs.slice();
          drawWelcome();
        },
        function (err) {
          render(notice('error', esc(friendly(err))));
        },
      );
    }
    function drawWelcome() {
      render(
        topBar(1) +
          '<div class="hq-wrap"><h1 class="hq-h1">What are you running?</h1><p class="hq-lead">Pick all that apply. HQ shows only what you need.</p>' +
          (myName
            ? ''
            : '<div class="hq-name"><label for="hq-name">Your name</label><input type="text" id="hq-name" maxlength="60" autocomplete="name" placeholder="e.g. Sam Taylor" /><p class="muted small">Players and guests see this on your teams, games and events.</p></div>') +
          '<div class="hq-choices">' +
          RUNS.map(function (r) {
            var on = chosen.indexOf(r.key) >= 0;
            return (
              '<button type="button" class="hq-ch' +
              (on ? ' on' : '') +
              '" data-run="' +
              r.key +
              '"><span class="hq-tick">' +
              (on ? TICK : '') +
              '</span><span class="hq-ic" style="background:' +
              r.bg +
              '"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="' +
              r.colour +
              '" stroke-width="1.8">' +
              r.icon +
              '</svg></span><h3>' +
              esc(r.title) +
              '</h3><p>' +
              esc(r.text) +
              '</p><ul>' +
              r.points
                .map(function (p) {
                  return '<li>' + esc(p) + '</li>';
                })
                .join('') +
              '</ul><span class="hq-ex">' +
              esc(r.like) +
              '</span></button>'
            );
          }).join('') +
          '</div><div class="hq-stone"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2f6b4f" stroke-width="2">' +
          ICON.gear +
          '</svg><div><b>Not set in stone.</b> <span class="muted">Start running games or events later? Add them any time in <b class="ink">Settings → What you run</b>, and HQ adds the menus for them. Nothing you’ve set up is lost if you switch something off.</span></div></div>' +
          '<div class="hq-foot"><span class="muted" id="hq-picked"></span><button class="btn primary hq-big" id="hq-next">Continue</button></div></div>',
      );
      document.body.classList.add('hq-bare');
      wireTop();
      function picked() {
        var names = RUNS.filter(function (r) {
          return chosen.indexOf(r.key) >= 0;
        }).map(function (r) {
          return r.title.replace('A team or club', 'Team or club');
        });
        $('#hq-picked').innerHTML = names.length ? '<b class="ink">' + esc(names.join(' + ')) + '</b> picked' : 'Pick at least one';
        $('#hq-next').disabled = !names.length;
      }
      $$('[data-run]').forEach(function (b) {
        b.onclick = function () {
          var k = b.dataset.run;
          var i = chosen.indexOf(k);
          if (i >= 0) chosen.splice(i, 1);
          else chosen.push(k);
          // Change the card in place: redrawing the page would jump the view.
          var on = chosen.indexOf(k) >= 0;
          b.classList.toggle('on', on);
          b.querySelector('.hq-tick').innerHTML = on ? TICK : '';
          picked();
        };
      });
      picked();
      $('#hq-next').onclick = function () {
        var input = $('#hq-name');
        var name = input ? input.value.trim() : myName;
        if (!name) {
          input.focus();
          return toast('Add your name');
        }
        var button = this;
        setBusy(button, true);
        (input ? saveName(name) : Promise.resolve())
          .then(function () {
            return rpc('hq_prefs_set', { p_runs: chosen, p_done: false });
          })
          .then(
            function () {
              go('#/welcome/people');
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
      };
    }

    // A new team: name, sport, colour. On Bring people in (no team yet) and on
    // its own page from "+ Add a team".
    function teamForm() {
      return (
        '<div class="hq-new"><label>Team name<input type="text" id="t-name" maxlength="60" placeholder="e.g. Clapton Juniors U12" /></label>' +
        '<div class="field-label">Sport</div><div class="hq-chips" id="t-sport">' +
        SPORTS.map(function (s, i) {
          return '<button type="button" data-v="' + s[0] + '" class="' + (i === 0 ? 'on' : '') + '">' + esc(s[1]) + '</button>';
        }).join('') +
        '</div><div class="field-label">Team colour</div><div class="hq-sws" id="t-colour">' +
        COLOURS.map(function (c, i) {
          return (
            '<button type="button" aria-label="Colour ' + c + '" data-v="' + c + '" class="' + (i === 0 ? 'on' : '') + '" style="background:' + c + '"></button>'
          );
        }).join('') +
        '</div><button class="btn primary" id="t-make">Create the team</button></div>'
      );
    }
    function wireTeamForm(done) {
      function pick(id) {
        $$('#' + id + ' button').forEach(function (b) {
          b.onclick = function () {
            $$('#' + id + ' button').forEach(function (x) {
              x.classList.toggle('on', x === b);
            });
          };
        });
      }
      pick('t-sport');
      pick('t-colour');
      $('#t-make').onclick = function () {
        var name = $('#t-name').value.trim();
        if (!name) return toast('Give the team a name');
        var button = this;
        setBusy(button, true);
        rpc('team_create', {
          p_name: name,
          p_sport: $('#t-sport button.on').dataset.v,
          p_league: null,
          p_color: $('#t-colour button.on').dataset.v,
          p_sample: false,
        }).then(
          function (id) {
            toast(name + ' is set up');
            done(id);
          },
          function (err) {
            setBusy(button, false);
            toast(friendly(err));
          },
        );
      };
    }

    // #/new-team: "+ Add a team", and where HQ opens when you run a team but
    // haven't made one yet.
    function screenNewTeam() {
      render(
        '<div class="page-head"><div><h1>Add a team</h1><p class="muted">You’re the manager. Then send the squad its join link.</p></div></div>' +
          '<div class="card">' +
          teamForm() +
          '</div>',
      );
      wireTeamForm(function () {
        load(true).then(function () {
          drawMenus();
          var t = hq.teams[hq.teams.length - 1];
          go(t ? '#/teams/' + t.calendar_id + '/squad' : homeHash());
        });
      });
    }

    function screenPeople() {
      loading();
      load(true).then(function () {
        if (!hq.runs.length) return go('#/welcome');
        var codes = {};
        var ids = hq.teams.map(function (t) {
          return t.calendar_id;
        });
        (ids.length
          ? ctx.sb
              .from('calendars')
              .select('id, join_code')
              .in('id', ids)
              .then(function (r) {
                (r.data || []).forEach(function (c) {
                  codes[c.id] = c.join_code;
                });
              })
          : Promise.resolve()
        ).then(function () {
          drawPeople(codes);
        });
      });
    }
    function drawPeople(codes) {
      var rows = '';
      var newTeam = runs('teams') && !hq.teams.length;
      if (runs('teams')) {
        rows += hq.teams
          .map(function (t) {
            var url = codes[t.calendar_id] ? SITE + '/join/' + codes[t.calendar_id] : null;
            return (
              '<div class="hq-tm">' +
              crest(t.name, t.color, 44) +
              '<div class="grow"><b>' +
              esc(t.name) +
              '</b><div class="muted small">' +
              t.players +
              ' in the squad so far. Players tap the link to join.</div></div>' +
              (url
                ? '<button class="btn" data-copy="' +
                  esc(url) +
                  '">Copy link</button><a class="btn hq-wa" target="_blank" rel="noopener" href="https://wa.me/?text=' +
                  encodeURIComponent('Join ' + t.name + ' on Dayli for fixtures and who’s playing: ' + url) +
                  '">WhatsApp</a>'
                : '') +
              '</div>'
            );
          })
          .join('');
        if (newTeam)
          rows +=
            '<div class="hq-tm hq-tm-new"><div class="grow"><b>Your team</b><div class="muted small">Make your team and its join link appears here. Or skip this and add it later.</div>' +
            teamForm() +
            '</div></div>';
      }
      if (runs('games'))
        rows +=
          '<div class="hq-tm">' +
          crest('G', '#3a61c9', 44) +
          '<div class="grow"><b>Social games</b><div class="muted small">Each game has its own link: share it from the game when you make one.</div></div></div>';
      if (runs('events'))
        rows +=
          '<div class="hq-tm">' +
          crest(state.organiser ? state.organiser.name : 'E', '#1c1a17', 44) +
          '<div class="grow"><b>Events</b><div class="muted small">Every event gets a page to share. People nearby find published events in the Dayli app.</div></div></div>';
      render(
        topBar(2) +
          '<div class="hq-wrap hq-left"><h1 class="hq-h1 hq-l">Bring people in</h1><p class="hq-lead2">Send the link to your group chat. Anyone who joins sees fixtures and games straight away.</p><div class="hq-found">' +
          rows +
          '</div><div class="hq-foot"><a class="btn" href="#/welcome">Back</a><button class="btn primary hq-big" id="hq-done">Go to HQ</button></div></div>',
      );
      document.body.classList.add('hq-bare');
      wireTop();
      if (newTeam) wireTeamForm(screenPeople);
      $$('[data-copy]').forEach(function (b) {
        b.onclick = function () {
          var url = b.dataset.copy;
          (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
            function () {
              toast('Link copied');
            },
            function () {
              window.prompt('Copy this link:', url);
            },
          );
        };
      });
      $('#hq-done').onclick = function () {
        var button = this;
        setBusy(button, true);
        rpc('hq_prefs_set', { p_runs: hq.runs, p_done: true }).then(
          function () {
            chosen = null;
            return load(true);
          },
          function (err) {
            setBusy(button, false);
            toast(friendly(err));
            throw err;
          },
        ).then(function () {
          go(homeHash());
        });
      };
    }

    // --- settings ----------------------------------------------------------------------

    function screenSettings() {
      loading();
      Promise.all([load(true), loadName()]).then(function () {
        var sel = hq.runs.slice();
        function draw() {
          render(
            '<div class="page-head"><div><h1>Settings</h1><p class="muted">What HQ shows you, and your account.</p></div></div>' +
              '<div class="card"><h3>What you run</h3><p class="sub">Turn on what you need; HQ adds the menus. Turning something off only hides it: your teams, games and events stay as they are.</p><div class="hq-set">' +
              RUNS.map(function (r) {
                var on = sel.indexOf(r.key) >= 0;
                return (
                  '<button type="button" class="hq-set-it' +
                  (on ? ' on' : '') +
                  '" data-run="' +
                  r.key +
                  '"><span class="hq-ic sm" style="background:' +
                  r.bg +
                  '"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' +
                  r.colour +
                  '" stroke-width="1.8">' +
                  r.icon +
                  '</svg></span><span class="grow"><b>' +
                  esc(r.title) +
                  '</b><small>' +
                  esc(r.text) +
                  '</small></span><span class="hq-toggle"><span></span></span></button>'
                );
              }).join('') +
              '</div><div class="row" style="margin-top:12px"><button class="btn primary" id="hq-save">Save</button><span class="muted small" id="hq-saved"></span></div></div>' +
              '<div class="card"><h3>Account</h3><p class="sub">Your Dayli account. If you ever want the Dayli calendar app, sign in there with the same email.</p>' +
              '<label class="field"><span>Your name</span><input type="text" id="hq-myname" maxlength="60" autocomplete="name" value="' +
              esc(myName || '') +
              '" /></label><p class="muted small">' +
              esc((state.session && state.session.user && state.session.user.email) || '') +
              '</p>' +
              (runs('events') ? '<a class="btn" href="#/profile">Organiser profile</a> ' : '') +
              '<button class="btn" id="hq-signout">Sign out</button> <a class="btn" href="#/welcome">Go through the welcome again</a></div>',
          );
          $$('[data-run]').forEach(function (b) {
            b.onclick = function () {
              var k = b.dataset.run;
              var i = sel.indexOf(k);
              if (i >= 0) sel.splice(i, 1);
              else sel.push(k);
              b.classList.toggle('on', sel.indexOf(k) >= 0); // in place, so the page doesn't jump
            };
          });
          $('#hq-signout').onclick = ctx.signOut;
          $('#hq-myname').onchange = function () {
            var name = this.value.trim();
            if (!name) return toast('Add your name');
            saveName(name).then(
              function () {
                toast('Name saved');
              },
              function (err) {
                toast(friendly(err));
              },
            );
          };
          $('#hq-save').onclick = function () {
            if (!sel.length) return toast('Keep at least one turned on');
            var button = this;
            setBusy(button, true);
            rpc('hq_prefs_set', { p_runs: sel, p_done: true })
              .then(function () {
                return load(true);
              })
              .then(
                function () {
                  toast('Saved');
                  drawMenus();
                  setBusy(button, false);
                },
                function (err) {
                  setBusy(button, false);
                  toast(friendly(err));
                },
              );
          };
        }
        draw();
      });
    }

    // --- social games: add players, Bibs v Colours on the pitch, who's paid ----------

    var SG_COL = ['#3a61c9', '#b4432f', '#2f6b4f', '#d9741c', '#6e56cf', '#1c7a8c', '#8a5a2b', '#c2417a'];
    function sgAvatar(p, size) {
      var s = size || 28;
      var k = String(p.id || p.name || '');
      var h = 0;
      for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
      var ini = String(p.name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(function (w) {
          return w.charAt(0).toUpperCase();
        })
        .join('');
      return p.avatar_url
        ? '<img class="th-av" style="width:' + s + 'px;height:' + s + 'px" src="' + esc(p.avatar_url) + '" alt="" />'
        : '<span class="th-av" style="background:' +
            SG_COL[h % SG_COL.length] +
            ';width:' +
            s +
            'px;height:' +
            s +
            'px;font-size:' +
            Math.round(s * 0.38) +
            'px">' +
            esc(ini) +
            '</span>';
    }
    function sgShort(name) {
      var w = String(name || '')
        .split(/\s+/)
        .filter(Boolean);
      return w.length > 1 ? w[0] + ' ' + w[w.length - 1].charAt(0) + '.' : w[0] || '';
    }
    // "£5", "5 pounds", "£4.50 each" → pence; null when there's no price.
    function sgPrice(cost) {
      var m = /(\d+(?:\.\d{1,2})?)/.exec(String(cost || ''));
      return m ? Math.round(parseFloat(m[1]) * 100) : null;
    }
    function sgPounds(p) {
      var v = p / 100;
      return '£' + (v % 1 ? v.toFixed(2) : v.toFixed(0));
    }
    // Where each player stands in their half: the keeper at the end, the rest
    // in two rows towards halfway.
    // The playing area for the team sheet, drawn for the game's sport: bibs at
    // the top, colours at the bottom. Lines are boxes placed in percentages.
    function sgCourt(sport) {
      function l(cls, css) {
        return '<div class="ln' + (cls ? ' ' + cls : '') + '" style="' + css + '"></div>';
      }
      var k = gameSport(sport).k;
      var lines;
      if (k === 'basketball') {
        lines =
          l('', 'left:4%;right:4%;top:3%;bottom:3%;border-radius:4px') +
          l('half', '') +
          l('', 'left:50%;top:50%;width:22%;aspect-ratio:1;border-radius:50%;transform:translate(-50%,-50%)') +
          // The keys, free-throw circles, three-point arcs and hoops.
          l('', 'left:35%;right:35%;top:3%;height:20%') +
          l('', 'left:35%;right:35%;bottom:3%;height:20%') +
          l('', 'left:50%;top:23%;width:30%;aspect-ratio:1;border-radius:50%;transform:translate(-50%,-50%);border-style:dashed') +
          l('', 'left:50%;top:77%;width:30%;aspect-ratio:1;border-radius:50%;transform:translate(-50%,-50%);border-style:dashed') +
          l('', 'left:10%;right:10%;top:3%;height:31%;border-top:0;border-radius:0 0 50% 50%/0 0 100% 100%') +
          l('', 'left:10%;right:10%;bottom:3%;height:31%;border-bottom:0;border-radius:50% 50% 0 0/100% 100% 0 0') +
          l('hoop', 'left:50%;top:6.5%') +
          l('hoop', 'left:50%;top:93.5%');
      } else if (k === 'netball') {
        lines =
          l('', 'left:4%;right:4%;top:3%;bottom:3%') +
          l('half', 'top:34.3%') +
          l('half', 'top:65.7%') +
          l('', 'left:50%;top:50%;width:12%;aspect-ratio:1;border-radius:50%;transform:translate(-50%,-50%)') +
          l('', 'left:26%;right:26%;top:3%;height:15%;border-top:0;border-radius:0 0 50% 50%/0 0 100% 100%') +
          l('', 'left:26%;right:26%;bottom:3%;height:15%;border-bottom:0;border-radius:50% 50% 0 0/100% 100% 0 0');
      } else if (k === 'hockey') {
        lines =
          l('', 'left:4%;right:4%;top:3%;bottom:3%;border-radius:4px') +
          l('half', '') +
          l('half dash', 'top:26%') +
          l('half dash', 'top:74%') +
          l('', 'left:22%;right:22%;top:3%;height:16%;border-top:0;border-radius:0 0 50% 50%/0 0 100% 100%') +
          l('', 'left:22%;right:22%;bottom:3%;height:16%;border-bottom:0;border-radius:50% 50% 0 0/100% 100% 0 0') +
          l('', 'left:44%;right:44%;top:1%;height:2%;border-bottom:0') +
          l('', 'left:44%;right:44%;bottom:1%;height:2%;border-top:0');
      } else if (k === 'tennis' || k === 'badminton' || k === 'padel') {
        var side = k === 'padel' ? 4 : 10;
        var inner = k === 'padel' ? null : k === 'tennis' ? 18 : 15;
        var svc = k === 'tennis' ? 26 : k === 'padel' ? 20 : 40;
        var back = k === 'badminton' ? 8.5 : null;
        lines =
          '<div class="court-in" style="left:' + side + '%;right:' + side + '%"></div>' +
          l('', 'left:' + side + '%;right:' + side + '%;top:5%;bottom:5%') +
          (inner ? l('', 'left:' + inner + '%;width:0;top:5%;bottom:5%;border-width:0 0 0 2px') : '') +
          (inner ? l('', 'right:' + inner + '%;width:0;top:5%;bottom:5%;border-width:0 2px 0 0') : '') +
          l('half', 'top:' + svc + '%;left:' + (inner || side) + '%;right:' + (inner || side) + '%') +
          l('half', 'top:' + (100 - svc) + '%;left:' + (inner || side) + '%;right:' + (inner || side) + '%') +
          (back ? l('half', 'top:' + back + '%;left:' + side + '%;right:' + side + '%') + l('half', 'top:' + (100 - back) + '%;left:' + side + '%;right:' + side + '%') : '') +
          // The centre service line runs from service line to service line,
          // except badminton's, which runs out to the back.
          (k === 'badminton'
            ? l('', 'left:50%;width:0;top:5%;height:' + (svc - 5) + '%;border-width:0 0 0 2px') +
              l('', 'left:50%;width:0;bottom:5%;height:' + (svc - 5) + '%;border-width:0 0 0 2px')
            : l('', 'left:50%;width:0;top:' + svc + '%;bottom:' + svc + '%;border-width:0 0 0 2px')) +
          l('net', 'left:' + (side - 2) + '%;right:' + (side - 2) + '%');
      } else if (k === 'volleyball') {
        lines =
          '<div class="court-in" style="left:12%;right:12%;top:8%;bottom:8%"></div>' +
          l('', 'left:12%;right:12%;top:8%;bottom:8%') +
          l('half', 'top:36%;left:12%;right:12%') +
          l('half', 'top:64%;left:12%;right:12%') +
          l('net', 'left:9%;right:9%');
      } else if (k === 'board_games') {
        lines = '<div class="board"></div>';
      } else if (k === 'football') {
        lines =
          '<div class="ln box"></div><div class="ln half"></div><div class="ln circle"></div><div class="ln area top"></div><div class="ln area bottom"></div>';
      } else {
        lines = l('', 'left:4%;right:4%;top:3%;bottom:3%;border-radius:10px') + l('half', '');
      }
      return '<div class="sg-pitch gt-pitch court-' + k + '">' + lines;
    }

    function sgHalf(n, top) {
      var rest = n - 1;
      var rows = rest > 1 ? [rest - Math.floor(rest / 2), Math.floor(rest / 2)] : rest === 1 ? [1] : [];
      var spots = n > 0 ? [{ x: 50, y: top ? 9 : 91 }] : [];
      var ys = top ? [25, 41] : [75, 59];
      rows.forEach(function (cnt, r) {
        for (var j = 0; j < cnt; j++) spots.push({ x: cnt === 1 ? 50 : 16 + (j * 68) / (cnt - 1), y: ys[r] });
      });
      return spots;
    }

    function screenGames(gameId, query) {
      if (gameId === 'new') return screenNewGame();
      if (gameId === 'owed') return query && query.p ? screenOwedPerson(query.p) : screenOwed();
      loading();
      if (query && query.made && gameId) {
        return rpc('game_view', { p_game: gameId }).then(
          function (g) {
            if (!g) return loadGames(gameId);
            drawGameMade(g);
          },
          function () {
            loadGames(gameId);
          },
        );
      }
      // Back from Stripe's sign-up: check the account before showing the game.
      var back =
        query && query.stripe && gameId
          ? invoke('game-pay', { action: 'status', game_id: gameId }).then(
              function (r) {
                toast(
                  r && r.ready
                    ? 'Card payments are ready. Set a price below.'
                    : 'Stripe is still checking your details. Try again in a few minutes.',
                );
              },
              function () {
                return null;
              },
            )
          : Promise.resolve();
      back.then(function () {
        loadGames(gameId);
      });
    }

    function gamesEmpty() {
      render(
              '<div class="ng ng-empty"><div class="ng-art"><svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#3a61c9" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/></svg></div>' +
                '<h1>Your first game</h1><p class="muted">Make it in a minute, share the link, and people take a place.</p><div class="ng-how">' +
                [
                  ['Pick a day, time and place', 'Weekly if it’s every Thursday'],
                  ['Share the link on WhatsApp', 'No app needed to take a place'],
                  ['See who’s in, pick sides, who’s paid', 'A waiting list fills any gaps'],
                ]
                  .map(function (x, i) {
                    return '<div><i>' + (i + 1) + '</i><span><b>' + x[0] + '</b><small>' + x[1] + '</small></span></div>';
                  })
                  .join('') +
                '</div><a class="btn primary ng-go" href="#/games/new">+ Start a game</a></div>',
            );
    }

    // Games: everything coming up (soonest first, the next one outlined), then
    // past games (newest first, 20 at a time). Tap one to open it.
    function screenGamesList() {
      loading();
      Promise.all([rpc('game_list', { p_past: false }), rpc('game_list', { p_past: true })]).then(
        function (res) {
          var coming = res[0] || [];
          var past = res[1] || [];
          if (!coming.length && !past.length) return gamesEmpty();
          var today = ymdLocal(new Date());
          function dayParts(x) {
            var d = new Date(x.starts_at);
            var o = { timeZone: x.timezone || undefined };
            return {
              wd: d.toLocaleDateString('en-GB', Object.assign({ weekday: 'short' }, o)).toUpperCase(),
              n: d.toLocaleDateString('en-GB', Object.assign({ day: 'numeric' }, o)),
              m: d.toLocaleDateString('en-GB', Object.assign({ month: 'short' }, o)).toUpperCase(),
              t: d.toLocaleTimeString('en-GB', Object.assign({ hour: '2-digit', minute: '2-digit' }, o)),
              ymd: ymdLocal(d),
            };
          }
          function card(x, i) {
            var d = dayParts(x);
            var full = x.playing >= x.places;
            var pct = Math.min(100, Math.round((x.playing / Math.max(1, x.places)) * 100));
            var chips = ['<span class="g">' + x.playing + ' of ' + x.places + ' playing</span>'];
            if (full) chips.push('<span class="g">Full</span>');
            if (x.waiting) chips.push('<span>' + x.waiting + ' waiting</span>');
            if (x.no_reply) chips.push('<span class="y">' + x.no_reply + ' no reply</span>');
            if (x.price_each && x.unpaid) chips.push('<span class="o">' + sgPounds(x.price_each * x.unpaid) + ' to collect</span>');
            if (x.pitch_pence && !x.locked) chips.push('<span>' + sgPounds(x.pitch_pence) + ' pitch, split</span>');
            var tag = d.ymd === today ? 'TODAY' : '';
            return (
              '<a class="gl-card' +
              (i === 0 ? ' next' : '') +
              '" href="#/games/' +
              esc(x.id) +
              '">' +
              (tag ? '<span class="gl-tag">' + tag + '</span>' : '') +
              '<span class="gl-date"><small>' +
              esc(d.wd) +
              '</small><b>' +
              esc(d.n) +
              '</b><i>' +
              esc(d.m) +
              '</i></span><span class="grow"><b class="gl-t">' +
              esc(x.title) +
              '</b><small class="gl-s">' +
              esc([d.t, x.location, x.weekly ? 'weekly' : null].filter(Boolean).join(' · ')) +
              '</small><span class="gl-bar"><i style="width:' +
              pct +
              '%"></i></span><span class="gl-chips">' +
              chips.join('') +
              '</span></span><span class="gl-ar">›</span></a>'
            );
          }
          function row(x) {
            var d = dayParts(x);
            var owed = x.price_each && x.unpaid ? x.price_each * x.unpaid : 0;
            return (
              '<a class="gl-row" href="#/games/' +
              esc(x.id) +
              '"><span class="gl-dd"><small>' +
              esc(d.wd) +
              '</small><b>' +
              esc(d.n) +
              '</b></span><span class="grow"><b>' +
              esc(x.title) +
              '</b><small>' +
              esc(d.m.charAt(0) + d.m.slice(1).toLowerCase()) +
              ' · ' +
              x.playing +
              ' played' +
              (x.price_each ? ' · ' + sgPounds(x.price_each) + ' each' : x.cost ? '' : ' · free') +
              '</small></span>' +
              (owed ? '<span class="gl-owed">' + sgPounds(owed) + ' owed</span>' : x.price_each ? '<span class="gl-paid">All paid</span>' : '') +
              '<span class="gl-ar">›</span></a>'
            );
          }
          render(
            '<div class="gl"><div class="gl-head"><h1>Games</h1><a class="btn primary" href="#/games/new">+ New game</a></div>' +
              '<div class="gl-k">COMING UP</div>' +
              (coming.length
                ? coming.map(card).join('')
                : '<div class="gl-none">Nothing coming up. <a href="#/games/new">Start a game</a></div>') +
              (past.length
                ? '<div class="gl-k">PAST GAMES</div><div class="gl-past" id="gl-past">' +
                  past.map(row).join('') +
                  '</div>' +
                  (past.length >= 20 ? '<button type="button" class="gl-more" id="gl-more">Show older games</button>' : '')
                : '') +
              '</div>',
          );
          var last = past.length ? past[past.length - 1].starts_at : null;
          if ($('#gl-more'))
            $('#gl-more').onclick = function () {
              var button = this;
              setBusy(button, true, 'Loading…');
              rpc('game_list', { p_past: true, p_before: last }).then(
                function (more) {
                  more = more || [];
                  $('#gl-past').insertAdjacentHTML('beforeend', more.map(row).join(''));
                  if (more.length) last = more[more.length - 1].starts_at;
                  if (more.length < 20) button.remove();
                  else setBusy(button, false);
                },
                function (err) {
                  setBusy(button, false);
                  toast(friendly(err));
                },
              );
            };
        },
        function (err) {
          render(notice('error', esc(friendly(err))));
        },
      );
    }

    function loadGames(gameId) {
      loading();
      rpc('my_games').then(
        function (rows) {
          var mine = (rows || []).filter(function (g) {
            return g.is_organiser;
          });
          var id = gameId;
          if (!id) return screenGamesList();
          rpc('game_view', { p_game: id }).then(
            function (g) {
              if (!g || !g.is_organiser) {
                return render(notice('info', 'Only the person running this game can manage it here.'));
              }
              drawGame(g, mine);
            },
            function (err) {
              render(notice('error', esc(friendly(err))));
            },
          );
        },
        function (err) {
          render(notice('error', esc(friendly(err))));
        },
      );
    }

    // --- a new social game (game_create) -------------------------------------------------
    // Two short steps for a phone: what (the sport, then its format, which sets
    // how many can play), when and where; then places, length, cost and a
    // summary. It goes on your own calendar, or a team's you manage, and you
    // take the first place.
    var GAME_SPORTS = [
      {
        k: 'football',
        n: 'Football',
        d: '5',
        mins: 60,
        f: [
          ['5', '5-a-side', 10],
          ['6', '6-a-side', 12],
          ['7', '7-a-side', 14],
          ['8', '8-a-side', 16],
          ['11', '11-a-side', 22],
        ],
      },
      {
        k: 'basketball',
        n: 'Basketball',
        d: '5',
        mins: 60,
        f: [
          ['5', '5 v 5', 10],
          ['3x3', '3 v 3', 6],
        ],
      },
      { k: 'netball', n: 'Netball', d: '7', mins: 60, f: [['7', '7-a-side', 14]] },
      { k: 'hockey', n: 'Hockey', d: '7', mins: 60, f: [['7', '7-a-side', 14], ['11', '11-a-side', 22]] },
      { k: 'padel', n: 'Padel', d: 'doubles', mins: 90, f: [['doubles', 'Doubles', 4]] },
      {
        k: 'tennis',
        n: 'Tennis',
        d: 'doubles',
        mins: 60,
        f: [
          ['doubles', 'Doubles', 4],
          ['singles', 'Singles', 2],
        ],
      },
      {
        k: 'badminton',
        n: 'Badminton',
        d: 'doubles',
        mins: 60,
        f: [
          ['doubles', 'Doubles', 4],
          ['singles', 'Singles', 2],
        ],
      },
      {
        k: 'volleyball',
        n: 'Volleyball',
        d: '6',
        mins: 90,
        f: [
          ['6', '6-a-side', 12],
          ['beach', 'Beach 2 v 2', 4],
        ],
      },
      { k: 'board_games', n: 'Board games', d: null, mins: 180, places: 6 },
      { k: 'other', n: 'Something else', d: null, mins: 60, places: 10 },
    ];
    function gameSport(k) {
      return (
        GAME_SPORTS.filter(function (s) {
          return s.k === k;
        })[0] || GAME_SPORTS[0]
      );
    }
    function gameFormat(s, f) {
      return (
        (s.f || []).filter(function (x) {
          return x[0] === f;
        })[0] || null
      );
    }
    // "5 v 5", "5 v 6", "2 v 2" for games with sides; otherwise "6 players".
    function sidesLabel(sportKey, places) {
      var s = gameSport(sportKey);
      if (!s.f) return places + ' players';
      var a = Math.floor(places / 2);
      return a + ' v ' + (places - a);
    }
    function ymdLocal(d) {
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    function chips(name, items, on) {
      return (
        '<div class="ng-chips" data-chips="' +
        name +
        '">' +
        items
          .map(function (x) {
            return '<button type="button" class="ng-chip' + (x[0] === on ? ' on' : '') + '" data-v="' + esc(x[0]) + '">' + esc(x[1]) + '</button>';
          })
          .join('') +
        '</div>'
      );
    }

    var SPORT_ICON = {
      football: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/>',
      basketball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8"/>',
      netball: '<circle cx="12" cy="12" r="9"/><path d="M4 9c5 2 11 2 16 0M4 15c5-2 11-2 16 0M12 3c-3 5-3 13 0 18"/>',
      hockey: '<path d="M14 3l-6 15a3 3 0 01-3 2H3"/><circle cx="18" cy="18" r="2.5"/>',
      padel: '<rect x="6" y="2.5" width="11" height="12" rx="5.5"/><path d="M11.5 14.5V21M9 6h5M9 9h5M9 12h5"/>',
      tennis: '<circle cx="12" cy="12" r="9"/><path d="M5 5.5c3.5 3.5 3.5 9.5 0 13M19 5.5c-3.5 3.5-3.5 9.5 0 13"/>',
      badminton: '<path d="M12 21l-2-8h4z"/><path d="M10 13L6 4M14 13l4-9M12 13V3"/>',
      volleyball: '<circle cx="12" cy="12" r="9"/><path d="M12 3c0 5 3 8 8 9M12 12c-4 3-8 3-9 2M12 12c1-4 4-7 6-7"/>',
      board_games:
        '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/>',
      other: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>',
    };
    function sportIcon(k, size) {
      return (
        '<svg width="' +
        (size || 28) +
        '" height="' +
        (size || 28) +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        (SPORT_ICON[k] || SPORT_ICON.other) +
        '</svg>'
      );
    }
    // The next time a past game's weekday and time comes round (from tomorrow on).
    function nextLike(iso, tz) {
      var then = new Date(iso);
      var hm = then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz || undefined });
      var wd = Number(
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(then.toLocaleDateString('en-GB', { weekday: 'short', timeZone: tz || undefined })),
      );
      var d = new Date();
      d.setDate(d.getDate() + 1);
      for (var i = 0; i < 7 && d.getDay() !== wd; i++) d.setDate(d.getDate() + 1);
      return { day: ymdLocal(d), time: hm };
    }

    // Start a game: your recent games at the top (again, like last time: one
    // tap fills everything in for next week), or start fresh with a sport
    // tile, its format, and the details as rows you open to change.
    function screenNewGame() {
      loading();
      var me = state.session && state.session.user ? state.session.user.id : null;
      Promise.all([
        ctx.sb.from('calendars').select('id, name, owner_id'),
        rpc('game_templates').catch(function () {
          return [];
        }),
      ]).then(function (res) {
        var teamIds = {};
        (hq.teams || []).forEach(function (t) {
          teamIds[t.calendar_id] = true;
        });
        var cals = (Array.isArray(res[0].data) ? res[0].data : [])
          .filter(function (c) {
            return (c.owner_id === me && !teamIds[c.id]) || teamIds[c.id];
          })
          .sort(function (a, b) {
            return (teamIds[a.id] ? 1 : 0) - (teamIds[b.id] ? 1 : 0);
          });
        var tomorrow = new Date(Date.now() + 86400000);
        var g = {
          sport: 'football',
          format: '5',
          places: 10,
          day: ymdLocal(tomorrow),
          time: '19:00',
          place: '',
          weekly: false,
          mins: 60,
          cost: '',
          split: false,
          pitch: '',
          title: '',
          titleTouched: false,
          cal: cals[0] ? cals[0].id : null,
          from: null,
        };
        drawNewGame(g, cals, teamIds, res[1] || [], null);
      });
    }

    function drawNewGame(g, cals, teamIds, templates, open) {
      var keepY = window.scrollY;
      var s = gameSport(g.sport);
      var fmt = gameFormat(s, g.format);
      var whatName = s.f ? (fmt || [null, s.n])[1] : s.n;
      if (!g.titleTouched) {
        g.title =
          g.sport === 'football'
            ? whatName
            : g.sport === 'board_games'
              ? 'Board games night'
              : g.sport === 'other'
                ? 'Game'
                : s.f && s.f.length > 1
                  ? s.n + ' · ' + whatName
                  : s.n;
      }
      var when = new Date(g.day + 'T' + g.time);
      var whenText = isNaN(when.getTime())
        ? 'Pick a day'
        : when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + g.time;
      var minsText = { 60: '1 hour', 90: '1½ hours', 120: '2 hours', 180: '3 hours' }[g.mins] || g.mins + ' minutes';

      // A price each, or the pitch fee shared by everyone playing.
      function pitchPence() {
        var v = parseFloat(String(g.pitch || '').replace(/[£,\s]/g, ''));
        return v >= 1 && v <= 1000 ? Math.round(v * 100) : null;
      }
      function sharePence(n) {
        var p = pitchPence();
        return p ? Math.ceil(p / Math.max(1, n) / 10) * 10 : null;
      }
      function costText() {
        if (g.split) return pitchPence() ? sgPounds(pitchPence()) + ' pitch, split' : 'Split the pitch fee';
        return g.cost ? g.cost + ' each' : 'Free, or say later';
      }
      function splitNote() {
        return pitchPence()
          ? 'If all ' +
              g.places +
              ' play, that’s ' +
              sgPounds(sharePence(g.places)) +
              ' each. Fewer players, a bigger share: it changes as people say yes.'
          : 'Type what the pitch costs. Everyone playing pays an equal share, and it goes down as more say yes.';
      }
      function row(key, label, value, editor) {
        return (
          '<div class="ng-row' +
          (open === key ? ' open' : '') +
          '"><button type="button" class="ng-row-h" data-row="' +
          key +
          '"><span class="muted">' +
          label +
          '</span><b id="ng-v-' +
          key +
          '">' +
          esc(value) +
          '</b><i>' +
          (open === key ? '⌃' : '›') +
          '</i></button>' +
          (open === key ? '<div class="ng-row-e">' + editor + '</div>' : '') +
          '</div>'
        );
      }

      var today = new Date();
      var days = [['today', 'Tonight']];
      for (var i = 1; i <= 6; i++) {
        var d = new Date(today.getTime() + i * 86400000);
        days.push([ymdLocal(d), i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })]);
      }
      var dayOn = g.day === ymdLocal(today) ? 'today' : g.day;
      var dayKnown = days.some(function (x) {
        return x[0] === dayOn;
      });
      days.push(['pick', 'Another day…']);

      var tpls = (templates || [])
        .map(function (t, i) {
          var nx = nextLike(t.starts_at, t.timezone);
          var nd = new Date(nx.day + 'T' + nx.time);
          var on = g.from === i;
          return (
            '<button type="button" class="ng-tpl' +
            (on ? ' on' : '') +
            '" data-tpl="' +
            i +
            '"><span class="ng-tpl-ic">' +
            sportIcon(t.sport, 26) +
            '</span><span class="grow"><b>' +
            esc(t.title) +
            '</b><small>' +
            esc(
              [
                nd.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + nx.time,
                t.location,
                t.places + ' places',
                t.cost,
              ]
                .filter(Boolean)
                .join(' · '),
            ) +
            '</small><em>Next: ' +
            esc(nd.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })) +
            '</em></span><i>›</i></button>'
          );
        })
        .join('');

      render(
        '<div class="ng ng-start"><div class="ng-top"><a href="#/games" class="ng-link">Cancel</a><b>New game</b><span style="width:48px"></span></div>' +
          '<h1 class="ng-h">Start a game</h1>' +
          (tpls ? '<div class="ng-k">AGAIN, LIKE LAST TIME</div>' + tpls + '<div class="ng-k">OR START FRESH</div>' : '') +
          '<div class="ng-tiles">' +
          GAME_SPORTS.map(function (x) {
            return (
              '<button type="button" class="ng-tile' +
              (x.k === g.sport ? ' on' : '') +
              '" data-sport="' +
              x.k +
              '">' +
              sportIcon(x.k, 28) +
              '<span>' +
              esc(x.n) +
              '</span></button>'
            );
          }).join('') +
          '</div>' +
          (s.f && s.f.length > 1
            ? '<div class="ng-k">' +
              (g.sport === 'football' || g.sport === 'hockey' || g.sport === 'netball' ? 'HOW MANY A SIDE?' : 'WHICH GAME?') +
              '</div><div class="ng-seg">' +
              s.f
                .map(function (f) {
                  return (
                    '<button type="button" class="' +
                    (f[0] === g.format ? 'on' : '') +
                    '" data-format="' +
                    f[0] +
                    '">' +
                    esc(g.sport === 'football' ? f[1].replace('-a-side', '') : f[1]) +
                    '</button>'
                  );
                })
                .join('') +
              '</div>'
            : '') +
          '<div class="ng-rows">' +
          row(
            'when',
            'When',
            whenText,
            chips('day', days, dayKnown ? dayOn : 'pick') +
              '<input type="date" id="ng-date" class="ng-inp" value="' +
              esc(g.day) +
              '"' +
              (dayKnown ? ' hidden' : '') +
              ' />' +
              '<label class="ng-time"><span class="muted">Kick-off</span><input type="time" id="ng-time" step="300" value="' +
              esc(g.time) +
              '" /></label>',
          ) +
          row(
            'where',
            'Where',
            g.place || 'Add a place',
            '<input type="text" id="ng-place" class="ng-inp" maxlength="120" placeholder="Mabley Green, pitch 3" value="' + esc(g.place) + '" />',
          ) +
          row(
            'places',
            'Places',
            g.places + ' · ' + sidesLabel(g.sport, g.places),
            '<div class="ng-step"><button type="button" data-n="-1">−</button><div><b id="ng-n">' +
              g.places +
              '</b><small id="ng-sides">' +
              esc(sidesLabel(g.sport, g.places)) +
              '</small></div><button type="button" data-n="1">+</button></div>',
          ) +
          row(
            'long',
            'How long',
            minsText,
            chips(
              'mins',
              [
                ['60', '1 hour'],
                ['90', '1½ hours'],
                ['120', '2 hours'],
                ['180', '3 hours'],
              ],
              String(g.mins),
            ),
          ) +
          row(
            'cost',
            'Cost',
            costText(),
            '<div class="ng-seg ng-cseg"><button type="button" class="' +
              (g.split ? '' : 'on') +
              '" data-cmode="each">Price each</button><button type="button" class="' +
              (g.split ? 'on' : '') +
              '" data-cmode="split">Split the pitch</button></div>' +
              (g.split
                ? '<label class="ng-money"><span>£</span><input type="text" id="ng-pitch" class="ng-inp" inputmode="decimal" maxlength="7" placeholder="60" value="' +
                  esc(g.pitch) +
                  '" /></label><p class="muted small ng-note" id="ng-split-note">' +
                  esc(splitNote()) +
                  '</p>'
                : '<input type="text" id="ng-cost" class="ng-inp" maxlength="40" placeholder="£5" value="' +
                  esc(g.cost) +
                  '" /><p class="muted small ng-note">People pay you in cash, or by card once card payments are on.</p>'),
          ) +
          '<label class="ng-row ng-switch-row"><span class="muted">Repeats</span><b>Every week</b><span class="ng-switch"><input type="checkbox" id="ng-weekly"' +
          (g.weekly ? ' checked' : '') +
          ' /><span></span></span></label></div>' +
          '<p class="err" id="ng-err" hidden></p><button class="btn primary ng-go" id="ng-create">Create the game</button></div>',
      );
      window.scrollTo(0, keepY);

      function redraw(nextOpen) {
        drawNewGame(g, cals, teamIds, templates, nextOpen);
      }
      function setText(key, v) {
        var el = document.getElementById('ng-v-' + key);
        if (el) el.textContent = v;
      }
      $$('[data-tpl]').forEach(function (b) {
        b.onclick = function () {
          var t = templates[Number(b.dataset.tpl)];
          var nx = nextLike(t.starts_at, t.timezone);
          g.sport = gameSport(t.sport).k === t.sport ? t.sport : 'other';
          g.format = t.format;
          g.places = t.places;
          g.day = nx.day;
          g.time = nx.time;
          g.place = t.location || '';
          g.weekly = !!t.weekly;
          g.mins = t.minutes || 60;
          g.cost = t.cost || '';
          g.split = !!t.pitch_pence;
          g.pitch = t.pitch_pence ? String(t.pitch_pence / 100) : '';
          g.title = t.title;
          g.titleTouched = true;
          if (t.calendar_id && cals.some(function (c) { return c.id === t.calendar_id; })) g.cal = t.calendar_id;
          g.from = Number(b.dataset.tpl);
          redraw(null);
          toast('Filled in for next ' + new Date(nx.day + 'T' + nx.time).toLocaleDateString('en-GB', { weekday: 'long' }) + '. Check it and create.');
        };
      });
      $$('[data-sport]').forEach(function (b) {
        b.onclick = function () {
          var ns = gameSport(b.dataset.sport);
          g.sport = ns.k;
          g.format = ns.d;
          var f = gameFormat(ns, ns.d);
          g.places = f ? f[2] : ns.places;
          g.mins = ns.mins;
          g.from = null;
          // A past game's name goes with it.
          g.titleTouched = false;
          redraw(open);
        };
      });
      $$('[data-format]').forEach(function (b) {
        b.onclick = function () {
          g.format = b.dataset.format;
          var f = gameFormat(gameSport(g.sport), g.format);
          if (f) g.places = f[2];
          redraw(open);
        };
      });
      $$('[data-row]').forEach(function (b) {
        b.onclick = function () {
          redraw(open === b.dataset.row ? null : b.dataset.row);
        };
      });
      if ($('#ng-place'))
        $('#ng-place').oninput = function () {
          g.place = this.value.trim();
          setText('where', g.place || 'Add a place');
        };
      if ($('#ng-cost'))
        $('#ng-cost').oninput = function () {
          g.cost = this.value.trim();
          setText('cost', costText());
        };
      if ($('#ng-pitch'))
        $('#ng-pitch').oninput = function () {
          g.pitch = this.value.trim();
          setText('cost', costText());
          $('#ng-split-note').textContent = splitNote();
        };
      $$('[data-cmode]').forEach(function (b) {
        b.onclick = function () {
          g.split = b.dataset.cmode === 'split';
          redraw('cost');
        };
      });
      if ($('#ng-date'))
        $('#ng-date').onchange = function () {
          if (this.value) g.day = this.value;
          redraw('when');
        };
      // The phone's own time picker: update the row as it turns, without redrawing (that would close it).
      if ($('#ng-time'))
        $('#ng-time').oninput = $('#ng-time').onchange = function () {
          if (!this.value) return;
          g.time = this.value;
          var w = new Date(g.day + 'T' + g.time);
          if (!isNaN(w.getTime())) setText('when', w.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + g.time);
        };
      $$('[data-chips]').forEach(function (box) {
        var name = box.dataset.chips;
        $$('.ng-chip', box).forEach(function (b) {
          b.onclick = function () {
            var v = b.dataset.v;
            if (name === 'day') {
              if (v === 'pick') {
                $('#ng-date').hidden = false;
                $('#ng-date').focus();
                return;
              }
              g.day = v === 'today' ? ymdLocal(new Date()) : v;
            }
            if (name === 'mins') g.mins = Number(v);
            redraw(open);
          };
        });
      });
      $$('[data-n]').forEach(function (b) {
        b.onclick = function () {
          var n = g.places + Number(b.dataset.n);
          if (n < 2 || n > 40) return;
          g.places = n;
          $('#ng-n').textContent = n;
          $('#ng-sides').textContent = sidesLabel(g.sport, n);
          setText('places', n + ' · ' + sidesLabel(g.sport, n));
        };
      });
      $('#ng-weekly').onchange = function () {
        g.weekly = this.checked;
      };
      $('#ng-create').onclick = function () {
        var button = this;
        var err = $('#ng-err');
        err.hidden = true;
        var start = new Date(g.day + 'T' + g.time);
        var why =
          isNaN(start.getTime()) || start < new Date()
            ? 'Pick a day and time that’s still to come.'
            : g.split && !pitchPence()
              ? 'Type what the pitch costs, like £60 (or choose Price each).'
              : null;
        if (why) {
          err.textContent = why;
          err.hidden = false;
          return;
        }
        setBusy(button, true);
        // No calendar yet (an account made in HQ): games get one of their own.
        (g.cal ? Promise.resolve(g.cal) : rpc('create_calendar', { p_name: 'Games' }))
          .then(function (cal) {
            g.cal = cal;
            return rpc('game_create', {
          p_calendar: g.cal,
          p_title: (g.title || '').trim() || 'Game',
          p_sport: g.sport,
          p_format: g.format,
          p_starts_at: start.toISOString(),
          p_minutes: g.mins,
          p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London',
          p_location: g.place || null,
          p_places: g.places,
          p_cost: g.split ? null : g.cost || null,
          p_weekly: g.weekly,
            });
          })
          .then(function (id) {
            // The pitch fee to split goes on straight after (the game exists by then).
            if (!g.split) return id;
            return rpc('game_set_cost', { p_game: id, p_cost: null, p_pitch_pence: pitchPence() }).then(function () {
              return id;
            });
          })
          .then(
          function (id) {
            go('#/games/' + id + '?made=1');
          },
          function (e) {
            setBusy(button, false);
            err.textContent = friendly(e);
            err.hidden = false;
          },
        );
      };
    }

    // Straight after making a game: share the link (and, once, how to keep HQ
    // on the home screen like an app).
    function drawGameMade(g) {
      var link = SITE + '/g/?c=' + encodeURIComponent(g.code);
      var when = new Date(g.starts_at).toLocaleString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: g.timezone || undefined,
      });
      var text =
        g.title +
        '\n' +
        when +
        (g.location ? '\n' + g.location : '') +
        (g.cost ? '\n' + g.cost : '') +
        '\n\n' +
        g.places +
        ' places, first come first served. Tap to say you’re in:\n' +
        link;
      var standalone = window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      var tipSeen = false;
      try {
        tipSeen = !!localStorage.getItem('dayli_hq_a2hs');
      } catch (e) {
        tipSeen = true;
      }
      var iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
      render(
        '<div class="ng ng-made"><div class="ng-ok">' +
          TICK.replace('width="16" height="16"', 'width="40" height="40"') +
          '</div><h1>Game on</h1><p class="muted">' +
          esc(g.title + ' · ' + when) +
          (g.location ? '<br>' + esc(g.location) : '') +
          '</p><div class="ng-lbl" style="text-align:left">Send this to your group</div><div class="ng-link-box"><span>' +
          esc(link.replace(/^https:\/\//, '')) +
          '</span><button type="button" id="ng-copy">Copy</button></div>' +
          '<a class="btn ng-go ng-wa" target="_blank" rel="noopener" href="https://wa.me/?text=' +
          encodeURIComponent(text) +
          '">Share on WhatsApp</a><a class="btn ng-go" href="#/games/' +
          esc(g.id) +
          '">Open the game</a><p class="muted small">You’re in place 1. People take the rest with the link.</p>' +
          (!standalone && !tipSeen && iphone
            ? '<div class="ng-tip" id="ng-tip"><b>Keep HQ on your home screen</b><div>Opens full screen like an app. No download.</div><ol><li>Tap <b>Share</b> in Safari</li><li>Tap <b>Add to Home Screen</b></li><li>Tap <b>Add</b></li></ol><button type="button" class="btn" id="ng-tip-ok">Got it</button></div>'
            : '') +
          '</div>',
      );
      $('#ng-copy').onclick = function () {
        (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
          function () {
            toast('Link copied');
          },
          function () {
            window.prompt('Copy this link:', link);
          },
        );
      };
      if ($('#ng-tip-ok'))
        $('#ng-tip-ok').onclick = function () {
          try {
            localStorage.setItem('dayli_hq_a2hs', '1');
          } catch (e) {
            /* private mode */
          }
          $('#ng-tip').remove();
        };
    }

    // A game: Invites (playing, no reply, can't play), the Team sheet (the
    // pitch) and Payments, with Share always there. Settings (places, sides,
    // card payments) sit behind the gear.
    var gameTab = 'invites';
    var gameTabFor = null;

    // --- Owed to you: who owes what across your games, like a running tab ---
    function owedDate(iso, long) {
      return new Date(iso).toLocaleDateString('en-GB', long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
    }
    function owedWhatsApp(lines) {
      window.open('https://wa.me/?text=' + encodeURIComponent(lines), '_blank', 'noopener');
    }
    function nudgeOne(r) {
      return rpc('game_owed_nudge', { p_who: r.who }).then(function (res) {
        return { r: r, sent: !!(res && res.sent) };
      });
    }
    function screenOwed() {
      loading();
      rpc('game_owed').then(
        function (rows) {
          rows = rows || [];
          var total = rows.reduce(function (t, r) {
            return t + (r.owed_pence || 0);
          }, 0);
          render(
            '<div class="ow"><h1>Owed to you</h1>' +
              (rows.length
                ? '<div class="ow-total"><div class="grow"><b>' +
                  sgPounds(total) +
                  '</b><span>from ' +
                  rows.length +
                  (rows.length === 1 ? ' person' : ' people') +
                  '</span></div><button type="button" class="btn" id="ow-all">Nudge everyone</button></div>' +
                  '<div class="ow-list">' +
                  rows
                    .map(function (r) {
                      return (
                        '<a class="ow-row" href="#/games/owed?p=' +
                        encodeURIComponent(r.who) +
                        '">' +
                        sgAvatar({ id: r.who, name: r.name, avatar_url: r.avatar_url }, 46) +
                        '<span class="grow"><b>' +
                        esc(r.name) +
                        '</b><small>' +
                        r.games +
                        (r.games === 1 ? ' game' : ' games') +
                        ' · since ' +
                        esc(owedDate(r.since)) +
                        (r.nudged_at ? ' · reminded ' + esc(sgAgo(r.nudged_at)) : '') +
                        '</small></span><span class="ow-amt"><small>owes you</small><b>' +
                        sgPounds(r.owed_pence) +
                        '</b></span></a>'
                      );
                    })
                    .join('') +
                  '</div>'
                : '<div class="ow-none"><b>All settled up</b><p class="muted">Nobody owes you anything. People show here once they’ve played (or the price is locked) and haven’t paid.</p></div>') +
              '</div>',
          );
          if (!$('#ow-all')) return;
          $('#ow-all').onclick = function () {
            var button = this;
            if (!confirm('Remind everyone who owes you? People on Dayli get a notification; for the rest, a WhatsApp message opens.')) return;
            setBusy(button, true, 'Nudging…');
            Promise.all(
              rows.map(function (r) {
                return nudgeOne(r).catch(function () {
                  return { r: r, sent: false, skipped: true };
                });
              }),
            ).then(function (res) {
              setBusy(button, false);
              var sent = res.filter(function (x) {
                return x.sent;
              }).length;
              var rest = res.filter(function (x) {
                return !x.sent && !x.skipped && !x.r.user_id;
              });
              toast(sent ? 'Reminded ' + sent + ' on Dayli' : 'Nobody new to remind on Dayli (each person once every 12 hours)');
              if (rest.length) {
                owedWhatsApp(
                  'Still to pay for the games: ' +
                    rest
                      .map(function (x) {
                        return sgFirst(x.r.name) + ' ' + sgPounds(x.r.owed_pence);
                      })
                      .join(', ') +
                    '. Thanks!',
                );
              }
              screenOwed();
            });
          };
        },
        function (err) {
          render(notice('error', esc(friendly(err))));
        },
      );
    }
    function screenOwedPerson(who) {
      loading();
      rpc('game_owed_person', { p_who: who }).then(
        function (d) {
          if (!d) return go('#/games/owed');
          var games = d.games || [];
          var owed = games.filter(function (x) {
            return x.owed;
          });
          render(
            '<div class="ow"><a class="ow-back" href="#/games/owed">‹ Owed to you</a>' +
              '<div class="ow-head">' +
              sgAvatar({ id: d.who, name: d.name, avatar_url: d.avatar_url }, 64) +
              '<div><h1>' +
              esc(d.name) +
              '</h1>' +
              (d.owed_pence
                ? '<p class="ow-owes">owes you <b>' + sgPounds(d.owed_pence) + '</b></p><p class="muted small">Owed since ' + esc(owedDate(d.since, true)) + (d.nudged_at ? ' · reminded ' + esc(sgAgo(d.nudged_at)) : '') + '</p>'
                : '<p class="ow-owes settled">All settled up</p>') +
              '</div></div>' +
              (d.owed_pence
                ? '<div class="ow-btns"><button type="button" class="btn primary" id="ow-nudge">' +
                  (d.user_id ? 'Nudge in Dayli' : 'Remind on WhatsApp') +
                  '</button><button type="button" class="btn" id="ow-settle">Settle up (paid cash)</button></div>'
                : '') +
              '<h2 class="ow-h2">Games</h2><div class="ow-games">' +
              games
                .map(function (x) {
                  var st = x.paid === 'card' ? ['paid', 'Paid by card'] : x.paid ? ['paid', 'Paid cash'] : x.owed ? ['owe', 'Not paid'] : ['soon', 'Not due yet'];
                  return (
                    '<div class="ow-game"><a class="grow" href="#/games/' +
                    esc(x.game_id) +
                    '"><b>' +
                    esc(x.title) +
                    '</b><small>' +
                    esc(owedDate(x.starts_at, true)) +
                    '</small></a><span class="ow-gamt">' +
                    (x.amount ? sgPounds(x.amount) : '') +
                    '</span><span class="ow-st ' +
                    st[0] +
                    '">' +
                    st[1] +
                    '</span>' +
                    (x.owed ? '<button type="button" class="act" data-paid="' + esc(x.place_id) + '">Paid</button>' : '') +
                    '</div>'
                  );
                })
                .join('') +
              '</div>' +
              (owed.length ? '<p class="muted small">Tap Paid when they give you cash for a game. Card payments tick themselves off.</p>' : '') +
              '</div>',
          );
          if ($('#ow-nudge'))
            $('#ow-nudge').onclick = function () {
              var button = this;
              setBusy(button, true);
              nudgeOne(d).then(
                function (x) {
                  setBusy(button, false);
                  if (x.sent) toast(sgFirst(d.name) + ' has been reminded in Dayli');
                  else
                    owedWhatsApp(
                      'Hi ' +
                        sgFirst(d.name) +
                        ', a reminder: ' +
                        sgPounds(d.owed_pence) +
                        ' for ' +
                        owed
                          .map(function (o) {
                            return o.title + ' (' + owedDate(o.starts_at) + ')';
                          })
                          .join(', ') +
                        '. Thanks!',
                    );
                  screenOwedPerson(who);
                },
                function (err) {
                  setBusy(button, false);
                  toast(String(err && err.message).indexOf('rate_limited') >= 0 ? 'Already reminded in the last 12 hours.' : friendly(err));
                },
              );
            };
          if ($('#ow-settle'))
            $('#ow-settle').onclick = function () {
              if (!confirm('Mark everything ' + sgFirst(d.name) + ' owes (' + sgPounds(d.owed_pence) + ') as paid in cash?')) return;
              var button = this;
              setBusy(button, true);
              rpc('game_owed_settle', { p_who: who }).then(
                function () {
                  toast(sgFirst(d.name) + ' is settled up');
                  screenOwedPerson(who);
                },
                function (err) {
                  setBusy(button, false);
                  toast(friendly(err));
                },
              );
            };
          $$('[data-paid]').forEach(function (b) {
            b.onclick = function () {
              setBusy(b, true);
              rpc('game_mark_paid', { p_place: b.dataset.paid, p_paid: 'cash' }).then(
                function () {
                  screenOwedPerson(who);
                },
                function (err) {
                  setBusy(b, false);
                  toast(friendly(err));
                },
              );
            };
          });
        },
        function (err) {
          render(notice('error', esc(friendly(err))));
        },
      );
    }

    // A sheet from the bottom (a panel on wide screens). Returns close().
    function sgSheet(html, cls) {
      var dim = document.createElement('div');
      dim.className = 'gs-dim';
      var box = document.createElement('div');
      box.className = 'gs-sheet ' + (cls || '');
      box.innerHTML = '<div class="gs-grab"></div>' + html;
      document.body.appendChild(dim);
      document.body.appendChild(box);
      function close() {
        dim.remove();
        box.remove();
        document.removeEventListener('keydown', onKey);
      }
      function onKey(e) {
        if (e.key === 'Escape') close();
      }
      dim.onclick = close;
      document.addEventListener('keydown', onKey);
      return { el: box, close: close };
    }
    // A short list of things to do with someone.
    function sgActions(title, items) {
      var s = sgSheet(
        '<div class="gs-acts"><p class="muted small">' +
          esc(title) +
          '</p>' +
          items
            .map(function (x, i) {
              return '<button type="button" class="gs-act' + (x[2] ? ' red' : '') + '" data-i="' + i + '">' + esc(x[0]) + '</button>';
            })
            .join('') +
          '<button type="button" class="gs-act cancel" data-i="-1">Cancel</button></div>',
        'gs-small',
      );
      $$('[data-i]', s.el).forEach(function (b) {
        b.onclick = function () {
          s.close();
          var it = items[Number(b.dataset.i)];
          if (it) it[1]();
        };
      });
    }
    function sgAgo(iso) {
      if (!iso) return '';
      var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return m + 'm ago';
      if (m < 60 * 24) return Math.round(m / 60) + 'h ago';
      return Math.round(m / 1440) + 'd ago';
    }
    function sgFirst(name) {
      return String(name || '').split(/\s+/)[0] || name;
    }

    function drawGame(g, mine) {
      if (gameTabFor !== g.id) {
        gameTabFor = g.id;
        // A played game opens on the Team sheet, where the score goes.
        gameTab = g.ends_at && new Date(g.ends_at) < new Date() ? 'teams' : 'invites';
      }
      var players = g.players || [];
      var inn = players.filter(function (p) {
        return p.status === 'in';
      });
      var waiting = players.filter(function (p) {
        return p.status === 'waiting';
      });
      var invites = g.invites || [];
      var noReply = invites.filter(function (p) {
        return p.status === 'invited';
      });
      var cant = invites.filter(function (p) {
        return p.status === 'no';
      });
      var places = g.places;
      var bibs = g.bibs && g.bibs < places ? g.bibs : Math.floor(places / 2);
      // Each person's price: their share of the pitch when it's split.
      var price = g.pitch_pence ? g.share_pence : g.price_pence || sgPrice(g.cost);
      var link = SITE + '/g/?c=' + encodeURIComponent(g.code);
      var when = new Date(g.starts_at).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: g.timezone || undefined,
      });
      var at = new Date(g.starts_at).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: g.timezone || undefined,
      });

      // Sides: whoever has none yet goes into a free spot (bibs first).
      var side = {};
      var placed = 0;
      inn.forEach(function (p) {
        side[p.id] = p.side || null;
      });
      inn.forEach(function (p) {
        if (side[p.id]) return;
        var nb = inn.filter(function (x) {
          return side[x.id] === 'bibs';
        }).length;
        side[p.id] = nb < bibs ? 'bibs' : 'colours';
        placed++;
      });
      var dirty = placed > 0;
      var undoSide = null;
      var chosen = null; // 'fair' or 'random' once Dayli has chosen
      var played = g.ends_at && new Date(g.ends_at) < new Date();

      function refreshGame() {
        rpc('game_view', { p_game: g.id }).then(
          function (ng) {
            if (!ng) return loadGames(g.id);
            var y = window.scrollY;
            drawGame(ng, mine);
            window.scrollTo(0, y);
          },
          function () {
            loadGames(g.id);
          },
        );
      }
      function move(p, to, done) {
        rpc('game_move', { p_place: p.id, p_to: to }).then(
          function () {
            if (done) toast(done);
            refreshGame();
          },
          function (err) {
            toast(friendly(err));
          },
        );
      }
      function refund(placeId, name, amount) {
        if (!confirm('Give ' + name + ' all ' + sgPounds(amount) + ' back? It reaches their card in 5 to 10 days.')) return;
        invoke('game-pay', { action: 'refund', place_id: placeId }).then(
          function () {
            toast(name + ' refunded');
            refreshGame();
          },
          function (err) {
            toast(friendly(err));
          },
        );
      }
      function share() {
        var text =
          g.title +
          ', ' +
          when +
          ' ' +
          at +
          (g.location ? ' at ' + g.location : '') +
          (price ? ', ' + sgPounds(price) + ' each' : '') +
          '. Tap to say if you’re in: ' +
          link;
        if (navigator.share && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
          navigator.share({ text: text }).catch(function () {
            return null;
          });
          return;
        }
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
      }

      // --- the three tabs ---
      function item(p, sub) {
        return (
          '<button type="button" class="gi-it" data-who="' +
          esc(p.id) +
          '">' +
          sgAvatar(p, 24) +
          '<span><b>' +
          esc(sgFirst(p.name)) +
          '</b>' +
          (sub ? '<small>' + esc(sub) + '</small>' : '') +
          '</span></button>'
        );
      }
      function col(cls, label, n, body, foot) {
        return (
          '<div class="gi-col ' +
          cls +
          '"><div class="gi-h"><b>' +
          n +
          '</b>' +
          label +
          '</div><div class="gi-body">' +
          (body || '<p class="gi-empty">Nobody yet</p>') +
          '</div>' +
          (foot || '') +
          '</div>'
        );
      }
      function tabInvites() {
        var pct = Math.min(100, Math.round((inn.length / places) * 100));
        var full = inn.length >= places;
        return (
          '<div class="gi-top"><div class="grow"><b>' +
          inn.length +
          ' of ' +
          places +
          ' playing</b><div class="gi-bar"><i style="width:' +
          pct +
          '%"></i></div></div><button type="button" class="btn gi-add" id="gi-add">+ Add players</button></div>' +
          '<div class="gi-cols">' +
          col(
            'yes',
            'PLAYING',
            inn.length,
            inn
              .map(function (p) {
                return item(p, p.user_id && p.user_id === g.organiser_id ? 'You' : '');
              })
              .join('') +
              (waiting.length
                ? '<div class="gi-wl"><b>Waiting list · ' +
                  waiting.length +
                  '</b>' +
                  waiting
                    .map(function (p) {
                      return item(p, 'said yes ' + sgAgo(p.at));
                    })
                    .join('') +
                  '</div>'
                : ''),
            full && !waiting.length ? '<p class="gi-foot muted">Full</p>' : '',
          ) +
          col(
            'pend',
            'NO REPLY',
            noReply.length,
            noReply
              .map(function (p) {
                return item(p, p.guest ? 'WhatsApp' : 'Asked ' + sgAgo(p.at));
              })
              .join(''),
            noReply.some(function (p) {
              return !p.guest;
            })
              ? '<button type="button" class="gi-foot act" id="gi-nudge">Nudge all</button>'
              : '',
          ) +
          col(
            'no',
            'CAN’T PLAY',
            cant.length,
            cant
              .map(function (p) {
                return item(p, sgAgo(p.at));
              })
              .join(''),
          ) +
          '</div><p class="muted small gi-help">Tap someone to move them. People who say yes on the link join your regulars.</p>'
        );
      }
      function tabTeams() {
        function half(top) {
          var mine2 = inn.filter(function (p) {
            return side[p.id] === (top ? 'bibs' : 'colours');
          });
          var cap = Math.max(top ? bibs : places - bibs, mine2.length);
          var spots = sgHalf(cap, top);
          return spots
            .map(function (s, i) {
              var p = mine2[i];
              var pos = 'left:' + s.x.toFixed(1) + '%;top:' + s.y.toFixed(1) + '%';
              if (!p) return '<div class="sg-free" style="' + pos + '">+</div>';
              return (
                '<button type="button" class="sg-pp' +
                (top ? ' b' : '') +
                '" data-p="' +
                esc(p.id) +
                '" style="' +
                pos +
                '">' +
                sgAvatar(p, 38) +
                '<b>' +
                esc(sgShort(p.name)) +
                '</b>' +
                (p.paid || !price ? '' : '<i class="sg-owe">' + sgPounds(price) + '</i>') +
                '</button>'
              );
            })
            .join('');
        }
        var nb = inn.filter(function (p) {
          return side[p.id] === 'bibs';
        }).length;
        var scoreCard = !played
          ? ''
          : g.score_bibs != null
            ? '<div class="gt-score done"><span class="grow">Final score <b>Bibs ' +
              g.score_bibs +
              ' – ' +
              g.score_colours +
              ' Colours</b></span><button type="button" class="linkish" id="gt-score">Change</button></div>'
            : inn.length > 1
              ? '<div class="gt-score"><span class="grow"><b>How did it finish?</b><small>Dayli uses the score to make the next teams fair.</small></span><button type="button" class="btn primary" id="gt-score">Add the score</button></div>'
              : '';
        var dayliCard = played
          ? ''
          : chosen
          ? '<div class="gt-chosen"><span class="gt-spark">✦</span><span class="grow">' +
            (chosen === 'fair' ? 'Fair teams chosen from past results' : 'Teams split at random: save the score after games and Dayli makes them fairer') +
            '</span><button type="button" class="linkish" id="gt-again">Again</button></div>'
          : '<div class="gt-dayli"><span class="gt-spark big">✦</span><span class="grow"><b>Let Dayli choose the teams</b><small>Dayli looks at everyone’s past results and splits them into two even sides.</small></span></div>' +
            '<button type="button" class="btn primary gt-choose" id="gt-choose"' +
            (inn.length < 2 ? ' disabled' : '') +
            '>✦ Choose fair teams</button>';
        return (
          scoreCard +
          dayliCard +
          sgCourt(g.sport) +
          '<span class="sg-sl" style="top:10px">BIBS · ' +
          nb +
          ' of ' +
          bibs +
          '</span><span class="sg-sl" style="bottom:10px">COLOURS · ' +
          (inn.length - nb) +
          ' of ' +
          (places - bibs) +
          '</span>' +
          half(true) +
          half(false) +
          '</div><p class="muted small gt-help">' +
          (inn.length ? 'Tap a player to swap sides. ' : 'When people say yes they take a spot here. ') +
          (dirty ? '<b class="ink">Save the teams so everyone sees them.</b>' : g.sides_set ? 'Everyone sees these teams.' : '') +
          '</p><div class="gt-btns">' +
          (undoSide ? '<button type="button" class="btn" id="gt-undo">Undo</button>' : '') +
          '<button type="button" class="btn primary" id="gt-save"' +
          (dirty ? '' : ' disabled') +
          '>' +
          (g.sides_set ? 'Save the teams' : 'Save and show the teams') +
          '</button></div><button type="button" class="gt-mix" id="gt-mix">⇄ Mix them up at random</button>'
        );
      }
      function tabPay() {
        var paid = inn.filter(function (p) {
          return p.paid;
        });
        var owing = inn.filter(function (p) {
          return !p.paid;
        });
        var pct = inn.length ? Math.round((paid.length / inn.length) * 100) : 0;
        var left = g.left_paid || [];
        var lock = !g.pitch_pence
          ? ''
          : g.locked_at
            ? '<div class="gp-lock on"><span class="grow"><b>Price locked at ' +
              sgPounds(price) +
              ' each</b><small>' +
              (g.pay_pence ? 'Players can pay it by card on the link. ' : '') +
              'What each player owes from now on.</small></span><button type="button" class="btn" id="gp-unlock">Unlock</button></div>'
            : '<div class="gp-lock"><span class="grow"><b>' +
              sgPounds(price) +
              ' each with ' +
              Math.max(1, inn.length) +
              ' playing</b><small>It changes as people say yes. It locks by itself after the game, or lock it now.</small></span><button type="button" class="btn primary" id="gp-lock">Lock the price</button></div>';
        return (
          lock +
          '<div class="gi-top"><div class="grow"><b>' +
          (g.pitch_pence
            ? sgPounds(price * paid.length) + ' of the ' + sgPounds(g.pitch_pence) + ' pitch paid'
            : price
              ? sgPounds(price * paid.length) + ' of ' + sgPounds(price * inn.length) + ' paid'
              : paid.length + ' of ' + inn.length + ' paid') +
          '</b><div class="gi-bar"><i style="width:' +
          pct +
          '%"></i></div></div></div>' +
          '<div class="gi-cols two">' +
          col(
            'yes',
            'PAID',
            paid.length,
            paid
              .map(function (p) {
                return item(p, p.paid === 'card' ? 'Card' : 'Cash');
              })
              .join('') +
              (left.length
                ? '<div class="gi-wl"><b>Left after paying</b>' +
                  left
                    .map(function (p) {
                      return (
                        '<button type="button" class="gi-it" data-refund="' +
                        esc(p.id) +
                        '" data-name="' +
                        esc(p.name) +
                        '" data-amount="' +
                        Number(p.amount_pence) +
                        '">' +
                        sgAvatar(p, 24) +
                        '<span><b>' +
                        esc(sgFirst(p.name)) +
                        '</b><small>Tap to refund ' +
                        sgPounds(p.amount_pence) +
                        '</small></span></button>'
                      );
                    })
                    .join('') +
                  '</div>'
                : ''),
          ) +
          col(
            'owe',
            'NOT PAID',
            owing.length,
            owing
              .map(function (p) {
                return item(p, price ? sgPounds(price) : '');
              })
              .join(''),
            owing.length ? '<button type="button" class="gi-foot act" id="gp-remind">Remind them</button>' : '',
          ) +
          '</div><p class="muted small gi-help">Tap a name to mark them paid or not paid. Card payments come in by themselves.' +
          (g.payments_on && !g.price_pence ? ' <button type="button" class="linkish" id="gp-card">Take card payments</button>' : '') +
          '</p>'
        );
      }

      function draw() {
        var tabs = [
          ['invites', 'Invites', ICON.squad],
          ['teams', 'Team sheet', ICON.ball],
          ['pay', 'Payments', '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/>'],
        ];
        render(
          '<div class="gm">' +
            '<div class="gm-head"><div class="grow">' +
            '<a class="gm-back" href="#/games">‹ Games</a>' +
            '<h1>' +
            esc(g.title) +
            '</h1><div class="muted gm-meta">' +
            esc([when, at, g.location, g.cost ? (g.pitch_pence ? g.cost : g.cost + ' each') : null].filter(Boolean).join(' · ')) +
            '</div></div><div class="gm-tools"><a class="gm-tool" href="#/games/new" title="New game" aria-label="New game">+</a><button type="button" class="gm-tool" id="gm-gear" title="Settings" aria-label="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg></button></div></div>' +
            '<nav class="gm-tabs">' +
            tabs
              .map(function (t) {
                return (
                  '<button type="button" class="' +
                  (gameTab === t[0] ? 'on' : '') +
                  '" data-tab="' +
                  t[0] +
                  '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                  t[2] +
                  '</svg><span>' +
                  t[1] +
                  '</span></button>'
                );
              })
              .join('') +
            '<button type="button" class="share" id="gm-share"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.5-.3.4c-.1.1-.2.3-.1.5.5.8 1 1.4 1.7 2 .8.7 1.5.9 1.7 1 .2.1.4.1.5-.1l.8-.9c.2-.2.3-.2.5-.1l1.9.9c.3.1.4.2.5.3 0 .2 0 .7-.2 1.3z"/></svg><span>Share</span></button></nav>' +
            '<div class="gm-body">' +
            (gameTab === 'teams' ? tabTeams() : gameTab === 'pay' ? tabPay() : tabInvites()) +
            '</div></div>',
        );
        wire();
      }

      function find(id) {
        return players.concat(invites).filter(function (x) {
          return x.id === id;
        })[0];
      }
      function whoMenu(p) {
        var first = sgFirst(p.name);
        var me = p.user_id && p.user_id === g.organiser_id;
        if (p.status === 'in') {
          return sgActions(p.name + ' · playing', [
            [me ? 'I can’t play' : first + ' can’t play', function () { move(p, 'no', p.name + ' can’t play'); }],
            ['Take ' + (me ? 'me' : first) + ' out of the game', function () { move(p, 'out', p.name + ' is out'); }, true],
          ]);
        }
        if (p.status === 'waiting') {
          var full = inn.length >= places;
          var n = inn.length + 1;
          var b2 = Math.min(bibs, n - 1);
          return sgActions(p.name + ' · on the waiting list', [
            ['Put ' + first + ' in' + (full ? ' (makes it ' + Math.max(b2, n - b2) + ' v ' + Math.min(b2, n - b2) + ')' : ''), function () { move(p, 'in', first + ' is playing'); }],
            ['Take ' + first + ' off the list', function () { move(p, 'out'); }, true],
          ]);
        }
        if (p.status === 'invited') {
          return sgActions(p.name + ' · no reply yet', [
            [first + ' is playing', function () { move(p, 'in', first + ' is playing'); }],
            [first + ' can’t play', function () { move(p, 'no'); }],
            ['Remove the invite', function () { move(p, 'out'); }, true],
          ]);
        }
        return sgActions(p.name + ' · can’t play', [
          [first + ' is playing after all', function () { move(p, 'in', first + ' is playing'); }],
          ['Remove from the list', function () { move(p, 'out'); }, true],
        ]);
      }
      function payMenu(p) {
        if (p.paid === 'card') return refund(p.id, p.name, g.pay_pence || price);
        var to = p.paid ? null : 'cash';
        if (!to && !confirm('Mark ' + p.name + ' as not paid?')) return;
        p.paid = to;
        draw();
        rpc('game_mark_paid', { p_place: p.id, p_paid: to }).then(null, function (err) {
          p.paid = to ? null : 'cash';
          draw();
          toast(friendly(err));
        });
      }

      function wire() {
        $$('[data-tab]').forEach(function (b) {
          b.onclick = function () {
            gameTab = b.dataset.tab;
            draw();
            window.scrollTo(0, 0);
          };
        });
        $('#gm-share').onclick = share;
        $('#gm-gear').onclick = settings;
        $$('[data-who]').forEach(function (b) {
          b.onclick = function () {
            var p = find(b.dataset.who);
            if (!p) return;
            if (gameTab === 'pay') return payMenu(p);
            whoMenu(p);
          };
        });
        $$('[data-refund]').forEach(function (b) {
          b.onclick = function () {
            refund(b.dataset.refund, b.dataset.name, Number(b.dataset.amount));
          };
        });
        if ($('#gi-add')) $('#gi-add').onclick = addPlayers;
        if ($('#gi-nudge'))
          $('#gi-nudge').onclick = function () {
            var button = this;
            setBusy(button, true, 'Nudging…');
            rpc('game_nudge', { p_game: g.id }).then(
              function (n) {
                setBusy(button, false);
                toast(n ? 'Nudged ' + n + ' on Dayli' + (noReply.some(function (p) { return p.guest; }) ? '. Share the link for the rest.' : '') : 'Nobody to nudge on Dayli. Share the link instead.');
              },
              function (err) {
                setBusy(button, false);
                toast(String(err && err.message).indexOf('rate_limited') >= 0 ? 'You nudged them recently. Try again in a few hours.' : friendly(err));
              },
            );
          };
        $$('.sg-pp[data-p]').forEach(function (el) {
          el.onclick = function () {
            var id = el.dataset.p;
            side[id] = side[id] === 'bibs' ? 'colours' : 'bibs';
            dirty = true;
            draw();
          };
        });
        function keepUndo() {
          undoSide = Object.assign({}, side);
        }
        function randomSplit() {
          var ids = inn
            .map(function (p) {
              return p.id;
            })
            .sort(function () {
              return Math.random() - 0.5;
            });
          var nb = Math.round((ids.length * bibs) / places);
          ids.forEach(function (id, i) {
            side[id] = i < nb ? 'bibs' : 'colours';
          });
        }
        // Two sides whose average ratings are as close as possible: many
        // shuffled snake drafts, each improved by swapping pairs; then one of
        // the best at random (so Again gives another fair split).
        function fairSplit(ratings) {
          var ids = inn.map(function (p) {
            return p.id;
          });
          var nb = Math.round((ids.length * bibs) / places);
          var r = function (id) {
            return Number(ratings[id]) || 1000;
          };
          function gap(b, c) {
            var sb = 0;
            var sc = 0;
            b.forEach(function (id) {
              sb += r(id);
            });
            c.forEach(function (id) {
              sc += r(id);
            });
            return Math.abs(sb / Math.max(1, b.length) - sc / Math.max(1, c.length));
          }
          var tries = [];
          for (var t = 0; t < 40; t++) {
            var order = ids.slice().sort(function (x, y) {
              return r(y) + Math.random() * 30 - (r(x) + Math.random() * 30);
            });
            var b = [];
            var c = [];
            order.forEach(function (id, i) {
              var toB = Math.floor(i / 2) % 2 === 0 ? i % 2 === 0 : i % 2 === 1;
              if ((toB && b.length < nb) || c.length >= ids.length - nb) b.push(id);
              else c.push(id);
            });
            for (var round = 0, better = true; better && round < 20; round++) {
              better = false;
              for (var i = 0; i < b.length; i++) {
                for (var j = 0; j < c.length; j++) {
                  var nb2 = b.slice();
                  var nc2 = c.slice();
                  nb2[i] = c[j];
                  nc2[j] = b[i];
                  if (gap(nb2, nc2) + 0.01 < gap(b, c)) {
                    b = nb2;
                    c = nc2;
                    better = true;
                  }
                }
              }
            }
            tries.push({ b: b, c: c, gap: gap(b, c) });
          }
          tries.sort(function (x, y) {
            return x.gap - y.gap;
          });
          var good = tries.filter(function (x) {
            return x.gap <= tries[0].gap + 4;
          });
          var pick = good[Math.floor(Math.random() * good.length)];
          pick.b.forEach(function (id) {
            side[id] = 'bibs';
          });
          pick.c.forEach(function (id) {
            side[id] = 'colours';
          });
        }
        function choose(button) {
          if (button) setBusy(button, true, 'Choosing…');
          rpc('game_ratings', { p_game: g.id }).then(
            function (res) {
              keepUndo();
              if (res && res.scored) {
                fairSplit(res.ratings || {});
                chosen = 'fair';
              } else {
                randomSplit();
                chosen = 'random';
              }
              dirty = true;
              draw();
            },
            function (err) {
              if (button) setBusy(button, false);
              toast(friendly(err));
            },
          );
        }
        if ($('#gt-choose'))
          $('#gt-choose').onclick = function () {
            choose(this);
          };
        if ($('#gt-again'))
          $('#gt-again').onclick = function () {
            choose(null);
          };
        if ($('#gt-undo'))
          $('#gt-undo').onclick = function () {
            side = undoSide;
            undoSide = null;
            chosen = null;
            draw();
          };
        if ($('#gt-mix'))
          $('#gt-mix').onclick = function () {
            keepUndo();
            randomSplit();
            chosen = null;
            dirty = true;
            draw();
          };
        if ($('#gt-score'))
          $('#gt-score').onclick = function () {
            var sb = g.score_bibs != null ? g.score_bibs : 0;
            var sc = g.score_colours != null ? g.score_colours : 0;
            var sh = sgSheet(
              '<div class="gs-head"><b>How did it finish?</b><button type="button" class="linkish" data-close>Close</button></div>' +
                '<p class="muted small" style="margin:0 0 8px">Dayli uses the score to make the next teams fair.</p>' +
                '<div class="gt-sc"><div class="b"><small>BIBS</small><span><button type="button" data-s="b" data-d="-1">−</button><b id="gt-sb">' +
                sb +
                '</b><button type="button" data-s="b" data-d="1">+</button></span></div><i>v</i><div class="c"><small>COLOURS</small><span><button type="button" data-s="c" data-d="-1">−</button><b id="gt-sc">' +
                sc +
                '</b><button type="button" data-s="c" data-d="1">+</button></span></div></div>' +
                '<button type="button" class="btn primary gs-wide" id="gt-ssave">Save the score</button>' +
                (g.score_bibs != null ? '<button type="button" class="btn gs-wide" id="gt-sclear">Remove the score</button>' : ''),
              'gs-small',
            );
            $('[data-close]', sh.el).onclick = sh.close;
            $$('[data-s]', sh.el).forEach(function (b) {
              b.onclick = function () {
                if (b.dataset.s === 'b') sb = Math.max(0, Math.min(99, sb + Number(b.dataset.d)));
                else sc = Math.max(0, Math.min(99, sc + Number(b.dataset.d)));
                $('#gt-sb', sh.el).textContent = sb;
                $('#gt-sc', sh.el).textContent = sc;
              };
            });
            function saveScore(x, y, button) {
              setBusy(button, true);
              // The teams on the pitch are the ones the score is for.
              (g.sides_set && !dirty ? Promise.resolve() : rpc('game_set_sides', { p_game: g.id, p_sides: side }))
                .then(function () {
                  return rpc('game_set_score', { p_game: g.id, p_bibs: x, p_colours: y });
                })
                .then(
                function () {
                  sh.close();
                  toast(x === null ? 'Score removed' : 'Score saved: Bibs ' + x + ' – ' + y + ' Colours');
                  refreshGame();
                },
                function (err) {
                  setBusy(button, false);
                  toast(friendly(err));
                },
              );
            }
            $('#gt-ssave', sh.el).onclick = function () {
              saveScore(sb, sc, this);
            };
            if ($('#gt-sclear', sh.el))
              $('#gt-sclear', sh.el).onclick = function () {
                saveScore(null, null, this);
              };
          };
        if ($('#gt-save'))
          $('#gt-save').onclick = function () {
            var button = this;
            setBusy(button, true);
            rpc('game_set_sides', { p_game: g.id, p_sides: side }).then(
              function () {
                toast('Teams saved. Everyone sees them in Dayli.');
                refreshGame();
              },
              function (err) {
                setBusy(button, false);
                toast(friendly(err));
              },
            );
          };
        if ($('#gp-remind'))
          $('#gp-remind').onclick = function () {
            var owe = inn
              .filter(function (p) {
                return !p.paid;
              })
              .map(function (p) {
                return sgFirst(p.name);
              });
            var text =
              g.title +
              ' (' +
              when +
              ')' +
              (price ? ': ' + sgPounds(price) + ' each' : '') +
              '. Still to pay: ' +
              owe.join(', ') +
              (g.pay_pence ? '. Pay by card here: ' + link : '') +
              '. Thanks!';
            window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
          };
        if ($('#gp-card')) $('#gp-card').onclick = settings;
        function lockPrice(on, button) {
          setBusy(button, true);
          rpc('game_lock_price', { p_game: g.id, p_lock: on }).then(
            function () {
              toast(on ? 'Price locked at ' + sgPounds(price) + ' each' : 'Unlocked: the share follows the numbers again');
              refreshGame();
            },
            function (err) {
              setBusy(button, false);
              toast(
                String(err && err.message).indexOf('paid_by_card') >= 0
                  ? 'Someone has paid by card at this price, so it stays locked.'
                  : friendly(err),
              );
            },
          );
        }
        if ($('#gp-lock'))
          $('#gp-lock').onclick = function () {
            if (!confirm('Lock the price at ' + sgPounds(price) + ' each? It won’t change if more people say yes.')) return;
            lockPrice(true, this);
          };
        if ($('#gp-unlock'))
          $('#gp-unlock').onclick = function () {
            lockPrice(false, this);
          };
      }

      // --- Add players: your regulars to invite, or a new name straight in ---
      function addPlayers() {
        var s = sgSheet(
          '<div class="gs-head"><b>Add players</b><button type="button" class="linkish" data-close>Close</button></div>' +
            '<input type="text" id="ga-q" class="ng-inp" maxlength="40" placeholder="Search, or type a new name" autocomplete="off" />' +
            '<div id="ga-new"></div><div class="gs-head small"><span class="muted">YOUR REGULARS</span><button type="button" class="linkish" id="ga-all" hidden>Select all</button></div>' +
            '<div class="ga-list" id="ga-list"><div class="loading-screen small"><img class="spin-mark" src="../img/logo.svg" alt="" /></div></div>' +
            '<button type="button" class="btn primary ga-go" id="ga-go" disabled>Invite</button>' +
            '<p class="muted small ga-note">Dayli users get a notification. Anyone else: tap Share and send the link to your group.</p>',
          'gs-tall',
        );
        var regs = [];
        var picked = {};
        var q = '';
        function key(r) {
          return r.user_id || 'n:' + String(r.name).toLowerCase();
        }
        function list() {
          var shown = regs.filter(function (r) {
            return !q || String(r.name).toLowerCase().indexOf(q.toLowerCase()) >= 0;
          });
          $('#ga-list', s.el).innerHTML = shown.length
            ? shown
                .map(function (r) {
                  var k = key(r);
                  return (
                    '<button type="button" class="ga-row' +
                    (picked[k] ? ' on' : '') +
                    '" data-k="' +
                    esc(k) +
                    '"><span class="ga-ck"></span>' +
                    sgAvatar({ id: k, name: r.name, avatar_url: r.avatar_url }, 34) +
                    '<span class="grow"><b>' +
                    esc(r.name) +
                    '</b><small>' +
                    (r.played ? 'Played ' + r.played + (r.played === 1 ? ' time' : ' times') : 'New regular') +
                    '</small></span><em class="' +
                    (r.user_id ? 'app' : '') +
                    '">' +
                    (r.user_id ? 'Dayli' : 'WhatsApp') +
                    '</em></button>'
                  );
                })
                .join('')
            : '<p class="muted small">' +
              (regs.length ? 'No regular called that.' : 'No regulars yet. Everyone who plays in your games (or says yes on the link) joins this list.') +
              '</p>';
          var exact = regs.some(function (r) {
            return String(r.name).toLowerCase() === q.trim().toLowerCase();
          });
          $('#ga-new', s.el).innerHTML =
            q.trim().length > 1 && !exact
              ? '<button type="button" class="ga-newbtn" id="ga-name">+ Add “' + esc(q.trim()) + '” to Playing</button>'
              : '';
          var n = Object.keys(picked).length;
          $('#ga-go', s.el).disabled = !n;
          $('#ga-go', s.el).textContent = n ? 'Invite ' + n + (n === 1 ? ' player' : ' players') : 'Invite';
          $('#ga-all', s.el).hidden = !regs.length;
          $$('[data-k]', s.el).forEach(function (b) {
            b.onclick = function () {
              if (picked[b.dataset.k]) delete picked[b.dataset.k];
              else picked[b.dataset.k] = true;
              list();
            };
          });
          if ($('#ga-name', s.el))
            $('#ga-name', s.el).onclick = function () {
              var name = q.trim();
              var button = this;
              setBusy(button, true);
              rpc('game_add_name', { p_game: g.id, p_name: name }).then(
                function (r) {
                  s.close();
                  toast(r && r.status === 'waiting' ? name + ' is on the waiting list (the game is full)' : name + ' is playing');
                  refreshGame();
                },
                function (err) {
                  setBusy(button, false);
                  toast(friendly(err));
                },
              );
            };
        }
        $('[data-close]', s.el).onclick = s.close;
        $('#ga-q', s.el).oninput = function () {
          q = this.value;
          list();
        };
        $('#ga-all', s.el).onclick = function () {
          regs.forEach(function (r) {
            picked[key(r)] = true;
          });
          list();
        };
        $('#ga-go', s.el).onclick = function () {
          var users = [];
          var names = [];
          regs.forEach(function (r) {
            if (!picked[key(r)]) return;
            if (r.user_id) users.push(r.user_id);
            else names.push(r.name);
          });
          var button = this;
          setBusy(button, true, 'Inviting…');
          rpc('game_invite_people', { p_game: g.id, p_users: users, p_names: names }).then(
            function (n) {
              s.close();
              toast(
                (n ? 'Invited ' + n : 'Already invited') +
                  (names.length ? '. Share the link so ' + names.map(sgFirst).slice(0, 3).join(', ') + (names.length > 3 ? ' and others' : '') + ' see it.' : ''),
              );
              gameTab = 'invites';
              refreshGame();
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
        };
        rpc('game_regulars', { p_game: g.id }).then(
          function (rows) {
            regs = rows || [];
            list();
          },
          function () {
            regs = [];
            list();
          },
        );
      }

      // --- Settings: places, sides, card payments ---
      function settings() {
        var p0 = places;
        var b0 = bibs;
        var s = sgSheet(
          '<div class="gs-head"><b>Game settings</b><button type="button" class="linkish" data-close>Done</button></div>' +
            '<div class="gs-row"><span><b>Places</b><small>How many can play</small></span><span class="sg-step"><button type="button" data-places="-1">−</button><span id="gs-n">' +
            places +
            '</span><button type="button" data-places="1">+</button></span></div>' +
            '<div class="gs-row"><span><b>Sides</b><small>One side can have one more</small></span><span class="sg-step"><button type="button" data-bibs="-1">−</button><span id="gs-b">' +
            bibs +
            ' v ' +
            (places - bibs) +
            '</span><button type="button" data-bibs="1">+</button></span></div>' +
            '<div class="gs-cost"><div class="gs-row"><span><b>Cost</b><small id="gs-cnote"></small></span></div>' +
            '<div class="ng-seg ng-cseg"><button type="button" data-gc="each">Price each</button><button type="button" data-gc="split">Split the pitch</button></div>' +
            '<div class="gs-cin"><label class="ng-money"><span>£</span><input type="text" id="gs-camt" class="ng-inp" inputmode="decimal" maxlength="7" /></label><button type="button" class="btn" id="gs-csave">Save</button></div></div>' +
            cardBar() +
            '<button type="button" class="btn gs-wide" id="gs-link">Copy the game’s link</button>',
          'gs-tall',
        );
        // Cost: a price each, or the pitch fee split between everyone playing.
        var split = !!g.pitch_pence;
        var amounts = {
          each: !g.pitch_pence && sgPrice(g.cost) ? String(sgPrice(g.cost) / 100) : '',
          split: g.pitch_pence ? String(g.pitch_pence / 100) : '',
        };
        function costMode() {
          $$('[data-gc]', s.el).forEach(function (b) {
            b.classList.toggle('on', (b.dataset.gc === 'split') === split);
          });
          $('#gs-camt', s.el).value = amounts[split ? 'split' : 'each'];
          $('#gs-camt', s.el).placeholder = split ? '60' : '5';
          costNote();
        }
        function costNote() {
          var v = parseFloat(String($('#gs-camt', s.el).value).replace(/[£,\s]/g, ''));
          var n = Math.max(1, inn.length);
          $('#gs-cnote', s.el).textContent = !(v > 0)
            ? split
              ? 'What the pitch costs, shared by everyone playing'
              : 'Leave empty if it’s free'
            : split
              ? 'With ' + n + ' playing now, ' + sgPounds(Math.ceil((v * 100) / n / 10) * 10) + ' each. It goes down as more say yes.'
              : sgPounds(Math.round(v * 100)) + ' each';
        }
        $$('[data-gc]', s.el).forEach(function (b) {
          b.onclick = function () {
            amounts[split ? 'split' : 'each'] = $('#gs-camt', s.el).value;
            split = b.dataset.gc === 'split';
            costMode();
          };
        });
        $('#gs-camt', s.el).oninput = costNote;
        $('#gs-csave', s.el).onclick = function () {
          var raw = String($('#gs-camt', s.el).value).replace(/[£,\s]/g, '');
          var v = raw ? parseFloat(raw) : null;
          if (v !== null && !(v >= 1 && v <= (split ? 1000 : 100))) {
            return toast(split ? 'Type a pitch fee between £1 and £1,000' : 'Type a price between £1 and £100');
          }
          var pence = v === null ? null : Math.round(v * 100);
          var button = this;
          setBusy(button, true);
          rpc('game_set_cost', {
            p_game: g.id,
            p_cost: !split && pence ? sgPounds(pence) : null,
            p_pitch_pence: split ? pence : null,
          }).then(
            function () {
              s.close();
              toast(!pence ? 'The game is free' : split ? 'The pitch is split between everyone playing' : 'Cost saved');
              refreshGame();
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
        };
        costMode();

        var timer = null;
        function save() {
          $('#gs-n', s.el).textContent = places;
          $('#gs-b', s.el).textContent = bibs + ' v ' + (places - bibs);
          clearTimeout(timer);
          timer = setTimeout(function () {
            rpc('game_set_places', { p_game: g.id, p_places: places, p_bibs: bibs }).then(null, function (err) {
              places = p0;
              bibs = b0;
              $('#gs-n', s.el).textContent = places;
              $('#gs-b', s.el).textContent = bibs + ' v ' + (places - bibs);
              toast(friendly(err));
            });
          }, 500);
        }
        $$('[data-places]', s.el).forEach(function (b) {
          b.onclick = function () {
            var p = places + Number(b.dataset.places);
            if (p < 2 || p > 40) return;
            if (p < inn.length) return toast(inn.length + ' are playing: take someone out first.');
            places = p;
            bibs = Math.min(bibs, p - 1);
            if (bibs < 1) bibs = 1;
            save();
          };
        });
        $$('[data-bibs]', s.el).forEach(function (b) {
          b.onclick = function () {
            var nb = bibs + Number(b.dataset.bibs);
            if (nb < 1 || nb > places - 1) return;
            bibs = nb;
            save();
          };
        });
        function done() {
          clearTimeout(timer);
          var changed = places !== p0 || bibs !== b0;
          s.close();
          if (!changed) return;
          rpc('game_set_places', { p_game: g.id, p_places: places, p_bibs: bibs }).then(refreshGame, function (err) {
            toast(friendly(err));
            refreshGame();
          });
        }
        $('[data-close]', s.el).onclick = done;
        $('#gs-link', s.el).onclick = function () {
          (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
            function () {
              toast('Link copied. Paste it in your group chat.');
            },
            function () {
              window.prompt('Copy this link:', link);
            },
          );
        };
        if ($('#sg-connect', s.el))
          $('#sg-connect', s.el).onclick = function () {
            var button = this;
            setBusy(button, true);
            invoke('game-pay', { action: 'connect', game_id: g.id, back: 'hq' }).then(
              function (r) {
                if (r && r.url) location.href = r.url;
              },
              function (err) {
                setBusy(button, false);
                toast(friendly(err));
              },
            );
          };
        if ($('#sg-check', s.el))
          $('#sg-check', s.el).onclick = function () {
            s.close();
            screenGames(g.id, { stripe: '1' });
          };
        function setPrice(pence, button) {
          setBusy(button, true);
          rpc('game_set_price', { p_game: g.id, p_price_pence: pence }).then(
            function () {
              s.close();
              toast(pence ? 'Players can pay by card on the link' : 'Card payments off for this game');
              refreshGame();
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
        }
        if ($('#sg-price-save', s.el))
          $('#sg-price-save', s.el).onclick = function () {
            var v = parseFloat(String($('#sg-price', s.el).value).replace(/[£,\s]/g, ''));
            if (!(v >= 1 && v <= 100)) return toast('Type a price between £1 and £100');
            setPrice(Math.round(v * 100), this);
          };
        if ($('#sg-price-off', s.el))
          $('#sg-price-off', s.el).onclick = function () {
            setPrice(null, this);
          };
      }

      // Card payments (hidden until team payments are on): set up Stripe, then a price.
      function cardBar() {
        if (!g.payments_on) return '';
        if (g.pitch_pence && (g.card_ready || !g.locked_at)) {
          return (
            '<div class="sg-card"><div class="grow"><b>Card payments</b><div class="muted small">' +
            (g.locked_at
              ? 'Players can pay their ' + sgPounds(g.share_pence) + ' share by card on the link (the card fee is on them).'
              : 'With the pitch split, cards open once the price is locked (Payments → Lock the price, or after the game).') +
            '</div></div></div>'
          );
        }
        if (!g.card_ready) {
          return (
            '<div class="sg-card"><div class="grow"><b>Take card payments</b><div class="muted small">Players pay on the game’s link or in Dayli with Apple Pay, Google Pay or a card, whenever they like. They cover the card fee; the money goes to your own Stripe account.</div></div>' +
            '<button type="button" class="btn primary" id="sg-connect">' +
            (g.stripe_connected ? 'Finish setting up Stripe' : 'Set up card payments') +
            '</button>' +
            (g.stripe_connected ? '<button type="button" class="btn" id="sg-check">Check again</button>' : '') +
            '</div>'
          );
        }
        var p = g.price_pence;
        return (
          '<div class="sg-card"><b>Card payments</b><span class="sg-money">£<input type="text" id="sg-price" inputmode="decimal" maxlength="6" value="' +
          (p ? (p / 100).toFixed(2) : '') +
          '" placeholder="5.00" /></span><button type="button" class="btn" id="sg-price-save">' +
          (p ? 'Change price' : 'Turn on') +
          '</button><span class="muted small grow">' +
          (g.pay_pence
            ? 'Players pay ' + sgPounds(g.pay_pence) + ' by card (the card fee is on them), you get ' + sgPounds(p) + '.'
            : 'What each player pays you. They can pay on the link, any time.') +
          '</span>' +
          (p ? '<button type="button" class="btn" id="sg-price-off">Turn off</button>' : '') +
          '</div>'
        );
      }

      draw();
    }

    return {
      load: load,
      reset: reset,
      runs: runs,
      ready: function () {
        return !!hq;
      },
      onboarded: function () {
        return !!hq && hq.onboarded;
      },
      homeHash: homeHash,
      drawMenus: drawMenus,
      menuSheet: menuSheet,
      screenWelcome: screenWelcome,
      screenNewTeam: screenNewTeam,
      screenPeople: screenPeople,
      screenSettings: screenSettings,
      screenGames: screenGames,
      screenMore: screenMore,
    };
  };
})();
