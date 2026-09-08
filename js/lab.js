/* ============================================================
 * lab.js —— 宏观「实验台」：上帝视角的外泌体实验沙盒
 * 常驻面板，可从 HUD 随时打开；主线每集的「宏观」选项也会带焦点进入。
 * 多步自由实验（选源→分离→标记→投递→观察），实验记录跨集保存，不影响主线。
 * ============================================================ */
(function (global) {
  'use strict';

  var W = 900, H = 520;
  var SAVE_KEY = 'exo-lab-v1';
  /* 靶细胞纵向坐标：圆直径 84，另需名称(13px)与亲和度(11px)两行文字，故间距取 108。
     绘制与投递落点(tgtPos)共用此常量，避免两处不一致导致外泌体飞到错位的 y。 */
  var TGT_YS = [100, 208, 316, 424];

  /* 源细胞 / 靶细胞 / 标记 */
  var SRC = {
    neuro:  { name: '神经元',   col: '#7fa8d8' },
    tumor:  { name: '肿瘤细胞', col: '#e8b45c' },
    immune: { name: '免疫细胞', col: '#79c2b6' },
    stem:   { name: '干细胞',   col: '#8fc39a' }
  };
  var TGT = {
    memory: { name: '记忆中枢', col: '#7fa8d8' },
    tumor:  { name: '肿瘤灶',   col: '#e8b45c' },
    inflam: { name: '炎症区',   col: '#79c2b6' },
    injury: { name: '损伤组织', col: '#8fc39a' }
  };
  var LABELS = [
    { k: 'CD9',    col: '#e8b45c' },
    { k: 'CD63',   col: '#7fa8d8' },
    { k: 'TSG101', col: '#79c2b6' },
    { k: '未标记', col: '#c9bfae' }
  ];

  /* 归巢亲和力（源→靶），用于给出"像不像真的"的结果 */
  var AFF = {
    neuro:  { memory: 0.9, tumor: 0.2, inflam: 0.3, injury: 0.4 },
    tumor:  { memory: 0.2, tumor: 0.85, inflam: 0.5, injury: 0.4 },
    immune: { memory: 0.3, tumor: 0.4, inflam: 0.9, injury: 0.6 },
    stem:   { memory: 0.4, tumor: 0.3, inflam: 0.6, injury: 0.9 }
  };
  var NOTES = {
    'neuro->memory': '外泌体穿过屏障，把记忆的信送达突触——这是故事里最想要的那条航线。',
    'tumor->tumor':   '外泌体被肿瘤微环境摄取，可能促进迁移，是外泌体研究里著名的双刃剑。',
    'immune->inflam': '外泌体被炎症区免疫细胞识别，信号被放大，常用于抗炎递送研究。',
    'stem->injury':   '外泌体落在损伤组织，引导修复因子聚集，是再生医学的热点方向。',
    'default':        '外泌体带着源细胞的消息出发，大部分在路上被稀释、被清除。'
  };

  /* 各集「宏观」预设：带焦点进入实验台时自动选好源/靶，并给出这一集的故事化思路 */
  var PRESETS = {
    ep04: { src: 'neuro',  tgt: 'memory', title: '老照片', note: '把神经元的外泌体寄向记忆中枢——像把外婆的桂花，重新放进你记得的那间屋。' },
    ep05: { src: 'stem',   tgt: 'injury', title: '海上来信', note: '干细胞的信落到损伤组织，像灯塔把走散的船引回港湾。' },
    ep06: { src: 'immune', tgt: 'inflam', title: '茶渍', note: '免疫细胞外泌体被炎症区识别，信号被放大——一封信在人群里被读了出来。' },
    ep07: { src: 'tumor',  tgt: 'tumor',  title: '种子归巢', note: '肿瘤外泌体被肿瘤微环境原路接走：这一条航线最像"回家"，也是研究里著名的双刃剑。' },
    ep08: { src: 'neuro',  tgt: 'memory', title: '蓝调', note: '又一次，神经元把信寄给记忆中枢——蓝调是被记住的那段旋律本身。' },
    ep09: { src: 'immune', tgt: 'inflam', title: '站台', note: '免疫信使在炎症的站台上被认出，像有人在人群中一眼认出了你。' },
    ep10: { src: 'stem',   tgt: 'injury', title: '体检', note: '干细胞的信落在受损处，看修复因子会不会聚集——体检报告里最想看到的那一行。' },
    ep11: { src: 'tumor',  tgt: 'tumor',  title: '液体活检', note: '肿瘤外泌体被原处回收，正是"液体活检"读信号的逻辑：一滴里就能读出源头。' },
    ep12: { src: 'neuro',  tgt: 'memory', title: '满月', note: '神经元的信再次寄向记忆中枢——满月是把所有思念同时照亮的那一夜。' },
    ep13: { src: 'immune', tgt: 'inflam', title: '试剂', note: '免疫信使在炎症里被放大，像当年那瓶试剂，把看不见的反应显了形。' },
    ep14: { src: 'stem',   tgt: 'injury', title: '年轮', note: '干细胞的信落进年轮似的损伤里——每一圈都是一个被记住的年份。' },
    ep15: { src: 'immune', tgt: 'inflam', title: '秋', note: '免疫信使落入秋日的炎症区，像把那一年的落叶一封封寄回枝头。' },
    ep16: { src: 'neuro',  tgt: 'memory', title: '星图', note: '神经元的信汇成星图寄向记忆中枢——十六枚种子，终于连成了他能认得的夜空。' }
  };

  /* 状态 */
  var st = {
    src: null, tgt: null, label: null,
    isolated: 0, stage: 'src',
    delivering: false, dprog: 0, exos: [], t: 0, last: 0, flash: 0
  };
  var log = [];
  var curPreset = null;
  var didOp = false;   /* 本次打开实验台是否真的操作过（离心/投递） */
  var cvs, ctx, raf = 0, resolveClose = null;

  /* ---------------- 工具 ---------------- */
  function $(s) { return document.querySelector(s); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function fmtTime(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function glow(c, x, y, r, col) {
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
  }
  /* kind: 'src' 源细胞（合成中，呼吸更明显） / 'tgt' 靶细胞（膜伪足 + 面向源侧的受体点） */
  function drawCellShape(c, x, y, r, col, t, kind, lit) {
    var isSrc = (kind === 'src');
    lit = lit || 0;   /* 投递接近度 0~1，越接近受体越亮 */
    /* 呼吸与漂浮：让细胞有生命感 */
    var ph = isSrc ? 0 : (x * 0.011 + y * 0.013);
    var br = 1 + Math.sin(t * (isSrc ? .9 : 1.15) + ph) * (isSrc ? .035 : .022);
    var cy = y + Math.sin(t * .8 + ph) * r * .03;

    /* 接触阴影：让细胞"坐"进培养皿，增强体积感 */
    c.save();
    c.translate(x, y + r * 1.04); c.scale(1, .3);
    var shg = c.createRadialGradient(0, 0, 0, 0, 0, r * .95);
    shg.addColorStop(0, 'rgba(0,0,0,.4)'); shg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = shg; c.beginPath(); c.arc(0, 0, r * .95, 0, 6.283); c.fill();
    c.restore();

    /* 靶细胞：膜的伪足轮廓（缓慢起伏） */
    if (!isSrc) {
      for (var i = 0; i < 14; i++) {
        var a = i / 14 * 6.283 + t * .12;
        var pr = r * (1 + Math.sin(t * 1.6 + i) * .05);
        var px = x + Math.cos(a) * pr * .97, py = cy + Math.sin(a) * pr * .97;
        var pg = c.createRadialGradient(px, py, 0, px, py, r * .17);
        pg.addColorStop(0, hexA(col, .5)); pg.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = pg; c.beginPath(); c.arc(px, py, r * .17, 0, 6.283); c.fill();
      }
    }

    /* 3D 贴图版（assets/lab/cell3d.png，纯黑底 + screen 混合，暗色培养皿上黑底自然隐形） */
    var sp = tintedSprite(col);
    if (sp) {
      /* 贴图中细胞约占 76% 画幅：2.45r → 视觉半径≈0.93r，略小于碰撞圆，给上下文字留余量 */
      var d = r * 2.45 * br;
      c.save();
      c.globalCompositeOperation = 'screen';
      c.drawImage(sp, x - d / 2, cy - d / 2, d, d);
      c.restore();
    } else {
      /* 回退：贴图未加载/加载失败时的程序化绘制 */
      var g = c.createRadialGradient(x - r * .3, cy - r * .35, r * .1, x, cy, r * br);
      g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(.35, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = 0.55; c.fillStyle = g; c.beginPath(); c.arc(x, cy, r * br, 0, 6.283); c.fill(); c.globalAlpha = 1;
      c.strokeStyle = col; c.lineWidth = 3; c.beginPath(); c.arc(x, cy, r * 0.82, 0, 6.283); c.stroke();
      c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.arc(x, cy, r * 0.4, 0, 6.283); c.fill();
    }

    if (isSrc) {
      /* 源细胞：内部"正在合成"的呼吸光晕 */
      var pa = .16 + Math.sin(t * 1.5) * .07;
      var hg = c.createRadialGradient(x, cy, r * .2, x, cy, r * 1.25);
      hg.addColorStop(0, hexA(col, pa)); hg.addColorStop(1, 'rgba(0,0,0,0)');
      c.save(); c.globalCompositeOperation = 'screen';
      c.fillStyle = hg; c.beginPath(); c.arc(x, cy, r * 1.25, 0, 6.283); c.fill();
      c.restore();
    } else {
      /* 靶细胞：朝向源细胞一侧（左侧）的受体小点；投递越接近越亮 */
      for (var j = 0; j < 4; j++) {
        var ra = Math.PI + (j - 1.5) * .38;
        var rx = x + Math.cos(ra) * r * .92, ry = cy + Math.sin(ra) * r * .92;
        var rr = r * (.1 + lit * .07);
        if (lit > 0) glow(c, rx, ry, r * (.26 + lit * .34), hexA(col, .12 + lit * .3));
        var rg = c.createRadialGradient(rx - r * .03, ry - r * .03, 0, rx, ry, rr);
        rg.addColorStop(0, '#fff'); rg.addColorStop(.5, hexA(col, .9)); rg.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = rg; c.beginPath(); c.arc(rx, ry, rr, 0, 6.283); c.fill();
      }
      /* 非常接近时：膜上浮现一圈"对接"高光，随接近收紧 */
      if (lit > 0) {
        c.save();
        c.globalCompositeOperation = 'screen';
        c.strokeStyle = 'rgba(255,244,214,' + (lit * .5) + ')';
        c.lineWidth = 1.5 + lit * 2;
        c.beginPath(); c.arc(x, cy, r * (.98 + (1 - lit) * .12), 0, 6.283); c.stroke();
        c.restore();
      }
    }
  }

  /* 3D 细胞贴图加载 + 按细胞类型着色（multiply 保明暗、screen 回补高光） */
  var cellImg = null, spriteCache = {};
  (function () {
    var im = new Image();
    im.onload = function () { cellImg = im; };
    im.src = 'assets/lab/cell3d.png';
  })();
  function tintedSprite(col) {
    if (!cellImg) return null;
    if (spriteCache[col]) return spriteCache[col];
    var s = cellImg.width, off = document.createElement('canvas');
    off.width = s; off.height = s;
    var oc = off.getContext('2d');
    oc.drawImage(cellImg, 0, 0);
    oc.globalCompositeOperation = 'multiply';
    oc.globalAlpha = .9; oc.fillStyle = col; oc.fillRect(0, 0, s, s);
    oc.globalCompositeOperation = 'screen';
    oc.globalAlpha = .35; oc.drawImage(cellImg, 0, 0);
    /* 盖掉贴图右下角的"AI生成"水印（该区域本是纯黑背景，涂黑即无痕，
       必须放在最后的 screen 回补之后，否则水印会被重新画上来） */
    oc.globalCompositeOperation = 'source-over';
    oc.globalAlpha = 1; oc.fillStyle = '#000';
    oc.fillRect(s * .78, s * .89, s * .22, s * .11);
    spriteCache[col] = off;
    return off;
  }

  /* ---------------- 存档 ---------------- */
  function loadLog() {
    try {
      var d = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (d && d.log) log = d.log;
    } catch (e) { /* 忽略 */ }
  }
  function saveLog() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ log: log })); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 计算一次实验结果 ---------------- */
  function computeResult() {
    var aff = (AFF[st.src] && AFF[st.src][st.tgt]) || 0.3;
    if (st.label && st.label.k === '未标记') aff *= 0.9;
    var r = Math.random() * 0.25 + aff;       /* 给一点随机扰动，更像实验 */
    var cls = r >= 0.8 ? '归巢成功' : (r >= 0.5 ? '部分归巢' : '脱靶 / 被清除');
    var note = NOTES[st.src + '->' + st.tgt] || NOTES.default;
    return { score: Math.round(r * 100), cls: cls, note: note };
  }

  function summary() {
    if (!log.length) return null;
    var scores = log.map(function (e) { return e.score; });
    var best = scores.reduce(function (a, b) { return Math.max(a, b); }, 0);
    var avg = Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length);
    var succ = log.filter(function (e) { return e.cls === '归巢成功' || e.score >= 80; }).length;
    return { n: log.length, best: best, avg: avg, success: succ, rate: succ / log.length };
  }

  /* ---------------- 控制区渲染 ---------------- */
  function chip(host, key, label, col, on, cb) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.borderColor = on ? col : 'rgba(255,255,255,.14)';
    b.style.background = on ? hexA(col, 0.18) : 'rgba(255,255,255,.04)';
    b.style.color = on ? '#fff' : 'var(--ink)';
    b.addEventListener('click', cb);
    host.appendChild(b);
    return b;
  }
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function renderControls() {
    var hs = $('#labSrc'), ht = $('#labTgt'), hl = $('#labLabel');
    hs.innerHTML = ''; ht.innerHTML = ''; hl.innerHTML = '';
    Object.keys(SRC).forEach(function (k) {
      chip(hs, k, SRC[k].name, SRC[k].col, st.src === k, function () { st.src = k; st.stage = st.isolated > 0 ? st.stage : 'isolate'; renderControls(); });
    });
    Object.keys(TGT).forEach(function (k) {
      chip(ht, k, TGT[k].name, TGT[k].col, st.tgt === k, function () { st.tgt = k; renderControls(); });
    });
    LABELS.forEach(function (L) {
      chip(hl, L.k, L.k, L.col, st.label === L, function () { st.label = L; renderControls(); });
    });
    /* 步骤提示 */
    var step = $('#labStep');
    if (!st.src) step.textContent = '① 先选一种「源细胞」——外泌体从它那儿来。';
    else if (st.isolated === 0) step.textContent = '② 点「离心分离」，把外泌体从培养液里分出来。';
    else if (!st.label) step.textContent = '③ 选一个「标记」（也可未标记），方便追踪。';
    else if (!st.tgt) step.textContent = '④ 选一个「靶细胞」，再点「投递」。';
    else step.textContent = '⑤ 点「投递」，看外泌体能不能归巢。';
    /* 按钮可用性 */
    $('#labIsolate').disabled = !st.src;
    $('#labDeliver').disabled = !(st.src && st.isolated > 0 && st.tgt);
  }
  function renderLog() {
    var box = $('#labLog'); box.innerHTML = '';
    if (!log.length) { box.innerHTML = '<div class="lx-empty">还没有实验记录。随便做几组，看外泌体能不能找到家。</div>'; return; }
    log.slice().reverse().forEach(function (e) {
      var d = document.createElement('div');
      d.className = 'lx-item';
      d.innerHTML = '<span class="lx-t">' + e.time + '</span>' +
        '<span class="lx-flow">' + e.src + ' → ' + e.tgt + ' <em>' + (e.label || '未标记') + '</em></span>' +
        '<span class="lx-cls" style="color:' + e.col + '">' + e.cls + ' · ' + e.score + '%</span>' +
        '<span class="lx-note">' + e.note + '</span>';
      box.appendChild(d);
    });
  }

  /* ---------------- 投递动画 ---------------- */
  function trayPos(i, n) {
    var span = Math.min(360, n * 56), x0 = W / 2 - span / 2 + 28;
    return { x: x0 + (n > 1 ? i * (span / (n - 1)) : 0), y: 470 };
  }
  function tgtPos() {
    var keys = Object.keys(TGT), idx = keys.indexOf(st.tgt);
    return { x: 770, y: TGT_YS[idx] || 250 };
  }
  function startDeliver() {
    if (!(st.src && st.isolated > 0 && st.tgt)) return;
    st.delivering = true; st.dprog = 0;
    var tp = tgtPos();
    st.exos = [];
    for (var i = 0; i < st.isolated; i++) {
      var sp = trayPos(i, st.isolated);
      st.exos.push({ sx: sp.x, sy: sp.y, tx: tp.x, ty: tp.y, x: sp.x, y: sp.y, ph: rnd(0, 6.28) });
    }
  }
  function finishDeliver() {
    var res = computeResult();
    var col = (res.cls === '归巢成功') ? '#79c2b6' : (res.cls === '部分归巢' ? '#e8b45c' : '#d98b8b');
    log.push({
      time: fmtTime(new Date()),
      src: SRC[st.src].name, tgt: TGT[st.tgt].name,
      label: st.label ? st.label.k : '未标记',
      cls: res.cls, score: res.score, col: col, note: res.note
    });
    if (log.length > 40) log = log.slice(-40);
    saveLog(); renderLog();
    st.flash = 1.2;
    try { if (global.Audio2 && global.Audio2.sfx && global.Audio2.sfx.seed) global.Audio2.sfx.seed(); } catch (e) { }
    toast(res.cls + '：' + SRC[st.src].name + ' 的外泌体 → ' + TGT[st.tgt].name + '（' + res.score + '%）');
    /* 沙盒式重置：保留源与标记，清空分离物与目标，便于换靶再试 */
    st.delivering = false; st.isolated = 0; st.exos = []; st.tgt = null; st.stage = 'src';
    renderControls();
  }
  function toast(msg) {
    var t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  /* ---------------- 画布渲染 ---------------- */
  function frame(ts) {
    var dt = st.last ? Math.min(0.05, (ts - st.last) / 1000) : 0.016;
    st.last = ts; st.t += dt;
    if (st.delivering) {
      st.dprog += dt / 1.1;
      for (var i = 0; i < st.exos.length; i++) {
        var e = st.exos[i], t = Math.min(1, st.dprog);
        var arc = Math.sin(t * Math.PI) * 90;
        e.x = lerp(e.sx, e.tx, t);
        e.y = lerp(e.sy, e.ty, t) - arc;
      }
      if (st.dprog >= 1) finishDeliver();
    }
    if (st.flash > 0) st.flash = Math.max(0, st.flash - dt);
    draw();
    raf = requestAnimationFrame(frame);
  }
  function draw() {
    if (!ctx) return;
    ctx.fillStyle = '#0c0f17'; ctx.fillRect(0, 0, W, H);
    var g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, '#121d2b'); g.addColorStop(1, '#070a10');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    /* 漂浮的自由囊泡（让培养皿始终有生气） */
    for (var f = 0; f < 16; f++) {
      var fa = f / 16 * 6.283 + st.t * 0.2, fr = 60 + (f % 7) * 55;
      var fx = W / 2 + Math.cos(fa) * fr * 0.92 + Math.sin(st.t * 0.6 + f) * 14;
      var fy = H / 2 + Math.sin(fa) * fr * 0.55 + Math.cos(st.t * 0.5 + f) * 12;
      glow(ctx, fx, fy, 9 + (f % 3) * 4, 'rgba(127,168,216,.10)');
    }

    /* 培养皿边框 */
    ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 2;
    roundRect(ctx, 30, 30, W - 60, H - 60, 40); ctx.stroke();

    /* 源细胞（左） */
    if (st.src) {
      var sc = SRC[st.src];
      drawCellShape(ctx, 200, 250, 80, sc.col, st.t, 'src');
      ctx.fillStyle = '#f3ece1'; ctx.font = '16px "Songti SC",serif'; ctx.textAlign = 'center';
      ctx.fillText('源 · ' + sc.name, 200, 362);
      if (st.isolated > 0 && !st.delivering) {
        for (var i = 0; i < st.isolated; i++) {
          var p = trayPos(i, st.isolated);
          var yy = p.y + Math.sin(st.t * 3 + i) * 6;
          glow(ctx, p.x, yy, 16, hexA(sc.col, 0.5));
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, yy, 5, 0, 6.283); ctx.fill();
        }
      }
    } else {
      ctx.fillStyle = 'rgba(201,191,174,.55)'; ctx.font = '12px "PingFang SC",sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('↓ 先在下方选一种「源细胞」', 56, 250);
    }

    /* 靶细胞（右，4 个，含亲和力） */
    var keys = Object.keys(TGT), ys = TGT_YS;
    for (var k = 0; k < keys.length; k++) {
      var tk = keys[k], tc = TGT[tk], x = 770, y = ys[k];
      var sel = (st.tgt === tk);
      var aff = (st.src && AFF[st.src] && AFF[st.src][tk]) ? AFF[st.src][tk] : 0;
      if (st.src && aff > 0) glow(ctx, x, y, 28 + aff * 46, hexA(tc.col, 0.08 + aff * 0.20));
      if (sel && st.flash > 0) glow(ctx, x, y, 120 * st.flash, hexA(tc.col, 0.5));
      /* 投递中：外泌体越接近，靶细胞的受体点越亮（把"归巢"这一步做实） */
      var lit = 0;
      if (st.delivering && sel && st.exos.length) {
        var md = 1e9;
        for (var q = 0; q < st.exos.length; q++) {
          var ex = st.exos[q], ddx = ex.x - x, ddy = ex.y - y, dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd < md) md = dd;
        }
        lit = Math.max(0, Math.min(1, 1 - md / (42 * 3.4)));  /* 约 3.4r 内开始亮起 */
      }
      drawCellShape(ctx, x, y, 42, tc.col, st.t, 'tgt', lit);
      if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 46, 0, 6.283); ctx.stroke(); }
      ctx.fillStyle = sel ? '#fff' : 'rgba(201,191,174,.85)';
      ctx.font = '13px "Songti SC",serif'; ctx.textAlign = 'center';
      ctx.fillText('靶 · ' + tc.name, x, y + 56);
      if (st.src && aff > 0 && !sel) {
        ctx.fillStyle = hexA(tc.col, 0.95); ctx.font = '12px "PingFang SC",sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('亲和 ' + (aff * 100 | 0) + '%', x - 52, y + 4);
        ctx.textAlign = 'center';
      }
    }

    /* 投递中的囊泡 */
    if (st.delivering) {
      for (var d = 0; d < st.exos.length; d++) {
        var e = st.exos[d];
        glow(ctx, e.x, e.y, 18, 'rgba(255,245,210,.6)');
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(e.x, e.y, 5, 0, 6.283); ctx.fill();
      }
    }

    /* 成功横幅 */
    if (st.flash > 0) {
      var a = Math.min(1, st.flash);
      ctx.fillStyle = 'rgba(243,236,225,' + (a * 0.95) + ')';
      ctx.font = '28px "Songti SC",serif'; ctx.textAlign = 'center';
      ctx.fillText('外泌体归巢 · 记下了', W / 2, 72);
    }

    /* 标题 */
    ctx.fillStyle = 'rgba(201,191,174,.45)'; ctx.font = '12px "PingFang SC",sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('实验台 · 上帝视角（不影响主线）', 56, 78);
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  function runPreset() {
    if (!curPreset) return;
    st.src = curPreset.src; st.tgt = curPreset.tgt; st.isolated = 6;
    didOp = true;
    /* 离心 6 枚：直接计分到左上角并飞 6 个光点（不依赖 gain 包装，避免被旧逻辑限成 +1） */
    try { if (global.ESCORE) { if (global.ESCORE.addExo) global.ESCORE.addExo(6); if (global.ESCORE.fly) global.ESCORE.fly(6, '#e8b45c'); } } catch (e) {}
    renderControls();
    toast('已按「' + curPreset.title + '」思路投递：' + SRC[st.src].name + ' 的外泌体 → ' + TGT[st.tgt].name);
    startDeliver();
  }

  /* ---------------- 打开 / 关闭 ---------------- */
  function open(focus, presetKey) {
    didOp = false;
    var ov = $('#overlay');
    ov.classList.remove('hidden');
    var panels = document.querySelectorAll('.panel');
    for (var i = 0; i < panels.length; i++) panels[i].classList.toggle('show', panels[i].id === 'panelLab');
    if (focus) {
      if (focus.src && SRC[focus.src]) st.src = focus.src;
      if (focus.tgt && TGT[focus.tgt]) st.tgt = focus.tgt;
    }
    curPreset = (presetKey && PRESETS[presetKey]) ? PRESETS[presetKey] : null;
    var pb = $('#labPreset');
    if (curPreset) {
      st.src = curPreset.src; st.tgt = curPreset.tgt;
      if ($('#labPresetTitle')) $('#labPresetTitle').textContent = curPreset.title;
      if ($('#labPresetNote')) $('#labPresetNote').textContent = curPreset.note;
      if (pb) pb.classList.remove('hidden');
    } else if (pb) {
      pb.classList.add('hidden');
    }
    st.stage = st.src ? 'isolate' : 'src';
    renderControls(); renderLog();
    startLoop();
    return new Promise(function (res) { resolveClose = res; });
  }
  function close() {
    stopLoop();
    var ov = $('#overlay');
    ov.classList.add('hidden');
    var panels = document.querySelectorAll('.panel');
    for (var i = 0; i < panels.length; i++) panels[i].classList.remove('show');
    var r = resolveClose; resolveClose = null;
    if (r) r();
  }
  function startLoop() {
    if (raf) return;
    st.last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ---------------- 初始化（脚本在 body 末尾，DOM 已就绪） ---------------- */
  function init() {
    cvs = $('#labCanvas');
    if (cvs) ctx = cvs.getContext('2d');
    loadLog();
    $('#labIsolate').addEventListener('click', function () {
      if (!st.src) return;
      st.isolated = 6; st.stage = st.label ? 'deliver' : 'label';
      /* 离心 6 枚：直接计分到左上角并飞 6 个光点（不依赖 gain 包装，避免被旧逻辑限成 +1） */
      try { if (global.ESCORE) { if (global.ESCORE.addExo) global.ESCORE.addExo(6); if (global.ESCORE.fly) global.ESCORE.fly(6, '#e8b45c'); } } catch (e) {}
      didOp = true;
      renderControls();
      toast('离心完成 · 6 枚 → 左上角（共 ' + (global.ESCORE && global.ESCORE.exo ? global.ESCORE.exo() : '?') + ' 枚）');
    });
    $('#labDeliver').addEventListener('click', function () { startDeliver(); });
    $('#labClose').addEventListener('click', function () { close(); });
    $('#labPresetRun').addEventListener('click', runPreset);
    $('#labWipe').addEventListener('click', function () {
      log = []; saveLog(); renderLog(); toast('实验记录已清空');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.LAB = { open: open, close: close, init: init, summary: summary, opDone: function () { return didOp; } };
})(window);
