// =========================================================
// db.js  データの保存(IndexedDB)
// iPhoneのブラウザの中に取引データと写真を保存する。
// サーバーには何も送らない。
// =========================================================

const DB_NAME = "meisai-db";
const DB_VERSION = 2; // 写真用の箱を追加したので 1 → 2 に上げた
const STORE = "transactions"; // 取引を入れる箱
const IMAGE_STORE = "images"; // 写真を入れる箱(取引の id と同じ id で保存)

// データベースを開く(初めてのときや、バージョンが上がったときは箱を作る)
function openDB() {
  return new Promise(function (resolve, reject) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function () {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        // 写真は { id, blob } の形で保存する
        db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = function () {
      resolve(request.result);
    };
    request.onerror = function () {
      reject(request.error);
    };
  });
}

// 1つの箱に対して読み書きする共通の手続き
//  storeName: 箱の名前 / mode: "readonly" か "readwrite"
//  work: 箱を受け取って処理をする関数(結果を返すときは request を返す)
async function withStore(storeName, mode, work) {
  const db = await openDB();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(storeName, mode);
    const request = work(tx.objectStore(storeName));
    tx.oncomplete = function () {
      resolve(request ? request.result : undefined);
    };
    tx.onerror = function () {
      reject(tx.error);
    };
  });
}

// ---------- 取引 ----------

// 保存されている取引をすべて取り出す
function getAllTransactions() {
  return withStore(STORE, "readonly", function (store) {
    return store.getAll();
  });
}

// 取引をまとめて保存する(途中で失敗したら全部取り消される)
async function addTransactions(items) {
  if (items.length === 0) return;
  return withStore(STORE, "readwrite", function (store) {
    items.forEach(function (item) {
      store.put(item);
    });
  });
}

// 取引を1件更新する(メモ・確認済み・写真の有無など)
function updateTransaction(item) {
  return withStore(STORE, "readwrite", function (store) {
    store.put(item);
  });
}

// ---------- 写真 ----------

// 写真を保存する
function putImage(id, blob) {
  return withStore(IMAGE_STORE, "readwrite", function (store) {
    store.put({ id: id, blob: blob });
  });
}

// 写真を取り出す(なければ null)
async function getImage(id) {
  const record = await withStore(IMAGE_STORE, "readonly", function (store) {
    return store.get(id);
  });
  return record ? record.blob : null;
}

// 写真を削除する
function deleteImage(id) {
  return withStore(IMAGE_STORE, "readwrite", function (store) {
    store.delete(id);
  });
}

// ---------- すべて削除 ----------

// 取引も写真もすべて削除する(設定画面の「すべてのデータを削除」用)
async function clearTransactions() {
  await withStore(STORE, "readwrite", function (store) {
    store.clear();
  });
  await withStore(IMAGE_STORE, "readwrite", function (store) {
    store.clear();
  });
}

// ブラウザに「このデータは消さないでほしい」とお願いする
// (ホーム画面に追加して使う場合は、もともと消えにくい)
async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      await navigator.storage.persist();
    }
  } catch (error) {
    console.warn("保存領域の確保をお願いできませんでした", error);
  }
}
