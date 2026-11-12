/* Dayli HQ: the shell around teams, games and events. Asks what someone runs
 * (hq_prefs, supabase/migrations/20261111000400_hq_prefs.sql) and builds the
 * menus, the switcher and the home page from that; Settings changes it.
 *   #/welcome            1. what you run
 *   #/welcome/setup      2. set it up (teams found in the app, a new team,
 *                           games, the organiser profile)
 *   #/welcome/people     3. bring people in (invite links)
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
      if (!c) return runs('teams') ? '#/welcome/setup' : '#/settings';
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
        out += link('#/games', 'ball', 'Social games', /^#\/games/.test(h));
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
    // Phones: what you run along the bottom, and More (the menu) last.
    function bottomBar(c) {
      var h = location.hash.split('?')[0];
      var item = function (href, icon, label, on) {
        return (
          '<a href="' +
          href +
          '" class="' +
          (on ? 'on' : '') +
          '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          ICON[icon] +
          '</svg><span>' +
          label +
          '</span></a>'
        );
      };
      var out = '';
      if (runs('teams')) {
        var team = c && c.indexOf('team:') === 0 ? c.slice(5) : hq.teams[0] && hq.teams[0].calendar_id;
        out += item(team ? '#/teams/' + team : '#/welcome/setup', 'squad', 'Team', c && c.indexOf('team:') === 0);
      }
      if (runs('games')) out += item('#/games', 'ball', 'Games', c === 'games');
      if (runs('events')) out += item('#/overview', 'ticket', 'Events', c === 'events');
      out +=
        '<button type="button" id="hq-more" class="' +
        (/^#\/(settings|admin)/.test(h) ? 'on' : '') +
        '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg><span>More</span></button>';
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
      if (runs('teams')) out += '<a class="hq-dd-add" href="#/welcome/setup">+ Add a team</a>';
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
      // Phones: the tabs carry a team's own pages; the bottom bar does the rest.
      tabs.innerHTML = c && c.indexOf('team:') === 0 ? menuLinks(c, true) : '';
      tabs.classList.toggle('hq-empty-tabs', !(c && c.indexOf('team:') === 0));
      var bar = document.getElementById('hq-bottom');
      if (!bar) {
        bar = document.createElement('nav');
        bar.id = 'hq-bottom';
        bar.className = 'hq-bottom';
        document.body.appendChild(bar);
      }
      bar.innerHTML = bottomBar(c);
      document.getElementById('hq-more').onclick = function () {
        var m = document.getElementById('menu');
        if (m) m.click();
      };
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
    function menuSheet() {
      if (!hq) return '';
      var c = context();
      return switcherItems(c) + '<div class="hq-navgap"></div>' + menuLinks(c);
    }

    // --- welcome ---------------------------------------------------------------------

    var chosen = null; // the choice while going through the welcome steps
    var TICK =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';

    function steps(n) {
      var names = ['What you run', 'Set it up', 'Bring people in'];
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

    function screenWelcome() {
      loading();
      load(true).then(
        function () {
          if (!chosen) {
            chosen = hq.runs.length
              ? hq.runs.slice()
              : ['teams', 'games', 'events'].filter(function (k) {
                  return hq.has[k];
                });
          }
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
          '<div class="hq-wrap"><h1 class="hq-h1">What are you running?</h1><p class="hq-lead">Pick all that apply. HQ shows only what you need.</p><div class="hq-choices">' +
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
        $('#hq-picked').innerHTML = names.length
          ? '<b class="ink">' + esc(names.join(' + ')) + '</b> picked · same login as the Dayli app'
          : 'Pick at least one';
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
        var button = this;
        setBusy(button, true);
        rpc('hq_prefs_set', { p_runs: chosen, p_done: false }).then(
          function () {
            go('#/welcome/setup');
          },
          function (err) {
            setBusy(button, false);
            toast(friendly(err));
          },
        );
      };
    }

    function screenSetup() {
      loading();
      Promise.all([
        load(true),
        rpc('my_games').catch(function () {
          return [];
        }),
      ]).then(
        function (r) {
          if (!hq.runs.length) return go('#/welcome');
          drawSetup(
            (r[1] || []).filter(function (g) {
              return g.is_organiser;
            }),
          );
        },
        function (err) {
          render(notice('error', esc(friendly(err))));
        },
      );
    }
    function drawSetup(games) {
      var sections = '';
      if (runs('teams')) {
        sections +=
          '<section class="hq-sec"><h2 class="hq-h2">Your team</h2><p class="hq-lead2">Teams you already run in the Dayli app are ready here. Or start a new one.</p>' +
          (hq.teams.length
            ? '<div class="hq-found"><div class="hq-found-h">ALREADY IN YOUR DAYLI APP</div>' +
              hq.teams
                .map(function (t) {
                  return (
                    '<div class="hq-tm">' +
                    crest(t.name, t.color, 44) +
                    '<div><b>' +
                    esc(t.name) +
                    '</b><div class="muted small">' +
                    esc(sportName(t.sport)) +
                    ' · ' +
                    t.players +
                    ' in the squad · you’re the manager</div></div><span class="hq-ok">Ready</span></div>'
                  );
                })
                .join('') +
              '</div><div class="hq-or">OR START A NEW TEAM</div>'
            : '') +
          '<div class="hq-new"><label>Team name<input type="text" id="t-name" maxlength="60" placeholder="e.g. Clapton Juniors U12" /></label>' +
          '<div class="field-label">Sport</div><div class="hq-chips" id="t-sport">' +
          SPORTS.map(function (s, i) {
            return '<button type="button" data-v="' + s[0] + '" class="' + (i === 0 ? 'on' : '') + '">' + esc(s[1]) + '</button>';
          }).join('') +
          '</div><div class="field-label">Team colour</div><div class="hq-sws" id="t-colour">' +
          COLOURS.map(function (c, i) {
            return (
              '<button type="button" aria-label="Colour ' +
              c +
              '" data-v="' +
              c +
              '" class="' +
              (i === 0 ? 'on' : '') +
              '" style="background:' +
              c +
              '"></button>'
            );
          }).join('') +
          '</div><button class="btn' +
          (hq.teams.length ? '' : ' primary') +
          '" id="t-make">Create the team</button></div></section>';
      }
      if (runs('games')) {
        sections +=
          '<section class="hq-sec"><h2 class="hq-h2">Your social games</h2><p class="hq-lead2">Pick-up games: one link in the group chat and the spaces fill up, first come first served.</p>' +
          (games.length
            ? '<div class="hq-found">' +
              games
                .slice(0, 4)
                .map(function (g) {
                  return (
                    '<div class="hq-tm">' +
                    crest('G', '#3a61c9', 40) +
                    '<div><b>' +
                    esc(g.title) +
                    '</b><div class="muted small">' +
                    esc(new Date(g.starts_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) +
                    ' · ' +
                    g.taken +
                    ' of ' +
                    g.places +
                    ' spaces</div></div><span class="hq-ok">Ready</span></div>'
                  );
                })
                .join('') +
              '</div>'
            : notice(
                'info',
                'Start a game in the Dayli app (Events → Hosting → New game). It shows here straight away: add players, pick Bibs v Colours and tick who’s paid in Social games.',
              )) +
          '</section>';
      }
      if (runs('events')) {
        sections +=
          '<section class="hq-sec"><h2 class="hq-h2">Your events</h2><p class="hq-lead2">Events need an organiser profile: the name people see, and a way to check your email.</p>' +
          (state.organiser
            ? '<div class="hq-found"><div class="hq-tm">' +
              crest(state.organiser.name, '#1c1a17', 40) +
              '<div><b>' +
              esc(state.organiser.name) +
              '</b><div class="muted small">Your organiser profile</div></div><span class="hq-ok">Ready</span></div></div>'
            : '<a class="btn" href="#/profile">Set up the organiser profile</a> <span class="muted small">You can do this after the welcome too.</span>') +
          '</section>';
      }
      render(
        topBar(2) +
          '<div class="hq-wrap hq-left">' +
          sections +
          '<div class="hq-foot"><a class="btn" href="#/welcome">Back</a><button class="btn primary hq-big" id="hq-next">Continue</button></div></div>',
      );
      document.body.classList.add('hq-bare');
      wireTop();
      function pick(id) {
        $$('#' + id + ' button').forEach(function (b) {
          b.onclick = function () {
            $$('#' + id + ' button').forEach(function (x) {
              x.classList.toggle('on', x === b);
            });
          };
        });
      }
      if ($('#t-make')) {
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
            function () {
              toast(name + ' is set up');
              screenSetup();
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
        };
      }
      $('#hq-next').onclick = function () {
        if (runs('teams') && !hq.teams.length) return toast('Create your team first, or untick Team in step 1');
        go('#/welcome/people');
      };
    }

    function screenPeople() {
      loading();
      load(true).then(function () {
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
              ' in the squad so far. Players tap the link and join in the Dayli app.</div></div>' +
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
        topBar(3) +
          '<div class="hq-wrap hq-left"><h1 class="hq-h1 hq-l">Bring people in</h1><p class="hq-lead2">Send the link to your group chat. Anyone who joins sees fixtures and games in their own calendar.</p><div class="hq-found">' +
          rows +
          '</div><div class="hq-foot"><a class="btn" href="#/welcome/setup">Back</a><button class="btn primary hq-big" id="hq-done">Go to HQ</button></div></div>',
      );
      document.body.classList.add('hq-bare');
      wireTop();
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
      load(true).then(function () {
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
              '<div class="card"><h3>Account</h3><p class="sub">Same account as the Dayli app.</p><p>' +
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

    function loadGames(gameId) {
      loading();
      rpc('my_games').then(
        function (rows) {
          var mine = (rows || []).filter(function (g) {
            return g.is_organiser;
          });
          var id = gameId || (mine[0] && mine[0].id);
          if (!id) {
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
            return;
          }
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
      var times = ['18:00', '18:30', '19:00', '19:30', '20:00'].map(function (t) {
        return [t, t];
      });
      var timeKnown = times.some(function (x) {
        return x[0] === g.time;
      });
      times.push(['other', 'Other…']);

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
          row('name', 'Name', g.title, '<input type="text" id="ng-title" class="ng-inp" maxlength="80" value="' + esc(g.title) + '" />') +
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
              chips('time', times, timeKnown ? g.time : 'other') +
              '<input type="time" id="ng-time" class="ng-inp" value="' +
              esc(g.time) +
              '"' +
              (timeKnown ? ' hidden' : '') +
              ' />',
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
            g.cost ? g.cost + ' each' : 'Free, or say later',
            '<input type="text" id="ng-cost" class="ng-inp" maxlength="40" placeholder="£5" value="' +
              esc(g.cost) +
              '" /><p class="muted small ng-note">People pay you in cash, or by card once card payments are on.</p>',
          ) +
          (cals.length > 1
            ? row(
                'cal',
                'Calendar',
                (
                  cals.filter(function (c) {
                    return c.id === g.cal;
                  })[0] || { name: '' }
                ).name,
                '<select id="ng-cal" class="ng-inp">' +
                  cals
                    .map(function (c) {
                      return (
                        '<option value="' +
                        esc(c.id) +
                        '"' +
                        (c.id === g.cal ? ' selected' : '') +
                        '>' +
                        esc(c.name) +
                        (teamIds[c.id] ? ' (team: the squad is asked)' : '') +
                        '</option>'
                      );
                    })
                    .join('') +
                  '</select>',
              )
            : '') +
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
          // A past game's name goes with it, unless you typed your own.
          if (!g.typed) g.titleTouched = false;
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
      if ($('#ng-title'))
        $('#ng-title').oninput = function () {
          g.title = this.value;
          g.titleTouched = true;
          g.typed = true;
          setText('name', this.value || ' ');
        };
      if ($('#ng-place'))
        $('#ng-place').oninput = function () {
          g.place = this.value.trim();
          setText('where', g.place || 'Add a place');
        };
      if ($('#ng-cost'))
        $('#ng-cost').oninput = function () {
          g.cost = this.value.trim();
          setText('cost', g.cost ? g.cost + ' each' : 'Free, or say later');
        };
      if ($('#ng-cal'))
        $('#ng-cal').onchange = function () {
          g.cal = this.value;
          setText('cal', this.options[this.selectedIndex].text);
        };
      if ($('#ng-date'))
        $('#ng-date').onchange = function () {
          if (this.value) g.day = this.value;
          redraw('when');
        };
      if ($('#ng-time'))
        $('#ng-time').onchange = function () {
          if (this.value) g.time = this.value;
          redraw('when');
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
            if (name === 'time') {
              if (v === 'other') {
                $('#ng-time').hidden = false;
                $('#ng-time').focus();
                return;
              }
              g.time = v;
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
        var why = !g.cal
          ? 'You need a calendar in Dayli first: open the Dayli app once.'
          : isNaN(start.getTime()) || start < new Date()
            ? 'Pick a day and time that’s still to come.'
            : !(g.title || '').trim()
              ? 'Give the game a name.'
              : null;
        if (why) {
          err.textContent = why;
          err.hidden = false;
          return;
        }
        setBusy(button, true);
        rpc('game_create', {
          p_calendar: g.cal,
          p_title: g.title.trim(),
          p_sport: g.sport,
          p_format: g.format,
          p_starts_at: start.toISOString(),
          p_minutes: g.mins,
          p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London',
          p_location: g.place || null,
          p_places: g.places,
          p_cost: g.cost || null,
          p_weekly: g.weekly,
        }).then(
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

    function drawGame(g, mine) {
      var players = g.players || [];
      var inn = players.filter(function (p) {
        return p.status === 'in';
      });
      var waiting = players.filter(function (p) {
        return p.status === 'waiting';
      });
      var side = {};
      inn.forEach(function (p) {
        side[p.id] = p.side || null;
      });
      var places = g.places;
      var bibs = g.bibs && g.bibs < places ? g.bibs : Math.floor(places / 2);
      var dirty = false;
      var price = g.price_pence || sgPrice(g.cost);
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

      // Card payments (hidden until team payments are on): set up Stripe, then a price.
      function cardBar() {
        if (!g.payments_on) return '';
        if (!g.card_ready) {
          return (
            '<div class="sg-card"><div class="grow"><b>Take card payments</b><div class="muted small">Players pay on the game’s link or in Dayli with Apple Pay, Google Pay or a card, whenever they like. They cover the card fee; the money goes to your own Stripe account.</div></div>' +
            '<button class="btn primary" id="sg-connect">' +
            (g.stripe_connected ? 'Finish setting up Stripe' : 'Set up card payments') +
            '</button>' +
            (g.stripe_connected ? '<button class="btn" id="sg-check">Check again</button>' : '') +
            '</div>'
          );
        }
        var p = g.price_pence;
        return (
          '<div class="sg-card"><b>Card payments</b><span class="sg-money">£<input type="text" id="sg-price" inputmode="decimal" maxlength="6" value="' +
          (p ? (p / 100).toFixed(2) : '') +
          '" placeholder="5.00" /></span><button class="btn" id="sg-price-save">' +
          (p ? 'Change price' : 'Turn on') +
          '</button><span class="muted small grow">' +
          (g.pay_pence
            ? 'Players pay ' +
              sgPounds(g.pay_pence) +
              ' by card (the card fee is on them), you get ' +
              sgPounds(p) +
              '. Tap a green tick to refund someone.'
            : 'What each player pays you. They can pay on the link, any time.') +
          '</span>' +
          (p ? '<button class="btn" id="sg-price-off">Turn off</button>' : '') +
          '</div>'
        );
      }
      function refund(placeId, name, amount, button) {
        if (!confirm('Give ' + name + ' all ' + sgPounds(amount) + ' back? It reaches their card in 5 to 10 days.')) return;
        if (button) setBusy(button, true);
        invoke('game-pay', { action: 'refund', place_id: placeId }).then(
          function () {
            toast(name + ' refunded');
            loadGames(g.id);
          },
          function (err) {
            if (button) setBusy(button, false);
            toast(friendly(err));
          },
        );
      }
      function setPrice(pence, button) {
        setBusy(button, true);
        rpc('game_set_price', { p_game: g.id, p_price_pence: pence }).then(
          function () {
            toast(pence ? 'Players can pay by card on the link' : 'Card payments off for this game');
            loadGames(g.id);
          },
          function (err) {
            setBusy(button, false);
            toast(friendly(err));
          },
        );
      }

      function draw() {
        var bibsList = inn.filter(function (p) {
          return side[p.id] === 'bibs';
        });
        var colsList = inn.filter(function (p) {
          return side[p.id] === 'colours';
        });
        var none = inn.filter(function (p) {
          return !side[p.id];
        });
        var paid = inn.filter(function (p) {
          return p.paid;
        });
        var owing = inn.filter(function (p) {
          return !p.paid;
        });
        var others = mine.filter(function (x) {
          return x.id !== g.id;
        });

        function row(p) {
          var s = side[p.id];
          return (
            '<div class="sg-it">' +
            sgAvatar(p, 30) +
            '<b class="grow">' +
            esc(p.name) +
            (p.guest ? ' <small class="muted">not on Dayli</small>' : '') +
            '</b><button class="sg-tag ' +
            (s || 'none') +
            '" data-side="' +
            esc(p.id) +
            '" title="Swap side">' +
            (s === 'bibs' ? 'BIBS' : s === 'colours' ? 'COLOURS' : 'NO SIDE') +
            '</button><button class="sg-tick ' +
            (p.paid || 'no') +
            '" data-paid="' +
            esc(p.id) +
            '" title="' +
            (p.paid === 'card' ? 'Paid by card: tap to refund' : p.paid ? 'Paid in cash: tap to undo' : 'Tap when they’ve paid') +
            '">' +
            (p.paid ? '✓' : '') +
            '</button><button class="sg-x" data-out="' +
            esc(p.id) +
            '" title="Take them out">×</button></div>'
          );
        }
        function shirts(list, top) {
          var spots = sgHalf(list.length, top);
          return list
            .map(function (p, i) {
              var s = spots[i];
              return (
                '<div class="sg-pp' +
                (top ? ' b' : '') +
                '" draggable="true" data-p="' +
                esc(p.id) +
                '" style="left:' +
                s.x.toFixed(1) +
                '%;top:' +
                s.y.toFixed(1) +
                '%" title="Tap to swap side">' +
                sgAvatar(p, 40) +
                '<b>' +
                esc(sgShort(p.name)) +
                '</b>' +
                (p.paid || !price ? '' : '<i class="sg-owe">' + sgPounds(price) + '</i>') +
                '</div>'
              );
            })
            .join('');
        }

        render(
          (others.length
            ? '<div class="sg-games">' +
              mine
                .map(function (x) {
                  return (
                    '<a class="' +
                    (x.id === g.id ? 'on' : '') +
                    '" href="#/games/' +
                    esc(x.id) +
                    '">' +
                    esc(
                      new Date(x.starts_at).toLocaleDateString('en-GB', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        timeZone: x.timezone || undefined,
                      }),
                    ) +
                    ' · ' +
                    esc(x.title) +
                    '</a>'
                  );
                })
                .join('') +
              '</div>'
            : '') +
            '<div class="th-head"><div><div class="muted th-date">' +
            esc([when, at, g.location, g.cost ? g.cost + ' each' : null].filter(Boolean).join(' · ')) +
            '</div><h1>' +
            esc(g.title) +
            '</h1></div><div class="row"><a class="btn" href="#/games/new">+ New game</a><button class="btn" id="sg-link">Share the link</button><button class="btn primary" id="sg-save"' +
            (dirty ? '' : ' disabled') +
            '>' +
            (g.sides_set ? 'Save the teams' : 'Save and show the teams') +
            '</button></div></div>' +
            '<div class="sg-set"><b>Places</b><span class="sg-step"><button data-places="-1">−</button><span>' +
            places +
            '</span><button data-places="1">+</button></span><b>Sides</b><span class="sg-step"><button data-bibs="-1">−</button><span>' +
            bibs +
            ' v ' +
            (places - bibs) +
            '</span><button data-bibs="1">+</button></span><span class="muted small grow">One side can have one more. Change it any time.</span><button class="btn" id="sg-mix">Mix them up</button></div>' +
            cardBar() +
            '<div class="sg-grid"><div class="card sg-list"><div class="sg-add"><input type="text" id="sg-name" maxlength="40" placeholder="Add a player by name" /><button class="btn primary" id="sg-add">Add</button></div>' +
            (inn.length ? inn.map(row).join('') : '<p class="muted small">Nobody in yet. Add names, or share the link and people add themselves.</p>') +
            (waiting.length
              ? '<div class="sg-wait"><b>Waiting list · ' +
                waiting.length +
                '</b>' +
                waiting
                  .map(function (p) {
                    return '<span>' + sgAvatar(p, 22) + esc(sgShort(p.name)) + '</span>';
                  })
                  .join('') +
                '<small class="muted">They get a place if someone drops out, or add more places.</small></div>'
              : '') +
            ((g.left_paid || []).length
              ? '<div class="sg-left"><b>Left after paying by card</b>' +
                g.left_paid
                  .map(function (p) {
                    return (
                      '<span>' +
                      esc(p.name) +
                      ' · ' +
                      sgPounds(p.amount_pence) +
                      ' <button class="act" data-refund="' +
                      esc(p.id) +
                      '" data-name="' +
                      esc(p.name) +
                      '" data-amount="' +
                      Number(p.amount_pence) +
                      '">Refund</button></span>'
                    );
                  })
                  .join('') +
                '</div>'
              : '') +
            '<div class="sg-pay"><b>' +
            paid.length +
            ' of ' +
            inn.length +
            ' paid</b><div class="tm-bar sg-bar"><span style="flex:' +
            paid.length +
            ';background:var(--accent)"></span><span style="flex:' +
            Math.max(inn.length - paid.length, 0) +
            ';background:var(--alt)"></span></div><span class="muted">' +
            (price && owing.length ? sgPounds(price * owing.length) + ' to collect' : owing.length ? owing.length + ' to pay' : 'All paid') +
            (g.pay_pence && owing.length ? ' · they can pay by card on the link' : '') +
            '</span>' +
            (owing.length ? '<button class="act tp-nudge" id="sg-remind">Remind on WhatsApp</button>' : '') +
            '</div></div>' +
            '<div><div class="sg-pitch" data-half="pitch"><div class="ln box"></div><div class="ln half"></div><div class="ln circle"></div><div class="ln area top"></div><div class="ln area bottom"></div>' +
            '<span class="sg-sl" style="top:10px">BIBS · ' +
            bibsList.length +
            '</span><span class="sg-sl" style="bottom:10px">COLOURS · ' +
            colsList.length +
            '</span>' +
            shirts(bibsList, true) +
            shirts(colsList, false) +
            '</div>' +
            (none.length
              ? '<div class="sg-none" data-half="none"><b>No side yet</b>' +
                none
                  .map(function (p) {
                    return '<span draggable="true" data-p="' + esc(p.id) + '">' + sgAvatar(p, 22) + esc(sgShort(p.name)) + '</span>';
                  })
                  .join('') +
                '</div>'
              : '') +
            '<p class="muted small">Drag a player to the other half, or tap them to swap. ' +
            (price ? 'An orange ' + sgPounds(price) + ' means they haven’t paid yet. ' : '') +
            (dirty ? '<b class="ink">Save the teams so everyone sees them in Dayli.</b>' : g.sides_set ? 'Everyone sees these teams in Dayli.' : '') +
            '</p></div></div>',
        );
        wire();
      }

      function swap(id) {
        side[id] = side[id] === 'bibs' ? 'colours' : 'bibs';
        dirty = true;
        draw();
      }
      function mix() {
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
        dirty = true;
        draw();
      }
      function savePlaces(p, b, button) {
        setBusy(button, true);
        rpc('game_set_places', { p_game: g.id, p_places: p, p_bibs: b }).then(
          function () {
            loadGames(g.id);
          },
          function (err) {
            setBusy(button, false);
            toast(friendly(err));
          },
        );
      }

      function wire() {
        $$('[data-side]').forEach(function (b) {
          b.onclick = function () {
            swap(b.dataset.side);
          };
        });
        $$('.sg-pp').forEach(function (el) {
          el.onclick = function () {
            swap(el.dataset.p);
          };
        });
        $$('[data-paid]').forEach(function (b) {
          b.onclick = function () {
            var p = inn.filter(function (x) {
              return x.id === b.dataset.paid;
            })[0];
            if (!p) return;
            if (p.paid === 'card') return refund(p.id, p.name, g.pay_pence || price, null);
            var to = p.paid ? null : 'cash';
            rpc('game_mark_paid', { p_place: p.id, p_paid: to }).then(
              function () {
                p.paid = to;
                draw();
              },
              function (err) {
                toast(friendly(err));
              },
            );
          };
        });
        $$('[data-out]').forEach(function (b) {
          b.onclick = function () {
            var p = inn.filter(function (x) {
              return x.id === b.dataset.out;
            })[0];
            if (!p || !confirm('Take ' + p.name + ' out of the game?' + (waiting.length ? ' The first on the waiting list gets their place.' : ''))) return;
            rpc('game_leave', { p_game: g.id, p_place: p.id }).then(
              function () {
                toast(p.name + ' is out');
                loadGames(g.id);
              },
              function (err) {
                toast(friendly(err));
              },
            );
          };
        });
        function add() {
          var name = $('#sg-name').value.trim();
          if (!name) return;
          var button = $('#sg-add');
          setBusy(button, true);
          rpc('game_add_name', { p_game: g.id, p_name: name }).then(
            function (r) {
              toast(r && r.status === 'waiting' ? name + ' is on the waiting list (the game is full)' : name + ' added');
              loadGames(g.id);
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
        }
        $('#sg-add').onclick = add;
        $('#sg-name').onkeydown = function (e) {
          if (e.key === 'Enter') add();
        };
        $$('[data-places]').forEach(function (b) {
          b.onclick = function () {
            var p = places + Number(b.dataset.places);
            if (p < 2 || p > 40) return;
            savePlaces(p, Math.min(bibs, p - 1), b);
          };
        });
        $$('[data-bibs]').forEach(function (b) {
          b.onclick = function () {
            var nb = bibs + Number(b.dataset.bibs);
            if (nb < 1 || nb > places - 1) return;
            savePlaces(places, nb, b);
          };
        });
        $('#sg-mix').onclick = mix;
        $$('[data-refund]').forEach(function (b) {
          b.onclick = function () {
            refund(b.dataset.refund, b.dataset.name, Number(b.dataset.amount), b);
          };
        });
        if ($('#sg-connect'))
          $('#sg-connect').onclick = function () {
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
        if ($('#sg-check'))
          $('#sg-check').onclick = function () {
            screenGames(g.id, { stripe: '1' });
          };
        if ($('#sg-price-save'))
          $('#sg-price-save').onclick = function () {
            var v = parseFloat(String($('#sg-price').value).replace(/[£,\s]/g, ''));
            if (!(v >= 1 && v <= 100)) return toast('Type a price between £1 and £100');
            setPrice(Math.round(v * 100), this);
          };
        if ($('#sg-price-off'))
          $('#sg-price-off').onclick = function () {
            setPrice(null, this);
          };
        $('#sg-link').onclick = function () {
          (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
            function () {
              toast('Link copied. Paste it in your group chat.');
            },
            function () {
              window.prompt('Copy this link:', link);
            },
          );
        };
        $('#sg-save').onclick = function () {
          var button = this;
          setBusy(button, true);
          rpc('game_set_sides', { p_game: g.id, p_sides: side }).then(
            function () {
              toast('Teams saved. Everyone sees them in Dayli.');
              loadGames(g.id);
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
        };
        if ($('#sg-remind'))
          $('#sg-remind').onclick = function () {
            var owe = inn
              .filter(function (p) {
                return !p.paid;
              })
              .map(function (p) {
                return p.name.split(' ')[0];
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
        // Dragging shirts and names between the halves.
        $$('[draggable="true"][data-p]').forEach(function (el) {
          el.ondragstart = function (e) {
            e.dataTransfer.setData('text/plain', el.dataset.p);
          };
        });
        $$('[data-half]').forEach(function (z) {
          z.ondragover = function (e) {
            e.preventDefault();
          };
          z.ondrop = function (e) {
            e.preventDefault();
            e.stopPropagation();
            var id = e.dataTransfer.getData('text/plain');
            if (!(id in side)) return;
            var to = null;
            if (z.dataset.half === 'pitch') {
              // The top half is bibs, the bottom colours.
              var r = z.getBoundingClientRect();
              to = e.clientY - r.top < r.height / 2 ? 'bibs' : 'colours';
            }
            if (side[id] === to) return;
            side[id] = to;
            dirty = true;
            draw();
          };
        });
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
      screenSetup: screenSetup,
      screenPeople: screenPeople,
      screenSettings: screenSettings,
      screenGames: screenGames,
    };
  };
})();
