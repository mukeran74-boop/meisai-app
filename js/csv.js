// =========================================================
// csv.js  明細CSVの読み込みと、2社の形式をそろえる処理
//
// 読み込んだ取引は、どちらの会社でも次の形にそろえる
// {
//   id:       保存用の目印(重複しない文字列)
//   source:   "rakuten" または "paypay"
//   date:     "2026-10-05"  (日付)
//   time:     "14:54"       (時刻。楽天は時刻がないので null)
//   rawName:  明細に書いてあるままの店名
//   name:     見やすくした店名(半角カナを全角にする、「利用国US」を取る など)
//   amount:   金額(支払いはプラス、返品・返金はマイナス)
//   method:   支払い方法("1回払い"、"PayPay残高"、"VISA" など)
//   txNo:     PayPayの取引番号(楽天は null)
//   dupKey:   重複を調べるための目印
//   status:   "unconfirmed"(未確認)または "confirmed"(確認済み)
//   memo:     メモ
//   importedAt: 読み込んだ日時
// }
// =========================================================

// ---------- CSVの文字列を表(2次元の配列)に変換する ----------
// 「"」で囲まれた中のカンマ(例: "15,000")は区切りとして扱わない
function parseCSV(text) {
  // 先頭のBOM(見えない印)を取り除く。残すと1列目の名前が一致しなくなる
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // 「""」は「"」1文字として扱う
          i++;
        } else {
          inQuotes = false; // 囲みの終わり
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++; // 改行コード \r\n に対応
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // 最後の行(末尾に改行がない場合)
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // 空の行は取り除く
  return rows.filter(function (r) {
    return r.some(function (cell) {
      return cell.trim() !== "";
    });
  });
}

// ---------- どちらの会社のCSVかを見出し行から判定する ----------
function detectSource(header) {
  if (header[0] === "利用日" && (header[1] || "").indexOf("利用店名") === 0) {
    return "rakuten";
  }
  if (header[0] === "取引日" && header.indexOf("取引番号") !== -1) {
    return "paypay";
  }
  return null; // どちらでもない
}

// ---------- 小さな道具 ----------

// "15,000" や "-2480" を数値にする。"-" や空欄は null
function toNumber(text) {
  const t = (text || "").replace(/,/g, "").trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// "2026/9/7" → "2026-09-07"
function toISODate(text) {
  const m = (text || "").trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
}

// 店名を見やすくする
//  ・半角カナや全角英数をそろえる(ｽｰﾊﾟｰ → スーパー)
//  ・楽天の店名の後ろに付く「利用国US」などを取り除く
function cleanName(raw) {
  return (raw || "")
    .normalize("NFKC")
    .replace(/\s*利用国[A-Z]{2}$/, "")
    .trim();
}

// ---------- 楽天カードの1ファイル分をそろえる ----------
// 列は「位置」で読む(「10月支払金額」のように月で名前が変わる列があるため)
//  0:利用日 1:利用店名・商品名 3:支払方法 4:利用金額
function normalizeRakuten(rows) {
  const items = [];
  let skipped = 0;

  rows.slice(1).forEach(function (r) {
    const date = toISODate(r[0]);
    const amount = toNumber(r[4]);
    if (!date || amount === null) {
      skipped++; // 形が合わない行は飛ばす
      return;
    }
    const rawName = (r[1] || "").trim();
    items.push({
      source: "rakuten",
      date: date,
      time: null,
      rawName: rawName,
      name: cleanName(rawName),
      amount: amount,
      method: (r[3] || "").trim(),
      txNo: null,
      // 取引番号がないので「日付・店名・金額」を目印にする
      dupKey: "rakuten|" + date + "|" + rawName + "|" + amount,
    });
  });

  return { items: items, skipped: skipped, charges: 0 };
}

// ---------- PayPayの1ファイル分をそろえる ----------
function normalizePayPay(rows) {
  const header = rows[0];
  // PayPayは列名が変わらないので、列名で位置を探す
  const col = function (name) {
    return header.indexOf(name);
  };
  const iDate = col("取引日");
  const iOut = header.findIndex(function (h) { return h.indexOf("出金金額") === 0; });
  const iIn = header.findIndex(function (h) { return h.indexOf("入金金額") === 0; });
  const iKind = col("取引内容");
  const iTo = col("取引先");
  const iMethod = col("取引方法");
  const iNo = col("取引番号");

  const items = [];
  let skipped = 0;
  let charges = 0;

  rows.slice(1).forEach(function (r) {
    const kind = (r[iKind] || "").trim();

    // チャージは支払いと二重に数えないよう、対象外にする
    if (kind === "チャージ") {
      charges++;
      return;
    }

    // "2026/10/19 14:54:30" → 日付と時刻に分ける
    const dt = (r[iDate] || "").trim();
    const date = toISODate(dt);
    const timeMatch = dt.match(/\s(\d{1,2}):(\d{2})/);
    const time = timeMatch ? timeMatch[1].padStart(2, "0") + ":" + timeMatch[2] : null;

    // 出金(支払い)はプラス、入金(返金など)はマイナス
    const out = toNumber(r[iOut]);
    const inn = toNumber(r[iIn]);
    let amount = null;
    if (out !== null) amount = out;
    else if (inn !== null) amount = -inn;

    const txNo = (r[iNo] || "").trim();
    if (!date || amount === null || !txNo) {
      skipped++;
      return;
    }

    // カード番号は保存しない。「クレジット VISA 0000」→「VISA」
    let method = (r[iMethod] || "").trim();
    const brand = method.match(/VISA|Mastercard|JCB|AMEX|American Express/i);
    if (brand) method = brand[0].toUpperCase() === "VISA" ? "VISA" : brand[0];

    const rawName = (r[iTo] || "").trim();
    items.push({
      source: "paypay",
      date: date,
      time: time,
      rawName: rawName,
      name: cleanName(rawName),
      amount: amount,
      method: method,
      txNo: txNo,
      dupKey: "paypay|" + txNo, // PayPayは取引番号で区別できる
    });
  });

  return { items: items, skipped: skipped, charges: charges };
}

// ---------- 重複を除いて、新しく保存する取引だけを選ぶ ----------
// existing: すでに保存されている取引
// items:    今回のファイルから読んだ取引
//
// 考え方(仕様書「2. 重複の除外」)
//  ・同じ目印(dupKey)の取引が「ファイルの中に何件あるか」と
//    「すでに何件保存されているか」を数え、ファイルのほうが多い分だけ追加する
//  ・保存済みのほうが多い場合は何もしない(読み込みで取引を消すことはしない)
function pickNewItems(existing, items) {
  // 保存済みの件数を数える
  const savedCount = {};
  existing.forEach(function (t) {
    savedCount[t.dupKey] = (savedCount[t.dupKey] || 0) + 1;
  });

  // ファイルの中で何件目かを数えながら、保存済みの件数を超えた分だけ選ぶ
  const seenInFile = {};
  const now = new Date().toISOString();
  const newItems = [];

  items.forEach(function (item) {
    const k = item.dupKey;
    seenInFile[k] = (seenInFile[k] || 0) + 1;
    if (seenInFile[k] > (savedCount[k] || 0)) {
      newItems.push(
        Object.assign({}, item, {
          // 同じ目印の2件目以降も区別できるよう、何件目かを付ける
          id: k + "#" + seenInFile[k],
          status: "unconfirmed",
          memo: "",
          importedAt: now,
        })
      );
    }
  });

  return newItems;
}
