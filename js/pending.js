// =========================================================
// pending.js  買ったときの事前登録と、明細へのひも付け
// カードの明細は、買ってから数日〜しばらくたたないと届かない。
// そこで、買ったその場で「日付・金額・支払い元・写真・メモ」を先に記録しておき、
// あとで明細を読み込んだときに、当てはまりそうな取引を候補として出す。
//
// ・ひも付けは自動ではしない。候補の中から本人が選んで決める
//   (同じ日に同じ金額の買い物が2回ある場合など、間違ってひも付けないため)
// ・ひも付けると、写真とメモがその取引に移り、確認済みになる
//
// 候補の条件
//  ・金額が同じ
//  ・支払い元が同じ(記録のときに「わからない」を選んだときは、どちらでもよい)
//  ・日付の差が3日以内(お店の処理によって、明細の日付が少しずれることがあるため)
// =========================================================

const PENDING_DAY_RANGE = 3;

let pendingItems = []; // 先に記録した買い物の一覧
let pendingEditing = null; // 編集中の記録(新しく記録するときは null)
let pendingPhotos = []; // 編集画面の写真 [{ id(保存済みのとき), blob(新しく選んだとき), url }]

// ---------- 読み込み ----------

async function loadPending() {
  try {
    pendingItems = await getPendingItems();
  } catch (error) {
    console.warn("先に記録した買い物を読み込めませんでした", error);
    pendingItems = [];
  }
}

// ---------- 候補を探す ----------

// 2つの日付("2026-10-05")が何日離れているか
function daysBetween(a, b) {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round(Math.abs(da - db) / 86400000);
}

// ひも付けの候補になる取引(日付が近い順)
function candidatesFor(item) {
  return state.transactions
    .filter(function (t) {
      if (t.amount !== item.amount) return false;
      if (item.source !== "any" && t.source !== item.source) return false;
      return daysBetween(t.date, item.date) <= PENDING_DAY_RANGE;
    })
    .sort(function (a, b) {
      return daysBetween(a.date, item.date) - daysBetween(b.date, item.date);
    });
}

// 候補が見つかっている記録の数(ホーム画面や、読み込み結果に出す)
function countPendingWithCandidates() {
  return pendingItems.filter(function (item) { return candidatesFor(item).length > 0; }).length;
}

// ---------- ホーム画面のカード ----------

function renderPendingHome() {
  const card = document.getElementById("home-pending");
  if (pendingItems.length === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const found = countPendingWithCandidates();
  document.getElementById("home-pending-text").textContent =
    "明細待ちの記録 " + pendingItems.length + "件" + (found > 0 ? "(明細の候補あり " + found + "件)" : "");
  card.classList.toggle("has-candidates", found > 0);
}

// ---------- 一覧の画面 ----------

function renderPendingList() {
  const ul = document.getElementById("pending-list");
  ul.innerHTML = "";

  if (pendingItems.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.innerHTML = '<p class="empty-text">先に記録した買い物はありません。</p>';
    ul.appendChild(li);
    return;
  }

  // 新しい日付の順
  const items = pendingItems.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });

  items.forEach(function (item) {
    const li = document.createElement("li");
    li.className = "pending-item";

    // 上の行:写真・日付と金額・メモ
    const head = document.createElement("div");
    head.className = "tx";
    const icon = document.createElement("div");
    icon.className = "tx-icon";
    icon.style.background = "#888780";
    icon.textContent = "記";
    if (item.imageIds.length > 0) {
      getImageURL(item.imageIds[0]).then(function (url) {
        if (!url) return;
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        icon.textContent = "";
        icon.style.background = "transparent";
        icon.appendChild(img);
      });
    }
    const body = document.createElement("div");
    body.className = "tx-body";
    const title = document.createElement("div");
    title.className = "tx-name";
    title.textContent = item.memo || "(メモなし)";
    const sub = document.createElement("div");
    sub.className = "tx-sub";
    const parts = item.date.split("-").map(Number);
    sub.textContent =
      parts[1] + "/" + parts[2] + "・" + (item.source === "any" ? "支払い元わからない" : SOURCE_NAMES[item.source]) +
      (item.imageIds.length > 0 ? "・写真" + item.imageIds.length + "枚" : "");
    body.append(title, sub);
    const amount = document.createElement("div");
    amount.className = "tx-amount";
    amount.textContent = yen(item.amount);
    head.append(icon, body, amount);
    head.addEventListener("click", function () {
      openPendingEditor(item);
    });
    li.appendChild(head);

    // 下の行:明細の候補
    const candidates = candidatesFor(item);
    const box = document.createElement("div");
    box.className = "candidates";
    if (candidates.length === 0) {
      const p = document.createElement("p");
      p.className = "candidate-none";
      p.textContent =
        daysBetween(item.date, todayISO()) > 45
          ? "明細の候補が見つかりません。現金で払った、キャンセルした、などの場合は削除してください。"
          : "明細の候補はまだありません。明細を読み込むと、ここに候補が出ます。";
      box.appendChild(p);
    } else {
      const label = document.createElement("p");
      label.className = "candidate-label";
      label.textContent = candidates.length === 1 ? "この取引ではありませんか?" : "候補が" + candidates.length + "件あります。どれですか?";
      box.appendChild(label);
      candidates.forEach(function (t) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "candidate";
        const d = t.date.split("-").map(Number);
        button.textContent =
          d[1] + "/" + d[2] + (t.time ? " " + t.time : "") + "・" + displayName(t) + "・" + yen(t.amount) + " にひも付ける";
        button.addEventListener("click", function () {
          linkPending(item, t);
        });
        box.appendChild(button);
      });
    }
    li.appendChild(box);
    ul.appendChild(li);
  });
}

