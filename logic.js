/* ひとことヒント ― ルールエンジン（ブラウザ / Node 共通）
 * 協力ゲーム。山札（7/10/13枚）のお題を、回答者以外が「ひとことヒント」で伝える。
 * 同じヒント（表記ゆれを正規化して比較）と、お題そのものを含むヒントは消える。
 * 正解＝そのカードを獲得。パス＝そのカードを失う。まちがい＝そのカードと山札の次の1枚を失う（山札がなければ獲得済みから1枚失う）。
 */
(function (root) {
  'use strict';
  var RAW = root.HH_WORDS || (typeof require === 'function' ? require('./words.js') : []);
  var MAX_HINT = 12, MAX_ANS = 20;

  // 表記ゆれをそろえる：全角/半角・カタカナ/ひらがな・空白・長音・記号
  function norm(s) {
    var t = String(s == null ? '' : s);
    try { t = t.normalize('NFKC'); } catch (e) {}
    t = t.toLowerCase().replace(/[\u30a1-\u30f6]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
    return t.replace(/[\s\u3000ー〜～\-_‐−・･.,、。!！?？'"「」『』()（）［］\[\]…~]/g, '');
  }
  function parseWord(line, i) {
    var a = line.split('|'), w = a[0].trim();
    var acc = [w].concat((a[1] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean));
    return { id: i, w: w, acc: acc, keys: uniq(acc.map(norm).filter(Boolean)), hints: (a[2] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean) };
  }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  var WORDS = RAW.map(parseWord);

  function rngFrom(seed) { var a = (seed >>> 0) || 1; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ヒントの入力チェック（ひとこと＝空白なし・12文字まで）
  function cleanHint(text) {
    var t = String(text == null ? '' : text).replace(/[\u0000-\u001f<>]/g, '').trim();
    try { t = t.normalize('NFKC').trim(); } catch (e) {}
    if (!t) return { err: 'ヒントを入力してください' };
    if (/\s/.test(t)) return { err: 'ヒントは「ひとこと」だけ（空白なし）にしてね' };
    if (Array.from(t).length > MAX_HINT) return { err: 'ヒントは' + MAX_HINT + '文字までです' };
    if (!norm(t)) return { err: '記号だけのヒントは使えません' };
    return { text: t };
  }
  function cleanAnswer(text) { var t = String(text == null ? '' : text).replace(/[\u0000-\u001f<>]/g, '').trim(); return Array.from(t).slice(0, MAX_ANS).join(''); }
  // お題を含むヒント（例：お題「ゆきだるま」に「ゆきだるまつくり」）はルール違反
  function containsWord(word, hint) { var h = norm(hint); return !!h && word.keys.some(function (k) { return h.indexOf(k) >= 0; }); }
  // hints: { p: text } → { p: 'dup' | 'bad' | null }
  function checkHints(word, hints) {
    var out = {}, count = {};
    Object.keys(hints).forEach(function (p) { var k = norm(hints[p]); count[k] = (count[k] || 0) + 1; });
    Object.keys(hints).forEach(function (p) {
      var k = norm(hints[p]);
      out[p] = containsWord(word, hints[p]) ? 'bad' : count[k] > 1 ? 'dup' : null;
    });
    return out;
  }
  function isCorrect(word, answer) { var a = norm(answer); return !!a && word.keys.indexOf(a) >= 0; }

  // ゲーム
  function createGame(opts, rng, used) {
    rng = rng || Math.random; used = used || [];
    var total = [7, 10, 13].indexOf(opts.cards) >= 0 ? opts.cards : 13;
    var pool = WORDS.map(function (w) { return w.id; }).filter(function (id) { return used.indexOf(id) < 0; });
    if (pool.length < total) pool = WORDS.map(function (w) { return w.id; });
    var deck = shuffle(pool, rng).slice(0, total);
    if (opts.words) deck = opts.words.concat(deck.filter(function (x) { return opts.words.indexOf(x) < 0; })).slice(0, total);   // テスト用
    return { total: total, deck: deck, score: 0, lost: 0, round: 0, hist: [] };
  }
  // outcome: 'ok' | 'pass' | 'ng'。山札の先頭（いまのカード）を処理する
  function applyOutcome(G, outcome) {
    var cur = G.deck.shift(), extra = null;
    if (outcome === 'ok') G.score++;
    else {
      G.lost++;
      if (outcome === 'ng') {
        if (G.deck.length) { extra = G.deck.shift(); G.lost++; }
        else if (G.score > 0) { G.score--; G.lost++; extra = 'scored'; }
      }
    }
    return { card: cur, extra: extra, over: G.deck.length === 0 };
  }
  var RATINGS = [
    [1, 'パーフェクト！ 心がひとつにつながったクマ！ ふーさん、感動でなみだが止まらないクマ…🐻💧'],
    [0.85, 'すばらしい！ みんなのヒント、ばっちり伝わってたクマ！ 森いちばんのチームクマ！'],
    [0.7, 'とってもいいチーム！ ふーさんも ほっぺが落ちるくらい うれしいクマ〜'],
    [0.5, 'なかなかの名コンビぶり！ つぎは もっと伝わるクマ！'],
    [0.3, 'まだまだ のびしろたっぷり！ かぶらないヒントを ねらってみるクマ'],
    [0.01, 'ドンマイ！ ことばって むずかしいクマね…。もう一回やってみるクマ？'],
    [0, 'ぜんぶ かぶっちゃった…？ ふーさんと いっしょに 練習するクマ！🐻']
  ];
  function rating(score, total) { var r = total ? score / total : 0; for (var i = 0; i < RATINGS.length; i++) if (r >= RATINGS[i][0]) return RATINGS[i][1]; return RATINGS[RATINGS.length - 1][1]; }

  // ふーさん🐻のヒント：前のほうの候補ほど選ばれやすい（＝ほかの人とかぶりやすい）
  function cpuHint(word, rng, avoid) {
    rng = rng || Math.random; avoid = (avoid || []).map(norm);
    var hs = word.hints.filter(function (h) { return !containsWord(word, h); });
    var wts = hs.map(function (h, i) { return (i === 0 ? 4 : i === 1 ? 3 : 1.4) * (avoid.indexOf(norm(h)) >= 0 ? 0.6 : 1); });
    var sum = wts.reduce(function (a, b) { return a + b; }, 0), x = rng() * sum;
    for (var i = 0; i < hs.length; i++) { x -= wts[i]; if (x <= 0) return hs[i]; }
    return hs[hs.length - 1] || 'ひみつ';
  }

  var api = { WORDS: WORDS, MAX_HINT: MAX_HINT, MAX_ANS: MAX_ANS, norm: norm, parseWord: parseWord, rngFrom: rngFrom, shuffle: shuffle, cleanHint: cleanHint, cleanAnswer: cleanAnswer,
    containsWord: containsWord, checkHints: checkHints, isCorrect: isCorrect, createGame: createGame, applyOutcome: applyOutcome, rating: rating, cpuHint: cpuHint, RATINGS: RATINGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HH = api;
})(this);
