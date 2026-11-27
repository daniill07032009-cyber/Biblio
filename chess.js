(function () {
  "use strict";
  var timer = 0;
  var selected = "";
  var currentCode = "";
  var boardFlipped = false;
  var clockTimer = 0;
  var clockState = null;
  var selectedPly = null;
  var lastRoomSignature = "";
  var roomRequestPending = false;
  var refreshQueued = false;
  var roomRequestVersion = 0;
  var movePending = false;
  var currentLegalMoves = [];
  var boardHasEntered = false;
  var skipNextBoardAnimation = false;
  var PIECES = { K:"♔",Q:"♕",R:"♖",B:"♗",N:"♘",P:"♙",k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟" };
  var $ = function (selector) { return document.querySelector(selector); };
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function stop() { if (timer) window.clearInterval(timer); if (clockTimer) window.clearInterval(clockTimer); timer = 0; clockTimer = 0; clockState = null; }
  function handleVisibilityChange() {
    if (!location.pathname.startsWith("/games/chess/play")) return;
    if (document.hidden) {
      if (timer) window.clearInterval(timer);
      if (clockTimer) window.clearInterval(clockTimer);
      timer = 0;
      clockTimer = 0;
      return;
    }
    if (!currentCode) return;
    if (!timer) timer = window.setInterval(function () { refreshRoom(currentCode, false); }, 1100);
    if (!clockTimer) clockTimer = window.setInterval(updateClocks, 250);
    refreshRoom(currentCode, false);
    updateClocks();
  }
  document.addEventListener("visibilitychange", handleVisibilityChange);
  function panel(title) {
    var layout = $("#game-catalog-layout"), detail = $("#game-detail-panel"), target = $("#game-catalog-detail-panel");
    if (layout) layout.hidden = true;
    if (detail) detail.hidden = true;
    if (target) { target.hidden = false; target.replaceChildren(); }
    document.title = title + " — Шахматы — Biblio";
    return target;
  }
  async function request(path, options) {
    var response = await fetch(path, Object.assign({
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" }
    }, options || {}));
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(data.error || "Не удалось выполнить действие.");
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function toast(message) {
    var target = $("#toast");
    if (target) { target.textContent = message; target.classList.add("is-visible"); window.setTimeout(function () { target.classList.remove("is-visible"); }, 2400); }
    else window.alert(message);
  }
  function navigate(code) {
    selected = "";
    currentCode = code;
    window.location.assign("/games/chess/play?room=" + encodeURIComponent(code));
  }
  async function init() {
    stop();
    if (!location.pathname.startsWith("/games/chess")) return;
    document.body.classList.add("chess-home-mode");
    var code = new URLSearchParams(location.search).get("room");
    if (/\/play\/?$/.test(location.pathname) && code) {
      currentCode = code.toUpperCase();
      await refreshRoom(currentCode, true);
      timer = window.setInterval(function () { refreshRoom(currentCode, false); }, 1100);
      clockTimer = window.setInterval(updateClocks, 250);
    } else {
      currentCode = "";
      selected = "";
      renderLobby();
      await refreshLobby();
      timer = window.setInterval(refreshLobby, 3000);
    }
  }
  function renderLobby() {
    var target = panel("Главная");
    target.innerHTML =
      '<div class="chess-home">' +
        '<aside class="chess-home__sidebar">' +
          '<a class="chess-home__brand" href="/games/chess"><span class="chess-home__brand-mark">♞</span><span>BIBLIO<span>CHESS</span></span></a>' +
          '<a class="chess-home__new-game" href="#chess-create-form">＋ Новая партия</a>' +
          '<nav class="chess-home__nav" aria-label="Навигация шахмат">' +
            '<a class="is-active" href="/games/chess"><span>⌂</span> Главная</a>' +
            '<a href="#chess-create-form"><span>♟</span> Играть</a>' +
            '<a href="#chess-room-section"><span>◎</span> Соперники</a>' +
          '</nav>' +
          '<div class="chess-home__sidebar-caption">BIBLIO</div>' +
          '<a class="chess-home__nav-link" href="/games"><span>←</span> Все игры</a>' +
          '<div class="chess-home__sidebar-bottom"><span class="chess-home__online-dot"></span> Только реальные игроки</div>' +
        '</aside>' +
        '<div class="chess-home__workspace">' +
          '<header class="chess-home__topbar"><div><span class="chess-home__crumb">ИГРОВАЯ ЗОНА <b>/</b> ШАХМАТЫ</span><h1>Главная</h1></div><div class="chess-home__user" id="chess-profile"><span class="chess-home__avatar">♙</span><span><b>Игрок Biblio</b><small>Ваш профиль</small></span></div></header>' +
          '<div class="chess-home__content">' +
            '<section class="chess-home__welcome"><div class="chess-home__welcome-copy"><span class="chess-home__eyebrow">ТВОЯ СЛЕДУЮЩАЯ ПАРТИЯ НАЧИНАЕТСЯ ЗДЕСЬ</span><h2>Каждый ход<br><em>имеет значение.</em></h2><p>Играй в классические шахматы с участниками Biblio. Создай комнату или присоединись к открытому матчу.</p><a class="chess-home__primary-link" href="#chess-create-form">Начать играть <span>→</span></a></div><div class="chess-home__hero-art" aria-hidden="true"><div class="chess-home__hero-board"><span>♜</span><span>♞</span><span>♝</span><span>♛</span><span>♚</span><span>♝</span><span>♞</span><span>♜</span><span>♟</span><span>♟</span><span>♟</span><span>♟</span><span>♟</span><span>♟</span><span>♟</span><span>♟</span></div><div class="chess-home__hero-piece">♘</div></div></section>' +
            '<div class="chess-home__section-heading"><div><span class="chess-home__eyebrow">ВЫБЕРИ ФОРМАТ</span><h2>Играть в шахматы</h2></div><span class="chess-home__live-label"><i></i> Онлайн-комнаты</span></div>' +
            '<div class="chess-home__play-grid">' +
              '<form class="chess-home__card chess-home__create" id="chess-create-form"><div class="chess-home__card-icon">♟</div><span class="chess-home__eyebrow">СОЗДАТЬ МАТЧ</span><h3>Новая партия</h3><p>Создай комнату и пригласи друга по коду или дождись соперника.</p><label class="chess-home__field-label">Название партии<input name="name" maxlength="80" value="Дружеская партия" required></label><label class="chess-home__field-label">Контроль времени<select name="time_control"><option value="3+2">Блиц · 3 + 2</option><option value="5+0">Блиц · 5 минут</option><option value="10+0" selected>Рапид · 10 минут</option><option value="15+10">Рапид · 15 + 10</option></select></label><div class="chess-home__time-presets"><button type="button" data-time-control="3+2">3+2</button><button type="button" data-time-control="5+0">5+0</button><button type="button" class="is-selected" data-time-control="10+0">10+0</button><button type="button" data-time-control="15+10">15+10</button></div><button class="chess-home__action" type="submit">Создать комнату <span>→</span></button></form>' +
              '<form class="chess-home__card chess-home__join" id="chess-join-form"><div class="chess-home__card-icon chess-home__card-icon--light">⌁</div><span class="chess-home__eyebrow">ЕСТЬ КОД ПРИГЛАШЕНИЯ?</span><h3>Присоединиться</h3><p>Введи шестизначный код комнаты, чтобы начать партию с другим участником.</p><label class="chess-home__field-label">Код комнаты<input name="code" maxlength="6" minlength="6" pattern="[A-Za-z0-9]{6}" placeholder="Например, A1B2C3" required autocomplete="off"></label><div class="chess-home__join-note"><span>♙</span> Игра только между двумя аккаунтами Biblio</div><button class="chess-home__action chess-home__action--outline" type="submit">Войти в комнату <span>→</span></button></form>' +
            '</div>' +
            '<section class="chess-home__rooms" id="chess-room-section"><div class="chess-home__section-heading"><div><span class="chess-home__eyebrow">ИГРОВОЕ СООБЩЕСТВО</span><h2>Открытые комнаты</h2></div><span class="chess-home__room-count" id="chess-room-count">Загрузка…</span></div><div id="chess-room-list" class="chess-home__room-list"><p class="chess-home__empty">Загружаем доступные комнаты…</p></div></section>' +
            '<footer class="chess-home__footer"><span>♞ Biblio Chess</span><span>Классические шахматы · Без ботов · Реальные соперники</span></footer>' +
          '</div>' +
        '</div>' +
      '</div>';
    $("#chess-create-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        var formData = new FormData(form);
        var result = await request("/api/chess/rooms", { method: "POST", body: JSON.stringify({ name: formData.get("name"), time_control: formData.get("time_control") }) });
        navigate(result.room.code);
      } catch (error) { toast(error.message); button.disabled = false; }
    });
    $("#chess-join-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      var codeValue = String(new FormData(form).get("code") || "").trim().toUpperCase();
      try {
        await request("/api/chess/rooms/" + encodeURIComponent(codeValue) + "/join", { method: "POST", body: "{}" });
        navigate(codeValue);
      } catch (error) { toast(error.message); button.disabled = false; }
    });
    document.querySelectorAll("[data-time-control]").forEach(function (button) {
      button.addEventListener("click", function () {
        var select = $('#chess-create-form select[name="time_control"]');
        if (select) select.value = button.dataset.timeControl;
        document.querySelectorAll("[data-time-control]").forEach(function (item) { item.classList.toggle("is-selected", item === button); });
      });
    });
    loadChessProfile();
  }
  async function loadChessProfile() {
    var target = $("#chess-profile");
    if (!target) return;
    try {
      var result = await request("/api/me");
      var user = result.user;
      if (!user) return;
      var name = user.display_name || user.username || user.name || "Игрок Biblio";
      var avatar = user.avatar_url ? '<img src="' + escapeHtml(user.avatar_url) + '" alt="">' : '<span class="chess-home__avatar">♙</span>';
      target.innerHTML = avatar + '<span><b>' + escapeHtml(name) + '</b><small>Аккаунт Biblio</small></span>';
    } catch (error) { /* Keep the safe guest label if profile data is unavailable. */ }
  }
  async function refreshLobby() {
    var list = $("#chess-room-list"), count = $("#chess-room-count");
    if (!list || !location.pathname.startsWith("/games/chess")) return;
    try {
      var result = await request("/api/chess/rooms");
      if (count) count.textContent = result.rooms.length + " свободно";
      if (!result.rooms.length) {
        list.innerHTML = '<div class="chess-home__empty-state"><span>♟</span><b>Пока нет открытых партий</b><p>Создай комнату — другой участник сможет присоединиться к тебе.</p><a href="#chess-create-form">Создать первую партию →</a></div>';
        return;
      }
      list.innerHTML = result.rooms.map(function (room) {
        return '<article class="chess-home__room"><div class="chess-home__room-avatar">♙</div><div class="chess-home__room-info"><strong>' + escapeHtml(room.name) + '</strong><span>Создатель: ' + escapeHtml(room.white_name) + '</span></div><div class="chess-home__room-code"><small>КОД КОМНАТЫ</small><b>' + escapeHtml(room.code) + '</b></div><button class="chess-home__room-button" type="button" data-chess-room="' + escapeHtml(room.code) + '">' + (room.is_owner ? "Открыть" : "Присоединиться") + ' <span>→</span></button></article>';
      }).join("");
      list.querySelectorAll("[data-chess-room]").forEach(function (button) {
        button.addEventListener("click", async function () {
          var code = button.dataset.chessRoom;
          button.disabled = true;
          try {
            var room = result.rooms.find(function (item) { return item.code === code; });
            if (!room || !room.is_owner) await request("/api/chess/rooms/" + code + "/join", { method: "POST", body: "{}" });
            navigate(code);
          } catch (error) { toast(error.message); refreshLobby(); }
        });
      });
    } catch (error) {
      if (count) count.textContent = "Недоступно";
      list.innerHTML = '<p class="chess-home__empty">' + escapeHtml(error.message) + '</p>';
    }
  }
  async function refreshRoom(code, initial) {
    var target = $("#game-catalog-detail-panel");
    if (!target || !location.pathname.startsWith("/games/chess")) return;
    if (roomRequestPending || movePending) {
      refreshQueued = true;
      return;
    }
    roomRequestPending = true;
    refreshQueued = false;
    var requestVersion = roomRequestVersion;
    try {
      var result = await request("/api/chess/rooms/" + encodeURIComponent(code));
      // Ignore a room snapshot that was requested before a move began.
      if (requestVersion !== roomRequestVersion || movePending || code !== currentCode && currentCode) return;
      var signature = JSON.stringify(result.room);
      if (signature !== lastRoomSignature) {
        lastRoomSignature = signature;
        renderRoom(result.room);
      }
    } catch (error) {
      if (initial && requestVersion === roomRequestVersion) {
        var failed = panel("Партия недоступна");
        failed.innerHTML = '<section class="chess-panel"><h2>Не удалось открыть партию</h2><p>' + escapeHtml(error.message) + '</p><a class="button button--primary" href="/games/chess">К комнатам</a></section>';
        stop();
      }
    } finally {
      roomRequestPending = false;
      if (refreshQueued && !movePending && !document.hidden) {
        refreshQueued = false;
        refreshRoom(currentCode || code, false);
      }
    }
  }
  function captureBoardPieces() {
    var snapshot = {};
    document.querySelectorAll(".chess-square[data-chess-square]").forEach(function (square) {
      var piece = square.querySelector(".chess-square__piece");
      if (!piece || !piece.textContent.trim()) return;
      var rect = piece.getBoundingClientRect();
      snapshot[square.dataset.chessSquare] = { glyph:piece.textContent.trim(), className:piece.className, rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height} };
    });
    return snapshot;
  }
  function animateBoardChanges(previous, moveUci) {
    if (skipNextBoardAnimation) { skipNextBoardAnimation = false; return; }
    if (prefersReducedMotion() || !previous || !Object.keys(previous).length || !document.body.animate) return;
    var current = {}, usedFrom = {}, usedTo = {};
    document.querySelectorAll(".chess-square[data-chess-square]").forEach(function (square) {
      var piece = square.querySelector(".chess-square__piece");
      if (!piece || !piece.textContent.trim()) return;
      current[square.dataset.chessSquare] = { glyph:piece.textContent.trim(), rect:piece.getBoundingClientRect(), node:piece, className:piece.className };
    });
    function animatePiece(from, to) {
      var oldPiece = previous[from], newPiece = current[to];
      if (!oldPiece || !newPiece || usedFrom[from] || usedTo[to]) return false;
      var a = oldPiece.rect, b = newPiece.rect;
      if (!a.width || !a.height || !b.width || !b.height) return false;
      var ghost = document.createElement("span");
      ghost.className = oldPiece.className + " chess-piece-flight";
      ghost.textContent = oldPiece.glyph;
      Object.assign(ghost.style, {
        position:"fixed", zIndex:"10000", pointerEvents:"none", margin:"0",
        left:a.left+"px", top:a.top+"px", width:a.width+"px", height:a.height+"px",
        display:"grid", placeItems:"center", fontSize:getComputedStyle(newPiece.node).fontSize,
        lineHeight:"1", willChange:"transform,filter", transform:"translate3d(0,0,0)"
      });
      document.body.appendChild(ghost);
      newPiece.node.style.visibility = "hidden";
      var destinationSquare = newPiece.node.closest(".chess-square");
      var wasCapture = !!previous[to];
      if (destinationSquare) {
        destinationSquare.classList.add(wasCapture ? "is-capture" : "is-arrival");
        window.setTimeout(function () { destinationSquare.classList.remove("is-capture","is-arrival"); }, 430);
      }
      usedFrom[from] = true;
      usedTo[to] = true;
      var finished = false;
      function finish() { if (finished) return; finished = true; ghost.remove(); newPiece.node.style.visibility = ""; }
      window.setTimeout(finish, 520);
      var dx = b.left - a.left, dy = b.top - a.top;
      var flight = ghost.animate([
        { transform:"translate3d(0,0,0) scale(.96)", filter:"drop-shadow(0 3px 3px rgba(0,0,0,.25))", offset:0 },
        { transform:"translate3d("+(dx*.52)+"px,"+(dy*.52-Math.min(18,Math.abs(dy)*.035))+"px,0) scale(1.12)", filter:"drop-shadow(0 12px 9px rgba(0,0,0,.28))", offset:.52 },
        { transform:"translate3d("+dx+"px,"+dy+"px,0) scale(1)", filter:"drop-shadow(0 2px 2px rgba(0,0,0,.18))", offset:1 }
      ], { duration:260, easing:"cubic-bezier(.18,.78,.25,1)", fill:"forwards" });
      flight.onfinish = finish;
      flight.oncancel = finish;
      return true;
    }
    var explicitMove = String(moveUci || "");
    if (explicitMove.length >= 4) animatePiece(explicitMove.slice(0,2), explicitMove.slice(2,4));
    Object.keys(previous).forEach(function (from) {
      if (usedFrom[from]) return;
      var oldPiece = previous[from];
      if (current[from] && current[from].glyph === oldPiece.glyph) return;
      var to = Object.keys(current).find(function (square) {
        return square !== from && !usedTo[square] && current[square].glyph === oldPiece.glyph &&
          (!previous[square] || previous[square].glyph !== oldPiece.glyph);
      });
      if (to) animatePiece(from, to);
    });
  }
  function animateMoveImmediately(from,to) {
    var source=document.querySelector('[data-chess-square="'+from+'"] .chess-square__piece');
    var destination=document.querySelector('[data-chess-square="'+to+'"] .chess-square__piece');
    var animation={finished:Promise.resolve(),cleanup:function(){}};
    if(prefersReducedMotion() || !source || !source.textContent.trim() || !destination) return animation;
    var a=source.getBoundingClientRect(), b=destination.getBoundingClientRect();
    if(!a.width || !a.height || !b.width || !b.height) return animation;
    var ghost=source.cloneNode(true);
    Object.assign(ghost.style,{
      position:"fixed",zIndex:"10000",pointerEvents:"none",left:a.left+"px",top:a.top+"px",
      width:a.width+"px",height:a.height+"px",margin:"0",display:"grid",placeItems:"center",
      transform:"translate3d(0,0,0)",willChange:"transform"
    });
    document.body.appendChild(ghost);
    var oldVisibility=source.style.visibility;
    source.style.visibility="hidden";
    var destinationSquare=destination.closest(".chess-square");
    var captured=!!destination.textContent.trim();
    if(destinationSquare){destinationSquare.classList.add(captured?"is-capture":"is-arrival");window.setTimeout(function(){destinationSquare.classList.remove("is-capture","is-arrival");},430);}
    animation.cleanup=function(){ghost.remove();source.style.visibility=oldVisibility;};
    var dx=b.left-a.left, dy=b.top-a.top;
    if(typeof ghost.animate==="function") {
      // Start the visual response synchronously in the same click event.
      animation.finished=ghost.animate(
        [
          {transform:"translate3d(0,0,0) scale(.96)",filter:"drop-shadow(0 3px 3px rgba(0,0,0,.22))",offset:0},
          {transform:"translate3d("+(dx*.52)+"px,"+(dy*.52-Math.min(16,Math.abs(dy)*.03))+"px,0) scale(1.12)",filter:"drop-shadow(0 12px 9px rgba(0,0,0,.3))",offset:.52},
          {transform:"translate3d("+dx+"px,"+dy+"px,0) scale(1)",filter:"drop-shadow(0 2px 2px rgba(0,0,0,.18))",offset:1}
        ],
        {duration:220,easing:"cubic-bezier(.18,.78,.25,1)",fill:"forwards"}
      ).finished.catch(function(){});
    } else {
      // CSS fallback: one frame to commit the initial position, never two-frame waiting.
      ghost.style.transition="none";
      ghost.style.transform="translate3d(0,0,0)";
      void ghost.offsetWidth;
      ghost.style.transition="transform 190ms cubic-bezier(.2,.75,.25,1)";
      ghost.style.transform="translate3d("+dx+"px,"+dy+"px,0)";
      animation.finished=new Promise(function(resolve){window.setTimeout(resolve,210);});
    }
    return animation;
  }
  function boardCells(fen) {
    var rows = String(fen || "").split(" ")[0].split("/"), cells = [];
    rows.forEach(function (row, rank) {
      var file = 0;
      for (var i = 0; i < row.length; i++) {
        var token = row[i];
        if (/^[1-8]$/.test(token)) {
          for (var n = 0; n < Number(token); n++) cells.push({ square: "abcdefgh"[file++] + (8 - rank), piece: "" });
        } else cells.push({ square: "abcdefgh"[file++] + (8 - rank), piece: token });
      }
    });
    return cells;
  }
  function choosePromotion(candidates) {
    return new Promise(function (resolve) {
      var source = document.querySelector('[data-chess-square="' + candidates[0].slice(0, 2) + '"] .chess-square__piece');
      var white = !!(source && source.classList.contains("is-white"));
      var choices = candidates.map(function (move) {
        var code = move.slice(-1), piece = white ? code.toUpperCase() : code;
        var names = { q: "Ферзь", r: "Ладья", b: "Слон", n: "Конь" };
        return '<button type="button" class="chess-promotion-choice" data-promotion="' + code + '" aria-label="' + names[code] + '"><span class="' + (white ? "is-white" : "is-black") + '">' + (PIECES[piece] || "") + '</span><small>' + names[code] + '</small></button>';
      }).join("");
      var overlay = document.createElement("div");
      overlay.className = "chess-promotion-overlay";
      overlay.innerHTML = '<section class="chess-promotion-dialog" role="dialog" aria-modal="true" aria-label="Выбор превращения пешки"><strong>Во что превратить пешку?</strong><p>Выбери фигуру для завершения хода.</p><div class="chess-promotion-options">' + choices + '</div><button type="button" class="chess-promotion-cancel">Отмена</button></section>';
      document.body.appendChild(overlay);
      function finish(move) {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve(move);
      }
      function onKey(event) { if (event.key === "Escape") finish(null); }
      document.addEventListener("keydown", onKey);
      overlay.addEventListener("click", function (event) {
        if (event.target === overlay || event.target.closest(".chess-promotion-cancel")) finish(null);
        var button = event.target.closest("[data-promotion]");
        if (button) finish(candidates.find(function (move) { return move.endsWith(button.dataset.promotion); }) || null);
      });
      var first = overlay.querySelector("[data-promotion]");
      if (first) first.focus();
    });
  }
  function updateBoardSelection() {
    document.querySelectorAll(".chess-square[data-chess-square]").forEach(function (square) {
      var name = square.dataset.chessSquare;
      square.classList.toggle("is-selected", name === selected);
      var target = !!selected && currentLegalMoves.some(function (move) {
        return move.slice(0, 2) === selected && move.slice(2, 4) === name;
      });
      square.classList.toggle("is-target", target);
    });
  }
  function renderRoom(room) {
    var previousBoard = captureBoardPieces();
    var target = panel(room.name || "Шахматная партия");
    currentCode = room.code;
    var myColor = room.is_white ? "white" : "black";
    var opponentColor = room.is_white ? "black" : "white";
    var me = room.is_white ? room.white : room.black;
    var opponent = room.is_white ? room.black : room.white;
    var whiteName = room.white && room.white.name || "Белые";
    var blackName = room.black && room.black.name || (room.status === "waiting" ? "Ожидаем соперника" : "Чёрные");
    var myName = me && me.name || "Вы";
    var opponentName = opponent && opponent.name || "Ожидаем соперника";
    var finished = room.status === "finished";
    var legal = room.legal_moves || [];
    currentLegalMoves = legal;
    var targets = selected ? legal.filter(function (move) { return move.slice(0, 2) === selected; }).map(function (move) { return move.slice(2, 4); }) : [];
    var lastMove = room.last_move && room.last_move.uci ? room.last_move.uci : "";
    var lastSquares = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [];
    var statusText = finished ? room.result : room.status === "waiting" ? "Ожидаем второго игрока" : room.is_my_turn ? "Ваш ход" : "Ход соперника";
    var clock = room.clock || null;
    clockState = clock ? { clock: clock, turn: room.turn, myColor: myColor, running: room.status === "active", updatedAtMs: Date.parse(clock.updated_at || "") } : null;
    var reviewing = selectedPly !== null && selectedPly < (room.moves || []).length;
    var shownFen = !reviewing ? room.fen : ((room.moves || [])[selectedPly] || {}).fen_after || room.fen;
    var board = boardCells(shownFen);
    var enterBoard = !boardHasEntered;
    boardHasEntered = true;
    if ((myColor === "black") !== boardFlipped) board.reverse();
    var moveRows = [];
    (room.moves || []).forEach(function (move, index, all) {
      if (index % 2 === 0) {
        moveRows.push('<li><span>' + (Math.floor(index / 2) + 1) + '</span><button type="button" data-chess-ply="' + index + '">' + escapeHtml(move.san) + '</button><button type="button" data-chess-ply="' + (all[index + 1] ? index + 1 : index) + '">' + escapeHtml(all[index + 1] ? all[index + 1].san : "…") + '</button></li>');
      }
    });
    target.innerHTML =
      '<section class="chess-arena">' +
        '<header class="chess-arena__topbar"><div class="chess-arena__brand"><span class="chess-arena__mark">♞</span><div><strong>Шахматы</strong><small>BIBLIO · ОНЛАЙН-ПАРТИЯ</small></div></div><div class="chess-arena__meta"><span class="chess-room-pill">Комната <b>' + escapeHtml(room.code) + '</b></span><span class="chess-live-indicator"><i></i>' + (room.status === "waiting" ? "Ожидание игрока" : finished ? "Партия завершена" : "На связи") + '</span></div><a class="chess-arena__back" href="/games/chess">Все партии</a></header>' +
        (room.status === "waiting" ? '<div class="chess-invite"><div><strong>Пригласите соперника в партию</strong><p>Отправьте ему ссылку или шестизначный код комнаты.</p></div><code>' + escapeHtml(room.code) + '</code><button class="chess-control chess-control--accent" id="chess-copy-code" type="button">Копировать код</button></div>' : "") +
        '<div class="chess-arena__layout"><main class="chess-play-area">' +
          '<div class="chess-playerbar chess-playerbar--opponent' + (room.status === "active" && room.turn === opponentColor ? " is-active-turn" : "") + '"><div class="chess-avatar chess-avatar--opponent">' + escapeHtml((opponentName || "С").slice(0,1).toUpperCase()) + '</div><div class="chess-playerbar__identity"><strong>' + escapeHtml(opponentName) + '</strong><small>' + (room.status === "waiting" ? "Соперник ещё не подключился" : "Соперник · " + (opponentColor === "white" ? "белые" : "чёрные")) + '</small><small class="chess-captured">Взято: ' + capturedPieces(room.moves || [], opponentColor) + '</small></div><span class="chess-clock" id="chess-clock-opponent" aria-label="Время соперника" title="Оставшееся время соперника">—:—</span><span class="chess-playerbar__turn">' + (room.status === "active" && room.turn === opponentColor ? "ХОД СОПЕРНИКА" : "") + '</span></div>' +
          '<div class="chess-board-frame"><div class="chess-board' + (enterBoard ? " is-entering" : "") + '" role="grid" aria-label="Шахматная доска">' + board.map(function (cell, index) {
            var row = Math.floor(index / 8), file = index % 8, light = (row + file) % 2 === 0;
            var pieceClass = cell.piece ? (cell.piece === cell.piece.toUpperCase() ? "is-white" : "is-black") : "";
            var isLast = lastSquares.indexOf(cell.square) >= 0;
            var isCheck = room.check && cell.piece === (room.turn === "white" ? "K" : "k");
            var targetClass = targets.indexOf(cell.square) >= 0;
            return '<button class="chess-square ' + (light ? "is-light" : "is-dark") + (selected === cell.square ? " is-selected" : "") + (targetClass ? " is-target" : "") + (isLast ? " is-last-move" : "") + (isCheck ? " is-check" : "") + '" type="button" role="gridcell" data-chess-square="' + cell.square + '" aria-label="' + cell.square + (cell.piece ? " фигура" : " пусто") + '"' + (!room.is_my_turn || finished || reviewing ? " disabled" : "") + '><span class="chess-square__piece ' + pieceClass + '">' + (PIECES[cell.piece] || "") + '</span>' + (file === 0 ? '<small class="chess-coordinate chess-coordinate--rank">' + cell.square[1] + '</small>' : "") + (row === 7 ? '<small class="chess-coordinate chess-coordinate--file">' + cell.square[0] + '</small>' : "") + '</button>';
          }).join("") + '</div></div>' +
          '<div class="chess-playerbar chess-playerbar--self' + (room.status === "active" && room.turn === myColor ? " is-active-turn" : "") + '"><div class="chess-avatar chess-avatar--self">' + escapeHtml((myName || "В").slice(0,1).toUpperCase()) + '</div><div class="chess-playerbar__identity"><strong>' + escapeHtml(myName) + ' <span class="chess-you-tag">ВЫ</span></strong><small>' + (myColor === "white" ? "Белые фигуры" : "Чёрные фигуры") + '</small><small class="chess-captured">Взято: ' + capturedPieces(room.moves || [], myColor) + '</small></div><span class="chess-clock" id="chess-clock-self" aria-label="Ваше время" title="Оставшееся время">—:—</span><span class="chess-playerbar__turn">' + (room.status === "active" && room.turn === myColor ? "ВАШ ХОД" : "") + '</span></div>' +
          '<div class="chess-board-tools"><span class="chess-turn-status ' + (room.is_my_turn && !finished ? "is-active" : "") + '">' + escapeHtml(statusText) + '</span><div class="chess-board-tool-actions"><button class="chess-tool-button" id="chess-live-position" type="button" '+(reviewing ? '' : 'hidden')+'>К текущей позиции</button><button class="chess-tool-button" id="chess-flip-board" type="button" aria-label="Перевернуть доску">↻ Перевернуть доску</button></div></div>' +
          (room.draw_offer_by && room.draw_offer_by !== (me && me.id) && room.status === "active" ? '<div class="chess-draw-response"><span>Соперник предлагает ничью</span><button class="chess-control chess-control--accent" type="button" id="chess-draw-accept">Принять</button><button class="chess-control" type="button" id="chess-draw-decline">Отклонить</button></div>' : "") +
        '</main><aside class="chess-arena__sidebar">' +
          '<section class="chess-side-card"><div class="chess-side-tabs"><span class="is-active">ПАРТИЯ И НОТАЦИЯ</span><span class="chess-time-control">' + escapeHtml(room.time_control || "10+0") + '</span></div><div class="chess-side-card__heading"><div><small>ТЕКУЩАЯ ПАРТИЯ</small><h2>' + (finished ? "Результат" : room.status === "waiting" ? "Ожидание игрока" : "Ход " + (room.turn === "white" ? "белых" : "чёрных")) + '</h2></div><span class="chess-state-dot ' + (finished ? "is-done" : "is-live") + '"></span></div>' +
            '<div class="chess-moves-heading"><span>№</span><span>БЕЛЫЕ</span><span>ЧЁРНЫЕ</span></div><ol class="chess-move-list">' + (moveRows.join("") || '<li class="chess-move-empty">Сделайте первый ход, чтобы начать запись партии</li>') + '</ol>' +
            (finished ? '<div class="chess-result-banner"><small>ПАРТИЯ ЗАВЕРШЕНА</small><strong>' + escapeHtml(room.result) + '</strong></div>' : '<div class="chess-side-status">' + (room.check ? "♔ Королю объявлен шах" : room.status === "waiting" ? "Поделитесь кодом, чтобы начать" : room.is_my_turn ? "Сейчас ваш ход — выберите фигуру" : "Ожидаем ход соперника") + '</div>') +
            '<div class="chess-side-actions">' + (room.status === "active" ? '<button class="chess-control" type="button" id="chess-draw-offer">' + (room.draw_offer_by && room.draw_offer_by !== (me && me.id) ? "Предложение ничьей" : "♧ Предложить ничью") + '</button><button class="chess-control chess-control--danger" type="button" id="chess-resign">⚑ Сдаться</button>' : '') + '<button class="chess-control chess-control--subtle" type="button" id="chess-leave">Выйти из партии</button></div>' +
          '</section><div class="chess-sidebar-note"><span>♟</span><p>Играйте честно и уважайте соперника. Каждый ход сохраняется автоматически.</p></div></aside></div></section>';
    updateClocks();
    var enteringNode = target.querySelector(".chess-board.is-entering");
    if (enteringNode) window.setTimeout(function () { enteringNode.classList.remove("is-entering"); }, 900);
    animateBoardChanges(previousBoard, reviewing ? "" : lastMove);
    $("#chess-copy-code") && $("#chess-copy-code").addEventListener("click", function () {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(room.code).then(function () { toast("Код скопирован"); }).catch(function () { toast("Код комнаты: " + room.code); });
      else toast("Код комнаты: " + room.code);
    });
    $("#chess-live-position") && $("#chess-live-position").addEventListener("click", function () { selectedPly = null; renderRoom(room); });
    $("#chess-flip-board") && $("#chess-flip-board").addEventListener("click", function () {
      boardFlipped = !boardFlipped;
      renderRoom(room);
    });
    target.querySelectorAll("[data-chess-ply]").forEach(function (button) {
      button.addEventListener("click", function () { selectedPly = Number(button.dataset.chessPly); renderRoom(room); });
    });
    target.querySelectorAll("[data-chess-square]").forEach(function (button) {
      button.addEventListener("click", function () {
        var square = button.dataset.chessSquare;
        if (!selected) {
          if (legal.some(function (move) { return move.slice(0, 2) === square; })) {
            selected = square;
            updateBoardSelection();
          }
          return;
        }
        if (square === selected) {
          selected = "";
          updateBoardSelection();
          return;
        }
        var candidates = legal.filter(function (move) { return move.slice(0, 2) === selected && move.slice(2, 4) === square; });
        if (candidates.length) {
          if (candidates.length > 1) {
            choosePromotion(candidates).then(function (move) { if (move) submitMove(move); });
          } else {
            submitMove(candidates[0]);
          }
          return;
        }
        if (legal.some(function (move) { return move.slice(0, 2) === square; })) selected = square;
        else selected = "";
        updateBoardSelection();
      });
    });
    $("#chess-draw-offer") && $("#chess-draw-offer").addEventListener("click", async function () {
      var currentId = me && me.id;
      var action = room.draw_offer_by && room.draw_offer_by !== currentId ? "accept" : "offer";
      try { await request("/api/chess/rooms/" + room.code + "/draw", { method: "POST", body: JSON.stringify({ action: action }) }); await refreshRoom(room.code, false); }
      catch (error) { toast(error.message); }
    });
    $("#chess-draw-accept") && $("#chess-draw-accept").addEventListener("click", async function () {
      try { await request("/api/chess/rooms/" + room.code + "/draw", { method: "POST", body: JSON.stringify({ action: "accept" }) }); await refreshRoom(room.code, false); }
      catch (error) { toast(error.message); }
    });
    $("#chess-draw-decline") && $("#chess-draw-decline").addEventListener("click", async function () {
      try { await request("/api/chess/rooms/" + room.code + "/draw", { method: "POST", body: JSON.stringify({ action: "decline" }) }); await refreshRoom(room.code, false); }
      catch (error) { toast(error.message); }
    });
    $("#chess-resign") && $("#chess-resign").addEventListener("click", async function () {
      if (!window.confirm("Сдаться и завершить партию?")) return;
      try { await request("/api/chess/rooms/" + room.code + "/resign", { method: "POST", body: "{}" }); await refreshRoom(room.code, false); }
      catch (error) { toast(error.message); }
    });
    $("#chess-leave") && $("#chess-leave").addEventListener("click", async function () {
      if (room.status === "active" && !window.confirm("Выход из активной партии будет считаться сдачей. Продолжить?")) return;
      try { await request("/api/chess/rooms/" + room.code + "/leave", { method: "POST", body: "{}" }); stop(); window.location.assign("/games/chess"); }
      catch (error) { toast(error.message); }
    });
  }
  function capturedPieces(moves, color) {
    var previous = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", taken = [];
    (moves || []).forEach(function (move) {
      if (!move.fen_after) return;
      if (move.color === color) {
        var before = boardCells(previous).map(function (c) { return c.piece; }).filter(Boolean);
        var after = boardCells(move.fen_after).map(function (c) { return c.piece; }).filter(Boolean);
        var counts = {};
        after.forEach(function (p) { counts[p] = (counts[p] || 0) + 1; });
        before.forEach(function (p) { counts[p] = (counts[p] || 0) - 1; if (counts[p] < 0 && (color === "white" ? p === p.toLowerCase() : p === p.toUpperCase())) { taken.push(PIECES[p] || p); counts[p] = 0; } });
      }
      previous = move.fen_after;
    });
    return taken.length ? taken.join(" ") : "—";
  }
  function formatClock(ms) {
    var seconds = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }
  function updateClocks() {
    if (!clockState) return;
    var c = clockState.clock;
    var stamp = Number.isFinite(clockState.updatedAtMs) ? clockState.updatedAtMs : Date.parse(c.updated_at || "");
    var elapsed = clockState.running && Number.isFinite(stamp) ? Math.max(0, Date.now() - stamp) : 0;
    var white = Math.max(0, Number(c.white_ms || 0) - (clockState.turn === "white" ? elapsed : 0));
    var black = Math.max(0, Number(c.black_ms || 0) - (clockState.turn === "black" ? elapsed : 0));
    var opponent = document.getElementById("chess-clock-opponent"), self = document.getElementById("chess-clock-self");
    var selfTime = clockState.myColor === "white" ? white : black;
    var opponentTime = clockState.myColor === "white" ? black : white;
    [[self, selfTime, clockState.running && clockState.turn === clockState.myColor], [opponent, opponentTime, clockState.running && clockState.turn !== clockState.myColor]].forEach(function (entry) {
      var node = entry[0], remaining = entry[1], running = entry[2];
      if (!node) return;
      var display = formatClock(remaining);
      if (node.textContent !== display) node.textContent = display;
      var label = (node === self ? "Ваше время: " : "Время соперника: ") + display;
      if (node.getAttribute("aria-label") !== label) node.setAttribute("aria-label", label);
      [["is-running", running], ["is-low-time", remaining <= 60000], ["is-critical", remaining <= 10000]].forEach(function (state) {
        if (node.classList.contains(state[0]) !== state[1]) node.classList.toggle(state[0], state[1]);
      });
    });
  }
  async function submitMove(move) {
    if (movePending) return;
    selectedPly = null;
    var code = currentCode, from = move.slice(0,2), to = move.slice(2,4);
    selected = "";
    movePending = true;
    roomRequestVersion += 1;
    updateBoardSelection();
    var animation = animateMoveImmediately(from,to);
    var moveRequest = request("/api/chess/rooms/" + encodeURIComponent(code) + "/move", {
      method:"POST", body:JSON.stringify({move:move})
    });
    var moveAccepted = false;
    try {
      var outcomes = await Promise.all([
        animation.finished.catch(function () { return null; }),
        moveRequest.then(
          function (result) { return { ok: true, result: result }; },
          function (error) { return { ok: false, error: error }; }
        )
      ]);
      if (!outcomes[1].ok) throw outcomes[1].error;
      moveAccepted = true;
    } catch (error) {
      toast(error.message);
    } finally {
      animation.cleanup();
      movePending = false;
      lastRoomSignature = "";
    }
    skipNextBoardAnimation = moveAccepted;
    await refreshRoom(code,false);
  }
  window.BiblioChess = { init: init, refresh: init, destroy: stop };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}());
