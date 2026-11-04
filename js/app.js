// =========================================================
// app.js  画面の動き
// 今の段階でできること
//  ・下のタブで4つの画面を切り替える
//  ・明細CSV(楽天カード・PayPay)を読み込み、重複を除いて保存する
//  ・ホーム画面に今月の合計と支払い元ごとのまとめを表示する
//  ・取引一覧を月・支払い元ごとに表示する
//  ・ライト/ダーク/自動を切り替え、次に開いたときも覚えておく
//  ・すべてのデータを削除する
// =========================================================

// ---------- アプリ全体で使う状態 ----------
const state = {
  transactions: [], // 保存されている取引すべて
  month: currentMonth(), // 表示中の月 "2026-10"
  source: "all", // 一覧で表示する支払い元 "all" / "rakuten" / "paypay"
  onlyUnconfirmed: false, // true のときは未確認の取引だけを一覧に出す
  detailId: null, // 詳細画面で表示中の取引の id
  pieCategory: null, // 円グラフで選んでいるジャンル(なければ null)
  query: "", // 取引一覧の検索の言葉(空なら検索していない)
  photoIndex: 0, // 詳細画面で表示中の写真が何枚目か(0が1枚目)
  selectMode: false, // まとめて確認済みにするモード
  selected: new Set(), // まとめて確認するために選んだ取引の id
};

// 写真を画面に表示するための一時的なURLを覚えておく(取引の id → URL)
const imageURLs = new Map();

// 写真の表示用URLを用意する(一度作ったものは使い回す)
async function getImageURL(id) {
  if (imageURLs.has(id)) return imageURLs.get(id);
  const blob = await getImage(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  imageURLs.set(id, url);
  return url;
}

// 写真を差し替え・削除したときに、古いURLを片付ける
function forgetImageURL(id) {
  if (imageURLs.has(id)) {
    URL.revokeObjectURL(imageURLs.get(id));
    imageURLs.delete(id);
  }
}

// 取引に付いている写真の id の一覧
// (写真を1枚しか付けられなかった頃の取引は、取引の id がそのまま写真の id)
function imageIdsOf(t) {
  if (Array.isArray(t.imageIds)) return t.imageIds;
  return t.hasImage ? [t.id] : [];
}

// 写真の一覧を取引に書き込む
function setImageIds(t, ids) {
  t.imageIds = ids;
  t.hasImage = ids.length > 0;
}

const MAX_PHOTOS = 10; // 1件の取引に付けられる写真の枚数

// id から取引を探す
function findTransaction(id) {
  return state.transactions.find(function (t) {
    return t.id === id;
  });
}

// 支払い元の表示名
const SOURCE_NAMES = {
  rakuten: "楽天カード",
  paypay: "PayPay",
};

// ---------- 小さな道具 ----------

// 今日の年月 "2026-10"
function currentMonth() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// "2026-10" に月を足し引きする
function addMonth(month, diff) {
  const parts = month.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1 + diff, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// "2026-10" → "2026年10月"
function monthLabel(month) {
  const parts = month.split("-").map(Number);
  return parts[0] + "年" + parts[1] + "月";
}

// 12345 → "12,345円"
function yen(n) {
  return n.toLocaleString("ja-JP") + "円";
}

// 表示中の月の取引だけを取り出す
function transactionsOfMonth(month) {
  return state.transactions.filter(function (t) {
    return t.date.slice(0, 7) === month;
  });
}

// 金額の合計
function sum(list) {
  return list.reduce(function (total, t) {
    return total + t.amount;
  }, 0);
}

// 未確認の件数
function countUnconfirmed(list) {
  return list.filter(function (t) {
    return t.status === "unconfirmed";
  }).length;
}

// 取引がある一番新しい月(取引がなければ今月)
function latestMonth() {
  if (state.transactions.length === 0) return currentMonth();
  return state.transactions
    .map(function (t) { return t.date.slice(0, 7); })
    .sort()
    .pop();
}

// ---------- 下のタブで画面を切り替える ----------

const tabs = document.querySelectorAll(".tab");

tabs.forEach(function (tab) {
  tab.addEventListener("click", function () {
    showScreen(tab.dataset.target);
  });
});

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(function (screen) {
    screen.classList.toggle("is-active", screen.id === screenId);
  });
  // 取引一覧から離れたら、まとめて確認するモードは終わりにする
  if (state.selectMode && screenId !== "screen-list") {
    state.selectMode = false;
    state.selected = new Set();
    document.getElementById("screen-list").classList.remove("is-selecting");
    document.getElementById("select-toggle").textContent = "選ぶ";
    renderSelectBar();
    renderList();
  }

  // 詳細画面は「取引」タブ、お店の辞書は「設定」タブの中の画面として扱う
  let activeTab = screenId;
  if (screenId === "screen-detail") activeTab = "screen-list";
  if (["screen-shops", "screen-source", "screen-about", "screen-budget"].indexOf(screenId) !== -1) {
    activeTab = "screen-settings";
  }
  if (screenId === "screen-pending" || screenId === "screen-pending-edit") activeTab = "screen-home";
  if (screenId === "screen-shop-edit") {
    // 詳細画面から来たときは「取引」、辞書の一覧から来たときは「設定」のタブ
    activeTab = shopEditReturn === "screen-detail" ? "screen-list" : "screen-settings";
    if (shopEditReturn === "screen-graph") activeTab = "screen-graph";
  }
  tabs.forEach(function (tab) {
    tab.classList.toggle("is-active", tab.dataset.target === activeTab);
  });
  window.scrollTo(0, 0);
}

// ---------- 画面を最新の状態に描き直す ----------

function render() {
  renderMonthNav();
  renderHome();
  renderList();
  renderGraph();
  renderTabBadge();
  renderPendingHome(); // 明細待ちの記録のカード(pending.js)
}

// ---------- グラフ画面 ----------

function renderGraph() {
  renderBarChart();
  renderPieChart();
  renderBudgets();
  renderComments();
  renderSubscriptions();
}

// 予算と使った金額(予算を決めたジャンルだけ、横棒で表示)
function renderBudgets() {
  const area = document.getElementById("budget-area");
  area.innerHTML = "";
  const list = budgetStatus(state.month);

  const title = document.createElement("h2");
  title.className = "graph-title";
  title.textContent = Number(state.month.slice(5)) + "月の予算";
  area.appendChild(title);

  if (list.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.style.textAlign = "left";
    p.textContent = "ジャンルごとに1か月の予算を決めると、ここで使った金額と比べられます。";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button small-button";
    button.textContent = "予算を設定する";
    button.addEventListener("click", openBudgetEditor);
    area.append(p, button);
    return;
  }

  list.forEach(function (b) {
    const row = document.createElement("div");
    row.className = "share-row";
    const label = document.createElement("div");
    label.className = "share-label";
    const n = document.createElement("span");
    n.className = "pie-name";
    n.textContent = b.name;
    const v = document.createElement("span");
    v.className = "pie-value";
    // 超えたら赤、80%以上ならオレンジ
    if (b.ratio > 1) v.classList.add("is-over");
    else if (b.ratio >= 0.8) v.classList.add("is-near");
    v.textContent = yen(b.used) + " / " + yen(b.budget) + "(" + Math.round(b.ratio * 100) + "%)";
    label.append(n, v);
    const track = document.createElement("div");
    track.className = "share-track";
    const fill = document.createElement("div");
    fill.className = "share-fill";
    fill.style.width = Math.min(100, b.ratio * 100) + "%";
    fill.style.background = b.ratio > 1 ? "#e24b4a" : b.ratio >= 0.8 ? "#ba7517" : b.color;
    track.appendChild(fill);
    row.append(label, track);
    area.appendChild(row);
  });
}

// 毎月の支払い(サブスクの自動検出の結果。analysis.js の detectSubscriptions)
function renderSubscriptions() {
  const subs = detectSubscriptions();
  const ul = document.getElementById("sub-list");
  ul.innerHTML = "";

  // 続いているものの合計(1か月分と、1年に直した金額)
  const monthly = subs
    .filter(function (s) { return s.active; })
    .reduce(function (total, s) { return total + s.amount; }, 0);
  document.getElementById("sub-total").textContent =
    subs.length === 0 ? "" : "続いている支払いの合計:毎月 " + yen(monthly) + "(1年で約 " + yen(monthly * 12) + ")";

  if (subs.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.innerHTML = '<p class="empty-text">毎月の支払いは見つかりませんでした。</p>';
    ul.appendChild(li);
    return;
  }

  subs.forEach(function (s) {
    const li = document.createElement("li");
    li.className = "tx sub-item";

    const icon = document.createElement("div");
    icon.className = "tx-icon";
    icon.style.background = categoryOf(s.sample).color;
    icon.appendChild(createCategoryIcon(s.sample));

    const body = document.createElement("div");
    body.className = "tx-body";
    const name = document.createElement("div");
    name.className = "tx-name";
    name.textContent = s.name;
    const tag = document.createElement("span");
    tag.className = "custom-tag" + (s.registered ? "" : " is-warning");
    tag.textContent = s.registered ? "サブスク" : "サブスクかも";
    name.appendChild(tag);

    const sub = document.createElement("div");
    sub.className = "tx-sub";
    if (s.active) {
      // 次に払う日の目安(最後に払った日の1か月後)
      const next = addMonth(s.lastDate.slice(0, 7), 1);
      sub.textContent =
        "毎月" + s.day + "日ごろ・" + s.months + "か月続いている・次は" + Number(next.slice(5)) + "月" + s.day + "日ごろ";
    } else {
      sub.textContent = "最近は支払いなし(最後は" + Number(s.lastDate.slice(5, 7)) + "/" + Number(s.lastDate.slice(8, 10)) + ")";
    }
    body.append(name, sub);

    // 辞書でサブスクにしていないものは、その場で登録できるようにする
    if (!s.registered) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button small-button";
      button.textContent = "サブスクとして辞書に登録";
      button.addEventListener("click", function () {
        const options = { category: "サブスク", returnTo: "screen-graph" };
        if (s.shop && s.shop.custom) options.shop = s.shop;
        else if (s.shop) options.base = s.shop;
        else options.pattern = s.sample.name;
        openShopEditor(options);
      });
      body.appendChild(button);
    }

    const amount = document.createElement("div");
    amount.className = "tx-amount";
    amount.textContent = yen(s.amount) + "/月";

    li.append(icon, body, amount);
    ul.appendChild(li);
  });
}

