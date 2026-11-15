/*
 * A team's public page as a profile (design A): the cover across the top, the
 * badge overlapping it, an intro saying what the page is, then the timeline of
 * results, new fixtures and photos. Used by the public page (/t/?s=…) and by
 * Dayli HQ, where a manager edits it in place (edit: true adds the buttons;
 * HQ wires what they do through the data-pf-edit / data-pf-del attributes).
 *
 *   DayliProfile.html(team, { base, edit, hq })  the page, as HTML
 *   DayliProfile.wire(root)                      tabs and sharing
 */
(function () {
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ICON = {
    cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    shirt: '<path d="M9 3l3 2 3-2 5 3-2 4-2-1v12H8V9l-2 1-2-4z"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6 6 0 0 1 3.5 5.5"/>',
    share: '<path d="M12 15V4M8 8l4-4 4 4M5 13v7h14v-7"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    bin: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  };
  function icon(n) {
    return (
      '<svg class="pf-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICON[n] +
      '</svg>'
    );
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(n) {
    var w = String(n || '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : (w[0] || '')[1] || '')).toUpperCase();
  }
  function colour(c) {
    return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#6e56cf';
  }
  // A colour for the other team, from its name.
  function oppColour(name) {
    var cols = ['#B4432F', '#3A61C9', '#D9741C', '#2F6B4F', '#7A3B22', '#2B5A8A', '#8a5a2b', '#5b5b66'];
    var h = 0;
    String(name || '').split('').forEach(function (ch) {
      h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    });
    return cols[h % cols.length];
  }
  function parts(iso, tz) {
    var d = new Date(iso);
    try {
      var f = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/London', weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
      var o = {};
      f.formatToParts(d).forEach(function (p) {
        o[p.type] = p.value;
      });
      return { wd: o.weekday, day: o.day, mon: o.month, time: o.hour + ':' + o.minute };
    } catch (e) {
      return { wd: '', day: d.getDate(), mon: MON[d.getMonth()], time: d.toTimeString().slice(0, 5) };
    }
  }
  function when(iso, tz) {
    var p = parts(iso, tz);
    return p.wd + ' ' + p.day + ' ' + p.mon;
  }
  function wdl(m) {
    return m.score_us > m.score_them ? 'W' : m.score_us < m.score_them ? 'L' : 'D';
  }
  function scoreLine(t, m) {
    // Home team first, as on a results page.
    return m.home ? [t.name, m.score_us + '–' + m.score_them, m.opponent] : [m.opponent, m.score_them + '–' + m.score_us, t.name];
  }
  function sportLine(t) {
    var s = t.sport ? t.sport.charAt(0).toUpperCase() + t.sport.slice(1).replace(/_/g, ' ') : '';
    var f = /^\d+$/.test(t.format || '') ? t.format + '-a-side' : t.format || '';
    return [s, f, t.area].filter(Boolean).join(' · ');
  }

  function crest(t, o, cls) {
    return (
      '<div class="pf-crest ' + (cls || '') + '">' +
      (t.badge ? '<img src="' + esc(o.base + t.badge) + '" alt="" />' : '<span>' + esc(initials(t.name)) + '</span>') +
      '</div>'
    );
  }
  function editBtn(what, label, cls) {
    return '<button type="button" class="pf-ed ' + (cls || '') + '" data-pf-edit="' + what + '">' + icon(what === 'cover' || what === 'badge' ? 'cam' : what === 'photos' ? 'plus' : 'pen') + '<span>' + esc(label) + '</span></button>';
  }

  function intro(t, o, full) {
    var details = [
      t.ground ? [icon('pin'), 'Plays at <b>' + esc(t.ground) + '</b>'] : null,
      t.league ? [icon('trophy'), '<b>' + esc(t.league) + '</b>'] : null,
      t.training ? [icon('cal'), 'Trains <b>' + esc(t.training) + '</b>'] : null,
      t.kit ? [icon('shirt'), esc(t.kit)] : null,
      t.founded ? [icon('star'), 'Founded in <b>' + esc(t.founded) + '</b>'] : null,
      [icon('users'), '<b>' + (t.followers || 0) + (t.followers === 1 ? ' follower' : ' followers') + '</b>'],
    ].filter(Boolean);
    var links = (t.links || []).filter(function (l) {
      return l && /^https:\/\//i.test(l.url || '');
    });
    return (
      '<div class="pf-box pf-intro"><div class="pf-bh"><h3>Intro</h3>' +
      (o.edit ? editBtn('intro', 'Edit', 'pf-ed-s') : '') +
      '</div><div class="pf-what"><b>What is this page?</b>' +
      esc(t.name) +
      (/s$/i.test(t.name || '') ? '’' : '’s') +
      ' page on Dayli. The team’s managers keep the fixtures, results and photos up to date. Follow them in Dayli to get kick-off times and scores in your own calendar.</div>' +
      (t.about
        ? '<div class="pf-about">' + esc(t.about) + '</div>'
        : o.edit
          ? '<button type="button" class="pf-empty" data-pf-edit="intro">Add a few lines about the team: who you are, how long you’ve played, whether you’re looking for players.</button>'
          : '') +
      '<div class="pf-det">' +
      details
        .map(function (d) {
          return '<div>' + d[0] + '<span>' + d[1] + '</span></div>';
        })
        .join('') +
      '</div>' +
      (o.edit ? editBtn('details', 'Edit details', 'pf-ed-w') : '') +
      (links.length
        ? '<div class="pf-links">' +
          links
            .map(function (l) {
              return '<a href="' + esc(l.url) + '" rel="noopener nofollow" target="_blank">' + icon('link') + esc(l.label || l.url.replace(/^https:\/\/(www\.)?/i, '').split('/')[0]) + '</a>';
            })
            .join('') +
          '</div>'
        : '') +
      (full && t.record && t.record.played
        ? '<div class="pf-rec"><div><b>' + t.record.played + '</b><small>Played</small></div><div><b>' + t.record.won + '</b><small>Won</small></div><div><b>' + t.record.drawn + '</b><small>Drawn</small></div><div><b>' + t.record.lost + '</b><small>Lost</small></div></div>'
        : '') +
      '</div>'
    );
  }

  function photoTile(p, o) {
    return (
      '<div class="pf-ph"><a href="' + esc(o.base + p.path) + '" target="_blank" rel="noopener"><img src="' + esc(o.base + p.path) + '" alt="" loading="lazy" /></a>' +
      (o.edit ? '<button type="button" class="pf-del" data-pf-del="' + esc(p.id) + '" aria-label="Take this photo off">' + icon('bin') + '</button>' : '') +
      '</div>'
    );
  }
  function photosBox(t, o) {
    var ph = t.photos || [];
    if (!ph.length && !o.edit) return '';
    return (
      '<div class="pf-box"><div class="pf-bh"><h3>Photos</h3>' +
      (o.edit ? editBtn('photos', 'Add', 'pf-ed-s') : ph.length > 6 ? '<a href="#" data-pf-tab="photos" class="pf-more">See all</a>' : '') +
      '</div>' +
      (ph.length
        ? '<div class="pf-grid3">' +
          ph
            .slice(0, 6)
            .map(function (p) {
              return photoTile(p, o);
            })
            .join('') +
          '</div>'
        : '<button type="button" class="pf-empty" data-pf-edit="photos">Add photos from matches, training and socials. They’re public, so only add ones everyone in them is happy with.</button>') +
      '</div>'
    );
  }

  function nextCard(t, o) {
    var n = (t.matches || [])[0];
    if (!n) return '';
    var p = parts(n.starts_at, n.timezone);
    var us = crest(t, o, 'pf-c34');
    var them = '<span class="pf-opp" style="background:' + oppColour(n.opponent) + '">' + esc(initials(n.opponent)) + '</span>';
    return (
      '<div class="pf-next"><span class="pf-k">Next match · ' +
      esc(p.wd + ' ' + p.day + ' ' + p.mon) +
      '</span><div class="pf-vs">' +
      (n.home ? us + '<b>' + esc(t.name) + '</b><i>v</i>' + them + '<b>' + esc(n.opponent) + '</b>' : them + '<b>' + esc(n.opponent) + '</b><i>v</i>' + us + '<b>' + esc(t.name) + '</b>') +
      '</div><small>' +
      esc([p.time + ' kick-off', n.home ? 'Home' : 'Away', n.competition && n.competition !== 'league' ? n.competition.charAt(0).toUpperCase() + n.competition.slice(1) : null, n.location].filter(Boolean).join(' · ')) +
      '</small></div>'
    );
  }

  // The timeline: results, new fixtures and photos, newest first.
  function posts(t, o) {
    var items = [];
    (t.results || []).forEach(function (m) {
      var s = scoreLine(t, m);
      items.push({
        at: m.starts_at,
        html:
          '<div class="pf-post">' + head(t, o, 'posted a result', when(m.starts_at, m.timezone) + (m.competition && m.competition !== 'league' ? ' · ' + m.competition.charAt(0).toUpperCase() + m.competition.slice(1) : '')) +
          '<div class="pf-score"><span>' + esc(s[0]) + '</span><b>' + esc(s[1]) + '</b><span>' + esc(s[2]) + '</span></div><div class="pf-res pf-' + wdl(m) + '">' +
          { W: 'Won', D: 'Drew', L: 'Lost' }[wdl(m)] + '</div></div>',
      });
    });
    (t.matches || []).forEach(function (m) {
      if (!m.added_at) return;
      var p = parts(m.starts_at, m.timezone);
      items.push({
        at: m.added_at,
        html:
          '<div class="pf-post">' + head(t, o, 'added a fixture', when(m.added_at)) +
          '<div class="pf-fx"><div class="pf-date"><small>' + esc(p.mon.toUpperCase()) + '</small><b>' + esc(p.day) + '</b></div><div><b>v ' + esc(m.opponent) + '</b><span>' +
          esc([p.wd + ' ' + p.time, m.home ? 'Home' : 'Away', m.location].filter(Boolean).join(' · ')) + '</span></div></div></div>',
      });
    });
    // Photos added the same day go together.
    var days = {};
    (t.photos || []).forEach(function (p) {
      var k = String(p.created_at).slice(0, 10);
      (days[k] = days[k] || []).push(p);
    });
    Object.keys(days).forEach(function (k) {
      var ph = days[k];
      items.push({
        at: ph[0].created_at,
        html:
          '<div class="pf-post">' + head(t, o, 'added ' + (ph.length === 1 ? 'a photo' : ph.length + ' photos'), when(ph[0].created_at)) +
          '<div class="pf-strip pf-n' + Math.min(ph.length, 4) + '">' + ph.slice(0, 4).map(function (p) { return photoTile(p, { base: o.base }); }).join('') + '</div></div>',
      });
    });
    items.sort(function (a, b) {
      return new Date(b.at) - new Date(a.at);
    });
    if (!items.length)
      return '<div class="pf-box pf-quiet">' + (o.edit ? 'Results, new fixtures and photos show here as you add them in Dayli.' : 'Nothing posted yet. Results and new fixtures show here as the season goes.') + '</div>';
    return items
      .slice(0, 14)
      .map(function (x) {
        return x.html;
      })
      .join('');
  }
  function head(t, o, what, sub) {
    return '<div class="pf-ph-h">' + crest(t, o, 'pf-c34') + '<div><b>' + esc(t.name) + '</b> ' + esc(what) + '<small>' + esc(sub) + '</small></div></div>';
  }

  function fixturesTab(t, o) {
    var coming = (t.matches || [])
      .map(function (m) {
        var p = parts(m.starts_at, m.timezone);
        return '<div class="pf-row"><div class="pf-date"><small>' + esc(p.mon.toUpperCase()) + '</small><b>' + esc(p.day) + '</b></div><div class="pf-g"><b>v ' + esc(m.opponent) + '</b><span>' +
          esc([p.wd + ' ' + p.time, m.home ? 'Home' : 'Away', m.location].filter(Boolean).join(' · ')) + '</span></div></div>';
      })
      .join('');
    var res = (t.results || [])
      .map(function (m) {
        var p = parts(m.starts_at, m.timezone);
        return '<div class="pf-row"><span class="pf-wl pf-' + wdl(m) + '">' + wdl(m) + '</span><div class="pf-g"><b>v ' + esc(m.opponent) + '</b><span>' + esc(p.day + ' ' + p.mon + ' · ' + (m.home ? 'Home' : 'Away')) +
          '</span></div><b class="pf-sc">' + esc(m.score_us + '–' + m.score_them) + '</b></div>';
      })
      .join('');
    return (
      '<div class="pf-two"><div class="pf-box"><div class="pf-bh"><h3>Coming up</h3></div>' + (coming || '<p class="pf-quiet">No matches in the diary yet.</p>') +
      '</div><div class="pf-box"><div class="pf-bh"><h3>Results</h3></div>' + (res || '<p class="pf-quiet">No results yet.</p>') + '</div></div>'
    );
  }

  function getDayli(t) {
    return (
      '<div class="pf-box pf-get" id="pf-get"><b>Never miss a match</b><span>Get Dayli and follow ' + esc(t.name) +
      ': fixtures in your calendar, scores as they come in. In the app, search for “' + esc(t.name) + '” and tap Follow.</span><div class="pf-stores">' +
      '<a href="https://apps.apple.com/gb/app/dayli/id6767814466" rel="noopener"><small>Download for</small>iPhone</a>' +
      '<a href="https://play.google.com/store/apps/details?id=uk.co.dayli.app" rel="noopener"><small>Get it for</small>Android</a></div></div>'
    );
  }

  function html(t, o) {
    o = o || {};
    var col = colour(t.color);
    var tabs = [['timeline', 'Timeline'], ['about', 'About'], ['fixtures', 'Fixtures'], ['photos', 'Photos']].filter(function (x) {
      return x[0] !== 'photos' || (t.photos || []).length || o.edit;
    });
    return (
      '<div class="pf' + (o.edit ? ' pf-editing' : '') + '" style="--pf-team:' + col + '">' +
      '<div class="pf-cover' + (t.cover ? ' pf-has' : '') + '"' + (t.cover ? ' style="background-image:url(\'' + esc(o.base + t.cover) + '\')"' : '') + '>' +
      (t.cover ? '' : '<i class="pf-l"></i><i class="pf-c"></i><i class="pf-b1"></i><i class="pf-b2"></i>') +
      (o.edit ? '<div class="pf-cover-ed">' + editBtn('cover', t.cover ? 'Change cover' : 'Add a cover photo') + (t.cover ? '<button type="button" class="pf-ed" data-pf-edit="cover-off">' + icon('bin') + '<span>Remove</span></button>' : '') + '</div>' : '') +
      '</div>' +
      '<div class="pf-head"><div class="pf-badge">' + crest(t, o, 'pf-big') + (o.edit ? '<button type="button" class="pf-cam" data-pf-edit="badge" aria-label="Change the badge">' + icon('cam') + '</button>' : '') + '</div>' +
      '<div class="pf-name"><h1>' + esc(t.name) + '</h1><div class="pf-sub">' + esc(sportLine(t)) + '</div></div>' +
      (o.edit ? '' : '<div class="pf-acts"><a class="pf-btn pf-pri" href="#pf-get">' + icon('plus') + 'Follow</a><button type="button" class="pf-btn" data-pf-share>' + icon('share') + 'Share</button></div>') +
      '</div>' +
      '<nav class="pf-tabs">' + tabs.map(function (x, i) { return '<a href="#" data-pf-tab="' + x[0] + '" class="' + (i === 0 ? 'on' : '') + '">' + x[1] + '</a>'; }).join('') + '</nav>' +
      '<div class="pf-body">' +
      '<section data-pf-panel="timeline"><div class="pf-cols"><div class="pf-left">' + intro(t, o) + photosBox(t, o) + '</div><div class="pf-right">' + nextCard(t, o) + posts(t, o) + (o.edit ? '' : getDayli(t)) + '</div></div></section>' +
      '<section data-pf-panel="about" hidden><div class="pf-narrow">' + intro(t, o, true) + '</div></section>' +
      '<section data-pf-panel="fixtures" hidden>' + nextCard(t, o) + fixturesTab(t, o) + '</section>' +
      '<section data-pf-panel="photos" hidden><div class="pf-box">' + ((t.photos || []).length ? '<div class="pf-grid4">' + t.photos.map(function (p) { return photoTile(p, o); }).join('') + '</div>' : '<p class="pf-quiet">No photos yet.</p>') + (o.edit ? editBtn('photos', 'Add photos', 'pf-ed-w') : '') + '</div></section>' +
      '</div>' +
      (o.edit || !o.hq ? '' : '<p class="pf-foot">Run this team? <a href="' + esc(o.hq) + '">Edit this page in Dayli HQ</a></p>') +
      '</div>'
    );
  }

  function wire(root, opts) {
    opts = opts || {};
    function show(name) {
      root.querySelectorAll('[data-pf-panel]').forEach(function (s) {
        s.hidden = s.getAttribute('data-pf-panel') !== name;
      });
      root.querySelectorAll('.pf-tabs [data-pf-tab]').forEach(function (a) {
        a.classList.toggle('on', a.getAttribute('data-pf-tab') === name);
      });
      if (opts.onTab) opts.onTab(name);
    }
    root.querySelectorAll('[data-pf-tab]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        show(a.getAttribute('data-pf-tab'));
      });
    });
    if (opts.tab) show(opts.tab);
    var share = root.querySelector('[data-pf-share]');
    if (share)
      share.addEventListener('click', function () {
        var url = location.href.split('#')[0];
        if (navigator.share) {
          navigator.share({ title: document.title, url: url }).catch(function () {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            share.lastChild.textContent = 'Link copied';
          });
        }
      });
  }

  window.DayliProfile = { html: html, wire: wire };
})();
