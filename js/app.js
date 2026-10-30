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
  // 詳細画面は「取引」タブの中の画面として扱う
  const activeTab = screenId === "screen-detail" ? "screen-list" : screenId;
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
  renderTabBadge();
}

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
  let list = transactionsOfMonth(state.month);
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

  document.getElementById("list-total").textContent =
    list.length + "件・合計 " + yen(sum(list));

  const ul = document.getElementById("tx-list");
  ul.innerHTML = "";

  if (list.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.innerHTML = state.onlyUnconfirmed
      ? '<p class="empty-text">この月の未確認の取引はありません。</p>'
      : '<p class="empty-text">この月の取引はありません。</p>';
    ul.appendChild(li);
    return;
  }

  list.forEach(function (t) {
    ul.appendChild(createTransactionRow(t));
  });
}

// 取引1件分の行を作る
function createTransactionRow(t) {
  const li = document.createElement("li");
  li.className = "tx";

  // タップすると詳細画面を開く
  li.addEventListener("click", function () {
    openDetail(t.id);
  });

  // 写真があれば写真、なければ仮のアイコン(店名の1文字目)
  const icon = document.createElement("div");
  icon.className = "tx-icon " + t.source;
  icon.textContent = t.name.charAt(0);
  if (t.hasImage) {
    getImageURL(t.id).then(function (url) {
      if (!url) return;
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      icon.textContent = "";
      icon.appendChild(img);
    });
  }

  // 店名と日付など
  const body = document.createElement("div");
  body.className = "tx-body";
  const name = document.createElement("div");
  name.className = "tx-name";
  name.textContent = t.name;
  const sub = document.createElement("div");
  sub.className = "tx-sub";
  const md = Number(t.date.slice(5, 7)) + "/" + Number(t.date.slice(8, 10));
  // メモがあればメモ、なければ支払い元を表示する
  sub.textContent = md + (t.time ? " " + t.time : "") + "・" + (t.memo || SOURCE_NAMES[t.source]);
  if (t.status === "unconfirmed") {
    const mark = document.createElement("span");
    mark.className = "unconfirmed";
    mark.textContent = "・未確認";
    sub.appendChild(mark);
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
  hideDetailMessage();
  renderDetail();
  showScreen("screen-detail");
}

// 詳細画面の中身を描く
async function renderDetail() {
  const t = findTransaction(state.detailId);
  if (!t) return;

  // 写真(なければ仮のアイコン)
  const photo = document.getElementById("detail-photo");
  photo.innerHTML = "";
  photo.className = "detail-photo";
  if (t.hasImage) {
    const url = await getImageURL(t.id);
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = t.name + "の写真";
      photo.appendChild(img);
    }
  } else {
    photo.classList.add("is-empty", t.source);
    const letter = document.createElement("span");
    letter.textContent = t.name.charAt(0);
    const hint = document.createElement("span");
    hint.className = "photo-hint";
    hint.textContent = "写真はまだありません";
    photo.append(letter, hint);
  }
  document.getElementById("photo-delete").hidden = !t.hasImage;

  // 店名・明細の元の表記・金額
  document.getElementById("detail-name").textContent = t.name;
  const raw = document.getElementById("detail-raw");
  raw.textContent = "明細の表記:" + t.rawName;
  raw.hidden = t.rawName === t.name;
  const amount = document.getElementById("detail-amount");
  amount.textContent = yen(t.amount);
  amount.classList.toggle("minus", t.amount < 0);

  // 日時・支払い元・支払い方法
  const parts = t.date.split("-").map(Number);
  const rows = [
    ["日時", parts[0] + "年" + parts[1] + "月" + parts[2] + "日" + (t.time ? " " + t.time : "")],
    ["支払い元", SOURCE_NAMES[t.source]],
    ["支払い方法", t.method || "-"],
  ];
  const info = document.getElementById("detail-info");
  info.innerHTML = "";
  rows.forEach(function (row) {
    const dt = document.createElement("dt");
    dt.textContent = row[0];
    const dd = document.createElement("dd");
    dd.textContent = row[1];
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
async function handlePhoto(input) {
  const file = input.files[0];
  input.value = ""; // 同じ写真をもう一度選んでも反応するように空にする
  const t = findTransaction(state.detailId);
  if (!file || !t) return;

  showDetailMessage("写真を保存しています…", false);
  try {
    const blob = await resizeImage(file);
    await putImage(t.id, blob);
    forgetImageURL(t.id); // 前の写真の表示用URLを片付ける
    t.hasImage = true;
    let message = "写真を保存しました。";
    if (t.status === "unconfirmed") {
      t.status = "confirmed";
      message = "写真を保存し、確認済みにしました。";
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

// 写真を削除(確認の状態はそのまま)
document.getElementById("photo-delete").addEventListener("click", async function () {
  const t = findTransaction(state.detailId);
  if (!t) return;
  if (!window.confirm("この取引の写真を削除しますか?")) return;
  try {
    await deleteImage(t.id);
    forgetImageURL(t.id);
    t.hasImage = false;
    await saveTransaction(t, "写真を削除しました。");
  } catch (error) {
    console.error(error);
    showDetailMessage("写真を削除できませんでした。", true);
  }
});

// ---------- すべてのデータを削除 ----------

document.getElementById("clear-button").addEventListener("click", async function () {
  const ok = window.confirm("読み込んだ明細をすべて削除します。元に戻せません。本当に削除しますか?");
  if (!ok) return;

  try {
    await clearTransactions();
    Array.from(imageURLs.keys()).forEach(forgetImageURL);
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
  requestPersistentStorage();

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