// 月ごとの利用額(棒グラフ):表示中の月までの6か月分
// 棒は div の高さを変えて描く(楽天カードとPayPayを積み上げる)
function renderBarChart() {
  const data = monthlyTotals(recentMonths(state.month, 6));
  const max = Math.max.apply(null, data.map(function (d) { return d.total; }).concat([1]));

  const chart = document.getElementById("bar-chart");
  chart.innerHTML = "";

  data.forEach(function (d) {
    const col = document.createElement("button");
    col.type = "button";
    col.className = "bar-col" + (d.month === state.month ? " is-selected" : "");
    col.setAttribute("aria-label", monthLabel(d.month) + " " + yen(d.total));

    // 棒の上の金額
    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = d.total > 0 ? shortYen(d.total) : "";

    // 棒(上がPayPay、下が楽天カード)
    const bar = document.createElement("div");
    bar.className = "bar";
    const paypay = document.createElement("div");
    paypay.style.height = (Math.max(d.paypay, 0) / max) * 100 + "%";
    paypay.style.background = "var(--paypay)";
    const rakuten = document.createElement("div");
    rakuten.style.height = (Math.max(d.rakuten, 0) / max) * 100 + "%";
    rakuten.style.background = "var(--rakuten)";
    bar.append(paypay, rakuten);

    // 月の名前
    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = Number(d.month.slice(5)) + "月";

    col.append(value, bar, label);

    // タップするとその月に切り替える
    col.addEventListener("click", function () {
      state.month = d.month;
      render();
    });

    chart.appendChild(col);
  });
}

