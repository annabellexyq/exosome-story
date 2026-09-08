/* ============================================================
 * microgames.js —— 十六集，每集一种不同的互动玩法
 * 全部为 Canvas 原生实现，鼠标 / 触屏通用
 * ============================================================ */
(function (global) {
  'use strict';

  var W = 900, H = 520;

  function R(a, b) { return a + Math.random() * (b - a); }
  function hit(x, y, cx, cy, r) { var dx = x - cx, dy = y - cy; return dx * dx + dy * dy < r * r; }
  function recordClick(n) { try { if (window.ESCORE && window.ESCORE.addClick) window.ESCORE.addClick(n || 1); } catch (e) {} }
  function glow(ctx, x, y, r, c) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
  }
  function txt(ctx, s, x, y, size, col, align) {
    ctx.fillStyle = col; ctx.font = size + 'px "PingFang SC","Hiragino Sans GB",sans-serif';
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    y = Math.max(38 + size / 2, Math.min(H - 38 - size / 2, y));
    ctx.fillText(s, x, y);
  }
  function serif(ctx, s, x, y, size, col, align) {
    ctx.fillStyle = col; ctx.font = size + 'px "Songti SC","STSong",Georgia,serif';
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    y = Math.max(38 + size / 2, Math.min(H - 38 - size / 2, y));
    ctx.fillText(s, x, y);
  }
  function bar(ctx, x, y, w, h, v, col) {
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, v)), h);
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  }
  function bg(ctx, c1, c2) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function poly(ctx, pts, col) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill();
  }

  /* -----------------------------------------------------
   * 玩法定义：create(api) -> {update(ctx,dt,inp,api), tap?, down?, up?, move?}
   * --------------------------------------------------- */
  var defs = {

    /* E01 接住晨光 */
    morning: {
      title: '接住晨光', hint: '点住飘动的晨光，收集八颗',
      create: function (api) {
        var list = [], got = 0, time = 22;
        for (var i = 0; i < 9; i++) list.push({ x: R(60, W - 60), y: R(70, H - 90), vx: R(-.5, .5), vy: R(-.4, .4), r: R(12, 20), a: R(0, 6.28), on: true });
        return {
          update: function (ctx, dt, inp, api) {
            time -= dt;
            bg(ctx, '#20263a', '#0f1320');
            for (var i = 0; i < list.length; i++) {
              var p = list[i]; if (!p.on) continue;
              p.x += p.vx; p.y += p.vy; p.a += .05;
              if (p.x < 40 || p.x > W - 40) p.vx *= -1;
              if (p.y < 60 || p.y > H - 80) p.vy *= -1;
              var s = p.r * (1 + .12 * Math.sin(p.a));
              glow(ctx, p.x, p.y, s * 3.2, 'rgba(255,226,160,.55)');
              ctx.fillStyle = 'rgba(255,240,200,.95)';
              ctx.beginPath(); ctx.arc(p.x, p.y, s * .34, 0, 6.283); ctx.fill();
            }
            txt(ctx, '晨光 ' + got + ' / 8', W / 2, 34, 18, '#f3ece1');
            bar(ctx, W / 2 - 150, 52, 300, 8, time / 22, '#e8b45c');
            if (got >= 8) api.done({ ok: true, count: got });
            if (time <= 0) api.done({ ok: got >= 5, count: got });
          },
          tap: function (x, y) {
            for (var i = 0; i < list.length; i++) {
              var p = list[i];
              if (p.on && hit(x, y, p.x, p.y, p.r * 2.2)) { p.on = false; got++; return; }
            }
          }
        };
      }
    },

    /* E02 一起呼吸 */
    breathe: {
      title: '一起呼吸', hint: '按住鼠标/手指随光环吸气，在光带里停住，松开呼气，累积三秒',
      create: function (api) {
        var ph = 0, hold = 0, acc = 0, down = false;
        return {
          update: function (ctx, dt, inp, api) {
            ph += dt * 1.7;
            var cyc = (Math.sin(ph) + 1) / 2;          // 0→1→0
            var rad = 40 + cyc * 150;
            var lo = 40 + .74 * 150, hi = 40 + .92 * 150;
            bg(ctx, '#131a2e', '#080b16');
            var cx = W / 2, cy = H / 2 + 10;
            ctx.strokeStyle = 'rgba(150,190,255,.14)'; ctx.lineWidth = 26;
            ctx.beginPath(); ctx.arc(cx, cy, (lo + hi) / 2, 0, 6.283); ctx.stroke();
            var inb = rad >= lo && rad <= hi;
            if (down) { hold = Math.min(1, hold + dt * 3); } else { hold = Math.max(0, hold - dt * 3); }
            if (inb && down) acc += dt; else acc = Math.max(0, acc - dt * .35);
            var rad2 = rad * (1 + .04 * hold);
            ctx.strokeStyle = inb ? 'rgba(255,226,160,.9)' : 'rgba(160,200,255,.5)';
            ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, rad2, 0, 6.283); ctx.stroke();
            glow(ctx, cx, cy, rad2 * .9, 'rgba(120,170,255,' + (.06 + .06 * hold) + ')');
            serif(ctx, inb ? '吸 —— 停' : (cyc > .5 ? '呼' : '吸'), cx, cy, 26, 'rgba(243,236,225,.85)');
            txt(ctx, '共振 ' + acc.toFixed(1) + ' / 3.0 秒', W / 2, 40, 17, '#f3ece1');
            bar(ctx, W / 2 - 150, 58, 300, 8, acc / 3, '#7fa8d8');
            if (acc >= 3) api.done({ ok: true, count: Math.round(acc) });
          },
          down: function () { down = true; },
          up: function () { down = false; }
        };
      }
    },

    /* E03 显影 */
    photo: {
      title: '显影', hint: '逐张轻触相纸，让四格影像在显影液里浮出来',
      create: function (api) {
        var tiles = [], time = 20;
        var cols = ['#c8a06a', '#7f96b8', '#b87f7f', '#8fb89a'];
        for (var i = 0; i < 4; i++) tiles.push({ x: 120 + (i % 2) * 340, y: 120 + ((i / 2) | 0) * 190, d: 0, c: cols[i] });
        return {
          update: function (ctx, dt, inp, api) {
            time -= dt;
            bg(ctx, '#241d1a', '#120e0c');
            ctx.fillStyle = 'rgba(190,60,50,.10)'; ctx.fillRect(0, 0, W, H);
            var done = 0;
            for (var i = 0; i < tiles.length; i++) {
              var t = tiles[i], w = 300, h = 160;
              ctx.save(); ctx.translate(t.x, t.y);
              ctx.fillStyle = 'rgba(250,246,238,' + (.05 + .22 * t.d) + ')';
              ctx.fillRect(0, 0, w, h);
              var bl = (1 - t.d) * 22;
              ctx.globalAlpha = .25 + .75 * t.d;
              glow(ctx, w * .35, h * .45, 70 + bl, t.c);
              glow(ctx, w * .68, h * .6, 52 + bl, 'rgba(240,235,225,.55)');
              ctx.globalAlpha = 1;
              ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
              ctx.strokeRect(.5, .5, w - 1, h - 1);
              txt(ctx, Math.round(t.d * 100) + '%', w - 34, h - 20, 14, 'rgba(255,240,220,.7)');
              ctx.restore();
              if (t.d >= 1) done++;
            }
            txt(ctx, '已显影 ' + done + ' / 4', W / 2, 40, 18, '#f3ece1');
            bar(ctx, W / 2 - 150, 58, 300, 8, time / 20, '#d98b8b');
            if (done >= 4) api.done({ ok: true, count: done });
            if (time <= 0) api.done({ ok: done >= 3, count: done });
          },
          tap: function (x, y) {
            for (var i = 0; i < tiles.length; i++) {
              var t = tiles[i];
              if (x > t.x && x < t.x + 300 && y > t.y && y < t.y + 160 && t.d < 1) { t.d = Math.min(1, t.d + .34); return; }
            }
          }
        };
      }
    },

    /* E04 汽笛与坡度 */
    train: {
      title: '汽笛与坡度', hint: '按住给锅炉加压，松开泄压，把气压稳在绿色区间，陪列车翻过山口',
      create: function (api) {
        var press = .3, band = .5, acc = 0, down = false, t = 0;
        return {
          update: function (ctx, dt, inp, api) {
            t += dt; band = .5 + Math.sin(t * .7) * .26;
            press += (down ? dt * .38 : -dt * .30);
            press = Math.max(0, Math.min(1, press));
            var inb = Math.abs(press - band) < .11;
            acc += (inb ? dt : -dt * .6); acc = Math.max(0, Math.min(6, acc));
            bg(ctx, '#1a2228', '#0c1216');
            /* 山与铁轨 */
            poly(ctx, [[0, H], [0, 340], [180, 220], [340, 330], [520, 190], [720, 320], [W, 250], [W, H]], 'rgba(30,44,52,.9)');
            poly(ctx, [[0, H], [0, 400], [260, 360], [540, 410], [W, 370], [W, H]], 'rgba(18,28,34,.95)');
            ctx.strokeStyle = 'rgba(200,210,220,.25)'; ctx.lineWidth = 2;
            for (var i = 0; i < 8; i++) { var yy = 430 + i * 11; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); }
            /* 列车 */
            var tx = (t * 60) % (W + 300) - 150;
            ctx.fillStyle = '#3c4a44'; ctx.fillRect(tx, 386, 190, 44);
            ctx.fillStyle = '#2b3632'; ctx.fillRect(tx + 150, 372, 56, 58);
            for (var k = 0; k < 4; k++) { ctx.fillStyle = 'rgba(255,240,210,.75)'; ctx.fillRect(tx + 20 + k * 44, 396, 22, 16); }
            for (var s = 0; s < 5; s++) {
              glow(ctx, tx + 190 - s * 42 - (t * 30 % 40), 372 - s * 16, 30, 'rgba(220,230,240,' + (.10 - s * .015) + ')');
            }
            /* 气压表 */
            var bx = W / 2 - 160, by = 30;
            bar(ctx, bx, by, 320, 16, press, inb ? '#79c2b6' : '#e8b45c');
            var bxp = bx + 320 * band;
            ctx.fillStyle = 'rgba(121,194,182,.35)'; ctx.fillRect(bxp - 17, by - 3, 34, 22);
            txt(ctx, '气压', bx - 34, by + 8, 14, '#c9bfae', 'right');
            txt(ctx, '稳住 ' + acc.toFixed(1) + ' / 5.0 秒', W / 2, 74, 17, '#f3ece1');
            bar(ctx, bx, 86, 320, 8, acc / 5, '#79c2b6');
            if (acc >= 5) api.done({ ok: true, count: Math.round(acc) });
            if (t > 30) api.done({ ok: acc >= 3, count: Math.round(acc) });
          },
          down: function () { down = true; }, up: function () { down = false; }
        };
      }
    },

    /* E05 对焦 */
    focus: {
      title: '对焦', hint: '左右拖动（或按住拖动）旋钮，让视野里的光点收拢成星',
      create: function (api) {
        var f = .1, target = .62, ph = 0, acc = 0;
        return {
          update: function (ctx, dt, inp, api) {
            ph += dt * .55; target = .5 + Math.sin(ph) * .42;
            var blur = Math.abs(f - target);
            acc += (blur < .07 ? dt : -dt * .8); acc = Math.max(0, Math.min(1.6, acc));
            bg(ctx, '#0e1420', '#070a12');
            for (var i = 0; i < 26; i++) {
              var a = i / 26 * 6.283, rr = 60 + (i % 5) * 26;
              var cx = W / 2 + Math.cos(a + ph * .2) * rr, cy = H / 2 + Math.sin(a + ph * .2) * rr * .62;
              var b = blur * 46;
              glow(ctx, cx, cy, 12 + b, 'rgba(180,210,255,' + (.30 - blur * .18) + ')');
              ctx.fillStyle = 'rgba(240,248,255,' + (.85 - blur * .5) + ')';
              ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, 6.283); ctx.fill();
            }
            ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(W / 2, H / 2, 190, 0, 6.283); ctx.stroke();
            txt(ctx, '清晰度 ' + Math.max(0, Math.round((1 - blur) * 100)) + '%', W / 2, 38, 17, '#f3ece1');
            /* 旋钮 */
            var kx = 120 + f * (W - 240);
            bar(ctx, 120, H - 70, W - 240, 10, 1, 'rgba(255,255,255,.10)');
            ctx.fillStyle = '#e8b45c'; ctx.beginPath(); ctx.arc(kx, H - 65, 14, 0, 6.283); ctx.fill();
            txt(ctx, '拖动对焦环', W / 2, H - 40, 13, '#c9bfae');
            bar(ctx, W / 2 - 120, H - 26, 240, 8, acc / 1.5, '#7fa8d8');
            if (acc >= 1.4) api.done({ ok: true, count: 1 });
          },
          move: function (x, y, down) { if (down) f = Math.max(0, Math.min(1, (x - 120) / (W - 240))); },
          tap: function (x, y) { f = Math.max(0, Math.min(1, (x - 120) / (W - 240))); }
        };
      }
    },

    /* E06 连星 */
    starpairs: {
      title: '连星', hint: '点亮颜色相同的两颗星，把它们连成一条线',
      create: function (api) {
        var cols = ['#e8b45c', '#7fa8d8', '#79c2b6', '#d98b8b'], stars = [], sel = null, pairs = 0, tries = 0, t = 0;
        var pos = [];
        for (var i = 0; i < 8; i++) pos.push([110 + (i % 4) * 220 + R(-24, 24), 130 + ((i / 4) | 0) * 220 + R(-24, 24)]);
        pos.sort(function () { return Math.random() - .5; });
        for (var j = 0; j < 8; j++) stars.push({ x: pos[j][0], y: pos[j][1], c: cols[(j / 2) | 0], on: false, ph: R(0, 6.28) });
        return {
          update: function (ctx, dt, inp, api) {
            t += dt;
            bg(ctx, '#101a2e', '#060912');
            for (var i = 0; i < stars.length; i++) {
              for (var k = i + 1; k < stars.length; k++) {
                if (stars[i].on && stars[k].on && stars[i].c === stars[k].c) {
                  ctx.strokeStyle = 'rgba(255,240,200,.28)'; ctx.lineWidth = 1.4;
                  ctx.beginPath(); ctx.moveTo(stars[i].x, stars[i].y); ctx.lineTo(stars[k].x, stars[k].y); ctx.stroke();
                }
              }
            }
            for (var m = 0; m < stars.length; m++) {
              var s = stars[m]; s.ph += .03;
              var a = .35 + .3 * Math.sin(s.ph) + (s.on ? .35 : 0);
              glow(ctx, s.x, s.y, s.on ? 46 : 30, s.c);
              ctx.fillStyle = s.c; ctx.globalAlpha = Math.min(1, a + .3);
              ctx.beginPath(); ctx.arc(s.x, s.y, s.on ? 8 : 5.5, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
            }
            if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sel.x, sel.y, 16, 0, 6.283); ctx.stroke(); }
            txt(ctx, '已连成 ' + pairs + ' / 4 条 · 试了 ' + tries + ' 次', W / 2, 40, 18, '#f3ece1');
            if (pairs >= 4) api.done({ ok: true, tries: tries, count: pairs });
          },
          tap: function (x, y) {
            for (var i = 0; i < stars.length; i++) {
              var s = stars[i];
              if (s.on) continue;
              if (hit(x, y, s.x, s.y, 34)) {
                if (!sel) { sel = s; s.on = true; }
                else if (sel.c === s.c) { s.on = true; pairs++; sel = null; }
                else { sel.on = false; tries++; sel = null; }
                return;
              }
            }
          }
        };
      }
    },

    /* E07 信使航线 */
    vesicle: {
      title: '信使航线', hint: '轻点给囊泡一点上浮的力，穿过五道膜孔，把它送到对岸',
      create: function (api) {
        var b = { x: 90, y: H / 2, vy: 0 }, rings = [], passed = 0, t = 0;
        for (var i = 0; i < 5; i++) rings.push({ x: 190 + i * 145, c: R(H * .28, H * .72), on: false, ph: R(0, 6.28) });
        return {
          update: function (ctx, dt, inp, api) {
            t += dt;
            b.vy += dt * 1.5; b.vy = Math.max(-4, Math.min(4, b.vy));
            b.y += b.vy * dt * 8; b.x += dt * 46;
            if (b.y < 60) { b.y = 60; b.vy = .5; }
            if (b.y > H - 60) { b.y = H - 60; b.vy = -.5; }
            bg(ctx, '#0d1a2c', '#050a14');
            for (var i = 0; i < 40; i++) { glow(ctx, (i * 137) % W, (i * 91 + t * 6) % H, 18, 'rgba(120,170,255,.05)'); }
            for (var k = 0; k < rings.length; k++) {
              var r = rings[k]; r.ph += .02;
              var gap = 54 + 8 * Math.sin(r.ph);
              ctx.strokeStyle = r.on ? 'rgba(121,194,182,.8)' : 'rgba(160,190,230,.35)';
              ctx.lineWidth = 6; ctx.beginPath();
              ctx.moveTo(r.x, 40); ctx.lineTo(r.x, r.c - gap); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(r.x, r.c + gap); ctx.lineTo(r.x, H - 40); ctx.stroke();
              if (!r.on && Math.abs(b.x - r.x) < 8 && Math.abs(b.y - r.c) < gap) { r.on = true; passed++; }
            }
            glow(ctx, b.x, b.y, 46, 'rgba(150,220,255,.55)');
            ctx.fillStyle = '#eaf6ff'; ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, 6.283); ctx.fill();
            txt(ctx, '穿过膜孔 ' + passed + ' / 5', W / 2, 40, 18, '#f3ece1');
            if (b.x > W - 60) api.done({ ok: passed >= 3, passed: passed, count: passed });
            if (t > 40) api.done({ ok: passed >= 3, passed: passed, count: passed });
          },
          tap: function () { b.vy = -3.4; }
        };
      }
    },

    /* E08 接住萤火 */
    fireflies: {
      title: '接住萤火', hint: '拖动玻璃瓶左右移动，接住八只萤火，别让它们落地',
      create: function (api) {
        var jar = { x: W / 2, w: 120 }, flies = [], got = 0, time = 26, spawn = 0;
        function mk() { return { x: R(60, W - 60), y: -20, vy: R(1.1, 2.0), vx: R(-.5, .5), ph: R(0, 6.28), on: true }; }
        for (var i = 0; i < 4; i++) flies.push(mk());
        return {
          update: function (ctx, dt, inp, api) {
            time -= dt; spawn -= dt;
            if (spawn <= 0 && flies.length < 6) { flies.push(mk()); spawn = .8; }
            bg(ctx, '#141c2a', '#080c14');
            for (var i = flies.length - 1; i >= 0; i--) {
              var f = flies[i]; f.ph += .06; f.y += f.vy * dt * 30; f.x += f.vx * dt * 30;
              if (f.x < 30 || f.x > W - 30) f.vx *= -1;
              var fl = .4 + .6 * Math.pow(.5 + .5 * Math.sin(f.ph), 3);
              glow(ctx, f.x, f.y, 34 * fl + 12, 'rgba(255,236,160,' + (.5 * fl) + ')');
              ctx.fillStyle = 'rgba(255,250,210,' + (.5 + .5 * fl) + ')';
              ctx.beginPath(); ctx.arc(f.x, f.y, 4, 0, 6.283); ctx.fill();
              if (f.y > H - 78 && Math.abs(f.x - jar.x) < jar.w / 2) { got++; flies.splice(i, 1); continue; }
              if (f.y > H + 10) flies.splice(i, 1);
            }
            /* 瓶子 */
            var jy = H - 62;
            ctx.strokeStyle = 'rgba(200,225,255,.55)'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(jar.x - 60, jy - 40); ctx.lineTo(jar.x - 60, jy + 24);
            ctx.lineTo(jar.x + 60, jy + 24); ctx.lineTo(jar.x + 60, jy - 40); ctx.stroke();
            ctx.fillStyle = 'rgba(160,200,255,.10)'; ctx.fillRect(jar.x - 60, jy - 40, 120, 64);
            txt(ctx, '瓶中 ' + got + ' / 8', W / 2, 40, 18, '#f3ece1');
            bar(ctx, W / 2 - 150, 58, 300, 8, time / 26, '#e8b45c');
            if (got >= 8) api.done({ ok: true, count: got });
            if (time <= 0) api.done({ ok: got >= 5, got: got, count: got });
          },
          move: function (x, y) { jar.x = Math.max(60, Math.min(W - 60, x)); },
          tap: function (x, y) { jar.x = Math.max(60, Math.min(W - 60, x)); }
        };
      }
    },

    /* E09 浇花 */
    orchid: {
      title: '浇花', hint: '每株花的水珠装满时轻点一下，早了晚了都算洒了，浇好三株',
      create: function (api) {
        var fl = [], watered = 0, time = 32;
        for (var i = 0; i < 3; i++) fl.push({ x: 180 + i * 270, y: 300, f: 0, sp: R(.30, .46), done: false, ph: R(0, 6.28) });
        return {
          update: function (ctx, dt, inp, api) {
            time -= dt;
            bg(ctx, '#1b2620', '#0a100c');
            var done = 0;
            for (var i = 0; i < fl.length; i++) {
              var p = fl[i]; p.ph += .04;
              if (!p.done) { p.f += p.sp * dt; if (p.f >= 1.15) p.f = 0; }
              else done++;
              /* 花 */
              ctx.strokeStyle = 'rgba(120,170,130,.7)'; ctx.lineWidth = 4;
              ctx.beginPath(); ctx.moveTo(p.x, p.y + 90); ctx.lineTo(p.x, p.y); ctx.stroke();
              for (var k = 0; k < 5; k++) {
                var a = k / 5 * 6.283 + p.ph * .2;
                glow(ctx, p.x + Math.cos(a) * 22, p.y + Math.sin(a) * 22, 20, p.done ? 'rgba(240,190,220,.5)' : 'rgba(180,200,190,.25)');
                ctx.fillStyle = p.done ? 'rgba(250,225,240,.95)' : 'rgba(200,210,200,.5)';
                ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * 22, p.y + Math.sin(a) * 22, 8, 0, 6.283); ctx.fill();
              }
              /* 水珠环 */
              var good = p.f > .82 && p.f < 1.02;
              ctx.strokeStyle = good ? 'rgba(255,226,160,.95)' : 'rgba(160,190,220,.35)';
              ctx.lineWidth = 4;
              ctx.beginPath(); ctx.arc(p.x, p.y - 70, 26, -1.57, -1.57 + 6.283 * Math.min(1, p.f)); ctx.stroke();
              if (good) glow(ctx, p.x, p.y - 70, 40, 'rgba(255,226,160,.35)');
            }
            txt(ctx, '浇好 ' + done + ' / 3 株', W / 2, 40, 18, '#f3ece1');
            bar(ctx, W / 2 - 150, 58, 300, 8, time / 32, '#79c2b6');
            if (done >= 3) api.done({ ok: true, count: done });
            if (time <= 0) api.done({ ok: done >= 2, count: done });
          },
          tap: function (x, y) {
            for (var i = 0; i < fl.length; i++) {
              var p = fl[i]; if (p.done) continue;
              if (hit(x, y, p.x, p.y, 110)) {
                if (p.f > .82 && p.f < 1.02) { p.done = true; watered++; } else { p.f = 0; }
                return;
              }
            }
          }
        };
      }
    },

    /* E10 助它升高 */
    launch: {
      title: '助它升高', hint: '不断轻点，给发光体一点向上的力，别让它落回屋檐下',
      create: function (api) {
        var b = { y: H - 90, vy: 0 }, alt = 0, time = 22, taps = 0;
        return {
          update: function (ctx, dt, inp, api) {
            time -= dt;
            b.vy += dt * 2.0; b.y += b.vy * dt * 26;
            if (b.y < 70) { b.y = 70; b.vy = 0; }
            if (b.y > H - 90) { b.y = H - 90; b.vy = -.2; }
            alt = Math.max(alt, (H - 90 - b.y) / (H - 160));
            bg(ctx, '#241a2e', '#0a0812');
            for (var i = 0; i < 6; i++) {
              var yy = 120 + i * 70 - (alt * 260) % 70;
              glow(ctx, (i % 2 ? W * .7 : W * .3), yy, 90, 'rgba(200,180,255,.05)');
            }
            glow(ctx, W / 2, b.y, 60, 'rgba(255,226,160,.5)');
            ctx.fillStyle = '#fff6e0'; ctx.beginPath(); ctx.arc(W / 2, b.y, 11, 0, 6.283); ctx.fill();
            txt(ctx, '升高 ' + Math.round(alt * 100) + '%', W / 2, 40, 18, '#f3ece1');
            bar(ctx, 40, 60, 24, H - 160, alt, '#e8b45c');
            bar(ctx, W / 2 - 150, 58, 300, 8, time / 22, '#d98b8b');
            if (alt >= .98) api.done({ ok: true, taps: taps, count: taps });
            if (time <= 0) api.done({ ok: alt >= .7 });
          },
          tap: function () { b.vy = -3.2; taps++; }
        };
      }
    },

    /* E11 撑伞 */
    umbrella: {
      title: '撑伞', hint: '拖动伞柄左右移动，替两个人挡住这场雨，撑满十五秒',
      create: function (api) {
        var ux = W / 2, drops = [], wet = 0, acc = 0, t = 0;
        function mk() { return { x: R(20, W - 20), y: -20, vy: R(3.2, 5.4) }; }
        for (var i = 0; i < 30; i++) drops.push(mk());
        return {
          update: function (ctx, dt, inp, api) {
            t += dt; acc += dt;
            bg(ctx, '#1a2028', '#080c10');
            for (var i = 0; i < drops.length; i++) {
              var d = drops[i]; d.y += d.vy * dt * 30;
              ctx.strokeStyle = 'rgba(190,210,235,.45)'; ctx.lineWidth = 1.4;
              ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y + 16); ctx.stroke();
              if (d.y > H - 150 && d.y < H - 138) {
                if (Math.abs(d.x - ux) < 96) { /* 挡住 */
                  glow(ctx, d.x, d.y, 16, 'rgba(200,225,255,.35)');
                } else if (Math.abs(d.x - W / 2) < 70) { wet++; }
              }
              if (d.y > H) { drops[i] = mk(); }
            }
            /* 人 */
            var gy = H - 60;
            ctx.fillStyle = 'rgba(230,225,215,.75)';
            ctx.beginPath(); ctx.arc(W / 2 - 26, gy - 46, 16, 0, 6.283); ctx.fill();
            ctx.fillRect(W / 2 - 34, gy - 30, 16, 44);
            ctx.beginPath(); ctx.arc(W / 2 + 30, gy - 30, 12, 0, 6.283); ctx.fill();
            ctx.fillRect(W / 2 + 22, gy - 18, 16, 32);
            /* 伞 */
            ctx.fillStyle = 'rgba(232,180,92,.85)';
            ctx.beginPath(); ctx.arc(ux, gy - 110, 100, 3.34, 6.08); ctx.fill();
            ctx.strokeStyle = 'rgba(60,44,30,.9)'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(ux, gy - 110); ctx.lineTo(ux, gy - 20); ctx.stroke();
            txt(ctx, '撑住 ' + acc.toFixed(1) + ' / 15.0 秒 · 淋湿 ' + wet, W / 2, 40, 18, '#f3ece1');
            bar(ctx, W / 2 - 150, 58, 300, 8, acc / 15, '#7fa8d8');
            if (acc >= 15) api.done({ ok: wet < 26, wet: wet, count: 1 });
            if (wet >= 26) api.done({ ok: false, wet: wet });
          },
          move: function (x) { ux = Math.max(100, Math.min(W - 100, x)); },
          tap: function (x) { ux = Math.max(100, Math.min(W - 100, x)); }
        };
      }
    },

    /* E12 描一封信 */
    trace: {
      title: '描一封信', hint: '按住不放，让指尖跟着光点走完这封信的笔画',
      create: function (api) {
        var ph = 0, cov = 0, down = false, t = 0;
        function pos(p) {
          var a = p * 6.283;
          return [W / 2 + Math.sin(a) * 190 + Math.sin(a * 3) * 46, H / 2 + Math.cos(a * 2) * 118 - 20];
        }
        return {
          update: function (ctx, dt, inp, api) {
            t += dt; ph += dt * .34; if (ph > 1) ph -= 1;
            var p = pos(ph);
            bg(ctx, '#141a2c', '#080b14');
            ctx.strokeStyle = 'rgba(255,240,210,.18)'; ctx.lineWidth = 10; ctx.lineCap = 'round';
            ctx.beginPath();
            for (var i = 0; i <= 90; i++) { var q = pos(i / 90); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
            ctx.stroke();
            ctx.strokeStyle = 'rgba(232,180,92,.85)'; ctx.lineWidth = 10;
            ctx.beginPath();
            for (var k = 0; k <= 90 * cov; k++) { var r = pos(k / 90); k ? ctx.lineTo(r[0], r[1]) : ctx.moveTo(r[0], r[1]); }
            ctx.stroke();
            glow(ctx, p[0], p[1], 34, 'rgba(255,240,200,.55)');
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, 6.283); ctx.fill();
            if (down && hit(inp.x, inp.y, p[0], p[1], 52)) cov = Math.min(1, cov + dt * .55);
            else cov = Math.max(0, cov - dt * .05);
            txt(ctx, '描过 ' + Math.round(cov * 100) + '%', W / 2, 40, 18, '#f3ece1');
            bar(ctx, W / 2 - 150, 58, 300, 8, cov, '#e8b45c');
            if (cov >= .98) api.done({ ok: true, count: 1 });
            if (t > 60) api.done({ ok: cov > .6, count: 1 });
          },
          down: function () { down = true; }, up: function () { down = false; }
        };
      }
    },

    /* E13 记方 */
    recipe: {
      title: '记方', hint: '先看一遍她配试剂的顺序，再照着点出来，两轮都对才算记住',
      create: function (api) {
        var syms = [
          function (ctx, x, y, s, c) { ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, s, 0, 6.283); ctx.stroke(); },
          function (ctx, x, y, s, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s); ctx.lineTo(x - s, y + s); ctx.closePath(); ctx.fill(); },
          function (ctx, x, y, s, c) { ctx.fillStyle = c; ctx.fillRect(x - s, y - s, s * 2, s * 2); },
          function (ctx, x, y, s, c) { ctx.fillStyle = c; ctx.beginPath(); for (var i = 0; i < 10; i++) { var a = i / 10 * 6.283 - 1.57, r = i % 2 ? s * .45 : s; i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); ctx.fill(); },
          function (ctx, x, y, s, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x + s, y + s * .3, x, y + s); ctx.quadraticCurveTo(x - s, y + s * .3, x, y - s); ctx.fill(); },
          function (ctx, x, y, s, c) { ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, s * .6, 0, 6.283); ctx.stroke(); }
        ];
        var phase = 'show', seq = [], idx = 0, timer = 0, round = 0, need = [4, 5];
        function newRound() {
          seq = []; var pool = [0, 1, 2, 3, 4, 5].sort(function () { return Math.random() - .5; });
          for (var i = 0; i < need[round]; i++) seq.push(pool[i]);
          idx = 0; timer = 0; phase = 'show';
        }
        newRound();
        function cells() {
          var out = [];
          for (var i = 0; i < 6; i++) out.push([150 + (i % 3) * 300, 190 + ((i / 3) | 0) * 170]);
          return out;
        }
        return {
          update: function (ctx, dt, inp, api) {
            timer += dt;
            bg(ctx, '#131c22', '#070c10');
            var cs = cells();
            for (var i = 0; i < 6; i++) {
              var on = (phase === 'show' && seq[idx] === i && idx < seq.length);
              glow(ctx, cs[i][0], cs[i][1], on ? 74 : 40, on ? 'rgba(255,226,160,.45)' : 'rgba(255,255,255,.03)');
              syms[i](ctx, cs[i][0], cs[i][1], 34, on ? '#fff3d6' : 'rgba(200,215,230,.55)');
              if (on) {
                ctx.strokeStyle = 'rgba(255,226,160,.9)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(cs[i][0], cs[i][1], 62, 0, 6.283); ctx.stroke();
                txt(ctx, String(idx + 1), cs[i][0] + 46, cs[i][1] - 46, 16, '#e8b45c');
              }
            }
            if (phase === 'show') {
              if (timer > .85) { timer = 0; idx++; if (idx >= seq.length) { phase = 'input'; idx = 0; timer = 0; } }
              txt(ctx, '第 ' + (round + 1) + ' 轮 · 记住顺序', W / 2, 46, 18, '#f3ece1');
            } else {
              txt(ctx, '第 ' + (round + 1) + ' 轮 · 照着点 ' + (idx + 1) + ' / ' + seq.length, W / 2, 46, 18, '#f3ece1');
              if (timer > 12) { newRound(); }
            }
          },
          tap: function (x, y) {
            if (phase !== 'input') return;
            var cs = cells();
            for (var i = 0; i < 6; i++) {
              if (hit(x, y, cs[i][0], cs[i][1], 56)) {
                if (seq[idx] === i) { idx++; timer = 0; if (idx >= seq.length) { round++; if (round >= 2) api.done({ ok: true, count: seq.length * round }); else newRound(); } }
                else { round = 0; newRound(); }
                return;
              }
            }
          }
        };
      }
    },

    /* E14 理照片 */
    order: {
      title: '理照片', hint: '把五张照片按年份从早到晚点一遍，帮他把一生排回原处',
      create: function (api) {
        var years = [1958, 1963, 1971, 1980, 1994].sort(function () { return Math.random() - .5; });
        var cards = years.map(function (y, i) {
          return { y: y, x: 40 + i * 170, want: 0, done: false, shake: 0 };
        });
        var sorted = years.slice().sort(function (a, b) { return a - b; });
        var step = 0;
        return {
          update: function (ctx, dt, inp, api) {
            bg(ctx, '#251d16', '#100c08');
            for (var i = 0; i < cards.length; i++) {
              var c = cards[i];
              if (c.shake > 0) c.shake -= dt * 4;
              var sx = c.shake > 0 ? Math.sin(c.shake * 30) * 6 : 0;
              ctx.save(); ctx.translate(c.x + sx, 240);
              ctx.fillStyle = c.done ? 'rgba(250,244,232,.92)' : 'rgba(240,232,214,.78)';
              ctx.fillRect(0, 0, 140, 190);
              glow(ctx, 70, 80, 60, 'rgba(120,100,80,.25)');
              ctx.fillStyle = 'rgba(60,50,40,.75)'; ctx.fillRect(0, 150, 140, 40);
              ctx.fillStyle = '#f6ecd8'; ctx.font = '20px Georgia,serif'; ctx.textAlign = 'center';
              ctx.fillText(String(c.y), 70, 172);
              ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.strokeRect(.5, .5, 139, 189);
              if (c.done) { ctx.fillStyle = 'rgba(232,180,92,.9)'; ctx.fillText('✓', 70, 60); }
              ctx.restore();
            }
            txt(ctx, '按顺序点出年份 · 已排好 ' + step + ' / 5', W / 2, 46, 18, '#f3ece1');
            txt(ctx, '提示：最早的那一年是 ' + sorted[0], W / 2, H - 60, 14, '#c9bfae');
            if (step >= 5) api.done({ ok: true, count: 5 });
          },
          tap: function (x, y) {
            for (var i = 0; i < cards.length; i++) {
              var c = cards[i];
              if (c.done) continue;
              if (x > c.x && x < c.x + 140 && y > 240 && y < 430) {
                if (c.y === sorted[step]) { c.done = true; step++; if (step >= 5) { } }
                else { c.shake = .4; }
                return;
              }
            }
          }
        };
      }
    },

    /* E15 四季之转 */
    season: {
      title: '四季之转', hint: '左右拖动圆盘，转到桂花开的那一季，停住一秒',
      create: function (api) {
        var names = ['春', '夏', '秋', '冬'], cols = ['#8fc39a', '#7fb2d8', '#e8b45c', '#b9c9e0'];
        var ang = 0, hold = 0, target = 2, dragging = false;
        return {
          update: function (ctx, dt, inp, api) {
            bg(ctx, '#1c1a24', '#08080c');
            var cur = ((Math.round(ang / (6.283 / 4)) % 4) + 4) % 4;
            glow(ctx, W / 2, 250, 200, hexa(cols[cur], .10));
            /* 树 */
            ctx.strokeStyle = 'rgba(90,70,50,.9)'; ctx.lineWidth = 12;
            ctx.beginPath(); ctx.moveTo(W / 2, 430); ctx.lineTo(W / 2, 250); ctx.stroke();
            for (var i = 0; i < 7; i++) {
              var a = -1.9 + i * .32;
              ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(W / 2, 300);
              ctx.lineTo(W / 2 + Math.cos(a) * 110, 300 + Math.sin(a) * 90); ctx.stroke();
            }
            var bloom = cur === 2 ? 1 : (cur === 0 ? .5 : cur === 1 ? .15 : 0);
            for (var k = 0; k < 60; k++) {
              if (Math.random() > bloom * .7 + .02) continue;
              var px = W / 2 + Math.cos(k * 2.4) * (40 + (k % 7) * 22), py = 250 + Math.sin(k * 1.7) * 60;
              ctx.fillStyle = cols[cur]; ctx.globalAlpha = .35 + bloom * .5;
              ctx.beginPath(); ctx.arc(px, py, 3 + bloom * 2, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
            }
            /* 圆盘 */
            ctx.save(); ctx.translate(W / 2, H - 96); ctx.rotate(ang);
            for (var s = 0; s < 4; s++) {
              var aa = s * 6.283 / 4;
              ctx.fillStyle = s === target ? 'rgba(232,180,92,.95)' : 'rgba(255,255,255,.22)';
              ctx.beginPath(); ctx.arc(Math.cos(aa) * 78, Math.sin(aa) * 78, 16, 0, 6.283); ctx.fill();
              ctx.fillStyle = '#12121a'; ctx.font = '16px "Songti SC",serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText(names[s], Math.cos(aa) * 78, Math.sin(aa) * 78);
            }
            ctx.restore();
            ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(W / 2, H - 96, 104, 0, 6.283); ctx.stroke();
            txt(ctx, '拖动圆盘 · 当前：' + names[cur], W / 2, 42, 18, '#f3ece1');
            txt(ctx, '桂花在「秋」', W / 2, 68, 14, '#c9bfae');
            bar(ctx, W / 2 - 120, H - 26, 240, 8, hold / 1, '#e8b45c');
            if (cur === target) hold = Math.min(1, hold + dt); else hold = Math.max(0, hold - dt * 2);
            if (hold >= 1) api.done({ ok: true, count: 1 });
          },
          drag: function (dx) { ang += dx * .012; },
          tap: function (x, y) {
            var a = Math.atan2(y - (H - 96), x - W / 2);
            ang = a;
          }
        };
      }
    },

    /* E16 十六枚种子 */
    stars: {
      title: '十六枚种子', hint: '星河里亮起哪一颗，就点哪一颗，把十六枚种子一一送回天上',
      create: function (api) {
        var list = [], i2 = 0, lit = -1, timer = 0, t = 0;
        for (var i = 0; i < 16; i++) {
          var a = i / 16 * 6.283 * 2.2, r = 40 + i * 12;
          list.push({ x: W / 2 + Math.cos(a) * r * .95, y: H / 2 + Math.sin(a) * r * .55, on: false, ph: R(0, 6.28), c: R(0, 1) });
        }
        return {
          update: function (ctx, dt, inp, api) {
            t += dt; timer += dt;
            bg(ctx, '#0e1426', '#05070f');
            if (lit < 0 && timer > .35) { lit = i2; timer = 0; }
            for (var i = 0; i < list.length; i++) {
              var s = list[i]; s.ph += .03;
              var isLit = (i === lit);
              var a = .25 + .25 * Math.sin(s.ph) + (s.on ? .5 : 0) + (isLit ? .35 : 0);
              var col = s.on ? 'rgba(255,226,160,' : (isLit ? 'rgba(255,250,230,' : 'rgba(180,200,235,');
              glow(ctx, s.x, s.y, s.on ? 44 : (isLit ? 56 : 26), col + (a * .5) + ')');
              ctx.fillStyle = col + Math.min(1, a + .3) + ')';
              ctx.beginPath(); ctx.arc(s.x, s.y, s.on ? 7 : (isLit ? 9 : 4.5), 0, 6.283); ctx.fill();
            }
            txt(ctx, '送回天上 ' + i2 + ' / 16', W / 2, 40, 18, '#f3ece1');
            if (i2 >= 16) api.done({ ok: true, count: i2 });
          },
          tap: function (x, y) {
            if (lit < 0) return;
            var s = list[lit];
            if (hit(x, y, s.x, s.y, 56)) {
              s.on = true; i2++; lit = -1; timer = 0;
            }
          }
        };
      }
    }
  };

  function hexa(hex, a) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* ---------------- 运行器 ---------------- */
  var current = null;

  /* 二维版（WebGL 不可用时的降级方案） */
  function play2D(id, cv, titleEl, hintEl) {
    var def = defs[id];
    if (!def) return Promise.resolve({ ok: true });
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    if (titleEl) titleEl.textContent = def.title;
    if (hintEl) hintEl.textContent = def.hint;

    return new Promise(function (resolve) {
      var inp = { x: W / 2, y: H / 2, down: false, lx: W / 2 };
      var last = 0, raf = 0, over = false;

      var api = {
        W: W, H: H,
        done: function (r) { if (over) return; over = true; cancelAnimationFrame(raf); off(); resolve(r || { ok: true }); },
        hint: function (s) { if (hintEl) hintEl.textContent = s; }
      };
      var g = def.create(api);

      function pos(e) {
        var r = cv.getBoundingClientRect();
        var cx = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
        var cy = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
        return { x: (cx - r.left) / r.width * W, y: (cy - r.top) / r.height * H };
      }
      function onDown(e) {
        e.preventDefault(); var p = pos(e); inp.x = p.x; inp.y = p.y; inp.down = true; inp.lx = p.x;
        if (g.down) g.down(p.x, p.y);
      }
      function onMove(e) {
        var p = pos(e); inp.lx = inp.x; inp.x = p.x; inp.y = p.y;
        if (g.drag && inp.down) g.drag(p.x - inp.lx);
        if (g.move) g.move(p.x, p.y, inp.down);
      }
      function onUp(e) {
        var p = pos(e); inp.down = false; inp.x = p.x; inp.y = p.y;
        if (g.up) g.up(p.x, p.y);
        if (g.move) g.move(p.x, p.y, false);
        if (Math.abs(p.x - (e.changedTouches ? 0 : 0)) >= 0 && g.tap) { g.tap(p.x, p.y); recordClick(1); }
      }
      function onKey(e) { if (e.code === 'Space' && g.tap) { e.preventDefault(); g.tap(inp.x, inp.y); } }
      function off() {
        cv.removeEventListener('mousedown', onDown); cv.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        cv.removeEventListener('touchstart', onDown); cv.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
        window.removeEventListener('keydown', onKey);
      }
      cv.addEventListener('mousedown', onDown); cv.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      cv.addEventListener('touchstart', onDown, { passive: false });
      cv.addEventListener('touchmove', function (e) { e.preventDefault(); onMove(e); }, { passive: false });
      window.addEventListener('touchend', onUp);
      window.addEventListener('keydown', onKey);

      function frame(ts) {
        if (over) return;
        var dt = last ? Math.min(.05, (ts - last) / 1000) : .016;
        last = ts;
        g.update(ctx, dt, inp, api);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      current = { abort: function () { api.done({ ok: true, skipped: true }); } };
    });
  }

  /* 入口：优先基于背景图的 2D 叙事解谜（puzzles.js），缺失时回退原抽象版 */
  function play(id, cv, titleEl, hintEl) {
    if (window.PUZZLES && window.PUZZLES.play) {
      return window.PUZZLES.play(id, cv, titleEl, hintEl);
    }
    return play2D(id, cv, titleEl, hintEl);
  }

  global.MG = {
    play: play,
    abort: function () { try { window.MG3D && window.MG3D.abort(); } catch (e) { } try { window.PUZZLES && window.PUZZLES.abort(); } catch (e) { } if (current) current.abort(); },
    defs: defs
  };
})(window);
