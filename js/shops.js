// =========================================================
// shops.js  お店の辞書
// 明細の分かりにくい店名(例:「NETMARKET.CO.JP」)を、
// 分かりやすい名前・カテゴリ・アイコン・説明に置き換えて表示する。
// 辞書は data/shops.json に書いてある。
//
// ・辞書に当てはまっても、自動で「確認済み」にはしない
//   (不正利用は誰でも使うお店で起きやすいため。仕様書「7.」)
// ・取引のデータには辞書の結果を保存せず、表示するたびに調べる
//   → 辞書を直せば、過去の取引の表示もすぐに変わる
// =========================================================

// アプリのバージョン(ファイルを更新したら index.html の ?v= と一緒に変える)
const APP_VERSION = "2026103004";

let shopList = []; // 辞書の中身
const shopCache = new Map(); // 店名 → 当てはまったお店(同じ店名を何度も調べないため)

// カテゴリごとの色とアイコン(線だけのSVG)
const CATEGORIES = {
  "コンビニ": { color: "#1d9e75", path: "M4 10h16M5 10v10h14V10M4 10l2-5h12l2 5M10 20v-5h4v5" },
  "通販": { color: "#7f77dd", path: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" },
  "サブスク": { color: "#d4537e", path: "M20 12a8 8 0 0 1-14 5M4 12a8 8 0 0 1 14-5M18 3v4h-4M6 21v-4h4" },
  "公共料金": { color: "#ba7517", path: "M13 3 5 14h6l-1 7 8-11h-6z" },
  "食料品": { color: "#639922", path: "M3 4h2l2 11h11l2-8H6M9 20h1M17 20h1" },
  "外食": { color: "#d85a30", path: "M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 11h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3" },
  "日用品": { color: "#378add", path: "M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0" },
  "車": { color: "#5f5e5a", path: "M5 16v-5l2-5h10l2 5v5M4 16h16M7 16v2M17 16v2M5 11h14" },
  "家電": { color: "#185fa5", path: "M4 6h16v11H4zM9 21h6M12 17v4" },
  "ゲーム": { color: "#534ab7", path: "M6 9h12a3 3 0 0 1 3 3v2a3 3 0 0 1-5 2l-1-1H9l-1 1a3 3 0 0 1-5-2v-2a3 3 0 0 1 3-3zM8 11v4M6 13h4M15 12h1M17 14h1" },
};

// 辞書にないお店(見覚えのない取引かもしれないので「?」で目立たせる)
const UNKNOWN_CATEGORY = { color: "#888780", path: "M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2M12 18h.01" };

// 辞書を読み込む(アプリを開いたときに1回だけ)
async function loadShops() {
  try {
    const response = await fetch("data/shops.json?v=" + APP_VERSION);
    if (!response.ok) throw new Error("HTTP " + response.status);
    const json = await response.json();

    // 長い言葉から先に調べる(短い言葉が先に当たって別の店になるのを防ぐ)
    shopList = json.shops.map(function (shop) {
      return Object.assign({}, shop, {
        keys: shop.patterns
          .map(function (p) { return p.normalize("NFKC").toUpperCase(); })
          .sort(function (a, b) { return b.length - a.length; }),
      });
    });
    shopCache.clear();
  } catch (error) {
    // 辞書が読めなくても、店名をそのまま表示すれば使えるので止めない
    console.warn("お店の辞書を読み込めませんでした", error);
    shopList = [];
  }
}

// 取引に当てはまるお店を探す(なければ null)
function findShop(t) {
  if (shopCache.has(t.name)) return shopCache.get(t.name);
  const name = t.name.toUpperCase();
  const shop =
    shopList.find(function (s) {
      return s.keys.some(function (key) { return name.indexOf(key) !== -1; });
    }) || null;
  shopCache.set(t.name, shop);
  return shop;
}

// 表示用の名前(辞書にあれば辞書の名前、なければ明細の店名)
function displayName(t) {
  const shop = findShop(t);
  return shop ? shop.name : t.name;
}

// カテゴリの色とアイコン
function categoryOf(t) {
  const shop = findShop(t);
  return shop && CATEGORIES[shop.category] ? CATEGORIES[shop.category] : UNKNOWN_CATEGORY;
}

// カテゴリのアイコン(SVG)を作る
function createCategoryIcon(t) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("category-icon");
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", categoryOf(t).path);
  svg.appendChild(path);
  return svg;
}
