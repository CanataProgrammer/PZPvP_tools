// 大会一覧ページ
(function () {
  'use strict';
  const { h, fmtDay, fmtNum, teamChip, emptyBox } = CZ;
  const root = document.getElementById('list');

  function card(t, i) {
    return h('a', { class: 'card', href: 'tournament.html?id=' + encodeURIComponent(t.id) },
      h('div', { class: 'panel' },
        h('div', { class: 'section-title' }, CZ.badge(i + 1), h('span', { class: 'date' }, fmtDay(t.date))),
        h('h2', null, t.name || t.id),
        t.description ? h('p', { class: 'desc' }, t.description) : null,
        h('div', { class: 'meta-line' },
          h('span', null, h('b', null, fmtNum(t.matchCount || 0)), ' matches'),
          t.teamCount ? h('span', null, h('b', null, fmtNum(t.teamCount)), ' teams') : null,
          h('span', null, h('b', null, fmtNum(t.playerCount || 0)), ' players')),
        t.champion ? h('div', { class: 'champion' },
          h('span', { class: 'label' }, t.champion.type === 'team' ? 'CHAMPION' : 'TOP PLAYER'),
          t.champion.type === 'team' ? teamChip(t.champion.name, t.champion.color || CZ.NEUTRAL) : h('span', null, t.champion.name))
          : null));
  }

  fetch('data/index.json', { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then((index) => {
      const list = [...(index.tournaments || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (!list.length) {
        root.replaceChildren(h('div', { class: 'panel' },
          emptyBox('NO TOURNAMENTS', '公開中の大会はまだありません。'),
          h('p', { class: 'muted', style: { 'text-align': 'center' } },
            h('a', { href: 'tools.html' }, 'ツール'), ' で Mod の CSV から結果ファイルを作れます。')));
        return;
      }
      root.replaceChildren(h('div', { class: 'grid' }, list.map(card)));
    })
    .catch((e) => {
      root.replaceChildren(h('div', { class: 'notice err' },
        '大会一覧(data/index.json)を読み込めませんでした: ' + e.message
        + (location.protocol === 'file:' ? '(ファイルを直接開くと読み込めません。HTTP サーバー経由で開いてください)' : '')));
    });
})();
