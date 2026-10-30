// =========================================================
// analysis.js  グラフ用の集計と、分析コメントを作る処理
// 生成AIは使わず、集計した結果を決まった文の型に当てはめて作る。
// (明細データをアプリの外に送らないため。仕様書「13.」)
// =========================================================

// 円グラフの色(上位5件用)と「その他」の色
const PIE_COLORS = ["#7f77dd", "#1d9e75", "#d4537e", "#ba7517", "#378add"];
const PIE_OTHER_COLOR = "#888780";

// 指定した月から数えて、過去 count か月分の月の一覧 ["2026-05", ..., "2026-10"]
function recentMonths(month, count) {
  const list = [];
  for (let i = count - 1; i >= 0; i--) {
    list.push(addMonth(month, -i));
  }
  return list;
}

// 月ごと・支払い元ごとの合計(棒グラフ用)
// 戻り値の例:[{ month: "2026-05", rakuten: 30000, paypay: 12000, total: 42000 }, ...]
function monthlyTotals(months) {
  return months.map(function (m) {
    const list = transactionsOfMonth(m);
    const rakuten = sum(list.filter(function (t) { return t.source === "rakuten"; }));
    const paypay = sum(list.filter(function (t) { return t.source === "paypay"; }));
    return { month: m, rakuten: rakuten, paypay: paypay, total: rakuten + paypay };
  });
}

// お店ごとの合計(円グラフ用)
// お店の辞書で同じ店にまとめる(駅前店と大学通り店 → コンビニエンスA)
// 戻り値は金額の多い順:[{ key, name, category, amount }, ...]
function totalsByShop(list) {
  const map = new Map();
  list.forEach(function (t) {
    const shop = findShop(t);
    const key = shop ? shop.id : "raw:" + t.name;
    if (!map.has(key)) {
      map.set(key, {
        key: key,
        name: shop ? shop.name : t.name,
        category: shop ? shop.category : null,
        amount: 0,
      });
    }
    map.get(key).amount += t.amount; // 返品・返金はマイナスなので差し引かれる
  });
  return Array.from(map.values())
    .filter(function (s) { return s.amount > 0; })
    .sort(function (a, b) { return b.amount - a.amount; });
}

// 円グラフ用に、上位5件+「その他」にまとめる
function pieSlices(list) {
  const shops = totalsByShop(list);
  const total = shops.reduce(function (s, x) { return s + x.amount; }, 0);
  if (total === 0) return { total: 0, slices: [] };

  const slices = shops.slice(0, 5).map(function (s, i) {
    return { name: s.name, amount: s.amount, color: PIE_COLORS[i] };
  });
  const rest = shops.slice(5).reduce(function (s, x) { return s + x.amount; }, 0);
  if (rest > 0) slices.push({ name: "その他", amount: rest, color: PIE_OTHER_COLOR });

  slices.forEach(function (s) {
    s.percent = Math.round((s.amount / total) * 100);
  });
  return { total: total, slices: slices };
}

// ---------- 分析コメント ----------
// その月の取引から、文の型に当てはめたコメントを作る(大事な順)
function analysisComments(month) {
  const list = transactionsOfMonth(month);
  const comments = [];
  if (list.length === 0) return comments;

  const shops = totalsByShop(list);
  const total = shops.reduce(function (s, x) { return s + x.amount; }, 0);

  // 1. 一番多く払ったお店
  if (shops.length > 0 && total > 0) {
    const top = shops[0];
    const percent = Math.round((top.amount / total) * 100);
    comments.push(
      "この月は" + top.name + "での支払いが一番多く、全体の" + percent + "%(" + yen(top.amount) + ")です。"
    );
  }

  // 2. 先月より一番増えたお店(1,000円以上増えたときだけ)
  const prevShops = totalsByShop(transactionsOfMonth(addMonth(month, -1)));
  const prevMap = new Map(prevShops.map(function (s) { return [s.key, s.amount]; }));
  let biggest = null;
  shops.forEach(function (s) {
    // 辞書にないお店は、4つ目のコメント(見覚えの確認)で知らせるのでここでは比べない
    if (s.key.indexOf("raw:") === 0) return;
    const diff = s.amount - (prevMap.get(s.key) || 0);
    if (diff >= 1000 && (!biggest || diff > biggest.diff)) biggest = { name: s.name, diff: diff };
  });
  if (biggest && prevShops.length > 0) {
    comments.push(biggest.name + "での支払いが先月より" + yen(biggest.diff) + "増えています。");
  }

  // 3. サブスクの合計
  const subscription = shops
    .filter(function (s) { return s.category === "サブスク"; })
    .reduce(function (sum, s) { return sum + s.amount; }, 0);
  if (subscription > 0) {
    comments.push("サブスクだけで" + yen(subscription) + "使っています。");
  }

  // 4. 辞書にないお店(見覚えのない支払いかもしれない)
  const unknown = list.filter(function (t) { return !findShop(t) && t.status === "unconfirmed"; });
  if (unknown.length > 0) {
    comments.push(
      "辞書にないお店の未確認の支払いが" + unknown.length + "件あります。見覚えがあるか確認しましょう。"
    );
  }

  return comments;
}

// 金額を短く表示する(棒グラフの上の数字用) 69260 → "6.9万"、8500 → "8千"
function shortYen(n) {
  if (n >= 10000) return (Math.round(n / 1000) / 10).toFixed(1) + "万";
  if (n >= 1000) return Math.round(n / 1000) + "千";
  return String(Math.max(0, Math.round(n)));
}
