// =========================================================
// backup.js  バックアップ(書き出し・読み込み)
// このアプリのデータは iPhone の中だけにあるので、機種変更や
// パソコンとの間でデータを移すときのために、1つのファイルに書き出せるようにする。
//
// 書き出すもの:取引(メモ・確認済みの状態)、写真、自分で登録したお店、
//               支払い元の名前と色、画面のモード
// ファイルは JSON(文字のファイル)。写真は文字に変換(Base64)して中に入れる。
//
// ※書き出したファイルには明細の内容がそのまま入るので、人に渡さないこと
// =========================================================

const BACKUP_APP = "meisai-memo"; // このアプリのバックアップかどうかの目印
const BACKUP_FORMAT = 1; // ファイルの形の版(将来形を変えたときに見分けるため)

// 写真(Blob)を文字(data URL)に変換する
function blobToDataURL(blob) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(reader.error); };
    reader.readAsDataURL(blob);
  });
}

// 文字(data URL)を写真(Blob)に戻す
function dataURLToBlob(dataURL) {
  const parts = dataURL.split(",");
  const type = (parts[0].match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: type });
}

function showBackupMessage(text, isError) {
  const box = document.getElementById("backup-message");
  box.hidden = false;
  box.textContent = text;
  box.classList.toggle("is-error", isError);
}

// ---------- 書き出し ----------

async function exportBackup() {
  showBackupMessage("バックアップを作っています…", false);
  try {
    const images = await getAllImages();
    const imageData = [];
    for (const record of images) {
      imageData.push({ id: record.id, data: await blobToDataURL(record.blob) });
    }

    const backup = {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      transactions: state.transactions,
      images: imageData,
      customShops: customShops,
      pending: pendingItems, // 先に記録した買い物
      settings: { sources: sourceSettings, theme: loadTheme(), budgets: budgets },
    };

    const text = JSON.stringify(backup);
    const today = new Date();
    const name =
      "meisai-backup-" +
      today.getFullYear() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0") +
      ".json";
    const file = new File([text], name, { type: "application/json" });

    // iPhoneでは「共有」から「"ファイル"に保存」できる形で渡す
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "明細メモのバックアップ" });
        showBackupMessage("バックアップを書き出しました(" + state.transactions.length + "件、写真" + imageData.length + "枚)。", false);
      } catch (error) {
        // 共有の画面を閉じたときもここに来る
        if (error.name === "AbortError") {
          showBackupMessage("書き出しをやめました。", false);
          return;
        }
        throw error;
      }
      return;
    }

    // パソコンなど、共有が使えないときはダウンロードする
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showBackupMessage("バックアップを書き出しました(" + state.transactions.length + "件、写真" + imageData.length + "枚)。", false);
  } catch (error) {
    console.error(error);
    showBackupMessage("バックアップを書き出せませんでした。", true);
  }
}

// ---------- 読み込み ----------
// 今のデータは消さずに、バックアップの内容を足す(同じ取引は、バックアップの内容で上書き)

async function importBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch (error) {
    showBackupMessage("このファイルは読み込めません(バックアップのファイルではないようです)。", true);
    return;
  }

  if (!backup || backup.app !== BACKUP_APP || !Array.isArray(backup.transactions)) {
    showBackupMessage("このファイルは明細メモのバックアップではありません。", true);
    return;
  }
  if (backup.format > BACKUP_FORMAT) {
    showBackupMessage("新しい版のアプリで作られたバックアップです。アプリを最新にしてから読み込んでください。", true);
    return;
  }

  const ok = window.confirm(
    "バックアップ(" + backup.transactions.length + "件の取引、写真" + (backup.images || []).length +
      "枚)を読み込みます。今のデータは消えず、同じ取引はバックアップの内容で上書きされます。よろしいですか?"
  );
  if (!ok) return;

  showBackupMessage("読み込んでいます…", false);
  try {
    // 取引
    await addTransactions(backup.transactions);

    // 写真
    for (const record of backup.images || []) {
      await putImage(record.id, dataURLToBlob(record.data));
      forgetImageURL(record.id); // 前の写真の表示用URLを片付ける
    }

    // 自分で登録したお店
    for (const shop of backup.customShops || []) {
      await saveCustomShop(shop);
    }

    // 先に記録した買い物
    for (const item of backup.pending || []) {
      await putPendingItem(item);
    }
    await loadPending();

    // 支払い元の名前と色、画面のモード
    if (backup.settings) {
      if (backup.settings.sources) {
        sourceSettings = Object.assign(sourceSettings, backup.settings.sources);
        saveSourceSettings();
        applySourceSettings();
      }
      if (backup.settings.budgets) {
        budgets = backup.settings.budgets;
        saveBudgets();
      }
      if (backup.settings.theme) {
        applyTheme(backup.settings.theme);
        saveTheme(backup.settings.theme);
      }
    }

    // 画面を読み込み直した状態にする
    state.transactions = await getAllTransactions();
    state.month = latestMonth();
    render();
    renderShopList();
    showBackupMessage(
      "読み込みました(取引" + backup.transactions.length + "件、写真" + (backup.images || []).length + "枚)。",
      false
    );
  } catch (error) {
    console.error(error);
    showBackupMessage("読み込みの途中で失敗しました。もう一度お試しください。", true);
  }
}

// ---------- ボタン ----------

document.getElementById("backup-export").addEventListener("click", exportBackup);

const backupInput = document.getElementById("backup-input");
document.getElementById("backup-import").addEventListener("click", function () {
  backupInput.click();
});
backupInput.addEventListener("change", function () {
  const file = backupInput.files[0];
  backupInput.value = ""; // 同じファイルをもう一度選んでも反応するように
  if (file) importBackup(file);
});
