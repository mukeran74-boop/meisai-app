// =========================================================
// update.js  新しい版の自動読み込み
// iPhoneは前に読み込んだ index.html を覚えていて、Pushしても
// しばらく古い画面のままになることがある。
// そこで、アプリを開いたとき(と、ほかのアプリから戻ってきたとき)に
// version.json を「覚えている分を使わずに」読み、
// 新しい版が出ていれば自動で読み込み直す。
//
// ★ファイルを更新したら、次の3か所の番号をそろえて上げる
//   1. index.html の <meta name="app-version">
//   2. index.html の ?v=
//   3. version.json の version
//
// 【直した不具合】
// 前は、このファイルの中に書いた番号と version.json を比べていた。
// ところが、iPhoneが古い index.html を覚えていても、このファイルだけは
// 新しいものが読み込まれることがあり、その場合「最新」と勘違いして
// 古い画面のままになっていた。
// そこで、画面(index.html)自体に書いてある番号と比べるようにした。
// =========================================================

// 今表示している画面(index.html)の版。古い画面には書いていないので null になる
const PAGE_VERSION = (function () {
  const meta = document.querySelector('meta[name="app-version"]');
  return meta ? meta.content : null;
})();

// アプリの版(設定画面の表示や、辞書ファイルを読むときに使う)
const APP_VERSION = PAGE_VERSION || "unknown";

async function checkForUpdate() {
  try {
    // cache: "no-store" と ?t=時刻 で、必ず最新の version.json を取りに行く
    const response = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) return;
    const latest = (await response.json()).version;
    if (!latest || latest === PAGE_VERSION) return; // 画面が最新なら何もしない

    // メモを入力している途中なら、書いた内容が消えないよう読み込み直さない
    const active = document.activeElement;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) return;

    // 同じ版で何度も読み込み直さないよう、試したことを覚えておく
    // (公開の反映が遅れているときに、無限に読み込み直すのを防ぐ)
    const key = "meisai-update-tried";
    let tried = null;
    try {
      tried = sessionStorage.getItem(key);
    } catch (error) {
      // 保存領域が使えないときは、そのまま進める
    }
    if (tried === latest) return;
    try {
      sessionStorage.setItem(key, latest);
    } catch (error) {
      // 何もしない
    }

    // URLに版の番号を付けて読み込み直す(覚えている古い index.html を使わせないため)
    location.replace(location.pathname + "?v=" + latest);
  } catch (error) {
    // 電波がないときなどは、今の版のまま使う
    console.warn("新しい版の確認ができませんでした", error);
  }
}

// アプリを開いたとき
checkForUpdate();

// ほかのアプリから戻ってきたとき
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible") checkForUpdate();
});
