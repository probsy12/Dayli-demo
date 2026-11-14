/* The usual positions and stats for each sport, for Dayli HQ's team set-up,
 * squad and Stats pages. A team adds its own on top (teams.positions and
 * teams.stat_names, supabase/migrations/20261114000400_team_positions_stats.sql). */
(function () {
  'use strict';
  window.DayliSportLists = {
    positions: {
      football: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'],
      netball: ['Goal shooter', 'Goal attack', 'Wing attack', 'Centre', 'Wing defence', 'Goal defence', 'Goalkeeper'],
      rugby: ['Prop', 'Hooker', 'Lock', 'Flanker', 'Number 8', 'Scrum-half', 'Fly-half', 'Centre', 'Wing', 'Full-back'],
      cricket: ['Batter', 'Bowler', 'All-rounder', 'Wicketkeeper'],
      hockey: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'],
      basketball: ['Point guard', 'Shooting guard', 'Small forward', 'Power forward', 'Centre'],
      volleyball: ['Setter', 'Outside hitter', 'Opposite', 'Middle blocker', 'Libero'],
      other: [],
    },
    stats: {
      football: ['Goals', 'Assists', 'Clean sheets', 'Yellow cards', 'Red cards', 'Player of the match'],
      netball: ['Goals', 'Goal attempts', 'Intercepts', 'Rebounds', 'Player of the match'],
      rugby: ['Tries', 'Conversions', 'Penalties', 'Tackles', 'Player of the match'],
      cricket: ['Runs', 'Wickets', 'Catches', 'Player of the match'],
      hockey: ['Goals', 'Assists', 'Green cards', 'Yellow cards', 'Player of the match'],
      basketball: ['Points', 'Rebounds', 'Assists', 'Steals', 'Blocks'],
      volleyball: ['Kills', 'Aces', 'Blocks', 'Digs'],
      other: ['Points', 'Player of the match'],
    },
    // A sport's list plus the team's own, without repeats (case aside).
    merge: function (base, own) {
      var out = [];
      var seen = {};
      (base || []).concat(own || []).forEach(function (x) {
        var k = String(x || '').toLowerCase();
        if (!k || seen[k]) return;
        seen[k] = true;
        out.push(x);
      });
      return out;
    },
  };
})();
