/*
 * CZPvP Results — 共通処理
 *  - Mod が出力した CSV(新形式 v2 / 旧形式)の読み込み
 *  - 大会(複数の試合)の集計: チーム順位・個人順位
 *  - 公開ページとツールのプレビューで共通の描画
 */
(function () {
  'use strict';

  // Mod の TeamColors と同じ並び(チーム登録順に 青・赤・緑・琥珀)
  const PALETTE = ['#3d9be9', '#e5484d', '#4ade80', '#fbbf24'];
  const NEUTRAL = '#e6f1ff';

  const MODES = {
    ffa: { name: 'Free for All', unit: 'Score' },
    tdm: { name: 'Team Deathmatch', unit: 'Kill' },
    domination: { name: 'Domination', unit: 'pt' },
    freebattle: { name: 'Free Battle', unit: 'Kill' },
  };

  // ---------------------------------------------------------------- DOM

  /** h('div', {class: 'x', onclick: fn, style: {'--c': '#fff'}}, child, ...) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
        } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  function pad(n, len = 2) {
    return String(n).padStart(len, '0');
  }

  function fmtDate(iso, withTime = true) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const date = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
    return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
  }

  /** 'YYYY-MM-DD'(大会の開催日)をそのまま表示用に。 */
  function fmtDay(day) {
    if (!day) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
    return m ? `${m[1]}/${m[2]}/${m[3]}` : day;
  }

  /** 並べ替え用の時刻(ISO の時差表記が混ざっていても正しく比べられるように)。日時が無ければ最後。 */
  function dateValue(iso) {
    const t = iso ? Date.parse(iso) : NaN;
    return isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  }

  function fmtDuration(sec) {
    if (sec == null || sec === '' || isNaN(sec)) return '—';
    sec = Math.max(0, Math.round(Number(sec)));
    const hh = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    const ss = sec % 60;
    return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
  }

  function fmtNum(n) {
    return Math.round(Number(n) || 0).toLocaleString('ja-JP');
  }

  function kd(kills, deaths) {
    return deaths > 0 ? kills / deaths : kills;
  }

  function fmtKd(kills, deaths) {
    return kd(kills, deaths).toFixed(2);
  }

  function modeInfo(match) {
    const m = MODES[match.mode];
    return {
      name: match.modeName || (m ? m.name : (match.mode || (match.legacy ? '旧形式 CSV' : 'Unknown'))),
      unit: m ? m.unit : '',
    };
  }

  // ---------------------------------------------------------------- CSV

  /** RFC 4180 形式の CSV を行の配列にする。 */
  function parseCsvRows(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"' && field === '') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  /** ファイルを文字列にする。UTF-8 で読めなければ Shift_JIS(Excel で保存し直した CSV)として読む。 */
  async function readFileText(file) {
    const buf = await file.arrayBuffer();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      return new TextDecoder('shift_jis').decode(buf);
    }
  }

  function toInt(v) {
    const n = Number(String(v ?? '').trim());
    return Number.isFinite(n) ? n : 0;
  }

  /** ファイル名の yyyyMMdd_HHmmss から日時を取る。 */
  function dateFromFileName(name) {
    const m = /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/.exec(name || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return isNaN(d) ? null : d.toISOString();
  }

  let matchSeq = 0;

  function newMatchId() {
    matchSeq++;
    return 'm' + Date.now().toString(36) + matchSeq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /**
   * Mod の CSV を1試合のデータにする。
   * 新形式: 先頭に "#key,value" のメタデータ行、その後 Team,Player,Kill,Death,Damage,MIT,Score,UUID。
   * 旧形式: Team,Player,Kill,Death,Damage,MIT,Score のみ(日時・勝者などは無い)。
   */
  function parseMatchCsv(text, source = {}) {
    const rows = parseCsvRows(text);
    const meta = {};
    const teamValues = [];
    let header = null;
    const data = [];

    for (const r of rows) {
      const first = (r[0] || '').trim();
      if (!header && first.startsWith('#')) {
        const key = first.slice(1).trim();
        if (key === 'teamValue') {
          teamValues.push({ team: (r[1] || '').trim(), value: toInt(r[2]) });
        } else {
          meta[key] = r.slice(1).join(',').trim();
        }
        continue;
      }
      if (!header) {
        header = r.map((c) => c.trim().toLowerCase());
        continue;
      }
      data.push(r);
    }

    if (!header || !header.includes('player')) {
      throw new Error('ヘッダー行(Team,Player,Kill,…)が見つかりません。Mod が出力した CSV か確認してください。');
    }

    const col = (...names) => {
      for (const n of names) {
        const i = header.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    };
    const cTeam = col('team');
    const cPlayer = col('player', 'name');
    const cKill = col('kill', 'kills');
    const cDeath = col('death', 'deaths');
    const cDamage = col('damage');
    const cMit = col('mit', 'damagetaken');
    const cScore = col('score');
    const cUuid = col('uuid');
    const get = (r, i) => (i >= 0 && i < r.length ? r[i].trim() : '');

    const players = [];
    for (const r of data) {
      const name = get(r, cPlayer);
      if (!name) continue;
      const kill = toInt(get(r, cKill));
      const death = toInt(get(r, cDeath));
      players.push({
        team: get(r, cTeam),
        name,
        uuid: get(r, cUuid),
        kill,
        death,
        damage: toInt(get(r, cDamage)),
        mit: toInt(get(r, cMit)),
        score: cScore >= 0 && get(r, cScore) !== '' ? toInt(get(r, cScore)) : kill - death,
      });
    }

    const legacy = !('CZPvP Match Result' in meta);
    const date = meta.date || dateFromFileName(source.fileName)
      || (source.lastModified ? new Date(source.lastModified).toISOString() : null);
    const hasTeams = players.some((p) => p.team);

    const match = {
      id: newMatchId(),
      label: '',
      fileName: source.fileName || '',
      date,
      endDate: meta.endDate || null,
      durationSec: meta.durationSec ? toInt(meta.durationSec) : null,
      mode: (meta.mode || '').toLowerCase(),
      modeName: meta.modeName || '',
      spawnMode: (meta.spawnMode || (hasTeams ? 'TEAM' : 'RANDOM')).toUpperCase(),
      winner: meta.winner || '',
      draw: meta.draw === 'true',
      reason: meta.reason || '',
      teamValues,
      players,
      legacy,
    };

    if (legacy) {
      // 旧形式には勝者が無いので、キル数から仮の勝者を入れておく(ツールで変更できる)
      const guess = suggestWinner(match);
      match.winner = guess.winner;
      match.draw = guess.draw;
      match.winnerGuessed = true;
    }
    return match;
  }

  function isTeamMatch(match) {
    return match.spawnMode === 'TEAM' && match.players.some((p) => p.team);
  }

  /** キル数の合計が最も多いチーム(個人戦なら個人)を勝者とみなす。同点なら引き分け。 */
  function suggestWinner(match) {
    const totals = new Map();
    for (const p of match.players) {
      const key = isTeamMatch(match) ? p.team : p.name;
      if (!key) continue;
      const value = match.mode === 'ffa' ? p.score : p.kill;
      totals.set(key, (totals.get(key) || 0) + value);
    }
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return { winner: '', draw: true };
    if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return { winner: '', draw: true };
    return { winner: sorted[0][0], draw: false };
  }

  /** その試合の参加チーム名(登録順に近い並び: #teamValue → 行の順)。 */
  function teamsOf(match) {
    const seen = new Map();
    const add = (name) => {
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    };
    match.teamValues.forEach((tv) => add(tv.team));
    match.players.forEach((p) => add(p.team));
    return [...seen.values()];
  }

  const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

  // ---------------------------------------------------------------- 集計

  function emptyStats() {
    return { matches: 0, wins: 0, draws: 0, losses: 0, kills: 0, deaths: 0, damage: 0, mit: 0, score: 0 };
  }

  function addStats(target, p) {
    target.kills += p.kill;
    target.deaths += p.death;
    target.damage += p.damage;
    target.mit += p.mit;
    target.score += p.score;
  }

  function aggregate(tournament) {
    const matches = (tournament.matches || []).filter((m) => !m.excluded);
    const colors = new Map();
    const teams = new Map();
    const players = new Map();

    const teamOf = (name) => {
      const key = name.toLowerCase();
      if (!teams.has(key)) {
        if (!colors.has(key)) colors.set(key, PALETTE[colors.size % PALETTE.length]);
        teams.set(key, { name, color: colors.get(key), ...emptyStats(), members: new Map(), results: [] });
      }
      return teams.get(key);
    };

    // UUID の無い記録(旧形式の CSV)は、同じ名前の UUID 付きプレイヤーと同じ人として扱う
    const uuidByName = new Map();
    for (const m of matches) {
      for (const p of m.players) {
        if (p.uuid) uuidByName.set(p.name.toLowerCase(), p.uuid.toLowerCase());
      }
    }
    const playerKey = (p) => (p.uuid ? p.uuid.toLowerCase()
      : uuidByName.get(p.name.toLowerCase()) || 'name:' + p.name.toLowerCase());

    matches.forEach((m, index) => {
      const teamMatch = isTeamMatch(m);
      const teamKills = new Map();

      if (teamMatch) teamsOf(m).forEach((name) => teamOf(name));

      for (const p of m.players) {
        const key = playerKey(p);
        if (!players.has(key)) players.set(key, { key, name: p.name, team: '', ...emptyStats() });
        const pl = players.get(key);
        pl.name = p.name;
        if (p.team) pl.team = p.team;
        pl.matches++;
        addStats(pl, p);
        const won = !m.draw && (teamMatch ? same(p.team, m.winner) : same(p.name, m.winner));
        if (m.draw) pl.draws++;
        else if (won) pl.wins++;
        else pl.losses++;

        if (teamMatch && p.team) {
          const team = teamOf(p.team);
          addStats(team, p);
          teamKills.set(team, (teamKills.get(team) || 0) + p.kill);
          if (!team.members.has(key)) team.members.set(key, { key, name: p.name, ...emptyStats() });
          const member = team.members.get(key);
          member.name = p.name;
          member.matches++;
          addStats(member, p);
        }
      }

      if (teamMatch) {
        for (const name of teamsOf(m)) {
          const team = teamOf(name);
          team.matches++;
          const won = !m.draw && same(name, m.winner);
          if (m.draw) team.draws++;
          else if (won) team.wins++;
          else team.losses++;
          const tv = m.teamValues.find((v) => same(v.team, name));
          team.results.push({
            match: m,
            index,
            result: m.draw ? 'D' : won ? 'W' : 'L',
            value: tv ? tv.value : null,
            kills: teamKills.get(team) || 0,
          });
        }
      }
    });

    const teamList = [...teams.values()].sort((a, b) =>
      b.wins - a.wins || b.kills - a.kills || b.score - a.score || a.name.localeCompare(b.name));
    const playerList = [...players.values()].sort((a, b) =>
      b.kills - a.kills || b.score - a.score || a.deaths - b.deaths || a.name.localeCompare(b.name));

    let champion = null;
    if (teamList.length && teamList[0].matches > 0) {
      champion = { type: 'team', name: teamList[0].name, color: teamList[0].color };
    } else if (playerList.length) {
      const best = [...playerList].sort((a, b) => b.wins - a.wins || b.kills - a.kills)[0];
      champion = { type: 'player', name: best.name, color: NEUTRAL };
    }

    return {
      matches,
      teams: teamList,
      players: playerList,
      champion,
      colorOf: (name) => (name && colors.has(name.toLowerCase()) ? colors.get(name.toLowerCase()) : NEUTRAL),
      totals: {
        kills: playerList.reduce((s, p) => s + p.kills, 0),
        damage: playerList.reduce((s, p) => s + p.damage, 0),
      },
    };
  }

  /** index.json に載せる大会の要約。 */
  function summarize(tournament) {
    const agg = aggregate(tournament);
    return {
      id: tournament.id,
      name: tournament.name,
      date: tournament.date || '',
      description: tournament.description || '',
      matchCount: agg.matches.length,
      teamCount: agg.teams.length,
      playerCount: agg.players.length,
      champion: agg.champion,
    };
  }

  // ---------------------------------------------------------------- 描画パーツ

  function badge(n, cls = '') {
    return h('span', { class: 'badge ' + cls }, pad(n));
  }

  function rankCell(rank) {
    return h('td', null, h('span', { class: 'rank' + (rank <= 3 ? ' r' + rank : '') }, pad(rank)));
  }

  function swatchName(name, color) {
    return h('span', { class: 'name-cell' },
      h('span', { class: 'swatch', style: { '--c': color } }),
      h('span', { class: 'n', title: name }, name));
  }

  function teamChip(name, color) {
    if (!name) return h('span', { class: 'muted' }, '—');
    return h('span', { class: 'team-chip', style: { '--c': color } }, name);
  }

  function meter(value, max, color) {
    const p = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return h('span', { class: 'meter', style: { '--c': color || 'var(--cyan)' } },
      h('i', { style: { '--p': p + '%' } }));
  }

  function stat(k, v, cls = '') {
    return h('div', { class: 'stat ' + cls }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
  }

  function num(v, cls = '') {
    return h('td', { class: 'num ' + cls }, typeof v === 'number' ? fmtNum(v) : v);
  }

  function sectionTitle(n, title, sub) {
    return h('h2', { class: 'section-title' }, badge(n), title, sub ? h('span', { class: 'sub' }, sub) : null);
  }

  function emptyBox(icon, text) {
    return h('div', { class: 'empty' }, h('div', { class: 'icon' }, icon), h('div', null, text));
  }

  function matchTitle(match, index) {
    return match.label || `MATCH ${pad(index + 1)}`;
  }

  // ---------------------------------------------------------------- 大会の描画

  /**
   * 大会を描画する。
   * @param {HTMLElement} root
   * @param {object} tournament
   * @param {{useHash?: boolean}} options useHash: タブ・チーム詳細を URL の # に残す(公開ページ用)
   */
  function renderTournament(root, tournament, options = {}) {
    const agg = aggregate(tournament);
    const hasTeams = agg.teams.length > 0;
    const state = { tab: hasTeams ? 'teams' : 'players', team: null, sort: { key: 'kills', dir: -1 } };

    const readHash = () => {
      const hash = decodeURIComponent(location.hash.slice(1));
      state.team = null;
      if (hash.startsWith('team=') && hasTeams) {
        state.tab = 'teams';
        state.team = hash.slice(5);
      } else if (['teams', 'players', 'matches'].includes(hash) && (hash !== 'teams' || hasTeams)) {
        state.tab = hash;
      }
    };
    if (options.useHash) {
      readHash();
      // ブラウザの「戻る」やリンクで # だけが変わった時
      window.addEventListener('hashchange', () => {
        readHash();
        draw();
      });
    }

    /** @param push true ならブラウザの履歴に残す(チーム詳細から「戻る」で順位表に戻れるように) */
    const saveHash = (push = false) => {
      if (!options.useHash) return;
      const hash = '#' + (state.team ? 'team=' + encodeURIComponent(state.team) : state.tab);
      if (hash === location.hash) return;
      if (push) history.pushState(null, '', hash);
      else history.replaceState(null, '', hash);
    };

    const tabsDef = [
      hasTeams && { id: 'teams', label: 'TEAMS' },
      { id: 'players', label: 'PLAYERS' },
      { id: 'matches', label: 'MATCHES' },
    ].filter(Boolean);

    const summary = h('div', { class: 'panel' },
      sectionTitle(0, 'OVERVIEW'),
      h('div', { class: 'stats' },
        stat('Matches', fmtNum(agg.matches.length)),
        hasTeams ? stat('Teams', fmtNum(agg.teams.length)) : null,
        stat('Players', fmtNum(agg.players.length)),
        stat('Total Kills', fmtNum(agg.totals.kills)),
        stat(agg.champion && agg.champion.type === 'team' ? 'Champion Team' : 'Top Player',
          agg.champion ? agg.champion.name : '—', 'small'),
      ));

    const tabBar = h('div', { class: 'tabs mt', role: 'tablist' });
    const body = h('div');

    function draw() {
      tabBar.replaceChildren(...tabsDef.map((t, i) => h('button', {
        class: 'tab', role: 'tab', 'aria-selected': String(state.tab === t.id),
        onclick: () => {
          state.tab = t.id;
          state.team = null;
          saveHash();
          draw();
        },
      }, h('span', { class: 'num' }, pad(i + 1)), t.label)));

      let view;
      if (state.tab === 'teams' && state.team) {
        const team = agg.teams.find((t) => same(t.name, state.team));
        view = team ? teamDetail(team) : teamsView();
      } else if (state.tab === 'teams') view = teamsView();
      else if (state.tab === 'players') view = playersView();
      else view = matchesView();
      body.replaceChildren(view);
    }

    function openTeam(name) {
      state.tab = 'teams';
      state.team = name;
      saveHash(true);
      draw();
      tabBar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // ---- 01 TEAMS
    function teamsView() {
      const maxKills = Math.max(1, ...agg.teams.map((t) => t.kills));
      const rows = agg.teams.map((t, i) => h('tr', {
        class: 'clickable' + (i === 0 && t.wins > 0 ? ' win' : ''),
        tabindex: '0',
        onclick: () => openTeam(t.name),
        onkeydown: (e) => { if (e.key === 'Enter') openTeam(t.name); },
      },
      rankCell(i + 1),
      h('td', { class: 'l' }, swatchName(t.name, t.color)),
      num(t.wins, 'strong'),
      num(`${t.wins}-${t.draws}-${t.losses}`, 'muted'),
      h('td', { class: 'num' }, h('span', null, fmtNum(t.kills) + ' '), meter(t.kills, maxKills, t.color)),
      num(t.deaths),
      num(fmtKd(t.kills, t.deaths)),
      num(t.score),
      num(t.damage),
      num(t.mit)));

      return h('div', { class: 'panel' },
        sectionTitle(1, 'TEAM RANKING', '勝利数 → キル → スコア順 / クリックで詳細'),
        agg.teams.length ? h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null,
            h('th', null, '#'), h('th', { class: 'l' }, 'Team'), h('th', null, 'Wins'), h('th', null, 'W-D-L'),
            h('th', null, 'Kills'), h('th', null, 'Deaths'), h('th', null, 'K/D'), h('th', null, 'Score'),
            h('th', null, 'Damage'), h('th', null, 'MIT'))),
          h('tbody', null, rows))) : emptyBox('NO TEAMS', 'チーム戦の試合がありません。'));
    }

    function teamDetail(team) {
      const members = [...team.members.values()].sort((a, b) => b.kills - a.kills || b.score - a.score);
      const maxKills = Math.max(1, ...members.map((m) => m.kills));
      const rank = agg.teams.indexOf(team) + 1;

      return h('div', null,
        h('button', {
          class: 'back', onclick: () => {
            state.team = null;
            saveHash();
            draw();
          },
        }, '← TEAM RANKING'),
        h('div', { class: 'panel' },
          h('div', { class: 'team-hero', style: { '--c': team.color } },
            h('span', { class: 'big-swatch' }),
            h('div', null,
              h('div', { class: 'eyebrow' }, `RANK ${pad(rank)} / ${pad(agg.teams.length)}`),
              h('h2', null, team.name))),
          h('div', { class: 'stats' },
            stat('Record', `${team.wins}W ${team.draws}D ${team.losses}L`),
            stat('Kills', fmtNum(team.kills)),
            stat('Deaths', fmtNum(team.deaths)),
            stat('K/D', fmtKd(team.kills, team.deaths)),
            stat('Damage', fmtNum(team.damage)))),
        h('div', { class: 'panel' },
          sectionTitle(1, 'MEMBERS', `${members.length} players`),
          h('div', { class: 'table-wrap' }, h('table', null,
            h('thead', null, h('tr', null,
              h('th', { class: 'l' }, 'Player'), h('th', null, 'Matches'), h('th', null, 'Kills'),
              h('th', null, 'Deaths'), h('th', null, 'K/D'), h('th', null, 'Score'),
              h('th', null, 'Damage'), h('th', null, 'MIT'))),
            h('tbody', null, members.map((m) => h('tr', null,
              h('td', { class: 'l' }, swatchName(m.name, team.color)),
              num(m.matches),
              h('td', { class: 'num' }, h('span', null, fmtNum(m.kills) + ' '), meter(m.kills, maxKills, team.color)),
              num(m.deaths), num(fmtKd(m.kills, m.deaths)), num(m.score), num(m.damage), num(m.mit))))))),
        h('div', { class: 'panel' },
          sectionTitle(2, 'MATCH RESULTS', `${team.results.length} matches`),
          h('div', { class: 'table-wrap' }, h('table', null,
            h('thead', null, h('tr', null,
              h('th', { class: 'l' }, 'Match'), h('th', { class: 'l' }, 'Mode'), h('th', { class: 'l' }, 'Date'),
              h('th', null, 'Result'), h('th', null, 'Value'), h('th', null, 'Kills'))),
            h('tbody', null, team.results.map((r) => {
              const info = modeInfo(r.match);
              const color = r.result === 'W' ? 'var(--warn)' : r.result === 'D' ? 'var(--text-sub)' : 'var(--text-dim)';
              return h('tr', { class: r.result === 'W' ? 'win' : '' },
                h('td', { class: 'l strong' }, matchTitle(r.match, r.index)),
                h('td', { class: 'l muted' }, info.name),
                h('td', { class: 'l num muted' }, fmtDate(r.match.date)),
                h('td', { class: 'num strong', style: { color } }, r.result === 'W' ? 'WIN' : r.result === 'D' ? 'DRAW' : 'LOSE'),
                num(r.value == null ? '—' : `${fmtNum(r.value)} ${info.unit}`),
                num(r.kills));
            }))))));
    }

    // ---- 02 PLAYERS
    const playerCols = [
      { key: 'matches', label: 'Matches' },
      { key: 'wins', label: 'Wins' },
      { key: 'kills', label: 'Kills' },
      { key: 'deaths', label: 'Deaths', asc: true },
      { key: 'kd', label: 'K/D', get: (p) => kd(p.kills, p.deaths) },
      { key: 'score', label: 'Score' },
      { key: 'damage', label: 'Damage' },
      { key: 'mit', label: 'MIT' },
    ];

    function playersView() {
      const col = playerCols.find((c) => c.key === state.sort.key) || playerCols[2];
      const getter = col.get || ((p) => p[col.key]);
      const list = [...agg.players].sort((a, b) =>
        (getter(a) - getter(b)) * state.sort.dir || b.kills - a.kills || a.name.localeCompare(b.name));
      const maxKills = Math.max(1, ...agg.players.map((p) => p.kills));

      const head = h('tr', null, h('th', null, '#'), h('th', { class: 'l' }, 'Player'),
        hasTeams ? h('th', { class: 'l' }, 'Team') : null,
        playerCols.map((c) => h('th', {
          class: 'sortable' + (c.key === state.sort.key ? ' sorted' + (state.sort.dir > 0 ? ' asc' : '') : ''),
          title: 'クリックで並べ替え',
          onclick: () => {
            if (state.sort.key === c.key) state.sort.dir *= -1;
            else state.sort = { key: c.key, dir: c.asc ? 1 : -1 };
            draw();
          },
        }, c.label)));

      return h('div', { class: 'panel' },
        sectionTitle(2, 'PLAYER RANKING', '列の見出しで並べ替え'),
        agg.players.length ? h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, head),
          h('tbody', null, list.map((p, i) => {
            const color = agg.colorOf(p.team);
            return h('tr', null,
              rankCell(i + 1),
              h('td', { class: 'l' }, swatchName(p.name, color)),
              hasTeams ? h('td', { class: 'l' }, p.team ? h('a', {
                href: '#', onclick: (e) => {
                  e.preventDefault();
                  openTeam(p.team);
                },
              }, teamChip(p.team, color)) : teamChip('', color)) : null,
              num(p.matches), num(p.wins),
              h('td', { class: 'num strong' }, h('span', null, fmtNum(p.kills) + ' '), meter(p.kills, maxKills, color)),
              num(p.deaths), num(fmtKd(p.kills, p.deaths)), num(p.score), num(p.damage), num(p.mit));
          })))) : emptyBox('NO DATA', 'プレイヤーの記録がありません。'));
    }

    // ---- 03 MATCHES
    function matchesView() {
      if (!agg.matches.length) {
        return h('div', { class: 'panel' }, sectionTitle(3, 'MATCHES'), emptyBox('NO MATCHES', '試合がありません。'));
      }
      return h('div', { class: 'panel' },
        sectionTitle(3, 'MATCHES', `${agg.matches.length} matches / クリックでスコアボード`),
        h('div', { class: 'match-list' }, agg.matches.map((m, i) => matchCard(m, i))));
    }

    function matchCard(m, index) {
      const info = modeInfo(m);
      const teamMatch = isTeamMatch(m);
      const winnerColor = teamMatch ? agg.colorOf(m.winner) : NEUTRAL;
      const details = h('details', { class: 'match' });
      const summaryEl = h('summary', null,
        badge(index + 1, 'dim'),
        h('div', null,
          h('div', { class: 'm-title' }, matchTitle(m, index)),
          h('div', { class: 'm-sub' },
            h('span', null, info.name),
            h('span', null, fmtDate(m.date)),
            h('span', null, '⏱ ' + fmtDuration(m.durationSec)),
            h('span', null, `${m.players.length} players`))),
        h('div', { class: 'm-result' },
          m.draw ? h('span', { class: 'result-tag draw' }, 'DRAW')
            : h('span', { class: 'result-tag' }, 'WINNER'),
          m.draw ? null : (teamMatch ? teamChip(m.winner, winnerColor) : h('b', null, m.winner || '—'))));
      details.append(summaryEl);

      // 中身は開いた時に作る
      let built = false;
      details.addEventListener('toggle', () => {
        if (!details.open || built) return;
        built = true;
        details.append(h('div', { class: 'm-body' }, scoreboard(m)));
      });
      return details;
    }

    function scoreboard(m) {
      const info = modeInfo(m);
      const sortKey = m.mode === 'ffa' ? 'score' : 'kill';
      const sortPlayers = (list) => [...list].sort((a, b) => b[sortKey] - a[sortKey] || b.kill - a.kill || a.death - b.death);
      const table = (list, color) => h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null,
          h('th', { class: 'l' }, 'Player'), h('th', null, 'Kill'), h('th', null, 'Death'), h('th', null, 'K/D'),
          h('th', null, 'Score'), h('th', null, 'Damage'), h('th', null, 'MIT'))),
        h('tbody', null, sortPlayers(list).map((p) => h('tr', { class: !m.draw && !isTeamMatch(m) && same(p.name, m.winner) ? 'win' : '' },
          h('td', { class: 'l' }, swatchName(p.name, color || agg.colorOf(p.team))),
          num(p.kill, 'strong'), num(p.death), num(fmtKd(p.kill, p.death)), num(p.score), num(p.damage), num(p.mit))))));

      const parts = [];
      if (m.reason && m.reason !== 'manual') parts.push(h('div', { class: 'notice ok' }, '終了理由: ' + m.reason));
      if (m.winnerGuessed) parts.push(h('div', { class: 'notice' }, '旧形式の CSV のため、勝者はキル数から推定しています。'));

      if (isTeamMatch(m)) {
        for (const name of teamsOf(m)) {
          const color = agg.colorOf(name);
          const list = m.players.filter((p) => same(p.team, name));
          const tv = m.teamValues.find((v) => same(v.team, name));
          const kills = list.reduce((s, p) => s + p.kill, 0);
          parts.push(h('div', { class: 'team-block' },
            h('div', { class: 'team-head', style: { '--c': color } },
              h('span', { class: 'swatch' }), name,
              !m.draw && same(name, m.winner) ? h('span', { class: 'win-mark' }, 'WIN') : null,
              h('span', { class: 'tv' }, tv ? `${fmtNum(tv.value)} ${info.unit}` : `${fmtNum(kills)} Kill`)),
            list.length ? table(list, color) : h('div', { class: 'muted' }, 'メンバーの記録なし')));
        }
        const solo = m.players.filter((p) => !p.team);
        if (solo.length) {
          parts.push(h('div', { class: 'team-block' },
            h('div', { class: 'team-head' }, 'NO TEAM'), table(solo, NEUTRAL)));
        }
      } else {
        parts.push(table(m.players, NEUTRAL));
      }
      return parts;
    }

    root.replaceChildren(summary, tabBar, body);
    draw();
    return agg;
  }

  window.CZ = {
    h, pad, dateValue, fmtDate, fmtDay, fmtDuration, fmtNum, fmtKd,
    parseCsvRows, parseMatchCsv, readFileText, suggestWinner, isTeamMatch, teamsOf,
    aggregate, summarize, renderTournament, badge, teamChip, emptyBox, sectionTitle, modeInfo, matchTitle,
    NEUTRAL,
  };
})();
