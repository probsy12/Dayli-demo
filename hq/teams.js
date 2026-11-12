/* Dayli HQ: Teams. The squads someone manages, run from a laptop: fixtures
 * and results, who's available, picking the team, the squad, and money
 * (subs, match fees, one-offs). Everything goes through the same RPCs as the
 * app (supabase/migrations/*team*), so a change here shows in the app at once
 * and the other way round. Only shown at /hq/ (window.DayliTeams in app.js).
 *   #/teams                         the teams I'm in
 *   #/teams/<calendar>              home: the next match, results, money, getting started
 *   #/teams/<calendar>/<tab>        fixtures | squad | payments
 *   #/teams/<calendar>/new          add a fixture, training or social
 *   #/teams/<calendar>/fixture/<id> pick the team: answers in columns, the pitch, the score
 */
(function () {
  'use strict';

  window.DayliTeams = function (ctx) {
    var sb = ctx.sb;
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
    var SITE = ctx.SITE;
    var cfg = window.DAYLI_CONFIG || {};

    var KIND = { match: 'Match', training: 'Training', social: 'Social' };
    var STATUS = { available: 'Yes', maybe: 'Maybe', cant: 'No' };

    // --- helpers -------------------------------------------------------------

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
    function pounds(p) {
      var v = (Number(p) || 0) / 100;
      return '£' + (v % 1 ? v.toFixed(2) : v.toFixed(0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    function day(iso, tz) {
      return new Date(iso).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: tz || undefined,
      });
    }
    function time(iso, tz) {
      return new Date(iso).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: tz || undefined,
      });
    }
    function daysAway(iso) {
      var d = Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
      return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days';
    }
    function initials(name) {
      return String(name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(function (w) {
          return w.charAt(0).toUpperCase();
        })
        .join('');
    }
    function badgeUrl(path) {
      return path ? cfg.supabaseUrl + '/storage/v1/object/public/team-badges/' + path : null;
    }
    function crest(t, size) {
      var s = size || 56;
      var img = badgeUrl(t.badge);
      return img
        ? '<img class="tm-crest" style="width:' + s + 'px;height:' + s + 'px" src="' + esc(img) + '" alt="" />'
        : '<span class="tm-crest" style="width:' +
            s +
            'px;height:' +
            s +
            'px;background:' +
            esc(t.color || '#2f6b4f') +
            ';font-size:' +
            Math.round(s * 0.38) +
            'px">' +
            esc(initials(t.name)) +
            '</span>';
    }
    function fixtureName(f) {
      if (f.kind === 'match') return (f.home ? 'v ' : '@ ') + (f.opponent || 'TBC');
      return f.title || KIND[f.kind];
    }
    function result(f) {
      if (f.kind !== 'match' || f.score_us == null || f.score_them == null) return '';
      var cls = f.score_us > f.score_them ? 'w' : f.score_us < f.score_them ? 'l' : 'd';
      var l = cls === 'w' ? 'W' : cls === 'l' ? 'L' : 'D';
      return '<span class="tm-res ' + cls + '">' + l + ' ' + f.score_us + '–' + f.score_them + '</span>';
    }
    function countsBar(c, total) {
      var t = Math.max(total || 0, c.available + c.maybe + c.cant + c.none, 1);
      return (
        '<div class="tm-bar"><span style="flex:' +
        c.available +
        ';background:var(--accent)"></span><span style="flex:' +
        c.maybe +
        ';background:#e3b34a"></span><span style="flex:' +
        c.cant +
        ';background:var(--danger)"></span><span style="flex:' +
        Math.max(t - c.available - c.maybe - c.cant, 0) +
        ';background:var(--alt)"></span></div>'
      );
    }
    function countsText(c) {
      return (
        '<b>' +
        c.available +
        ' yes</b> · ' +
        c.maybe +
        ' maybe · ' +
        c.cant +
        ' no' +
        (c.none ? ' · ' + c.none + ' not answered' : '')
      );
    }
    function teamUrl(cal, tab) {
      return '#/teams/' + cal + (tab ? '/' + tab : '');
    }

    // --- the list ------------------------------------------------------------

    function screenList() {
      loading();
      rpc('my_teams').then(
        function (rows) {
          var mine = (rows || []).filter(function (t) {
            return t.my_role === 'manager' && !t.sample;
          });
          var playing = (rows || []).filter(function (t) {
            return t.my_role !== 'manager' && !t.sample;
          });
          if (mine.length === 1 && !playing.length) return go(teamUrl(mine[0].calendar_id));
          render(
            '<div class="page-head"><div><h1>Teams</h1><p class="muted">The squads you run, from your laptop. Same teams as the Dayli app.</p></div></div>' +
              (mine.length
                ? '<div class="tm-list">' + mine.map(teamCard).join('') + '</div>'
                : notice(
                    'info',
                    'You don’t manage a team yet. Make one in the Dayli app (More → Sports → New team), then run it from here.',
                  )) +
              (playing.length
                ? '<h3 style="margin-top:22px">Teams you play for</h3><p class="sub">The manager runs these; you answer and pay in the Dayli app.</p><div class="tm-list">' +
                  playing.map(teamCard).join('') +
                  '</div>'
                : ''),
          );
        },
        function (err) {
          render(notice('error', esc(friendly(err))));
        },
      );
    }
    function teamCard(t) {
      return (
        '<a class="card tm-card" href="' +
        (t.my_role === 'manager' ? teamUrl(t.calendar_id) : '#/teams') +
        '">' +
        crest(t, 46) +
        '<div><b>' +
        esc(t.name) +
        '</b><div class="muted small">' +
        esc(sportLine(t)) +
        ' · ' +
        t.players +
        ' in the squad</div></div></a>'
      );
    }
    function sportLine(t) {
      var s = String(t.sport || 'team').replace(/_/g, ' ');
      s = s.charAt(0).toUpperCase() + s.slice(1);
      if (t.format && /^\d+$/.test(t.format)) s += ' · ' + t.format + '-a-side';
      if (t.league) s += ' · ' + t.league;
      return s;
    }

    // --- one team --------------------------------------------------------------

    function loadTeam(cal) {
      return Promise.all([
        rpc('team_overview', { p_calendar: cal }),
        rpc('team_results', { p_calendar: cal, p_limit: 50 }).catch(function () {
          return [];
        }),
        rpc('team_payments', { p_calendar: cal }).catch(function () {
          return null;
        }),
        sb
          .from('calendars')
          .select('join_code')
          .eq('id', cal)
          .maybeSingle()
          .then(function (r) {
            return r.data ? r.data.join_code : null;
          }),
      ]).then(function (r) {
        return { team: r[0], results: r[1] || [], pay: r[2], code: r[3] };
      });
    }

    function screenTeam(cal, tab, query) {
      loading();
      var stripeBack = query && query.stripe ? invoke('team-pay', { action: 'status', calendar_id: cal }) : null;
      Promise.resolve(stripeBack)
        .catch(function () {
          return null;
        })
        .then(function () {
          return loadTeam(cal);
        })
        .then(function (d) {
          if (tab === 'payments') {
            // A tab for each team this person manages, with what it's owed.
            return rpc('my_teams')
              .then(function (rows) {
                var mine = (rows || []).filter(function (x) {
                  return x.my_role === 'manager';
                });
                return Promise.all(
                  mine.map(function (x) {
                    if (x.calendar_id === cal) return d.pay;
                    return rpc('team_payments', { p_calendar: x.calendar_id }).catch(function () {
                      return null;
                    });
                  }),
                ).then(function (pays) {
                  d.myTeams = mine.map(function (x, i) {
                    var pp = pays[i];
                    return {
                      calendar_id: x.calendar_id,
                      name: x.name,
                      owed_pence: pp && pp.totals && pp.payout && pp.payout.ready ? pp.totals.owed_pence : null,
                    };
                  });
                  return d;
                });
              })
              .catch(function () {
                return d;
              });
          }
          if (tab === 'squad') {
            return rpc('team_squad_stats', { p_calendar: cal }).then(
              function (s) {
                d.stats = s || [];
                return d;
              },
              function () {
                d.stats = [];
                return d;
              },
            );
          }
          // Home shows who hasn't answered for the next match, which only the
          // fixture itself lists.
          if (tab) return d;
          var next = nextUp(d.team);
          if (!next) return d;
          return rpc('team_fixture', { p_event: next.event_id }).then(
            function (f) {
              d.next = f;
              return d;
            },
            function () {
              return d;
            },
          );
        })
        .then(
          function (d) {
            if (d.team.my_role !== 'manager') {
              return render(
                notice(
                  'info',
                  'Only the team’s managers can run it here. You can answer and pay in the Dayli app.',
                ) + '<a class="btn" href="#/teams">Back to teams</a>',
              );
            }
            if (!tab) return drawHome(d);
            if (tab === 'fixtures') return drawFixturesPage(d, query || {});
            if (tab === 'squad') return drawSquadPage(d, query || {});
            if (tab === 'payments') return drawPaymentsPage(d, query || {});
            drawTeam(d, tab);
          },
          function (err) {
            render(notice('error', esc(friendly(err))) + '<a class="btn" href="#/teams">Back to teams</a>');
          },
        );
    }

    function drawTeam(d, tab) {
      var t = d.team;
      var cal = t.calendar_id;
      var upcoming = (t.fixtures || []).filter(function (f) {
        return new Date(f.ends_at) > new Date();
      });
      var next =
        upcoming.filter(function (f) {
          return f.kind === 'match';
        })[0] || upcoming[0];
      var squad = (t.players || []).filter(function (p) {
        return p.role !== 'manager' || p.plays;
      }).length;
      var totals = d.pay && d.pay.totals;
      var tiles =
        tile('Next up', next ? esc(day(next.starts_at, next.timezone)) : '—', next ? esc(fixtureName(next)) + ' · ' + daysAway(next.starts_at) : 'Nothing planned') +
        tile(
          'Available',
          next ? next.counts.available + ' / ' + squad : '—',
          next ? next.counts.none + ' not answered yet' : '',
        ) +
        tile(
          'Collected',
          totals ? '<span style="color:var(--accent)">' + pounds(totals.collected_pence) + '</span>' : '—',
          d.pay ? 'subs, match fees and one-offs' : 'payments aren’t on yet',
        ) +
        tile(
          'Still owed',
          totals ? '<span style="color:var(--orange)">' + pounds(totals.owed_pence) + '</span>' : '—',
          totals ? owingCount(d.pay) + ' owing' : '',
        );
      var body = tab === 'squad' ? drawSquad(d) : tab === 'payments' ? drawPayments(d) : drawFixtures(d, next);
      render(
        '<div class="tm-head">' +
          crest(t, 64) +
          '<div class="grow"><div class="tm-kick">' +
          esc(sportLine(t).toUpperCase()) +
          '</div><h1>' +
          esc(t.name) +
          '</h1><div class="muted small">' +
          (t.players || []).length +
          ' in the squad · run it here or in the Dayli app</div></div>' +
          '<div class="row"><button class="btn" id="tm-invite">Copy invite link</button><a class="btn primary" href="' +
          teamUrl(cal, 'new') +
          '">+ Add fixture</a></div></div>' +
          '<div class="tm-tiles">' +
          tiles +
          '</div>' +
          body,
      );
      $('#tm-invite').onclick = function () {
        if (!d.code) return toast('No invite link for this team yet.');
        var link = SITE + '/join/' + d.code;
        copy(link, 'Invite link copied. Send it to your players.');
      };
      wire(d, tab);
    }
    function tile(label, value, sub) {
      return (
        '<div class="card tm-tile"><div class="label">' +
        esc(label) +
        '</div><div class="num">' +
        value +
        '</div><div class="muted small">' +
        sub +
        '</div></div>'
      );
    }
    function owingCount(pay) {
      var who = {};
      (pay.charges || []).forEach(function (c) {
        (c.dues || []).forEach(function (u) {
          if (u.status === 'owed') who[u.player_id] = 1;
        });
      });
      return Object.keys(who).length;
    }
    function copy(text, done) {
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
        function () {
          toast(done);
        },
        function () {
          window.prompt('Copy this link:', text);
        },
      );
    }

    // --- home ------------------------------------------------------------------

    function upcomingOf(t) {
      return (t.fixtures || []).filter(function (f) {
        return new Date(f.ends_at) > new Date();
      });
    }
    function nextUp(t) {
      var up = upcomingOf(t);
      return (
        up.filter(function (f) {
          return f.kind === 'match';
        })[0] || up[0]
      );
    }
    function dateBlock(f) {
      var d = new Date(f.starts_at);
      return (
        '<div class="th-dt"><div class="d">' +
        esc(d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: f.timezone || undefined }).toUpperCase()) +
        '</div><div class="n">' +
        esc(d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: f.timezone || undefined })) +
        '</div></div>'
      );
    }
    var AV = ['#3a61c9', '#b4432f', '#2f6b4f', '#d9741c', '#6e56cf', '#1c7a8c', '#8a5a2b', '#c2417a'];
    function avColour(p) {
      var k = String(p.id || p.name || '');
      var h = 0;
      for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
      return AV[h % AV.length];
    }
    function avatar(p, size) {
      var s = size || 28;
      return p.avatar_url
        ? '<img class="th-av" style="width:' + s + 'px;height:' + s + 'px" src="' + esc(p.avatar_url) + '" alt="" title="' + esc(p.name) + '" />'
        : '<span class="th-av" style="background:' +
            avColour(p) +
            ';width:' +
            s +
            'px;height:' +
            s +
            'px;font-size:' +
            Math.round(s * 0.38) +
            'px" title="' +
            esc(p.name) +
            '">' +
            esc(initials(p.name)) +
            '</span>';
    }
    function scored(results) {
      return (results || []).filter(function (r) {
        return r.kind === 'match' && r.score_us != null && r.score_them != null;
      });
    }
    function wdl(r) {
      return r.score_us > r.score_them ? 'W' : r.score_us < r.score_them ? 'L' : 'D';
    }
    function formChips(list) {
      return (
        '<span class="th-form">' +
        list
          .map(function (r) {
            var x = wdl(r);
            return '<i class="f' + x.toLowerCase() + '" title="' + esc(fixtureName(r) + ' ' + r.score_us + '–' + r.score_them) + '">' + x + '</i>';
          })
          .join('') +
        '</span>'
      );
    }
    function ago(iso) {
      var h = Math.max(1, Math.round((Date.now() - new Date(iso)) / 3600000));
      return h < 24 ? h + (h === 1 ? ' hour' : ' hours') + ' ago' : Math.round(h / 24) + ' days ago';
    }

    function drawHome(d) {
      var t = d.team;
      var cal = t.calendar_id;
      var me = (t.players || []).filter(function (p) {
        return p.is_me;
      })[0];
      var hour = new Date().getHours();
      var hello = (hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening') + (me ? ', ' + me.name.split(' ')[0] : '');
      var upcoming = upcomingOf(t);
      var next = nextUp(t);
      var nf = d.next && next && d.next.event_id === next.event_id ? d.next : null;

      // The next match (or whatever is next).
      var hero = '';
      var waiting = [];
      if (next) {
        var c = next.counts;
        var total = c.available + c.maybe + c.cant + c.none;
        if (nf) {
          waiting = (nf.players || []).filter(function (p) {
            return p.plays !== false && !p.status;
          });
        }
        var nudgeable = waiting.filter(function (p) {
          return p.user_id && !p.is_me;
        }).length;
        var recent = next.nudged_at && Date.now() - new Date(next.nudged_at) < 12 * 3600000;
        var pct = total ? (c.available / total) * 100 : 0;
        var pctM = total ? ((c.available + c.maybe) / total) * 100 : 0;
        var tz = next.timezone || undefined;
        var when = new Date(next.starts_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
        hero =
          '<div class="th-hero" style="--team:' +
          esc(t.color || '#6e56cf') +
          '"><div class="grow"><div class="th-kick">' +
          (next.kind === 'match' ? 'NEXT MATCH' : 'NEXT UP') +
          ' · ' +
          esc(daysAway(next.starts_at).toUpperCase()) +
          '</div><h2>' +
          esc(fixtureName(next)) +
          '</h2><div class="muted">' +
          esc(
            [
              when,
              time(next.starts_at, next.timezone) + (next.kind === 'match' ? ' kick-off' : ''),
              next.kind === 'match' ? (next.home ? 'Home' : 'Away') : KIND[next.kind],
              next.competition ? next.competition.charAt(0).toUpperCase() + next.competition.slice(1) : null,
              next.location,
            ]
              .filter(Boolean)
              .join(' · '),
          ) +
          '</div><div class="th-counts"><div><b class="g">' +
          c.available +
          '</b><small>Can play</small></div><div><b class="y">' +
          c.maybe +
          '</b><small>Maybe</small></div><div><b>' +
          c.none +
          '</b><small>Not replied</small></div><div><b class="r">' +
          c.cant +
          '</b><small>Can’t</small></div></div><div class="th-acts"><a class="btn primary" href="' +
          teamUrl(cal, 'fixture/' + next.event_id) +
          '">' +
          (next.kind === 'match' ? (next.sheet_sent ? 'Change the team' : 'Pick the team') : 'Who’s coming') +
          '</a>' +
          (nudgeable
            ? '<button class="btn" id="th-nudge"' +
              (recent ? ' disabled title="You can nudge again 12 hours after the last time."' : '') +
              '>' +
              (recent
                ? 'Nudged ' + ago(next.nudged_at)
                : nudgeable === waiting.length
                  ? 'Nudge the ' + nudgeable
                  : 'Nudge ' + nudgeable + ' on Dayli') +
              '</button>'
            : '') +
          '<button class="btn" id="th-share">Share to WhatsApp</button>' +
          (waiting.length
            ? '<span class="th-wait">Not replied: ' +
              waiting
                .slice(0, 5)
                .map(function (p) {
                  return avatar(p, 26);
                })
                .join('') +
              (waiting.length > 5 ? '<span class="muted small">+' + (waiting.length - 5) + '</span>' : '') +
              '</span>'
            : '') +
          '</div></div><div class="th-ring" style="background:conic-gradient(var(--accent) 0 ' +
          pct.toFixed(1) +
          '%,#e3b34a ' +
          pct.toFixed(1) +
          '% ' +
          pctM.toFixed(1) +
          '%,var(--alt) ' +
          pctM.toFixed(1) +
          '%)"><div><b>' +
          c.available +
          '/' +
          total +
          '</b><small>can play</small></div></div></div>';
      } else {
        hero =
          '<div class="th-hero th-empty"><div class="grow"><div class="th-kick">NOTHING PLANNED</div><h2>Add your next fixture</h2><div class="muted">It goes into every player’s Dayli calendar, and they can say whether they can play.</div><div class="th-acts"><a class="btn primary" href="' +
          teamUrl(cal, 'new') +
          '">+ Add fixture</a></div></div></div>';
      }

      // Last result, form, money (or the squad when payments aren't on).
      var sc = scored(d.results);
      var last = sc[0];
      var lastUnscored = (d.results || []).filter(function (r) {
        return r.kind === 'match' && (r.score_us == null || r.score_them == null);
      })[0];
      var tLast = last
        ? '<div class="th-v ' +
          wdl(last).toLowerCase() +
          '">' +
          last.score_us +
          '–' +
          last.score_them +
          '</div><div class="small"><b>' +
          (wdl(last) === 'W' ? 'Won ' : wdl(last) === 'L' ? 'Lost ' : 'Drew ') +
          esc(fixtureName(last)) +
          '</b><div class="muted">' +
          esc(day(last.starts_at, last.timezone)) +
          '</div></div>'
        : lastUnscored
          ? '<div class="small"><b>' +
            esc(fixtureName(lastUnscored)) +
            '</b><div class="muted">No score yet</div></div><a class="act" href="' +
            teamUrl(cal, 'fixture/' + lastUnscored.event_id) +
            '">Add score</a>'
          : '<div class="small muted">No results yet. Add the score after a match and followers see it.</div>';
      var w = 0,
        dr = 0,
        l = 0;
      sc.forEach(function (r) {
        var x = wdl(r);
        if (x === 'W') w++;
        else if (x === 'D') dr++;
        else l++;
      });
      var tForm = sc.length
        ? '<div class="th-formrow">' +
          formChips(sc.slice(0, 5).reverse()) +
          '</div><div class="small muted">Played ' +
          sc.length +
          ' · Won ' +
          w +
          ' · Drew ' +
          dr +
          ' · Lost ' +
          l +
          '</div>'
        : '<div class="small muted">Your last five results show here.</div>';
      var tiles =
        '<div class="card th-tile"><div class="label">Last result</div><div class="th-tl">' +
        tLast +
        '</div></div><div class="card th-tile"><div class="label">Form · last 5</div>' +
        tForm +
        '</div>';
      var owing = d.pay && d.pay.totals ? owingCount(d.pay) : 0;
      if (d.pay && d.pay.totals) {
        tiles +=
          '<div class="card th-tile"><div class="label">Money</div><div class="th-tl"><div class="th-v o">' +
          pounds(d.pay.totals.owed_pence) +
          '</div><div class="small grow"><b>' +
          (owing ? 'owed by ' + owing + (owing === 1 ? ' person' : ' people') : 'nobody owes anything') +
          '</b><div class="muted">' +
          pounds(d.pay.totals.collected_pence) +
          ' in so far</div></div>' +
          (owing
            ? '<button class="act" id="th-remind">Remind</button>'
            : '<a class="act" href="' + teamUrl(cal, 'payments') + '">Payments</a>') +
          '</div></div>';
      } else {
        var onDayli = (t.players || []).filter(function (p) {
          return p.user_id;
        }).length;
        tiles +=
          '<div class="card th-tile"><div class="label">Squad</div><div class="th-tl"><div class="th-v">' +
          (t.players || []).length +
          '</div><div class="small grow"><b>in the squad</b><div class="muted">' +
          onDayli +
          ' on Dayli</div></div><a class="act" href="' +
          teamUrl(cal, 'squad') +
          '">Squad</a></div></div>';
      }

      // After that: the next few entries.
      var after = upcoming
        .filter(function (f) {
          return !next || f.event_id !== next.event_id;
        })
        .slice(0, 4);
      var afterHtml = after.length
        ? after
            .map(function (f) {
              var c2 = f.counts;
              var tot = c2.available + c2.maybe + c2.cant + c2.none;
              return (
                '<a class="th-row" href="' +
                teamUrl(cal, 'fixture/' + f.event_id) +
                '">' +
                dateBlock(f) +
                '<div class="grow"><b>' +
                esc(fixtureName(f)) +
                '</b><div class="small muted">' +
                esc(
                  [time(f.starts_at, f.timezone), f.kind === 'match' ? (f.home ? 'Home' : 'Away') : KIND[f.kind], f.location]
                    .filter(Boolean)
                    .join(' · '),
                ) +
                '</div></div>' +
                (f.ask === false
                  ? ''
                  : '<div class="th-mini small muted">' +
                    c2.available +
                    ' can play · ' +
                    c2.none +
                    ' not replied' +
                    countsBar(c2, tot) +
                    '</div>') +
                '</a>'
              );
            })
            .join('')
        : '<p class="muted small">Nothing else planned yet. <a href="' + teamUrl(cal, 'new') + '">Add a fixture</a>.</p>';

      // Getting started.
      var squadSize = (t.players || []).length;
      var joined = (t.players || []).filter(function (p) {
        return p.user_id;
      }).length;
      var steps = [
        { done: true, text: 'Set up your team' },
        {
          done: upcoming.length > 0 || (d.results || []).length > 0,
          text: 'Add your fixtures',
          go: '<a href="' + teamUrl(cal, 'new') + '">Add one</a>',
        },
        {
          done: squadSize > 1 && joined >= squadSize,
          text: squadSize > 1 ? 'Invite the rest (' + joined + ' of ' + squadSize + ' in)' : 'Invite your squad',
          go: '<button class="linkish" data-copy-invite>Copy link</button>',
        },
      ];
      if (d.pay) {
        steps.push({
          done: !!(d.pay.payout && d.pay.payout.ready),
          text: 'Collect subs by card',
          go: '<a href="' + teamUrl(cal, 'payments') + '">Set up</a>',
        });
      }
      var doneCount = steps.filter(function (x) {
        return x.done;
      }).length;
      var started =
        doneCount < steps.length
          ? '<div class="card th-start"><h3>Getting started<span class="th-more muted">' +
            doneCount +
            ' of ' +
            steps.length +
            '</span></h3>' +
            steps
              .map(function (x) {
                return (
                  '<div class="th-todo' +
                  (x.done ? ' done' : '') +
                  '"><span class="th-ck">' +
                  (x.done ? '✓' : '') +
                  '</span><span class="grow">' +
                  esc(x.text) +
                  '</span>' +
                  (x.done ? '' : x.go || '') +
                  '</div>'
                );
              })
              .join('') +
            '</div>'
          : '';

      render(
        '<div class="th-head"><div><div class="muted th-date">' +
          esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })) +
          '</div><h1>' +
          esc(hello) +
          '</h1></div><div class="row"><button class="btn" data-copy-invite>Copy squad invite link</button><a class="btn primary" href="' +
          teamUrl(cal, 'new') +
          '">+ Add fixture</a></div></div>' +
          hero +
          '<div class="th-tiles">' +
          tiles +
          '</div><div class="th-bottom' +
          (started ? '' : ' one') +
          '"><div class="card"><h3>After that<a class="th-more" href="' +
          teamUrl(cal, 'fixtures') +
          '">All fixtures</a></h3>' +
          afterHtml +
          '</div>' +
          started +
          '</div>',
      );

      $$('[data-copy-invite]').forEach(function (b) {
        b.onclick = function () {
          if (!d.code) return toast('No invite link for this team yet.');
          copy(SITE + '/join/' + d.code, 'Invite link copied. Send it to your players.');
        };
      });
      if ($('#th-nudge'))
        $('#th-nudge').onclick = function () {
          var button = this;
          setBusy(button, true);
          rpc('team_nudge', { p_event: next.event_id }).then(
            function (n) {
              toast(n ? 'Nudged ' + n + (n === 1 ? ' player' : ' players') + '. They’ll get a notification.' : 'Everyone on Dayli has answered.');
              button.textContent = 'Nudged just now';
              button.disabled = true;
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
        };
      if ($('#th-share'))
        $('#th-share').onclick = function () {
          var f = next;
          var text =
            'Can you make ' +
            (f.kind === 'match' ? fixtureName(f) : fixtureName(f).toLowerCase()) +
            ' on ' +
            day(f.starts_at, f.timezone) +
            ' at ' +
            time(f.starts_at, f.timezone) +
            (f.location ? ' (' + f.location + ')' : '') +
            '? Say yes, maybe or no in the Dayli app.' +
            (d.code ? ' Not on Dayli yet? Join the team: ' + SITE + '/join/' + d.code : '');
          window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
        };
      if ($('#th-remind'))
        $('#th-remind').onclick = function () {
          var button = this;
          var open = (d.pay.charges || []).filter(function (ch) {
            return (
              !ch.closed &&
              (ch.dues || []).some(function (u) {
                return u.status === 'owed';
              })
            );
          });
          setBusy(button, true);
          Promise.all(
            open.map(function (ch) {
              return rpc('team_charge_remind', { p_charge: ch.id });
            }),
          ).then(
            function (ns) {
              var n = ns.reduce(function (a, b) {
                return a + (b || 0);
              }, 0);
              setBusy(button, false);
              toast(n ? 'Reminded ' + n + '. They get a notification with a pay button.' : 'Everyone who owes was reminded in the last 12 hours.');
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
        };
    }

    // --- fixtures & results: a month calendar with the results beside it --------

    function ymd(iso, tz) {
      // The fixture's own date where it's played (en-CA gives 2026-11-15).
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || undefined,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(iso));
    }
    function pad(n) {
      return (n < 10 ? '0' : '') + n;
    }
    function cap(s) {
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    }

    function drawFixturesPage(d, query) {
      var t = d.team;
      var cal = t.calendar_id;
      var now = new Date();
      var m = /^(\d{4})-(\d{2})$/.exec(query.m || '');
      var year = m ? +m[1] : now.getFullYear();
      var month = m ? +m[2] - 1 : now.getMonth();
      var view =
        query.view === 'list' || query.view === 'month' ? query.view : window.innerWidth < 760 ? 'list' : 'month';
      var results = d.results || [];
      var all = results.concat(
        (t.fixtures || []).filter(function (f) {
          return !results.some(function (r) {
            return r.event_id === f.event_id;
          });
        }),
      );
      var byDay = {};
      all.forEach(function (f) {
        var k = ymd(f.starts_at, f.timezone);
        (byDay[k] = byDay[k] || []).push(f);
      });
      Object.keys(byDay).forEach(function (k) {
        byDay[k].sort(function (a, b) {
          return new Date(a.starts_at) - new Date(b.starts_at);
        });
      });
      function monthHash(y, mo) {
        var dt = new Date(y, mo, 1);
        return teamUrl(cal, 'fixtures') + '?m=' + dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '&view=month';
      }
      function pill(f) {
        var past = new Date(f.ends_at) < now;
        var cls = 'tf-pt';
        var label = time(f.starts_at, f.timezone) + ' ' + fixtureName(f);
        if (f.kind === 'match') {
          cls = 'tf-pm';
          if (past && f.score_us != null && f.score_them != null) {
            var x = wdl(f);
            cls = x === 'W' ? 'tf-pw' : x === 'L' ? 'tf-pl' : 'tf-pd';
            label = x + ' ' + f.score_us + '–' + f.score_them + ' ' + fixtureName(f);
          } else if (past) {
            cls = 'tf-pd';
            label = fixtureName(f) + ' · add score';
          }
        }
        return (
          '<a class="tf-pill ' +
          cls +
          '" href="' +
          teamUrl(cal, 'fixture/' + f.event_id) +
          '" title="' +
          esc(label + (f.location ? ' · ' + f.location : '')) +
          '">' +
          esc(label) +
          '</a>'
        );
      }

      // The month grid, Monday first.
      var first = new Date(year, month, 1);
      var lead = (first.getDay() + 6) % 7;
      var daysIn = new Date(year, month + 1, 0).getDate();
      var weeks = Math.ceil((lead + daysIn) / 7);
      var todayKey = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
      var cells = '';
      for (var i = 0; i < weeks * 7; i++) {
        var dt = new Date(year, month, 1 - lead + i);
        var key = dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
        cells +=
          '<div class="tf-c' +
          (dt.getMonth() !== month ? ' x' : '') +
          (key === todayKey ? ' td' : '') +
          '"><div class="tf-n">' +
          dt.getDate() +
          '</div>' +
          (byDay[key] || []).map(pill).join('') +
          '</div>';
      }
      var wd = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
        .map(function (x) {
          return '<div class="tf-wd">' + x + '</div>';
        })
        .join('');
      var monthName = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      var legend =
        '<span class="tf-legend"><span class="tf-pill tf-pm">Match</span><span class="tf-pill tf-pt">Training</span>' +
        '<span class="tf-pill tf-pw">Won</span><span class="tf-pill tf-pl">Lost</span></span>';
      var toggle =
        '<span class="tf-seg"><a class="' +
        (view === 'month' ? 'on' : '') +
        '" href="' +
        monthHash(year, month) +
        '">Month</a><a class="' +
        (view === 'list' ? 'on' : '') +
        '" href="' +
        teamUrl(cal, 'fixtures') +
        '?view=list">List</a></span>';
      var main =
        view === 'month'
          ? '<div class="tf-mh"><a class="act tf-nav" href="' +
            monthHash(year, month - 1) +
            '" aria-label="Previous month">‹</a><h2>' +
            esc(monthName) +
            '</h2><a class="act tf-nav" href="' +
            monthHash(year, month + 1) +
            '" aria-label="Next month">›</a>' +
            toggle +
            legend +
            '</div><div class="tf-cal">' +
            wd +
            cells +
            '</div><p class="muted small">Click a match to see who can play, pick the team or add the score.</p>'
          : '<div class="tf-mh">' + toggle + '</div>' + drawFixtures(d, nextUp(t), true);

      // Results down the side.
      var sc = scored(results);
      var w = 0;
      var dr = 0;
      var l = 0;
      sc.forEach(function (r) {
        var x = wdl(r);
        if (x === 'W') w++;
        else if (x === 'D') dr++;
        else l++;
      });
      var missing = results.filter(function (r) {
        return r.kind === 'match' && (r.score_us == null || r.score_them == null);
      });
      var side =
        '<div class="card tf-res"><h3>Results<span class="th-more muted">' +
        (sc.length ? sc.length + ' played' : '') +
        '</span></h3>' +
        (sc.length
          ? '<div class="tf-formrow"><span class="muted small">Form</span>' +
            formChips(sc.slice(0, 5).reverse()) +
            '<span class="muted small tf-wdl">W' +
            w +
            ' D' +
            dr +
            ' L' +
            l +
            '</span></div>' +
            sc
              .slice(0, 8)
              .map(function (r) {
                return (
                  '<a class="tf-r" href="' +
                  teamUrl(cal, 'fixture/' + r.event_id) +
                  '"><span class="tf-sc ' +
                  wdl(r).toLowerCase() +
                  '">' +
                  r.score_us +
                  '–' +
                  r.score_them +
                  '</span><span class="grow"><b>' +
                  esc(fixtureName(r)) +
                  '</b><span class="muted small">' +
                  esc(day(r.starts_at, r.timezone) + (r.competition ? ' · ' + cap(r.competition) : '')) +
                  '</span></span></a>'
                );
              })
              .join('')
          : '<p class="muted small">No scores yet. Open a match after it’s played and add the score; followers see it in Dayli.</p>') +
        missing
          .slice(0, 3)
          .map(function (r) {
            return (
              '<a class="tf-miss" href="' +
              teamUrl(cal, 'fixture/' + r.event_id) +
              '"><span class="grow">Score missing: ' +
              esc(fixtureName(r)) +
              ' <span class="muted">(' +
              esc(day(r.starts_at, r.timezone)) +
              ')</span></span><span class="act">Add</span></a>'
            );
          })
          .join('') +
        '</div>';

      render(
        '<div class="th-head"><h1>Fixtures &amp; results</h1><div class="row"><a class="btn primary" href="' +
          teamUrl(cal, 'new') +
          '">+ Add fixture</a></div></div><div class="tf-grid"><div class="tf-main">' +
          main +
          '</div>' +
          side +
          '</div>',
      );
      $$('tr.tm-row').forEach(function (tr) {
        tr.onclick = function () {
          go(tr.dataset.href);
        };
      });
    }

    // --- fixtures tab ---------------------------------------------------------

    function drawFixtures(d, next, noPast) {
      var t = d.team;
      var cal = t.calendar_id;
      var upcoming = (t.fixtures || []).filter(function (f) {
        return new Date(f.ends_at) > new Date();
      });
      var nextCard = next
        ? '<a class="tm-next" href="' +
          teamUrl(cal, 'fixture/' + next.event_id) +
          '"><div class="tm-date"><div class="d">' +
          esc(day(next.starts_at, next.timezone).split(' ')[0].replace(',', '').toUpperCase()) +
          '</div><div class="n">' +
          new Date(next.starts_at).getDate() +
          '</div><div class="m">' +
          esc(new Date(next.starts_at).toLocaleDateString('en-GB', { month: 'short' })) +
          '</div></div><div class="grow"><b class="tm-big">' +
          esc(fixtureName(next)) +
          '</b><div class="muted small">' +
          esc(
            [KIND[next.kind], time(next.starts_at, next.timezone), next.location, next.kit ? 'Kit: ' + next.kit : null]
              .filter(Boolean)
              .join(' · '),
          ) +
          '</div></div><div class="tm-avail"><div class="small">' +
          countsText(next.counts) +
          '</div>' +
          countsBar(next.counts) +
          '<span class="btn primary small">' +
          (next.kind === 'match' ? (next.sheet_sent ? 'Team sent · change' : 'Pick the team') : 'Who’s coming') +
          '</span></div></a>'
        : '';
      var rows = upcoming
        .map(function (f) {
          return fixtureRow(cal, f, false);
        })
        .join('');
      var past = d.results
        .map(function (f) {
          return fixtureRow(cal, f, true);
        })
        .join('');
      return (
        '<div class="card"><h3>Coming up</h3><p class="sub">Tap one to see who’s coming and pick the team.</p>' +
        nextCard +
        (rows
          ? '<div class="scroll-x"><table class="tm-table"><tr><th>Date</th><th>What</th><th></th><th>Time</th><th>Answers</th></tr>' +
            rows +
            '</table></div>'
          : '<p class="muted">Nothing planned. <a href="' + teamUrl(cal, 'new') + '">Add a fixture</a>.</p>') +
        '</div>' +
        (noPast ? '' : '<div class="card"><h3>Results</h3><p class="sub">Past matches and sessions. Add the score to a match and followers see it.</p>' +
        (past
          ? '<div class="scroll-x"><table class="tm-table"><tr><th>Date</th><th>What</th><th></th><th>Result</th><th>Played</th></tr>' +
            past +
            '</table></div>'
          : '<p class="muted">No results yet.</p>') +
        '</div>')
      );
    }
    function fixtureRow(cal, f, past) {
      return (
        '<tr class="tm-row" data-href="' +
        teamUrl(cal, 'fixture/' + f.event_id) +
        '"><td class="nowrap">' +
        esc(day(f.starts_at, f.timezone)) +
        '</td><td><b>' +
        esc(fixtureName(f)) +
        '</b>' +
        (f.kind !== 'match' && fixtureName(f) !== KIND[f.kind] ? ' <span class="pill">' + KIND[f.kind] + '</span>' : '') +
        '</td><td class="muted small">' +
        (f.kind === 'match' ? (f.home ? 'HOME' : 'AWAY') : '') +
        '</td><td>' +
        (past
          ? result(f) || (f.kind === 'match' ? '<span class="muted small">Add score</span>' : '—')
          : esc(time(f.starts_at, f.timezone))) +
        '</td><td class="small">' +
        (past ? f.counts.available + ' came' : f.counts.available + ' yes · ' + f.counts.none + ' waiting') +
        '</td></tr>'
      );
    }

    // --- one fixture: who's coming, the team, the score -------------------------

    function screenFixture(cal, eventId) {
      loading();
      rpc('team_fixture', { p_event: eventId }).then(
        function (f) {
          if (!f) return go(teamUrl(cal));
          drawFixture(cal, f);
        },
        function (err) {
          render(notice('error', esc(friendly(err))) + '<a class="btn" href="' + teamUrl(cal) + '">Back</a>');
        },
      );
    }
    // How many start, by sport and format; football also has pitch shapes.
    var LINEUP = {
      football: {
        11: { n: 11, shapes: ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2'] },
        7: { n: 7, shapes: ['2-3-1', '3-2-1', '2-1-2-1', '3-1-2'] },
        5: { n: 5, shapes: ['2-1-1', '1-2-1', '2-2'] },
      },
      rugby: { union: { n: 15 }, league: { n: 13 }, sevens: { n: 7 }, touch: { n: 6 } },
      netball: 7,
      cricket: 11,
      hockey: 11,
      basketball: 5,
      volleyball: 6,
      handball: 7,
      lacrosse: 10,
      gaelic: 15,
      hurling: 15,
      softball: 10,
      rounders: 9,
      ultimate: 7,
      korfball: 8,
      waterpolo: 7,
    };
    function lineupOf(sport, format) {
      var s = LINEUP[sport];
      if (!s) return { n: 11, shapes: [] };
      if (typeof s === 'number') return { n: s, shapes: [] };
      var f = s[format] || s[Object.keys(s)[0]];
      return { n: f.n, shapes: f.shapes || [] };
    }
    // Where each shirt stands (as in the app's formationSpots): 1 is the
    // keeper at the bottom, then each line from the back, left to right.
    function spotsFor(shape) {
      var lines = String(shape)
        .split('-')
        .map(Number)
        .filter(function (n) {
          return n > 0;
        });
      var spots = [{ pos: 1, x: 0.5, y: 0.89 }];
      var last = lines.length - 1;
      lines.forEach(function (n, i) {
        var y = last === 0 ? 0.45 : 0.7 - (i * 0.54) / last;
        for (var j = 0; j < n; j++) {
          spots.push({ pos: spots.length + 1, x: n === 1 ? 0.5 : 0.14 + (j * 0.72) / (n - 1), y: y });
        }
      });
      return spots;
    }

    function drawFixture(cal, f) {
      var past = new Date(f.ends_at) < new Date();
      var picking = f.kind === 'match';
      var players = (f.players || []).filter(function (p) {
        return p.role !== 'manager' || p.plays;
      });
      var byId = {};
      players.forEach(function (p) {
        byId[p.id] = p;
      });
      var lu = lineupOf(f.sport, f.format);
      var shape = lu.shapes.indexOf(f.formation) >= 0 ? f.formation : lu.shapes[0] || null;

      // The picked team, kept here until saved: {player: 'start' | 'sub'} and,
      // on a pitch, {player: position}.
      var sel = {};
      var pos = {};
      players.forEach(function (p) {
        if (p.slot === 'start' || p.slot === 'sub') sel[p.id] = p.slot;
      });
      function places() {
        return shape ? spotsFor(shape).length : lu.n;
      }
      function settle() {
        // Starters keep their place where it fits; the rest fill the gaps in order.
        var n = places();
        var taken = {};
        var out = {};
        Object.keys(sel).forEach(function (id) {
          if (sel[id] === 'start' && pos[id] && pos[id] <= n && !taken[pos[id]]) {
            out[id] = pos[id];
            taken[pos[id]] = true;
          }
        });
        var next = 1;
        Object.keys(sel).forEach(function (id) {
          if (sel[id] !== 'start' || out[id]) return;
          while (taken[next]) next++;
          if (next > n) {
            sel[id] = 'sub';
            return;
          }
          out[id] = next;
          taken[next] = true;
        });
        pos = out;
      }
      players.forEach(function (p) {
        if (p.slot === 'start' && p.pos) pos[p.id] = p.pos;
      });
      settle();
      var dirty = false;
      var picked = null; // a player chosen on the pitch, waiting for where to go

      var when = new Date(f.starts_at).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: f.timezone || undefined,
      });
      var head =
        '<a class="th-back" href="' +
        teamUrl(cal, 'fixtures') +
        '">‹ Fixtures &amp; results</a><div class="th-head tp-head"><div><div class="muted th-date">' +
        esc(
          [
            when,
            time(f.starts_at, f.timezone),
            f.meet_at ? 'meet ' + time(f.meet_at, f.timezone) : null,
            f.kind === 'match' ? (f.home ? 'Home' : 'Away') : KIND[f.kind],
            f.competition ? cap(f.competition) : null,
            f.location,
          ]
            .filter(Boolean)
            .join(' · '),
        ) +
        '</div><h1>' +
        esc(fixtureName(f)) +
        ' ' +
        result(f) +
        '</h1></div><div class="row"><button class="btn" id="tm-del">Delete</button><button class="btn" id="tp-share">Share to WhatsApp</button>' +
        (picking && !past
          ? '<button class="btn primary" id="tm-send-team">' + (f.sheet_sent ? 'Send the changes' : 'Send the team to the squad') + '</button>'
          : '') +
        '</div></div>';
      var score =
        past && f.kind === 'match'
          ? '<div class="card tp-score"><h3>Score</h3><div class="row"><label>' +
            esc(f.team_name) +
            ' <input type="number" min="0" max="99" id="tm-us" value="' +
            (f.score_us == null ? '' : f.score_us) +
            '" class="tm-score" /></label><label>' +
            esc(f.opponent || 'Them') +
            ' <input type="number" min="0" max="99" id="tm-them" value="' +
            (f.score_them == null ? '' : f.score_them) +
            '" class="tm-score" /></label><button class="btn primary" id="tm-save-score">Save score</button></div></div>'
          : '';

      function tag(p) {
        if (!picking) return '';
        var s = sel[p.id];
        if (!s && p.status === 'cant') return '';
        return '<span class="tp-tag ' + (s || 'free') + '">' + (s === 'start' ? 'PITCH' : s === 'sub' ? 'BENCH' : 'FREE') + '</span>';
      }
      function row(p) {
        return (
          '<div class="tp-pl' +
          (sel[p.id] ? ' ' + sel[p.id] : '') +
          '" draggable="true" data-p="' +
          esc(p.id) +
          '" title="' +
          (picking ? 'Click to put in or take out of the team. Drag to another column to change the answer.' : 'Drag to another column to change the answer.') +
          '">' +
          avatar(p, 24) +
          '<span class="grow" title="' +
          esc(p.name + (p.position ? ' · ' + p.position : '')) +
          '">' +
          esc(shortName(p.name)) +
          (p.position ? ' <small class="muted">' + esc(posShort(p.position)) + '</small>' : '') +
          '</span>' +
          tag(p) +
          '</div>' +
          (p.note ? '<div class="tp-why">“' + esc(p.note) + '”</div>' : '')
        );
      }
      function column(status, title, colour, list, empty) {
        return (
          '<div class="tp-col" data-status="' +
          status +
          '"><h4><i style="background:' +
          colour +
          '"></i>' +
          title +
          ' · ' +
          list.length +
          '</h4>' +
          (list.length ? list.map(row).join('') : '<div class="muted small tp-empty">' + empty + '</div>') +
          '</div>'
        );
      }
      function pitchHtml() {
        var starters = Object.keys(sel).filter(function (id) {
          return sel[id] === 'start';
        });
        var bench = Object.keys(sel).filter(function (id) {
          return sel[id] === 'sub';
        });
        var top =
          '<div class="tp-top">' +
          (lu.shapes.length
            ? '<span class="tf-seg tp-shapes">' +
              lu.shapes
                .map(function (s) {
                  return '<a href="#" data-shape="' + s + '" class="' + (s === shape ? 'on' : '') + '">' + s + '</a>';
                })
                .join('') +
              '</span>'
            : '') +
          '<span class="muted small tp-count">' +
          starters.length +
          ' of ' +
          places() +
          ' picked' +
          (bench.length ? ' · ' + bench.length + ' on the bench' : '') +
          '</span></div>';
        var field;
        if (shape) {
          var at = {};
          starters.forEach(function (id) {
            at[pos[id]] = id;
          });
          field =
            '<div class="tp-pitch"><div class="ln box"></div><div class="ln half"></div><div class="ln circle"></div><div class="ln area top"></div><div class="ln area bottom"></div>' +
            spotsFor(shape)
              .map(function (s) {
                var id = at[s.pos];
                var p = id && byId[id];
                return (
                  '<div class="tp-spot' +
                  (p ? '' : ' open') +
                  (id && picked === id ? ' on' : '') +
                  '" data-spot="' +
                  s.pos +
                  '"' +
                  (p ? ' draggable="true" data-p="' + esc(id) + '"' : '') +
                  ' style="left:' +
                  (s.x * 100).toFixed(1) +
                  '%;top:' +
                  (s.y * 100).toFixed(1) +
                  '%">' +
                  (p ? avatar(p, 40) + '<b>' + esc(shortName(p.name)) + '</b>' : '<span class="tp-add">+</span>') +
                  '</div>'
                );
              })
              .join('') +
            '</div>';
        } else {
          var list = starters.map(function (id) {
            return byId[id];
          });
          var slots = '';
          for (var i = 0; i < lu.n; i++) {
            var p = list[i];
            slots +=
              '<div class="tp-slot' +
              (p ? '' : ' open') +
              '"' +
              (p ? ' draggable="true" data-p="' + esc(p.id) + '"' : ' data-spot="list"') +
              '><span class="n">' +
              (i + 1) +
              '</span>' +
              (p ? avatar(p, 24) + esc(p.name) : '<span class="muted">Free place</span>') +
              '</div>';
          }
          field = '<div class="tp-slots">' + slots + '</div>';
        }
        var benchHtml =
          '<div class="tp-bench" data-spot="bench"><b>Bench</b>' +
          bench
            .map(function (id) {
              var p = byId[id];
              return (
                '<span class="tp-sub" draggable="true" data-p="' +
                esc(id) +
                '">' +
                avatar(p, 24) +
                esc(shortName(p.name)) +
                (p.status === 'maybe' ? ' <span class="tp-tag maybe">MAYBE</span>' : '') +
                '</span>'
              );
            })
            .join('') +
          '<span class="tp-drop">+ sub</span></div>';
        return (
          top +
          field +
          benchHtml +
          '<div class="row tp-save"><button class="btn" id="tm-save-team"' +
          (dirty ? '' : ' disabled') +
          '>Save, don’t send</button><span class="muted small">' +
          (f.sheet_sent ? 'The squad has the team. Changes go out when you send them.' : 'Only the managers see it until you send it.') +
          '</span></div>'
        );
      }

      function draw() {
        var groups = { available: [], maybe: [], cant: [], none: [] };
        players.forEach(function (p) {
          groups[p.status || 'none'].push(p);
        });
        var waiting = groups.none;
        var nudgeable = waiting.filter(function (p) {
          return p.user_id && !p.is_me;
        }).length;
        var recent = f.nudged_at && Date.now() - new Date(f.nudged_at) < 12 * 3600000;
        var cols =
          '<div class="tp-cols">' +
          column('available', picking ? 'Can play' : 'Coming', 'var(--accent)', groups.available, 'Nobody yet') +
          column('maybe', 'Maybe', '#e3b34a', groups.maybe, 'Nobody') +
          column('cant', picking ? 'Can’t play' : 'Can’t come', 'var(--danger)', groups.cant, 'Nobody yet') +
          '</div>' +
          (waiting.length
            ? '<div class="tp-nr" data-status="none"><b>Not replied · ' +
              waiting.length +
              '</b><span class="tp-nrl">' +
              waiting
                .map(function (p) {
                  return '<span class="tp-chip" draggable="true" data-p="' + esc(p.id) + '">' + avatar(p, 22) + esc(shortName(p.name)) + '</span>';
                })
                .join('') +
              '</span>' +
              (f.nudged_at ? '<span class="muted small">nudged ' + ago(f.nudged_at) + '</span>' : '') +
              (!past && nudgeable
                ? '<button class="act tp-nudge" id="tp-nudge"' +
                  (recent ? ' disabled' : '') +
                  '>' +
                  (recent ? 'Nudged' : 'Nudge ' + (nudgeable === waiting.length ? (nudgeable === 1 ? 'them' : 'all ' + nudgeable) : nudgeable + ' on Dayli')) +
                  '</button>'
                : '') +
              '</div>'
            : '') +
          '<p class="muted small tp-hint">' +
          (picking ? 'Click a name to put them in the team (or the bench, once it’s full); click again to move them on. ' : '') +
          'Answered for someone in person? Drag their name to the right column.</p>';
        render(
          head +
            score +
            (picking
              ? '<div class="tp-grid"><div>' + cols + '</div><div class="tp-right">' + pitchHtml() + '</div></div>'
              : cols),
        );
        wire();
      }

      function setAnswer(id, status) {
        var p = byId[id];
        if (!p || (p.status || 'none') === status) return;
        var before = p.status;
        p.status = status === 'none' ? null : status;
        if (status === 'cant' && sel[id]) {
          delete sel[id];
          delete pos[id];
          settle();
          dirty = true;
        }
        draw();
        rpc('team_set_availability', {
          p_event: f.event_id,
          p_status: p.status,
          p_player: id,
          p_guests: null,
        }).then(
          function () {
            toast(p.name + ': ' + (p.status ? STATUS[p.status] : 'no answer'));
          },
          function (err) {
            p.status = before;
            draw();
            toast(friendly(err));
          },
        );
      }
      function toggle(id) {
        if (!picking) return;
        var s = sel[id];
        var starters = Object.keys(sel).filter(function (k) {
          return sel[k] === 'start';
        }).length;
        if (!s) sel[id] = starters < places() ? 'start' : 'sub';
        else if (s === 'start') sel[id] = 'sub';
        else delete sel[id];
        if (sel[id] !== 'start') delete pos[id];
        settle();
        dirty = true;
        draw();
      }
      function moveTo(id, spot) {
        if (spot === 'bench') {
          sel[id] = 'sub';
          delete pos[id];
        } else if (spot === 'list') {
          sel[id] = 'start';
        } else {
          var n = Number(spot);
          var other = Object.keys(pos).filter(function (k) {
            return pos[k] === n;
          })[0];
          if (other && other !== id) {
            // Swap: the one there takes this player's old place (or the bench).
            if (sel[id] === 'start' && pos[id]) pos[other] = pos[id];
            else {
              sel[other] = 'sub';
              delete pos[other];
            }
          }
          sel[id] = 'start';
          pos[id] = n;
        }
        settle();
        dirty = true;
        picked = null;
        draw();
      }

      function wire() {
        $$('.tp-pl[data-p]').forEach(function (el) {
          el.onclick = function () {
            toggle(el.dataset.p);
          };
        });
        $$('.tp-spot').forEach(function (el) {
          el.onclick = function () {
            var id = el.dataset.p;
            if (picked && picked !== id) return moveTo(picked, el.dataset.spot);
            if (id) {
              picked = picked === id ? null : id;
              draw();
            }
          };
        });
        $$('.tp-sub').forEach(function (el) {
          el.onclick = function () {
            if (picked) return;
            toggle(el.dataset.p);
          };
        });
        if ($('#tp-nudge'))
          $('#tp-nudge').onclick = function () {
            var button = this;
            setBusy(button, true);
            rpc('team_nudge', { p_event: f.event_id }).then(
              function (n) {
                f.nudged_at = new Date().toISOString();
                toast(n ? 'Nudged ' + n + (n === 1 ? ' player' : ' players') + '. They’ll get a notification.' : 'Everyone on Dayli has answered.');
                draw();
              },
              function (err) {
                setBusy(button, false);
                toast(friendly(err));
              },
            );
          };
        $$('[data-shape]').forEach(function (a) {
          a.onclick = function (e) {
            e.preventDefault();
            shape = a.dataset.shape;
            settle();
            dirty = true;
            draw();
          };
        });
        // Dragging: names onto the pitch, the bench or another answer column.
        $$('[draggable="true"][data-p]').forEach(function (el) {
          el.ondragstart = function (e) {
            e.dataTransfer.setData('text/plain', el.dataset.p);
            e.dataTransfer.effectAllowed = 'move';
          };
        });
        function drop(el, fn) {
          el.ondragover = function (e) {
            e.preventDefault();
            el.classList.add('over');
          };
          el.ondragleave = function () {
            el.classList.remove('over');
          };
          el.ondrop = function (e) {
            e.preventDefault();
            el.classList.remove('over');
            var id = e.dataTransfer.getData('text/plain');
            if (id && byId[id]) fn(id);
          };
        }
        $$('[data-status]').forEach(function (el) {
          drop(el, function (id) {
            setAnswer(id, el.dataset.status);
          });
        });
        if (picking) {
          $$('[data-spot]').forEach(function (el) {
            drop(el, function (id) {
              moveTo(id, el.dataset.spot);
            });
          });
        }
        if ($('#tm-save-team')) $('#tm-save-team').onclick = function () {
          saveTeam(false, this);
        };
        if ($('#tm-send-team')) $('#tm-send-team').onclick = function () {
          saveTeam(true, this);
        };
        $('#tp-share').onclick = share;
        if ($('#tm-save-score')) $('#tm-save-score').onclick = saveScore;
        $('#tm-del').onclick = del;
      }

      function saveTeam(send, button) {
        var starters = Object.keys(sel).filter(function (k) {
          return sel[k] === 'start';
        }).length;
        if (send && !starters && !confirm('Nobody is picked. Send an empty team?')) return;
        setBusy(button, true);
        rpc('team_set_selection', {
          p_event: f.event_id,
          p_selection: sel,
          p_send: send,
          p_positions: shape ? pos : null,
          p_formation: shape,
        }).then(
          function () {
            toast(send ? 'Team sent. Everyone on Dayli gets it on their phone.' : 'Saved. Only the managers see it until you send it.');
            screenFixture(cal, f.event_id);
          },
          function (err) {
            setBusy(button, false);
            toast(friendly(err));
          },
        );
      }
      function share() {
        var starters = Object.keys(sel)
          .filter(function (k) {
            return sel[k] === 'start';
          })
          .sort(function (a, b) {
            return (pos[a] || 99) - (pos[b] || 99);
          });
        var subs = Object.keys(sel).filter(function (k) {
          return sel[k] === 'sub';
        });
        var first = function (id) {
          return byId[id].name.split(' ')[0];
        };
        var line =
          fixtureName(f) +
          ', ' +
          day(f.starts_at, f.timezone) +
          ' ' +
          time(f.starts_at, f.timezone) +
          (f.meet_at ? ' (meet ' + time(f.meet_at, f.timezone) + ')' : '') +
          (f.location ? ', ' + f.location : '');
        var text = starters.length
          ? 'Team for ' + line + '\n\n' + starters.map(first).join(', ') + (subs.length ? '\nSubs: ' + subs.map(first).join(', ') : '') + '\n\nCan’t make it any more? Tell me in Dayli.'
          : 'Can you make ' + line + '? Say yes, maybe or no in the Dayli app.';
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
      }
      function saveScore() {
        var us = $('#tm-us').value;
        var them = $('#tm-them').value;
        var button = this;
        setBusy(button, true);
        rpc('team_set_score', {
          p_event: f.event_id,
          p_us: us === '' ? null : Number(us),
          p_them: them === '' ? null : Number(them),
        }).then(
          function () {
            toast('Score saved');
            screenFixture(cal, f.event_id);
          },
          function (err) {
            setBusy(button, false);
            toast(friendly(err));
          },
        );
      }
      function del() {
        if (!confirm('Delete ' + fixtureName(f) + '? It comes off everyone’s calendar.')) return;
        rpc('team_delete_fixture', { p_event: f.event_id }).then(
          function () {
            toast('Deleted');
            go(teamUrl(cal, 'fixtures'));
          },
          function (err) {
            toast(friendly(err));
          },
        );
      }

      draw();
    }
    // "Midfielder" → "MID" for the narrow pick-the-team columns.
    function posShort(pos) {
      var known = { goalkeeper: 'GK', defender: 'DEF', midfielder: 'MID', forward: 'FWD' };
      var k = String(pos || '').toLowerCase();
      return known[k] || (pos.length > 4 ? pos.slice(0, 3).toUpperCase() : pos);
    }
    function shortName(name) {
      var w = String(name || '').split(/\s+/).filter(Boolean);
      return w.length > 1 ? w[0] + ' ' + w[w.length - 1].charAt(0) + '.' : w[0] || '';
    }

    // --- adding a fixture -----------------------------------------------------

    function screenNew(cal) {
      loading();
      rpc('team_overview', { p_calendar: cal }).then(
        function (t) {
          drawNew(t);
        },
        function (err) {
          render(notice('error', esc(friendly(err))));
        },
      );
    }
    function drawNew(t) {
      var cal = t.calendar_id;
      var today = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      render(
        '<a class="linkish" href="' +
          teamUrl(cal) +
          '">← ' +
          esc(t.name) +
          '</a><h1 style="margin:8px 0 14px">Add to the calendar</h1>' +
          '<div class="card tm-form"><div class="seg" id="tm-kind">' +
          ['match', 'training', 'social']
            .map(function (k, i) {
              return '<button type="button" data-k="' + k + '" class="' + (i === 0 ? 'on' : '') + '">' + KIND[k] + '</button>';
            })
            .join('') +
          '</div>' +
          '<div class="tm-grid"><label data-only="match">Opponent<input type="text" id="f-opp" placeholder="Clapton Rovers" maxlength="80" /></label>' +
          '<label data-only="match">Home or away<select id="f-home"><option value="1">Home</option><option value="0">Away</option></select></label>' +
          '<label data-only="match">Competition<select id="f-comp"><option value="league">League</option><option value="cup">Cup</option><option value="friendly">Friendly</option></select></label>' +
          '<label data-only="training social">Title<input type="text" id="f-title" placeholder="" maxlength="80" /></label>' +
          '<label>Date<input type="date" id="f-date" value="' +
          today +
          '" /></label><label>Start<input type="time" id="f-time" value="10:30" /></label>' +
          '<label>How long (minutes)<input type="number" id="f-min" value="90" min="15" max="600" /></label>' +
          '<label data-only="match training">Meet before (minutes)<input type="number" id="f-meet" value="30" min="0" max="180" /></label>' +
          '<label class="wide">Where<input type="text" id="f-loc" placeholder="Pitch 4, Hackney Marshes" maxlength="200" /></label>' +
          '<label data-only="match training">Kit<input type="text" id="f-kit" placeholder="Home kit" maxlength="80" /></label>' +
          '<label data-only="training">Repeat<select id="f-every"><option value="0">Just once</option><option value="1">Every week</option><option value="2">Every other week</option></select></label>' +
          '<label data-only="training">Until<input type="date" id="f-until" /></label>' +
          '<label class="wide">Notes for the squad<textarea id="f-notes" rows="2" maxlength="1000"></textarea></label></div>' +
          '<label class="tm-check"><input type="checkbox" id="f-ask" checked /> Ask the squad if they can come</label>' +
          '<label class="tm-check" data-only="social"><input type="checkbox" id="f-plus" /> They can bring guests</label>' +
          '<div class="notice error" id="f-err" hidden></div>' +
          '<div class="row" style="margin-top:14px"><button class="btn primary" id="f-save">Add it</button><a class="btn" href="' +
          teamUrl(cal) +
          '">Cancel</a></div></div>',
      );
      var kind = 'match';
      function show() {
        $$('[data-only]').forEach(function (el) {
          el.hidden = el.dataset.only.split(' ').indexOf(kind) < 0;
        });
        $('#f-min').value = kind === 'social' ? 180 : kind === 'training' ? 60 : 90;
        $('#f-title').placeholder = kind === 'social' ? 'End of season do' : 'Training';
      }
      $$('#tm-kind button').forEach(function (b) {
        b.onclick = function () {
          kind = b.dataset.k;
          $$('#tm-kind button').forEach(function (x) {
            x.classList.toggle('on', x === b);
          });
          show();
        };
      });
      show();
      $('#f-save').onclick = function () {
        var err = $('#f-err');
        err.hidden = true;
        var date = $('#f-date').value;
        var tm = $('#f-time').value;
        if (!date || !tm) {
          err.hidden = false;
          err.textContent = 'Pick the date and start time.';
          return;
        }
        if (kind === 'match' && !$('#f-opp').value.trim()) {
          err.hidden = false;
          err.textContent = 'Who are you playing?';
          return;
        }
        var every = kind === 'training' ? Number($('#f-every').value) : 0;
        if (every && !$('#f-until').value) {
          err.hidden = false;
          err.textContent = 'Repeating training needs an end date.';
          return;
        }
        var button = this;
        setBusy(button, true);
        rpc('team_add_entry', {
          p_calendar: cal,
          p_kind: kind,
          p_starts_at: new Date(date + 'T' + tm).toISOString(),
          p_minutes: Number($('#f-min').value) || 90,
          p_title: kind === 'match' ? null : $('#f-title').value.trim() || null,
          p_opponent: kind === 'match' ? $('#f-opp').value.trim() : null,
          p_home: kind === 'match' ? $('#f-home').value === '1' : true,
          p_competition: kind === 'match' ? $('#f-comp').value : 'league',
          p_meet_minutes: kind === 'social' ? 0 : Number($('#f-meet').value) || 0,
          p_location: $('#f-loc').value.trim() || null,
          p_kit: kind === 'social' ? null : $('#f-kit').value.trim() || null,
          p_notes: $('#f-notes').value.trim() || null,
          p_ask: $('#f-ask').checked,
          p_plus_ones: kind === 'social' && $('#f-plus').checked,
          p_every_weeks: every,
          p_until: every ? $('#f-until').value : null,
        }).then(
          function () {
            toast('Added. It’s in everyone’s calendar.');
            go(teamUrl(cal));
          },
          function (e) {
            setBusy(button, false);
            err.hidden = false;
            err.textContent = friendly(e);
          },
        );
      };
    }

    // --- squad tab -----------------------------------------------------------------

    function drawSquad(d) {
      var t = d.team;
      var rows = (t.players || [])
        .map(function (p) {
          return (
            '<tr><td><span class="tm-av">' +
            esc(initials(p.name)) +
            '</span> <b>' +
            esc(p.name) +
            '</b>' +
            (p.is_me ? ' <span class="muted small">you</span>' : '') +
            (p.user_id ? '' : ' <span class="pill">not on Dayli yet</span>') +
            '</td><td>' +
            (p.role === 'manager' ? 'Manager' + (p.plays ? ' · plays' : '') : 'Player') +
            '</td><td class="nowrap">' +
            (p.is_me
              ? ''
              : '<button class="linkish" data-role="' +
                esc(p.id) +
                '" data-to="' +
                (p.role === 'manager' ? 'player' : 'manager') +
                '">' +
                (p.role === 'manager' ? 'Make a player' : 'Make a manager') +
                '</button> · <button class="linkish danger" data-remove="' +
                esc(p.id) +
                '" data-name="' +
                esc(p.name) +
                '">Remove</button>') +
            '</td></tr>'
          );
        })
        .join('');
      return (
        '<div class="card"><div class="row between"><div><h3>Squad</h3><p class="sub">Players join with the invite link (they get the fixtures in Dayli). Add someone by name if they’re not on Dayli.</p></div></div>' +
        '<div class="row" style="margin-bottom:12px"><input type="text" id="tm-new-name" placeholder="Name" maxlength="60" style="max-width:260px" /><button class="btn" id="tm-add">Add player</button></div>' +
        '<div class="scroll-x"><table class="tm-table"><tr><th>Name</th><th>Role</th><th></th></tr>' +
        rows +
        '</table></div></div>'
      );
    }

    // --- squad: a searchable list beside the chosen player's profile ------------

    var FOOTBALL_POS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];

    function duesFor(pay, playerId) {
      var out = [];
      ((pay && pay.charges) || []).forEach(function (c) {
        (c.dues || []).forEach(function (u) {
          if (u.player_id === playerId) out.push({ charge: c, due: u });
        });
      });
      return out;
    }
    function owedBy(pay, playerId) {
      return duesFor(pay, playerId).reduce(function (sum, x) {
        return sum + (x.due.status === 'owed' ? x.due.price_pence || x.charge.amount_pence : 0);
      }, 0);
    }

    function drawSquadPage(d, query) {
      var t = d.team;
      var cal = t.calendar_id;
      var players = t.players || [];
      var stats = {};
      (d.stats || []).forEach(function (s) {
        stats[s.player_id] = s;
      });
      var chosen =
        players.filter(function (p) {
          return p.id === query.p;
        })[0] || players[0];
      var filter = '';
      var onDayli = players.filter(function (p) {
        return p.user_id;
      }).length;

      function listRow(p) {
        var owes = owedBy(d.pay, p.id);
        return (
          '<a class="tq-li' +
          (chosen && p.id === chosen.id ? ' on' : '') +
          '" href="' +
          teamUrl(cal, 'squad') +
          '?p=' +
          esc(p.id) +
          '" data-name="' +
          esc(p.name.toLowerCase()) +
          '">' +
          avatar(p, 32) +
          '<span class="grow"><b>' +
          esc(p.name) +
          (p.is_me ? ' <span class="muted small">(you)</span>' : '') +
          '</b><small class="muted">' +
          esc(
            [p.position, p.role === 'manager' ? 'Manager' + (p.plays ? ', plays' : '') : 'Player', p.user_id ? null : 'not on Dayli yet']
              .filter(Boolean)
              .join(' · '),
          ) +
          '</small></span>' +
          (owes ? '<span class="tq-owes">' + pounds(owes) + '</span>' : '') +
          '</a>'
        );
      }

      function profile(p) {
        if (!p) return '<div class="card tq-prof"><p class="muted">Add your first player.</p></div>';
        var st = stats[p.id] || { played: 0, asked: 0, answered: 0, last: [] };
        var replies = st.asked ? Math.round((st.answered / st.asked) * 100) + '%' : '—';
        var owes = owedBy(d.pay, p.id);
        var last = (st.last || [])
          .map(function (m) {
            var cls = m.slot === 'start' ? 'st' : m.slot === 'sub' ? 'sb' : m.status === 'cant' ? 'no' : m.status === 'maybe' ? 'my' : m.status === 'available' ? 'out' : 'nr';
            var label = { st: 'Started', sb: 'Sub', no: 'Couldn’t play', my: 'Maybe', out: 'Free, not picked', nr: 'No answer' }[cls];
            return (
              '<div title="' +
              esc(label + ': ' + (m.home ? 'v ' : '@ ') + (m.opponent || 'TBC')) +
              '"><i class="' +
              cls +
              '"></i>' +
              esc(new Date(m.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) +
              '</div>'
            );
          })
          .join('');
        var football = f_isFootball(t);
        var posField = football
          ? '<select id="tq-pos"><option value="">Not set</option>' +
            FOOTBALL_POS.concat(p.position && FOOTBALL_POS.indexOf(p.position) < 0 ? [p.position] : [])
              .map(function (x) {
                return '<option' + (x === p.position ? ' selected' : '') + '>' + esc(x) + '</option>';
              })
              .join('') +
            '</select>'
          : '<input type="text" id="tq-pos" maxlength="30" placeholder="Like Wing attack" value="' + esc(p.position || '') + '" />';
        var roleField = p.user_id
          ? '<select id="tq-role"' +
            (p.is_me ? ' disabled' : '') +
            '><option value="player"' +
            (p.role === 'player' ? ' selected' : '') +
            '>Player</option><option value="manager"' +
            (p.role === 'manager' ? ' selected' : '') +
            '>Manager</option></select><small class="muted">' +
            (p.is_me ? 'That’s you.' : 'Managers can pick the team, nudge, and ask for money.') +
            '</small>'
          : '<div class="muted small">Only people on Dayli can be managers.</div>';
        var dues = duesFor(d.pay, p.id);
        var pay = d.pay
          ? dues.length
            ? dues
                .slice(0, 6)
                .map(function (x) {
                  var u = x.due;
                  var chip =
                    u.status === 'owed'
                      ? '<span class="chip c-o">OWES ' + pounds(u.price_pence || x.charge.amount_pence) + '</span>'
                      : u.status === 'paid'
                        ? '<span class="chip c-g">PAID · CARD</span>'
                        : u.status === 'cash'
                          ? '<span class="chip c-g">PAID · CASH</span>'
                          : '<span class="chip c-n">LET OFF</span>';
                  return '<div class="tq-pr"><span class="grow">' + esc(x.charge.title) + '</span>' + chip + '</div>';
                })
                .join('')
            : '<div class="muted small">Nothing asked of them yet.</div>'
          : '<div class="muted small">Payments aren’t on for this team.</div>';
        return (
          '<div class="card tq-prof"><div class="tq-ph">' +
          avatar(p, 68) +
          '<div class="grow"><h2>' +
          esc(p.name) +
          '</h2><div class="muted">' +
          esc([p.position, p.role === 'manager' ? 'Manager' : 'Player', p.user_id ? 'on Dayli' : 'not on Dayli yet'].filter(Boolean).join(' · ')) +
          '</div></div>' +
          (p.user_id ? '' : '<button class="btn" data-copy-invite>Copy invite link</button>') +
          '</div><div class="tq-kv"><div><b>' +
          st.played +
          '</b><small>PLAYED</small></div><div><b>' +
          replies +
          '</b><small>REPLIES</small></div><div><b>' +
          st.answered +
          '<span class="muted"> / ' +
          st.asked +
          '</span></b><small>ANSWERED</small></div><div><b class="' +
          (owes ? 'o' : 'g') +
          '">' +
          pounds(owes) +
          '</b><small>OWES</small></div></div>' +
          (last
            ? '<div class="lbl">LAST ' +
              (st.last || []).length +
              ' MATCHES</div><div class="tq-hist">' +
              last +
              '</div><div class="tq-key"><span><i class="st"></i>Started</span><span><i class="sb"></i>Sub</span><span><i class="out"></i>Free, not picked</span><span><i class="no"></i>Couldn’t play</span><span><i class="nr"></i>No answer</span></div>'
            : '<p class="muted small">Their record shows here after a match or two.</p>') +
          '<div class="tq-f2"><div><div class="lbl">ROLE</div>' +
          roleField +
          '<div class="lbl" style="margin-top:14px">POSITION</div>' +
          posField +
          '</div><div><div class="lbl">PAYMENTS</div>' +
          pay +
          '</div></div>' +
          (p.is_me
            ? ''
            : '<div class="tq-foot"><span class="muted small grow">Removing someone takes them out of the squad. Their own calendar isn’t touched.</span><button class="act tq-del" id="tq-remove">Remove from squad</button></div>') +
          '</div>'
        );
      }

      render(
        '<div class="th-head"><div><h1>Squad</h1><div class="muted">' +
          players.length +
          (players.length === 1 ? ' person' : ' people') +
          ' · ' +
          onDayli +
          ' on Dayli</div></div><div class="row"><button class="btn" data-copy-invite>Copy invite link</button><button class="btn primary" id="tq-add-open">+ Add player</button></div></div>' +
          '<div class="tq-grid"><div class="card tq-list"><div class="tq-add" id="tq-add" hidden><input type="text" id="tq-new" placeholder="Their name" maxlength="60" /><button class="btn primary" id="tq-add-go">Add</button></div><input type="search" id="tq-search" placeholder="Search the squad" />' +
          '<div id="tq-rows">' +
          players.map(listRow).join('') +
          '</div><p class="muted small tq-tip">People join with the invite link and get fixtures in Dayli. Add someone by name if they’re not on Dayli; they can be linked when they join.</p></div>' +
          profile(chosen) +
          '</div>',
      );

      $('#tq-search').oninput = function () {
        filter = this.value.trim().toLowerCase();
        $$('.tq-li').forEach(function (a) {
          a.hidden = filter && a.dataset.name.indexOf(filter) < 0;
        });
      };
      $$('[data-copy-invite]').forEach(function (b) {
        b.onclick = function () {
          if (!d.code) return toast('No invite link for this team yet.');
          copy(SITE + '/join/' + d.code, 'Invite link copied. Send it to your players.');
        };
      });
      $('#tq-add-open').onclick = function () {
        $('#tq-add').hidden = false;
        $('#tq-new').focus();
      };
      function add() {
        var name = $('#tq-new').value.trim();
        if (!name) return;
        var button = $('#tq-add-go');
        setBusy(button, true);
        rpc('team_add_player', { p_calendar: cal, p_name: name }).then(
          function (id) {
            toast(name + ' added');
            go(teamUrl(cal, 'squad') + '?p=' + id);
          },
          function (err) {
            setBusy(button, false);
            toast(friendly(err));
          },
        );
      }
      $('#tq-add-go').onclick = add;
      $('#tq-new').onkeydown = function (e) {
        if (e.key === 'Enter') add();
      };
      if (!chosen) return;
      // On a phone the profile is under the list: show it when a player was chosen.
      if (query.p && window.innerWidth <= 1000) $('.tq-prof').scrollIntoView();
      function again() {
        screenTeam(cal, 'squad', { p: chosen.id });
      }
      if ($('#tq-role'))
        $('#tq-role').onchange = function () {
          rpc('team_set_role', { p_player: chosen.id, p_role: this.value }).then(
            function () {
              toast('Saved');
              again();
            },
            function (err) {
              toast(friendly(err));
              again();
            },
          );
        };
      $('#tq-pos').onchange = function () {
        rpc('team_set_position', { p_player: chosen.id, p_position: this.value }).then(
          function () {
            toast('Position saved');
            again();
          },
          function (err) {
            toast(friendly(err));
          },
        );
      };
      if ($('#tq-remove'))
        $('#tq-remove').onclick = function () {
          if (!confirm('Take ' + chosen.name + ' out of the squad?')) return;
          rpc('team_remove_player', { p_player: chosen.id }).then(
            function () {
              toast(chosen.name + ' removed');
              go(teamUrl(cal, 'squad'));
            },
            function (err) {
              toast(friendly(err));
            },
          );
        };
    }
    function f_isFootball(t) {
      return (t.sport || 'football') === 'football';
    }

    // --- payments: a tab per team, players owing first, each player's detail ------

    function drawPaymentsPage(d, query) {
      var t = d.team;
      var cal = t.calendar_id;
      var p = d.pay;
      var view = query.view === 'charges' ? 'charges' : 'players';
      var tabs =
        (d.myTeams || []).length > 1
          ? '<div class="tm-ptabs">' +
            d.myTeams
              .map(function (x) {
                return (
                  '<a class="' +
                  (x.calendar_id === cal ? 'on' : '') +
                  '" href="' +
                  teamUrl(x.calendar_id, 'payments') +
                  '">' +
                  esc(x.name) +
                  (x.owed_pence ? ' <span class="tq-owes">' + pounds(x.owed_pence) + ' OWED</span>' : x.owed_pence === 0 ? ' <span class="tm-paidup">ALL PAID</span>' : '') +
                  '</a>'
                );
              })
              .join('') +
            '</div>'
          : '';
      var head =
        '<div class="th-head"><div><h1>Payments</h1><div class="muted">Paid by card to your Stripe account · Apple Pay and Google Pay</div></div>' +
        (p && p.payout && p.payout.ready
          ? '<div class="row">' +
            (view === 'players' ? '<button class="btn" id="tm-csv">Export</button>' : '') +
            '<a class="btn primary" href="' +
            teamUrl(cal, 'payments') +
            '?view=charges&ask=1">+ Ask for money</a></div>'
          : '') +
        '</div>' +
        tabs;
      if (!p || !p.payout || !p.payout.ready) {
        render(head + drawPayments(d));
        wire(d, 'payments');
        return;
      }

      // Who owes what, from every charge's dues.
      var per = {};
      (t.players || []).forEach(function (pl) {
        per[pl.id] = { p: pl, owed: 0, items: [], lastPaid: null };
      });
      (p.charges || []).forEach(function (c) {
        (c.dues || []).forEach(function (u) {
          var x = per[u.player_id];
          if (!x) return;
          if (u.status === 'owed') {
            x.owed += u.price_pence;
            x.items.push(c.title);
          } else if (u.paid_at && (!x.lastPaid || u.paid_at > x.lastPaid)) x.lastPaid = u.paid_at;
        });
      });
      var rows = Object.keys(per)
        .map(function (k) {
          return per[k];
        })
        .sort(function (a, b) {
          return b.owed - a.owed || a.p.name.localeCompare(b.p.name);
        });
      var owing = rows.filter(function (r) {
        return r.owed;
      });
      var totals = p.totals || { collected_pence: 0, owed_pence: 0 };
      var summary =
        '<div class="tm-psum"><div><b class="g">' +
        pounds(totals.collected_pence) +
        '</b>collected</div><div><b class="o">' +
        pounds(totals.owed_pence) +
        '</b>owed by ' +
        owing.length +
        (owing.length === 1 ? ' person' : ' people') +
        '</div><div><b>' +
        (rows.length - owing.length) +
        '</b>paid up</div>' +
        '<span class="tf-seg tm-pview"><a class="' +
        (view === 'players' ? 'on' : '') +
        '" href="' +
        teamUrl(cal, 'payments') +
        '">Players</a><a class="' +
        (view === 'charges' ? 'on' : '') +
        '" href="' +
        teamUrl(cal, 'payments') +
        '?view=charges">Charges</a></span>' +
        (owing.length ? '<button class="act tp-nudge" id="tm-nudge-all">Nudge all ' + owing.length + '</button>' : '') +
        '</div>';

      if (view === 'charges') {
        render(head + summary + drawPayments(d));
        wire(d, 'payments');
        wireNudgeAll();
        if (query.ask && $('#c-title')) {
          $('#c-title').scrollIntoView({ block: 'center' });
          $('#c-title').focus();
        }
        return;
      }

      var chosen = per[query.p] || owing[0] || rows[0];
      var filter = query.f === 'owes' || query.f === 'paid' ? query.f : 'all';
      var shown = rows.filter(function (r) {
        return filter === 'all' || (filter === 'owes' ? r.owed : !r.owed);
      });
      function fHref(f) {
        return teamUrl(cal, 'payments') + (f === 'all' ? '' : '?f=' + f);
      }
      var list =
        '<div class="card tq-list"><div class="tm-pfl"><a class="' +
        (filter === 'all' ? 'on' : '') +
        '" href="' +
        fHref('all') +
        '">Everyone · ' +
        rows.length +
        '</a><a class="' +
        (filter === 'owes' ? 'on' : '') +
        '" href="' +
        fHref('owes') +
        '">Owes · ' +
        owing.length +
        '</a><a class="' +
        (filter === 'paid' ? 'on' : '') +
        '" href="' +
        fHref('paid') +
        '">Paid up · ' +
        (rows.length - owing.length) +
        '</a></div>' +
        shown
          .map(function (r) {
            return (
              '<a class="tq-li' +
              (chosen && r.p.id === chosen.p.id ? ' on' : '') +
              '" href="' +
              teamUrl(cal, 'payments') +
              '?p=' +
              esc(r.p.id) +
              (filter === 'all' ? '' : '&f=' + filter) +
              '">' +
              avatar(r.p, 32) +
              '<span class="grow"><b>' +
              esc(r.p.name) +
              '</b><small class="muted">' +
              esc(
                r.owed
                  ? r.items.slice(0, 2).join(' · ') + (r.items.length > 2 ? ' +' + (r.items.length - 2) : '')
                  : r.lastPaid
                    ? 'Last paid ' + new Date(r.lastPaid).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                    : 'Nothing asked yet',
              ) +
              '</small></span>' +
              (r.owed ? '<span class="tq-owes">OWES ' + pounds(r.owed) + '</span>' : '<span class="tm-ok">✓ Paid up</span>') +
              '</a>'
            );
          })
          .join('') +
        (shown.length ? '' : '<p class="muted small">Nobody here.</p>') +
        '</div>';

      render(
        head +
          summary +
          '<div class="tq-grid">' +
          list +
          '<div class="card tq-prof" id="tm-pdetail"><p class="muted">Loading…</p></div></div>',
      );
      wireNudgeAll();
      // The spreadsheet export lives with the charges.
      $('#tm-csv').onclick = function () {
        go(teamUrl(cal, 'payments') + '?view=charges');
      };
      if (chosen) loadDetail(chosen);

      function loadDetail(r) {
        rpc('team_player_dues', { p_player: r.p.id }).then(
          function (x) {
            drawDetail(r, x || { dues: [] });
          },
          function (err) {
            $('#tm-pdetail').innerHTML = notice('error', esc(friendly(err)));
          },
        );
      }
      function kindWord(k) {
        return { asked: 'Asked to pay', reminder: 'Reminder to everyone owing', nudge: 'Nudged by a manager', auto: 'Automatic nudge' }[k] || 'Reminder';
      }
      function drawDetail(r, x) {
        var pl = r.p;
        var dues = x.dues || [];
        var owed = dues.filter(function (u) {
          return u.status === 'owed';
        });
        var done = dues.filter(function (u) {
          return u.status !== 'owed';
        });
        var nudges = [];
        dues.forEach(function (u) {
          (u.nudges || []).forEach(function (n) {
            nudges.push({ at: n.sent_at, kind: n.kind, seen: n.seen, title: u.title });
          });
        });
        nudges.sort(function (a, b) {
          return a.at < b.at ? 1 : -1;
        });
        function late(u) {
          if (!u.due_on) return 'asked ' + new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          var days = Math.floor((Date.now() - new Date(u.due_on)) / 86400000);
          return (
            'due ' +
            new Date(u.due_on).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
            (days > 0 ? ' · ' + days + (days === 1 ? ' day' : ' days') + ' late' : '')
          );
        }
        $('#tm-pdetail').innerHTML =
          '<div class="tq-ph">' +
          avatar(pl, 60) +
          '<div class="grow"><h2>' +
          esc(pl.name) +
          '</h2><div class="muted">' +
          esc([pl.position, pl.role === 'manager' ? 'Manager' : 'Player', pl.user_id ? 'on Dayli' : 'not on Dayli yet'].filter(Boolean).join(' · ')) +
          '</div></div><div class="tm-big"><small>OWES</small><b class="' +
          (r.owed ? 'o' : 'g') +
          '">' +
          pounds(r.owed) +
          '</b></div></div>' +
          '<div class="row tm-pacts">' +
          (r.owed && pl.user_id
            ? '<button class="btn primary" id="tm-pnudge">Nudge ' + esc(pl.name.split(' ')[0]) + ' for ' + pounds(r.owed) + '</button>'
            : r.owed
              ? '<span class="muted small">Not on Dayli yet, so they can’t be nudged or pay by card. Mark cash when they pay.</span>'
              : '') +
          '<label class="tm-auto"><span>Auto-nudge everyone who owes every 3 days</span><input type="checkbox" id="tm-auto"' +
          (x.auto_nudge ? ' checked' : '') +
          ' /></label></div>' +
          '<div class="lbl">WHAT’S OWED</div>' +
          (owed.length
            ? owed
                .map(function (u) {
                  return (
                    '<div class="tm-owe"><div class="grow"><b>' +
                    esc(u.title) +
                    '</b><small class="muted">' +
                    esc(pounds(u.price_pence) + ' · ' + late(u)) +
                    '</small></div><b class="tm-amt">' +
                    pounds(u.price_pence) +
                    '</b>' +
                    (pl.user_id ? '<button class="act tp-nudge" data-nudge="' + esc(u.id) + '">Nudge</button>' : '') +
                    '<button class="act" data-due="' +
                    esc(u.id) +
                    '" data-to="cash">Paid cash</button><button class="act" data-due="' +
                    esc(u.id) +
                    '" data-to="waived">Let off</button></div>'
                  );
                })
                .join('')
            : '<p class="muted small">Nothing owed. All paid up.</p>') +
          '<div class="tq-f2"><div><div class="lbl">NUDGES</div>' +
          (nudges.length
            ? nudges
                .slice(0, 8)
                .map(function (n) {
                  return (
                    '<div class="tm-nl"><i></i><span class="grow">' +
                    esc(
                      new Date(n.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
                        ' · ' +
                        kindWord(n.kind) +
                        ' · ' +
                        n.title,
                    ) +
                    '</span><span class="muted small">' +
                    (n.seen ? 'Seen' : 'Not opened') +
                    '</span></div>'
                  );
                })
                .join('')
            : '<p class="muted small">No reminders sent yet.</p>') +
          '</div><div><div class="lbl">PAID</div>' +
          (done.length
            ? done
                .slice(0, 8)
                .map(function (u) {
                  var chip =
                    u.status === 'paid'
                      ? '<span class="chip c-g">CARD</span>'
                      : u.status === 'cash'
                        ? '<span class="chip c-g">CASH</span>'
                        : '<span class="chip c-n">LET OFF</span>';
                  return (
                    '<div class="tq-pr"><span class="grow"><b class="small">' +
                    esc(u.title) +
                    '</b><small class="muted" style="display:block">' +
                    (u.paid_at ? esc(new Date(u.paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) : '') +
                    '</small></span>' +
                    chip +
                    '<b class="small">' +
                    pounds(u.price_pence) +
                    '</b>' +
                    (u.status === 'cash' || u.status === 'waived'
                      ? '<button class="linkish small" data-due="' + esc(u.id) + '" data-to="owed">Undo</button>'
                      : '') +
                    '</div>'
                  );
                })
                .join('')
            : '<p class="muted small">Nothing paid yet.</p>') +
          '</div></div>';

        function again() {
          screenTeam(cal, 'payments', { p: pl.id, f: filter === 'all' ? undefined : filter });
        }
        function nudge(due, button) {
          setBusy(button, true);
          rpc('team_player_nudge', { p_player: pl.id, p_due: due || null }).then(
            function (n) {
              toast('Nudged ' + pl.name.split(' ')[0] + (n > 1 ? ' about ' + n + ' things' : '') + '. They get a notification with a pay button.');
              loadDetail(r);
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
        }
        if ($('#tm-pnudge'))
          $('#tm-pnudge').onclick = function () {
            nudge(null, this);
          };
        $$('[data-nudge]').forEach(function (b) {
          b.onclick = function () {
            nudge(b.dataset.nudge, b);
          };
        });
        $$('#tm-pdetail [data-due]').forEach(function (b) {
          b.onclick = function () {
            setBusy(b, true);
            rpc('team_due_mark', { p_due: b.dataset.due, p_status: b.dataset.to }).then(
              function () {
                toast(b.dataset.to === 'cash' ? 'Marked as paid in cash' : b.dataset.to === 'waived' ? 'Let off' : 'Back to owed');
                again();
              },
              function (err) {
                setBusy(b, false);
                toast(friendly(err));
              },
            );
          };
        });
        $('#tm-auto').onchange = function () {
          var on = this.checked;
          rpc('team_set_auto_nudge', { p_calendar: cal, p_on: on }).then(
            function () {
              toast(on ? 'Everyone who owes gets a nudge every 3 days until they pay.' : 'Auto-nudge is off.');
            },
            function (err) {
              toast(friendly(err));
            },
          );
        };
      }

      function wireNudgeAll() {
        if (!$('#tm-nudge-all')) return;
        $('#tm-nudge-all').onclick = function () {
          var button = this;
          var open = (p.charges || []).filter(function (c) {
            return (
              !c.closed &&
              (c.dues || []).some(function (u) {
                return u.status === 'owed';
              })
            );
          });
          setBusy(button, true);
          Promise.all(
            open.map(function (c) {
              return rpc('team_charge_remind', { p_charge: c.id });
            }),
          ).then(
            function (ns) {
              var n = ns.reduce(function (a, b) {
                return a + (b || 0);
              }, 0);
              setBusy(button, false);
              toast(n ? 'Sent ' + n + ' reminders.' : 'Everyone who owes was reminded in the last 12 hours.');
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
        };
      }
    }

    // --- payments tab ------------------------------------------------------------

    function drawPayments(d) {
      var p = d.pay;
      if (!p)
        return notice(
          'info',
          'Team payments aren’t switched on for your account yet. When they are, you can collect subs and match fees here.',
        );
      if (!p.payout || !p.payout.ready) {
        return (
          '<div class="card"><h3>Collect subs and match fees</h3><p class="sub">Players pay by card, Apple Pay or Google Pay, straight into the club’s own Stripe account. Setting up takes about five minutes.</p>' +
          (p.payout && p.payout.set && !p.payout.ready
            ? notice('info', 'Stripe is still checking your details.') +
              '<div class="row"><button class="btn primary" id="tm-connect">Carry on with Stripe</button><button class="btn" id="tm-check">Check again</button></div>'
            : '<button class="btn primary" id="tm-connect">Set up payments</button>') +
          '</div>'
        );
      }
      var charges = (p.charges || [])
        .map(function (c) {
          var paid = c.dues.filter(function (u) {
            return u.status === 'paid' || u.status === 'cash';
          }).length;
          return (
            '<div class="card tm-charge"><div class="row between"><div><h3>' +
            esc(c.title) +
            (c.closed ? ' <span class="pill">closed</span>' : '') +
            '</h3><p class="sub">' +
            esc(c.kind === 'subs' ? 'Subs' + (c.monthly ? ' · monthly' : '') : c.kind === 'match' ? 'Match fee' : 'One-off') +
            ' · ' +
            pounds(c.amount_pence) +
            ' each · ' +
            paid +
            ' of ' +
            c.dues.length +
            ' paid' +
            (c.due_on ? ' · due ' + esc(new Date(c.due_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) : '') +
            '</p></div><div class="row">' +
            (c.closed
              ? ''
              : '<button class="btn small" data-remind="' +
                esc(c.id) +
                '">Remind</button><button class="btn small" data-close="' +
                esc(c.id) +
                '">Close</button>') +
            '</div></div><div class="scroll-x"><table class="tm-table"><tr><th>Player</th><th>Amount</th><th>Status</th><th></th></tr>' +
            c.dues
              .map(function (u) {
                var st =
                  u.status === 'paid'
                    ? '<span class="tm-tag paid">PAID</span>'
                    : u.status === 'cash'
                      ? '<span class="tm-tag paid">CASH</span>'
                      : u.status === 'waived'
                        ? '<span class="tm-tag">LET OFF</span>'
                        : '<span class="tm-tag owed">OWED</span>';
                return (
                  '<tr><td>' +
                  esc(u.name) +
                  '</td><td>' +
                  pounds(u.price_pence) +
                  '</td><td>' +
                  st +
                  '</td><td class="nowrap">' +
                  (u.status === 'owed'
                    ? '<button class="linkish" data-due="' +
                      esc(u.id) +
                      '" data-to="cash">Paid in cash</button> · <button class="linkish" data-due="' +
                      esc(u.id) +
                      '" data-to="waived">Let off</button>'
                    : u.status === 'cash' || u.status === 'waived'
                      ? '<button class="linkish" data-due="' + esc(u.id) + '" data-to="owed">Undo</button>'
                      : '') +
                  '</td></tr>'
                );
              })
              .join('') +
            '</table></div></div>'
          );
        })
        .join('');
      var matches = (d.team.fixtures || []).filter(function (f) {
        return f.kind === 'match';
      });
      return (
        '<div class="card"><div class="row between"><div><h3>Ask for money</h3><p class="sub">Everyone in the squad gets it in the Dayli app with a Pay button.</p></div><button class="btn" id="tm-csv">Export to Excel</button></div>' +
        '<div class="tm-grid"><label>What for<select id="c-kind"><option value="subs">Subs</option><option value="match">Match fee</option><option value="one_off">One-off (kit, tournament…)</option></select></label>' +
        '<label>Title<input type="text" id="c-title" placeholder="November subs" maxlength="80" /></label>' +
        '<label>Amount each (£)<input id="c-amount" type="number" min="1" step="0.5" placeholder="25" /></label>' +
        '<label data-c="match">Which match<select id="c-event">' +
        matches
          .map(function (f) {
            return '<option value="' + esc(f.event_id) + '">' + esc(day(f.starts_at, f.timezone) + ' ' + fixtureName(f)) + '</option>';
          })
          .join('') +
        '</select></label><label data-c="subs one_off">Due by<input id="c-due" type="date" /></label></div>' +
        '<label class="tm-check" data-c="subs"><input type="checkbox" id="c-monthly" /> Ask again every month</label>' +
        '<label class="tm-check"><input type="checkbox" id="c-fee" checked /> Players cover the card fee (the club gets the full amount)</label>' +
        '<div class="notice error" id="c-err" hidden></div><button class="btn primary" id="c-save" style="margin-top:10px">Ask the squad</button></div>' +
        (charges || '<p class="muted">Nothing asked for yet.</p>') +
        '<p class="muted small">Card payments are refunded from the club’s Stripe dashboard. <a href="#" id="tm-stripe">Open Stripe</a></p>'
      );
    }

    // --- wiring ------------------------------------------------------------------------

    function wire(d, tab) {
      var cal = d.team.calendar_id;
      $$('tr.tm-row').forEach(function (tr) {
        tr.onclick = function () {
          go(tr.dataset.href);
        };
      });
      if (tab === 'squad') {
        $('#tm-add').onclick = function () {
          var name = $('#tm-new-name').value.trim();
          if (!name) return;
          var button = this;
          setBusy(button, true);
          rpc('team_add_player', { p_calendar: cal, p_name: name }).then(
            function () {
              toast(name + ' added');
              screenTeam(cal, 'squad');
            },
            function (err) {
              setBusy(button, false);
              toast(friendly(err));
            },
          );
        };
        $$('[data-role]').forEach(function (b) {
          b.onclick = function () {
            rpc('team_set_role', { p_player: b.dataset.role, p_role: b.dataset.to }).then(
              function () {
                screenTeam(cal, 'squad');
              },
              function (err) {
                toast(friendly(err));
              },
            );
          };
        });
        $$('[data-remove]').forEach(function (b) {
          b.onclick = function () {
            if (!confirm('Remove ' + b.dataset.name + ' from the squad? Anything they owe is cancelled; what they paid stays on the record.')) return;
            rpc('team_remove_player', { p_player: b.dataset.remove }).then(
              function () {
                toast('Removed');
                screenTeam(cal, 'squad');
              },
              function (err) {
                toast(friendly(err));
              },
            );
          };
        });
      }
      if (tab === 'payments') {
        var connect = $('#tm-connect');
        if (connect)
          connect.onclick = function () {
            setBusy(connect, true);
            invoke('team-pay', { action: 'connect', calendar_id: cal, back: 'hq' }).then(
              function (r) {
                if (r && r.url) location.href = r.url;
              },
              function (err) {
                setBusy(connect, false);
                toast(friendly(err));
              },
            );
          };
        var check = $('#tm-check');
        if (check)
          check.onclick = function () {
            setBusy(check, true);
            invoke('team-pay', { action: 'status', calendar_id: cal }).then(
              function (r) {
                toast(r && r.ready ? 'Payments are on' : 'Stripe is still checking. Try again later.');
                screenTeam(cal, 'payments', { view: 'charges' });
              },
              function (err) {
                setBusy(check, false);
                toast(friendly(err));
              },
            );
          };
        if (!$('#c-kind')) return;
        function showKind() {
          var k = $('#c-kind').value;
          $$('[data-c]').forEach(function (el) {
            el.hidden = el.dataset.c.split(' ').indexOf(k) < 0;
          });
          $('#c-title').placeholder =
            k === 'match'
              ? 'Match fee'
              : k === 'subs'
                ? new Date().toLocaleDateString('en-GB', { month: 'long' }) + ' subs'
                : 'Tournament entry';
        }
        $('#c-kind').onchange = showKind;
        showKind();
        $('#c-save').onclick = function () {
          var err = $('#c-err');
          err.hidden = true;
          var k = $('#c-kind').value;
          var amount = Math.round(Number($('#c-amount').value) * 100);
          if (!amount || amount < 100) {
            err.hidden = false;
            err.textContent = 'Put in an amount of at least £1.';
            return;
          }
          if (k === 'match' && !$('#c-event').value) {
            err.hidden = false;
            err.textContent = 'Add the match first, then ask for the fee.';
            return;
          }
          var button = this;
          setBusy(button, true);
          rpc('team_charge_create', {
            p_calendar: cal,
            p_kind: k,
            p_title: $('#c-title').value.trim() || $('#c-title').placeholder,
            p_amount_pence: amount,
            p_member_pays_fee: $('#c-fee').checked,
            p_event: k === 'match' ? $('#c-event').value : null,
            p_due_on: k === 'match' ? null : $('#c-due').value || null,
            p_monthly: k === 'subs' && $('#c-monthly').checked,
          }).then(
            function () {
              toast('Asked. The squad can pay in the app.');
              screenTeam(cal, 'payments', { view: 'charges' });
            },
            function (e) {
              setBusy(button, false);
              err.hidden = false;
              err.textContent = friendly(e);
            },
          );
        };
        $$('[data-due]').forEach(function (b) {
          b.onclick = function () {
            rpc('team_due_mark', { p_due: b.dataset.due, p_status: b.dataset.to }).then(
              function () {
                screenTeam(cal, 'payments', { view: 'charges' });
              },
              function (err) {
                toast(friendly(err));
              },
            );
          };
        });
        $$('[data-remind]').forEach(function (b) {
          b.onclick = function () {
            rpc('team_charge_remind', { p_charge: b.dataset.remind }).then(
              function (n) {
                toast(n ? 'Reminded ' + n : 'Reminder sent');
              },
              function (err) {
                toast(friendly(err));
              },
            );
          };
        });
        $$('[data-close]').forEach(function (b) {
          b.onclick = function () {
            if (!confirm('Close this? Nobody else can pay it; what’s been paid stays.')) return;
            rpc('team_charge_close', { p_charge: b.dataset.close }).then(
              function () {
                screenTeam(cal, 'payments', { view: 'charges' });
              },
              function (err) {
                toast(friendly(err));
              },
            );
          };
        });
        $('#tm-stripe').onclick = function (e) {
          e.preventDefault();
          window.open('https://dashboard.stripe.com/', '_blank', 'noopener');
        };
        $('#tm-csv').onclick = function () {
          var lines = [['Charge', 'Kind', 'Player', 'Amount (£)', 'Status', 'Paid at']];
          (d.pay.charges || []).forEach(function (c) {
            c.dues.forEach(function (u) {
              lines.push([
                c.title,
                c.kind,
                u.name,
                (u.price_pence / 100).toFixed(2),
                u.status,
                u.paid_at ? new Date(u.paid_at).toLocaleString('en-GB') : '',
              ]);
            });
          });
          var csv = lines
            .map(function (r) {
              return r
                .map(function (v) {
                  var s = String(v == null ? '' : v);
                  // Spreadsheet formula injection: text starting =+-@ stays text.
                  if (/^[=+\-@]/.test(s)) s = "'" + s;
                  return '"' + s.replace(/"/g, '""') + '"';
                })
                .join(',');
            })
            .join('\r\n');
          var a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
          a.download = d.team.name.replace(/[^\w ]+/g, '').trim() + ' payments.csv';
          a.click();
        };
      }
    }

    // --- routes -----------------------------------------------------------------------

    function screen(parts, query) {
      var cal = parts[1];
      if (!cal) return screenList();
      if (parts[2] === 'new') return screenNew(cal);
      if (parts[2] === 'fixture' && parts[3]) return screenFixture(cal, parts[3]);
      return screenTeam(cal, parts[2], query);
    }

    return { screen: screen };
  };
})();