// この月の内訳(円グラフ):ジャンルごとの割合を、CSSの conic-gradient で描く
// ジャンルをタップすると、その中でどのお店が何%かを下に表示する
function renderPieChart() {
  document.getElementById("pie-title").textContent =
    Number(state.month.slice(5)) + "月の内訳(ジャンルごと)";

  const area = document.getElementById("pie-area");
  const detail = document.getElementById("pie-detail");
  area.innerHTML = "";
  detail.innerHTML = "";

  const data = totalsByCategory(transactionsOfMonth(state.month));
  if (data.groups.length === 0) {
    area.innerHTML = '<p class="empty-text">この月の取引はありません。</p>';
    return;
  }

  // 選んでいたジャンルがこの月にない場合は、選択を外す
  const selected = data.groups.find(function (g) { return g.name === state.pieCategory; });
  if (!selected) state.pieCategory = null;

  // 例:conic-gradient(#1d9e75 0% 32%, #7f77dd 32% 52%, ...)
  // ジャンルを選んでいるときは、ほかのジャンルを薄くして目立たせる
  let start = 0;
  const parts = data.groups.map(function (g) {
    const end = start + (g.amount / data.total) * 100;
    const color = selected && g !== selected ? g.color + "40" : g.color; // 40 = 透明度25%
    const part = color + " " + start + "% " + end + "%";
    start = end;
    return part;
  });
  const circle = document.createElement("div");
  circle.className = "pie";
  circle.style.background = "conic-gradient(" + parts.join(", ") + ")";

  // 凡例(色・ジャンル名・割合・金額)。タップでそのジャンルの中身を表示
  const legend = document.createElement("ul");
  legend.className = "pie-legend";
  data.groups.forEach(function (g) {
    const li = document.createElement("li");
    li.className = "pie-item" + (g === selected ? " is-selected" : "");
    const dot = document.createElement("span");
    dot.className = "source-dot";
    dot.style.background = g.color;
    const name = document.createElement("span");
    name.className = "pie-name";
    name.textContent = g.name;
    const value = document.createElement("span");
    value.className = "pie-value";
    value.textContent = g.percent + "%・" + yen(g.amount);
    li.append(dot, name, value);
    li.addEventListener("click", function () {
      // 同じジャンルをもう一度押したら閉じる
      state.pieCategory = state.pieCategory === g.name ? null : g.name;
      renderPieChart();
    });
    legend.appendChild(li);
  });

  area.append(circle, legend);

  if (!selected) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "ジャンルをタップすると、その中のお店の割合が見られます。";
    detail.appendChild(hint);
    return;
  }

  // 選んだジャンルの中のお店(横棒で割合を表示)
  const title = document.createElement("p");
  title.className = "pie-detail-title";
  title.textContent = "「" + selected.name + "」の中のお店(" + yen(selected.amount) + ")";
  detail.appendChild(title);

  selected.shops.forEach(function (s) {
    const row = document.createElement("div");
    row.className = "share-row";
    const label = document.createElement("div");
    label.className = "share-label";
    const n = document.createElement("span");
    n.className = "pie-name";
    n.textContent = s.name;
    const v = document.createElement("span");
    v.className = "pie-value";
    v.textContent = s.percentInGroup + "%・" + yen(s.amount);
    label.append(n, v);
    const track = document.createElement("div");
    track.className = "share-track";
    const fill = document.createElement("div");
    fill.className = "share-fill";
    fill.style.width = s.percentInGroup + "%";
    fill.style.background = selected.color;
    track.appendChild(fill);
    row.append(label, track);
    detail.appendChild(row);
  });
}

// 分析コメント(グラフ画面とホーム画面)
function renderComments() {
  const comments = analysisComments(state.month);

  const ul = document.getElementById("graph-comments");
  ul.innerHTML = "";
  comments.forEach(function (text) {
    const li = document.createElement("li");
    li.textContent = text;
    ul.appendChild(li);
  });

  // ホーム画面には一番大事な1行だけ出す
  const home = document.getElementById("home-comment");
  home.hidden = comments.length === 0;
  home.textContent = comments[0] || "";
}

// ホームの分析コメントを押したらグラフ画面へ
document.getElementById("home-comment").addEventListener("click", function () {
  showScreen("screen-graph");
});

// 月の表示(ホームと取引の両方)
function renderMonthNav() {
  document.querySelectorAll(".month-label").forEach(function (label) {
    label.textContent = monthLabel(state.month);
  });
}

// ホーム画面
function renderHome() {
  const list = transactionsOfMonth(state.month);
  document.getElementById("home-total").textContent = yen(sum(list));

  // 未確認の件数
  const unconfirmedButton = document.getElementById("home-unconfirmed");
  const unconfirmed = countUnconfirmed(list);
  unconfirmedButton.hidden = unconfirmed === 0;
  unconfirmedButton.textContent = "未確認 " + unconfirmed + "件";

  // 支払い元ごとのカード(DOMで1枚ずつ作る)
  const box = document.getElementById("home-sources");
  box.innerHTML = "";
  ["rakuten", "paypay"].forEach(function (source) {
    const items = list.filter(function (t) { return t.source === source; });

    const card = document.createElement("button");
    card.type = "button";
    card.className = "source-card";
    card.style.borderLeftColor = "var(--" + source + ")";

    const left = document.createElement("span");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = SOURCE_NAMES[source];
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = items.length + "件・未確認 " + countUnconfirmed(items) + "件";
    left.append(name, sub);

    const amount = document.createElement("span");
    amount.className = "amount";
    amount.textContent = yen(sum(items));

    card.append(left, amount);

    // タップするとその支払い元の一覧へ
    card.addEventListener("click", function () {
      setSourceFilter(source);
      showScreen("screen-list");
    });

    box.appendChild(card);
  });
}

// 取引一覧
function renderList() {
  // 検索しているときは、月に関係なく全期間から探す
  const searching = state.query !== "";
  document.getElementById("screen-list").classList.toggle("is-searching", searching);
  let list = searching ? searchTransactions(state.query) : transactionsOfMonth(state.month);
  if (state.source !== "all") {
    list = list.filter(function (t) { return t.source === state.source; });
  }
  if (state.onlyUnconfirmed) {
    list = list.filter(function (t) { return t.status === "unconfirmed"; });
  }
  document.getElementById("unconfirmed-filter").classList.toggle("is-on", state.onlyUnconfirmed);

  // 日付・時刻の新しい順に並べる
  list.sort(function (a, b) {
    const ka = a.date + (a.time || "");
    const kb = b.date + (b.time || "");
    return kb.localeCompare(ka);
  });

  visibleList = list; // まとめて確認の「すべて選ぶ」で使う
  document.getElementById("list-total").textContent =
    (searching ? "全期間から " : "") + list.length + "件・合計 " + yen(sum(list));

  const ul = document.getElementById("tx-list");
  ul.innerHTML = "";

  if (list.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    let text = "この月の取引はありません。";
    if (state.onlyUnconfirmed) text = "この月の未確認の取引はありません。";
    if (searching) text = "「" + state.query + "」に当てはまる取引はありません。";
    const p = document.createElement("p");
    p.className = "empty-text";
    p.textContent = text;
    li.appendChild(p);
    ul.appendChild(li);
    return;
  }

  list.forEach(function (t) {
    ul.appendChild(createTransactionRow(t, searching));
  });
}

