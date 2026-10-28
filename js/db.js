// =========================================================
// db.js  データの保存(IndexedDB)
// iPhoneのブラウザの中に取引データを保存する。
// サーバーには何も送らない。
// =========================================================

const DB_NAME = "meisai-db";
const DB_VERSION = 1;
const STORE = "transactions"; // 取引を入れる箱の名前

// データベースを開く(初めてのときは箱を作る)
function openDB() {
  return new Promise(function (resolve, reject) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // 初回やバージョンが上がったときだけ呼ばれる
    request.onupgradeneeded = function () {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // id を目印にして1件ずつ保存する
        db.createObjectStore(STORE, { keyPath: "id" });
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

// 保存されている取引をすべて取り出す
async function getAllTransactions() {
  const db = await openDB();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = function () {
      resolve(request.result);
    };
    request.onerror = function () {
      reject(request.error);
    };
  });
}

// 取引をまとめて保存する(途中で失敗したら全部取り消される)
async function addTransactions(items) {
  if (items.length === 0) return;
  const db = await openDB();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    items.forEach(function (item) {
      store.put(item);
    });
    tx.oncomplete = function () {
      resolve();
    };
    tx.onerror = function () {
      reject(tx.error);
    };
  });
}

// すべての取引を削除する(設定画面の「すべてのデータを削除」用)
async function clearTransactions() {
  const db = await openDB();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = function () {
      resolve();
    };
    tx.onerror = function () {
      reject(tx.error);
    };
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
