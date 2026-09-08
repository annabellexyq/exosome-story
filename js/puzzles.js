/* ============================================================
 * puzzles.js —— 基于每集背景图的 2D 叙事解谜
 * 玩法直接叠在 assets/bg/epNN.png 上，像《绣湖》那样在画面里点触互动：
 *   找物 / 拼图 / 拖到目标 / 连线顺序 / 时机点击 / 呼吸节奏 /
 *   对焦 / 旋转季节 / 排序 / 点亮 / 跟随 / 描线
 * 入口：window.PUZZLES.play(id, canvas, titleEl, hintEl) -> Promise
 * ============================================================ */
(function (global) {
  'use strict';

  var W = 900, H = 520;

  /* 当前激活的 api（用于 cell 模式判断）与时间戳 */
  var ACTIVE = null, CELL_T = 0;
  /* 每真正收集到一枚：左上角外泌体实时 +1，并飞一个光点过去 */
  function recordClick(n) {
    try { if (window.ESCORE && window.ESCORE.gain) window.ESCORE.gain(n || 1); } catch (e) {}
  }

  /* ---------------- 基础工具 ---------------- */
  function R(a, b) { return a + Math.random() * (b - a); }
  function hit(x, y, cx, cy, r) { var dx = x - cx, dy = y - cy; return dx * dx + dy * dy < r * r; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function glow(ctx, x, y, r, c) {
    /* 外层柔光（体积感 / UE 式 bloom） */
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c); g.addColorStop(.55, c.replace(/[\d.]+\)$/, '0.28)')); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    /* 高亮内核（菲涅尔式亮心，强化"渲染发光体"质感） */
    var cr = Math.max(2, r * 0.34);
    var g2 = ctx.createRadialGradient(x, y, 0, x, y, cr);
    g2.addColorStop(0, 'rgba(255,255,255,.92)'); g2.addColorStop(1, c);
    ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(x, y, cr, 0, 6.283); ctx.fill();
  }
  function txt(ctx, s, x, y, size, col, align) {
    ctx.save();
    ctx.font = size + 'px "PingFang SC","Hiragino Sans GB",sans-serif';
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    y = Math.max(38 + size / 2, Math.min(H - 38 - size / 2, y));
    try { ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1; } catch (e) { }
    ctx.fillStyle = col; ctx.fillText(s, x, y);
    ctx.restore();
  }
  /* 顶部提示条：在带内边距的半透明圆角框内上下居中，避免贴着上框 */
  function hud(ctx, main, sub) {
    var lines = sub ? [main, sub] : [main];
    ctx.save();
    ctx.font = '17px "PingFang SC","Hiragino Sans GB",sans-serif';
    var w = ctx.measureText(main).width;
    if (sub) { ctx.font = '13px "PingFang SC","Hiragino Sans GB",sans-serif'; w = Math.max(w, ctx.measureText(sub).width); }
    var lh = 24, padX = 26, padY = 12, mTop = 14;
    var bw = Math.min(W - 32, w + padX * 2), bh = lines.length * lh + padY * 2;
    var bx = (W - bw) / 2, by = mTop;
    /* 让 HUD 信息条不超出游戏装饰内框(46..W-46) */
    if (bx < 46) bx = 46; if (bx + bw > W - 46) bx = W - 46 - bw;
    ctx.fillStyle = 'rgba(14,16,24,.62)'; roundRect(ctx, bx, by, bw, bh, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; roundRect(ctx, bx, by, bw, bh, 14); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 4;
    var cy0 = by + bh / 2 - (lines.length - 1) * lh / 2;
    for (var i = 0; i < lines.length; i++) {
      ctx.font = (i === 0 ? '17px' : '13px') + ' "PingFang SC","Hiragino Sans GB",sans-serif';
      ctx.fillStyle = i === 0 ? '#f3ece1' : 'rgba(201,191,174,.85)';
      ctx.fillText(lines[i], W / 2, cy0 + i * lh);
    }
    ctx.restore();
  }
  function hexa(hex, a) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  /* 中文按宽度折行（用于科普浮层） */
  function wrapTxt(ctx, s, max) {
    var lines = [], cur = '';
    ctx.font = '15px "PingFang SC","Hiragino Sans GB",sans-serif';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      cur += ch;
      if (ctx.measureText(cur).width > max) { lines.push(cur); cur = ''; }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  /* 每关最佳成绩（localStorage 持久化） */
  function bestGet(id) {
    try { var v = localStorage.getItem('exo_best_' + id); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function bestPut(id, rec) {
    try { localStorage.setItem('exo_best_' + id, JSON.stringify(rec)); } catch (e) { }
  }

  /* 每种机制的"为什么这样玩"——一句科普/情绪注解 */
  var WHY = {
    catch: '飘动的光点是细胞里的囊泡与信号——轻轻"收"住它们，像把散落的记忆重新捧在手心。',
    rhythm: '呼吸的节律，对应细胞与外界同步的钙振荡；在合拍的瞬间轻点，是学着与世界同频。',
    jigsaw: '破碎的相纸要拼回原样——记忆本就由碎片复原，动手拼合也是在重组一段往事。',
    find: '在纷乱里认出旧物，是把被冲散的情绪一件件认领回来。',
    align: '对焦，是让模糊的画面变清晰；很多事只是还没"对准"，并非不存在。',
    sequence: '记住并复现顺序，是大脑巩固记忆的方式——把名字排进心底。',
    drag: '把囊泡送进膜孔，像把一句话轻轻递到对的人手里。',
    timing: '在恰好的时刻落下，是耐心的练习；早一点晚一点，都不如刚好。',
    follow: '替所爱之人挡雨，是陪伴最朴素的样子——撑住，别让雨淋湿了对方。',
    trace: '顺着光点描完一行，是把想说却没说出口的话，一笔一笔写下来。',
    order: '把照片按年份排好，时间才有了顺序，思念也找到了位置。',
    rotate: '转到对的季节并停住，是学着在变化里安定——四季流转，终会到"秋"。',
    stars: '每点亮一颗星，就把一枚思念送回夜空；十六颗，是十六次温柔的告别。'
  };
  /* 难度：微观（细胞）关比对应宏观关更难，越往后集数略难 */
  function scaleDifficulty(cfg) {
    if (cfg._scaled) return cfg;
    cfg._scaled = true;
    var micro = !!cfg.cell, ep = cfg.ep || 0, late = micro ? 0 : Math.max(0, ep - 8);
    if (cfg.arch === 'catch') { cfg.need = (cfg.need || 8) + (micro ? 3 : 0); cfg.spawn = micro ? .42 : .5; }
    if (cfg.arch === 'jigsaw') { cfg.cols = (cfg.cols || 3) + (micro ? 1 : 0); }
    if (cfg.arch === 'rhythm') { cfg.bandLo = .80 + (micro ? .02 : 0) + late * 0.003; cfg.bandHi = .97 - (micro ? .01 : 0) - late * 0.003; }
    if (cfg.arch === 'align') { cfg.tol = Math.max(.03, .06 - (micro ? .015 : 0) - late * 0.003); }
    if (cfg.arch === 'sequence') { cfg.show = Math.max(.42, .7 - (micro ? .15 : 0) - Math.max(0, ep - 10) * 0.02); }
    if (cfg.arch === 'timing') { cfg.speed = 1 + (micro ? .35 : 0) + late * 0.03; }
    if (cfg.arch === 'follow') { cfg.rain = 1 + (micro ? .3 : 0) + late * 0.02; }
    if (cfg.arch === 'trace') { cfg.spd = .34 + (micro ? .08 : 0) + late * 0.01; }
    return cfg;
  }
  function star(ctx, x, y, r, c) {
    ctx.fillStyle = c; ctx.beginPath();
    for (var i = 0; i < 10; i++) { var a = i / 10 * 6.283 - 1.57, rr = i % 2 ? r * .45 : r; i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  function badge(ctx, x, y, icon) {
    ctx.save();
    ctx.fillStyle = 'rgba(18,22,32,.85)'; ctx.beginPath(); ctx.arc(x, y, 22, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = '24px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon, x, y + 1);
    ctx.restore();
  }
  function cover(ctx, im) {
    var ir = im.width / im.height, cr = W / H, dw, dh, dx, dy;
    if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
    else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
    ctx.drawImage(im, dx, dy, dw, dh);
  }
  function drawBG(ctx, bg, dimA) {
    ctx.fillStyle = '#0c0f17'; ctx.fillRect(0, 0, W, H);
    if (ACTIVE && ACTIVE.cell) {
      if (bg) cover(ctx, bg);
      else { ctx.fillStyle = '#0c0f17'; ctx.fillRect(0, 0, W, H); }
      if (dimA) { ctx.fillStyle = 'rgba(8,10,16,' + dimA + ')'; ctx.fillRect(0, 0, W, H); }
      ctx.save(); ctx.globalAlpha = 0.82; drawCell(ctx); ctx.restore();
    }
    else {
      if (bg) cover(ctx, bg);
      if (dimA) { ctx.fillStyle = 'rgba(8,10,16,' + dimA + ')'; ctx.fillRect(0, 0, W, H); }
    }
    /* 边缘渐暗，增加景深，让所有玩法背景更"嵌"进画面 */
    var vg = ctx.createRadialGradient(W / 2, H / 2, W * 0.28, W / 2, H / 2, W * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.38)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* 微观：合成一个细胞（细胞质 / 膜 / 核），作为微观游戏的背景 */
  function drawCell(ctx) {
    CELL_T += 0.016;
    var cx = W / 2, cy = H / 2;
    /* 细胞质体积：中心透亮、边缘沉下去 */
    var g = ctx.createRadialGradient(cx, cy, 40, cx, cy, W * 0.72);
    g.addColorStop(0, '#16344c'); g.addColorStop(1, '#0a1420');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    /* 细胞质体积感：边缘压暗（环境光遮蔽，增加 3D 厚度） */
    var ao = ctx.createRadialGradient(cx, cy, W * 0.30, cx, cy, W * 0.72);
    ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,.35)');
    ctx.fillStyle = ao; ctx.fillRect(0, 0, W, H);
    /* 细胞骨架：极淡的纤维网，让"里面"不是空场 */
    ctx.save();
    ctx.strokeStyle = 'rgba(127,168,216,.055)'; ctx.lineWidth = 1;
    for (var k = 0; k < 9; k++) {
      var ka = k / 9 * 6.283 + CELL_T * .06;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ka) * 60, cy + Math.sin(ka) * 40);
      ctx.quadraticCurveTo(cx + Math.cos(ka + .6) * 210, cy + Math.sin(ka + .6) * 130,
        cx + Math.cos(ka) * (W * .46), cy + Math.sin(ka) * (H * .46));
      ctx.stroke();
    }
    ctx.restore();
    /* 细胞核 + 染色质颗粒 */
    var nx = W * 0.66, ny = H * 0.40, nr = 110;
    var ng = ctx.createRadialGradient(nx, ny, 10, nx, ny, nr);
    ng.addColorStop(0, 'rgba(127,168,216,.45)'); ng.addColorStop(1, 'rgba(127,168,216,0)');
    ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(nx, ny, nr, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(127,168,216,.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(nx, ny, nr * 0.6, 0, 6.283); ctx.stroke();
    for (k = 0; k < 12; k++) {
      var ca = k / 12 * 6.283 + CELL_T * .25, cr = 28 + (k % 4) * 18;
      ctx.fillStyle = 'rgba(190,215,245,' + (.14 + (k % 3) * .05) + ')';
      ctx.beginPath(); ctx.arc(nx + Math.cos(ca) * cr, ny + Math.sin(ca) * cr * .9, 2.2 + (k % 3) * .8, 0, 6.283); ctx.fill();
    }
    /* 飘浮的细胞器 */
    for (var i = 0; i < 14; i++) {
      var a = i / 14 * 6.283 + CELL_T * 0.3, r = 60 + (i % 5) * 60;
      var x = W / 2 + Math.cos(a) * r * 0.8 + Math.sin(CELL_T + i) * 20;
      var y = H / 2 + Math.sin(a) * r * 0.5 + Math.cos(CELL_T * 0.7 + i) * 16;
      glow(ctx, x, y, 10 + (i % 3) * 4, 'rgba(127,168,216,.10)');
    }
    /* 外泌体：主角级别的金色小囊泡，缓慢巡游 */
    for (i = 0; i < 7; i++) {
      var va = CELL_T * .45 + i * 6.283 / 7, vr = 130 + (i % 3) * 70;
      var vx = cx + Math.cos(va) * vr, vy = cy + Math.sin(va) * vr * .58;
      glow(ctx, vx, vy, 16, 'rgba(232,180,92,.13)');
      ctx.fillStyle = 'rgba(255,240,205,.55)'; ctx.beginPath(); ctx.arc(vx, vy, 3.4, 0, 6.283); ctx.fill();
    }
    /* 细胞膜（脂质双分子层：双环 + 虚线磷脂头），带极缓呼吸 */
    var br = 1 + Math.sin(CELL_T * .8) * .004;
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(br, br); ctx.translate(-cx, -cy);
    roundRect(ctx, 46, 46, W - 92, H - 92, 60);
    ctx.strokeStyle = 'rgba(232,180,92,.55)'; ctx.lineWidth = 12; ctx.stroke();
    ctx.save();
    ctx.setLineDash([2, 11]); ctx.lineCap = 'round';
    roundRect(ctx, 46, 46, W - 92, H - 92, 60);
    ctx.strokeStyle = 'rgba(255,238,205,.5)'; ctx.lineWidth = 9; ctx.stroke();
    ctx.restore();
    roundRect(ctx, 60, 60, W - 120, H - 120, 52);
    ctx.strokeStyle = 'rgba(232,180,92,.28)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
    /* 菲涅尔高光：膜的上缘受光更亮（渲染质感） */
    ctx.save();
    roundRect(ctx, 46, 46, W - 92, H - 92, 60); ctx.clip();
    var fg = ctx.createLinearGradient(0, 40, 0, H * 0.5);
    fg.addColorStop(0, 'rgba(255,236,200,.22)'); fg.addColorStop(1, 'rgba(255,236,200,0)');
    ctx.fillStyle = fg; ctx.fillRect(0, 40, W, H * 0.5);
    /* 膜内侧的环境反光（下缘补一点冷光，托出厚度） */
    var fg2 = ctx.createLinearGradient(0, H - 46, 0, H * .6);
    fg2.addColorStop(0, 'rgba(127,168,216,.16)'); fg2.addColorStop(1, 'rgba(127,168,216,0)');
    ctx.fillStyle = fg2; ctx.fillRect(0, H * .6, W, H * .4);
    ctx.restore();
    txt(ctx, '细胞外泌体视角 · 细胞质', W / 2, H - 30, 14, 'rgba(201,191,174,.6)');
  }

  /* ============================================================
   * 后期烘焙（Post FX）：所有小游戏统一叠加的电影感处理
   *   环境浮尘 → 柔光 bloom → 冷暖分级 → 暗角 → 胶片颗粒
   * 只作用于真实运行帧（无头 makeTest 不经过 frame，不受影响）
   * ============================================================ */
  var fxCv = null, fxCtx = null, grainCv = null, dust = [];
  function ensureFX() {
    if (fxCv) return;
    fxCv = document.createElement('canvas');
    fxCv.width = Math.max(1, Math.ceil(W / 4)); fxCv.height = Math.max(1, Math.ceil(H / 4));
    fxCtx = fxCv.getContext('2d');
    /* 一次性烘焙噪点贴图（胶片颗粒） */
    grainCv = document.createElement('canvas'); grainCv.width = grainCv.height = 128;
    var g2 = grainCv.getContext('2d'), idat = g2.createImageData(128, 128), dd = idat.data;
    for (var n = 0; n < dd.length; n += 4) {
      var v = 128 + (Math.random() * 2 - 1) * 30;
      dd[n] = dd[n + 1] = dd[n + 2] = v; dd[n + 3] = 30;
    }
    g2.putImageData(idat, 0, 0);
    /* 环境浮尘 */
    for (n = 0; n < 46; n++) dust.push({
      x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.5 + .5,
      vx: (Math.random() - .5) * .1, vy: -(Math.random() * .22 + .04),
      a: Math.random() * .45 + .12, ph: Math.random() * 6.28
    });
  }
  function postFX(ctx, ts, dt) {
    ensureFX();
    var i, d;
    /* 环境浮尘（空气感 / 景深微粒） */
    ctx.save();
    for (i = 0; i < dust.length; i++) {
      d = dust[i];
      d.x += d.vx * dt * 60; d.y += d.vy * dt * 60; d.ph += dt * 1.2;
      if (d.y < -6) { d.y = H + 6; d.x = Math.random() * W; }
      if (d.x < -6) d.x = W + 6; else if (d.x > W + 6) d.x = -6;
      var tw = .55 + .45 * Math.sin(d.ph);
      ctx.globalAlpha = d.a * tw * .55;
      ctx.fillStyle = '#ffeacb';
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill();
    }
    ctx.restore();
    /* 柔光 bloom：1/4 分辨率模糊后以 lighter 回叠，只提亮不糊掉细节 */
    if (fxCtx) {
      try {
        fxCtx.clearRect(0, 0, fxCv.width, fxCv.height);
        fxCtx.filter = 'blur(3px)';
        fxCtx.drawImage(ctx.canvas, 0, 0, fxCv.width, fxCv.height);
        fxCtx.filter = 'none';
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = .13;
        ctx.drawImage(fxCv, 0, 0, W, H);
        ctx.restore();
      } catch (e) { }
    }
    /* 冷暖分级：上暖下冷，统一整个故事的影调 */
    ctx.save();
    var cg = ctx.createLinearGradient(0, 0, 0, H);
    cg.addColorStop(0, 'rgba(255,212,146,.06)');
    cg.addColorStop(.5, 'rgba(255,255,255,0)');
    cg.addColorStop(1, 'rgba(96,156,196,.08)');
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    /* 暗角：把视线收进画面中心 */
    var vg = ctx.createRadialGradient(W / 2, H / 2, W * .34, W / 2, H / 2, W * .88);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.4)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    /* 胶片颗粒：细噪点，去掉"数字感" */
    if (grainCv) {
      ctx.save();
      ctx.globalAlpha = .55;
      ctx.globalCompositeOperation = 'overlay';
      var ox = (ts * .03) % 128, oy = (ts * .017) % 128;
      for (var gx = -128; gx < W; gx += 128) {
        for (var gy = -128; gy < H; gy += 128) ctx.drawImage(grainCv, gx + ox, gy + oy);
      }
      ctx.restore();
    }
  }

  function sfx(name) { try { if (global.Audio2 && global.Audio2.sfx[name]) global.Audio2.sfx[name](); } catch (e) { } }

  /* ---------------- 背景图缓存 ---------------- */
  var imgCache = {};
  function loadBG(ep, cb) {
    var key = 'ep' + (ep < 10 ? '0' + ep : ep);
    if (imgCache[key]) { cb(imgCache[key].ok ? imgCache[key].img : null); return; }
    var im = new Image();
    im.onload = function () { imgCache[key] = { ok: true, img: im }; cb(im); };
    im.onerror = function () { imgCache[key] = { ok: false }; cb(null); };
    im.src = 'assets/bg/' + key + '.png';
  }

  /* ============================================================
   * 各玩法原型：create(cfg, api) -> {update(ctx,dt,inp,api), tap?,down?,move?,up?,drag?}
   * 每帧把"待测可点目标"挂到 this._* 上，供无头测试调用，也方便阅读进度。
   * ============================================================ */

  /* E01/E08 收集：点住飘动的发光体 */
  function archCatch(cfg, api) {
    var need = cfg.need || 8, drift = cfg.drift || 0, list = [], got = 0, spawn = 0, t = 0, flashes = [];
    function mk() { return { x: R(70, W - 70), y: R(70, H - 120), vx: R(-.3, .3), vy: drift ? R(.4, 1) : R(-.3, .3), r: R(12, 20), a: R(0, 6.28), on: true }; }
    for (var i = 0; i < Math.min(5, need); i++) list.push(mk());
    return {
      update: function (ctx, dt) {
        t += dt; spawn -= dt;
        if (spawn <= 0 && list.filter(function (p) { return p.on; }).length < need) { list.push(mk()); spawn = cfg.spawn || .5; }
        drawBG(ctx, api.bg, .34);
        /* 源细胞：光点从这里被"收集" */
        glow(ctx, 90, H / 2, 70, 'rgba(127,168,216,.18)');
        for (var i = list.length - 1; i >= 0; i--) {
          var p = list[i]; if (!p.on) continue;
          p.a += .05; p.x += p.vx; p.y += p.vy * dt * 30;
          if (drift && p.y > H - 70) { p.on = false; continue; }
          if (p.x < 50 || p.x > W - 50) p.vx *= -1;
          var s = p.r * (1 + .12 * Math.sin(p.a));
          ctx.strokeStyle = 'rgba(255,240,210,.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, s * 2.2, 0, 6.283); ctx.stroke();
          glow(ctx, p.x, p.y, s * 3, 'rgba(255,230,170,.5)');
          ctx.fillStyle = 'rgba(255,245,210,.95)'; ctx.beginPath(); ctx.arc(p.x, p.y, s * .4, 0, 6.283); ctx.fill();
        }
        for (i = flashes.length - 1; i >= 0; i--) { var f = flashes[i]; f.a -= dt * 2; if (f.a <= 0) { flashes.splice(i, 1); continue; } ctx.strokeStyle = 'rgba(232,180,92,' + f.a + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, 20 + (1 - f.a) * 36, 0, 6.283); ctx.stroke(); }
        hud(ctx, (cfg.label || '收集') + ' ' + got + ' / ' + need);
        if (got >= need) api.done({ ok: true, count: got });
        this._motes = list; this._got = got;
      },
      tap: function (x, y) {
        for (var i = 0; i < list.length; i++) { var p = list[i]; if (p.on && hit(x, y, p.x, p.y, p.r * 2.4)) { p.on = false; got++; flashes.push({ x: p.x, y: p.y, a: 1 }); sfx('click'); recordClick(1); return; } }
      }
    };
  }

  /* E02 呼吸：光环进入外圈光圈时轻点，三次 */
  function archRhythm(cfg, api) {
    var ph = 0, base = 70, amp = 150, bandLo = cfg.bandLo || .80, bandHi = cfg.bandHi || .97, hits = 0, t = 0, hr = 0;
    return {
      update: function (ctx, dt) {
        t += dt; ph += dt * 1.05; if (hr > 0) hr = Math.max(0, hr - dt * 2.5);
        var cyc = (Math.sin(ph) + 1) / 2, rad = base + cyc * amp;
        var lo = base + bandLo * amp, hi = base + bandHi * amp, inb = rad >= lo && rad <= hi;
        drawBG(ctx, api.bg, .42);
        var cx = W / 2, cy = H / 2 + 10;
        glow(ctx, cx, cy, (lo + hi) / 2 + 16 + (inb ? 10 : 0), 'rgba(255,226,160,' + (inb ? .3 : .1) + ')');
        ctx.strokeStyle = 'rgba(160,200,255,.14)'; ctx.lineWidth = 26;
        ctx.beginPath(); ctx.arc(cx, cy, (lo + hi) / 2, 0, 6.283); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, base + amp + 20, 0, 6.283); ctx.stroke();
        ctx.strokeStyle = inb ? 'rgba(255,226,160,.95)' : 'rgba(180,210,255,.5)';
        ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.283); ctx.stroke();
        if (hr > 0) { ctx.strokeStyle = 'rgba(121,194,182,' + hr + ')'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, rad + (1 - hr) * 50, 0, 6.283); ctx.stroke(); }
        glow(ctx, cx, cy, rad * .8, 'rgba(120,170,255,.06)');
        txt(ctx, inb ? '现在 · 轻点' : '跟着呼吸', cx, cy, 24, 'rgba(243,236,225,.85)');
        hud(ctx, '共鸣 ' + hits + ' / 3');
        if (hits >= 3) api.done({ ok: true, count: hits });
        this._bandOk = inb;
      },
      tap: function () { if (this._bandOk) { hits++; hr = 1; sfx('good'); recordClick(1); } }
    };
  }

  /* E03 拼图：把相纸碎片拖回原位 */
  function archJigsaw(cfg, api) {
    var cols = cfg.cols || 3, rows = cfg.rows || 2, cw = W / cols, ch = H / rows, pieces = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) pieces.push({ c: c, r: r, hx: c * cw + cw / 2, hy: r * ch + ch / 2, x: 0, y: 0, locked: false });
    var order = pieces.slice().sort(function () { return Math.random() - .5; });
    var trayY = H - ch / 2 - 14;
    for (var i = 0; i < order.length; i++) { order[i].x = W / (order.length + 1) * (i + 1); order[i].y = trayY; }
    var drag = null;
    function drawPiece(ctx, p, alpha) {
      ctx.save(); ctx.globalAlpha = alpha;
      if (api.bg) ctx.drawImage(api.bg, p.c * cw, p.r * ch, cw, ch, p.x - cw / 2, p.y - ch / 2, cw, ch);
      else { ctx.fillStyle = 'rgba(120,140,170,.5)'; ctx.fillRect(p.x - cw / 2, p.y - ch / 2, cw, ch); }
      ctx.strokeStyle = 'rgba(255,255,255,.32)'; ctx.lineWidth = 1.5; ctx.strokeRect(p.x - cw / 2, p.y - ch / 2, cw, ch);
      ctx.restore();
    }
    return {
      update: function (ctx) {
        drawBG(ctx, api.bg, 0);
        ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
        for (var c = 0; c <= cols; c++) { ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, H); ctx.stroke(); }
        for (var r2 = 0; r2 <= rows; r2++) { ctx.beginPath(); ctx.moveTo(0, r2 * ch); ctx.lineTo(W, r2 * ch); ctx.stroke(); }
        for (var i = 0; i < pieces.length; i++) { var p = pieces[i]; if (p.locked) drawPiece(ctx, p, 1); }
        for (i = 0; i < pieces.length; i++) { p = pieces[i]; if (!p.locked) drawPiece(ctx, p, .92); }
        var lockedN = pieces.filter(function (p) { return p.locked; }).length;
        hud(ctx, '把碎片拖回原位 · ' + lockedN + ' / ' + pieces.length);
        if (lockedN >= pieces.length) api.done({ ok: true, count: lockedN });
        this._pieces = pieces; this._cw = cw; this._ch = ch;
      },
      down: function (x, y) { for (var i = pieces.length - 1; i >= 0; i--) { var p = pieces[i]; if (!p.locked && Math.abs(x - p.x) < cw / 2 && Math.abs(y - p.y) < ch / 2) { drag = p; return; } } },
      move: function (x, y) { if (drag) { drag.x = x; drag.y = y; } },
      up: function () { if (drag) { var p = drag; if (Math.abs(p.x - p.hx) < cw * .45 && Math.abs(p.y - p.hy) < ch * .45) { p.locked = true; p.x = p.hx; p.y = p.hy; recordClick(1); } drag = null; } }
    };
  }

  /* E04 找物：在画面里找出并轻触旧物 */
  function archFind(cfg, api) {
    var items = cfg.items.map(function (it) { return { fx: it.fx, fy: it.fy, icon: it.icon, found: false, ph: R(0, 6.28), pop: 0 }; });
    var t = 0;
    return {
      update: function (ctx, dt) {
        t += dt; drawBG(ctx, api.bg, .42);
        for (var i = 0; i < items.length; i++) items[i].ph += dt * 2.2;
        var sy = (t * .25 % 1) * H;
        var sg = ctx.createLinearGradient(0, sy - 30, 0, sy + 30); sg.addColorStop(0, 'rgba(121,194,182,0)'); sg.addColorStop(.5, 'rgba(121,194,182,.10)'); sg.addColorStop(1, 'rgba(121,194,182,0)');
        ctx.fillStyle = sg; ctx.fillRect(0, sy - 30, W, 60);
        for (i = 0; i < items.length; i++) {
          var it = items[i]; if (it.found) continue;
          var x = it.fx * W, y = it.fy * H, pul = .5 + .5 * Math.sin(it.ph);
          ctx.strokeStyle = 'rgba(255,226,160,' + (.35 + .3 * pul) + ')'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(x, y, 30 + pul * 6, 0, 6.283); ctx.stroke();
          glow(ctx, x, y, 40 + pul * 8, 'rgba(255,226,160,.16)');
          badge(ctx, x, y, it.icon);
        }
        hud(ctx, cfg.hint2 || '在画面里找出并轻触旧物');
        var n = items.length, startX = W / 2 - (n - 1) * 34;
        for (i = 0; i < items.length; i++) {
          var it2 = items[i], tx = startX + i * 68;
          ctx.globalAlpha = it2.found ? .25 : 1; badge(ctx, tx, H - 46, it2.icon); ctx.globalAlpha = 1;
          if (it2.found) { ctx.strokeStyle = 'rgba(121,194,182,.95)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(tx - 12, H - 58); ctx.lineTo(tx - 4, H - 50); ctx.lineTo(tx + 14, H - 68); ctx.stroke(); }
          if (it2.pop > 0) { it2.pop = Math.max(0, it2.pop - dt * 2); ctx.strokeStyle = 'rgba(232,180,92,' + it2.pop + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(it2.fx * W, it2.fy * H, 34 + (1 - it2.pop) * 40, 0, 6.283); ctx.stroke(); }
        }
        if (items.every(function (p) { return p.found; })) api.done({ ok: true, count: items.length });
        this._items = items;
      },
      tap: function (x, y) {
        for (var i = 0; i < items.length; i++) { var it = items[i]; if (!it.found && hit(x, y, it.fx * W, it.fy * H, 46)) { it.found = true; it.pop = 1; sfx('click'); recordClick(1); return; } }
      }
    };
  }

  /* E05 对焦：左右拖动让画面清晰 */
  function archAlign(cfg, api) {
    var target = R(.45, .72), f = .1, hold = 0, t = 0, tol = cfg.tol || .06, clickRec = false;
    return {
      update: function (ctx, dt) {
        t += dt; var blur = Math.abs(f - target), clear = Math.max(0, 1 - blur);
        drawBG(ctx, api.bg, 0);
        ctx.fillStyle = 'rgba(200,210,225,' + Math.min(.7, blur * .95) + ')'; ctx.fillRect(0, 0, W, H);
        if (clear > .7) glow(ctx, W / 2, H / 2, 160 * clear, 'rgba(255,240,210,' + (.08 * (clear - .7) / .3) + ')');
        hud(ctx, '清晰度 ' + Math.round(clear * 100) + '%');
        var sx = 120, sy = H - 70, sw = W - 240;
        var g2 = ctx.createLinearGradient(sx, 0, sx + sw, 0); g2.addColorStop(0, 'rgba(255,255,255,.08)'); g2.addColorStop(1, 'rgba(255,255,255,.18)');
        ctx.fillStyle = g2; ctx.fillRect(sx, sy, sw, 8);
        var tx = sx + sw * target, pul = .5 + .5 * Math.sin(t * 4);
        glow(ctx, tx, sy + 4, 16 + pul * 6, 'rgba(121,194,182,.4)');
        ctx.fillStyle = 'rgba(121,194,182,.6)'; ctx.fillRect(tx - 12, sy - 5, 24, 18);
        var kx = sx + sw * f; ctx.fillStyle = '#e8b45c'; ctx.beginPath(); ctx.arc(kx, sy + 4, 13, 0, 6.283); ctx.fill();
        if (Math.abs(f - target) < tol) { ctx.strokeStyle = 'rgba(232,180,92,' + pul + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(kx, sy + 4, 18, 0, 6.283); ctx.stroke(); }
        txt(ctx, '左右拖动对焦环，让画面清晰', W / 2, H - 36, 13, '#c9bfae');
        hold = blur < tol ? hold + dt : Math.max(0, hold - dt * 2);
        if (hold >= 1 && !clickRec) { clickRec = true; recordClick(1); }
        if (hold >= 1) api.done({ ok: true, count: 1 });
        this._f = f; this._target = target; this._sx = sx; this._sw = sw;
      },
      move: function (x, y, down) { if (down) f = clamp((x - 120) / (W - 240), 0, 1); },
      tap: function (x) { f = clamp((x - 120) / (W - 240), 0, 1); }
    };
  }

  /* E06/E13 顺序：记住亮起顺序再点（星 / 试剂瓶） */
  function archSeq(cfg, api) {
    var nodes = cfg.nodes.map(function (n) { return { fx: n.fx, fy: n.fy, col: n.col || '#e8b45c', ph: R(0, 6.28), on: false, ring: 0 }; });
    var order = cfg.order.slice(), rounds = cfg.rounds || 1, round = 0, phase = 'show', idx = 0, timer = 0;
    function drawNode(ctx, nd) {
      var x = nd.fx * W, y = nd.fy * H;
      if (nd.on) { ctx.strokeStyle = 'rgba(255,240,200,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 22 + 5 * Math.sin(nd.ph * 4), 0, 6.283); ctx.stroke(); }
      glow(ctx, x, y, nd.on ? 46 : 30, nd.col);
      if (cfg.shape === 'bottle') { ctx.fillStyle = nd.on ? '#fff3d6' : 'rgba(200,215,230,.7)'; ctx.fillRect(x - 9, y - 16, 18, 32); ctx.fillRect(x - 4, y - 26, 8, 12); }
      else star(ctx, x, y, nd.on ? 9 : 6, nd.col);
    }
    return {
      update: function (ctx, dt) {
        timer += dt; drawBG(ctx, api.bg, .4);
        for (var k = 0; k < nodes.length; k++) nodes[k].on = false;
        if (phase === 'show') {
          nodes[order[idx]].on = true;
          var showT = cfg.show || .7; if (timer > showT) { timer = 0; idx++; if (idx >= order.length) { phase = 'input'; idx = 0; timer = 0; } }
        } else {
          if (idx < order.length) nodes[order[idx]].on = true;
          if (timer > 14) { phase = 'show'; idx = 0; timer = 0; }
        }
        for (k = 0; k < nodes.length; k++) { nodes[k].ph += .03; drawNode(ctx, nodes[k]); }
        for (k = 0; k < nodes.length; k++) { var nd = nodes[k]; if (nd.ring > 0) { nd.ring = Math.max(0, nd.ring - dt * 2); ctx.strokeStyle = 'rgba(121,194,182,' + nd.ring + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(nd.fx * W, nd.fy * H, 28 + (1 - nd.ring) * 34, 0, 6.283); ctx.stroke(); } }
        if (idx > 0) {
          ctx.save(); ctx.setLineDash([10, 10]); ctx.lineDashOffset = -timer * 40;
          ctx.strokeStyle = 'rgba(255,240,200,.6)'; ctx.lineWidth = 2.5;
          ctx.shadowColor = 'rgba(255,226,160,.6)'; ctx.shadowBlur = 8;
          ctx.beginPath();
          for (var m = 0; m < idx; m++) { var a = nodes[order[m]]; m === 0 ? ctx.moveTo(a.fx * W, a.fy * H) : ctx.lineTo(a.fx * W, a.fy * H); }
          ctx.stroke(); ctx.restore();
        }
        hud(ctx, phase === 'show' ? '记顺序…' : ('按顺序点 ' + (idx + 1) + ' / ' + order.length));
        if (phase === 'input' && idx >= order.length) { round++; if (round >= rounds) api.done({ ok: true, count: order.length * rounds }); else { phase = 'show'; idx = 0; timer = 0; } }
        this._nodes = nodes; this._order = order; this._idx = idx; this._phase = phase; this._fxW = W;
      },
      tap: function (x, y) {
        if (phase !== 'input') return;
        for (var k = 0; k < nodes.length; k++) {
          var nd = nodes[k];
          if (hit(x, y, nd.fx * W, nd.fy * H, 40)) {
            if (k === order[idx]) { idx++; timer = 0; nd.ring = 1; sfx('click'); recordClick(1); }
                else { idx = 0; timer = 0; }
            return;
          }
        }
      }
    };
  }

  /* E07/E10 拖动：把物件拖到高亮目标 */
  function archDrag(cfg, api) {
    var items = cfg.items.map(function (it) { return { fx: it.fx, fy: it.fy, icon: it.icon, x: it.fx * W, y: it.fy * H, locked: false }; });
    var targets = cfg.targets.map(function (t) { return { x: t.fx * W, y: t.fy * H, label: t.label }; });
    var drag = null;
    return {
      update: function (ctx) {
        drawBG(ctx, api.bg, .3);
        for (var i = 0; i < targets.length; i++) {
          var tg = targets[i];
          ctx.strokeStyle = 'rgba(121,194,182,.7)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(tg.x, tg.y, 34, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
          txt(ctx, tg.label, tg.x, tg.y + 52, 14, 'rgba(200,225,215,.9)');
        }
        for (i = 0; i < items.length; i++) { var it = items[i]; if (it.locked) { badge(ctx, it.x, it.y, it.icon); ctx.strokeStyle = 'rgba(121,194,182,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(it.x, it.y, 26, 0, 6.283); ctx.stroke(); } }
        for (i = 0; i < items.length; i++) { it = items[i]; if (!it.locked) { badge(ctx, it.x, it.y, it.icon); if (it === drag) glow(ctx, it.x, it.y, 30, 'rgba(255,226,160,.3)'); } }
        var lockedN = items.filter(function (p) { return p.locked; }).length;
        hud(ctx, cfg.goal || ('送到目标 · ' + lockedN + ' / ' + items.length));
        if (lockedN >= items.length) api.done({ ok: true, count: lockedN });
        this._items = items; this._targets = targets;
      },
      down: function (x, y) { for (var i = items.length - 1; i >= 0; i--) { var it = items[i]; if (!it.locked && Math.abs(x - it.x) < 42 && Math.abs(y - it.y) < 42) { drag = it; return; } } },
      move: function (x, y) { if (drag) { drag.x = x; drag.y = y; } },
      up: function () { if (drag) { var it = drag, tg = targets[items.indexOf(it)]; if (hit(it.x, it.y, tg.x, tg.y, 48)) { it.locked = true; it.x = tg.x; it.y = tg.y; sfx('good'); recordClick(1); } drag = null; } }
    };
  }

  /* E09 时机：水珠满时轻触 */
  function archTiming(cfg, api) {
    var fl = cfg.items.map(function (it, i) { return { fx: it.fx || (.25 + i * .25), fy: it.fy || .5, icon: it.icon || '🌸', f: 0, sp: R(.3, .5) * (cfg.speed || 1), done: false, ph: R(0, 6.28), pop: 0 }; });
    return {
      update: function (ctx, dt) {
        drawBG(ctx, api.bg, .32);
        var doneN = 0;
        for (var i = 0; i < fl.length; i++) {
          var p = fl[i]; p.ph += .04; if (p.pop > 0) p.pop = Math.max(0, p.pop - dt * 2);
          if (!p.done) { p.f += p.sp * dt; if (p.f >= 1.15) p.f = 0; } else doneN++;
          var x = p.fx * W, y = p.fy * H;
          badge(ctx, x, y, p.icon);
          var good = p.f > .82 && p.f < 1.02, prog = Math.min(1, p.f);
          ctx.strokeStyle = 'rgba(120,150,190,.25)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y - 60, 24, -1.57, -1.57 + 6.283 * prog); ctx.stroke();
          if (good) { glow(ctx, x, y - 60, 36, 'rgba(255,226,160,.4)'); ctx.strokeStyle = 'rgba(255,226,160,.95)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y - 60, 24, -1.57, -1.57 + 6.283 * prog); ctx.stroke(); }
          if (p.done) { ctx.fillStyle = 'rgba(121,194,182,.95)'; ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('✓', x + 30, y); }
          if (p.pop > 0) { ctx.strokeStyle = 'rgba(232,180,92,' + p.pop + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y - 60, 24 + (1 - p.pop) * 36, 0, 6.283); ctx.stroke(); }
        }
        hud(ctx, '水珠满时轻触花朵 · ' + doneN + ' / ' + fl.length);
        if (doneN >= fl.length) api.done({ ok: true, count: doneN });
        this._flowers = fl;
      },
      tap: function (x, y) {
        for (var i = 0; i < fl.length; i++) { var p = fl[i]; if (p.done) continue; var cx = p.fx * W, cy = p.fy * H; if (hit(x, y, cx, cy, 90)) { if (p.f > .82 && p.f < 1.02) { p.done = true; p.pop = 1; sfx('good'); recordClick(1); } else { p.f = 0; } return; } }
      }
    };
  }

  /* E11 跟随：拖伞替两人挡雨 */
  function archFollow(cfg, api) {
    var ux = W / 2, drops = [], wet = 0, acc = 0, t = 0, splashes = [], counted = false;
    var gy = H - 70;
    function mk() { return { x: R(20, W - 20), y: -20, vy: R(3.2, 5.4) * (cfg.rain || 1) }; }
    for (var i = 0; i < 30; i++) drops.push(mk());

    function person(ctx, x, y, scale, coat, skin, holdX) {
      ctx.save();
      ctx.translate(x, y); ctx.scale(scale, scale);
      /* 地面投影 */
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.beginPath(); ctx.ellipse(0, 48, 22, 6, 0, 0, 6.283); ctx.fill();
      /* 持伞手臂：从肩伸向伞柄底端（holdX 为伞柄相对人物的 x） */
      if (holdX != null) {
        ctx.strokeStyle = coat; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(4, -10); ctx.quadraticCurveTo((holdX + 4) / 2, -28, holdX, -26); ctx.stroke();
      }
      /* 大衣（圆角梯形） */
      ctx.fillStyle = coat;
      ctx.beginPath();
      ctx.moveTo(-13, 46);
      ctx.quadraticCurveTo(-17, 6, -10, -20);
      ctx.quadraticCurveTo(0, -28, 10, -20);
      ctx.quadraticCurveTo(17, 6, 13, 46);
      ctx.closePath(); ctx.fill();
      /* 大衣暗部（右侧） */
      ctx.fillStyle = 'rgba(0,0,0,.14)';
      ctx.beginPath();
      ctx.moveTo(2, -24); ctx.quadraticCurveTo(10, -20, 13, 46); ctx.lineTo(2, 46); ctx.closePath(); ctx.fill();
      /* 围巾 */
      ctx.fillStyle = 'rgba(217,139,139,.85)';
      ctx.fillRect(-10, -24, 20, 8);
      /* 头 */
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(0, -34, 11, 0, 6.283); ctx.fill();
      /* 头发 */
      ctx.fillStyle = 'rgba(38,30,26,.9)';
      ctx.beginPath(); ctx.arc(0, -37, 11, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
      ctx.restore();
    }

    function umbrella(ctx, cx) {
      var cy = gy - 120, Rr = 104;
      glow(ctx, cx, cy, 120, 'rgba(232,180,92,.16)');
      /* 伞柄（木色，含弯钩手柄） */
      ctx.strokeStyle = '#8a5a32'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, gy - 26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, gy - 26); ctx.quadraticCurveTo(cx, gy - 12, cx - 9, gy - 12); ctx.stroke();
      /* 伞面（红，向下弧顶） */
      ctx.fillStyle = '#d65a50';
      ctx.beginPath(); ctx.moveTo(cx - Rr, cy); ctx.quadraticCurveTo(cx, cy + Rr * 1.02, cx + Rr, cy); ctx.closePath(); ctx.fill();
      /* 伞面暗部（右半） */
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo(cx, cy + Rr * 1.02, cx + Rr, cy); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
      /* 伞骨 */
      ctx.strokeStyle = 'rgba(120,40,36,.85)'; ctx.lineWidth = 1.4;
      for (var s = -3; s <= 3; s++) {
        var ex = cx + s * (Rr / 3.4);
        var ey = cy + Math.sqrt(Math.max(0, Rr * Rr - (ex - cx) * (ex - cx)));
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      }
      /* 伞边描边 */
      ctx.strokeStyle = '#b8443c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - Rr, cy); ctx.quadraticCurveTo(cx, cy + Rr * 1.02, cx + Rr, cy); ctx.stroke();
      /* 伞尖 */
      ctx.fillStyle = '#8a5a32';
      ctx.beginPath(); ctx.arc(cx, cy - 2, 3.2, 0, 6.283); ctx.fill();
    }

    return {
      update: function (ctx, dt) {
        t += dt; acc += dt; drawBG(ctx, api.bg, .25);
        for (var i = 0; i < drops.length; i++) {
          var d = drops[i]; d.y += d.vy * dt * 30;
          ctx.strokeStyle = 'rgba(190,210,235,.45)'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y + 16); ctx.stroke();
          if (d.y > H - 150 && d.y < H - 138) { if (!(Math.abs(d.x - ux) < 100) && Math.abs(d.x - W / 2) < 70) wet++; }
          if (d.y > H) { splashes.push({ x: d.x, a: 1 }); drops[i] = mk(); }
        }
        for (i = splashes.length - 1; i >= 0; i--) { var s = splashes[i]; s.a -= dt * 2.2; if (s.a <= 0) { splashes.splice(i, 1); continue; } ctx.strokeStyle = 'rgba(190,210,235,' + s.a * .6 + ')'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.ellipse(s.x, H - 40, 14 * (1.4 - s.a), 5 * (1.4 - s.a), 0, 0, 6.283); ctx.stroke(); }
        umbrella(ctx, ux);
        var hx = ux - (W / 2 - 30), arm = Math.abs(hx) < 150 ? hx : null;
        person(ctx, W / 2 - 30, gy, 1, '#6f7d93', '#e9c9a8', arm);
        person(ctx, W / 2 + 30, gy - 6, .9, '#9a6f63', '#efd2b0', null);
        var wetPct = Math.min(1, wet / 40);
        ctx.fillStyle = 'rgba(120,150,190,.25)'; ctx.fillRect(W / 2 - 120, H - 28, 240, 6);
        ctx.fillStyle = 'rgba(217,139,139,' + (.4 + wetPct * .5) + ')'; ctx.fillRect(W / 2 - 120, H - 28, 240 * wetPct, 6);
        hud(ctx, '拖动伞，替两人挡雨 · ' + acc.toFixed(1) + ' / 15', '左右移动伞面，把雨挡在两人之外');
        if (acc >= 15) { if (!counted) { counted = true; recordClick(1); } api.done({ ok: wet < 26, count: 1 }); }
        this._ux = ux;
      },
      move: function (x) { ux = clamp(x, 100, W - 100); },
      tap: function (x) { ux = clamp(x, 100, W - 100); }
    };
  }

  /* E12 描线：按住沿光点走完 */
  function archTrace(cfg, api) {
    var ph = 0, cov = 0, down = false, t = 0, counted = false;
    function pos(p) { return [W / 2 + Math.sin(p * 6.283) * 220 + Math.sin(p * 6.283 * 3) * 50, H / 2 + Math.cos(p * 6.283 * 2) * 120]; }
    return {
      update: function (ctx, dt, inp) {
        t += dt; ph += dt * (cfg.spd || .34); if (ph > 1) ph -= 1; var p = pos(ph);
        drawBG(ctx, api.bg, .35);
        ctx.strokeStyle = 'rgba(255,240,210,.18)'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.beginPath();
        for (var i = 0; i <= 90; i++) { var q = pos(i / 90); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); } ctx.stroke();
        ctx.strokeStyle = 'rgba(232,180,92,.9)'; ctx.lineWidth = 10; ctx.beginPath();
        for (i = 0; i <= 90 * cov; i++) { var r = pos(i / 90); i ? ctx.lineTo(r[0], r[1]) : ctx.moveTo(r[0], r[1]); } ctx.stroke();
        glow(ctx, p[0], p[1], 30, 'rgba(255,240,200,.6)'); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, 6.283); ctx.fill();
        if (down && hit(inp.x, inp.y, p[0], p[1], 54)) cov = Math.min(1, cov + dt * .6);
        else if (down) cov = Math.max(0, cov - dt * .04); else cov = Math.max(0, cov - dt * .02);
        hud(ctx, '按住并沿光点描完 · ' + Math.round(cov * 100) + '%');
        if (cov >= .98 && !counted) { counted = true; recordClick(1); }
        if (cov >= .98) api.done({ ok: true, count: 1 });
        this._dot = p; this._pressed = down;
      },
      down: function () { down = true; },
      up: function () { down = false; }
    };
  }

  /* E14 排序：按年份点照片 */
  function archOrder(cfg, api) {
    var years = cfg.years.slice().sort(function () { return Math.random() - .5; });
    /* 卡牌缩小并垂直居中：宽 96 高 152；整组水平居中，整体在画布内上下居中 */
    var CW = 96, CH = 152, GAP = 165, N = years.length;
    var startX = (W - ((N - 1) * GAP + CW)) / 2;
    var startY = (H - CH) / 2;
    var cards = years.map(function (y, i) { return { y: y, x: startX + i * GAP, done: false, shake: 0, pop: 0 }; });
    var sorted = years.slice().sort(function (a, b) { return a - b; }), step = 0;
    return {
      update: function (ctx, dt) {
        drawBG(ctx, api.bg, .3);
        for (var i = 0; i < cards.length; i++) {
          var c = cards[i]; if (c.shake > 0) c.shake -= dt * 4; if (c.pop > 0) c.pop -= dt * 2.5; var sx = c.shake > 0 ? Math.sin(c.shake * 30) * 6 : 0;
          ctx.save(); ctx.translate(c.x + sx, startY);
          if (c.done) glow(ctx, CW / 2, CH * .5, CH * .47, 'rgba(121,194,182,.18)');
          ctx.fillStyle = c.done ? 'rgba(250,244,232,.95)' : 'rgba(240,232,214,.82)'; ctx.fillRect(0, 0, CW, CH);
          glow(ctx, CW / 2, CH * .42, CH * .32, 'rgba(120,100,80,.3)'); ctx.fillStyle = 'rgba(60,50,40,.8)'; ctx.fillRect(0, CH - 30, CW, 30);
          ctx.fillStyle = '#f6ecd8'; ctx.font = '16px Georgia,serif'; ctx.textAlign = 'center'; ctx.fillText(String(c.y), CW / 2, CH - 11);
          ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.strokeRect(.5, .5, CW - 1, CH - 1);
          if (c.done) { ctx.fillStyle = 'rgba(232,180,92,.95)'; ctx.fillText('✓', CW / 2, CH * .32); }
          if (c.pop > 0) { ctx.strokeStyle = 'rgba(121,194,182,' + c.pop + ')'; ctx.lineWidth = 3; ctx.strokeRect(-6, -6, CW + 12, CH + 12); }
          ctx.restore();
        }
        hud(ctx, '按年份从早到晚点一遍 · ' + step + ' / ' + cards.length);
        txt(ctx, '最早是 ' + sorted[0], W / 2, H - 66, 14, '#c9bfae');
        if (step >= cards.length) api.done({ ok: true, count: cards.length });
        this._cards = cards; this._sorted = sorted; this._step = step;
      },
      tap: function (x, y) {
        for (var i = 0; i < cards.length; i++) { var c = cards[i]; if (c.done) continue; if (x > c.x && x < c.x + CW && y > startY && y < startY + CH) { if (c.y === sorted[step]) { c.done = true; c.pop = 1; step++; sfx('click'); recordClick(1); } else c.shake = .4; return; } }
      }
    };
  }

  /* E15 旋转季节 */
  function archRotate(cfg, api) {
    var names = ['春', '夏', '秋', '冬'], cols = ['#8fc39a', '#7fb2d8', '#e8b45c', '#b9c9e0'];
    var ang = 0, hold = 0, target = cfg.target || 2, t = 0, counted = false;
    return {
      update: function (ctx, dt) {
        t += dt; drawBG(ctx, api.bg, .3);
        var cur = ((Math.round(ang / (6.283 / 4)) % 4) + 4) % 4;
        glow(ctx, W / 2, H / 2 - 40, 180, hexa(cols[cur], .12));
        var ta = target * 6.283 / 4;
        ctx.strokeStyle = 'rgba(232,180,92,.5)'; ctx.lineWidth = 2; ctx.setLineDash([5, 6]);
        ctx.beginPath(); ctx.moveTo(W / 2, H - 90); ctx.lineTo(W / 2 + Math.cos(ta) * 130, (H - 90) + Math.sin(ta) * 130); ctx.stroke(); ctx.setLineDash([]);
        ctx.save(); ctx.translate(W / 2, H - 90); ctx.rotate(ang);
        for (var s = 0; s < 4; s++) {
          var aa = s * 6.283 / 4, pul = s === target ? .5 + .5 * Math.sin(t * 4) : 0;
          ctx.fillStyle = s === target ? 'rgba(232,180,92,.95)' : 'rgba(255,255,255,.22)';
          ctx.beginPath(); ctx.arc(Math.cos(aa) * 78, Math.sin(aa) * 78, 15 + (s === target ? pul * 4 : 0), 0, 6.283); ctx.fill();
          ctx.fillStyle = '#12121a'; ctx.font = '15px "Songti SC",serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(names[s], Math.cos(aa) * 78, Math.sin(aa) * 78);
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W / 2, H - 90, 104, 0, 6.283); ctx.stroke();
        if (cur === target && hold > 0) { ctx.strokeStyle = 'rgba(121,194,182,.9)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(W / 2, H - 90, 118, -1.57, -1.57 + 6.283 * Math.min(1, hold)); ctx.stroke(); }
        hud(ctx, '拖动圆盘到「' + names[target] + '」 当前：' + names[cur]);
        hold = cur === target ? hold + dt : Math.max(0, hold - dt * 2);
        if (hold >= 1 && !counted) { counted = true; recordClick(1); }
        if (hold >= 1) api.done({ ok: true, count: 1 });
        this._cur = cur; this._target = target; this._ang = ang;
      },
      drag: function (dx) { ang += dx * .012; },
      tap: function (x, y) { ang = Math.atan2(y - (H - 90), x - W / 2); }
    };
  }

  /* E16 点亮星河 */
  function archStars(cfg, api) {
    var list = [], i2 = 0, lit = -1, timer = 0, t = 0;
    for (var i = 0; i < 16; i++) { var a = i / 16 * 6.283 * 2.2, r = 40 + i * 12; list.push({ x: W / 2 + Math.cos(a) * r * .95, y: H / 2 + Math.sin(a) * r * .55, on: false, ph: R(0, 6.28), pop: 0 }); }
    return {
      update: function (ctx, dt) {
        t += dt; timer += dt; drawBG(ctx, api.bg, .2);
        if (lit < 0 && timer > .35) { lit = i2; timer = 0; }
        for (i = 0; i < list.length; i++) { var s = list[i]; s.ph += .03; if (s.pop > 0) s.pop = Math.max(0, s.pop - dt * 2); var isLit = i === lit;
          var a2 = .25 + .25 * Math.sin(s.ph) + (s.on ? .5 : 0) + (isLit ? .35 : 0);
          var col = s.on ? 'rgba(255,226,160,' : (isLit ? 'rgba(255,250,230,' : 'rgba(180,200,235,');
          glow(ctx, s.x, s.y, s.on ? 44 : (isLit ? 54 : 26), col + (a2 * .5) + ')');
          ctx.fillStyle = col + Math.min(1, a2 + .3) + ')'; ctx.beginPath(); ctx.arc(s.x, s.y, s.on ? 7 : (isLit ? 9 : 4.5), 0, 6.283); ctx.fill();
          if (s.pop > 0) { ctx.strokeStyle = 'rgba(232,180,92,' + s.pop + ')'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(s.x, s.y, 12 + (1 - s.pop) * 34, 0, 6.283); ctx.stroke(); }
        }
        if (lit >= 0) { var ls = list[lit]; glow(ctx, W / 2, H / 2, 30, 'rgba(255,240,210,.1)'); ctx.strokeStyle = 'rgba(255,240,210,.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(W / 2, H / 2); ctx.lineTo(ls.x, ls.y); ctx.stroke(); }
        hud(ctx, '点亮并送出 · ' + i2 + ' / 16');
        if (i2 >= 16) api.done({ ok: true, count: i2 });
        this._list = list; this._lit = lit;
      },
      tap: function (x, y) { if (lit < 0) return; var s = list[lit]; if (hit(x, y, s.x, s.y, 56)) { s.on = true; s.pop = 1; i2++; lit = -1; timer = 0; sfx('click'); recordClick(1); } }
    };
  }

  /* ---------------- 配置：id -> {ep, arch, ...} ---------------- */
  var CONFIG = {
    morning:   { ep: 1,  arch: 'catch',    title: '采晨光',     hint: '轻触飘动的晨光，收满八束', need: 8, label: '晨光' },
    breathe:   { ep: 2,  arch: 'rhythm',    title: '一起呼吸',   hint: '光环进入外圈光圈时轻点，三次' },
    photo:     { ep: 3,  arch: 'jigsaw',    title: '显影',       hint: '把相纸碎片拖回原位，拼回这张照片', cols: 3, rows: 2 },
    train:     { ep: 4,  arch: 'find',      title: '车厢里的旧物', hint: '在车厢里找出三件旧物', hint2: '在画面里找出并轻触旧物',
                 items: [ { icon: '🎫', fx: .30, fy: .55 }, { icon: '⏱', fx: .62, fy: .42 }, { icon: '✉️', fx: .80, fy: .66 } ] },
    focus:     { ep: 5,  arch: 'align',     title: '对焦',       hint: '左右拖动对焦环，让显微镜下的画面清晰' },
    starpairs: { ep: 6,  arch: 'sequence',  title: '连星',       hint: '记住星星亮起的顺序，再照样点一遍', shape: 'star', rounds: 1,
                 order: [2, 0, 4, 1, 5, 3],
                 nodes: [ { fx: .20, fy: .30 }, { fx: .50, fy: .22 }, { fx: .80, fy: .32 }, { fx: .28, fy: .62 }, { fx: .55, fy: .70 }, { fx: .78, fy: .60 } ] },
    vesicle:   { ep: 7,  arch: 'drag',      title: '信使航线',   hint: '按住囊泡，拖进高亮的膜孔', goal: '送进膜孔 · 0 / 1',
                 items: [ { icon: '🔮', fx: .18, fy: .5 } ], targets: [ { fx: .82, fy: .5, label: '膜孔' } ] },
    fireflies: { ep: 8,  arch: 'catch',     title: '接萤火',     hint: '轻触飘落的萤火，收满八只', need: 8, label: '萤火', drift: 1 },
    orchid:    { ep: 9,  arch: 'timing',    title: '浇花',       hint: '水珠积满时轻触那株兰花，浇好三株',
                 items: [ { icon: '🌸', fx: .28, fy: .5 }, { icon: '🌸', fx: .5, fy: .55 }, { icon: '🌸', fx: .72, fy: .5 } ] },
    launch:    { ep: 10, arch: 'drag',      title: '助它升高',   hint: '按住灯笼，拖到天边的跑道灯', goal: '送到天边 · 0 / 1',
                 items: [ { icon: '🏮', fx: .5, fy: .82 } ], targets: [ { fx: .5, fy: .18, label: '天边' } ] },
    umbrella:  { ep: 11, arch: 'follow',    title: '撑伞',       hint: '拖动伞，替两人挡住这场雨，撑满十五秒' },
    trace:     { ep: 12, arch: 'trace',     title: '描一封信',   hint: '按住不放，让指尖跟着光点走完这一行' },
    recipe:    { ep: 13, arch: 'sequence',  title: '记方',       hint: '记住试剂亮起的顺序，再照样点一遍', shape: 'bottle', rounds: 2,
                 order: [0, 2, 4, 1, 3],
                 nodes: [ { fx: .20, fy: .40 }, { fx: .36, fy: .62 }, { fx: .50, fy: .36 }, { fx: .64, fy: .62 }, { fx: .80, fy: .40 } ] },
    order:     { ep: 14, arch: 'order',     title: '理照片',     hint: '按年份从早到晚点一遍五张照片', years: [1958, 1963, 1971, 1980, 1994] },
    season:    { ep: 15, arch: 'rotate',    title: '四季之转',   hint: '拖动黄铜圆盘到「秋」，停住一秒', target: 2 },
    stars:     { ep: 16, arch: 'stars',     title: '十六枚种子', hint: '星河里亮起哪颗就点哪颗，送十六枚回家' },

    /* —— 微观（细胞层面）小游戏：与每集中观玩法同构，背景换成合成细胞 —— */
    micro1:  { cell: true, ep: 1,  arch: 'catch',    title: '细胞质里的囊泡', hint: '轻触细胞质里飘散的微小囊泡，收满八枚', need: 8, label: '囊泡' },
    micro2:  { cell: true, ep: 2,  arch: 'rhythm',   title: '胞内钙波',     hint: '光环进入外圈时轻点，那是细胞自己的呼吸节律' },
    micro3:  { cell: true, ep: 3,  arch: 'jigsaw',   title: '膜上受体显形', hint: '把受体碎片拖回原位，拼回膜上的那张脸', cols: 3, rows: 2 },
    micro4:  { cell: true, ep: 4,  arch: 'find',     title: '细胞质里的旧物', hint: '在细胞质里找出三件被冲散的细胞器，把那天的压力认回来',
                 items: [ { icon: '🔘', fx: .30, fy: .55 }, { icon: '⚡', fx: .62, fy: .42 }, { icon: '🧬', fx: .80, fy: .66 } ] },
    micro5:  { cell: true, ep: 5,  arch: 'align',    title: '对准那颗星',   hint: '左右拖动，把镜头里的受体对准飘来的配体' },
    micro6:  { cell: true, ep: 6,  arch: 'sequence', title: '同色航线',     hint: '记住囊泡亮起的顺序，它们是同色的航线', shape: 'star', rounds: 1,
                 order: [2, 0, 4, 1, 5, 3],
                 nodes: [ { fx: .20, fy: .30 }, { fx: .50, fy: .22 }, { fx: .80, fy: .32 }, { fx: .28, fy: .62 }, { fx: .55, fy: .70 }, { fx: .78, fy: .60 } ] },
    micro7:  { cell: true, ep: 7,  arch: 'drag',     title: '信使穿过膜孔', hint: '按住囊泡，把它拖进高亮的膜孔',
                 items: [ { icon: '🔮', fx: .18, fy: .5 } ], targets: [ { fx: .82, fy: .5, label: '膜孔' } ] },
    micro8:  { cell: true, ep: 8,  arch: 'catch',    title: '接住神经萤火', hint: '轻触飘落的神经萤火，收满八只', need: 8, label: '萤火', drift: 1 },
    micro9:  { cell: true, ep: 9,  arch: 'timing',   title: '浇细胞的水',   hint: '水珠积满时轻触那株细胞，喂好三处',
                 items: [ { icon: '🌸', fx: .28, fy: .5 }, { icon: '🌸', fx: .5, fy: .55 }, { icon: '🌸', fx: .72, fy: .5 } ] },
    micro10: { cell: true, ep: 10, arch: 'drag',     title: '助囊泡升高',   hint: '按住那枚发光体，把它拖到天边的跑道灯',
                 items: [ { icon: '🏮', fx: .5, fy: .82 } ], targets: [ { fx: .5, fy: .18, label: '天边' } ] },
    micro11: { cell: true, ep: 11, arch: 'follow',   title: '两片细胞膜贴', hint: '拖动膜，替两个细胞挡住泄漏，贴满十五秒' },
    micro12: { cell: true, ep: 12, arch: 'trace',    title: '描一道信号',   hint: '按住不放，让指尖跟着光点描完那道信号' },
    micro13: { cell: true, ep: 13, arch: 'sequence', title: '重排试剂',     hint: '记住试剂亮起的顺序，再照样把她的名字排在前头', shape: 'bottle', rounds: 2,
                 order: [0, 2, 4, 1, 3],
                 nodes: [ { fx: .20, fy: .40 }, { fx: .36, fy: .62 }, { fx: .50, fy: .36 }, { fx: .64, fy: .62 }, { fx: .80, fy: .40 } ] },
    micro14: { cell: true, ep: 14, arch: 'order',    title: '核里排代次',   hint: '把细胞核的拷贝按代次从早到晚点一遍', years: [1987, 1992, 1999, 2006, 2013] },
    micro15: { cell: true, ep: 15, arch: 'rotate',   title: '细胞时钟',     hint: '拖动黄铜圆盘到「秋」，停住一秒', target: 2 },
    micro16: { cell: true, ep: 16, arch: 'stars',    title: '十六枚囊泡',   hint: '星河里亮起哪颗就点哪颗，送十六枚回家' }
  };

  /* ---------------- 工厂 ---------------- */
  function makeGame(id, api) {
    var cfg = CONFIG[id]; if (!cfg) return { update: function () {} };
    switch (cfg.arch) {
      case 'catch': return archCatch(cfg, api);
      case 'rhythm': return archRhythm(cfg, api);
      case 'jigsaw': return archJigsaw(cfg, api);
      case 'find': return archFind(cfg, api);
      case 'align': return archAlign(cfg, api);
      case 'sequence': return archSeq(cfg, api);
      case 'drag': return archDrag(cfg, api);
      case 'timing': return archTiming(cfg, api);
      case 'follow': return archFollow(cfg, api);
      case 'trace': return archTrace(cfg, api);
      case 'order': return archOrder(cfg, api);
      case 'rotate': return archRotate(cfg, api);
      case 'stars': return archStars(cfg, api);
      default: return { update: function () {} };
    }
  }

  /* ---------------- 运行器 ---------------- */
  var current = null;

  function play(id, cv, titleEl, hintEl) {
    var cfg = CONFIG[id];
    if (!cfg) return Promise.resolve({ ok: true });
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    if (titleEl) titleEl.textContent = cfg.title;
    if (hintEl) hintEl.textContent = cfg.hint;
    if (cv.style) { cv.style.display = 'block'; }
    var g3 = document.getElementById('gameCanvas3D'); if (g3 && g3.style) g3.style.display = 'none';

    return new Promise(function (resolve) {
      var inp = { x: W / 2, y: H / 2, down: false, lx: W / 2, ly: H / 2 };
      var over = false, api = {
        W: W, H: H, bg: null, _startMs: performance.now(),
        done: function (r) {
          if (api._doneAt) return;
          var res = r || { ok: true };
          api._result = res; api._doneAt = performance.now();
          if (res.ok && !res.skipped) {
            sfx('win');
            var ms = Math.round(performance.now() - api._startMs);
            var rec = bestGet(id) || { ms: null, plays: 0, cleared: false };
            rec.plays = (rec.plays || 0) + 1;
            if (!rec.cleared || ms < (rec.ms == null ? Infinity : rec.ms)) { rec.cleared = true; rec.ms = ms; }
            bestPut(id, rec);
            res.ms = ms; res.best = rec.ms; res.plays = rec.plays; res.cleared = true;
          } else if (res.skipped) {
            var rec0 = bestGet(id); if (rec0) { rec0.plays = (rec0.plays || 0) + 1; bestPut(id, rec0); res.plays = rec0.plays; }
          }
          setTimeout(function () { over = true; cleanup(); resolve(res); }, res.skipped ? 160 : (res.ok === false ? 450 : 850));
        },
        hint: function (s) { if (hintEl) hintEl.textContent = s; }
      };
      ACTIVE = api;
      scaleDifficulty(cfg);
      if (cfg.cell) api.cell = true;
      loadBG(cfg.ep, function (im) { api.bg = im; });
      api.why = WHY[cfg.arch] || '';
      api._startAt = 0;
      var g = makeGame(id, api);
      global.__PUZ = g;

      function pos(e) {
        var r = cv.getBoundingClientRect(), cx, cy;
        if (e.touches && e.touches[0]) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
        else if (e.changedTouches && e.changedTouches[0]) { cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY; }
        else { cx = e.clientX; cy = e.clientY; }
        return { x: (cx - r.left) / r.width * W, y: (cy - r.top) / r.height * H };
      }
      function onDown(e) { e.preventDefault(); var p = pos(e); inp.x = p.x; inp.y = p.y; inp.down = true; inp.lx = p.x; if (g.down) g.down(p.x, p.y); }
      function onMove(e) { var p = pos(e); inp.lx = inp.x; inp.x = p.x; inp.y = p.y; if (g.drag && inp.down) g.drag(p.x - inp.lx); if (g.move) g.move(p.x, p.y, inp.down); }
      function onUp(e) { var p = pos(e); inp.down = false; inp.x = p.x; inp.y = p.y; if (g.up) g.up(p.x, p.y); if (g.move) g.move(p.x, p.y, false); if (g.tap) g.tap(p.x, p.y); }
      function onKey(e) { if (e.code === 'Space' && g.tap) { e.preventDefault(); g.tap(inp.x, inp.y); } }
      function cleanup() {
        cv.removeEventListener('mousedown', onDown); cv.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        cv.removeEventListener('touchstart', onDown); cv.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp); window.removeEventListener('keydown', onKey);
      }
      cv.addEventListener('mousedown', onDown); cv.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      cv.addEventListener('touchstart', onDown, { passive: false });
      cv.addEventListener('touchmove', function (e) { e.preventDefault(); onMove(e); }, { passive: false });
      window.addEventListener('touchend', onUp); window.addEventListener('keydown', onKey);

      var raf = 0, last = 0;
      function frame(ts) {
        if (over) return;
        var dt = last ? Math.min(.05, (ts - last) / 1000) : .016; last = ts;
        try { g.update(ctx, dt, inp, api); } catch (e) { over = true; cleanup(); resolve({ ok: false, error: String(e) }); return; }
        if (api._doneAt) {
          var el = performance.now() - api._doneAt;
          var span = (api._result && api._result.ok === false) ? 450 : 850;
          if (el < span && api._result && api._result.ok !== false && !api._result.skipped) {
            var al = 1 - el / span;
            ctx.fillStyle = 'rgba(232,180,92,' + (al * .16) + ')'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = 'rgba(243,236,225,' + al + ')'; ctx.font = '30px "Songti SC",serif'; ctx.textAlign = 'center';
            ctx.fillText('做到了 ✦', W / 2, H / 2);
            for (var p = 0; p < 18; p++) {
              var pa = p / 18 * 6.283, pr = 60 + el * 0.5;
              var px = W / 2 + Math.cos(pa + el * 0.01) * pr, py = H / 2 + Math.sin(pa + el * 0.01) * pr * 0.6;
              glow(ctx, px, py, 8, 'rgba(232,180,92,' + (al * .8) + ')');
            }
          } else if (api._result && api._result.ok === false && !api._result.skipped && el < span) {
            var fa = 1 - el / span;
            ctx.fillStyle = 'rgba(60,30,30,' + (fa * .14) + ')'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = 'rgba(243,236,225,' + fa + ')'; ctx.font = '26px "Songti SC",serif'; ctx.textAlign = 'center';
            ctx.fillText('差一点 · 别急', W / 2, H / 2);
          }
        }
        /* 科普浮层：开局几秒淡出 */
        if (api.why && !api._startAt) api._startAt = ts;
        if (api.why && api._startAt) {
          var wel = ts - api._startAt;
          if (wel < 5200) {
            var wa = wel < 4200 ? 1 : Math.max(0, 1 - (wel - 4200) / 1000);
            var lines = wrapTxt(ctx, api.why, W - 96), lh = 22, ph2 = lines.length * lh;
            var by = H - ph2 - 34, bh = ph2 + 28;
            ctx.fillStyle = 'rgba(14,16,24,' + (.62 * wa) + ')'; ctx.fillRect(24, by - 14, W - 48, bh);
            ctx.strokeStyle = 'rgba(232,180,92,' + (.35 * wa) + ')'; ctx.lineWidth = 1; ctx.strokeRect(24, by - 14, W - 48, bh);
            ctx.fillStyle = 'rgba(243,236,225,' + (.92 * wa) + ')'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.font = '15px "PingFang SC","Hiragino Sans GB",sans-serif';
            /* 文字块在方框内上下居中（与顶部提示条同一套算法） */
            var cy0 = (by - 14) + bh / 2 - (lines.length - 1) * lh / 2;
            for (var li = 0; li < lines.length; li++) ctx.fillText(lines[li], 40, cy0 + li * lh);
            ctx.textAlign = 'center';
          }
        }
        /* 后期烘焙：统一叠加电影感处理（浮尘 / 柔光 / 冷暖分级 / 暗角 / 颗粒） */
        try { postFX(ctx, ts, dt); } catch (e) { }
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      current = { abort: function () { api.done({ ok: true, skipped: true }); } };
    });
  }

  /* 测试用：直接造一局，绕过 DOM/RAF，便于无头逐帧驱动 */
  function makeTest(id) {
    var cfg = CONFIG[id]; if (!cfg) return null;
    var api = { W: W, H: H, bg: null, _done: null, done: function (r) { this._done = r || { ok: true }; }, hint: function () {} };
    if (cfg.cell) api.cell = true;
    scaleDifficulty(cfg);
    ACTIVE = api;
    var g = makeGame(id, api);
    return { g: g, api: api, cfg: cfg };
  }

  global.PUZZLES = {
    play: play,
    abort: function () { if (current) current.abort(); },
    test: makeTest,
    best: bestGet,
    config: CONFIG
  };
})(window);
