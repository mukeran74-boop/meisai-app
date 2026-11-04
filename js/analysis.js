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

// ジャンル(カテゴリ)ごとの合計(円グラフ用)
// 辞書にないお店は「辞書にないお店」としてまとめる
// 戻り値は金額の多い順:[{ name, color, amount, percent, shops: [...] }, ...]
const NO_CATEGORY = "辞書にないお店";

function totalsByCategory(list) {
  const map = new Map();
  totalsByShop(list).forEach(function (shop) {
    const name = shop.category || NO_CATEGORY;
    if (!map.has(name)) {
      const info = CATEGORIES[name] || UNKNOWN_CATEGORY;
      map.set(name, { name: name, color: info.color, amount: 0, shops: [] });
    }
    const group = map.get(name);
    group.amount += shop.amount;
    group.shops.push(shop); // ジャンルの中のお店(金額の多い順のまま入る)
  });

  const groups = Array.from(map.values()).sort(function (a, b) { return b.amount - a.amount; });
  const total = groups.reduce(function (s, g) { return s + g.amount; }, 0);
  groups.forEach(function (g) {
    g.percent = total > 0 ? Math.round((g.amount / total) * 100) : 0;
    // ジャンルの中で、それぞれのお店が何%か
    g.shops.forEach(function (s) {
      s.percentInGroup = Math.round((s.amount / g.amount) * 100);
    });
  });
  return { total: total, groups: groups };
}

// ---------- サブスクの自動検出 ----------
// 「同じお店で、ほぼ同じ金額が、毎月同じころに」支払われている取引を探す。
// お店の辞書でサブスクにしていなくても見つけられるので、
// 登録し忘れや、使っていないのに払い続けているサブスク(解約し忘れ)に気づける。
//
// 判定のルール
//  ・3か月以上続けて、毎月支払いがある
//  ・金額が毎月ほぼ同じ(真ん中の金額から±10%以内)
//  ・支払う日がほぼ同じ(いちばん早い日といちばん遅い日の差が6日以内)
const SUB_MIN_MONTHS = 3;
const SUB_AMOUNT_RANGE = 0.1;
const SUB_DAY_RANGE = 6;

function median(numbers) {
  const sorted = numbers.slice().sort(function (a, b) { return a - b; });
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function detectSubscriptions() {
  // お店ごとにまとめる(辞書で同じお店のものは1つに)
  const groups = new Map();
  state.transactions.forEach(function (t) {
    if (t.amount <= 0) return; // 返品・返金は対象外
    const shop = findShop(t);
    const key = shop ? shop.id : "raw:" + t.name;
    if (!groups.has(key)) groups.set(key, { key: key, shop: shop, sample: t, items: [] });
    groups.get(key).items.push(t);
  });

  // データがある一番新しい月(これより前に止まっているものは「最近は支払いなし」)
  const latest = latestMonth();
  const results = [];

  groups.forEach(function (g) {
    // 月ごとに1件ずつ(同じ月に何回も払っているお店は、サブスクではないとみなす)
    const byMonth = new Map();
    g.items.forEach(function (t) {
      const m = t.date.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(t);
    });
    const months = Array.from(byMonth.keys()).sort();
    if (months.some(function (m) { return byMonth.get(m).length > 1; })) return;

    // 続いている月の一番長いかたまりを探す(例:5月〜10月)
    let best = [];
    let run = [];
    months.forEach(function (m) {
      if (run.length > 0 && addMonth(run[run.length - 1], 1) !== m) run = [];
      run.push(m);
      if (run.length > best.length) best = run.slice();
    });
    if (best.length < SUB_MIN_MONTHS) return;

    const payments = best.map(function (m) { return byMonth.get(m)[0]; });
    const amounts = payments.map(function (t) { return t.amount; });
    const typical = median(amounts);
    const sameAmount = amounts.every(function (a) {
      return Math.abs(a - typical) <= typical * SUB_AMOUNT_RANGE;
    });
    const days = payments.map(function (t) { return Number(t.date.slice(8, 10)); });
    const sameDay = Math.max.apply(null, days) - Math.min.apply(null, days) <= SUB_DAY_RANGE;
    if (!sameAmount || !sameDay) return;

    const last = payments[payments.length - 1];
    const lastMonth = last.date.slice(0, 7);
    results.push({
      key: g.key,
      shop: g.shop,
      sample: g.sample,
      name: g.shop ? g.shop.name : g.sample.name,
      category: g.shop ? g.shop.category : null,
      amount: Math.round(typical),
      months: best.length,
      firstMonth: best[0],
      lastDate: last.date,
      day: Math.round(median(days)),
      // 一番新しい月か、その前の月まで払っていれば「続いている」
      active: lastMonth === latest || addMonth(lastMonth, 1) === latest,
      registered: g.shop && g.shop.category === "サブスク",
    });
  });

  // 金額の大きい順
  return results.sort(function (a, b) { return b.amount - a.amount; });
}

// ---------- 分析コメント ----------
// その月の取引から、文の型に当てはめたコメントを作る(大事な順)
function analysisComments(month) {
  const list = transactionsOfMonth(month);
  const comments = [];
  if (list.length === 0) return comments;

  const shops = totalsByShop(list);
  const total = shops.reduce(function (s, x) { return s + x.amount; }, 0);

  // 1. 一番多く使ったジャンルと、その中で一番多いお店
  const byCategory = totalsByCategory(list);
  if (byCategory.groups.length > 0 && byCategory.total > 0) {
    const top = byCategory.groups[0];
    let text = "この月は「" + top.name + "」に一番使っていて、全体の" + top.percent + "%(" + yen(top.amount) + ")です。";
    if (top.shops.length > 1) {
      text += "そのうち" + top.shops[0].percentInGroup + "%が" + top.shops[0].name + "です。";
    }
    comments.push(text);
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

  // 3-2. 辞書でサブスクにしていない、毎月の支払い
  const notRegistered = detectSubscriptions().filter(function (s) { return s.active && !s.registered; });
  if (notRegistered.length > 0) {
    comments.push(
      "サブスクのような毎月の支払いが" + notRegistered.length + "件見つかりました(" +
        notRegistered.map(function (s) { return s.name; }).join("、") + ")。下の「毎月の支払い」で確認できます。"
    );
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
