// =========================================================
// settings.js  設定画面の仕上げ
//  ・支払い元(楽天カード・PayPay)の表示名と色を変える
//  ・カード情報の確認・変更のため、公式ページを開く
//    (カード番号などはこのアプリでは扱わない。仕様書「今回やらない機能」)
//  ・ホーム画面に追加する方法の案内(Safariで開いたときだけ自動で出す)
//  ・このアプリについて
// =========================================================

const SOURCE_KEY = "meisai-sources"; // 支払い元の設定を保存するときの名前

// 最初の表示名と色
const DEFAULT_SOURCES = {
  rakuten: { name: "楽天カード", color: "#d85a30" },
  paypay: { name: "PayPay", color: "#378add" },
};

// 選べる色
const SOURCE_COLORS = ["#d85a30", "#378add", "#1d9e75", "#d4537e", "#7f77dd", "#ba7517"];

// 公式ページ(カード情報の確認・変更はこちらで行う)
const OFFICIAL_PAGES = {
  rakuten: { label: "楽天e-NAVI(会員ページ)を開く", url: "https://www.rakuten-card.co.jp/e-navi/" },
  paypay: { label: "PayPayの公式サイトを開く", url: "https://paypay.ne.jp/" },
};

let sourceSettings = loadSourceSettings();
let editingSource = null; // 設定画面で編集中の支払い元
let editingColor = null;

// 保存されている設定を読む(読めなければ最初の設定)
function loadSourceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SOURCE_KEY) || "{}");
    return {
      rakuten: Object.assign({}, DEFAULT_SOURCES.rakuten, saved.rakuten),
      paypay: Object.assign({}, DEFAULT_SOURCES.paypay, saved.paypay),
    };
  } catch (error) {
    console.warn("支払い元の設定を読み込めませんでした", error);
    return JSON.parse(JSON.stringify(DEFAULT_SOURCES));
  }
}

function saveSourceSettings() {
  try {
    localStorage.setItem(SOURCE_KEY, JSON.stringify(sourceSettings));
    return true;
  } catch (error) {
    console.warn("支払い元の設定を保存できませんでした", error);
    return false;
  }
}

// 設定を画面全体に反映する
//  ・名前:SOURCE_NAMES(app.js)と、画面の中の .source-name
//  ・色:CSS変数 --rakuten / --paypay を書き換える(色を使っている所がすべて変わる)
function applySourceSettings() {
  ["rakuten", "paypay"].forEach(function (source) {
    const s = sourceSettings[source];
    SOURCE_NAMES[source] = s.name;
    document.documentElement.style.setProperty("--" + source, s.color);
    document.querySelectorAll('.source-name[data-source="' + source + '"]').forEach(function (el) {
      el.textContent = s.name;
    });
  });
  // 支払い元の切り替えボタン(取引一覧)の名前も変える
  document.querySelectorAll("#source-filter button").forEach(function (button) {
    if (SOURCE_NAMES[button.dataset.source]) button.textContent = SOURCE_NAMES[button.dataset.source];
  });
}

// ---------- 支払い元の設定画面 ----------

function openSourceEditor(source) {
  editingSource = source;
  editingColor = sourceSettings[source].color;

  document.getElementById("source-title").textContent = DEFAULT_SOURCES[source].name + "の設定";
  document.getElementById("source-name-input").value = sourceSettings[source].name;
  document.getElementById("source-message").hidden = true;

  // 公式ページのボタン
  const link = document.getElementById("source-official");
  link.href = OFFICIAL_PAGES[source].url;
  document.getElementById("source-official-label").textContent = OFFICIAL_PAGES[source].label;

  renderSwatches();
  showScreen("screen-source");
}

// 色の選択肢を並べる
function renderSwatches() {
  const box = document.getElementById("source-swatches");
  box.innerHTML = "";
  SOURCE_COLORS.forEach(function (color) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch" + (color === editingColor ? " is-selected" : "");
    button.style.background = color;
    button.setAttribute("aria-label", "色 " + color);
    button.addEventListener("click", function () {
      editingColor = color;
      renderSwatches();
    });
    box.appendChild(button);
  });
}

document.querySelectorAll("[data-edit-source]").forEach(function (button) {
  button.addEventListener("click", function () {
    openSourceEditor(button.dataset.editSource);
  });
});

document.getElementById("source-back").addEventListener("click", function () {
  showScreen("screen-settings");
});

document.getElementById("source-save").addEventListener("click", function () {
  const message = document.getElementById("source-message");
  const name = document.getElementById("source-name-input").value.trim();
  message.hidden = false;

  if (name === "") {
    message.textContent = "表示名を入力してください。";
    message.classList.add("is-error");
    return;
  }

  sourceSettings[editingSource] = { name: name, color: editingColor };
  const saved = saveSourceSettings();
  applySourceSettings();
  render(); // ホーム・一覧・グラフを新しい名前と色で描き直す

  message.classList.toggle("is-error", !saved);
  message.textContent = saved ? "保存しました。" : "この画面では反映しましたが、保存できませんでした。";
});

// ---------- ホーム画面に追加する方法の案内 ----------

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

function openGuide() {
  document.getElementById("guide").hidden = false;
}

document.getElementById("guide-close").addEventListener("click", function () {
  document.getElementById("guide").hidden = true;
});

document.getElementById("open-guide").addEventListener("click", openGuide);

// Safariで普通に開いたときだけ自動で表示する(ホーム画面から開いたときは出さない)
function showGuideIfNeeded() {
  if (!isStandalone()) openGuide();
}

// ---------- このアプリについて ----------

document.getElementById("open-about").addEventListener("click", function () {
  showScreen("screen-about");
});

document.getElementById("about-back").addEventListener("click", function () {
  showScreen("screen-settings");
});
