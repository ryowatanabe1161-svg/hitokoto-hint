/* ひとことヒント オンライン版
 * 構成：WebRTC（PeerJS）による P2P。ホストのブラウザが唯一の正（authoritative）。
 * 回答者には、答え合わせまでお題を送りません。ヒントは「チェック」までほかの人に送りません。
 * 回答者に送るのは「残ったヒント」だけ（消えたヒントは答え合わせのあとで公開）。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var L = window.HH;
  var Q = new URLSearchParams(location.search);
  var CFG = window.HH_CONFIG || {};
  var ICE = (CFG.iceServers && CFG.iceServers.length) ? CFG.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
  if (Q.get('ice')) ICE = Q.get('ice').split(',').map(function (u) { return { urls: u }; });   // テスト・独自環境用
  var PEER_OPTS = Object.assign({ debug: 1, config: { iceServers: ICE } }, CFG.peer || {});
  var ID_PREFIX = 'hitokoto-hint-jp-v1-', CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var TURBO = Q.has('turbo');
  var T = TURBO ? { cpuHint: [300, 900] } : { cpuHint: [2500, 7000] };
  var MAX_HUMANS = 8, MAX_CPU = 3, HB_MS = 3000, LOST_MS = 10000, AUTO_SKIP_MS = TURBO ? 4000 : 25000;
  var COLORS = ['#ff7b7b', '#4cc9f0', '#f4a300', '#52c48a', '#a78bfa', '#fb8500', '#06b6d4', '#e76f51', '#8d6e63', '#ec4899', '#64748b'];
  var BEAR = '🐻', CPU_BASE = 'ふーさん' + BEAR;
  var LINES = {
    hint: ['ひらめいたクマ！', 'これでどうだクマ〜', 'むずかしいクマ…えいっ！', 'かぶらないといいクマ…', 'ふーさん、これにするクマ'],
    dup: ['かぶっちゃったクマ〜！', 'おなじこと考えてたクマ！ 気が合うクマね', 'あちゃー、消えちゃったクマ…'],
    ok: ['やったクマ〜！ 大正解！', 'さすがクマ！ 伝わったクマ！', 'ふーさん、うれしくて おどっちゃうクマ'],
    ng: ['おしいクマ…！', 'ドンマイクマ！ つぎ いこうクマ', 'ヒントがむずかしかったクマね…'],
    pass: ['パスも作戦クマ！', 'つぎは当てるクマ！']
  };
  var CPU_OPTS = [{ v: 0, l: 'なし' }, { v: 1, l: '1人' }, { v: 2, l: '2人' }, { v: 3, l: '3人' }];
  var CARD_OPTS = [{ v: 7, l: '7枚', s: 'みじかめ' }, { v: 10, l: '10枚', s: '' }, { v: 13, l: '13枚', s: '標準' }];
  var TIME_OPTS = [{ v: 0, l: 'なし', s: '標準' }, { v: 60, l: '60秒', s: '' }, { v: 90, l: '90秒', s: '' }];
  var LS_ID = 'hh-client-id', LS_NAME = 'hh-name', LS_HOST = 'hh-host-room', SS_CLIENT = 'hh-joined';

  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {} }
  function load(k, json) { try { var v = localStorage.getItem(k); return json ? JSON.parse(v) : v; } catch (e) { return null; } }
  function sstore(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function sload(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } }
  function rid(n) { var s = ''; for (var i = 0; i < n; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]; return s; }
  var myId = load(LS_ID) || (function () { var v = rid(16); store(LS_ID, v); return v; })();
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function rand(a) { return a[0] + Math.random() * (a[1] - a[0]); }
  function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8); }
  function genCode() { var c = ''; for (var i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').slice(0, 4); }
  function inviteUrl(code) { var u = location.origin + location.pathname + '?room=' + code; if (Q.get('ice')) u += '&ice=' + encodeURIComponent(Q.get('ice')); return u; }
  function colorOf(i) { return COLORS[i % COLORS.length]; }

  // ---------- 汎用UI ----------
  function show(id) { ['title', 'lobby', 'game', 'end'].forEach(function (s) { $(s).classList.toggle('active', s === id); }); }
  function overlay(id, on) { $(id).classList.toggle('active', on); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3000); }
  function banner(msg) { var b = $('banner'); b.textContent = msg || ''; b.classList.toggle('show', !!msg); }
  function confirmBox(title, text, yes, cb) {
    $('cfTitle').textContent = title; $('cfText').textContent = text; $('cfYes').textContent = yes; $('cfNo').style.display = '';
    overlay('confirmModal', true);
    $('cfYes').onclick = function () { overlay('confirmModal', false); cb(); };
    $('cfNo').onclick = function () { overlay('confirmModal', false); };
  }
  function alertBox(msg) { confirmBox('お知らせ', msg, 'OK', function () {}); $('cfNo').style.display = 'none'; }
  function connecting(on, title, text, onCancel) {
    overlay('connecting', on);
    if (on) { $('connTitle').textContent = title || '接続中…'; $('connText').textContent = text || ''; $('connCancel').onclick = onCancel || function () { location.href = location.pathname; }; }
  }
  $('rulesBtn1').onclick = $('rulesBtn2').onclick = function () { overlay('rulesModal', true); };
  $('rulesClose').onclick = function () { overlay('rulesModal', false); };
  ['rulesModal', 'menuModal'].forEach(function (id) { $(id).addEventListener('click', function (e) { if (e.target === this) overlay(id, false); }); });

  // =====================================================================
  //  ホスト（authoritative）
  // =====================================================================
  var host = null;
  function hostId(code) { return ID_PREFIX + code; }
  function newRoom(name) {
    return { code: genCode(), phase: 'lobby', opts: { cpu: 1, cards: 13, time: 0 }, nextSid: 2, gameNo: 0, seats: [{ sid: 1, name: name, kind: 'host', clientId: myId, connected: true }],
      cpus: [], pids: null, G: null, used: [], notice: null, lobbyReq: null };
  }
  function startHost(name, resumeRoom) {
    document.body.classList.add('is-host');
    host = { room: resumeRoom || newRoom(name), conns: {}, lastSeen: {}, tries: 0, opened: false };
    if (resumeRoom) host.room.seats.forEach(function (s) { if (s.kind === 'remote') s.connected = false; });
    connecting(true, resumeRoom ? '部屋を再開しています…' : '部屋を作っています…', 'シグナリングサーバーに接続中', function () { location.href = location.pathname; });
    openHostPeer();
    setInterval(hostHeartbeat, 2000);
    setInterval(hostTick, TURBO ? 50 : 200);
  }
  function openHostPeer() {
    var R = host.room, peer = new Peer(hostId(R.code), PEER_OPTS);
    host.peer = peer;
    peer.on('open', function () { host.opened = true; host.tries = 0; connecting(false); banner(''); hostRender(); saveHost(); });
    peer.on('connection', function (conn) {
      conn.on('data', function (msg) { hostOnMessage(conn, msg); });
      conn.on('close', function () { hostConnClosed(conn); });
      conn.on('error', function () { hostConnClosed(conn); });
    });
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'unavailable-id') {
        try { peer.destroy(); } catch (x) {}
        if (!host.opened && R.phase === 'lobby' && !host.resuming) { R.code = genCode(); openHostPeer(); return; }
        if (++host.tries > 25) { connecting(false); toast('部屋を再開できませんでした'); return; }
        connecting(true, '部屋を再開しています…', '少し時間がかかることがあります（' + host.tries + '）');
        setTimeout(openHostPeer, 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) {
        if (!host.opened) { connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…'); setTimeout(function () { try { peer.destroy(); } catch (x) {} openHostPeer(); }, 4000); }
        else banner('シグナリングサーバーとの接続が不安定です（ゲームは続行できます）');
      } else if (e.type === 'browser-incompatible') connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
    });
  }
  function seatByClient(cid) { return host.room.seats.filter(function (s) { return s.clientId === cid; })[0]; }
  function seatBySid(sid) { var R = host.room; return R.seats.concat(R.cpus).filter(function (s) { return s.sid === sid; })[0]; }
  function seatOfP(i) { return seatBySid(host.room.pids[i]); }
  function hostOnMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    var R = host.room;
    if (msg.t === 'join') return hostJoin(conn, msg);
    var seat = conn.clientId && seatByClient(conn.clientId);
    if (!seat || host.conns[conn.clientId] !== conn) return;
    host.lastSeen[conn.clientId] = Date.now();
    if (msg.t === 'ping') return;
    if (msg.t === 'lobbyReq') return hostLobbyReq(seat);
    if (msg.t === 'leave') {
      if (R.phase === 'lobby') R.seats.splice(R.seats.indexOf(seat), 1); else { seat.connected = false; seat.left = true; seat.lostAt = Date.now(); }
      delete host.conns[conn.clientId]; try { conn.close(); } catch (e) {}
      if (R.phase !== 'lobby') toastAll(seat.name + 'が退出しました');
      hostBroadcast(); return;
    }
    var p = R.pids ? R.pids.indexOf(seat.sid) : -1;
    if (p < 0 || R.phase !== 'game' || msg.g !== R.gameNo || msg.r !== R.G.round) return;
    var err = hostAction(p, msg);
    if (err) { try { conn.send({ t: 'error', msg: err }); conn.send(viewFor(seat.sid)); } catch (e) {} }
  }
  function hostJoin(conn, msg) {
    var R = host.room, name = cleanName(msg.name), cid = String(msg.clientId || '').slice(0, 40);
    function reject(text) { conn.send({ t: 'reject', msg: text }); setTimeout(function () { try { conn.close(); } catch (e) {} }, 500); }
    if (!name || !cid) return reject('ニックネームを入力してください');
    if (cid === myId) return reject('ホストと同じ端末・ブラウザからは参加できません');
    var seat = seatByClient(cid);
    if (!seat) { seat = R.seats.filter(function (s) { return s.name === name && s.kind === 'remote' && !s.connected; })[0]; if (seat) seat.clientId = cid; }
    if (seat) {
      if (seat.kind !== 'remote') return reject('この名前は使えません');
      var old = host.conns[cid]; if (old && old !== conn) { try { old.close(); } catch (e) {} }
      seat.connected = true; seat.left = false;
    } else {
      if (R.phase !== 'lobby') return reject('この部屋はゲーム中です。前に参加していた人は、同じニックネームで入ると元の席に戻れます。');
      if (R.seats.length >= MAX_HUMANS) return reject('満員です（最大' + MAX_HUMANS + '人）');
      if (R.seats.some(function (s) { return s.name === name; }) || /^ふーさん/.test(name)) return reject('その名前は使えません。別のニックネームにしてください。');
      seat = { sid: R.nextSid++, name: name, kind: 'remote', clientId: cid, connected: true };
      R.seats.push(seat);
    }
    conn.clientId = cid; host.conns[cid] = conn; host.lastSeen[cid] = Date.now();
    conn.send({ t: 'welcome', code: R.code, sid: seat.sid });
    hostBroadcast();
  }
  function hostConnClosed(conn) {
    if (!conn.clientId || host.conns[conn.clientId] !== conn) return;
    delete host.conns[conn.clientId];
    var seat = seatByClient(conn.clientId);
    if (seat && seat.connected) { seat.connected = false; seat.lostAt = Date.now(); hostBroadcast(); }
  }
  function hostHeartbeat() {
    if (!host) return;
    var now = Date.now();
    Object.keys(host.conns).forEach(function (cid) {
      var c = host.conns[cid];
      try { c.send({ t: 'hb' }); } catch (e) {}
      if (now - (host.lastSeen[cid] || 0) > LOST_MS) { try { c.close(); } catch (e) {} hostConnClosed(c); }
    });
  }
  function toastAll(msg) { var R = host.room; R.notice = { id: (R.notice ? R.notice.id : 0) + 1, msg: msg, toast: true }; }
  function say(p, kind) { var G = host.room.G; G.lines.push({ id: ++G.lineId, p: p, text: pick(LINES[kind]) }); if (G.lines.length > 3) G.lines.shift(); }
  function isCpu(p) { var s = seatOfP(p); return s && s.kind === 'cpu'; }
  function isActive(p) { var s = seatOfP(p); return s && (s.kind !== 'remote' || s.connected); }
  function humanPs() { var R = host.room; return R.pids.map(function (_, i) { return i; }).filter(function (i) { return !isCpu(i); }); }
  function givers() { var G = host.room.G; return host.room.pids.map(function (_, i) { return i; }).filter(function (i) { return i !== G.guesser; }); }
  function hostP() { return host.room.pids.indexOf(1); }
  // チェック（かぶり判定）を決められる人：ホスト（回答者でないとき）。ホストが回答者なら、ヒントを書いた人間みんな
  function isJudge(p) { var G = host.room.G; if (p < 0 || p === G.guesser || isCpu(p)) return false; return hostP() !== G.guesser ? p === hostP() : true; }
  function canStart(R) { var h = R.seats.length; return h >= 2 && h - 1 + R.opts.cpu >= 2; }

  // ---- 進行 ----
  function hostStartGame() {
    var R = host.room;
    if (!canStart(R)) return toast('人間2人以上、ヒントを出す人（回答者以外）が2人以上必要です');
    R.gameNo++; R.lobbyReq = null;
    R.cpus = []; for (var k = 0; k < R.opts.cpu; k++) R.cpus.push({ sid: -(k + 1), name: R.opts.cpu > 1 ? CPU_BASE + (k + 1) : CPU_BASE, kind: 'cpu', connected: true });
    R.pids = R.seats.map(function (s) { return s.sid; }).concat(R.cpus.map(function (s) { return s.sid; }));
    var words = Q.get('words') ? Q.get('words').split(',').map(function (w) { var f = L.WORDS.filter(function (x) { return x.w === w; })[0]; return f ? f.id : -1; }).filter(function (x) { return x >= 0; }) : null;
    var G = R.G = L.createGame({ cards: R.opts.cards, words: words }, Math.random, R.used);
    G.deck.forEach(function (id) { R.used.push(id); }); if (R.used.length > L.WORDS.length - 13) R.used = [];
    G.lines = []; G.lineId = 0; G.gIdx = -1;
    R.phase = 'game'; startRound();
    hostBroadcast();
  }
  function startRound() {
    var R = host.room, G = R.G, hs = humanPs();
    for (var k = 0; k < hs.length; k++) { G.gIdx = (G.gIdx + 1) % hs.length; if (isActive(hs[G.gIdx])) break; }   // 回答者は人間だけ・順番に（切断中の人はとばす）
    G.round++; G.guesser = hs[G.gIdx]; G.word = G.deck[0];
    G.sub = 'hint'; G.hints = {}; G.marks = {}; G.answer = null; G.outcome = null; G.fixed = false; G.lines = [];
    G.subAt = Date.now(); G.until = R.opts.time ? Date.now() + R.opts.time * 1000 : 0;
    G.cpuPlan = {};
    givers().forEach(function (p) { if (isCpu(p)) G.cpuPlan[p] = Date.now() + rand(T.cpuHint); });
  }
  function word() { return L.WORDS[host.room.G.word]; }
  function hostAction(p, m) {
    var G = host.room.G;
    switch (m.t) {
      case 'hint': return hostHint(p, m.text);
      case 'flag': return hostFlag(p, String(m.target));
      case 'toGuess': return hostToGuess(p);
      case 'guess': return hostGuess(p, m.text, !!m.pass);
      case 'fix': return hostFix(p);
      case 'next': return hostNext(p);
      case 'skip': return hostSkip(p);
    }
    return null;
  }
  function hostHint(p, text) {
    var R = host.room, G = R.G;
    if (G.sub !== 'hint') return 'いまはヒントを出せません';
    if (p === G.guesser) return 'あなたは回答者です';
    var c = L.cleanHint(text); if (c.err) return c.err;
    G.hints[p] = { text: c.text };
    if (isCpu(p) && Math.random() < 0.5) say(p, 'hint');
    if (allHintsIn()) toReview();
    hostBroadcast(); return null;
  }
  function allHintsIn() { var G = host.room.G; return givers().every(function (p) { return G.hints[p] || !isActive(p); }); }
  function toReview() {
    var G = host.room.G, texts = {};
    Object.keys(G.hints).forEach(function (p) { texts[p] = G.hints[p].text; });
    var auto = L.checkHints(word(), texts);
    G.marks = {}; Object.keys(G.hints).forEach(function (p) { G.marks[p] = { auto: auto[p], removed: !!auto[p], flags: [] }; });
    var dupCpu = Object.keys(auto).filter(function (p) { return auto[p] === 'dup' && isCpu(+p); });
    if (dupCpu.length) say(+dupCpu[0], 'dup');
    G.sub = 'review'; G.subAt = Date.now(); G.until = 0;
  }
  function hostFlag(p, target) {
    var G = host.room.G, mk = G.marks[target];
    if (G.sub !== 'review' || !mk) return null;
    if (p === G.guesser || isCpu(p)) return 'あなたはヒントを見られません';
    if (isJudge(p)) { mk.removed = !mk.removed; if (!mk.removed) mk.flags = []; }
    else { var i = mk.flags.indexOf(p); if (i >= 0) mk.flags.splice(i, 1); else mk.flags.push(p); }   // 提案（決めるのはホスト）
    hostBroadcast(); return null;
  }
  function hostToGuess(p) {
    var G = host.room.G;
    if (G.sub !== 'review') return null;
    if (!isJudge(p)) return 'チェックを決めるのはホストです';
    G.sub = 'guess'; G.subAt = Date.now(); hostBroadcast(); return null;
  }
  function hostGuess(p, text, pass) {
    var G = host.room.G;
    if (G.sub !== 'guess') return null;
    if (p !== G.guesser) return 'あなたは回答者ではありません';
    var t = L.cleanAnswer(text);
    if (!pass && !t) return '答えを入力してください（わからなければパス）';
    G.answer = { text: pass ? '' : t, pass: pass };
    G.outcome = pass ? 'pass' : L.isCorrect(word(), t) ? 'ok' : 'ng';
    G.sub = 'result'; G.subAt = Date.now();
    var cpus = givers().filter(isCpu); if (cpus.length) say(pick(cpus), G.outcome);
    hostBroadcast(); return null;
  }
  function hostFix(p) {   // 表記ちがいを「正解にする」（ヒントを書いた人・ホスト）
    var G = host.room.G;
    if (G.sub !== 'result' || G.outcome !== 'ng') return null;
    if (p === G.guesser && p !== hostP()) return '回答者は「正解にする」を押せません';
    if (isCpu(p)) return null;
    G.outcome = 'ok'; G.fixed = true; G.lines = [];
    var cpus = givers().filter(isCpu); if (cpus.length) say(cpus[0], 'ok');
    hostBroadcast(); return null;
  }
  function hostNext(p) {
    var R = host.room, G = R.G;
    if (G.sub !== 'result') return null;
    if (p !== hostP() && p !== G.guesser) return '「つぎへ」はホストか回答者が押してね';
    var r = L.applyOutcome(G, G.outcome);
    G.hist.push({ w: G.word, outcome: G.outcome, fixed: G.fixed, guesser: G.guesser, answer: G.answer, extra: r.extra, hints: Object.keys(G.hints).map(function (q) { return { p: +q, text: G.hints[q].text, removed: G.marks[q] ? G.marks[q].removed : false }; }) });
    if (r.over) { R.phase = 'end'; G.sub = null; }
    else startRound();
    hostBroadcast(); return null;
  }
  function hostSkip(p) {   // ホストの救済：ヒントを待たずに進む／切断した回答者をパス扱い
    var G = host.room.G;
    if (p !== hostP()) return null;
    if (G.sub === 'hint' && Object.keys(G.hints).length) { toReview(); hostBroadcast(); }
    else if (G.sub === 'guess' && !isActive(G.guesser)) hostGuess(G.guesser, '', true);
    return null;
  }
  function hostTick() {
    if (!host || !host.opened) return;
    var R = host.room, G = R.G, now = Date.now();
    if (R.phase !== 'game' || !G) return;
    if (G.sub === 'hint') {
      Object.keys(G.cpuPlan).forEach(function (p) {
        if (G.cpuPlan[p] && now >= G.cpuPlan[p]) { G.cpuPlan[p] = 0; var others = Object.keys(G.hints).map(function (q) { return G.hints[q].text; }); hostHint(+p, Q.get('cpuhint') || L.cpuHint(word(), Math.random, isCpu(+p) && Math.random() < 0.5 ? others : [])); }
      });
      if (G.sub === 'hint' && G.until && now >= G.until) { toReview(); toastAll('⏰ 時間切れ！ 出そろったヒントでチェックします'); hostBroadcast(); }
      else if (G.sub === 'hint' && allHintsIn() && Object.keys(G.hints).length) { toReview(); hostBroadcast(); }
    } else if (G.sub === 'review') {
      var judges = R.pids.map(function (_, i) { return i; }).filter(function (i) { return isJudge(i) && isActive(i); });
      if (!judges.length && now - G.subAt > AUTO_SKIP_MS) { G.sub = 'guess'; G.subAt = now; hostBroadcast(); }
    }
  }

  // ---- 各プレイヤー向けの「見せてよい情報だけ」のビュー ----
  function viewFor(sid) {
    var R = host.room, G = R.G, now = Date.now(), you = -1;
    R.seats.forEach(function (s, i) { if (s.sid === sid) you = i; });
    var v = {
      t: 'state', phase: R.phase, code: R.code, you: you, sid: sid, gameNo: R.gameNo, opts: { cpu: R.opts.cpu, cards: R.opts.cards, time: R.opts.time },
      seats: R.seats.concat(R.phase === 'lobby' ? [] : R.cpus).map(function (s) { return { sid: s.sid, name: s.name, kind: s.kind, connected: s.kind !== 'remote' || s.connected }; }),
      notice: R.notice
    };
    if (sid === 1 && R.lobbyReq && R.phase !== 'lobby') v.lobbyReq = R.lobbyReq;
    if (R.phase === 'lobby' || !G) return v;
    v.pids = R.pids.slice();
    var me = R.pids.indexOf(sid), guesser = me === G.guesser;
    var g = v.g = { total: G.total, score: G.score, lost: G.lost, left: G.deck.length, round: G.round, lines: G.lines.slice(), hist: G.hist.map(function (h) { return { outcome: h.outcome, extra: h.extra }; }) };
    if (R.phase === 'end') {
      g.hist = G.hist.map(function (h) { return { w: L.WORDS[h.w].w, outcome: h.outcome, fixed: h.fixed, guesser: h.guesser, answer: h.answer, extra: h.extra, extraW: typeof h.extra === 'number' ? L.WORDS[h.extra].w : null, hints: h.hints }; });
      g.rating = L.rating(G.score, G.total);
      return v;
    }
    g.sub = G.sub; g.guesser = G.guesser; g.judge = isJudge(me); g.hostP = hostP();
    g.submitted = Object.keys(G.hints).map(Number);
    g.active = R.pids.map(function (_, i) { return isActive(i); });
    if (G.until) { g.left = Math.max(0, G.until - now); g.ms = R.opts.time * 1000; }
    if (!guesser || G.sub === 'result') g.word = word().w;   // 回答者には答え合わせまで送らない
    function hintsOut(onlyKept) {
      return Object.keys(G.hints).map(Number).filter(function (p) { return !onlyKept || !(G.marks[p] && G.marks[p].removed); }).map(function (p) {
        var o = { p: p, text: G.hints[p].text }, mk = G.marks[p];
        if (mk && !onlyKept) { o.auto = mk.auto; o.removed = mk.removed; o.flags = mk.flags.slice(); }
        return o;
      });
    }
    if (G.sub === 'hint') { if (G.hints[me]) g.myHint = G.hints[me].text; }
    else if (G.sub === 'review') { if (!guesser) g.hints = hintsOut(false); else g.count = Object.keys(G.hints).length; }
    else if (G.sub === 'guess') g.hints = hintsOut(guesser);
    else if (G.sub === 'result') { g.hints = hintsOut(false); g.answer = G.answer; g.outcome = G.outcome; g.fixed = G.fixed; g.nextIsLast = G.deck.length === 1; }
    return v;
  }
  function hostToLobby(msg) {
    var R = host.room;
    R.phase = 'lobby'; R.G = null; R.pids = null; R.cpus = []; R.lobbyReq = null;
    R.seats = R.seats.filter(function (s) { if (s.kind === 'remote') { s.left = false; return !!s.connected; } return true; });
    R.notice = { id: (R.notice ? R.notice.id : 0) + 1, msg: msg };
    hostBroadcast();
  }
  function hostLobbyReq(seat) {
    var R = host.room;
    if (seat.kind !== 'remote' || R.phase === 'lobby') return;
    if (R.lobbyReq && R.lobbyReq.sid === seat.sid && Date.now() - R.lobbyReq.at < 5000) return;
    R.lobbyReq = { sid: seat.sid, name: seat.name, at: Date.now() };
    hostBroadcast();
  }
  function hostBroadcast() {
    var R = host.room;
    R.seats.forEach(function (s) { if (s.kind !== 'remote') return; var c = host.conns[s.clientId]; if (c && c.open) { try { c.send(viewFor(s.sid)); } catch (e) {} } });
    hostRender(); saveHost();
  }
  function hostRender() { render(viewFor(1)); }
  function saveHost() { store(LS_HOST, { room: host.room, saved: Date.now() }); }

  // ---- ホストのロビー操作 ----
  $('seatList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sid]'); if (!b || !host) return;
    var R = host.room, seat = seatBySid(+b.dataset.sid);
    if (!seat || seat.kind !== 'remote' || R.phase !== 'lobby') return;
    var doRemove = function () {
      var c = host.conns[seat.clientId]; if (c) { try { c.send({ t: 'kicked' }); } catch (x) {} setTimeout(function () { try { c.close(); } catch (x) {} }, 300); delete host.conns[seat.clientId]; }
      R.seats.splice(R.seats.indexOf(seat), 1); hostBroadcast();
    };
    if (seat.connected) confirmBox(seat.name + 'を外しますか？', '部屋から退出させます。', '外す', doRemove); else doRemove();
  });
  function optSeg(id, key, list) {
    $(id).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !host || host.room.phase !== 'lobby') return;
      var v = +b.dataset.v; if (list.some(function (o) { return o.v === v; })) { host.room.opts[key] = v; hostBroadcast(); }
    });
  }
  optSeg('cpuSeg', 'cpu', CPU_OPTS); optSeg('cardSeg', 'cards', CARD_OPTS); optSeg('timeSeg', 'time', TIME_OPTS);
  $('startBtn').onclick = function () { if (host) hostStartGame(); };
  $('againBtn').onclick = function () { if (host && host.room.phase === 'end') hostStartGame(); };
  $('toLobbyBtn').onclick = function () { if (host && host.room.phase === 'end') hostToLobby('ロビーに戻りました'); };
  function copyUrl() {
    var u = $('inviteUrl').textContent;
    function legacy() { try { var ta = document.createElement('textarea'); ta.value = u; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, u.length); var ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; } }
    var p = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(u) : Promise.reject();
    p.then(function () { toast('招待URLをコピーしました'); }, function () { toast(legacy() ? '招待URLをコピーしました' : 'URLを長押ししてコピーしてください'); });
  }
  $('copyBtn').onclick = copyUrl;
  $('shareBtn').onclick = function () {
    var data = { title: 'ひとことヒント', text: 'いっしょに「ひとことヒント」で遊ぼう！ 部屋コード ' + $('codeBig').textContent, url: $('inviteUrl').textContent };
    if (!navigator.share || (navigator.canShare && !navigator.canShare(data))) return copyUrl();
    try { navigator.share(data).catch(function (e) { if (!e || e.name !== 'AbortError') copyUrl(); }); } catch (e) { copyUrl(); }
  };

  // =====================================================================
  //  参加者（クライアント）
  // =====================================================================
  var client = null;
  function startClient(code, name) {
    document.body.classList.remove('is-host');
    client = { code: code, name: name, joined: false, lastMsg: Date.now(), everJoined: false };
    connecting(true, '部屋 ' + code + ' に接続中…', 'しばらくお待ちください', function () { leaveClient(true); });
    var peer = new Peer(PEER_OPTS);
    client.peer = peer;
    peer.on('open', function () { clientConnect(); });
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'peer-unavailable') { if (!client.everJoined) { connecting(false); toast('部屋が見つかりません。コードを確認してください。'); leaveClient(false); } else clientLost(); }
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) { if (!client.everJoined) connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…'); }
      else if (e.type === 'browser-incompatible') connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
    });
    clearInterval(client.hbTimer); client.hbTimer = setInterval(clientHeartbeat, HB_MS);
    setTimeout(function () { if (client && !client.everJoined && $('connecting').classList.contains('active')) $('connText').textContent = 'つながりにくいようです。コードが正しいか、ホストが部屋を開いているか確認してください。（通信環境によっては接続できない場合があります）'; }, 15000);
  }
  function clientConnect() {
    if (!client || !client.peer || client.peer.destroyed) return;
    if (client.conn) { try { client.conn.close(); } catch (e) {} }
    var conn = client.peer.connect(hostId(client.code), { reliable: true });
    client.conn = conn;
    conn.on('open', function () { conn.send({ t: 'join', name: client.name, clientId: myId }); });
    conn.on('data', function (m) { if (client && client.conn === conn) clientOnMessage(m); });
    conn.on('close', function () { if (client && client.conn === conn) clientLost(); });
    conn.on('error', function () { if (client && client.conn === conn) clientLost(); });
  }
  var received = [];   // テスト用：受け取った状態（秘匿チェックに使う）
  function clientOnMessage(m) {
    if (!m || typeof m !== 'object') return;
    client.lastMsg = Date.now();
    if (m.t === 'welcome') { client.joined = true; client.everJoined = true; connecting(false); banner(''); sstore(SS_CLIENT, { code: client.code, name: client.name }); }
    else if (m.t === 'state') { if (TURBO) { received.push(m); if (received.length > 3000) received.shift(); } pending = ''; render(m); }
    else if (m.t === 'reject') { connecting(false); leaveClient(false); alertBox(m.msg); }
    else if (m.t === 'kicked') { sstore(SS_CLIENT, null); leaveClient(false); alertBox('ホストによって部屋から外されました。'); }
    else if (m.t === 'closed') { sstore(SS_CLIENT, null); leaveClient(false); alertBox('ホストが部屋を閉じました。'); }
    else if (m.t === 'error') { pending = ''; toast(m.msg); stageKey = ''; if (lastView) render(lastView); }
  }
  function clientHeartbeat() {
    if (!client) return;
    if (client.conn && client.conn.open) { try { client.conn.send({ t: 'ping' }); } catch (e) {} }
    if (client.everJoined && Date.now() - client.lastMsg > LOST_MS) clientLost();
  }
  function clientLost() {
    if (!client || !client.everJoined) return;
    client.joined = false; banner('ホストとの接続が切れました。再接続しています…');
    clearTimeout(client.retryT);
    client.retryT = setTimeout(function () {
      if (!client) return; client.lastMsg = Date.now();
      if (client.peer.disconnected && !client.peer.destroyed) { try { client.peer.reconnect(); } catch (e) {} }
      clientConnect();
    }, 3000);
  }
  function leaveClient(sendLeave) {
    if (!client) return;
    if (sendLeave && client.conn && client.conn.open) { try { client.conn.send({ t: 'leave' }); } catch (e) {} }
    clearInterval(client.hbTimer); clearTimeout(client.retryT);
    var p = client.peer; client = null;
    setTimeout(function () { try { p.destroy(); } catch (e) {} }, 300);
    banner(''); connecting(false); show('title'); renderTitle();
  }
  function send(m) { if (client && client.conn && client.conn.open) { client.conn.send(m); return true; } toast('接続が切れています'); return false; }

  // ---- 操作（ホストも参加者も同じ入口） ----
  var lastView = null, pending = '';
  function myP(v) { return v && v.pids ? v.pids.indexOf(v.sid) : -1; }
  function act(m) {
    var v = lastView; if (!v || v.phase !== 'game') return;
    m.g = v.gameNo; m.r = v.g.round;
    if (host) { var err = hostAction(myP(v), m); if (err) toast(err); return; }
    var key = m.t + ':' + m.r + ':' + (m.target || '') + ':' + (m.text || '');
    if (pending === key) return;
    if (send(m)) pending = key;
  }
  $('stage').addEventListener('click', function (e) {
    var v = lastView; if (!v || !v.g) return;
    if (e.target.closest('#hintGo')) {
      var c = L.cleanHint($('hintIn').value); if (c.err) { toast(c.err); $('hintIn').focus(); return; }
      if (L.containsWord({ keys: [L.norm(v.g.word)] }, c.text)) toast('⚠️ お題そのものが入っているので、チェックで消えちゃうかも');
      act({ t: 'hint', text: c.text }); return;
    }
    if (e.target.closest('#hintEdit')) { editing = true; stageKey = ''; render(v); return; }
    var hc = e.target.closest('.hc.tap[data-p]'); if (hc) return act({ t: 'flag', target: hc.dataset.p });
    if (e.target.closest('#toGuessBtn')) return act({ t: 'toGuess' });
    if (e.target.closest('#guessGo')) { var a = L.cleanAnswer($('guessIn').value); if (!a) { toast('答えを入力してね（わからなければパス）'); return; } return act({ t: 'guess', text: a }); }
    if (e.target.closest('#passBtn')) return confirmBox('パスしますか？', 'このカードは失いますが、まちがえるよりは被害が少ないクマ。', 'パスする', function () { act({ t: 'guess', pass: true }); });
    if (e.target.closest('#fixBtn')) return confirmBox('正解にしますか？', '書き方のちがいだけで、意味はお題と同じときに使ってね。', '正解にする', function () { act({ t: 'fix' }); });
    if (e.target.closest('#nextBtn')) return act({ t: 'next' });
    if (e.target.closest('#skipBtn')) return act({ t: 'skip' });
  });
  $('stage').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (e.target.id === 'hintIn') { e.preventDefault(); $('hintGo').click(); }
    if (e.target.id === 'guessIn') { e.preventDefault(); $('guessGo').click(); }
  });
  $('stage').addEventListener('input', function (e) { if (e.target.id === 'hintIn') { var c = $('hintCnt'); if (c) c.textContent = Array.from(e.target.value.trim()).length + ' / ' + L.MAX_HINT; } });

  function leaveRoom() {
    if (host) {
      confirmBox('部屋を閉じますか？', '参加者全員の接続が切れ、ゲームは終了します。', '部屋を閉じる', function () {
        Object.keys(host.conns).forEach(function (cid) { try { host.conns[cid].send({ t: 'closed' }); } catch (e) {} });
        store(LS_HOST, null);
        setTimeout(function () { try { host.peer.destroy(); } catch (e) {} location.href = location.pathname; }, 400);
      });
    } else confirmBox('部屋を出ますか？', 'ゲーム中に出た場合も、同じニックネームで入り直せば元の席に戻れます。', '部屋を出る', function () { sstore(SS_CLIENT, null); leaveClient(true); });
  }
  $('leaveBtn1').onclick = $('leaveBtn2').onclick = leaveRoom;
  $('menuBtn').onclick = function () { overlay('menuModal', true); };
  function confirmAbort() {
    confirmBox('中断してロビーに戻りますか？', 'いまのゲームを終了して、全員をこの部屋のロビーに戻します。部屋コード・参加者・設定はそのままです。', '中断してロビーへ', function () {
      if (host && host.room.phase !== 'lobby') hostToLobby('⏸️ ホストがゲームを中断しました');
    });
  }
  $('menuAbort').onclick = function () { overlay('menuModal', false); confirmAbort(); };
  $('menuReq').onclick = function () { overlay('menuModal', false); send({ t: 'lobbyReq' }); toast('ホストに「ロビーに戻りたい」と伝えました'); };
  $('menuLeave').onclick = function () { overlay('menuModal', false); leaveRoom(); };
  $('menuRules').onclick = function () { overlay('menuModal', false); overlay('rulesModal', true); };
  $('menuClose').onclick = function () { overlay('menuModal', false); };
  $('lobbyReqBar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-lr]'); if (!b || !host) return;
    if (b.dataset.lr === 'no') { host.room.lobbyReq = null; hostBroadcast(); } else confirmAbort();
  });
  var seenNotice = null;
  function noticeUi(v) {
    if (seenNotice === null) seenNotice = v.notice ? v.notice.id : 0;
    else if (v.notice && v.notice.id !== seenNotice) { seenNotice = v.notice.id; if (v.notice.toast || !host) toast(v.notice.msg + (!v.notice.toast && v.phase === 'lobby' ? '。ロビーで次のゲームを待っています' : '')); }
    if (v.phase === 'lobby') overlay('menuModal', false);
    var bar = $('lobbyReqBar'), key = host && v.lobbyReq && v.phase !== 'lobby' ? v.lobbyReq.sid + ':' + v.lobbyReq.at : '';
    if (bar.dataset.key !== key) {
      bar.dataset.key = key;
      bar.innerHTML = key ? '<span>🙋 ' + esc(v.lobbyReq.name) + '「ロビーに戻りたい」</span><button data-lr="abort">中断してロビーへ</button><button data-lr="no" class="ghost">とじる</button>' : '';
      bar.classList.toggle('show', !!key);
    }
  }

  // =====================================================================
  //  描画（ホスト・参加者で共通。受け取ったビューだけを使う）
  // =====================================================================
  function seatOfView(v, i) { var sid = v.pids[i]; return v.seats.filter(function (s) { return s.sid === sid; })[0] || { name: '?', kind: 'remote', connected: false }; }
  function nameOf(v, i) { return seatOfView(v, i).name; }
  function av(v, i) { var s = seatOfView(v, i); return '<span class="av" style="background:' + colorOf(i) + '">' + (s.kind === 'cpu' ? BEAR : esc(Array.from(s.name)[0] || '?')) + '</span>'; }
  function render(v) {
    lastView = v; window.__hh.view = v;
    noticeUi(v);
    if (v.phase === 'lobby') { show('lobby'); renderLobby(v); stageKey = ''; return; }
    if (v.phase === 'end') { show('end'); renderEnd(v); return; }
    show('game'); renderGame(v);
  }
  function renderLobby(v) {
    var isHost = !!host, n = v.seats.length;
    $('codeBig').textContent = v.code;
    var url = inviteUrl(v.code);
    $('inviteUrl').textContent = url;
    if ($('qr').dataset.url !== url) { try { var qr = qrcode(0, 'M'); qr.addData(url); qr.make(); $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { $('qr').textContent = ''; } $('qr').dataset.url = url; }
    $('seatCount').textContent = n + ' / ' + MAX_HUMANS + '人' + (v.opts.cpu ? ' ＋ ふーさん' + v.opts.cpu : '');
    var rows = v.seats.map(function (s, i) {
      var tags = (s.kind === 'host' ? '<span class="tagx host">ホスト</span>' : '') + (i === v.you ? '<span class="tagx you">あなた</span>' : '') + (s.kind === 'remote' && !s.connected ? '<span class="tagx off">切断</span>' : '');
      return '<div class="seat' + (s.connected ? '' : ' offline') + '"><span class="av" style="background:' + colorOf(i) + '">' + (i + 1) + '</span><span class="nm">' + esc(s.name) + '</span>' + tags + (isHost && s.kind === 'remote' ? '<button class="xbtn" data-sid="' + s.sid + '" aria-label="外す">×</button>' : '') + '</div>';
    });
    for (var k = 0; k < v.opts.cpu; k++) rows.push('<div class="seat cpuph"><span class="av" style="background:' + colorOf(n + k) + '">' + BEAR + '</span><span class="nm">' + (v.opts.cpu > 1 ? CPU_BASE + (k + 1) : CPU_BASE) + '</span><span class="tagx cpu">ヒント係</span></div>');
    $('seatList').innerHTML = rows.join('');
    var hintGivers = n - 1 + v.opts.cpu;
    $('seatHint').textContent = n < 2 ? 'あと' + (2 - n) + '人必要です（回答者は人間が交代でつとめます）' : hintGivers < 2 ? 'ヒントを出す人が足りません。ふーさん🐻を1人以上入れてね' : n >= MAX_HUMANS ? '満員です' : '3〜8人がおすすめ。ふーさんはヒントだけ出します';
    $('startBtn').disabled = !(n >= 2 && hintGivers >= 2);
    function seg(id, list, cur) {
      $(id).innerHTML = list.map(function (o) { return '<button data-v="' + o.v + '" class="' + (o.v === cur ? 'on' : '') + '"' + (isHost ? '' : ' disabled') + '>' + o.l + (o.s ? '<small>' + o.s + '</small>' : '') + '</button>'; }).join('');
      $(id).classList.toggle('ro', !isHost);
    }
    seg('cpuSeg', CPU_OPTS, v.opts.cpu); seg('cardSeg', CARD_OPTS, v.opts.cards); seg('timeSeg', TIME_OPTS, v.opts.time);
  }
  function renderPlayers(v) {
    var g = v.g;
    $('players').innerHTML = v.pids.map(function (_, i) {
      var s = seatOfView(v, i), mk = '';
      if (i === g.guesser) mk = '🙈';
      else if (g.sub === 'hint') mk = g.submitted.indexOf(i) >= 0 ? '✅' : (g.active[i] ? '✍️' : '💤');
      return '<div class="pc' + (i === g.guesser ? ' cur' : '') + (s.connected ? '' : ' off') + '">' + av(v, i) + '<span>' + esc(s.name) + (i === myP(v) ? '（あなた）' : '') + '</span><span class="mk">' + mk + '</span></div>';
    }).join('');
  }
  function progHtml(g, curIdx) {
    var cells = [], h = g.hist || [];
    h.forEach(function (x) {
      cells.push(x.outcome === 'ok' ? 'ok' : 'lost');
      if (x.outcome === 'ng' && x.extra === 'scored') { var j = cells.lastIndexOf('ok'); if (j >= 0) cells[j] = 'lost'; }
      else if (x.outcome === 'ng' && x.extra != null) cells.push('lost');
    });
    var out = cells.map(function (c) { return '<i class="' + c + '"></i>'; }).join('');
    for (var k = 0; k < g.left; k++) out += '<i class="' + (k === 0 && curIdx ? 'cur' : '') + '"></i>';
    return '<div class="prog">' + out + '</div>';
  }
  function hintCard(v, h, opts) {
    var cls = 'hc' + (h.removed ? ' rm' : '') + (opts.tap ? ' tap' : '') + (h.p === myP(v) ? ' mine' : ''), tag = '';
    if (h.removed) tag = h.auto === 'bad' ? '<span class="tagr bad">ルール違反</span>' : h.auto === 'dup' ? '<span class="tagr">かぶり</span>' : '<span class="tagr bad">かぶり/違反</span>';
    else if (h.flags && h.flags.length) tag = '<span class="tagr flag">🚩' + h.flags.length + '</span>';
    return '<div class="' + cls + '" data-p="' + h.p + '">' + tag + '<div class="ht">' + esc(h.text) + '</div><div class="hb">' + av(v, h.p) + esc(nameOf(v, h.p)) + '</div></div>';
  }
  function linesHtml(v) { return (v.g.lines || []).map(function (l) { return '<div class="line">' + BEAR + ' ' + esc(nameOf(v, l.p)) + '「' + esc(l.text) + '」</div>'; }).join(''); }
  function timerHtml(g) { return g.left != null && g.ms ? '<div class="timer"><i data-dl="' + (Date.now() + g.left) + '" data-ms="' + g.ms + '" style="width:' + (100 * g.left / g.ms) + '%"></i></div>' : ''; }
  var stageKey = '', editing = false, editKey = '';
  function renderGame(v) {
    var g = v.g, me = myP(v), isG = me === g.guesser, gname = nameOf(v, g.guesser), h = '', key;
    renderPlayers(v);
    var cardNo = g.total - g.left + 1;
    $('phLabel').textContent = 'お題 ' + Math.min(cardNo, g.total) + ' / ' + g.total + '（のこり' + g.left + '枚）';
    $('scoreChip').textContent = '⭐ ' + g.score + '枚';
    var wordBox = g.word ? '<div class="word"><div class="wl">お題' + (isG ? '' : '（' + esc(gname) + 'には ひみつ）') + '</div><div class="ww">' + esc(g.word) + '</div></div>'
      : '<div class="word hidden"><div class="wl">お題は ひみつ 🙈</div><div class="ww">？？？</div></div>';
    var rk = g.round + ':' + g.sub;
    if (editKey !== rk) { editKey = rk; editing = false; }
    if (g.sub === 'hint') {
      key = rk + ':' + (isG ? 'g' : (g.myHint && !editing ? 'sent:' + g.myHint : 'write')) + ':' + g.submitted.join(',');
      if (isG) h = wordBox + '<div class="card" style="text-align:center"><div class="big">🙈 あなたが回答者！</div><div class="mid" style="margin-top:6px">みんなが ひとことヒントを書いています。<br>画面はそのままで待っててね</div></div>';
      else if (g.myHint && !editing) h = wordBox + '<div class="card" style="text-align:center"><div class="lab">あなたのヒント</div><div class="hints" style="grid-template-columns:1fr"><div class="hc mine"><div class="ht">' + esc(g.myHint) + '</div></div></div><div class="mid" style="margin-top:8px">✅ 送信しました。みんなを待っています…</div><button class="btn" id="hintEdit" style="margin-top:8px;font-size:14px">✏️ 書きなおす</button></div>';
      else h = wordBox + '<div class="card"><div class="lab">' + esc(gname) + 'に伝わる「ひとことヒント」を1つ（ほかの人には、チェックまで見えません）</div><input class="in" id="hintIn" maxlength="20" placeholder="例：あかい" autocomplete="off" enterkeyhint="send" value="' + esc(editing ? g.myHint || '' : '') + '"><div class="counter" id="hintCnt">0 / ' + L.MAX_HINT + '</div>' +
        '<button class="btn main" id="hintGo" style="margin-top:6px">送信</button><p class="hint">ほかの人と<b>同じヒントだと消えちゃう</b>クマ。お題そのものを含むヒントもダメ。空白なし・ひとことで！</p></div>';
      h += timerHtml(g) + '<div class="chips">' + v.pids.map(function (_, i) { return i === g.guesser ? '' : '<span class="' + (g.submitted.indexOf(i) >= 0 ? 'done' : '') + '">' + (g.submitted.indexOf(i) >= 0 ? '✅ ' : '✍️ ') + esc(nameOf(v, i)) + '</span>'; }).join('') + '</div>';
      if (host && !isG && g.submitted.length) h += '<button class="btn" id="skipBtn" style="font-size:13px">⏭️ 待たずにチェックへ進む（ホスト）</button>';
    } else if (g.sub === 'review') {
      if (isG) { key = rk + ':g'; h = wordBox + '<div class="card" style="text-align:center"><div class="big">🔍 チェック中…</div><div class="mid" style="margin-top:6px">ヒントが' + g.count + 'つ集まりました。<br>かぶっているヒントを みんなが消しています</div></div>'; }
      else {
        key = rk + ':' + JSON.stringify(g.hints);
        var kept = g.hints.filter(function (x) { return !x.removed; }).length;
        h = wordBox + '<div class="card"><div class="lab">🔍 ヒントのチェック（' + esc(gname) + 'にはまだ見えていません）</div><div class="hints">' + g.hints.map(function (x) { return hintCard(v, x, { tap: true }); }).join('') + '</div>' +
          '<p class="hint">' + (g.judge ? '同じ意味・ルール違反のヒントは<b>タップで消す／もどす</b>ことができます。🚩はほかの人からの提案。' : '気になるヒントをタップすると🚩で知らせられます（決めるのは ' + esc(nameOf(v, g.hostP)) + '）。') + '</p></div>' +
          (g.judge ? '<button class="btn main" id="toGuessBtn">これで ' + esc(gname) + ' に見せる（のこり' + kept + 'つ）</button>' : '<div class="mid">チェックが終わるのを待っています…</div>');
      }
    } else if (g.sub === 'guess') {
      key = rk + ':' + (isG ? 'g' : 'o') + ':' + JSON.stringify(g.hints);
      if (isG) h = wordBox + '<div class="card"><div class="lab">みんなのヒント（のこったもの）</div>' + (g.hints.length ? '<div class="hints">' + g.hints.map(function (x) { return hintCard(v, x, {}); }).join('') + '</div>' : '<div class="mid">ぜんぶ かぶって消えちゃった…😱</div>') + '</div>' +
        '<div class="card"><div class="lab">お題はなにかな？（1回だけ）</div><input class="in" id="guessIn" maxlength="20" placeholder="こたえを入力" autocomplete="off" enterkeyhint="done"><div class="row" style="margin-top:8px"><button class="btn" id="passBtn" style="flex:.6">パス</button><button class="btn main" id="guessGo">こたえる！</button></div></div>';
      else h = wordBox + '<div class="card"><div class="lab">' + esc(gname) + 'に見えているヒント（線＝消えたヒント）</div><div class="hints">' + g.hints.map(function (x) { return hintCard(v, x, {}); }).join('') + '</div></div><div class="mid">🤔 ' + esc(gname) + 'が考え中…</div>' +
        (host && !g.active[g.guesser] ? '<button class="btn" id="skipBtn" style="font-size:13px">⏭️ 回答者が切断中：パスにする（ホスト）</button>' : '');
    } else {
      key = rk + ':' + g.outcome + ':' + JSON.stringify(g.hints);
      var vd = g.outcome === 'ok' ? '<div class="verdict ok">⭕ 正解！' + (g.fixed ? '<div class="mid">（「正解にする」で正解）</div>' : '') + '</div>' : g.outcome === 'pass' ? '<div class="verdict pass">🙏 パス</div>' : '<div class="verdict ng">❌ ざんねん…</div>';
      var conseq = g.outcome === 'ok' ? 'カードを1枚ゲット！' : g.outcome === 'pass' ? 'このカードは失いました' : g.nextIsLast ? 'このカードを失い、獲得済みからも1枚失います' : 'このカードと、山札の次の1枚を失います';
      h = '<div class="word"><div class="wl">お題は…</div><div class="ww">' + esc(g.word) + '</div></div>' + vd + '<div class="answerbox">' + esc(gname) + 'の答え：' + (g.answer.pass ? '（パス）' : '<b>' + esc(g.answer.text) + '</b>') + '<div class="mid" style="margin-top:4px">' + conseq + '</div></div>' +
        '<div class="card"><div class="lab">みんなのヒント</div><div class="hints">' + g.hints.map(function (x) { return hintCard(v, x, {}); }).join('') + '</div></div>' +
        (g.outcome === 'ng' && me >= 0 && seatOfView(v, me).kind !== 'cpu' && (!isG || host) ? '<button class="btn" id="fixBtn">🙆 書き方のちがいだけ → 正解にする</button>' : '') +
        (me === g.hostP || isG ? '<button class="btn main" id="nextBtn">' + (g.left <= 1 || (g.outcome === 'ng' && g.left <= 2) ? '🎉 けっかを見る' : '▶ つぎのお題へ') + '</button>' : '<div class="mid">' + esc(nameOf(v, g.hostP)) + 'か' + esc(gname) + 'が つぎへ進めます</div>');
    }
    h = progHtml(g, g.sub !== 'result') + h + '<div class="lines" id="lines"></div>';
    if (key !== stageKey) {
      var keepVal = $('hintIn') && g.sub === 'hint' ? $('hintIn').value : null;
      stageKey = key; $('stage').innerHTML = h;
      var inp = $('hintIn') || $('guessIn');
      if (inp) { if (keepVal != null && $('hintIn')) $('hintIn').value = keepVal; setTimeout(function () { try { inp.focus({ preventScroll: true }); } catch (e) {} }, 50); }
    } else { var tm = $('stage').querySelector('.timer i'), nt = h.match(/data-dl="(\d+)"/); if (tm && nt) tm.dataset.dl = nt[1]; }
    $('lines').innerHTML = linesHtml(v);
  }
  setInterval(function () {
    var t = document.querySelectorAll('.timer i[data-dl]');
    for (var i = 0; i < t.length; i++) t[i].style.width = Math.max(0, Math.min(100, 100 * (+t[i].dataset.dl - Date.now()) / +t[i].dataset.ms)) + '%';
  }, 200);
  var endKey = '';
  function renderEnd(v) {
    var g = v.g;
    $('endScore').innerHTML = g.score + '<small> / ' + g.total + '枚</small>';
    $('endProg').innerHTML = progHtml({ hist: g.hist, left: 0 }).replace(/^<div class="prog">|<\/div>$/g, '');
    $('endRating').textContent = '🐻 ' + g.rating;
    $('histList').innerHTML = g.hist.map(function (x) {
      var mark = x.outcome === 'ok' ? '⭕' : x.outcome === 'pass' ? '🙏' : '❌';
      var kept = x.hints.filter(function (h) { return !h.removed; }).map(function (h) { return h.text; });
      return '<div class="hist"><span>' + mark + '</span><span class="w">' + esc(x.w) + '<br><small>回答：' + esc(nameOf(v, x.guesser)) + (x.answer && !x.answer.pass ? '「' + esc(x.answer.text) + '」' : '（パス）') + (x.fixed ? '・正解にする' : '') + ' ／ ヒント：' + esc(kept.join('・') || 'なし') + '</small>' + (x.extraW ? '<br><small>（山札の「' + esc(x.extraW) + '」も失った）</small>' : x.extra === 'scored' ? '<br><small>（最後のカードなので、獲得済みから1枚失った）</small>' : '') + '</span></div>';
    }).join('');
    var k = v.code + ':' + v.gameNo;
    if (k !== endKey) { endKey = k; window.scrollTo(0, 0); if (g.score / g.total >= 0.5) confetti(); }
    $('leaveBtn2').textContent = host ? '🚪 部屋を閉じる' : '🚪 部屋を出る';
  }
  function confetti() {
    var colors = ['#ffd166', '#ff8fab', '#8ecae6', '#7fd8be', '#b9a7ff'];
    for (var i = 0; i < 36; i++) {
      var c = document.createElement('div'); c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[i % colors.length];
      c.style.animationDuration = (2.2 + Math.random() * 2.5) + 's'; c.style.animationDelay = (Math.random() * 1.2) + 's';
      document.body.appendChild(c); setTimeout(function (el) { el.remove(); }.bind(null, c), 6500);
    }
  }

  // =====================================================================
  //  タイトル
  // =====================================================================
  function renderTitle() {
    if (!$('nameIn').value) $('nameIn').value = load(LS_NAME) || '';
    var inv = normCode(Q.get('room'));
    $('inviteJoinBox').style.display = inv.length === 4 ? '' : 'none';
    $('invCode').textContent = inv;
    if (inv.length === 4) $('codeIn').value = inv;
    var saved = load(LS_HOST, true), ok = saved && saved.room && Date.now() - saved.saved < 12 * 3600 * 1000;
    $('resumeBtn').style.display = ok ? '' : 'none';
    if (ok) $('resumeBtn').textContent = '前回の部屋（' + saved.room.code + '）を再開する';
    var joined = sload(SS_CLIENT);
    $('rejoinBtn').style.display = joined ? '' : 'none';
    if (joined) $('rejoinBtn').textContent = '部屋 ' + joined.code + ' に戻る（' + joined.name + '）';
  }
  function getName() {
    var n = cleanName($('nameIn').value);
    if (!n) { toast('ニックネームを入力してください'); $('nameIn').focus(); return null; }
    store(LS_NAME, n); return n;
  }
  $('createBtn').onclick = function () { var n = getName(); if (n) { store(LS_HOST, null); startHost(n, null); } };
  $('resumeBtn').onclick = function () { var saved = load(LS_HOST, true); if (!saved) return; startHost(saved.room.seats[0].name, saved.room); host.resuming = true; };
  function join(code) {
    var n = getName(); if (!n) return;
    code = normCode(code);
    if (code.length !== 4) { toast('4文字の部屋コードを入力してください'); return; }
    startClient(code, n);
  }
  $('joinBtn').onclick = function () { join($('codeIn').value); };
  $('joinInvitedBtn').onclick = function () { join(Q.get('room')); };
  $('rejoinBtn').onclick = function () { var j = sload(SS_CLIENT); if (j) { $('nameIn').value = j.name; startClient(j.code, j.name); } };
  $('codeIn').addEventListener('input', function () { this.value = normCode(this.value); });
  if (location.protocol === 'file:') setTimeout(function () { toast('ファイルを直接開いています。招待URLは公開URL（https）でのみ使えます。'); }, 500);

  // テスト・デバッグ用
  window.__hh = { view: null, received: received, role: function () { return host ? 'host' : client ? 'client' : 'none'; }, hostRoom: function () { return host ? host.room : null; }, hostBroadcast: function () { if (host) hostBroadcast(); } };
  renderTitle();
})();