// ---------- まとめて確認済みにする ----------
// サブスクのように見覚えがはっきりしている取引を、1件ずつ開かずに確認済みにする。
// 「選ぶ」を押すと一覧の行にチェック欄が出て、選んだものをまとめて確認済みにできる。

// 今の一覧に表示されている取引(月・支払い元・未確認だけ・検索の条件どおり)
let visibleList = [];

function toggleSelected(id, li) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  li.classList.toggle("is-checked", state.selected.has(id));
  renderSelectBar();
}

function setSelectMode(on) {
  state.selectMode = on;
  state.selected = new Set();
  document.getElementById("screen-list").classList.toggle("is-selecting", on);
  document.getElementById("select-toggle").textContent = on ? "やめる" : "選ぶ";
  renderList();
  renderSelectBar();
}

// 画面の下に出る「◯件を確認済みにする」の帯
function renderSelectBar() {
  const bar = document.getElementById("select-bar");
  bar.hidden = !state.selectMode;
  const n = state.selected.size;
  const button = document.getElementById("select-confirm");
  button.textContent = n > 0 ? n + "件を確認済みにする" : "取引を選んでください";
  button.disabled = n === 0;
}

document.getElementById("select-toggle").addEventListener("click", function () {
  setSelectMode(!state.selectMode);
});

// 表示中の未確認の取引をすべて選ぶ
document.getElementById("select-all").addEventListener("click", function () {
  visibleList.forEach(function (t) {
    if (t.status === "unconfirmed") state.selected.add(t.id);
  });
  renderList();
  renderSelectBar();
});

document.getElementById("select-confirm").addEventListener("click", async function () {
  const items = state.transactions.filter(function (t) { return state.selected.has(t.id); });
  if (items.length === 0) return;
  if (!window.confirm(items.length + "件の取引を確認済みにします。よろしいですか?")) return;
  try {
    items.forEach(function (t) { t.status = "confirmed"; });
    await addTransactions(items); // 同じ id で上書き保存する
    setSelectMode(false);
    render();
  } catch (error) {
    console.error(error);
    window.alert("保存できませんでした。もう一度お試しください。");
  }
});

// ---------- 検索 ----------
// 店名(辞書の名前・明細の表記)、メモ、ジャンル、金額で、全期間の取引から探す
// 「スーパー 10月」のように空白で区切ると、すべての言葉を含む取引だけに絞る

// 比べやすい形にそろえる(全角・半角、大文字・小文字の違いをなくす)
function normalizeText(text) {
  return (text || "").normalize("NFKC").toLowerCase();
}

function searchTransactions(query) {
  const words = normalizeText(query).split(/\s+/).filter(function (w) { return w !== ""; });
  return state.transactions.filter(function (t) {
    const shop = findShop(t);
    // 探す対象の文字をまとめておく
    const month = Number(t.date.slice(5, 7)) + "月";
    const target = normalizeText(
      [
        displayName(t),
        t.rawName,
        t.memo,
        shop ? shop.category : "",
        SOURCE_NAMES[t.source],
        month,
        overseasCountry(t) ? "海外 " + countryLabel(overseasCountry(t)) : "",
        installmentInfo(t) ? installmentInfo(t).label + " 分割払い" : "",
        String(Math.abs(t.amount)), // 3280
        Math.abs(t.amount).toLocaleString("ja-JP"), // 3,280
      ].join(" ")
    );
    return words.every(function (w) {
      // 金額はカンマや「円」を付けて入力しても探せるようにする
      const word = w.replace(/円$/, "");
      return target.indexOf(word) !== -1;
    });
  });
}

const searchInput = document.getElementById("search-input");

searchInput.addEventListener("input", function () {
  state.query = searchInput.value.trim();
  document.getElementById("search-clear").hidden = state.query === "";
  renderList();
});

document.getElementById("search-clear").addEventListener("click", function () {
  searchInput.value = "";
  state.query = "";
  document.getElementById("search-clear").hidden = true;
  renderList();
});

