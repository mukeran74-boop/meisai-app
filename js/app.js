// =========================================================
// 明細メモ  メインのプログラム
// 今の段階でできること
//  ・下のタブで4つの画面を切り替える
//  ・設定画面でライト/ダーク/自動を切り替え、次に開いたときも覚えておく
// =========================================================

// ---------- 下のタブで画面を切り替える ----------

// 下のタブのボタンをすべて取り出す
const tabs = document.querySelectorAll(".tab");

tabs.forEach(function (tab) {
  // ボタンが押されたときの処理を登録する
  tab.addEventListener("click", function () {
    const targetId = tab.dataset.target; // 例: "screen-list"
    showScreen(targetId);
  });
});

// 指定された画面だけを表示し、ほかの画面は隠す
function showScreen(screenId) {
  // すべての画面から「表示中」の印を外す
  document.querySelectorAll(".screen").forEach(function (screen) {
    screen.classList.remove("is-active");
  });
  // 選ばれた画面に「表示中」の印を付ける
  document.getElementById(screenId).classList.add("is-active");

  // タブの見た目も、選ばれたものだけ色を変える
  tabs.forEach(function (tab) {
    tab.classList.toggle("is-active", tab.dataset.target === screenId);
  });

  // 画面を切り替えたら一番上から表示する
  window.scrollTo(0, 0);
}

// ---------- 画面のモード(ライト/ダーク/自動) ----------

const THEME_KEY = "meisai-theme"; // 保存するときの名前

// 保存されている設定を読み出す(読めなければ「自動」にする)
function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "auto";
  } catch (error) {
    // プライベートブラウズなどで保存領域が使えない場合
    console.warn("画面のモードを読み込めませんでした", error);
    return "auto";
  }
}

// 設定を保存する
function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    console.warn("画面のモードを保存できませんでした", error);
  }
}

// 画面に反映する
//  ・"light" / "dark" … <html data-theme="..."> を付けて色を固定する
//  ・"auto"           … 印を外して、iPhoneの設定に任せる
function applyTheme(theme) {
  if (theme === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }

  // 設定画面のボタンの見た目を、選ばれたものだけ強調する
  document.querySelectorAll("#theme-switch button").forEach(function (button) {
    button.classList.toggle("is-selected", button.dataset.theme === theme);
  });
}

// 設定画面のボタンが押されたとき
document.querySelectorAll("#theme-switch button").forEach(function (button) {
  button.addEventListener("click", function () {
    const theme = button.dataset.theme;
    applyTheme(theme);
    saveTheme(theme);
  });
});

// アプリを開いたときに、前回の設定を反映する
applyTheme(loadTheme());
