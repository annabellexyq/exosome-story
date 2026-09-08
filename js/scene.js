/* ============================================================
 * scene.js —— 窗外景色的实时渲染器
 * 底图（AI 生成）+ 时刻/季节色调 + 程序化天气粒子 + 记忆光点
 * ============================================================ */
(function (global) {
  'use strict';

  var TodTint = {
    dawn:  { top: 'rgba(255,186,140,0.34)', bot: 'rgba(96,116,168,0.30)', glow: 'rgba(255,214,160,0.34)', gx: .74, gy: .30 },
    day:   { top: 'rgba(255,250,236,0.14)', bot: 'rgba(150,180,210,0.10)', glow: 'rgba(255,248,225,0.20)', gx: .50, gy: .22 },
    dusk:  { top: 'rgba(255,132,96,0.30)',  bot: 'rgba(72,58,124,0.34)',  glow: 'rgba(255,168,110,0.30)', gx: .28, gy: .32 },
    night: { top: 'rgba(18,28,64,0.56)',    bot: 'rgba(8,12,30,0.52)',    glow: 'rgba(150,180,255,0.16)', gx: .62, gy: .20 }
  };
  var SeasonTint = {
    spring: 'rgba(150,200,150,0.10)',
    summer: 'rgba(255,214,120,0.10)',
    autumn: 'rgba(230,150,70,0.14)',
    winter: 'rgba(160,190,235,0.14)'
  };

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function Scene(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(global.devicePixelRatio || 1, 2);
    this.w = 0; this.h = 0;

    this.cur = null;      // 当前底图
    this.next = null;     // 目标底图
    this.fade = 1;        // 0→1 交叉淡化进度
    this.fadeSpeed = 0.012;

    this.state = { season: 'autumn', weather: 'clear', tod: 'dusk', motes: 4 };
    this.locked = false;  // 回忆中：由剧情决定窗外

    this.parts = [];
    this.seeds = [];      // 终章升空的记忆种子
    this.t = 0;

    this._cache = {};
    this._bind();
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  Scene.prototype._bind = function () {
    var self = this;
    global.addEventListener('resize', function () { self.resize(); });
  };

  Scene.prototype.resize = function () {
    var r = this.cv.getBoundingClientRect();
    this.w = Math.max(320, r.width); this.h = Math.max(320, r.height);
    this.cv.width = this.w * this.dpr;
    this.cv.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.seedParts();
  };

  /* 载入底图 */
  Scene.prototype.load = function (src) {
    if (!src) return null;
    if (this._cache[src]) return this._cache[src];
    var img = new Image();
    img.src = src;
    var o = { src: src, img: img, ready: false };
    img.onload = function () { o.ready = true; };
    this._cache[src] = o;
    return o;
  };

  /* 切换到某个场景（带交叉淡化） */
  Scene.prototype.set = function (s) {
    if (!s) return;
    var o = this.load(s.img);
    if (this.cur && this.cur.src === s.img) {
      this.cur = o;
    } else if (this.cur) {
      this.next = o; this.fade = 0;
    } else {
      this.cur = o; this.fade = 1;
    }
    if (s.tod) this.state.tod = s.tod;
    if (s.weather) this.state.weather = s.weather;
    if (s.season) this.state.season = s.season;
    if (typeof s.motes === 'number') this.state.motes = s.motes;
    this.seedParts();
  };

  Scene.prototype.setParams = function (p) {
    if (this.locked) return;
    var before = this.state.weather + '|' + this.state.motes;
    for (var k in p) if (p.hasOwnProperty(k)) this.state[k] = p[k];
    if (before !== this.state.weather + '|' + this.state.motes) this.seedParts();
  };

  Scene.prototype.lock = function (v) { this.locked = !!v; };

  /* ---------- 粒子 ---------- */
  Scene.prototype.seedParts = function () {
    var n = 0, w = this.state.weather;
    if (w === 'rain') n = 150;
    else if (w === 'snow') n = 110;
    else if (w === 'fog') n = 26;
    else if (w === 'motes') n = 70;
    else if (w === 'fireflies') n = 34;
    else if (w === 'leaves') n = 40;
    else if (w === 'stars') n = 90;
    n = Math.round(n * (0.5 + this.state.motes / 14));
    var arr = [];
    for (var i = 0; i < n; i++) arr.push(this.mkPart(true));
    this.parts = arr;
  };

  Scene.prototype.mkPart = function (spread) {
    var w = this.state.weather, W = this.w, H = this.h;
    var p = { x: rnd(0, W), y: spread ? rnd(0, H) : rnd(-60, -5), s: rnd(.6, 1.6), a: rnd(.3, 1) };
    if (w === 'rain') { p.vy = rnd(7, 13); p.vx = rnd(-1.2, -.2); p.len = rnd(12, 26); }
    else if (w === 'snow') { p.vy = rnd(.7, 1.9); p.vx = rnd(-.5, .5); p.r = rnd(1, 2.8); p.ph = rnd(0, 6.28); }
    else if (w === 'fog') { p.vx = rnd(.06, .4) * (Math.random() < .5 ? -1 : 1); p.vy = rnd(-.05, .05); p.r = rnd(90, 260); p.y = rnd(H * .35, H); }
    else if (w === 'motes') { p.vx = rnd(-.25, .25); p.vy = rnd(-.35, -.05); p.r = rnd(.8, 2.4); p.ph = rnd(0, 6.28); }
    else if (w === 'fireflies') { p.vx = rnd(-.5, .5); p.vy = rnd(-.35, .35); p.r = rnd(1.2, 2.6); p.ph = rnd(0, 6.28); p.ps = rnd(.008, .03); }
    else if (w === 'leaves') { p.vx = rnd(-.8, .3); p.vy = rnd(.5, 1.4); p.r = rnd(3, 7); p.ph = rnd(0, 6.28); p.ps = rnd(.01, .05); }
    else if (w === 'stars') { p.r = rnd(.5, 1.5); p.ph = rnd(0, 6.28); p.ps = rnd(.02, .06); p.a = rnd(.25, 1); }
    return p;
  };

  Scene.prototype.stepParts = function () {
    var w = this.state.weather, W = this.w, H = this.h;
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      p.x += (p.vx || 0); p.y += (p.vy || 0);
      if (p.ph !== undefined) p.ph += (p.ps || .02);
      if (p.y > H + 40 || p.y < -80 || p.x < -160 || p.x > W + 160) {
        this.parts[i] = this.mkPart(w === 'fog' ? true : false);
      }
    }
  };

  /* ---------- 绘制 ---------- */
  Scene.prototype.drawBg = function (o, alpha) {
    if (!o || !o.ready) return;
    var ctx = this.ctx, W = this.w, H = this.h, img = o.img;
    var ir = img.width / img.height, cr = W / H, dw, dh, dx = 0, dy = 0;
    if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; }
    else { dw = W; dh = W / ir; dy = (H - dh) / 2 - (H * 0.02); }
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.globalAlpha = 1;
  };

  Scene.prototype.drawTint = function () {
    var ctx = this.ctx, W = this.w, H = this.h, s = this.state;
    var t = TodTint[s.tod] || TodTint.dusk;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, t.top); g.addColorStop(1, t.bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = SeasonTint[s.season] || SeasonTint.autumn;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    var r = Math.max(W, H) * .55;
    var rg = ctx.createRadialGradient(W * t.gx, H * t.gy, 0, W * t.gx, H * t.gy, r);
    rg.addColorStop(0, t.glow); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };

  Scene.prototype.drawParts = function () {
    var ctx = this.ctx, w = this.state.weather;
    if (w === 'clear') return;
    ctx.save();
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      if (w === 'rain') {
        ctx.strokeStyle = 'rgba(200,220,255,' + (0.16 * p.a) + ')';
        ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * p.len / 6, p.y + p.len);
        ctx.stroke();
      } else if (w === 'snow') {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.55 * p.a) + ')';
        ctx.beginPath(); ctx.arc(p.x + Math.sin(p.ph) * 6, p.y, p.r, 0, 6.283); ctx.fill();
      } else if (w === 'fog') {
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, 'rgba(226,232,240,' + (0.055 * p.a) + ')');
        g.addColorStop(1, 'rgba(226,232,240,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      } else if (w === 'motes') {
        var tw = .45 + .55 * (0.5 + 0.5 * Math.sin(p.ph));
        ctx.fillStyle = 'rgba(255,228,170,' + (0.5 * p.a * tw) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      } else if (w === 'fireflies') {
        var fl = .35 + .65 * Math.pow(0.5 + 0.5 * Math.sin(p.ph), 3);
        var gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 7);
        gg.addColorStop(0, 'rgba(255,238,170,' + (0.85 * fl) + ')');
        gg.addColorStop(.35, 'rgba(240,205,110,' + (0.30 * fl) + ')');
        gg.addColorStop(1, 'rgba(240,205,110,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 7, 0, 6.283); ctx.fill();
      } else if (w === 'leaves') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ph);
        ctx.fillStyle = 'rgba(226,150,80,' + (0.6 * p.a) + ')';
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * .5, 0, 0, 6.283); ctx.fill();
        ctx.restore();
      } else if (w === 'stars') {
        var st = .3 + .7 * Math.pow(0.5 + 0.5 * Math.sin(p.ph), 2);
        ctx.fillStyle = 'rgba(240,246,255,' + (0.85 * p.a * st) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.7 + .5 * st), 0, 6.283); ctx.fill();
      }
    }
    ctx.restore();
  };

  /* 记忆光点（始终存在的环境层，数量由 motes 决定） */
  Scene.prototype.drawMemory = function () {
    var n = this.state.motes | 0;
    if (n <= 0) return;
    var ctx = this.ctx, W = this.w, H = this.h, t = this.t / 1000;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (var i = 0; i < n; i++) {
      var px = (i * 137.5) % W;
      var py = ((i * 91.7 + t * 14 + Math.sin(t * .6 + i) * 26) % (H + 80)) - 40;
      var a = .12 + .18 * (0.5 + 0.5 * Math.sin(t * 1.1 + i * 1.7));
      var g = ctx.createRadialGradient(px, py, 0, px, py, 26);
      g.addColorStop(0, 'rgba(255,226,160,' + a + ')');
      g.addColorStop(1, 'rgba(255,226,160,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 26, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  };

  /* 终章：种子升空 */
  Scene.prototype.spawnSeeds = function (colors) {
    var self = this;
    colors.forEach(function (c, i) {
      setTimeout(function () {
        self.seeds.push({
          x: rnd(self.w * .25, self.w * .75), y: self.h * .82,
          vy: rnd(-.5, -1.1), vx: rnd(-.25, .25),
          r: rnd(3, 5.5), c: c, a: 0, ph: rnd(0, 6.28)
        });
      }, i * 260);
    });
  };

  Scene.prototype.drawSeeds = function () {
    var ctx = this.ctx;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (var i = 0; i < this.seeds.length; i++) {
      var s = this.seeds[i];
      s.y += s.vy; s.x += s.vx + Math.sin(this.t / 700 + s.ph) * .3;
      s.a = Math.min(1, s.a + .012);
      var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 9);
      g.addColorStop(0, s.c); g.addColorStop(.3, s.c); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = s.a * .9;
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 9, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.globalAlpha = s.a;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * .5, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  };

  Scene.prototype.loop = function () {
    this.t += 16;
    var ctx = this.ctx, W = this.w, H = this.h;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, W, H);

    if (this.next) {
      this.fade += this.fadeSpeed;
      if (this.fade >= 1) { this.cur = this.next; this.next = null; this.fade = 1; }
    }
    if (this.cur) this.drawBg(this.cur, 1);
    if (this.next) this.drawBg(this.next, Math.max(0, Math.min(1, this.fade)));

    this.drawTint();
    this.drawMemory();
    this.stepParts();
    this.drawParts();
    this.drawSeeds();

    /* 玻璃反光 */
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    var gr = ctx.createLinearGradient(0, 0, W * .7, H);
    gr.addColorStop(0, 'rgba(255,255,255,0.045)');
    gr.addColorStop(.35, 'rgba(255,255,255,0.012)');
    gr.addColorStop(.36, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    ctx.restore();

    requestAnimationFrame(this.loop);
  };

  global.Scene = Scene;
})(window);