// 取引1件分の行を作る
// withYear:検索結果のように月をまたいで並べるとき、今年以外は年も付ける
function createTransactionRow(t, withYear) {
  const li = document.createElement("li");
  li.className = "tx";

  // まとめて確認するモードのときは、タップで「選ぶ/選ばない」を切り替える
  // ふだんは、タップすると詳細画面を開く
  if (state.selectMode) {
    li.classList.add("is-selectable");
    if (state.selected.has(t.id)) li.classList.add("is-checked");
    const check = document.createElement("span");
    check.className = "select-check";
    check.setAttribute("aria-hidden", "true");
    li.appendChild(check);
  }
  li.addEventListener("click", function () {
    if (state.selectMode) {
      toggleSelected(t.id, li);
    } else {
      openDetail(t.id);
    }
  });

  // 写真があれば写真、なければお店の辞書のカテゴリのアイコン
  const icon = document.createElement("div");
  icon.className = "tx-icon";
  icon.style.background = categoryOf(t).color;
  icon.appendChild(createCategoryIcon(t));
  const ids = imageIdsOf(t);
  if (ids.length > 0) {
    getImageURL(ids[0]).then(function (url) {
      if (!url) return;
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      icon.innerHTML = "";
      icon.style.background = "transparent";
      icon.appendChild(img);
      // 写真が2枚以上あるときは、枚数の印を付けて重なった見た目にする
      if (ids.length > 1) {
        icon.classList.add("has-many");
        const count = document.createElement("span");
        count.className = "photo-count";
        count.textContent = ids.length + "枚";
        icon.appendChild(count);
      }
    });
  }

  // 店名(辞書にあれば分かりやすい名前)と日付など
  const body = document.createElement("div");
  body.className = "tx-body";
  // 店名とタグを横に並べる。幅が足りないときは店名の方を「…」で省略し、タグは必ず見せる
  const name = document.createElement("div");
  name.className = "tx-name tx-name-row";
  const nameText = document.createElement("span");
  nameText.className = "tx-name-text";
  nameText.textContent = displayName(t);
  name.appendChild(nameText);
  const sub = document.createElement("div");
  sub.className = "tx-sub";
  // 支払い元の色の点(楽天カード=オレンジ、PayPay=青)
  const dot = document.createElement("span");
  dot.className = "source-dot";
  dot.style.background = "var(--" + t.source + ")";
  let md = Number(t.date.slice(5, 7)) + "/" + Number(t.date.slice(8, 10));
  if (withYear && Number(t.date.slice(0, 4)) !== new Date().getFullYear()) {
    md = t.date.slice(0, 4) + "/" + md;
  }
  // メモがあればメモ、なければ支払い元を表示する
  // 分割払いは「この日に買った」と分かるように「購入」と付ける
  const bought = installmentInfo(t) ? "購入 " : "";
  sub.append(dot, bought + md + (t.time ? " " + t.time : "") + "・" + (t.memo || SOURCE_NAMES[t.source]));
  if (t.status === "unconfirmed") {
    const mark = document.createElement("span");
    mark.className = "unconfirmed";
    mark.textContent = "・未確認";
    sub.appendChild(mark);
  }
  // 分割払い・リボ払いの取引には印を付ける
  const installment = installmentInfo(t);
  if (installment) {
    const tag = document.createElement("span");
    tag.className = "installment-tag";
    tag.textContent = installment.label;
    name.appendChild(tag);
  }

  // 海外で使った取引には「海外」の印を付ける(見覚えのない海外利用は不正利用のよくある例)
  const country = overseasCountry(t);
  if (country) {
    const tag = document.createElement("span");
    tag.className = "overseas-tag";
    tag.textContent = "海外 " + country;
    name.appendChild(tag);
  }
  body.append(name, sub);

  // 金額(返品・返金はマイナスで色を変える)
  const amount = document.createElement("div");
  amount.className = "tx-amount" + (t.amount < 0 ? " minus" : "");
  amount.textContent = yen(t.amount);

  li.append(icon, body, amount);
  return li;
}

// 取引タブの未確認の件数
function renderTabBadge() {
  const badge = document.getElementById("tab-badge");
  const n = countUnconfirmed(state.transactions);
  badge.hidden = n === 0;
  badge.textContent = n > 99 ? "99+" : String(n);
}

// ---------- 月の切り替え ----------

document.querySelectorAll(".month-prev").forEach(function (button) {
  button.addEventListener("click", function () {
    state.month = addMonth(state.month, -1);
    render();
  });
});

document.querySelectorAll(".month-next").forEach(function (button) {
  button.addEventListener("click", function () {
    state.month = addMonth(state.month, 1);
    render();
  });
});

// ホームの「未確認 ◯件」を押したら、未確認だけの一覧へ
document.getElementById("home-unconfirmed").addEventListener("click", function () {
  state.onlyUnconfirmed = true;
  setSourceFilter("all");
  showScreen("screen-list");
});

// 一覧の「未確認だけ表示」を押すたびに切り替える
document.getElementById("unconfirmed-filter").addEventListener("click", function () {
  state.onlyUnconfirmed = !state.onlyUnconfirmed;
  renderList();
});

// ---------- 支払い元の切り替え(一覧画面) ----------

function setSourceFilter(source) {
  state.source = source;
  document.querySelectorAll("#source-filter button").forEach(function (button) {
    button.classList.toggle("is-selected", button.dataset.source === source);
  });
  renderList();
}

document.querySelectorAll("#source-filter button").forEach(function (button) {
  button.addEventListener("click", function () {
    setSourceFilter(button.dataset.source);
  });
});

// ---------- 明細CSVの読み込み ----------

const importInput = document.getElementById("import-input");

// 見た目のボタンを押したら、隠してあるファイル選択欄を開く
document.getElementById("import-button").addEventListener("click", function () {
  importInput.click();
});

importInput.addEventListener("change", async function () {
  const files = Array.from(importInput.files);
  if (files.length === 0) return;

  // ファイル名順に読む(楽天の月別ファイルを古い順に処理するため)
  files.sort(function (a, b) { return a.name.localeCompare(b.name); });

  const messages = [];
  let hasError = false;

  for (const file of files) {
    try {
      const result = await importFile(file);
      messages.push(result);
    } catch (error) {
      console.error(error);
      hasError = true;
      messages.push(file.name + ":" + error.message);
    }
  }

  // 先に記録した買い物に、明細の候補が見つかったら知らせる(pending.js)
  const found = countPendingWithCandidates();
  if (found > 0) {
    messages.push("先に記録した買い物のうち" + found + "件に、明細の候補が見つかりました。下の「明細待ちの記録」から確認できます。");
  }

  // 読み込んだら、一番新しい月を表示する
  state.month = latestMonth();
  render();
  showImportResult(messages.join("\n"), hasError);

  // 同じファイルをもう一度選んでも反応するように、選択を空にする
  importInput.value = "";
});

// 1ファイル分を読み込んで保存し、結果の文章を返す
async function importFile(file) {
  const text = await file.text(); // UTF-8として読む(2社ともUTF-8)
  const rows = parseCSV(text);
  if (rows.length === 0) {
    throw new Error("ファイルが空です");
  }

  const source = detectSource(rows[0]);
  if (!source) {
    throw new Error("このファイルは読み込めません(楽天カード・PayPayのCSVではないようです)");
  }

  const normalized = source === "rakuten" ? normalizeRakuten(rows) : normalizePayPay(rows);
  const newItems = pickNewItems(state.transactions, normalized.items);

  await addTransactions(newItems);
  state.transactions = state.transactions.concat(newItems);

  // 結果の文章を作る
  // 例)「楽天カード 5月:11件追加」
  //     「PayPay 5月:16件、6月:15件 を追加」
  const addedByMonth = countByMonth(newItems);
  const months = Object.keys(addedByMonth).sort();

  let message = SOURCE_NAMES[source] + " ";
  if (months.length === 0) {
    message += "追加なし";
  } else if (months.length === 1) {
    message += shortMonth(months[0]) + ":" + addedByMonth[months[0]] + "件追加";
  } else {
    message += months
      .map(function (m) { return shortMonth(m) + ":" + addedByMonth[m] + "件"; })
      .join("、") + " を追加";
  }

  const notes = [];
  const already = normalized.items.length - newItems.length;
  if (already > 0) notes.push(already + "件は登録済み");
  if (normalized.charges > 0) notes.push("チャージ" + normalized.charges + "件は対象外");
  if (normalized.skipped > 0) notes.push(normalized.skipped + "行は読めませんでした");
  if (notes.length > 0) message += "(" + notes.join("、") + ")";

  return message;
}

