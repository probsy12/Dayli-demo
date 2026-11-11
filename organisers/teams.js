/* Dayli HQ: Teams. The squads someone manages, run from a laptop: fixtures
 * and results, who's available, picking the team, the squad, and money
 * (subs, match fees, one-offs). Everything goes through the same RPCs as the
 * app (supabase/migrations/*team*), so a change here shows in the app at once
 * and the other way round. Only shown at /hq/ (window.DayliTeams in app.js).
 *   #/teams                         the teams I'm in
 *   #/teams/<calendar>[/<tab>]      fixtures | squad | payments
 *   #/teams/<calendar>/new          add a fixture, training or social
 *   #/teams/<calendar>/fixture/<id> who's coming, picking the team, the score
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
        rpc('team_results', { p_calendar: cal, p_limit: 20 }).catch(function () {
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
            drawTeam(d, tab || 'fixtures');
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
          '<nav class="tm-tabs">' +
          ['fixtures', 'squad', 'payments']
            .map(function (k) {
              return (
                '<a href="' +
                teamUrl(cal, k) +
                '" class="' +
                (k === tab ? 'on' : '') +
                '">' +
                k.charAt(0).toUpperCase() +
                k.slice(1) +
                '</a>'
              );
            })
            .join('') +
          '</nav><div class="tm-tiles">' +
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

    // --- fixtures tab ---------------------------------------------------------

    function drawFixtures(d, next) {
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
        '</div><div class="card"><h3>Results</h3><p class="sub">Past matches and sessions. Add the score to a match and followers see it.</p>' +
        (past
          ? '<div class="scroll-x"><table class="tm-table"><tr><th>Date</th><th>What</th><th></th><th>Result</th><th>Played</th></tr>' +
            past +
            '</table></div>'
          : '<p class="muted">No results yet.</p>') +
        '</div>'
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
    function drawFixture(cal, f) {
      var past = new Date(f.ends_at) < new Date();
      var players = (f.players || []).filter(function (p) {
        return p.role !== 'manager' || p.plays;
      });
      var groups = { available: [], maybe: [], cant: [], none: [] };
      players.forEach(function (p) {
        groups[p.status || 'none'].push(p);
      });
      var picking = f.kind === 'match';
      function pr(p) {
        return (
          '<tr><td><span class="tm-av">' +
          esc(initials(p.name)) +
          '</span> ' +
          esc(p.name) +
          (p.position ? ' <span class="muted small">' + esc(p.position) + '</span>' : '') +
          '</td><td><select data-avail="' +
          esc(p.id) +
          '"><option value="">No answer</option>' +
          ['available', 'maybe', 'cant']
            .map(function (s) {
              return '<option value="' + s + '"' + (p.status === s ? ' selected' : '') + '>' + STATUS[s] + '</option>';
            })
            .join('') +
          '</select></td>' +
          (picking
            ? '<td><select data-slot="' +
              esc(p.id) +
              '"><option value="">Not picked</option><option value="start"' +
              (p.slot === 'start' ? ' selected' : '') +
              '>Starting</option><option value="sub"' +
              (p.slot === 'sub' ? ' selected' : '') +
              '>Sub</option></select></td>'
            : '') +
          '</tr>'
        );
      }
      var order = groups.available.concat(groups.maybe, groups.none, groups.cant);
      render(
        '<a class="linkish" href="' +
          teamUrl(cal) +
          '">← ' +
          esc(f.team_name) +
          '</a><div class="page-head" style="margin-top:8px"><div><h1>' +
          esc(fixtureName(f)) +
          ' ' +
          result(f) +
          '</h1><p class="muted">' +
          esc(
            [
              KIND[f.kind],
              day(f.starts_at, f.timezone) + ' ' + time(f.starts_at, f.timezone),
              f.meet_at ? 'meet ' + time(f.meet_at, f.timezone) : null,
              f.location,
              f.kit ? 'Kit: ' + f.kit : null,
            ]
              .filter(Boolean)
              .join(' · '),
          ) +
          '</p></div><div class="controls"><button class="btn" id="tm-del">Delete</button></div></div>' +
          (past && f.kind === 'match'
            ? '<div class="card"><h3>Score</h3><div class="row"><label>' +
              esc(f.team_name) +
              ' <input type="number" min="0" max="99" id="tm-us" value="' +
              (f.score_us == null ? '' : f.score_us) +
              '" class="tm-score" /></label><label>' +
              esc(f.opponent || 'Them') +
              ' <input type="number" min="0" max="99" id="tm-them" value="' +
              (f.score_them == null ? '' : f.score_them) +
              '" class="tm-score" /></label><button class="btn primary" id="tm-save-score">Save score</button></div></div>'
            : '') +
          '<div class="card"><h3>' +
          (picking ? 'Who’s available and the team' : 'Who’s coming') +
          '</h3><p class="sub">' +
          countsText(f.counts) +
          (picking
            ? '. Pick who starts and who’s on the bench; send it and everyone gets the team on their phone.'
            : '. You can answer for someone who told you in person.') +
          '</p>' +
          countsBar(f.counts, players.length) +
          '<div class="scroll-x"><table class="tm-table"><tr><th>Player</th><th>Can play?</th>' +
          (picking ? '<th>Team</th>' : '') +
          '</tr>' +
          order.map(pr).join('') +
          '</table></div>' +
          (picking
            ? '<div class="row" style="margin-top:12px"><button class="btn" id="tm-save-team">Save, don’t send</button><button class="btn primary" id="tm-send-team">' +
              (f.sheet_sent ? 'Send the changes' : 'Send the team') +
              '</button><span class="muted small" id="tm-count"></span></div>'
            : '') +
          '</div>',
      );
      $$('select[data-avail]').forEach(function (sel) {
        sel.onchange = function () {
          rpc('team_set_availability', {
            p_event: f.event_id,
            p_status: sel.value || null,
            p_player: sel.dataset.avail,
            p_guests: null,
          }).then(
            function () {
              toast('Saved');
            },
            function (err) {
              toast(friendly(err));
            },
          );
        };
      });
      function selection() {
        var s = {};
        $$('select[data-slot]').forEach(function (sel) {
          if (sel.value) s[sel.dataset.slot] = sel.value;
        });
        return s;
      }
      function countPicked() {
        var s = selection();
        var starts = Object.keys(s).filter(function (k) {
          return s[k] === 'start';
        }).length;
        var c = $('#tm-count');
        if (c) c.textContent = starts + ' starting · ' + (Object.keys(s).length - starts) + ' on the bench';
      }
      $$('select[data-slot]').forEach(function (sel) {
        sel.onchange = countPicked;
      });
      countPicked();
      function saveTeam(send, button) {
        setBusy(button, true);
        rpc('team_set_selection', {
          p_event: f.event_id,
          p_selection: selection(),
          p_send: send,
          p_positions: null,
          p_formation: f.formation || null,
        }).then(
          function () {
            toast(send ? 'Team sent to the squad' : 'Saved');
            screenFixture(cal, f.event_id);
          },
          function (err) {
            setBusy(button, false);
            toast(friendly(err));
          },
        );
      }
      if ($('#tm-save-team')) $('#tm-save-team').onclick = function () {
        saveTeam(false, this);
      };
      if ($('#tm-send-team')) $('#tm-send-team').onclick = function () {
        saveTeam(true, this);
      };
      if ($('#tm-save-score'))
        $('#tm-save-score').onclick = function () {
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
        };
      $('#tm-del').onclick = function () {
        if (!confirm('Delete ' + fixtureName(f) + '? It comes off everyone’s calendar.')) return;
        rpc('team_delete_fixture', { p_event: f.event_id }).then(
          function () {
            toast('Deleted');
            go(teamUrl(cal));
          },
          function (err) {
            toast(friendly(err));
          },
        );
      };
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
                screenTeam(cal, 'payments');
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
              screenTeam(cal, 'payments');
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
                screenTeam(cal, 'payments');
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
                screenTeam(cal, 'payments');
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
