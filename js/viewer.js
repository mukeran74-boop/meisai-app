// =========================================================
// viewer.js  写真の拡大表示(仕様書「14. 写真の拡大表示」)
//  ・詳細画面の写真をタップすると、黒い背景で画面いっぱいに表示する
//  ・2本指で広げると拡大、つまむと縮小(ピンチズーム)
//  ・拡大中は1本指で動かして、見たい部分へ移動できる
//  ・ダブルタップで拡大/元の大きさを切り替える
//  ・「×」で閉じる
//
// 写真の動きは「移動(x, y)」と「倍率(scale)」の3つの数字で表し、
// CSS の transform: translate(x, y) scale(scale) で画面に反映する。
// =========================================================

const viewer = document.getElementById("viewer");
const viewerImg = document.getElementById("viewer-img");

const MIN_SCALE = 1; // これより小さくはしない(元の大きさ)
const MAX_SCALE = 5; // これより大きくはしない

// 今の表示の状態
const view = { scale: 1, x: 0, y: 0 };
// 指を置いたときの状態(動かした量を計算するため)
let gesture = null;
let lastTapTime = 0;

// 拡大表示を開く
function openViewer(url) {
  viewerImg.src = url;
  resetView();
  viewer.hidden = false;
}

// 閉じる
function closeViewer() {
  viewer.hidden = true;
  viewerImg.src = "";
}

function resetView() {
  view.scale = 1;
  view.x = 0;
  view.y = 0;
  applyView(true);
}

// 数字を画面に反映する(animate が true なら、なめらかに動かす)
function applyView(animate) {
  viewerImg.style.transition = animate ? "transform 0.2s ease-out" : "none";
  viewerImg.style.transform =
    "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")";
}

// 写真が画面の外に行きすぎないように、移動できる範囲に収める
function clampPosition() {
  const rect = viewer.getBoundingClientRect();
  const maxX = ((view.scale - 1) * rect.width) / 2;
  const maxY = ((view.scale - 1) * rect.height) / 2;
  view.x = Math.min(maxX, Math.max(-maxX, view.x));
  view.y = Math.min(maxY, Math.max(-maxY, view.y));
}

// 画面の中心から見た、指の位置
function fromCenter(clientX, clientY) {
  const rect = viewer.getBoundingClientRect();
  return {
    x: clientX - (rect.left + rect.width / 2),
    y: clientY - (rect.top + rect.height / 2),
  };
}

// 2本の指の距離と、真ん中の位置
function twoFingers(touches) {
  const a = touches[0];
  const b = touches[1];
  return {
    distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
    mid: fromCenter((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2),
  };
}

// 指で押さえた位置を中心にして、倍率を変える
function zoomAt(point, startView, newScale) {
  // 指の下にある写真の点が、拡大したあとも指の下に来るように移動量を決める
  const imageX = (point.x - startView.x) / startView.scale;
  const imageY = (point.y - startView.y) / startView.scale;
  view.scale = newScale;
  view.x = point.x - imageX * newScale;
  view.y = point.y - imageY * newScale;
}

// ---------- 指の動き ----------

viewer.addEventListener("touchstart", function (event) {
  if (event.target.closest("#viewer-close")) return; // 「×」はふつうのボタンとして動かす
  const start = { scale: view.scale, x: view.x, y: view.y };

  if (event.touches.length >= 2) {
    // 2本指:ピンチの始まり
    const f = twoFingers(event.touches);
    gesture = { type: "pinch", start: start, distance: f.distance, mid: f.mid };
  } else if (event.touches.length === 1) {
    const t = event.touches[0];
    gesture = { type: "pan", start: start, x: t.clientX, y: t.clientY, moved: false };
  }
}, { passive: true });

viewer.addEventListener("touchmove", function (event) {
  if (!gesture) return;
  event.preventDefault(); // ページ自体がスクロール・拡大しないようにする

  if (gesture.type === "pinch" && event.touches.length >= 2) {
    const f = twoFingers(event.touches);
    const ratio = f.distance / gesture.distance;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, gesture.start.scale * ratio));
    zoomAt(gesture.mid, gesture.start, newScale);
    // 2本指をそろえて動かしたときは、その分だけ写真も動かす
    view.x += f.mid.x - gesture.mid.x;
    view.y += f.mid.y - gesture.mid.y;
    applyView(false);
  } else if (gesture.type === "pan" && event.touches.length === 1) {
    const t = event.touches[0];
    const dx = t.clientX - gesture.x;
    const dy = t.clientY - gesture.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) gesture.moved = true;
    if (view.scale > 1) {
      // 拡大しているときだけ、1本指で動かせる
      view.x = gesture.start.x + dx;
      view.y = gesture.start.y + dy;
      applyView(false);
    }
  }
}, { passive: false });

viewer.addEventListener("touchend", function (event) {
  if (!gesture) return;

  // ダブルタップ(0.3秒以内に2回、指を動かさずにタップ)
  if (gesture.type === "pan" && !gesture.moved && event.touches.length === 0) {
    const now = Date.now();
    if (now - lastTapTime < 300) {
      const t = event.changedTouches[0];
      if (view.scale > 1) {
        resetView();
      } else {
        zoomAt(fromCenter(t.clientX, t.clientY), { scale: 1, x: 0, y: 0 }, 2.5);
        clampPosition();
        applyView(true);
      }
      lastTapTime = 0;
      gesture = null;
      return;
    }
    lastTapTime = now;
  }

  if (event.touches.length === 0) {
    // ほぼ元の大きさなら、ぴったり元に戻す
    if (view.scale < 1.05) {
      resetView();
    } else {
      clampPosition();
      applyView(true);
    }
    gesture = null;
  } else if (event.touches.length === 1) {
    // 2本のうち1本を離したら、残った指で動かす操作に切り替える
    const t = event.touches[0];
    gesture = {
      type: "pan",
      start: { scale: view.scale, x: view.x, y: view.y },
      x: t.clientX,
      y: t.clientY,
      moved: true,
    };
  }
});

// iPhoneのSafari独自の「ページ全体を拡大する操作」を止める
viewer.addEventListener("gesturestart", function (event) {
  event.preventDefault();
});

document.getElementById("viewer-close").addEventListener("click", closeViewer);
