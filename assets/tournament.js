// 大会詳細ページ (tournament.html?id=...)
(function () {
  'use strict';
  const { h, fmtDay } = CZ;
  const head = document.getElementById('head');
  const board = document.getElementById('board');
  const id = new URLSearchParams(location.search).get('id') || '';

  function fail(message) {
    head.replaceChildren(h('div', { class: 'eyebrow' }, 'Tournament'), h('h1', null, '大会が見つかりません'));
    board.replaceChildren(h('div', { class: 'notice err' }, message), h('p', null, h('a', { href: './' }, '← 大会一覧へ')));
  }

  // ID は英数字・-・_ のみ(結果ファイルの名前に使う)
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    fail('URL に大会の ID がありません。');
    return;
  }

  fetch('data/tournaments/' + id + '.json', { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then((t) => {
      document.title = (t.name || id) + ' — CZPvP Results';
      head.replaceChildren(
        h('div', { class: 'eyebrow' }, 'Tournament'),
        h('h1', null, t.name || id),
        t.description ? h('p', { class: 'lead' }, t.description) : null,
        h('div', { class: 'meta-line' },
          h('span', null, 'DATE ', h('b', null, fmtDay(t.date))),
          t.updatedAt ? h('span', null, 'UPDATED ', h('b', null, CZ.fmtDate(t.updatedAt))) : null));
      CZ.renderTournament(board, t, { useHash: true });
    })
    .catch((e) => fail('結果ファイル(data/tournaments/' + id + '.json)を読み込めませんでした: ' + e.message));
})();