// 今日の日付 "2026-11-04"
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ---------- ひも付け ----------

async function linkPending(item, t) {
  const d = t.date.split("-").map(Number);
  const ok = window.confirm(
    "先に記録した買い物を、" + d[1] + "/" + d[2] + "の「" + displayName(t) + "」(" + yen(t.amount) +
      ")にひも付けます。写真とメモがこの取引に移り、確認済みになります。よろしいですか?"
  );
  if (!ok) return;

  try {
    // 写真:取引の写真の後ろに足す(同じ写真データをそのまま使い、コピーはしない)
    setImageIds(t, imageIdsOf(t).concat(item.imageIds).slice(0, MAX_PHOTOS));
    // メモ:取引にメモがなければそのまま、あれば後ろにつなげる
    if (item.memo) t.memo = t.memo ? t.memo + " / " + item.memo : item.memo;
    t.status = "confirmed";
    await updateTransaction(t);

    await deletePendingItem(item.id);
    pendingItems = pendingItems.filter(function (p) { return p.id !== item.id; });

    render();
    renderPendingList();
    // ひも付けた取引の詳細画面を開いて、結果を見せる
    openDetail(t.id);
    showDetailMessage("先に記録した写真とメモを、この取引にひも付けました。", false);
  } catch (error) {
    console.error(error);
    window.alert("ひも付けできませんでした。もう一度お試しください。");
  }
}

// ---------- 記録・編集の画面 ----------

function openPendingEditor(item) {
  pendingEditing = item || null;
  document.getElementById("pending-edit-title").textContent = item ? "記録を編集" : "買い物を先に記録";
  document.getElementById("pending-date").value = item ? item.date : todayISO();
  document.getElementById("pending-amount").value = item ? item.amount : "";
  document.getElementById("pending-memo").value = item ? item.memo : "";
  document.getElementById("pending-delete").hidden = !item;
  document.getElementById("pending-message").hidden = true;
  setPendingSource(item ? item.source : "any");

  // 写真
  pendingPhotos = [];
  if (item) {
    Promise.all(
      item.imageIds.map(function (id) {
        return getImageURL(id).then(function (url) { return { id: id, url: url }; });
      })
    ).then(function (photos) {
      pendingPhotos = photos;
      renderPendingPhotos();
    });
  }
  renderPendingPhotos();
  showScreen("screen-pending-edit");
}

function setPendingSource(source) {
  document.querySelectorAll("#pending-source button").forEach(function (button) {
    button.classList.toggle("is-selected", button.dataset.source === source);
  });
}

function selectedPendingSource() {
  const button = document.querySelector("#pending-source button.is-selected");
  return button ? button.dataset.source : "any";
}

function renderPendingPhotos() {
  const box = document.getElementById("pending-photos");
  box.innerHTML = "";
  pendingPhotos.forEach(function (photo, index) {
    const wrap = document.createElement("div");
    wrap.className = "pending-photo";
    const img = document.createElement("img");
    img.src = photo.url;
    img.alt = "";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "pending-photo-remove";
    remove.setAttribute("aria-label", "この写真を外す");
    remove.textContent = "×";
    remove.addEventListener("click", function () {
      pendingPhotos.splice(index, 1);
      renderPendingPhotos();
    });
    wrap.append(img, remove);
    box.appendChild(wrap);
  });
}

