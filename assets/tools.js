// 結果ファイル作成ツール (tools.html)
(function () {
  'use strict';
  const { h, pad, emptyBox } = CZ;
  const $ = (id) => document.getElementById(id);

  const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
  const DRAW = '__draw__';

  const state = {
    meta: { id: '', name: '', date: '', description: '' },
    idTouched: false,
    loadedId: '', // 編集のために読み込んだ大会の ID(同じ ID での上書きは確認しない)
    matches: [],
    index: null, // { tournaments: [...] } 公開中の一覧(または読み込んだ index.json)
  };

  // ---------------------------------------------------------------- メッセージ

  function log(text, kind = '') {
    const box = $('log');
    box.prepend(h('div', { class: 'notice ' + kind, style: { 'margin-top': '6px' } }, text));
    while (box.children.length > 6) box.lastChild.remove();
  }

  function exportMsg(text, kind = '') {
    $('export-msg').replaceChildren(text ? h('div', { class: 'notice ' + kind }, text) : '');
  }

  // ---------------------------------------------------------------- 日付

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toDay(iso) {
    return toLocalInput(iso).slice(0, 10);
  }

  function fromLocalInput(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d) ? null : d.toISOString();
  }

  function slugify(name) {
    return (name || '').normalize('NFKC').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }

  function autoId() {
    // 日本語などを含む名前は英数字だけ拾うと意味が通らないので、開催日から作る
    const slug = /[^\x00-\x7f]/.test(state.meta.name) ? '' : slugify(state.meta.name);
    if (slug) return slug;
    const day = (state.meta.date || toDay(new Date().toISOString())).replace(/-/g, '');
    return 'cup-' + day;
  }

  // ---------------------------------------------------------------- 読み込み

  function normalizeMatch(m) {
    return {
      id: m.id || 'm' + Math.random().toString(36).slice(2, 10),
      label: m.label || '',
      fileName: m.fileName || '',
      date: m.date || null,
      endDate: m.endDate || null,
      durationSec: m.durationSec ?? null,
      mode: m.mode || '',
      modeName: m.modeName || '',
      spawnMode: m.spawnMode || 'RANDOM',
      winner: m.winner || '',
      draw: !!m.draw,
      reason: m.reason || '',
      teamValues: Array.isArray(m.teamValues) ? m.teamValues : [],
      players: Array.isArray(m.players) ? m.players : [],
      legacy: !!m.legacy,
      winnerGuessed: !!m.winnerGuessed,
      excluded: !!m.excluded,
    };
  }

  function loadTournament(t, sourceName) {
    if (state.matches.length && !confirm('今の内容を「' + (t.name || t.id) + '」で置き換えますか?')) return;
    state.meta = { id: t.id || '', name: t.name || '', date: t.date || '', description: t.description || '' };
    state.idTouched = !!t.id;
    state.loadedId = t.id || '';
    state.matches = (t.matches || []).map(normalizeMatch);
    syncMetaInputs();
    log(`大会「${t.name || t.id}」を読み込みました(${state.matches.length} 試合)— ${sourceName}`, 'ok');
    renderAll();
  }

  async function handleFiles(fileList) {
    const files = [...fileList];
    const added = [];
    for (const file of files) {
      try {
        const text = await CZ.readFileText(file);
        if (/\.json$/i.test(file.name) || /^\s*[{[]/.test(text)) {
          const obj = JSON.parse(text);
          if (Array.isArray(obj.matches)) {
            loadTournament(obj, file.name);
          } else if (Array.isArray(obj.tournaments)) {
            state.index = obj;
            log(`一覧ファイルを読み込みました(${obj.tournaments.length} 大会)— ${file.name}`, 'ok');
            renderIndexList();
          } else {
            log(`${file.name}: 大会ファイルでも index.json でもありません。`, 'err');
          }
          continue;
        }
        const match = CZ.parseMatchCsv(text, { fileName: file.name, lastModified: file.lastModified });
        const dup = state.matches.find((m) => m.fileName === match.fileName && m.date === match.date);
        if (dup) {
          log(`${file.name}: すでに読み込まれているのでスキップしました。`);
          continue;
        }
        added.push(match);
        log(`${file.name}: ${match.players.length} 人の記録を読み込みました`
          + (match.legacy ? '(旧形式: 勝者はキル数から推定。下で変更できます)' : ''), match.legacy ? '' : 'ok');
      } catch (e) {
        log(`${file.name}: 読み込めませんでした — ${e.message}`, 'err');
      }
    }
    if (added.length) {
      added.sort((a, b) => CZ.dateValue(a.date) - CZ.dateValue(b.date));
      state.matches.push(...added);
      if (!state.meta.date) {
        state.meta.date = toDay(added[0].date) || '';
        syncMetaInputs();
      }
      renderAll();
    }
  }

  function loadPublishedIndex() {
    fetch('data/index.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((index) => {
        if (!state.index) state.index = index;
        const select = $('published');
        for (const t of index.tournaments || []) {
          select.append(h('option', { value: t.id }, `${t.name || t.id}(${CZ.fmtDay(t.date)})`));
        }
        renderIndexList();
      })
      .catch(() => {
        // file:// で開いた時など。読み込めなくてもツールは使える
        $('published').disabled = true;
        $('load-published').disabled = true;
      });
  }

  function loadPublished() {
    const id = $('published').value;
    if (!id || !ID_PATTERN.test(id)) return;
    fetch('data/tournaments/' + id + '.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((t) => loadTournament(t, id + '.json'))
      .catch((e) => log('大会ファイルを読み込めませんでした: ' + e.message, 'err'));
  }

  // ---------------------------------------------------------------- 大会情報

  function syncMetaInputs() {
    $('t-name').value = state.meta.name;
    $('t-id').value = state.meta.id;
    $('t-date').value = state.meta.date;
    $('t-desc').value = state.meta.description;
    $('fname').textContent = (state.meta.id || '<ID>') + '.json';
  }

  function bindMetaInputs() {
    $('t-name').addEventListener('input', (e) => {
      state.meta.name = e.target.value;
      if (!state.idTouched) {
        state.meta.id = autoId();
        $('t-id').value = state.meta.id;
        $('fname').textContent = state.meta.id + '.json';
      }
      schedulePreview();
    });
    $('t-id').addEventListener('input', (e) => {
      const clean = e.target.value.replace(/[^A-Za-z0-9_-]/g, '');
      if (clean !== e.target.value) e.target.value = clean;
      state.meta.id = clean;
      state.idTouched = clean !== '';
      $('fname').textContent = (clean || '<ID>') + '.json';
    });
    $('t-date').addEventListener('input', (e) => {
      state.meta.date = e.target.value;
      if (!state.idTouched) {
        state.meta.id = autoId();
        $('t-id').value = state.meta.id;
        $('fname').textContent = state.meta.id + '.json';
      }
      schedulePreview();
    });
    $('t-desc').addEventListener('input', (e) => {
      state.meta.description = e.target.value;
      schedulePreview();
    });
  }

  // ---------------------------------------------------------------- 試合の編集

  function winnerOptions(m) {
    const names = CZ.isTeamMatch(m) ? CZ.teamsOf(m) : m.players.map((p) => p.name);
    const current = m.draw ? DRAW : m.winner;
    const options = [];
    if (!m.draw && !m.winner) options.push(h('option', { value: '' }, '(未設定)'));
    for (const n of names) options.push(h('option', { value: n }, n));
    if (m.winner && !names.some((n) => n.toLowerCase() === m.winner.toLowerCase())) {
      options.push(h('option', { value: m.winner }, m.winner));
    }
    options.push(h('option', { value: DRAW }, '引き分け'));
    for (const o of options) o.selected = o.value.toLowerCase() === (current || '').toLowerCase();
    return options;
  }

  function move(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= state.matches.length) return;
    const [m] = state.matches.splice(index, 1);
    state.matches.splice(to, 0, m);
    renderAll();
  }

  function renderMatches() {
    const root = $('matches');
    const included = state.matches.filter((m) => !m.excluded).length;
    $('match-count').textContent = state.matches.length ? `${included} / ${state.matches.length} 試合を使用` : '';

    if (!state.matches.length) {
      root.replaceChildren(emptyBox('NO MATCHES', '01 LOAD で CSV を読み込むと、ここに試合が並びます。'));
      return;
    }

    let shown = 0;
    root.replaceChildren(h('div', { class: 'match-editor' }, state.matches.map((m, i) => {
      const info = CZ.modeInfo(m);
      const number = m.excluded ? '--' : pad(++shown);
      return h('div', { class: 'me-row' + (m.excluded ? ' excluded' : '') },
        h('span', { class: 'idx badge' + (m.excluded ? ' dim' : '') }, number),
        h('div', { class: 'field f-label' },
          h('label', null, '表示名'),
          h('input', {
            type: 'text', value: m.label, placeholder: `MATCH ${number}`,
            oninput: (e) => {
              m.label = e.target.value;
              schedulePreview();
            },
          })),
        h('div', { class: 'field f-date' },
          h('label', null, '日時'),
          h('input', {
            type: 'datetime-local', value: toLocalInput(m.date),
            oninput: (e) => {
              m.date = fromLocalInput(e.target.value);
              schedulePreview();
            },
          })),
        h('div', { class: 'field f-winner' },
          h('label', null, m.winnerGuessed ? '勝者(推定)' : '勝者'),
          h('select', {
            onchange: (e) => {
              const v = e.target.value;
              m.draw = v === DRAW;
              m.winner = v === DRAW ? '' : v;
              m.winnerGuessed = false;
              renderAll();
            },
          }, winnerOptions(m))),
        h('div', { class: 'actions' },
          h('label', { class: 'check', title: 'チェックを外すと集計に使いません' },
            h('input', {
              type: 'checkbox', checked: !m.excluded,
              onchange: (e) => {
                m.excluded = !e.target.checked;
                renderAll();
              },
            }), '使用'),
          h('button', { class: 'icon-btn', type: 'button', title: '上へ', disabled: i === 0, onclick: () => move(i, -1) }, '▲'),
          h('button', { class: 'icon-btn', type: 'button', title: '下へ', disabled: i === state.matches.length - 1, onclick: () => move(i, 1) }, '▼'),
          h('button', {
            class: 'icon-btn del', type: 'button', title: '削除',
            onclick: () => {
              state.matches.splice(i, 1);
              renderAll();
            },
          }, '✕')),
        h('div', { class: 'file' },
          [m.fileName || '(ファイル名なし)', info.name, CZ.isTeamMatch(m) ? 'TEAM' : 'SOLO',
            `${m.players.length} players`].join(' · ')));
    })));
  }

  // ---------------------------------------------------------------- 出力

  function buildTournament() {
    return {
      format: 'czpvp-tournament',
      version: 1,
      id: state.meta.id,
      name: state.meta.name.trim(),
      date: state.meta.date,
      description: state.meta.description.trim(),
      updatedAt: new Date().toISOString(),
      matches: state.matches.map(normalizeMatch),
    };
  }

  function buildIndex(tournament) {
    const list = ((state.index && state.index.tournaments) || []).filter((t) => t.id !== tournament.id);
    list.push(CZ.summarize(tournament));
    list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { format: 'czpvp-index', version: 1, updatedAt: new Date().toISOString(), tournaments: list };
  }

  function validate() {
    if (!state.meta.name.trim()) return '大会名を入力してください。';
    if (!ID_PATTERN.test(state.meta.id)) return 'ID は英数字・-・_ で入力してください。';
    if (!state.matches.some((m) => !m.excluded)) return '使用する試合が1つもありません。';
    return null;
  }

  /** 公開中の別の大会と ID が同じなら、上書きしてよいか確認する。 */
  function confirmOverwrite() {
    const id = state.meta.id;
    const existing = ((state.index && state.index.tournaments) || []).find((t) => t.id === id);
    if (!existing || id === state.loadedId || id === state.confirmedId) return true;
    if (!confirm(`ID「${id}」は公開中の大会「${existing.name || id}」と同じです。上書きしますか?`)) return false;
    state.confirmedId = id;
    return true;
  }

  function download(fileName, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: fileName });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportTournament() {
    const problem = validate();
    if (problem) return exportMsg(problem, 'err');
    if (!confirmOverwrite()) return exportMsg('保存を取りやめました。ID を変えてください。', 'err');
    const t = buildTournament();
    download(t.id + '.json', t);
    exportMsg(`${t.id}.json を保存しました。gh-pages ブランチの data/tournaments/ に置いてください。続けて index.json も保存してください。`, 'ok');
  }

  function exportIndex() {
    const problem = validate();
    if (problem) return exportMsg(problem, 'err');
    if (!confirmOverwrite()) return exportMsg('保存を取りやめました。ID を変えてください。', 'err');
    const index = buildIndex(buildTournament());
    download('index.json', index);
    exportMsg(`index.json(${index.tournaments.length} 大会)を保存しました。gh-pages ブランチの data/index.json を置き換えてください。`, 'ok');
  }

  /** 出力する一覧に入っている大会。ここから外すこともできる。 */
  function renderIndexList() {
    const root = $('index-list');
    const list = (state.index && state.index.tournaments) || [];
    if (!list.length) {
      root.replaceChildren();
      return;
    }
    root.replaceChildren(
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'index.json に入る大会(今の大会は保存時に追加・更新)')),
      h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, list.map((t) => h('tr', null,
        h('td', { class: 'l' }, t.name || t.id),
        h('td', { class: 'l num muted' }, t.id),
        h('td', { class: 'num muted' }, CZ.fmtDay(t.date)),
        h('td', null, h('button', {
          class: 'btn ghost small', type: 'button',
          onclick: () => {
            if (!confirm(`「${t.name || t.id}」を一覧から外しますか?(index.json を保存し直すと反映。大会ファイル自体は手動で削除してください)`)) return;
            state.index = { ...state.index, tournaments: list.filter((x) => x !== t) };
            renderIndexList();
          },
        }, '一覧から外す'))))))));
  }

  // ---------------------------------------------------------------- プレビュー

  let previewTimer = 0;

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 200);
  }

  function renderPreview() {
    const root = $('preview');
    $('preview-title').textContent = state.meta.name.trim() || 'プレビュー';
    if (!state.matches.some((m) => !m.excluded)) {
      root.replaceChildren(h('div', { class: 'panel' }, emptyBox('NO DATA', 'CSV を読み込むとここに結果が表示されます。')));
      return;
    }
    CZ.renderTournament(root, buildTournament(), { useHash: false });
  }

  function renderAll() {
    renderMatches();
    renderPreview();
  }

  // ---------------------------------------------------------------- 初期化

  function bindDrop() {
    const drop = $('drop');
    $('file').addEventListener('change', (e) => {
      handleFiles(e.target.files);
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.remove('over');
    }));
    drop.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
    // ドロップ先を外したファイルでページが開き直されないように
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  }

  bindDrop();
  bindMetaInputs();
  $('load-published').addEventListener('click', loadPublished);
  $('clear').addEventListener('click', () => {
    if (state.matches.length && !confirm('読み込んだ試合と大会情報を全部消しますか?')) return;
    state.meta = { id: '', name: '', date: '', description: '' };
    state.idTouched = false;
    state.loadedId = '';
    state.matches = [];
    syncMetaInputs();
    $('log').replaceChildren();
    exportMsg('');
    renderAll();
  });
  $('dl-tournament').addEventListener('click', exportTournament);
  $('dl-index').addEventListener('click', exportIndex);

  syncMetaInputs();
  renderAll();
  loadPublishedIndex();
})();
