(function () {
  "use strict";
  var timer = 0;
  var selected = "";
  var currentCode = "";
  var PIECES = { K:"♔",Q:"♕",R:"♖",B:"♗",N:"♘",P:"♙",k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟" };
  var $ = function (selector) { return document.querySelector(selector); };
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }
  function stop() { if (timer) window.clearInterval(timer); timer = 0; }
  function panel(title) {
    stop();
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
    if (!location.pathname.startsWith("/games/chess")) return;
    var code = new URLSearchParams(location.search).get("room");
    if (/\/play\/?$/.test(location.pathname) && code) {
      currentCode = code.toUpperCase();
      await refreshRoom(currentCode, true);
      timer = window.setInterval(function () { refreshRoom(currentCode, false); }, 1800);
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
          '<form class="chess-panel" id="chess-create-form"><span class="chess-panel__eyebrow">НОВАЯ ПАРТИЯ</span><h2>Создать комнату</h2><label>Название партии<input name="name" maxlength="80" value="Дружеская партия" required></label><button class="button button--primary" type="submit">♟ Создать и получить код</button></form>' +
          '<form class="chess-panel" id="chess-join-form"><span class="chess-panel__eyebrow">ЕСТЬ ПРИГЛАШЕНИЕ?</span><h2>Войти по коду</h2><label>Код комнаты<input name="code" maxlength="6" minlength="6" pattern="[A-Za-z0-9]{6}" placeholder="Например, A1B2C3" required autocomplete="off"></label><button class="button button--secondary" type="submit">Присоединиться</button></form>' +
        '</div>' +
        '<section class="chess-panel chess-hub__rooms"><div class="chess-panel__heading"><div><span class="chess-panel__eyebrow">ОТКРЫТЫЕ КОМНАТЫ</span><h2>Найти соперника</h2></div><span class="chess-live"><i></i> Обновляется автоматически</span></div><div id="chess-room-list"><p class="empty-state">Загружаем комнаты…</p></div></section>' +
      '</section>';
    $("#chess-create-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget, button = form.querySelector("button");
      button.disabled = true;
      try {
        var name = new FormData(form).get("name");
        var result = await request("/api/chess/rooms", { method: "POST", body: JSON.stringify({ name: name }) });
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
    var whiteName = room.white && room.white.name || "Белые";
    var blackName = room.black && room.black.name || (room.status === "waiting" ? "Ожидаем соперника" : "Чёрные");
    var finished = room.status === "finished";
    var legal = room.legal_moves || [];
    var targets = selected ? legal.filter(function (move) { return move.slice(0, 2) === selected; }).map(function (move) { return move.slice(2, 4); }) : [];
    var statusText = finished ? room.result : room.status === "waiting" ? "Комната создана — пригласи второго игрока" : (room.is_my_turn ? "Твой ход" : "Ход соперника") + (room.check ? " · Шах" : "");
    var turnColor = room.turn === "white" ? "Белые" : "Чёрные";
    var board = boardCells(room.fen);
    target.innerHTML =
      '<section class="chess-game">' +
        '<header class="chess-game__header"><div><span class="eyebrow">BIBLIO · ШАХМАТНАЯ ПАРТИЯ</span><h1>' + escapeHtml(room.name) + '</h1><p>Комната <code>' + escapeHtml(room.code) + '</code> · ' + (room.status === "waiting" ? "Ожидание игрока" : room.status === "active" ? "Партия идёт" : "Партия завершена") + '</p></div><a class="button button--secondary" href="/games/chess">← К комнатам</a></header>' +
        (room.status === "waiting" ? '<div class="chess-invite"><div><strong>Пригласи соперника</strong><p>Отправь ему этот шестизначный код. Он войдёт за чёрных.</p></div><code>' + escapeHtml(room.code) + '</code><button class="button button--primary" id="chess-copy-code" type="button">Скопировать код</button></div>' : "") +
        '<div class="chess-game__layout"><section class="chess-board-panel">' +
          '<div class="chess-player chess-player--top"><span class="chess-player__piece">♚</span><div><strong>' + escapeHtml(blackName) + '</strong><small>Чёрные</small></div><span class="chess-player__turn">' + (room.turn === "black" && room.status === "active" ? "ХОД" : "") + '</span></div>' +
          '<div class="chess-board" role="grid" aria-label="Шахматная доска">' + board.map(function (cell, index) {
            var row = Math.floor(index / 8), file = index % 8, light = (row + file) % 2 === 0;
            var pieceClass = cell.piece ? (cell.piece === cell.piece.toUpperCase() ? "is-white" : "is-black") : "";
            return '<button class="chess-square ' + (light ? "is-light" : "is-dark") + (selected === cell.square ? " is-selected" : "") + (targets.indexOf(cell.square) >= 0 ? " is-target" : "") + '" type="button" role="gridcell" data-chess-square="' + cell.square + '" aria-label="' + cell.square + (cell.piece ? " фигура" : " пусто") + '"' + (!room.is_my_turn || finished ? " disabled" : "") + '><span class="chess-square__piece ' + pieceClass + '">' + (PIECES[cell.piece] || "") + '</span>' + (file === 0 ? '<small class="chess-coordinate chess-coordinate--rank">' + (8 - row) + '</small>' : "") + (row === 7 ? '<small class="chess-coordinate chess-coordinate--file">' + "abcdefgh"[file] + '</small>' : "") + '</button>';
          }).join("") + '</div>' +
          '<div class="chess-player chess-player--bottom"><span class="chess-player__piece">♔</span><div><strong>' + escapeHtml(whiteName) + '</strong><small>Белые</small></div><span class="chess-player__turn">' + (room.turn === "white" && room.status === "active" ? "ХОД" : "") + '</span></div>' +
          '<div class="chess-status' + (finished ? " is-finished" : room.is_my_turn ? " is-your-turn" : "") + '" role="status">' + escapeHtml(statusText) + '</div>' +
          (room.status === "active" ? '<div class="chess-actions"><button class="button button--secondary" type="button" id="chess-draw-offer">' + (room.draw_offer_by && room.draw_offer_by !== (room.is_white ? room.white.id : room.black.id) ? "Ответить на ничью" : "Предложить ничью") + '</button><button class="button button--danger" type="button" id="chess-resign">Сдаться</button></div>' : "") +
          (room.draw_offer_by && room.draw_offer_by !== (room.is_white ? room.white.id : room.black.id) && room.status === "active" ? '<div class="chess-draw-response"><span>Соперник предлагает ничью</span><button class="button button--primary" type="button" id="chess-draw-accept">Принять</button><button class="button button--secondary" type="button" id="chess-draw-decline">Отклонить</button></div>' : "") +
        '</section><aside class="chess-side"><section class="chess-panel"><span class="chess-panel__eyebrow">СОСТОЯНИЕ</span><h2>' + (finished ? "Итог партии" : room.status === "waiting" ? "Ждём игрока" : "Ход: " + turnColor) + '</h2><p>' + escapeHtml(statusText) + '</p>' + (finished ? '<strong class="chess-result">' + escapeHtml(room.result) + '</strong>' : "") + '</section>' +
        '<section class="chess-panel"><span class="chess-panel__eyebrow">ЗАПИСЬ ПАРТИИ</span><h2>Ходы</h2><ol class="chess-move-list">' + (room.moves || []).map(function (move, index) {
          if (index % 2 !== 0) return "";
          return '<li><span>' + (Math.floor(index / 2) + 1) + '.</span><strong>' + escapeHtml(move.san) + '</strong><em>' + escapeHtml(room.moves[index + 1] ? room.moves[index + 1].san : "…") + '</em></li>';
        }).join("") + ((room.moves || []).length ? "" : "<li class='chess-move-empty'>Партия ещё не началась</li>") + '</ol></section>' +
        '<button class="button button--secondary chess-back-link" type="button" id="chess-leave">Выйти из комнаты</button></aside></div></section>';
    $("#chess-copy-code") && $("#chess-copy-code").addEventListener("click", function () {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(room.code).then(function () { toast("Код скопирован"); }).catch(function () { toast("Код комнаты: " + room.code); });
      else toast("Код комнаты: " + room.code);
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
      var currentId = room.is_white ? room.white.id : room.black.id;
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
  async function submitMove(move) {
    var code = currentCode;
    selected = "";
    try { await request("/api/chess/rooms/" + code + "/move", { method: "POST", body: JSON.stringify({ move: move }) }); await refreshRoom(code, false); }
    catch (error) { toast(error.message); await refreshRoom(code, false); }
  }
  window.BiblioChess = { init: init, refresh: init, destroy: stop };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}());