// 取引を月ごとに数える { "2026-05": 11, "2026-06": 12 }
function countByMonth(list) {
  const result = {};
  list.forEach(function (t) {
    const m = t.date.slice(0, 7);
    result[m] = (result[m] || 0) + 1;
  });
  return result;
}

// "2026-05" → "5月"(今年以外は "2025年12月" のように年も付ける)
function shortMonth(month) {
  const parts = month.split("-").map(Number);
  if (parts[0] !== new Date().getFullYear()) return parts[0] + "年" + parts[1] + "月";
  return parts[1] + "月";
}

function showImportResult(text, isError) {
  const box = document.getElementById("import-result");
  box.hidden = false;
  box.textContent = text;
  box.classList.toggle("is-error", isError);
}

// ---------- 取引の詳細画面 ----------

// 詳細画面を開く
function openDetail(id) {
  state.detailId = id;
  state.photoIndex = 0; // 1枚目の写真から表示する
  hideDetailMessage();
  renderDetail();
  showScreen("screen-detail");
}

// 詳細画面の中身を描く
async function renderDetail() {
  const t = findTransaction(state.detailId);
  if (!t) return;

  // 写真(なければ仮のアイコン)
  // 複数枚あるときは横に並べ、指で横にスワイプして切り替える
  const photo = document.getElementById("detail-photo");
  photo.innerHTML = "";
  photo.className = "detail-photo";
  const ids = imageIdsOf(t);
  if (state.photoIndex >= ids.length) state.photoIndex = Math.max(0, ids.length - 1);

  if (ids.length > 0) {
    const track = document.createElement("div");
    track.className = "photo-track";
    for (const id of ids) {
      const url = await getImageURL(id);
      const slide = document.createElement("div");
      slide.className = "photo-slide";
      if (url) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = t.name + "の写真";
        // タップすると拡大表示(viewer.js)
        img.addEventListener("click", function () {
          openViewer(url);
        });
        slide.appendChild(img);
      }
      track.appendChild(slide);
    }
    photo.appendChild(track);

    const zoomHint = document.createElement("span");
    zoomHint.className = "zoom-hint";
    zoomHint.textContent = "タップで拡大";
    photo.appendChild(zoomHint);

    // 2枚以上:「1/3」の表示と、下の点(今何枚目か)
    if (ids.length > 1) {
      const counter = document.createElement("span");
      counter.className = "photo-counter";
      const dots = document.createElement("div");
      dots.className = "photo-dots";
      ids.forEach(function () {
        dots.appendChild(document.createElement("span"));
      });
      photo.append(counter, dots);

      const updateIndicator = function () {
        counter.textContent = state.photoIndex + 1 + "/" + ids.length + "枚";
        Array.from(dots.children).forEach(function (dot, i) {
          dot.classList.toggle("is-current", i === state.photoIndex);
        });
      };
      // スワイプして止まった位置から、何枚目かを求める
      track.addEventListener("scroll", function () {
        const index = Math.round(track.scrollLeft / track.clientWidth);
        if (index !== state.photoIndex) {
          state.photoIndex = index;
          updateIndicator();
        }
      });
      updateIndicator();
      // 前に見ていた写真の位置に戻す(写真を追加・削除したあとなど)
      requestAnimationFrame(function () {
        track.scrollLeft = state.photoIndex * track.clientWidth;
      });
    }
  } else {
    // 写真がないときは、カテゴリの色とアイコンを大きく表示する
    photo.classList.add("is-empty");
    photo.style.background = categoryOf(t).color;
    const hint = document.createElement("span");
    hint.className = "photo-hint";
    hint.textContent = "写真はまだありません";
    photo.append(createCategoryIcon(t), hint);
  }
  if (ids.length > 0) photo.style.background = "";
  const deleteButton = document.getElementById("photo-delete");
  deleteButton.hidden = ids.length === 0;
  deleteButton.textContent = ids.length > 1 ? "表示中の写真を削除" : "写真を削除";
  document.getElementById("photo-pick").textContent = ids.length > 0 ? "写真を追加" : "写真を選ぶ";

  // 店名(辞書の名前)・明細の元の表記・金額
  const shop = findShop(t);
  const name = displayName(t);
  document.getElementById("detail-name").textContent = name;
  const raw = document.getElementById("detail-raw");
  raw.textContent = "明細の表記:" + t.rawName;
  raw.hidden = t.rawName === name;
  const amount = document.getElementById("detail-amount");
  amount.textContent = yen(t.amount);
  amount.classList.toggle("minus", t.amount < 0);

  // 日時・支払い元・支払い方法
  const parts = t.date.split("-").map(Number);
  const rows = [
    ["買った日時", parts[0] + "年" + parts[1] + "月" + parts[2] + "日" + (t.time ? " " + t.time : "")],
    ["支払い元", SOURCE_NAMES[t.source]],
    ["支払い方法", t.method || "-"],
    // 海外で使ったときは利用国も出す
    ["利用した国", overseasCountry(t) ? countryLabel(overseasCountry(t)) + "・海外での利用" : "日本"],
    // お店の辞書に当てはまったときは、カテゴリと説明も出す
    ["カテゴリ", shop ? shop.category : "辞書に登録なし"],
  ];
  if (shop && shop.description) rows.push(["説明", shop.description]);

  // 分割払い:どの月にいくら払うかの目安
  const installment = installmentInfo(t);
  if (installment && installment.revolving) {
    rows.push(["支払い", "リボ払い。毎月の支払額は、カード会社で決めた設定によって変わります。"]);
  } else if (installment) {
    // 月ごとの内訳を1行ずつ並べる(例:2026年8月 19,934円)
    const list = document.createElement("ul");
    list.className = "installment-list";
    let month = installment.startMonth;
    for (let i = 0; i < installment.count; i++) {
      const li = document.createElement("li");
      const m = document.createElement("span");
      m.textContent = Number(month.slice(0, 4)) + "年" + Number(month.slice(5)) + "月";
      const v = document.createElement("span");
      v.textContent = yen(i === 0 ? installment.first : installment.each);
      li.append(m, v);
      list.appendChild(li);
      month = addMonth(month, 1);
    }
    const note = document.createElement("p");
    note.className = "installment-note";
    note.textContent = installment.count + "回に分けて支払い。金額は目安です(実際の金額はカード会社の明細で確認してください)。";
    const box = document.createElement("div");
    box.append(list, note);
    rows.push(["支払い", box]);
  }

  // 分割払いのときは、上の金額が「買い物の総額」だと分かるように一言出す
  const amountNote = document.getElementById("detail-amount-note");
  if (installment && !installment.revolving) {
    amountNote.textContent =
      parts[1] + "/" + parts[2] + "の買い物の総額。" + Number(installment.startMonth.slice(5)) + "月から" + installment.count + "回に分けて支払います。";
    amountNote.hidden = false;
  } else if (installment) {
    amountNote.textContent = parts[1] + "/" + parts[2] + "の買い物の総額。リボ払いで少しずつ支払います。";
    amountNote.hidden = false;
  } else {
    amountNote.hidden = true;
  }

  // お店の辞書のボタンの文字(登録の状態によって変える)
  document.getElementById("detail-shop-edit").textContent =
    shop && shop.custom ? "辞書の登録を編集" : shop ? "辞書の内容を変更" : "このお店を辞書に登録";
  const info = document.getElementById("detail-info");
  info.innerHTML = "";
  rows.forEach(function (row) {
    const dt = document.createElement("dt");
    dt.textContent = row[0];
    const dd = document.createElement("dd");
    // 文字だけでなく、内訳のリストなどの部品も入れられるようにする
    if (row[1] instanceof Node) dd.appendChild(row[1]);
    else dd.textContent = row[1];
    info.append(dt, dd);
  });

  // 確認の状態とボタン
  const confirmed = t.status === "confirmed";
  const status = document.getElementById("detail-status");
  status.textContent = confirmed ? "確認済み" : "未確認";
  status.classList.toggle("is-unconfirmed", !confirmed);
  document.getElementById("detail-confirm").textContent = confirmed ? "未確認に戻す" : "確認済みにする";

  // メモ
  document.getElementById("detail-memo").value = t.memo || "";
}