function showPendingMessage(text, isError) {
  const box = document.getElementById("pending-message");
  box.hidden = false;
  box.textContent = text;
  box.classList.toggle("is-error", isError);
}

// 写真を選ぶ・撮る(保存ボタンを押すまでは、まだ保存しない)
async function addPendingPhotos(input) {
  const files = Array.from(input.files);
  input.value = "";
  const room = MAX_PHOTOS - pendingPhotos.length;
  for (const file of files.slice(0, Math.max(0, room))) {
    try {
      const blob = await resizeImage(file);
      pendingPhotos.push({ blob: blob, url: URL.createObjectURL(blob) });
    } catch (error) {
      showPendingMessage(error.message || "写真を読み込めませんでした。", true);
    }
  }
  renderPendingPhotos();
}

document.getElementById("pending-photo-pick").addEventListener("click", function () {
  document.getElementById("pending-photo-input").click();
});
document.getElementById("pending-photo-camera").addEventListener("click", function () {
  document.getElementById("pending-camera-input").click();
});
document.getElementById("pending-photo-input").addEventListener("change", function () {
  addPendingPhotos(this);
});
document.getElementById("pending-camera-input").addEventListener("change", function () {
  addPendingPhotos(this);
});

document.querySelectorAll("#pending-source button").forEach(function (button) {
  button.addEventListener("click", function () {
    setPendingSource(button.dataset.source);
  });
});

// 保存
document.getElementById("pending-save").addEventListener("click", async function () {
  const date = document.getElementById("pending-date").value;
  const amount = Number(String(document.getElementById("pending-amount").value).replace(/[,円\s]/g, ""));
  if (!date) {
    showPendingMessage("日付を入力してください。", true);
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    showPendingMessage("金額を入力してください(明細と同じ金額で探すため、必須です)。", true);
    return;
  }

  try {
    const id = pendingEditing ? pendingEditing.id : "pending-" + Date.now();

    // 写真:新しく選んだものを保存し、外したものは削除する
    const keepIds = [];
    for (let i = 0; i < pendingPhotos.length; i++) {
      const photo = pendingPhotos[i];
      if (photo.id) {
        keepIds.push(photo.id);
      } else {
        const imageId = id + "#p" + Date.now() + "-" + i;
        await putImage(imageId, photo.blob);
        keepIds.push(imageId);
      }
    }
    if (pendingEditing) {
      for (const oldId of pendingEditing.imageIds) {
        if (keepIds.indexOf(oldId) === -1) {
          await deleteImage(oldId);
          forgetImageURL(oldId);
        }
      }
    }

    const item = {
      id: id,
      date: date,
      amount: amount,
      source: selectedPendingSource(),
      memo: document.getElementById("pending-memo").value.trim(),
      imageIds: keepIds,
      createdAt: pendingEditing ? pendingEditing.createdAt : new Date().toISOString(),
    };
    await putPendingItem(item);
    pendingItems = pendingItems.filter(function (p) { return p.id !== id; }).concat([item]);

    renderPendingHome();
    renderPendingList();
    showScreen("screen-pending");
  } catch (error) {
    console.error(error);
    showPendingMessage("保存できませんでした。もう一度お試しください。", true);
  }
});

// 削除(現金で払った、キャンセルした、など)
document.getElementById("pending-delete").addEventListener("click", async function () {
  if (!pendingEditing) return;
  if (!window.confirm("この記録を削除しますか?写真も一緒に削除されます。")) return;
  try {
    for (const imageId of pendingEditing.imageIds) {
      await deleteImage(imageId);
      forgetImageURL(imageId);
    }
    await deletePendingItem(pendingEditing.id);
    pendingItems = pendingItems.filter(function (p) { return p.id !== pendingEditing.id; });
    renderPendingHome();
    renderPendingList();
    showScreen("screen-pending");
  } catch (error) {
    console.error(error);
    showPendingMessage("削除できませんでした。", true);
  }
});

// 画面の移動
document.getElementById("home-pending-add").addEventListener("click", function () {
  openPendingEditor(null);
});
document.getElementById("home-pending").addEventListener("click", function () {
  renderPendingList();
  showScreen("screen-pending");
});
document.getElementById("pending-add").addEventListener("click", function () {
  openPendingEditor(null);
});
document.getElementById("pending-back").addEventListener("click", function () {
  showScreen("screen-home");
});
document.getElementById("pending-edit-back").addEventListener("click", function () {
  renderPendingList();
  showScreen("screen-pending");
});
