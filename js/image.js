// =========================================================
// image.js  写真を小さくしてから保存するための処理
// iPhoneの写真は1枚数MBあるので、そのまま保存すると容量を圧迫する。
// 長い辺を1600pxまで縮小し、JPEGにして保存する(仕様書「6. 画像の縮小保存」)。
// 1600pxあれば、あとで作る拡大表示でも粗くなりにくい。
// =========================================================

const IMAGE_MAX_SIZE = 1600; // 長い辺の最大の長さ(px)
const IMAGE_QUALITY = 0.85; // JPEGの画質(0〜1。大きいほどきれいで重い)

// 写真ファイルを受け取り、縮小したJPEGのデータ(Blob)を返す
function resizeImage(file) {
  return new Promise(function (resolve, reject) {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = function () {
      // 縮小の倍率(もともと小さい写真は拡大しない)
      const scale = Math.min(1, IMAGE_MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.round(img.naturalWidth * scale);
      const height = Math.round(img.naturalHeight * scale);

      // 見えないキャンバスに縮小して描き直す
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url); // 使い終わった一時的なURLを片付ける

      canvas.toBlob(
        function (blob) {
          if (blob) resolve(blob);
          else reject(new Error("写真を変換できませんでした"));
        },
        "image/jpeg",
        IMAGE_QUALITY
      );
    };

    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error("この写真は読み込めませんでした"));
    };

    img.src = url;
  });
}
