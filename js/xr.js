/* ============================================================
 * xr.js —— 电镜 · XR 观察台
 * 把电镜下的外泌体图当作可平移 / 缩放的"世界"，点亮点位采集外泌体。
 * 入口：window.openXR() -> Promise（采集完成或点击"离开观察台"时 resolve）
 * ============================================================ */
(function (global) {
  'use strict';

  window.openXR = function () {
    return new Promise(function (resolve) {
      var ov = document.getElementById('xrOverlay');
      var cv = document.getElementById('xrCanvas');
      var ctx = cv && cv.getContext('2d');
      var cntEl = document.getElementById('xrCount');
      var whyEl = document.getElementById('xrWhy');
      var subEl = document.getElementById('xrSub');
      var closeBtn = document.getElementById('xrClose');
      if (!ov || !cv || !ctx) { resolve(); return; }

      var IMG = 'assets/xr/exosome-em.png';
      var imgW = 1196, imgH = 1198, imgReady = false;
      var img = new Image();
      img.onload = function () { imgW = img.naturalWidth || imgW; imgH = img.naturalHeight || imgH; imgReady = true; };
      img.onerror = function () { imgReady = false; };
      img.src = IMG;

      /* 外泌体点位（图像归一化坐标 + 一句"它装着什么"） */
      var MARKERS = [
        { fx: 0.22, fy: 0.30, msg: '装着炎症的消息' },
        { fx: 0.40, fy: 0.55, msg: '装着一段记忆' },
        { fx: 0.62, fy: 0.36, msg: '装着一句问候' },
        { fx: 0.78, fy: 0.60, msg: '装着修复的指令' },
        { fx: 0.33, fy: 0.76, msg: '装着一段旧时光' },
        { fx: 0.56, fy: 0.18, msg: '装着雨的味道' },
        { fx: 0.85, fy: 0.30, msg: '装着未说完的话' }
      ];
      MARKERS.forEach(function (m) { m.got = false; m.flare = 0; });

      var cam = { cx: 0.5, cy: 0.5, zoom: 1 };
      var baseScale = 1;
      var DPR = Math.min(global.devicePixelRatio || 1, 2);
      var cw = 0, ch = 0;
      var done = false, cleaned = false, raf = 0, whyTimer = 0;
      var WHY = '电镜下，外泌体只是几十纳米的小点。但像信使——只有放进正确的语境，它才开始说话。';

      function resize() {
        cw = ov.clientWidth; ch = ov.clientHeight;
        cv.width = Math.max(1, Math.floor(cw * DPR)); cv.height = Math.max(1, Math.floor(ch * DPR));
        cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        baseScale = Math.min(cw / imgW, ch / imgH);
      }
      function sc() { return baseScale * cam.zoom; }
      function toScreen(fx, fy) {
        var s = sc();
        return { x: cw / 2 + (fx * imgW - cam.cx * imgW) * s, y: ch / 2 + (fy * imgH - cam.cy * imgH) * s };
      }
      function clampCam() {
        var s = sc();
        var halfW = (cw / 2) / s / imgW, halfH = (ch / 2) / s / imgH;
        if (cam.zoom < 1) { cam.cx = 0.5; cam.cy = 0.5; return; }
        cam.cx = Math.max(Math.min(cam.cx, 1 - halfW), halfW);
        cam.cy = Math.max(Math.min(cam.cy, 1 - halfH), halfH);
      }

      /* —— 指针输入 —— */
      var drag = null;
      function getXY(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
      function down(e) {
        var p = getXY(e); drag = { x: p.x, y: p.y, cx: cam.cx, cy: cam.cy, moved: false };
        if (ov.setPointerCapture && e.pointerId != null) { try { ov.setPointerCapture(e.pointerId); } catch (ex) { } }
      }
      function move(e) {
        if (!drag) return;
        var p = getXY(e), dx = p.x - drag.x, dy = p.y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        var s = sc();
        cam.cx = drag.cx - dx / (imgW * s);
        cam.cy = drag.cy - dy / (imgH * s);
        clampCam();
      }
      function up(e) {
        if (drag && !drag.moved) tryCollect(getXY(e));
        drag = null;
      }
      function wheel(e) {
        e.preventDefault();
        var p = getXY(e), before = toImg(p.x, p.y);
        cam.zoom = Math.max(1, Math.min(4, cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
        clampCam();
        var after = toImg(p.x, p.y);
        cam.cx += before.fx - after.fx; cam.cy += before.fy - after.fy;
        clampCam();
      }
      function toImg(px, py) {
        var s = sc();
        return { fx: (cam.cx * imgW + (px - cw / 2) / s) / imgW, fy: (cam.cy * imgH + (py - ch / 2) / s) / imgH };
      }
      function tryCollect(p) {
        for (var i = 0; i < MARKERS.length; i++) {
          var m = MARKERS[i]; if (m.got) continue;
          var s = toScreen(m.fx, m.fy);
          if (Math.hypot(s.x - p.x, s.y - p.y) < 26) {
            m.got = true; m.flare = 1; showWhy(m.msg);
            if (window.ESCORE) window.ESCORE.addExo(1, 'xr' + i);
            updateCount();
            return;
          }
        }
      }
      function showWhy(msg) {
        whyEl.textContent = msg + '。' + WHY;
        whyEl.classList.add('on');
        clearTimeout(whyTimer);
        whyTimer = setTimeout(function () { whyEl.classList.remove('on'); }, 3200);
      }
      function updateCount() {
        var n = MARKERS.filter(function (m) { return m.got; }).length;
        cntEl.textContent = '发现 ' + n + ' / ' + MARKERS.length;
        if (n >= MARKERS.length && !done) {
          done = true;
          whyEl.textContent = '七枚外泌体都收到了。它们一起，拼成一句没说出口的话。';
          whyEl.classList.add('on');
          setTimeout(finish, 1700);
        }
      }

      function cleanup() {
        if (cleaned) return; cleaned = true;
        cancelAnimationFrame(raf);
        ov.removeEventListener('pointerdown', down);
        ov.removeEventListener('pointermove', move);
        ov.removeEventListener('pointerup', up);
        window.removeEventListener('wheel', wheel, { passive: false });
        global.removeEventListener('resize', resize);
        if (closeBtn) closeBtn.removeEventListener('click', onClose);
        ov.classList.add('hidden');
        document.body.classList.remove('xr-open');
      }
      function onClose() { cleanup(); resolve(); }
      function finish() { cleanup(); resolve(); }

      /* —— 启动 —— */
      ov.classList.remove('hidden');
      document.body.classList.add('xr-open');   /* 标记：打开期间彻底遮住窗景场景，避免背景透出 */
      var t0 = performance.now();
      if (subEl) subEl.textContent = '拖拽平移 · 滚轮 / 双指缩放 · 点击发光点采集外泌体';
      cntEl.textContent = '发现 0 / ' + MARKERS.length;
      resize();
      ov.addEventListener('pointerdown', down);
      ov.addEventListener('pointermove', move);
      ov.addEventListener('pointerup', up);
      window.addEventListener('wheel', wheel, { passive: false });
      global.addEventListener('resize', resize);
      if (closeBtn) {
        /* 关闭按钮的指针事件不冒泡到观察台，避免被当成"拖拽平移"导致图片侧移 */
        closeBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        closeBtn.addEventListener('click', onClose);
      }

      /* —— 渲染循环 —— */
      (function loop() {
        raf = requestAnimationFrame(loop);
        var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, cw, ch);

        var s = sc();
        var ox = cw / 2 - cam.cx * imgW * s;
        var oy = ch / 2 - cam.cy * imgH * s;
        if (imgReady) ctx.drawImage(img, ox, oy, imgW * s, imgH * s);
        else { ctx.fillStyle = '#000000'; ctx.fillRect(ox, oy, imgW * s, imgH * s); }

        /* 扫描线（XR 味） */
        var scan = (now / 26) % ch;
        ctx.fillStyle = 'rgba(120,220,190,.05)'; ctx.fillRect(0, scan, cw, 2);
        /* 暗角 */
        var vg = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, cw, ch);

        /* 点位 */
        for (var i = 0; i < MARKERS.length; i++) {
          var m = MARKERS[i];
          var p = toScreen(m.fx, m.fy);
          if (p.x < -40 || p.x > cw + 40 || p.y < -40 || p.y > ch + 40) continue;
          if (!m.got) {
            var pulse = 0.5 + 0.5 * Math.sin(now / 380 + i);
            var r = 9 + pulse * 3;
            var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r + 12);
            g.addColorStop(0, 'rgba(255,230,150,.9)');
            g.addColorStop(.4, 'rgba(255,200,90,.5)');
            g.addColorStop(1, 'rgba(255,200,90,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r + 12, 0, 6.283); ctx.fill();
            ctx.fillStyle = 'rgba(255,245,210,.95)'; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 6.283); ctx.fill();
          } else {
            if (m.flare > 0) {
              var fr = (1 - m.flare) * 42;
              ctx.strokeStyle = 'rgba(120,230,180,' + m.flare + ')'; ctx.lineWidth = 2;
              ctx.beginPath(); ctx.arc(p.x, p.y, 10 + fr, 0, 6.283); ctx.stroke();
              m.flare -= 0.02; if (m.flare < 0) m.flare = 0;
            }
            ctx.strokeStyle = 'rgba(120,230,180,.9)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 6.283); ctx.stroke();
            ctx.strokeStyle = 'rgba(150,240,200,.95)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x - 1, p.y + 3); ctx.lineTo(p.x + 4, p.y - 3); ctx.stroke();
          }
        }
      })();
    });
  };
})(window);
