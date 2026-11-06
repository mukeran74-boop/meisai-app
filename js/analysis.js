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

// ---------- 支払う月で見る ----------
// 1件の取引を「どの月に、いくら払うか」に分ける
// ・PayPay(残高払い):買ったその場でお金が減るので、買った月
// ・楽天カード:月末締め・翌月27日払いとして、買った月の次の月
// ・楽天カードの分割払い:次の月から、回数分の月に分けて払う
// 戻り値の例:[{ month: "2026-08", amount: 19934, part: 1, count: 3 }, ...]
function paymentPortions(t) {
  const month = t.date.slice(0, 7);
  if (t.source !== "rakuten") return [{ month: month, amount: t.amount }];
  const info = installmentInfo(t);
  if (info && !info.revolving) {
    const list = [];
    let m = info.startMonth;
    for (let i = 0; i < info.count; i++) {
      list.push({ month: m, amount: i === 0 ? info.first : info.each, part: i + 1, count: info.count });
      m = addMonth(m, 1);
    }
    return list;
  }
  // 1回払い(リボ払いは毎月の額が分からないので、目安として全額を次の月に入れる)
  return [{ month: addMonth(month, 1), amount: t.amount }];
}

// 指定した月に払う分の一覧:[{ t, amount, part, count }, ...]
function paymentsOfMonth(month) {
  const list = [];
  state.transactions.forEach(function (t) {
    paymentPortions(t).forEach(function (p) {
      if (p.month === month) list.push({ t: t, amount: p.amount, part: p.part, count: p.count });
    });
  });
  return list;
}

