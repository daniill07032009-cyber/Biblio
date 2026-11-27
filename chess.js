(function () {
  "use strict";
  var timer = 0;
  var selected = "";
  var currentCode = "";
  var boardFlipped = false;
  var clockTimer = 0;
  var clockState = null;
  var selectedPly = null;
  var PIECES = { K:"♔",Q:"♕",R:"♖",B:"♗",N:"♘",P:"♙",k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟" };
  var $ = function (selector) { return document.querySelector(selector); };
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }
  function stop() { if (timer) window.clearInterval(timer); if (clockTimer) window.clearInterval(clockTimer); timer = 0; clockTimer = 0; clockState = null; }
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
    var code = new URLSearchParams(location.search).get("room");
    if (/\/play\/?$/.test(location.pathname) && code) {
      currentCode = code.toUpperCase();
      await refreshRoom(currentCode, true);
      timer = window.setInterval(function () { refreshRoom(currentCode, false); }, 1800);
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
    var target = panel("Игровые комнаты");
    target.innerHTML =
      '<section class="chess-hub">' +
        '<header class="chess-hub__header"><div><span class="eyebrow">BIBLIO · ДВА ИГРОКА</span><h1>Шахматы</h1><p>Создай комнату и пригласи соперника. Никаких ботов — только реальные игроки Biblio.</p></div><a class="button button--secondary" href="/games">← Все игры</a></header>' +
        '<div class="chess-hub__columns">' +
          '<form class="chess-panel" id="chess-create-form"><span class="chess-panel__eyebrow">НОВАЯ ПАРТИЯ</span><h2>Создать комнату</h2><label>Название партии<input name="name" maxlength="80" value="Дружеская партия" required></label><label>Контроль времени<select name="time_control"><option value="3+2">Блиц · 3 + 2</option><option value="5+0">Блиц · 5 минут</option><option value="10+0" selected>Рапид · 10 минут</option><option value="15+10">Рапид · 15 + 10</option></select></label><button class="button button--primary" type="submit">♟ Создать и получить код</button></form>' +
          '<form class="chess-panel" id="chess-join-form"><span class="chess-panel__eyebrow">ЕСТЬ ПРИГЛАШЕНИЕ?</span><h2>Войти по коду</h2><label>Код комнаты<input name="code" maxlength="6" minlength="6" pattern="[A-Za-z0-9]{6}" placeholder="Например, A1B2C3" required autocomplete="off"></label><button class="button button--secondary" type="submit">Присоединиться</button></form>' +
        '</div>' +
        '<section class="chess-panel chess-hub__rooms"><div class="chess-panel__heading"><div><span class="chess-panel__eyebrow">ОТКРЫТЫЕ КОМНАТЫ</span><h2>Найти соперника</h2></div><span class="chess-live"><i></i> Обновляется автоматически</span></div><div id="chess-room-list"><p class="empty-state">Загружаем комнаты…</p></div></section>' +
      '</section>';
    $("#chess-create-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = form.querySelector("button");
      button.disabled = true;
      try {
        var formData = new FormData(form);
        var name = formData.get("name");
        var result = await request("/api/chess/rooms", { method: "POST", body: JSON.stringify({ name: name, time_control: formData.get("time_control") }) });
        navigate(result.room.code);
      } catch (error) { toast(error.message); button.disabled = false; }
    });
    $("#chess-join-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = form.querySelector("button");
      button.disabled = true;
      var codeValue = String(new FormData(form).get("code") || "").trim().toUpperCase();
      try {
        await request("/api/chess/rooms/" + encodeURIComponent(codeValue) + "/join", { method: "POST", body: "{}" });
        navigate(codeValue);
      } catch (error) { toast(error.message); button.disabled = false; }
    });
  }
  async function refreshLobby() {
    var list = $("#chess-room-list");
    if (!list || !location.pathname.startsWith("/games/chess")) return;
    try {
      var result = await request("/api/chess/rooms");
      if (!result.rooms.length) {
        list.innerHTML = '<p class="empty-state">Сейчас нет свободных комнат. Создай первую партию и пригласи друга.</p>';
        return;
      }
      list.innerHTML = result.rooms.map(function (room) {
        return '<article class="chess-room-row"><div><strong>' + escapeHtml(room.name) + '</strong><span>Белые: ' + escapeHtml(room.white_name) + ' · Код: <code>' + escapeHtml(room.code) + '</code></span></div><button class="button ' + (room.is_owner ? "button--secondary" : "button--primary") + '" type="button" data-chess-room="' + escapeHtml(room.code) + '">' + (room.is_owner ? "Открыть свою комнату" : "Играть за чёрных") + '</button></article>';
      }).join("");
      list.querySelectorAll("[data-chess-room]").forEach(function (button) {
        button.addEventListener("click", async function () {
          var code = button.dataset.chessRoom;
          try {
            var room = result.rooms.find(function (item) { return item.code === code; });
            if (!room || !room.is_owner) await request("/api/chess/rooms/" + code + "/join", { method: "POST", body: "{}" });
            navigate(code);
          } catch (error) { toast(error.message); refreshLobby(); }
        });
      });
    } catch (error) { list.innerHTML = '<p class="empty-state">' + escapeHtml(error.message) + '</p>'; }
  }
  async function refreshRoom(code, initial) {
    var target = $("#game-catalog-detail-panel");
    if (!target || !location.pathname.startsWith("/games/chess")) return;
    try {
      var result = await request("/api/chess/rooms/" + encodeURIComponent(code));
      renderRoom(result.room);
    } catch (error) {
      if (initial) {
        var failed = panel("Партия недоступна");
        failed.innerHTML = '<section class="chess-panel"><h2>Не удалось открыть партию</h2><p>' + escapeHtml(error.message) + '</p><a class="button button--primary" href="/games/chess">К комнатам</a></section>';
        stop();
      }
    }
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
  function renderRoom(room) {
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
    var targets = selected ? legal.filter(function (move) { return move.slice(0, 2) === selected; }).map(function (move) { return move.slice(2, 4); }) : [];
    var lastMove = room.last_move && room.last_move.uci ? room.last_move.uci : "";
    var lastSquares = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [];
    var statusText = finished ? room.result : room.status === "waiting" ? "Ожидаем второго игрока" : room.is_my_turn ? "Ваш ход" : "Ход соперника";
    var clock = room.clock || null;
    clockState = clock && room.status === "active" ? { clock: clock, turn: room.turn, myColor: myColor } : null;
    var reviewing = selectedPly !== null && selectedPly < (room.moves || []).length;
    var shownFen = !reviewing ? room.fen : ((room.moves || [])[selectedPly] || {}).fen_after || room.fen;
    var board = boardCells(shownFen);
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
          '<div class="chess-playerbar chess-playerbar--opponent"><div class="chess-avatar chess-avatar--opponent">' + escapeHtml((opponentName || "С").slice(0,1).toUpperCase()) + '</div><div class="chess-playerbar__identity"><strong>' + escapeHtml(opponentName) + '</strong><small>' + (room.status === "waiting" ? "Соперник ещё не подключился" : "Соперник · " + (opponentColor === "white" ? "белые" : "чёрные")) + '</small><small class="chess-captured">Взято: ' + capturedPieces(room.moves || [], opponentColor) + '</small></div><span class="chess-clock" id="chess-clock-opponent">—:—</span><span class="chess-playerbar__turn">' + (room.status === "active" && room.turn === opponentColor ? "ХОД СОПЕРНИКА" : "") + '</span></div>' +
          '<div class="chess-board-frame"><div class="chess-board" role="grid" aria-label="Шахматная доска">' + board.map(function (cell, index) {
            var row = Math.floor(index / 8), file = index % 8, light = (row + file) % 2 === 0;
            var pieceClass = cell.piece ? (cell.piece === cell.piece.toUpperCase() ? "is-white" : "is-black") : "";
            var isLast = lastSquares.indexOf(cell.square) >= 0;
            var targetClass = targets.indexOf(cell.square) >= 0;
            return '<button class="chess-square ' + (light ? "is-light" : "is-dark") + (selected === cell.square ? " is-selected" : "") + (targetClass ? " is-target" : "") + (isLast ? " is-last-move" : "") + '" type="button" role="gridcell" data-chess-square="' + cell.square + '" aria-label="' + cell.square + (cell.piece ? " фигура" : " пусто") + '"' + (!room.is_my_turn || finished || reviewing ? " disabled" : "") + '><span class="chess-square__piece ' + pieceClass + '">' + (PIECES[cell.piece] || "") + '</span>' + (file === 0 ? '<small class="chess-coordinate chess-coordinate--rank">' + cell.square[1] + '</small>' : "") + (row === 7 ? '<small class="chess-coordinate chess-coordinate--file">' + cell.square[0] + '</small>' : "") + '</button>';
          }).join("") + '</div></div>' +
          '<div class="chess-playerbar chess-playerbar--self"><div class="chess-avatar chess-avatar--self">' + escapeHtml((myName || "В").slice(0,1).toUpperCase()) + '</div><div class="chess-playerbar__identity"><strong>' + escapeHtml(myName) + ' <span class="chess-you-tag">ВЫ</span></strong><small>' + (myColor === "white" ? "Белые фигуры" : "Чёрные фигуры") + '</small><small class="chess-captured">Взято: ' + capturedPieces(room.moves || [], myColor) + '</small></div><span class="chess-clock" id="chess-clock-self">—:—</span><span class="chess-playerbar__turn">' + (room.status === "active" && room.turn === myColor ? "ВАШ ХОД" : "") + '</span></div>' +
          '<div class="chess-board-tools"><span class="chess-turn-status ' + (room.is_my_turn && !finished ? "is-active" : "") + '">' + escapeHtml(statusText) + '</span><div class="chess-board-tool-actions"><button class="chess-tool-button" id="chess-live-position" type="button" '+(reviewing ? '' : 'hidden')+'>К текущей позиции</button><button class="chess-tool-button" id="chess-flip-board" type="button" aria-label="Перевернуть доску">↻ Перевернуть доску</button></div></div>' +
          (room.draw_offer_by && room.draw_offer_by !== (me && me.id) && room.status === "active" ? '<div class="chess-draw-response"><span>Соперник предлагает ничью</span><button class="chess-control chess-control--accent" type="button" id="chess-draw-accept">Принять</button><button class="chess-control" type="button" id="chess-draw-decline">Отклонить</button></div>' : "") +
        '</main><aside class="chess-arena__sidebar">' +
          '<section class="chess-side-card"><div class="chess-side-tabs"><span class="is-active">ПАРТИЯ И НОТАЦИЯ</span><span class="chess-time-control">' + escapeHtml(room.time_control || "10+0") + '</span></div><div class="chess-side-card__heading"><div><small>ТЕКУЩАЯ ПАРТИЯ</small><h2>' + (finished ? "Результат" : room.status === "waiting" ? "Ожидание игрока" : "Ход " + (room.turn === "white" ? "белых" : "чёрных")) + '</h2></div><span class="chess-state-dot ' + (finished ? "is-done" : "is-live") + '"></span></div>' +
            '<div class="chess-moves-heading"><span>№</span><span>БЕЛЫЕ</span><span>ЧЁРНЫЕ</span></div><ol class="chess-move-list">' + (moveRows.join("") || '<li class="chess-move-empty">Сделайте первый ход, чтобы начать запись партии</li>') + '</ol>' +
            (finished ? '<div class="chess-result-banner"><small>ПАРТИЯ ЗАВЕРШЕНА</small><strong>' + escapeHtml(room.result) + '</strong></div>' : '<div class="chess-side-status">' + (room.check ? "♔ Королю объявлен шах" : room.status === "waiting" ? "Поделитесь кодом, чтобы начать" : room.is_my_turn ? "Сейчас ваш ход — выберите фигуру" : "Ожидаем ход соперника") + '</div>') +
            '<div class="chess-side-actions">' + (room.status === "active" ? '<button class="chess-control" type="button" id="chess-draw-offer">' + (room.draw_offer_by && room.draw_offer_by !== (me && me.id) ? "Предложение ничьей" : "♧ Предложить ничью") + '</button><button class="chess-control chess-control--danger" type="button" id="chess-resign">⚑ Сдаться</button>' : '') + '<button class="chess-control chess-control--subtle" type="button" id="chess-leave">Выйти из партии</button></div>' +
          '</section><div class="chess-sidebar-note"><span>♟</span><p>Играйте честно и уважайте соперника. Каждый ход сохраняется автоматически.</p></div></aside></div></section>';
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
          if (legal.some(function (move) { return move.slice(0, 2) === square; })) { selected = square; renderRoom(room); }
          return;
        }
        if (square === selected) { selected = ""; renderRoom(room); return; }
        var candidates = legal.filter(function (move) { return move.slice(0, 2) === selected && move.slice(2, 4) === square; });
        if (candidates.length) {
          var move = candidates[0];
          if (candidates.length > 1) {
            var promotion = String(window.prompt("Превращение пешки: Q — ферзь, R — ладья, B — слон, N — конь", "q") || "q").toLowerCase();
            move = candidates.find(function (candidate) { return candidate.endsWith(promotion); }) || candidates.find(function (candidate) { return candidate.endsWith("q"); }) || candidates[0];
          }
          submitMove(move);
          return;
        }
        if (legal.some(function (move) { return move.slice(0, 2) === square; })) selected = square;
        else selected = "";
        renderRoom(room);
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
    var elapsed = Math.max(0, Date.now() - Date.parse(c.updated_at || new Date().toISOString()));
    var white = Math.max(0, Number(c.white_ms || 0) - (clockState.turn === "white" ? elapsed : 0));
    var black = Math.max(0, Number(c.black_ms || 0) - (clockState.turn === "black" ? elapsed : 0));
    var opponent = document.getElementById("chess-clock-opponent"), self = document.getElementById("chess-clock-self");
    if (opponent) opponent.textContent = formatClock(clockState.myColor === "white" ? black : white);
    if (self) self.textContent = formatClock(clockState.myColor === "white" ? white : black);
    if (self) self.classList.toggle("is-running", clockState.turn === clockState.myColor);
    if (opponent) opponent.classList.toggle("is-running", clockState.turn !== clockState.myColor);
  }
  async function submitMove(move) {
    selectedPly = null;
    var code = currentCode;
    selected = "";
    try { await request("/api/chess/rooms/" + code + "/move", { method: "POST", body: JSON.stringify({ move: move }) }); await refreshRoom(code, false); }
    catch (error) { toast(error.message); await refreshRoom(code, false); }
  }
  window.BiblioChess = { init: init, refresh: init, destroy: stop };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}());
