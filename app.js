// つかえるお金 — 口座残高 + 次の給料 + 入金 − 引き落とし = 今月使えるお金
// データはこの端末の localStorage にだけ保存する

const KEY = 'tsukaeru-okane-v1';

// ---------- 日付・金額のユーティリティ ----------

const pad = (n) => String(n).padStart(2, '0');
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const todayStr = () => toStr(new Date());
const md = (s) => {
  const d = toDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
// 1か月後の同じ日（31日→30日のように月末で丸める）
const addMonth = (s) => {
  const d = toDate(s);
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate();
  return toStr(new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), last)));
};
// 金額に符号は付けない。増える・減るは色（緑・赤）で表す
const yen = (n) => '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
// 全角数字やカンマ・円記号が混ざっていても数値にする
const parseMoney = (s) => {
  const digits = String(s)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
};

// ---------- 状態 ----------

// 給料日は毎月15日。今日が15日を過ぎていれば来月の15日
function nextPayday() {
  const now = new Date();
  return toStr(new Date(now.getFullYear(), now.getMonth() + (now.getDate() > 15 ? 1 : 0), 15));
}

function defaultState() {
  return {
    v: 2,
    cash: 0,
    salary: { amount: 0, date: nextPayday() },
    // 入金と引き落としの予定。kind が 'in' なら入金、それ以外は引き落とし
    charges: [], // { id, kind, name, amount, date, monthly }
  };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && saved.salary) {
      const loaded = { ...defaultState(), ...saved };
      // v1 のデータ：給料日を15日に直し、廃止した「取っておくお金」を捨てる
      if (saved.v !== 2) {
        loaded.v = 2;
        loaded.salary.date = nextPayday();
        delete loaded.reserve;
      }
      return loaded;
    }
  } catch (e) {
    // 壊れたデータは無視して初期状態から始める
  }
  return defaultState();
}

let state = load();

function save() {
  state.updatedAt = todayStr(); // 最後に内容を変えた日
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    // プライベートブラウズなどで保存できなくても表示は続ける
  }
  render();
}

// ---------- 計算 ----------

function compute() {
  const sum = (list) => list.reduce((t, c) => t + c.amount, 0);
  const incomeTotal = sum(state.charges.filter((c) => c.kind === 'in'));
  const chargeTotal = sum(state.charges.filter((c) => c.kind !== 'in'));
  return {
    today: todayStr(),
    incomeTotal,
    chargeTotal,
    usable: state.cash + state.salary.amount + incomeTotal - chargeTotal,
  };
}

// ---------- 描画 ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

function render() {
  const c = compute();
  const sorted = [...state.charges].sort((a, b) => (a.date < b.date ? -1 : 1));

  document.getElementById('today').textContent = `今日 ${md(c.today)}`;

  // 足りないときも見出しと色は変えず、ここだけマイナスを付けて表す
  const hero = h('section', { class: 'hero use' },
    h('p', { class: 'hero-label' }, '今月つかえるお金'),
    h('p', { class: 'hero-amount' }, (c.usable < 0 ? '−' : '') + yen(c.usable)),
  );

  // tone: 'in'（増える・緑） / 'out'（減る・赤）。行全体をその色で塗る
  const row = (tone, name, when, note, amount, onclick) =>
    h('button', { class: `plan ${tone}`, onclick },
      h('span', { class: 'plan-name' },
        name, when && h('small', { class: 'when' }, when), note && h('small', { class: 'note' }, note)),
      h('span', { class: 'money' }, yen(amount)),
    );

  // 内訳：口座残高・給料のあとに、入金・引き落としの予定を日付順に並べる。ここだけスクロールする
  const breakdown = h('section', { class: 'breakdown' },
    h('h2', {}, '内訳',
      state.updatedAt && h('small', {}, `最終更新 ${md(state.updatedAt)}`)),
    h('div', { class: 'plans' },
      row('in', '口座残高', null, null, state.cash, editCash),
      row('in', '次の給料', md(state.salary.date), null, state.salary.amount, editSalary),
      sorted.map((ch) =>
        swipeToDelete(
          row(ch.kind === 'in' ? 'in' : 'out', ch.name, md(ch.date),
            [ch.date < c.today && '期日を過ぎています', ch.monthly && '毎月'].filter(Boolean).join('・'),
            ch.amount, () => editCharge(ch)),
          () => removeCharge(ch))),
      sorted.length === 0 &&
        h('p', { class: 'empty' }, '下の丸いボタンから、これから入るお金・引かれるお金を追加できます'),
      h('button', { class: 'link', onclick: resetAll }, 'すべてリセット'),
    ),
  );

  const fabs = h('div', { class: 'fabs' },
    h('button', { class: 'fab in', 'aria-label': '入金を追加', onclick: () => editCharge(null, 'in') }, '＋'),
    h('button', { class: 'fab out', 'aria-label': '引き落としを追加', onclick: () => editCharge(null, 'out') }, '−'),
  );

  document.getElementById('app').replaceChildren(hero, breakdown, fabs);
}