// 取引を保存して、画面をすべて描き直す
async function saveTransaction(t, message) {
  try {
    await updateTransaction(t);
    render();
    await renderDetail();
    showDetailMessage(message, false);
  } catch (error) {
    console.error(error);
    showDetailMessage("保存できませんでした。もう一度お試しください。", true);
  }
}

function showDetailMessage(text, isError) {
  const box = document.getElementById("detail-message");
  box.hidden = false;
  box.textContent = text;
  box.classList.toggle("is-error", isError);
}

function hideDetailMessage() {
  document.getElementById("detail-message").hidden = true;
}

// 戻るボタン
document.getElementById("detail-back").addEventListener("click", function () {
  showScreen("screen-list");
});

// 「確認済みにする」/「未確認に戻す」
document.getElementById("detail-confirm").addEventListener("click", function () {
  const t = findTransaction(state.detailId);
  if (!t) return;
  t.status = t.status === "confirmed" ? "unconfirmed" : "confirmed";
  saveTransaction(t, t.status === "confirmed" ? "確認済みにしました。" : "未確認に戻しました。");
});

// メモを保存(メモを書いたら確認済みにする)
document.getElementById("memo-save").addEventListener("click", function () {
  const t = findTransaction(state.detailId);
  if (!t) return;
  t.memo = document.getElementById("detail-memo").value.trim();
  let message = "メモを保存しました。";
  if (t.memo !== "" && t.status === "unconfirmed") {
    t.status = "confirmed";
    message = "メモを保存し、確認済みにしました。";
  }
  saveTransaction(t, message);
});

// 写真を選ぶ / カメラで撮る(隠してある選択欄を呼び出す)
document.getElementById("photo-pick").addEventListener("click", function () {
  document.getElementById("photo-input").click();
});
document.getElementById("photo-camera").addEventListener("click", function () {
  document.getElementById("camera-input").click();
});

// 写真が選ばれたら、縮小して保存する(写真を付けたら確認済みにする)
// 写真フォルダからは何枚かまとめて選べる。今ある写真の後ろに追加する
async function handlePhoto(input) {
  const files = Array.from(input.files);
  input.value = ""; // 同じ写真をもう一度選んでも反応するように空にする
  const t = findTransaction(state.detailId);
  if (files.length === 0 || !t) return;

  const ids = imageIdsOf(t).slice();
  const room = MAX_PHOTOS - ids.length;
  if (room <= 0) {
    showDetailMessage("写真は1件の取引に" + MAX_PHOTOS + "枚まで付けられます。", true);
    return;
  }

  showDetailMessage("写真を保存しています…", false);
  try {
    const targets = files.slice(0, room);
    for (let i = 0; i < targets.length; i++) {
      const blob = await resizeImage(targets[i]);
      // 写真の id:取引の id + 追加した時刻(取引ごとに何枚でも区別できるように)
      const imageId = t.id + "#p" + Date.now() + "-" + i;
      await putImage(imageId, blob);
      ids.push(imageId);
    }
    setImageIds(t, ids);
    state.photoIndex = ids.length - 1; // 追加した写真を表示する

    let message = targets.length + "枚の写真を保存しました。";
    if (files.length > targets.length) {
      message += "(" + MAX_PHOTOS + "枚までのため、" + (files.length - targets.length) + "枚は追加していません)";
    }
    if (t.status === "unconfirmed") {
      t.status = "confirmed";
      message += "確認済みにしました。";
    }
    await saveTransaction(t, message);
  } catch (error) {
    console.error(error);
    showDetailMessage(error.message || "写真を保存できませんでした。", true);
  }
}

document.getElementById("photo-input").addEventListener("change", function () {
  handlePhoto(this);
});
document.getElementById("camera-input").addEventListener("change", function () {
  handlePhoto(this);
});

