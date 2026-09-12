/* ============================================================
 * engine.js —— 剧情引擎
 * 视觉小说推进 + 选择分支 + 迷你玩法 + 种子收集 + 窗景调参
 * ============================================================ */
(function () {
  'use strict';

  var global = window;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var SAVE_KEY = 'exo-window-story-v1';

  var SPEAKER = {
    '周怀明': '#e8b45c',
    '温澈': '#79c2b6',
    '苏蓝': '#7fa8d8',
    '父亲': '#c8a06a',
    '外婆': '#d98b8b',
    '母亲': '#d98b8b',
    '周兰蕙': '#e8d68a',
    '陈先生': '#c9bfae'
  };

  var ACTS = (window.ACTS1 || []).concat(window.ACTS2 || []);
  var ALL_FACTS = ACTS.map(function (a) {
    var s = (a.steps || []).filter(function (x) { return x.k === 'seed'; })[0];
    return s ? { n: a.n, name: s.name, fact: s.fact } : null;
  }).filter(Boolean);

  var S = {
    ep: 0, i: 0, seeds: [], unlocked: 0, runId: 0,
    gameMs: 0, exo: 0, clicks: 0, egg: false, eggOpened: false, xrGot: [],
    typing: false, busy: false, auto: false, sound: true, music: true,
    pending: null, panelClose: null, params: null, musicVol: .68, endingChoice: null
  };

  function stubScene() {
    return {
      state: { season: 'autumn', weather: 'clear', tod: 'dusk', motes: 4 },
      set: function () {}, setParams: function () {}, lock: function () {}, spawnSeeds: function () {}
    };
  }
  var scene;
  try { scene = new window.Scene($('#scene')); }
  catch (e) { console.error('Scene 初始化失败，使用占位场景：', e); scene = stubScene(); }

  /* ---------------- 音效 ---------------- */
  var actx = null;
  function beep(freq, dur, type, vol) {
    if (!S.sound) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(vol || .06, actx.currentTime + .02);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur + .02);
    } catch (e) { /* 静默 */ }
  }
  /* 优先用 audio.js 的合成音效，缺失时回落到简单 beep */
  function sfxCall(k, a) {
    try { if (global.Audio2 && global.Audio2.sfx[k]) { global.Audio2.sfx[k](a); return true; } } catch (e) { }
    return false;
  }
  var sfx = {
    click: function () { if (!sfxCall('click')) beep(520, .06, 'sine', .03); },
    type: function () { if (!sfxCall('type')) beep(880, .02, 'triangle', .012); },
    seed: function () {
      if (!sfxCall('seed')) {
        beep(660, .25, 'sine', .07);
        setTimeout(function () { beep(990, .5, 'sine', .06); }, 120);
      }
    },
    open: function () { if (!sfxCall('open')) beep(420, .12, 'triangle', .04); },
    win: function () { sfxCall('win'); },
    bad: function () { sfxCall('bad'); }
  };

  /* ---------------- 存档 ---------------- */
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        unlocked: S.unlocked,
        seeds: S.seeds.map(function (s) { return s.name; }),
        gameMs: S.gameMs || 0,
        clicks: S.clicks || 0,
        exo: S.exo || 0,
        egg: !!S.egg,
        xrGot: S.xrGot || [],
        params: scene.state,
        sound: S.sound, music: S.music, musicVol: S.musicVol
      }));
    } catch (e) { /* 忽略 */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (d && typeof d.unlocked === 'number') {
        d.gameMs = d.gameMs || 0;
        d.clicks = d.clicks || 0;
        d.exo = d.exo || 0;
        d.egg = !!d.egg;
        d.xrGot = Array.isArray(d.xrGot) ? d.xrGot : [];
        return d;
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /* ---------------- 积分 / 排名 / 彩蛋 ---------------- */
  var LB_KEY = 'exo-lb-v1';
  var EGG_THRESHOLD = 16; /* 收齐全部 16 枚故事种子即触发彩蛋 */
  function loadLB() {
    try { var v = localStorage.getItem(LB_KEY); if (v) return JSON.parse(v); } catch (e) { }
    /* 首次：放入几位虚拟"信使"作为排名参照 */
    return [
      { exo: 23, ms: 760000, ghost: '林' }, { exo: 21, ms: 980000, ghost: '苏' },
      { exo: 18, ms: 1120000, ghost: '陈' }, { exo: 16, ms: 1300000, ghost: '周' },
      { exo: 12, ms: 1500000, ghost: '温' }, { exo: 7, ms: 1680000, ghost: '何' }
    ];
  }
  function saveLB(a) { try { localStorage.setItem(LB_KEY, JSON.stringify(a)); } catch (e) { } }
  function fmtMs(ms) { var s = Math.floor((ms || 0) / 1000), m = Math.floor(s / 60); return ('0' + m).slice(-2) + ':' + ('0' + (s % 60)).slice(-2); }
  function rankInfo() {
    var lb = loadLB(), cur = { exo: S.exo || 0, ms: S.gameMs || 0 };
    var better = lb.filter(function (e) { return e.exo > cur.exo || (e.exo === cur.exo && e.ms < cur.ms); }).length;
    var total = lb.length + (((S.exo || 0) > 0 || (S.gameMs || 0) > 0) ? 1 : 0);
    return { rank: better + 1, total: total };
  }
  /* 外泌体计数：数字滚动上升 + 跳字脉冲 */
  var exoShown = 0;
  /* 直接同步为真实枚数：不做滚动动画，避免中间态导致读数与实际收集数不一致 */
  function animateExo(el, to) {
    if (!el) return;
    to = to || 0;
    if (exoShown === to) { el.textContent = to; return; }
    exoShown = to;
    el.textContent = to;
    var row = el.parentNode;
    if (row) { row.classList.remove('bump'); void row.offsetWidth; row.classList.add('bump'); }
  }
  /* 逐项 try/catch：任何一项出错都不能拖垮外泌体计数的显示 */
  function renderScore() {
    try { animateExo($('#scoreExo'), S.exo || 0); } catch (e) { }
    try { var t = $('#scoreTime'); if (t) t.textContent = fmtMs(S.gameMs); } catch (e) { }
    try { var rk = $('#scoreRank'); if (rk) { var r = rankInfo(); rk.textContent = '第 ' + r.rank + ' / ' + r.total + ' 名'; } } catch (e) { }
  }
  function recordRun() {
    var lb = loadLB();
    lb.push({ exo: S.exo || 0, ms: S.gameMs || 0, date: Date.now() });
    lb.sort(function (a, b) { return (b.exo - a.exo) || (a.ms - b.ms); });
    if (lb.length > 40) lb = lb.slice(0, 40);
    saveLB(lb); renderScore();
  }
  /* 彩蛋：星河视频（v3）只在彩蛋里出现，关面板即停 */
  function addGame(ms) { if (typeof ms === 'number' && ms > 0) { S.gameMs = (S.gameMs || 0) + ms; save(); renderScore(); } }
  function addExo(n, key) {
    n = n || 1;
    if (key) {
      S.xrGot = S.xrGot || [];
      if (S.xrGot.indexOf(key) >= 0) return false;
      S.xrGot.push(key);
    }
    S.exo = (S.exo || 0) + n; save(); renderScore();
    if (!S.egg && (S.exo || 0) >= EGG_THRESHOLD) {
      S.egg = true; save();
      try { toast('外泌体已收齐 · 信使彩蛋解锁'); } catch (e) { }
      return true;
    }
    return false;
  }
  function addClick(n) {
    n = n || 1;
    S.clicks = (S.clicks || 0) + n;
    save(); renderScore();
  }
  /* 小游戏 / 实验台：收下 n 枚外泌体，并把光点一一飞向左上角计数 */
  function gain(n, color) { addExo(n || 1); flyExo(n || 1, color); }
  window.ESCORE = { addGame: addGame, addExo: addExo, gain: gain, fly: flyExo, addClick: addClick, render: renderScore, record: recordRun, exo: function () { return S.exo || 0; } };

  /* ---------------- 整段计时（覆盖：小说阅读 + 小游戏 + 实验台 + XR 全部点击过程） ---------------- */
  var session = { active: false, last: 0, timer: 0 };
  function tickSession() {
    if (!session.active) return;
    var n = (window.performance ? performance.now() : Date.now());
    S.gameMs += (n - session.last); session.last = n;
    try { renderScore(); } catch (e) { }
  }
  function startSession() {
    S.gameMs = 0; S.clicks = 0; session.active = true;
    session.last = (window.performance ? performance.now() : Date.now());
    if (!session.timer) session.timer = setInterval(tickSession, 250);
    try { renderScore(); } catch (e) { }
  }
  function stopSession() {
    tickSession(); session.active = false;
    if (session.timer) { clearInterval(session.timer); session.timer = 0; }
    save();
  }

  /* ---------------- 弹层 ---------------- */
  function openPanel(id) {
    $('#overlay').classList.remove('hidden');
    $$('.panel').forEach(function (p) { p.classList.toggle('show', p.id === id); });
    sfx.open();
    return new Promise(function (res) { S.panelClose = res; });
  }
  function closePanel() {
    $('#overlay').classList.add('hidden');
    $$('.panel').forEach(function (p) { p.classList.remove('show'); });
    var cb = S.panelClose; S.panelClose = null;
    if (cb) cb();
  }
  $$('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { sfx.click(); closePanel(); });
  });
  $('#overlay').addEventListener('click', function (e) {
    if (e.target !== this) return;
    var open = $$('.panel.show')[0];
    if (open && (open.id === 'panelSeed' || open.id === 'panelChapters' || open.id === 'panelCodex' || open.id === 'panelParams')) closePanel();
  });

  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('on'); }, ms || 2000);
  }

  /* ---------------- 打字机 ---------------- */
  var typeTimer = null, _curText = '';
  function render(who, text, isNarr) {
    return new Promise(function (res) {
      _curText = text;
      var el = $('#text'), w = $('#who');
      w.textContent = who || '';
      w.style.color = isNarr ? 'var(--teal)' : (SPEAKER[who] || 'var(--gold)');
      w.classList.toggle('narr', !!isNarr);
      el.textContent = '';
      S.typing = true;
      var i = 0;
      clearInterval(typeTimer);
      typeTimer = setInterval(function () {
        el.textContent = text.slice(0, ++i);
        if (i % 3 === 0) sfx.type();
        if (i >= text.length) {
          clearInterval(typeTimer); typeTimer = null;
          S.typing = false;
          $('#cont').style.opacity = 1;
          if (S.pending === res) { S.pending = null; res(); }  /* 打字完成即继续到 waitClick */
        }
      }, 32);
      S.pending = res;
    });
  }
  function finishTyping() {
    if (!S.typing) return false;
    clearInterval(typeTimer); typeTimer = null; S.typing = false;
    return true;
  }

  function waitClick() {
    return new Promise(function (res) {
      S.pending = res;
      if (S.auto) {
        /* 自动模式：按本句长度等比停顿后自动继续，无需点击 */
        var ms = Math.min(3200, 900 + (_curText.length * 34));
        setTimeout(function () { if (S.pending === res) { S.pending = null; res(); } }, ms);
      }
    });
  }

  /* ---------------- 步骤执行 ---------------- */
  function applyScene(sc) {
    if (!sc) return;
    var s = {};
    for (var k in sc) if (sc.hasOwnProperty(k)) s[k] = sc[k];
    scene.set(s);
    syncParamUI();
    /* 音乐随窗外切换氛围 */
    try {
      if (global.Audio2) global.Audio2.setMood(s.tod || scene.state.tod, s.weather || scene.state.weather);
    } catch (e) { }
  }

  async function runStep(st) {
    if (st.k === 'sc') { applyScene(st); return; }

    if (st.k === 'xr') { await (window.openXR ? window.openXR() : Promise.resolve()); return; }

    if (st.k === 'narr') {
      await render('', st.t, true);
      await waitClick();
      return;
    }

    if (st.k === 'say') {
      await render(st.w, st.t, false);
      await waitClick();
      return;
    }

    if (st.k === 'choose') {
      await render('', st.q, true);
      var o = await pick(st.o, ACTS[S.ep]);
      if (o && o.follow) { await render('', o.follow, true); await waitClick(); }
      return;
    }

    if (st.k === 'game') {
      if (st.before) { await render('', st.before, true); await waitClick(); }
      await runGame(st.g);
      if (st.after) { await render('', st.after, true); await waitClick(); }
      return;
    }

    if (st.k === 'seed') {
      await collectSeed(st);
      return;
    }

    if (st.k === 'tut') {
      toast('先调一调窗外：季节、天气、时刻、光点密度');
      await openPanel('panelParams');
      toast('窗外记住了。');
      return;
    }

    if (st.k === 'end') {
      await showEnding();
      return;
    }

    if (st.k === 'egg') {
      await playEggScene();        /* 尾声专属：仰望星空 + 信，必出现（含实验台结果与最终排名） */
      return;
    }
  }

  /* 彩蛋：作为尾声专属的两个框出现（仰望星空 + 信），不混入其它面板 */
  async function playEggScene() {
    applyScene({ img: 'assets/bg/epilogue_end.jpg', tod: 'night', weather: 'stars', season: 'autumn', motes: 9 });

    /* 汇总：实验台最后结果 + 最终排名计分机制结果 */
    var lab = (window.LAB && window.LAB.summary) ? window.LAB.summary() : null;
    var rk = rankInfo();
    var exo = S.exo || 0, time = fmtMs(S.gameMs);
    var labLine1, labLine2;
    if (lab) {
      labLine1 = '实验台共投递 ' + lab.n + ' 次，最佳归巢 ' + lab.best + ' 分，';
      labLine2 = '平均 ' + lab.avg + ' 分，成功 ' + lab.success + ' 次（成功率 ' + Math.round(lab.rate * 100) + '%）。';
    } else {
      labLine1 = '实验台这一次没有投递记录，';
      labLine2 = '但每枚外泌体都已记在窗外。';
    }
    var statLine = '最终计分：外泌体 ' + exo + ' 枚 · 用时 ' + time + '。';
    var rankLine = '排名：第 ' + rk.rank + ' / ' + rk.total + ' 名。';

    var eggRank = $('#eggRank');
    if (eggRank) eggRank.innerHTML = '<p>' + labLine1 + '</p><p>' + labLine2 + '</p><p>' + statLine + '</p><p>' + rankLine + '</p>';

    var vid = $('#eggVideo');
    try { vid.currentTime = 0; vid.play(); } catch (e) { }
    await openPanel('panelEgg');
    try { vid.pause(); } catch (e) { }
    await openPanel('panelLetter');
  }

  var SCALE = { micro: '微观', meso: '中观', macro: '宏观' };

  function pick(opts, ep) {
    return new Promise(function (res) {
      var box = $('#choices');
      box.innerHTML = '';
      box.classList.remove('hidden');
      var hasScale = opts.some(function (o) { return o.scale; });
      if (hasScale) {
        var q = document.createElement('div');
        q.className = 'q';
        q.textContent = '任选一层 —— 微观 / 中观 / 宏观';
        box.appendChild(q);
      }
      opts.forEach(function (o) {
        var b = document.createElement('button');
        b.className = 'choice' + (o.scale ? ' has-scale' : '');
        var badge = o.scale ? '<span class="cscale ' + o.scale + '">' + (SCALE[o.scale] || o.scale) + '</span>' : '';
        b.innerHTML = badge + '<span class="ctext">' + o.t + '</span><span class="tag">— ' + (o.tag || '') + '</span>';
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          sfx.click();
          box.classList.add('hidden'); box.innerHTML = '';
          S.lastTag = o.tag;
          runChoice(o, ep).then(function () { res(o); });
        });
        box.appendChild(b);
      });
    });
  }

  /* 微观=细胞层小游戏 / 中观=当前背景图解谜 / 宏观=实验台沙盒 */
  function runChoice(o, ep) {
    if (o.scale === 'micro') return runGame(o.micro);
    if (o.scale === 'meso') return runGame(o.meso || (ep && ep._g));
    if (o.scale === 'macro') {
      if (!window.LAB) return Promise.resolve();
      /* 实验台没做任何操作就合上：本集不计入外泌体 */
      return window.LAB.open(o.focus, o.preset).then(function (v) {
        if (!window.LAB.opDone()) S.epSkipped = true;
        return v;
      });
    }
    return Promise.resolve();
  }

  var currentGameId = null;
  /* 跳过某段游戏时的确认弹窗：返回补完这一段 / 继续 */
  function showMissPanel() {
    return new Promise(function (res) {
      $('#overlay').classList.remove('hidden');
      $$('.panel').forEach(function (p) { p.classList.toggle('show', p.id === 'panelMiss'); });
      var done = false, b = $('#missBack'), g = $('#missGo');
      function fin(v) {
        if (done) return; done = true;
        if (b) b.removeEventListener('click', onBack);
        if (g) g.removeEventListener('click', onGo);
        res(v);
      }
      function onBack() { sfx.click(); fin('retry'); }
      function onGo() { sfx.click(); fin('continue'); }
      if (b) b.addEventListener('click', onBack);
      if (g) g.addEventListener('click', onGo);
    });
  }
  function runGame(id) {
    currentGameId = id;
    /* 记下进关前的外泌体总数：若最终跳过，本关已收的枚数要全部退回 */
    var exoBefore = (window.ESCORE && window.ESCORE.exo) ? window.ESCORE.exo() : 0;
    return new Promise(function (res) {
      $('#overlay').classList.remove('hidden');
      $$('.panel').forEach(function (p) { p.classList.toggle('show', p.id === 'panelGame'); });
      var rec0 = (window.PUZZLES && window.PUZZLES.best) ? window.PUZZLES.best(id) : null;
      var gb = $('#gameBest');
      if (gb) gb.textContent = (rec0 && rec0.cleared) ? ('最佳 ' + (rec0.ms / 1000).toFixed(1) + 's · 已玩 ' + rec0.plays + ' 次') : '初次游玩 · 试试看';
      window.MG.play(id, $('#gameCanvas'), $('#gameTitle'), $('#gameHint')).then(function (r) {
        var ok = r && r.ok && !r.skipped;
        /* 只有真正通关才结算本关枚数：「跳过这段」或失败都不计入（与集数进度无关） */
        /* 收集过程中已逐枚实时入账并飞升，此处不再重复加（r.count 仅用于结算文案） */
        if (ok) {
          S.epSkipped = false;   /* 通关＝补完，解除本集跳过标记 */
          var su = $('#gameSuccess'), s1 = '太棒了', s2 = '光点已收入瓶中';
          if (su) { su.querySelector('b').textContent = s1; su.querySelector('span').textContent = s2; su.classList.add('on'); }
          setTimeout(function () {
            if (su) su.classList.remove('on');
            $('#overlay').classList.add('hidden');
            $$('.panel').forEach(function (p) { p.classList.remove('show'); });
            res(r);
          }, 1400);
          return;
        }
        if (r && r.skipped) {
          /* 跳过：先确认是否返回补完这一段 */
          showMissPanel().then(function (c) {
            if (c === 'retry') { runGame(id).then(res); return; }
            $('#overlay').classList.add('hidden');
            $$('.panel').forEach(function (p) { p.classList.remove('show'); });
            S.epSkipped = true;
            S.exo = exoBefore; save(); renderScore();   /* 退回本关已收的枚数 */
            toast('已跳过这段 · 本关外泌体不计入');
            res(r);
          });
          return;
        }
        $('#overlay').classList.add('hidden');
        $$('.panel').forEach(function (p) { p.classList.remove('show'); });
        if (r && r.ok === false) { S.epSkipped = true; toast('差一点，不过故事继续 · 本段外泌体不计入'); }
        else {
          var bt = (r && r.best != null) ? (' · 最佳 ' + (r.best / 1000).toFixed(1) + 's') : '';
          toast('做到了' + bt);
        }
        res(r);
      });
    });
  }

  /* ---------------- 种子收集 ---------------- */
  function flySeeds(color) {
    var layer = $('#fxlayer');
    /* 种子光点飞向右上角「记忆之瓶」（剧情推进条），不再飞向左上角外泌体计数，避免误以为入账 */
    var tgt = $('#jar');
    var tr = tgt.getBoundingClientRect();
    for (var i = 0; i < 7; i++) {
      var d = document.createElement('i');
      d.className = 'seedfly';
      var x = window.innerWidth * (.35 + Math.random() * .3), y = window.innerHeight * (.45 + Math.random() * .2);
      d.style.left = x + 'px'; d.style.top = y + 'px';
      d.style.color = color;
      d.style.setProperty('--dx', (tr.left + tr.width * .6 - x) + 'px');
      d.style.setProperty('--dy', (tr.top + tr.height * .45 - y) + 'px');
      d.style.animationDelay = (i * .07) + 's';
      layer.appendChild(d);
      (function (el) { setTimeout(function () { el.remove(); }, 1600 + i * 70); })(d);
    }
  }

  /* 小游戏 / 实验台收集到的外泌体：一枚一个光点，飞向左上角「外泌体」计数 */
  function flyExo(n, color) {
    var layer = $('#fxlayer'), tgt = $('#scoreHud');
    if (!layer || !tgt) return;
    var tr = tgt.getBoundingClientRect();
    var cnt = Math.max(1, Math.min(10, n || 1));
    for (var i = 0; i < cnt; i++) {
      var d = document.createElement('i');
      d.className = 'seedfly';
      var x = window.innerWidth * (.35 + Math.random() * .3), y = window.innerHeight * (.45 + Math.random() * .2);
      d.style.left = x + 'px'; d.style.top = y + 'px';
      d.style.color = color || '#e8b45c';
      d.style.setProperty('--dx', (tr.left + tr.width * .6 - x) + 'px');
      d.style.setProperty('--dy', (tr.top + tr.height * .45 - y) + 'px');
      d.style.animationDelay = (i * .07) + 's';
      layer.appendChild(d);
      (function (el) { setTimeout(function () { el.remove(); }, 1600 + i * 70); })(d);
    }
  }

  async function collectSeed(st) {
    sfx.seed();
    flySeeds(st.color || '#e8b45c');
    var isNew = !S.seeds.some(function (s) { return s.name === st.name; });
    if (isNew) S.seeds.push({ name: st.name, color: st.color, fact: st.fact });
    /* 种子只入瓶作剧情推进；左上角「外泌体」只按真实游戏收集结算，此处不再 +1 */
    S.runGot = S.runGot || {};
    if (!S.runGot[st.name]) S.runGot[st.name] = 1;
    updateJar(true);
    save();
    await render('', '窗外的光聚成一点，落进窗台的玻璃瓶里。', true);
    await waitClick();
    $('#seedOrb').style.background = 'radial-gradient(circle at 34% 30%,#fff,' + (st.color || '#e8b45c') + ' 55%,rgba(0,0,0,.1) 80%)';
    $('#seedOrb').style.boxShadow = '0 0 50px 12px ' + hexA(st.color || '#e8b45c', .35);
    $('#seedName').textContent = '第 ' + S.seeds.length + ' 枚种子 · ' + st.name;
    $('#seedFact').textContent = st.fact;
    await openPanel('panelSeed');
  }

  function hexA(hex, a) {
    var h = (hex || '#e8b45c').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function updateJar(pulse) {
    /* 瓶中计数＝剧情推进条：随集数推进（这一集讲了就 +1），与左上角外泌体（按实际游玩结算）分开 */
    var epN = (typeof S.epNum === 'number') ? Math.min(S.epNum, 16) : 0;
    var runN = S.runGot ? Object.keys(S.runGot).length : 0;
    $('#jarCount').textContent = Math.max(S.seeds.length, runN, epN);
    if (pulse) {
      var j = $('#jar'); j.classList.add('pulse');
      setTimeout(function () { j.classList.remove('pulse'); }, 900);
    }
  }

  /* ---------------- 剧集流程 ---------------- */
  function epNumText(n) { return (n === '序' || n === '终' || n === '尾声') ? n : ('第 ' + n + ' 集'); }

  async function showTitleCard(ep) {
    var tc = $('#titlecard');
    tc.querySelector('.tc-num').textContent = epNumText(ep.n);
    tc.querySelector('.tc-name').textContent = ep.title;
    tc.querySelector('.tc-sub').textContent = ep.sub || '';
    tc.classList.remove('hidden');
    $('#hudTitle').textContent = epNumText(ep.n) + ' · ' + ep.title;
    await sleep(2300);
    tc.classList.add('hidden');
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* 集与集之间的转场：半透明薄纱 + 标题（不再重复播放视频，可点击跳过） */
  async function playTransition(title) {
    var ov = $('#transOverlay'), tt = $('#transTitle');
    if (tt) {
      if (title) { tt.textContent = '接下来 · ' + title; tt.classList.remove('on'); void tt.offsetWidth; tt.classList.add('on'); }
      else { tt.textContent = ''; tt.classList.remove('on'); }
    }
    ov.classList.remove('hidden'); ov.classList.add('show');
    await new Promise(function (res) {
      var done = false;
      function fin() {
        if (done) return; done = true;
        clearTimeout(tm); ov.removeEventListener('click', onClick);
        res();
      }
      var tm = setTimeout(fin, 2600);
      function onClick() { fin(); }
      ov.addEventListener('click', onClick);
    });
    ov.classList.remove('show'); ov.classList.add('hidden');
  }

  /* 不可点击跳过的转场（用于终章→尾声，保证衔接不被打断） */
  async function playTransitionHold(title, ms) {
    var ov = $('#transOverlay'), tt = $('#transTitle');
    if (tt) {
      tt.textContent = title || '';
      tt.classList.remove('on'); void tt.offsetWidth; tt.classList.add('on');
    }
    ov.classList.remove('hidden'); ov.classList.add('show');
    ov.style.pointerEvents = 'none';
    await sleep(ms || 2400);
    ov.style.pointerEvents = '';
    ov.classList.remove('show'); ov.classList.add('hidden');
  }

  async function runEpisode(idx) {
    var my = ++S.runId;
    S.ep = idx; S.i = 0;
    S.epSkipped = false;   /* 本集的小游戏是否被跳过（跳过则不给本集枚数） */
    var ep = ACTS[idx];
    if (!ep) return;
    /* 进入第 N 集，瓶子计数至少到 N（序为 0），与集数保持一致 */
    S.epNum = (typeof ep.n === 'number') ? ep.n : 0;
    updateJar();
    /* 关键分界插入转场：16→终（半透明薄纱 + 标题，不放视频）。序→第一集、8→9 不再打断 */
    if (idx === 17) {
      await playTransition(null);
      if (my !== S.runId) return;
    }
    applyScene(ep.sc);
    await showTitleCard(ep);
    if (my !== S.runId) return;
    while (S.i < ep.steps.length) {
      var st = ep.steps[S.i];
      await runStep(st);
      if (my !== S.runId) return;
      S.i++;
    }
    /* 本集结束 */
    if (idx + 1 > S.unlocked) { S.unlocked = idx + 1; save(); }
    /* 尾声为最后一集，彩蛋已作为本集步骤播放，无后续转场 */
    if (idx === ACTS.length - 1) {
      return;
    }
    if (idx + 1 < ACTS.length && ACTS[idx + 1].n !== '尾声') {
      toast('这一段讲完了 · 稍等，他还在想');
      await sleep(1800);
      if (my !== S.runId) return;
      await runEpisode(idx + 1);
    }
  }

  function pickEnding(lab) {
    var seeds = S.seeds.length;
    var base = '你收下了 ' + seeds + ' 枚种子。<br>';
    if (!lab) {
      return { title: '窗外的人', html: base +
        '它们不在瓶子里，在每一个愿意听的人那儿。<br><br>' +
        '外泌体不生产新的东西。它只是把一处的消息，送到另一处。<br>只要还有人愿意听，这封信就一直在路上。' };
    }
    if (lab.best >= 80 || lab.rate >= 0.5) {
      return { title: '归巢', html: base +
        '实验台里，你把外泌体一次次送回了家——<br>亲和越高，信越容易找到收信的人。<br>' +
        '于是这一生拆出的十六枚种子，也一一落进了该落的地方。<br><br>' +
        '外泌体不生产新的东西。它只是把一处的消息，送到另一处。<br>你试过的每一条航线，老人都记得。' };
    }
    if (lab.best < 40 || lab.rate < 0.25) {
      return { title: '散落的风', html: base +
        '实验台里，多数外泌体没能归巢——<br>亲和太低，信在路上就被稀释、被清除。<br>' +
        '但总还有几枚，借着风找到了愿意听的人。<br><br>' +
        '外泌体不生产新的东西。它只是把一处的消息，送到另一处。<br>没寄到的那一封，也还在路上。' };
    }
    return { title: '窗外的人', html: base +
      '实验台里你试过几种航线：有的归了巢，有的散在风里。<br>' +
      '就像这十六枚种子，有的被记住，有的还在路上。<br><br>' +
      '外泌体不生产新的东西。它只是把一处的消息，送到另一处。' };
  }

  async function showEnding() {
    var my = S.runId;
    scene.spawnSeeds(S.seeds.map(function (s) { return hexA(s.color, .55); }));
    scene.setParams({ tod: 'dawn', weather: 'clear', motes: 9 });
    await sleep(1200);
    try { window.ESCORE.record(); } catch (e) { }
    var lab = (window.LAB && window.LAB.summary) ? window.LAB.summary() : null;
    var end = pickEnding(lab);
    $('#endTitle').textContent = end.title;
    $('#endText').innerHTML = end.html;
    stopSession();
    try { window.ESCORE.record(); } catch (e) { }
    S.endingChoice = null;
    await openPanel('panelEnd');
    if (S.runId !== my) return;
    if (S.endingChoice === 'epilogue') {
      S.endingChoice = null;
      await sleep(400);
      await playTransitionHold(null, 2600);
      if (S.runId === my) await runEpisode(ACTS.length - 1);
    }
  }

  /* ---------------- HUD / 面板交互 ---------------- */
  function syncAudioUI() {
    var bm = $('#btnMusic'), bs = $('#btnSound');
    if (bm) { bm.classList.toggle('off', !S.music); var mf = bm.querySelector('.lb-full'), ms = bm.querySelector('.lb-short'); if (mf) mf.textContent = S.music ? '背景乐' : '无背景乐'; if (ms) ms.textContent = S.music ? '乐' : '无乐'; }
    if (bs) { bs.classList.toggle('off', !S.sound); }
    var mv = $('#musicVol');
    if (mv) {
      var v = Math.round((S.musicVol == null ? .68 : S.musicVol) * 100);
      mv.value = v;
      var mvv = $('#musicVolVal'); if (mvv) mvv.textContent = v + '%';
    }
  }

  /* 左上角计分板定位：按顶栏「实际」下边缘动态避让，不写死数值。
     必须抽成独立函数并在多种时机重算，否则会出现下面这个经典 bug：
     手机首次排版时用的是回退字体，顶栏不换行、高度小 → 按小高度算出 top；
     字体替换后顶栏变成 3 行、高度变大，但 resize/orientationchange 都不触发，
     于是计分板被顶栏压住（左上角框和上框重叠）。
     ——因此除 resize 外，还要监听顶栏自身尺寸变化（ResizeObserver）、
     字体就绪（document.fonts.ready）、bfcache 恢复（pageshow）以及多次延时校正。 */
  function placeScoreHud() {
    var hud = $('#hud'), sh = $('#scoreHud');
    if (!hud || !sh) return;
    if (window.innerWidth <= 1024) {
      sh.style.top = (hud.offsetTop + hud.offsetHeight + 10) + 'px';
    } else {
      sh.style.top = '';
    }
  }

  /* HUD 自适应：优先保证「按钮不裸出色块」+「集名不被截断」。
     同一屏宽下只收紧、不放松（锁定），避免换集时界面忽大忽小。
     注：overflow 为 visible 时 scrollWidth 判定不可靠，改用子元素实际位置测量。 */
  var hudLatchW = null, hudLatch = '';
  function fitHud() {
    var hud = $('#hud'); if (!hud) return;
    var t = $('#hudTitle');
    var w = window.innerWidth;
    if (w !== hudLatchW) { hudLatchW = w; hudLatch = ''; }

    hud.classList.remove('hud-tight', 'hud-mini');
    if (hudLatch) hud.classList.add(hudLatch);

    var overflow = function () {
      var r = hud.getBoundingClientRect();
      var l = Infinity, rt = -Infinity;
      Array.prototype.forEach.call(hud.children, function (k) {
        var kr = k.getBoundingClientRect();
        if (!kr.width && !kr.height) return;
        if (kr.left < l) l = kr.left;
        if (kr.right > rt) rt = kr.right;
      });
      return (l < r.left - 1) || (rt > r.right + 1);
    };
    /* +2 容差：排除 letter-spacing 在末字后的占位造成的误判 */
    var truncated = function () {
      return !!(t && t.scrollWidth > t.clientWidth + 2);
    };
    var need = function () { return overflow() || truncated(); };

    if (need()) hud.classList.add('hud-tight');
    if (need()) hud.classList.add('hud-mini');
    hudLatch = hud.classList.contains('hud-mini') ? 'hud-mini'
             : (hud.classList.contains('hud-tight') ? 'hud-tight' : '');

    /* 左上角计分板：按色块实际高度动态下移，彻底避免重叠（不再写死数值） */
    placeScoreHud();
  }
  window.addEventListener('resize', fitHud);
  window.addEventListener('orientationchange', fitHud);
  window.addEventListener('load', fitHud);
  window.addEventListener('pageshow', fitHud);
  (function () {
    var ht = $('#hudTitle');
    if (ht && window.MutationObserver) {
      new MutationObserver(fitHud).observe(ht, { childList: true, characterData: true, subtree: true });
    }
  })();
  /* 顶栏自身尺寸一变（换行 / 字体替换 / 集名变长）就重新避让；
     placeScoreHud 只改计分板的 top，不影响顶栏尺寸，不会形成循环。 */
  (function () {
    var hud = $('#hud');
    if (hud && window.ResizeObserver) {
      try { new ResizeObserver(placeScoreHud).observe(hud); } catch (e) { }
    }
  })();
  /* iOS 上工具栏收放会改变可视高度，但有时不派发 resize */
  if (window.visualViewport && window.visualViewport.addEventListener) {
    window.visualViewport.addEventListener('resize', placeScoreHud);
  }
  /* 字体替换（系统字体回退 → 最终字体）不触发任何事件，只能靠 fonts.ready + 延时兜底 */
  try {
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(placeScoreHud).catch(function () { });
    }
  } catch (e) { }
  fitHud();
  [0, 120, 300, 800, 1600, 3000].forEach(function (t) { setTimeout(placeScoreHud, t); });

  function syncParamUI() {
    $$('#panelParams .row').forEach(function (row) {
      var g = row.getAttribute('data-group');
      if (!g || g === 'motes') return;
      var v = scene.state[g];
      Array.prototype.forEach.call(row.querySelectorAll('button'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-v') === v);
      });
    });
    $('#moteRange').value = scene.state.motes;
    $('#moteVal').textContent = scene.state.motes;
  }

  $$('#panelParams .opts button').forEach(function (b) {
    b.addEventListener('click', function () {
      var row = b.closest('.row'), g = row.getAttribute('data-group');
      var p = {}; p[g] = b.getAttribute('data-v');
      scene.setParams(p); syncParamUI(); sfx.click(); save();
    });
  });
  $('#moteRange').addEventListener('input', function () {
    scene.setParams({ motes: parseInt(this.value, 10) });
    $('#moteVal').textContent = this.value;
  });
  $('#moteRange').addEventListener('change', save);

  $('#btnParams').addEventListener('click', function () { sfx.click(); syncParamUI(); openPanel('panelParams'); });

  $('#btnLab').addEventListener('click', function () {
    sfx.click();
    if (window.LAB) window.LAB.open();
  });

  $('#btnChapters').addEventListener('click', function () {
    sfx.click();
    var box = $('#chapterList'); box.innerHTML = '';
    ACTS.forEach(function (ep, idx) {
      var d = document.createElement('div');
      var locked = idx > S.unlocked;
      d.className = 'ch-item' + (locked ? ' locked' : '');
      d.innerHTML = '<div class="n">' + epNumText(ep.n) + '</div>' +
        '<div class="t">' + ep.title + '</div><div class="s">' + (locked ? '尚未想起' : '可重看') + '</div>';
      if (!locked) d.addEventListener('click', function () { closePanel(); boot(idx); });
      box.appendChild(d);
    });
    openPanel('panelChapters');
  });

  $('#btnCodex').addEventListener('click', function () {
    sfx.click();
    var box = $('#codexList'); box.innerHTML = '';
    var got = S.seeds.map(function (s) { return s.name; });
    ALL_FACTS.forEach(function (f, i) {
      var d = document.createElement('div');
      var has = got.indexOf(f.name) >= 0;
      d.className = 'cx-item' + (has ? '' : ' lock');
      d.innerHTML = '<div class="n">' + (has ? ('第 ' + (i + 1) + ' 枚 · ' + f.name) : '未拾起') + '</div>' +
        '<div class="f">' + (has ? f.fact : '—— 讲完那一段，它就会出现在这里。') + '</div>';
      box.appendChild(d);
    });
    openPanel('panelCodex');
  });

  $('#btnSound').addEventListener('click', function () {
    S.sound = !S.sound;
    this.classList.toggle('off', !S.sound);
    if (global.Audio2) global.Audio2.setSfx(S.sound);
    save();
  });
  /* 「乐」：点开音量条（0% 即关）；「音」：音效开关（点击/成功等反馈音） */
  $('#btnMusic').addEventListener('click', function (e) {
    e.stopPropagation();
    var pop = $('#musicPop');
    if (!pop) return;
    pop.classList.toggle('hidden');
    if (!pop.classList.contains('hidden')) {
      syncAudioUI();
      if (global.Audio2) { global.Audio2.init(); global.Audio2.resume(); }
    }
  });
  $('#musicVol').addEventListener('input', function () {
    var v = +this.value || 0;
    var mvv = $('#musicVolVal'); if (mvv) mvv.textContent = v + '%';
    S.musicVol = v / 100;
    S.music = v > 0;
    var bm = $('#btnMusic');
    if (bm) { bm.classList.toggle('off', !S.music); var mf = bm.querySelector('.lb-full'), ms = bm.querySelector('.lb-short'); if (mf) mf.textContent = S.music ? '背景乐' : '无背景乐'; if (ms) ms.textContent = S.music ? '乐' : '无乐'; }
    if (global.Audio2) {
      global.Audio2.setMusicVol(S.musicVol);
      global.Audio2.setMusic(S.music);
      if (S.music) global.Audio2.startBGM();
    }
    save();
  });
  /* 点空白处收起音量条 */
  document.addEventListener('click', function (e) {
    var pop = $('#musicPop');
    if (!pop || pop.classList.contains('hidden')) return;
    if (e.target && e.target.closest && (e.target.closest('#musicPop') || e.target.closest('#btnMusic'))) return;
    pop.classList.add('hidden');
  });
  $('#btnAuto').addEventListener('click', function () {
    S.auto = !S.auto;
    this.classList.toggle('off', !S.auto);
    toast(S.auto ? '自动播放：开' : '自动播放：关');
    /* 开启时立即接管当前这一句：按句长等比停顿后自动继续对话 */
    if (S.auto && S.pending) {
      var p = S.pending; S.pending = null;
      var ms = Math.min(3200, 900 + (_curText.length * 34));
      setTimeout(function () { p(); }, ms);
    }
  });
  /* 点「跳过这段」即刻标记本集不计入外泌体；只有返回补完并通关才会解除 */
  $('#gameSkip').addEventListener('click', function () { S.epSkipped = true; window.MG.abort(); });
  $('#gameReplay').addEventListener('click', function () {
    if (currentGameId) { sfx.click(); runGame(currentGameId); }
  });
  $('#btnWipe').addEventListener('click', function () {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
    S.seeds = []; S.unlocked = 0; updateJar();
    closePanel(); toast('进度已清空。');
  });

  /* ---------------- 全局点击推进 ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.chip') || t.closest('button') || t.closest('#overlay') || t.closest('.ch-item')) return;
    if (!$('#overlay').classList.contains('hidden')) return;
    if (finishTyping()) {
      $('#text').textContent = currentText();
      if (S.auto && S.pending) { var p = S.pending; S.pending = null; p(); }
      return;
    }
    if (S.pending) { var p = S.pending; S.pending = null; sfx.click(); p(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    if ($('#overlay').classList.contains('hidden') === false) return;
    e.preventDefault();
    if (finishTyping()) {
      $('#text').textContent = currentText();
      if (S.auto && S.pending) { var p = S.pending; S.pending = null; p(); }
      return;
    }
    if (S.pending) { var p = S.pending; S.pending = null; p(); }
  });

  function currentText() { return _curText; }

  /* ---------------- 封面 · 前情提要 ---------------- */
  /* 前情提要：同一扇窗随时间与天气变化 + 逐句旁白（复用窗景系统做动画） */
  var RECAP = [
    { video: 'assets/video/v2.mp4', t: '故事开始之前——' },
    { sc: { img: 'assets/bg/ep15.png', tod: 'dusk', weather: 'clear', season: 'autumn', motes: 3 },
      t: '山屋的窗很大。老人在这儿住了四十三年。' },
    { sc: { tod: 'night', weather: 'stars', motes: 8 },
      t: '他叫周怀明，八十三岁。最近，他开始记不住昨天。' },
    { sc: { tod: 'dawn', weather: 'fog', motes: 4 },
      t: '守在他身边的年轻人叫温澈，学生物医学，明年毕业。' },
    { sc: { tod: 'day', weather: 'motes', motes: 7 },
      t: '细胞之间会送信——那东西叫外泌体，像种子，装着寄信细胞当时的处境。' },
    { sc: { tod: 'dusk', weather: 'fireflies', motes: 9 },
      t: '于是老人决定：把这一生拆成十六枚种子，重新种一遍。' }
  ];
  var recapAbort = false, recapWake = null;

  function endRecap() {
    recapAbort = true;
    if (recapWake) { var w = recapWake; recapWake = null; w(); }
    $('#recap').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    document.body.classList.remove('story');
    stopSession();
    applyScene(ACTS[0].sc);
    $('#titleScreen').classList.remove('hidden');
  }

  /* 等待 ms 毫秒，或点击 / 空格 / 回车提前推进 */
  function waitAdvance(rcEl, ms) {
    return new Promise(function (res) {
      var done = false;
      function fin() {
        if (done) return; done = true;
        clearTimeout(tm);
        rcEl.removeEventListener('click', onClick);
        window.removeEventListener('keydown', onKey);
        recapWake = null;
        res();
      }
      var tm = setTimeout(fin, ms);
      function onClick(e) { e.stopPropagation(); fin(); }
      function onKey(e) { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); fin(); } }
      recapWake = fin;
      rcEl.addEventListener('click', onClick);
      window.addEventListener('keydown', onKey);
    });
  }

  /* 等视频放完 / 超时 / 点击·空格 提前 */
  function waitVideoOrAdvance(rcEl, vid, ms) {
    return new Promise(function (res) {
      var done = false;
      function fin() {
        if (done) return; done = true;
        clearTimeout(tm); vid.removeEventListener('ended', fin);
        rcEl.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey);
        recapWake = null; res();
      }
      var tm = setTimeout(fin, ms);
      vid.addEventListener('ended', fin);
      function onClick(e) { e.stopPropagation(); fin(); }
      function onKey(e) { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); fin(); } }
      recapWake = fin;
      rcEl.addEventListener('click', onClick);
      window.addEventListener('keydown', onKey);
    });
  }

  async function runRecap() {
    var rc = $('#recap'), el = $('#rcText'), dots = $('#rcDots');
    var vid = $('#recapVideo');
    $('#hud').classList.add('hidden');
    rc.classList.remove('hidden');
    recapAbort = false;

    dots.innerHTML = '';
    RECAP.forEach(function () { dots.appendChild(document.createElement('i')); });

    for (var i = 0; i < RECAP.length; i++) {
      if (recapAbort) return;
      var sh = RECAP[i];
      /* 视频镜头：全屏播放，旁白压在画面上 */
      if (sh.video) {
        vid.src = sh.video; vid.classList.add('ready');
        try { vid.currentTime = 0; var p = vid.play(); if (p && p.catch) p.catch(function () {}); } catch (e) { }
        el.textContent = sh.t;
        el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
        Array.prototype.forEach.call(dots.children, function (d, j) { d.classList.toggle('on', j === i); });
        await waitVideoOrAdvance(rc, vid, 6000);
        try { vid.pause(); } catch (e) { }
        vid.classList.remove('ready');
        if (recapAbort) return;
        continue;
      }
      /* 带 img 的镜头走 applyScene（切底图并交叉淡化），其余只改时刻/天气，保留当前底图 */
      if (sh.sc.img) applyScene(sh.sc);
      else {
        scene.setParams(sh.sc);
        try {
          if (global.Audio2) global.Audio2.setMood(sh.sc.tod || scene.state.tod, sh.sc.weather || scene.state.weather);
        } catch (e) { }
      }
      el.textContent = sh.t;
      el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
      Array.prototype.forEach.call(dots.children, function (d, j) { d.classList.toggle('on', j === i); });
      await waitAdvance(rc, 3600);
      if (recapAbort) return;
    }
    if (recapAbort) return;
    endRecap();
  }

  /* ---------------- 启动 ---------------- */
  /* 回到游戏封面（开始界面）：关闭弹层、停止计时、恢复封面视频 */
  function showCover() {
    try { closePanel(); } catch (e) { }
    try { stopSession(); } catch (e) { }
    document.body.classList.remove('story');
    $('#hud').classList.add('hidden');
    $('#titleScreen').classList.add('hidden');
    $('#cover').classList.remove('hidden');
    var cvv = $('#coverVideo');
    if (cvv) { try { cvv.currentTime = 0; var p = cvv.play(); if (p && p.catch) p.catch(function () {}); } catch (e) { } }
  }

  function boot(idx) {
    S.pending = null; S.i = 0; S.busy = false;
    /* 本轮已入账的种子（同一轮内重看不重复计数，换一轮重新计数） */
    S.runGot = {};
    document.body.classList.add('story');
    startSession();
    $('#hud').classList.remove('hidden');
    $('#titleScreen').classList.add('hidden');
    runEpisode(idx);
  }

  function init() {
    /* 开场顺序：封面 → 前情提要 → 标题屏，所以标题屏与 HUD 先藏起来 */
    $('#hud').classList.add('hidden');
    $('#titleScreen').classList.add('hidden');
    /* 任意弹层（窗景/实验台/手册/目录/彩蛋合集）打开时隐藏左上计分板，避免彩蛋浮现在这些面板里 */
    try {
      var _ov = $('#overlay'), _mo = new MutationObserver(function () {
        document.body.classList.toggle('overlay-open', !_ov.classList.contains('hidden'));
      });
      _mo.observe(_ov, { attributes: true, attributeFilter: ['class'] });
      document.body.classList.toggle('overlay-open', !_ov.classList.contains('hidden'));
    } catch (e) { }
    var d = load();
    if (d) {
      S.unlocked = d.unlocked || 0;
      if (d.params) scene.setParams(d.params);
      if (typeof d.sound === 'boolean') S.sound = d.sound;
      if (typeof d.music === 'boolean') S.music = d.music;
      if (typeof d.musicVol === 'number') S.musicVol = Math.max(0, Math.min(1, d.musicVol));
      if (d.seeds && d.seeds.length) {
        S.seeds = d.seeds.map(function (n) {
          var f = ALL_FACTS.filter(function (x) { return x.name === n; })[0] || {};
          return { name: n, color: '#e8b45c', fact: f.fact || '' };
        });
      }
      S.gameMs = d.gameMs || 0;
      S.clicks = d.clicks || 0;
      S.egg = !!d.egg;
      S.xrGot = Array.isArray(d.xrGot) ? d.xrGot : [];
      S.exo = d.exo || 0;   /* 外泌体只按真实游戏收集恢复，不再拿种子数兜底 */
      $('#btnContinue').classList.remove('hidden');
    } else {
      $('#btnContinue').classList.add('hidden');
    }
    updateJar();
    try { renderScore(); } catch (e) { }
    try {
      applyScene(ACTS[0].sc);
      syncParamUI();
      syncAudioUI();
    } catch (e) { console.error('init 场景初始化出错（已忽略，游戏仍可开始）：', e); }

    /* 封面背景视频：静音自动播放；失败则保留 Ken Burns 图片 */
    var cvv = $('#coverVideo');
    if (cvv) {
      cvv.addEventListener('canplay', function () { cvv.classList.add('ready'); }, { once: true });
      cvv.addEventListener('error', function () { cvv.classList.remove('ready'); });
      try { var cvp = cvv.play(); if (cvp && cvp.catch) cvp.catch(function () {}); } catch (e) { }
    }

    function beginAudio() {
      if (!global.Audio2) return;
      global.Audio2.init();
      global.Audio2.resume();
      global.Audio2.setSfx(S.sound);
      global.Audio2.setMusicVol(S.musicVol);
      global.Audio2.setMood(scene.state.tod, scene.state.weather);
      if (S.music) global.Audio2.startBGM();
    }

    /* 封面：点击 → 播放前情提要；也可跳过前情直接进标题屏 */
    $('#cover').addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.target && e.target.closest && e.target.closest('#coverSkip')) return;
      sfx.click(); beginAudio();
      $('#cover').classList.add('hidden');
      document.body.classList.remove('story');
      if (cvv) cvv.pause();
      runRecap();
    });
    $('#coverSkip').addEventListener('click', function (e) {
      e.stopPropagation();       sfx.click(); beginAudio();
      $('#cover').classList.add('hidden');
      document.body.classList.remove('story');
      if (cvv) cvv.pause();
      stopSession();
      $('#hud').classList.remove('hidden');
      $('#titleScreen').classList.remove('hidden');
    });
    $('#rcSkip').addEventListener('click', function (e) {
      e.stopPropagation(); sfx.click(); endRecap();
    });

    $('#btnStart').addEventListener('click', function () {
      sfx.click(); beginAudio();
      /* 新一轮回忆：种子 / 外泌体 / XR 记录 / 计时全部归零，重新拾起 */
      S.seeds = []; S.exo = 0; S.xrGot = []; S.gameMs = 0; S.runGot = {};
      updateJar(); renderScore(); save();
      boot(0);
    });
    $('#btnContinue').addEventListener('click', function () {
      sfx.click(); beginAudio();
      boot(Math.min(S.unlocked, ACTS.length - 1));
    });
    $('#endAgain').addEventListener('click', function () { closePanel(); boot(0); });
    $('#endEpilogue').addEventListener('click', function () { S.endingChoice = 'epilogue'; closePanel(); });
    $('#endFree').addEventListener('click', function () {
      closePanel();
      toast('窗外交给你了 · 点「窗景」随时调');
      openPanel('panelParams');
    });
    $('#eggContinue').addEventListener('click', function () { sfx.click(); closePanel(); });
    $('#letterClose').addEventListener('click', function () { sfx.click(); closePanel(); });
    $('#letterToCover').addEventListener('click', function () {
      sfx.click();
      /* 中断当前剧情流，避免回到窗前继续走下一步 */
      S.runId++;
      S.pending = null;
      showCover();
    });
  }

  /* 对外接口：供内容生成接入层注入「AI 专属一集」并直接播放 */
  window.EXO_STORY = {
    acts: function () { return ACTS; },
    addEpisode: function (ep) { ACTS.push(ep); return ACTS.length - 1; },
    playEpisode: function (ep) { var i = ACTS.push(ep) - 1; boot(i); return i; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
