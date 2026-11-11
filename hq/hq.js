/* Dayli HQ: the shell around teams, games and events. Asks what someone runs
 * (hq_prefs, supabase/migrations/20261111000400_hq_prefs.sql) and builds the
 * menus, the switcher and the home page from that; Settings changes it.
 *   #/welcome            1. what you run
 *   #/welcome/setup      2. set it up (teams found in the app, a new team,
 *                           games, the organiser profile)
 *   #/welcome/people     3. bring people in (invite links)
 *   #/settings           what you run, account
 *   #/home               the first thing you run
 *   #/games              games you organise
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
        title: 'Games',
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
    function menuLinks(c) {
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
        out += link('#/games', 'ball', 'Games', /^#\/games/.test(h));
      } else if (c === 'events') {
        out +=
          link('#/overview', 'home', 'Overview', h === '#/overview') +
          link('#/events', 'fixtures', 'Events', /^#\/events/.test(h)) +
          link('#/analytics', 'chart', 'Analytics', /^#\/analytics/.test(h)) +
          link('#/payouts', 'ticket', 'Tickets & payouts', /^#\/(payouts|tickets|checkin)/.test(h)) +
          link('#/profile', 'person', 'Profile', h === '#/profile');
      }
      out += '<div class="hq-navgap"></div>' + link('#/settings', 'gear', 'Settings', h === '#/settings');
      if (state.admin) out += link('#/admin', 'shield', 'Admin', /^#\/admin/.test(h));
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
          '<span>Your games<small>One-off and weekly</small></span></a>';
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
      return out;
    }
    function current(c) {
      if (!c) return { name: 'Dayli HQ', sub: 'Pick what you run', colour: '#2f6b4f' };
      if (c === 'games') return { name: 'Your games', sub: 'One-off and weekly', colour: '#3a61c9' };
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
        games: ['Run pick-up games too?', 'Five-a-side, a weekly kickabout…'],
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
      tabs.innerHTML = menuLinks(c);
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
          '<section class="hq-sec"><h2 class="hq-h2">Your games</h2><p class="hq-lead2">Pick-up games: one link in the group chat and the spaces fill up, first come first served.</p>' +
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
                'Start a game in the Dayli app (Events → Hosting → New game). It shows here straight away; starting games from HQ is coming next.',
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
          '<div class="grow"><b>Games</b><div class="muted small">Each game has its own link: share it from the game when you make one.</div></div></div>';
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

    // --- games ---------------------------------------------------------------------------

    function screenGames() {
      loading();
      rpc('my_games').then(
        function (rows) {
          var mine = (rows || []).filter(function (g) {
            return g.is_organiser;
          });
          render(
            '<div class="page-head"><div><h1>Games</h1><p class="muted">Pick-up games you run. Share one link; spaces fill up first come first served.</p></div></div>' +
              (mine.length
                ? '<div class="card"><h3>Coming up</h3><div class="hq-games">' +
                  mine
                    .map(function (g) {
                      var pct = Math.min(100, Math.round((g.taken / Math.max(g.places, 1)) * 100));
                      return (
                        '<div class="hq-game"><div class="grow"><b>' +
                        esc(g.title) +
                        '</b><div class="muted small">' +
                        esc(
                          new Date(g.starts_at).toLocaleString('en-GB', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: g.timezone || undefined,
                          }) + (g.location ? ' · ' + g.location : ''),
                        ) +
                        '</div></div><div class="hq-fill"><span>' +
                        g.taken +
                        ' / ' +
                        g.places +
                        '</span><div class="hq-fillbar"><i style="width:' +
                        pct +
                        '%"></i></div></div></div>'
                      );
                    })
                    .join('') +
                  '</div></div>'
                : notice('info', 'No games coming up. Start one in the Dayli app (Events → Hosting → New game).')) +
              notice(
                'info',
                'Running games from HQ (spaces, waiting list, sides, who’s paid) is the next part being built. For now, manage them in the Dayli app.',
              ),
          );
        },
        function (err) {
          render(notice('error', esc(friendly(err))));
        },
      );
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