// 表示中の写真を削除(確認の状態はそのまま)
document.getElementById("photo-delete").addEventListener("click", async function () {
  const t = findTransaction(state.detailId);
  if (!t) return;
  const ids = imageIdsOf(t).slice();
  if (ids.length === 0) return;
  const index = Math.min(state.photoIndex, ids.length - 1);
  const question = ids.length > 1 ? index + 1 + "枚目の写真を削除しますか?" : "この取引の写真を削除しますか?";
  if (!window.confirm(question)) return;
  try {
    const removed = ids.splice(index, 1)[0];
    await deleteImage(removed);
    forgetImageURL(removed);
    setImageIds(t, ids);
    state.photoIndex = Math.max(0, index - 1);
    await saveTransaction(t, "写真を削除しました。");
  } catch (error) {
    console.error(error);
    showDetailMessage("写真を削除できませんでした。", true);
  }
});

// ---------- お店の辞書の一覧(設定画面から開く) ----------

function renderShopList() {
  document.getElementById("shops-count").textContent = shopList.length + "件 ›";

  const ul = document.getElementById("shop-list");
  ul.innerHTML = "";
  shopList.forEach(function (shop) {
    const li = document.createElement("li");
    li.className = "tx shop-item";

    // アイコンは、辞書の店名を使った仮の取引で作る
    const sample = { name: shop.patterns[0].normalize("NFKC") };
    const icon = document.createElement("div");
    icon.className = "tx-icon";
    icon.style.background = categoryOf(sample).color;
    icon.appendChild(createCategoryIcon(sample));

    const body = document.createElement("div");
    body.className = "tx-body";
    const name = document.createElement("div");
    name.className = "tx-name";
    name.textContent = shop.name;
    // 自分で登録したお店には印を付ける
    if (shop.custom) {
      const tag = document.createElement("span");
      tag.className = "custom-tag";
      tag.textContent = "自分で登録";
      name.appendChild(tag);
    }
    const sub = document.createElement("div");
    sub.className = "tx-sub";
    sub.textContent = shop.category + "・明細の表記に「" + shop.patterns.join("」「") + "」を含む";
    const desc = document.createElement("div");
    desc.className = "tx-sub";
    desc.textContent = shop.description || "";
    body.append(name, sub, desc);

    li.append(icon, body);

    // タップで編集(最初から入っているお店は、自分用の登録を作る)
    li.addEventListener("click", function () {
      if (shop.custom) openShopEditor({ shop: shop, returnTo: "screen-shops" });
      else openShopEditor({ base: shop, returnTo: "screen-shops" });
    });
    ul.appendChild(li);
  });
}

document.getElementById("open-shops").addEventListener("click", function () {
  renderShopList();
  showScreen("screen-shops");
});

document.getElementById("shops-back").addEventListener("click", function () {
  showScreen("screen-settings");
});

// ---------- デモデータを読み込む(発表・お試し用) ----------
// demo フォルダの架空の明細CSVを取ってきて、ふつうの読み込みと同じ処理で読み込む

const DEMO_FILES = [
  "paypay_2026-05_2026-10.csv",
  "rakuten_2026-06.csv",
  "rakuten_2026-07.csv",
  "rakuten_2026-08.csv",
  "rakuten_2026-09.csv",
  "rakuten_2026-10.csv",
  "rakuten_2026-11.csv",
];

document.getElementById("demo-load").addEventListener("click", async function () {
  const ok = window.confirm(
    "架空のデモ用の明細を読み込みます。すでに読み込んである取引は重複しません。よろしいですか?"
  );
  if (!ok) return;

  const messages = [];
  let hasError = false;
  for (const name of DEMO_FILES) {
    try {
      const response = await fetch("demo/" + name + "?v=" + APP_VERSION, { cache: "no-store" });
      if (!response.ok) throw new Error("ファイルを取得できませんでした");
      const file = new File([await response.text()], name, { type: "text/csv" });
      messages.push(await importFile(file));
    } catch (error) {
      console.error(error);
      hasError = true;
      messages.push(name + ":" + error.message);
    }
  }

  state.month = latestMonth();
  render();
  showImportResult("デモデータ\n" + messages.join("\n"), hasError);
  showScreen("screen-home");
});

// ---------- すべてのデータを削除 ----------

document.getElementById("clear-button").addEventListener("click", async function () {
  const ok = window.confirm("読み込んだ明細・写真・メモ、自分で辞書に登録したお店、先に記録した買い物をすべて削除します。元に戻せません。本当に削除しますか?");
  if (!ok) return;

  try {
    await clearTransactions();
    Array.from(imageURLs.keys()).forEach(forgetImageURL);
    forgetCustomShops(); // 自分で登録したお店も消えたので、辞書を作り直す
    renderShopList();
    pendingItems = []; // 先に記録した買い物も消えた
    state.transactions = [];
    state.month = currentMonth();
    document.getElementById("import-result").hidden = true;
    render();
    window.alert("すべてのデータを削除しました。");
  } catch (error) {
    console.error(error);
    window.alert("削除できませんでした。もう一度お試しください。");
  }
});

// ---------- 画面のモード(ライト/ダーク/自動) ----------

const THEME_KEY = "meisai-theme";

function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "auto";
  } catch (error) {
    console.warn("画面のモードを読み込めませんでした", error);
    return "auto";
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    console.warn("画面のモードを保存できませんでした", error);
  }
}

function applyTheme(theme) {
  if (theme === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  document.querySelectorAll("#theme-switch button").forEach(function (button) {
    button.classList.toggle("is-selected", button.dataset.theme === theme);
  });
}

document.querySelectorAll("#theme-switch button").forEach(function (button) {
  button.addEventListener("click", function () {
    applyTheme(button.dataset.theme);
    saveTheme(button.dataset.theme);
  });
});

// ---------- アプリを開いたときの処理 ----------

async function init() {
  applyTheme(loadTheme());
  applyTextSize(loadTextSize()); // 文字の大きさ(settings.js)
  applySourceSettings(); // 支払い元の名前と色(settings.js)
  showGuideIfNeeded(); // Safariで開いたときは、ホーム画面に追加する方法を案内する
  requestPersistentStorage();

  // 設定画面に今の版を表示する(更新が反映されたかの確認用)
  document.getElementById("app-version").textContent = "バージョン " + APP_VERSION;

  await loadShops(); // お店の辞書を読み込む
  await loadPending(); // 先に記録した買い物を読み込む(pending.js)
  renderShopList();

  try {
    state.transactions = await getAllTransactions();
  } catch (error) {
    console.error(error);
    showImportResult("保存したデータを読み込めませんでした。", true);
  }

  state.month = latestMonth();
  render();
}

init();