// ---------- 左スワイプで削除 ----------

const TRASH_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>';
const TRASH_WIDTH = 68;
let closeOpenSwipe = null; // 開いたままの行は同時に1つだけ

// 行を左にずらすと、右側にゴミ箱ボタンが出てくる
function swipeToDelete(rowEl, onDelete) {
  const trash = h('button', { class: 'trash', 'aria-label': '削除', onclick: onDelete });
  trash.innerHTML = TRASH_ICON;
  const wrap = h('div', { class: 'swipe' }, trash, rowEl);
  let startX = 0, startY = 0, base = 0, x = 0;
  let down = false, dragging = false, suppressClick = false;

  const move = (to, animate) => {
    x = to;
    rowEl.style.transition = animate ? 'transform .18s ease-out' : 'none';
    rowEl.style.transform = x ? `translateX(${x}px)` : '';
    wrap.classList.toggle('show', x !== 0);
  };
  const close = () => { move(0, true); if (closeOpenSwipe === close) closeOpenSwipe = null; };

  rowEl.addEventListener('pointerdown', (e) => {
    down = true; dragging = false;
    startX = e.clientX; startY = e.clientY; base = x;
  });
  rowEl.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!dragging) {
      // 縦の動き（一覧のスクロール）とは区別する
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      dragging = true;
      rowEl.setPointerCapture(e.pointerId);
      if (closeOpenSwipe && closeOpenSwipe !== close) closeOpenSwipe();
    }
    move(Math.max(-TRASH_WIDTH, Math.min(0, base + dx)), false);
  });
  const end = () => {
    if (!down) return;
    down = false;
    if (!dragging) return;
    suppressClick = true; // スワイプ直後のクリックで編集シートが開かないようにする
    if (x < -TRASH_WIDTH / 2) { move(-TRASH_WIDTH, true); closeOpenSwipe = close; }
    else close();
  };
  rowEl.addEventListener('pointerup', end);
  rowEl.addEventListener('pointercancel', end);
  rowEl.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; e.stopImmediatePropagation(); }
    // 開いている行をタップしたら閉じるだけ
    else if (x !== 0) { close(); e.stopImmediatePropagation(); }
  }, true);
  return wrap;
}

function removeCharge(ch) {
  state.charges = state.charges.filter((x) => x !== ch);
  save();
}

// ---------- 入力シート ----------

const sheet = document.getElementById('sheet');
const sheetForm = document.getElementById('sheet-form');

// fields: [{ key, label, type: 'text' | 'money' | 'date' | 'check', value, placeholder }]
// actions: [{ label, class, run(values) }]  run が false を返すとシートを閉じない
function openSheet(title, fields, actions) {
  document.getElementById('sheet-title').textContent = title;
  const inputs = {};
  document.getElementById('sheet-fields').replaceChildren(
    ...fields.map((f) => {
      if (f.type === 'check') {
        inputs[f.key] = h('input', { type: 'checkbox', checked: !!f.value });
        return h('label', { class: 'check' }, inputs[f.key], f.label);
      }
      inputs[f.key] = h('input', {
        type: f.type === 'date' ? 'date' : 'text',
        inputmode: f.type === 'money' ? 'numeric' : null,
        placeholder: f.placeholder || (f.type === 'money' ? '0' : ''),
        value: f.type === 'money' ? (f.value ? String(f.value) : '') : f.value || '',
        autocomplete: 'off',
        class: f.type === 'money' ? 'in-money' : '',
      });
      return h('label', { class: 'field' }, h('span', {}, f.label),
        f.type === 'money' ? h('span', { class: 'yen-wrap' }, '¥', inputs[f.key]) : inputs[f.key]);
    }),
  );
  const values = () =>
    Object.fromEntries(fields.map((f) => [f.key,
      f.type === 'check' ? inputs[f.key].checked :
      f.type === 'money' ? parseMoney(inputs[f.key].value) :
      inputs[f.key].value.trim()]));
  const all = [...actions, { label: 'キャンセル', class: 'ghost', run: () => {} }];
  document.getElementById('sheet-actions').replaceChildren(
    ...all.map((a, i) =>
      i === 0
        ? h('button', { type: 'submit', class: `btn ${a.class || ''}` }, a.label)
        : h('button', {
            type: 'button', class: `btn ${a.class || ''}`,
            onclick: () => { if (a.run(values()) !== false) sheet.close(); },
          }, a.label)),
  );
  // 先頭のアクション（保存）は submit にして、Enter キーでも保存できるようにする
  sheetForm.onsubmit = (e) => {
    e.preventDefault();
    if (actions[0].run(values()) !== false) sheet.close();
  };
  sheet.showModal();
  const first = Object.values(inputs)[0];
  if (first && first.type === 'text') { first.focus(); first.select(); }
}

sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

function editCash() {
  openSheet('口座残高', [
    { key: 'cash', label: 'いま口座にあるお金', type: 'money', value: state.cash },
  ], [{ label: '保存', run: (v) => { state.cash = v.cash; save(); } }]);
}

function editSalary() {
  openSheet('次の給料', [
    { key: 'amount', label: '手取り額', type: 'money', value: state.salary.amount },
    { key: 'date', label: '給料日', type: 'date', value: state.salary.date },
  ], [{
    label: '保存',
    run: (v) => {
      if (!v.date) return false;
      state.salary = { amount: v.amount, date: v.date };
      save();
    },
  }, {
    label: '受け取った（口座残高に足して来月へ）', class: 'sub',
    run: receiveSalary,
  }]);
}

// 入金・引き落としの予定を追加／編集する。新規のときは kind で種類を指定する
function editCharge(ch, kind) {
  const isNew = !ch;
  const isIn = (ch ? ch.kind : kind) === 'in';
  const word = isIn ? '入金' : '引き落とし';
  const actions = [{
    label: '保存',
    run: (v) => {
      if (!v.date) return false;
      const data = { name: v.name || word, amount: v.amount, date: v.date, monthly: v.monthly };
      if (isNew) state.charges.push({ id: Date.now().toString(36), kind: isIn ? 'in' : 'out', ...data });
      else Object.assign(ch, data);
      save();
    },
  }];
  if (!isNew) {
    const done = isIn ? '入金された（口座残高に足す' : '引き落とされた（口座残高から引く';
    actions.push({
      label: done + (ch.monthly ? 'して来月へ）' : '）'),
      class: `sub ${isIn ? 'in' : 'out'}`,
      run: () => settleCharge(ch),
    }, {
      label: '削除', class: 'danger',
      run: () => removeCharge(ch),
    });
  }
  openSheet(isNew ? `${word}を追加` : `${word}を編集`, [
    { key: 'name', label: '名前', type: 'text', value: ch?.name,
      placeholder: isIn ? '例：ボーナス、バイト代、立て替えの返金' : '例：楽天カード、家賃' },
    { key: 'amount', label: '金額', type: 'money', value: ch?.amount },
    { key: 'date', label: isIn ? '入金日' : '引き落とし日', type: 'date', value: ch?.date || todayStr() },
    { key: 'monthly', label: isIn ? '毎月くり返す（金額が同じもの）' : '毎月くり返す（家賃・サブスクなど金額が同じもの）',
      type: 'check', value: ch?.monthly },
  ], actions);
}

// 済んだ予定を口座残高に反映する。毎月のものは翌月へ、そうでなければ消す
function settleCharge(ch) {
  state.cash += ch.kind === 'in' ? ch.amount : -ch.amount;
  if (ch.monthly) ch.date = addMonth(ch.date);
  else state.charges = state.charges.filter((x) => x !== ch);
  save();
}

// 給料を受け取った：口座残高に足して、給料日を翌月へ
function receiveSalary() {
  state.cash += state.salary.amount;
  state.salary.date = addMonth(state.salary.date);
  save();
}

function resetAll() {
  if (!confirm('入力したデータをすべて消します。よろしいですか？')) return;
  state = defaultState();
  save();
}

// ---------- 起動 ----------

render();
// 日付が変わったあとに開き直したときも表示を更新する
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
