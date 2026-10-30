// =========================================================
// shopedit.js  お店の辞書に、アプリの画面から登録・編集・削除する
//  ・取引の詳細画面の「このお店を辞書に登録」から開く
//    (明細の店名が最初から入った状態で開く)
//  ・設定 → お店の辞書 の「+ お店を追加」や、自分で登録したお店から開く
//  ・自分で登録したお店は iPhone の中(IndexedDB)に保存し、
//    最初から入っている辞書より優先して使う
// =========================================================

let shopEditing = null; // 編集中のお店(新しく登録するときは null)
let shopEditCategory = "その他"; // 選んでいるジャンル
let shopEditReturn = "screen-shops"; // 戻る先の画面

// 登録・編集画面を開く
//  options.shop     … 編集する自分のお店(新しく登録するときは無し)
//  options.pattern  … 最初に入れておく「明細の店名に含まれる言葉」
//  options.base     … 最初から入っている辞書のお店(内容を変更するとき)
//  options.returnTo … 戻る先の画面
function openShopEditor(options) {
  shopEditing = options.shop || null;
  shopEditReturn = options.returnTo || "screen-shops";

  const source = options.shop || options.base || null;
  const lead = document.getElementById("shop-edit-lead");

  if (options.shop) {
    document.getElementById("shop-edit-title").textContent = "辞書の登録を編集";
    lead.hidden = true;
  } else if (options.base) {
    document.getElementById("shop-edit-title").textContent = "辞書の内容を変更";
    lead.hidden = false;
    lead.textContent = "最初から入っている辞書の内容をもとに、自分用の登録を作ります。自分で登録した内容が優先して使われます。";
  } else {
    document.getElementById("shop-edit-title").textContent = "お店を辞書に登録";
    lead.hidden = true;
  }

  document.getElementById("shop-edit-pattern").value =
    source ? source.patterns.join("、") : options.pattern || "";
  document.getElementById("shop-edit-name").value = source ? source.name : "";
  document.getElementById("shop-edit-desc").value = source ? source.description || "" : "";
  shopEditCategory = source && CATEGORIES[source.category] ? source.category : "その他";

  document.getElementById("shop-edit-message").hidden = true;
  document.getElementById("shop-edit-delete").hidden = !options.shop;

  renderCategoryPicker();
  showScreen("screen-shop-edit");
}

// ジャンルの選択肢(アイコン付き)を並べる
function renderCategoryPicker() {
  const box = document.getElementById("shop-edit-category");
  box.innerHTML = "";
  Object.keys(CATEGORIES).forEach(function (name) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-chip" + (name === shopEditCategory ? " is-selected" : "");

    const icon = document.createElement("span");
    icon.className = "category-chip-icon";
    icon.style.background = CATEGORIES[name].color;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.classList.add("category-icon");
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", CATEGORIES[name].path);
    svg.appendChild(path);
    icon.appendChild(svg);

    button.append(icon, name);
    button.addEventListener("click", function () {
      shopEditCategory = name;
      renderCategoryPicker();
    });
    box.appendChild(button);
  });
}

function showShopEditMessage(text, isError) {
  const box = document.getElementById("shop-edit-message");
  box.hidden = false;
  box.textContent = text;
  box.classList.toggle("is-error", isError);
}

// 戻る(詳細画面から来たときは、詳細画面を描き直してから戻る)
function closeShopEditor() {
  if (shopEditReturn === "screen-detail") {
    renderDetail();
  } else {
    renderShopList();
  }
  showScreen(shopEditReturn);
}

document.getElementById("shop-edit-back").addEventListener("click", closeShopEditor);

// 保存
document.getElementById("shop-edit-save").addEventListener("click", async function () {
  // 「、」や「,」で区切って、複数の言葉を登録できるようにする
  const patterns = document
    .getElementById("shop-edit-pattern")
    .value.split(/[、,，]/)
    .map(function (p) { return p.trim(); })
    .filter(function (p) { return p !== ""; });
  const name = document.getElementById("shop-edit-name").value.trim();

  if (patterns.length === 0) {
    showShopEditMessage("明細の店名に含まれる言葉を入力してください。", true);
    return;
  }
  if (name === "") {
    showShopEditMessage("表示名を入力してください。", true);
    return;
  }

  const shop = {
    id: shopEditing ? shopEditing.id : "custom-" + Date.now(),
    patterns: patterns,
    name: name,
    category: shopEditCategory,
    description: document.getElementById("shop-edit-desc").value.trim(),
    custom: true, // 自分で登録したお店の印
  };

  try {
    await saveCustomShop(shop);
    shopEditing = shop;
    document.getElementById("shop-edit-delete").hidden = false;
    render(); // 一覧・ホーム・グラフの表示を新しい辞書で描き直す
    renderShopList();
    showShopEditMessage("保存しました。この言葉を含む取引は、すべてこのお店として表示されます。", false);
  } catch (error) {
    console.error(error);
    showShopEditMessage("保存できませんでした。もう一度お試しください。", true);
  }
});

// 削除
document.getElementById("shop-edit-delete").addEventListener("click", async function () {
  if (!shopEditing) return;
  if (!window.confirm("「" + shopEditing.name + "」を辞書から削除しますか?取引は消えません。")) return;
  try {
    await removeCustomShop(shopEditing.id);
    shopEditing = null;
    render();
    closeShopEditor();
  } catch (error) {
    console.error(error);
    showShopEditMessage("削除できませんでした。", true);
  }
});

// 設定 → お店の辞書 の「+ お店を追加」
document.getElementById("shop-add").addEventListener("click", function () {
  openShopEditor({ returnTo: "screen-shops" });
});

// 取引の詳細画面の「このお店を辞書に登録」
document.getElementById("detail-shop-edit").addEventListener("click", function () {
  const t = findTransaction(state.detailId);
  if (!t) return;
  const shop = findShop(t);
  if (shop && shop.custom) {
    openShopEditor({ shop: shop, returnTo: "screen-detail" });
  } else if (shop) {
    openShopEditor({ base: shop, returnTo: "screen-detail" });
  } else {
    openShopEditor({ pattern: t.name, returnTo: "screen-detail" });
  }
});