// 月ごと・支払い元ごとの「支払う額」(棒グラフ用)。形は monthlyTotals と同じ
function monthlyPayments(months) {
  return months.map(function (m) {
    let rakuten = 0;
    let paypay = 0;
    let installment = 0;
    paymentsOfMonth(m).forEach(function (p) {
      if (p.t.source === "rakuten") rakuten += p.amount;
      else paypay += p.amount;
      if (p.count) installment += p.amount;
    });
    return { month: m, rakuten: rakuten, paypay: paypay, total: rakuten + paypay, installment: installment };
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

// ---------- 海外利用 ----------
// 楽天カードは店名の後ろの「利用国US」、PayPayは「利用国」の列から、海外での利用を見分ける。
// 見覚えのない海外での利用は、不正利用でよくある例なので目立たせる。

const COUNTRY_NAMES = {
  US: "アメリカ", GB: "イギリス", IE: "アイルランド", NL: "オランダ", DE: "ドイツ", FR: "フランス",
  SG: "シンガポール", HK: "香港", CN: "中国", KR: "韓国", TW: "台湾", TH: "タイ", AU: "オーストラリア",
  CA: "カナダ", LU: "ルクセンブルク", SE: "スウェーデン",
};

// 海外で使った取引なら国のコード("US" など)、そうでなければ null
function overseasCountry(t) {
  if (t.country) return t.country;
  const m = (t.rawName || "").normalize("NFKC").match(/利用国\s*([A-Z]{2})/);
  return m ? m[1] : null;
}

// "US" → "アメリカ(US)"
function countryLabel(code) {
  return COUNTRY_NAMES[code] ? COUNTRY_NAMES[code] + "(" + code + ")" : code;
}

// ---------- 分割払い・リボ払い ----------
// 楽天カードの「支払方法」が「3回払い」などのとき、どの月にいくら払うかの目安を出す。
// 楽天カードは、使った月の翌月から支払いが始まる(デモの明細もこの形)。
// 1回あたりの金額は、割り切れない分を1回目に足して計算する(実際の金額はカード会社の明細で確認)。
function installmentInfo(t) {
  const method = (t.method || "").normalize("NFKC");
  if (method.indexOf("リボ") !== -1) {
    return { revolving: true, label: "リボ払い" };
  }
  const m = method.match(/(\d+)回払い/);
  const count = m ? Number(m[1]) : 1;
  if (count < 2 || t.amount <= 0) return null;

  const each = Math.floor(t.amount / count);
  const first = t.amount - each * (count - 1);
  const startMonth = addMonth(t.date.slice(0, 7), 1);
  const endMonth = addMonth(startMonth, count - 1);
  return {
    revolving: false,
    label: "分割" + count + "回",
    count: count,
    first: first,
    each: each,
    startMonth: startMonth,
    endMonth: endMonth,
  };
}

// ---------- ジャンルごとの予算 ----------
// その月の、ジャンルごとの使った金額と予算を比べる(予算を決めたジャンルだけ)
// 戻り値:[{ name, color, budget, used, ratio }, ...](使った割合の大きい順)
function budgetStatus(month) {
  const used = {};
  totalsByCategory(transactionsOfMonth(month)).groups.forEach(function (g) {
    used[g.name] = g.amount;
  });
  return Object.keys(budgets)
    .filter(function (name) { return budgets[name] > 0 && CATEGORIES[name]; })
    .map(function (name) {
      const u = used[name] || 0;
      return { name: name, color: CATEGORIES[name].color, budget: budgets[name], used: u, ratio: u / budgets[name] };
    })
    .sort(function (a, b) { return b.ratio - a.ratio; });
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
  if (list.length === 0) return [];

  // 大事な順に3つのグループに分けて集め、最後に上から4件だけ出す
  const fraud = []; // 1. 不正利用に関わるもの(まだ確認していない支払いだけを見る)
  const check = []; // 2. 確認の残り
  const usage = []; // 3. 使い方に関わるもの
  const unconfirmed = list.filter(function (t) { return t.status === "unconfirmed"; });

  // 1-1. 海外での利用
  const overseas = unconfirmed.filter(function (t) { return overseasCountry(t); });
  if (overseas.length > 0) {
    fraud.push("海外での利用が" + overseas.length + "件(" + yen(sum(overseas)) + ")あり、まだ確認していません。見覚えがあるか確認しましょう。");
  }

  // 1-2. 二重請求かも:同じ支払い元・同じお店・同じ日・同じ金額の支払いが2件以上
  const groups = new Map();
  list.forEach(function (t) {
    if (t.amount <= 0) return;
    const key = t.source + "|" + shopKeyOf(t) + "|" + t.date + "|" + t.amount;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  // PayPayのように時刻が分かるときは、10分以内に続いたものだけを二重請求の候補にする
  // (同じカフェで朝と夕方に同じ金額を払った、のような普通の支払いを外すため)
  const minutes = function (t) {
    const m = (t.time || "").match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const doubles = [];
  groups.forEach(function (g) {
    if (g.length < 2 || !g.some(function (t) { return t.status === "unconfirmed"; })) return;
    const times = g.map(minutes);
    if (times.some(function (x) { return x === null; })) {
      doubles.push(g); // 時刻が分からない(楽天カード)ときは、同じ日なら候補
      return;
    }
    times.sort(function (a, b) { return a - b; });
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] <= 10) {
        doubles.push(g);
        return;
      }
    }
  });
  if (doubles.length > 0) {
    const g = doubles[0];
    const d = g[0].date.split("-").map(Number);
    fraud.push(
      "同じお店・同じ日・同じ金額の支払いが" + g.length + "件あります(" + d[1] + "/" + d[2] + " " + displayName(g[0]) + " " + yen(g[0].amount) + ")" +
        (doubles.length > 1 ? "。ほかにも" + (doubles.length - 1) + "組あります" : "") +
        "。二重に請求されていないか確認しましょう。"
    );
  }

  // 1-3. 初めてのお店:この月より前に一度も使っていないお店(この月より前のデータがあるときだけ)
  const hasEarlier = state.transactions.some(function (t) { return t.date.slice(0, 7) < month; });
  if (hasEarlier) {
    const firstMonth = new Map(); // お店 → 初めて使った月
    state.transactions.forEach(function (t) {
      const key = shopKeyOf(t);
      const m = t.date.slice(0, 7);
      if (!firstMonth.has(key) || m < firstMonth.get(key)) firstMonth.set(key, m);
    });
    const names = [];
    unconfirmed.forEach(function (t) {
      const name = displayName(t);
      if (firstMonth.get(shopKeyOf(t)) === month && names.indexOf(name) === -1) names.push(name);
    });
    if (names.length > 0) {
      fraud.push(
        "この月に初めて使ったお店が" + names.length + "件あります(" + names.slice(0, 2).join("、") + (names.length > 2 ? "など" : "") + ")。見覚えがあるか確認しましょう。"
      );
    }
  }

  // 1-4. いつもより高い支払い:同じお店のほかの支払い(3件以上)の平均の3倍以上で、3,000円以上高いもの
  let high = null;
  unconfirmed.forEach(function (t) {
    if (t.amount <= 0) return;
    const key = shopKeyOf(t);
    const others = state.transactions.filter(function (x) {
      return x.id !== t.id && x.amount > 0 && shopKeyOf(x) === key;
    });
    if (others.length < 3) return;
    const average = sum(others) / others.length;
    const ratio = t.amount / average;
    if (ratio >= 3 && t.amount - average >= 3000 && (!high || ratio > high.ratio)) {
      high = { t: t, ratio: ratio, average: average };
    }
  });
  if (high) {
    const d = high.t.date.split("-").map(Number);
    fraud.push(
      displayName(high.t) + "で、いつもの約" + Math.round(high.ratio) + "倍の支払いがあります(" + d[1] + "/" + d[2] + " " + yen(high.t.amount) +
        "、いつもは平均" + yen(Math.round(high.average)) + ")。見覚えがあるか確認しましょう。"
    );
  }

  // 2-1. 未確認の残り
  if (unconfirmed.length > 0) {
    check.push("この月の未確認は" + unconfirmed.length + "件(" + yen(sum(unconfirmed)) + ")です。全部に目を通して、確認済みにしていきましょう。");
  }

  // 2-2. 辞書にないお店(見覚えのない支払いかもしれない)
  const unknown = unconfirmed.filter(function (t) { return !findShop(t); });
  if (unknown.length > 0) {
    check.push("辞書にないお店の未確認の支払いが" + unknown.length + "件あります。見覚えがあるか確認しましょう。");
  }

  // 3-1. 一番多く使ったジャンルと、その中で一番多いお店
  const byCategory = totalsByCategory(list);
  if (byCategory.groups.length > 0 && byCategory.total > 0) {
    const top = byCategory.groups[0];
    let text = "この月は「" + top.name + "」に一番使っていて、全体の" + top.percent + "%(" + yen(top.amount) + ")です。";
    if (top.shops.length > 1) {
      text += "そのうち" + top.shops[0].percentInGroup + "%が" + top.shops[0].name + "です。";
    }
    usage.push(text);
  }

  // 3-2. 予算を超えた・超えそうなジャンル(金額は上の予算の棒に出ているので、名前だけまとめる)
  const budgets = budgetStatus(month);
  const over = budgets.filter(function (b) { return b.ratio > 1; }).map(function (b) { return b.name; });
  const near = budgets.filter(function (b) { return b.ratio >= 0.8 && b.ratio <= 1; }).map(function (b) { return b.name; });
  if (over.length > 0) {
    usage.push("予算を超えたジャンルが" + over.length + "つあります(" + over.join("・") + ")。");
  } else if (near.length > 0) {
    usage.push("予算の80%を超えたジャンルが" + near.length + "つあります(" + near.join("・") + ")。");
  }

  // 3-3. 先月より一番増えたお店(1,000円以上増えたときだけ。辞書にないお店は 2-2 で知らせるので比べない)
  const shops = totalsByShop(list);
  const prevShops = totalsByShop(transactionsOfMonth(addMonth(month, -1)));
  const prevMap = new Map(prevShops.map(function (s) { return [s.key, s.amount]; }));
  let biggest = null;
  shops.forEach(function (s) {
    if (s.key.indexOf("raw:") === 0) return;
    const diff = s.amount - (prevMap.get(s.key) || 0);
    if (diff >= 1000 && (!biggest || diff > biggest.diff)) biggest = { name: s.name, diff: diff };
  });
  if (biggest && prevShops.length > 0) {
    usage.push(biggest.name + "での支払いが先月より" + yen(biggest.diff) + "増えています。");
  }

  // 3-4. 辞書でサブスクにしていない、毎月の支払い
  const notRegistered = detectSubscriptions().filter(function (s) { return s.active && !s.registered; });
  if (notRegistered.length > 0) {
    usage.push(
      "サブスクのような毎月の支払いが" + notRegistered.length + "件見つかりました(" +
        notRegistered.map(function (s) { return s.name; }).join("、") + ")。下の「毎月の支払い」で確認できます。"
    );
  }

  return fraud.concat(check, usage).slice(0, MAX_COMMENTS);
}

// コメントは多くても4件(多すぎると大事なものが埋もれるため)
const MAX_COMMENTS = 4;

// お店を見分ける目印(辞書にあれば辞書のお店、なければ明細の店名)。totalsByShop の key と同じ
function shopKeyOf(t) {
  const shop = findShop(t);
  return shop ? shop.id : "raw:" + t.name;
}

// 金額を短く表示する(棒グラフの上の数字用) 69260 → "6.9万"、8500 → "8千"
function shortYen(n) {
  if (n >= 10000) return (Math.round(n / 1000) / 10).toFixed(1) + "万";
  if (n >= 1000) return Math.round(n / 1000) + "千";
  return String(Math.max(0, Math.round(n)));
}
