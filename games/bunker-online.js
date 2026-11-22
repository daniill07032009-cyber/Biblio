
(function(){
"use strict";
var $=function(id){return document.getElementById(id);};
var roomCode="",room=null,pollTimer=null,selectedScenario="classic",selectedDifficulty="normal",busy=false,refreshPending=false,actionPending=false,pollFailures=0,lastRenderedSnapshot="";
var scenarios=[
 ["classic","Классика","Базовый сценарий выживания"],["nuclear","Ядерная зима","Радиация, холод и дефицит энергии"],
 ["zombie","Зомби-апокалипсис","Заражённые и риск укуса"],["pandemic","Пандемия","Опасный неизвестный вирус"],
 ["ice","Вечная мерзлота","Ледяная катастрофа и нехватка тепла"],["aliens","Вторжение","Чужая цивилизация на поверхности"],
 ["eco","Экологический коллапс","Отравленная вода и непригодная почва"],["volcano","Супервулкан","Пепел, темнота и гибель урожая"]
];
var difficulties=[["easy","Лёгкая","18% негативных карт"],["normal","Обычная","32% негативных карт"],["hard","Высокая","50% негативных карт"],["extreme","Экстремальная","68% негативных карт"]];
function toast(t){var el=document.createElement("div");el.className="toast";el.textContent=t;document.body.appendChild(el);setTimeout(function(){el.remove();},2600);}
async function api(path,options){var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},12000),started=performance.now();try{var response=await fetch(path,Object.assign({credentials:"same-origin",headers:{"Content-Type":"application/json"},signal:controller.signal},options||{}));var elapsed=performance.now()-started;if(elapsed>=2000)console.warn("[Biblio Bunker] Медленный API-ответ:",path,Math.round(elapsed)+" мс");if(elapsed>=4000&&options&&options.method&&options.method!=="GET")toast("Сервер обрабатывает действие дольше обычного. Не нажимай повторно.");var data=await response.json().catch(function(){return {};});if(!response.ok){if(response.status===401)showAuth();var error=new Error(data.error||"Не удалось выполнить запрос.");error.status=response.status;throw error;}return data;}catch(error){if(controller.signal.aborted)throw new Error("Сервер не ответил за 12 секунд. Проверь соединение.");throw error;}finally{clearTimeout(timer);}}
function showAuth(){ $("home").classList.remove("hidden");$("lobby").classList.add("hidden");$("game").classList.add("hidden");$("home").innerHTML='<div class="panel" style="max-width:600px;margin:40px auto;text-align:center"><h2>Нужен аккаунт Biblio</h2><p class="sub">Войди в свой аккаунт на Biblio, затем вернись в игру.</p><a class="btn primary" href="/">ПЕРЕЙТИ НА BIBLIO</a></div>'; }
function showSection(name){$("home").classList.toggle("hidden",name!=="home");$("lobby").classList.toggle("hidden",name!=="lobby");$("game").classList.toggle("hidden",name!=="game");}
function post(path,data){return api(path,{method:"POST",body:JSON.stringify(data||{})});}
function avatarHtml(m){var initial=(m.name||"И").trim().slice(0,1).toUpperCase();return '<div class="avatar">'+(m.is_bot?"🤖":(m.avatar_url?'<img src="'+escapeHtml(m.avatar_url)+'" alt="">':escapeHtml(initial)))+'</div>';}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
async function createRoom(){if(busy)return;busy=true;try{var r=await post("/api/bunker/rooms",{max_players:Number($("maxPlayers").value),bot_count:Number($("botCount").value||0)});roomCode=r.room.code;localStorage.setItem("bunkerOnlineRoom",roomCode);setRoom(r.room);startPolling();}catch(e){toast(e.message);}finally{busy=false;}}
async function joinRoom(){if(actionPending)return;var code=$("joinCode").value.trim().toUpperCase();if(code.length!==6){toast("Введи шестизначный код комнаты.");return;}return withAction($("joinRoom"),async function(){try{var r=await post("/api/bunker/rooms/"+encodeURIComponent(code)+"/join",{});roomCode=code;localStorage.setItem("bunkerOnlineRoom",roomCode);setRoom(r.room);startPolling();return true;}catch(e){toast(e.message);return false;}});}
function render(){if(!room)return;showSection(room.status==="started"||room.status==="finished"?"game":"lobby");if(room.status==="started"||room.status==="finished"){renderGame();}else{renderLobby();}}
function setRoom(nextRoom){room=nextRoom;var snapshot=JSON.stringify(room);if(snapshot!==lastRenderedSnapshot){lastRenderedSnapshot=snapshot;render();}}
async function withAction(button,task){if(actionPending)return false;actionPending=true;if(button)button.disabled=true;try{return await task();}finally{actionPending=false;if(button&&button.isConnected)button.disabled=false;}}
function renderLobby(){
 $("lobbyCode").textContent=room.code;$("lobbyCount").textContent=room.members.length+" / "+room.max_players+" ИГРОКОВ";
 $("lobbyPlayers").innerHTML=room.members.map(function(m){return '<div class="player">'+avatarHtml(m)+'<div class="player-info"><strong>'+escapeHtml(m.name)+'</strong><small>'+(m.is_bot?"Игровой бот · "+escapeHtml(m.bot_style||"персонаж"):(m.role==="host"?"Ведущий":(m.online?"В сети":"Не в сети")))+'</small></div><span class="ready">'+(m.role==="host"?"★ ВЕДУЩИЙ":(m.is_bot?"🤖 БОТ":(m.ready?"✓ ГОТОВ":"ОЖИДАЕТ")))+'</span></div>';}).join("");
 $("readyBtn").textContent=room.my_ready?"ОТМЕНИТЬ ГОТОВНОСТЬ":"Я ГОТОВ";
 $("readyBtn").disabled=room.is_host;
 $("startBtn").classList.toggle("hidden",!room.is_host);
 $("startBtn").disabled=room.members.length<2||!room.members.every(function(m){return m.role==="host"||m.is_bot||m.ready;});
 $("setupPanel").classList.toggle("hidden",!room.is_host||room.members.length<2||!room.members.every(function(m){return m.role==="host"||m.is_bot||m.ready;}));
 $("lobbyNotice").textContent=room.members.length<2?"Добавь ботов или пригласи друзей по коду комнаты. Для старта нужно минимум 2 участника.":(room.members.every(function(m){return m.role==="host"||m.is_bot||m.ready;})?"Команда собрана. Ведущий может выбрать сценарий и сложность.":"Ждём подтверждения готовности от реальных игроков.");
 renderChoices();
}
function renderChoices(){
 $("scenarioGrid").innerHTML=scenarios.map(function(s){return '<button class="choice '+(selectedScenario===s[0]?"active":"")+'" data-scenario="'+s[0]+'"><strong>'+s[1]+'</strong><small>'+s[2]+'</small></button>';}).join("");
 $("difficultyGrid").innerHTML=difficulties.map(function(d){return '<button class="choice '+(selectedDifficulty===d[0]?"active":"")+'" data-difficulty="'+d[0]+'"><strong>'+d[1]+'</strong><small>'+d[2]+'</small></button>';}).join("");
 $("scenarioGrid").querySelectorAll("[data-scenario]").forEach(function(b){b.onclick=function(){selectedScenario=b.dataset.scenario;renderChoices();};});
 $("difficultyGrid").querySelectorAll("[data-difficulty]").forEach(function(b){b.onclick=function(){selectedDifficulty=b.dataset.difficulty;renderChoices();};});
 var chance=difficulties.find(function(d){return d[0]===selectedDifficulty;});$("difficultyNote").textContent="Сложность «"+chance[1]+"»: "+chance[2]+". Чем выше сложность, тем чаще выпадают болезни, опасные секреты и бесполезный багаж.";
}
async function startGame(){return withAction($("confirmStart"),async function(){try{var r=await post("/api/bunker/rooms/"+roomCode+"/start",{scenario:selectedScenario,difficulty:selectedDifficulty});setRoom(r.room);return true;}catch(e){toast(e.message);return false;}});}
function renderGame(){
 $("gameTitle").textContent=room.scenario.title;$("gameCode").textContent=room.code;$("roundNum").textContent=room.round;
 $("difficultyPill").textContent="СЛОЖНОСТЬ: "+room.difficulty.title.toUpperCase();
 $("disasterText").textContent=room.disaster;
 var alive=room.players.filter(function(p){return p.alive;}).length;
 $("playersMetric").textContent=(room.status==="finished"?"ИГРА ЗАВЕРШЕНА · ВЫЖИЛИ: ":"В ИГРЕ: ")+alive+" / "+room.players.length;
 $("capacityMetric").textContent="МЕСТ В БУНКЕРЕ: "+room.capacity;
 $("revealedMetric").textContent="РАСКРЫТО КАРТ: "+room.revealed_cards.length;
 var list=room.players.map(function(p){var n=room.revealed_cards.filter(function(c){return c.user_id===p.user_id;});return '<div class="player">'+avatarHtml(p)+'<div class="player-info"><strong>'+escapeHtml(p.name)+(p.is_bot?" · 🤖":"")+'</strong><small>'+(p.alive?"В игре":"Покинул убежище")+" · "+n.length+" карт раскрыто</small></div></div>";}).join("");
 $("gamePlayers").innerHTML=list;$("sidePlayers").innerHTML=list;
 $("revealedCards").innerHTML=room.revealed_cards.map(function(card){return '<div class="card revealed"><small>'+escapeHtml(card.name)+' · '+escapeHtml(card.label)+'</small><strong>'+escapeHtml(card.value)+'</strong><span class="'+(card.negative?"bad":"good")+'">'+(card.negative?"НЕГАТИВНАЯ КАРТА":"ПОЛЕЗНАЯ КАРТА")+'</span></div>';}).join("")||'<p class="hint">Пока никто не раскрыл карты.</p>';
 $("myCards").innerHTML=room.my_cards.map(function(card){var mine=room.revealed_cards.some(function(x){return x.user_id===room.my_user_id&&x.category===card.category;});return '<div class="card '+(mine?"revealed":"")+'"><small>'+escapeHtml(card.label)+'</small><strong>'+(mine?escapeHtml(card.value):"СЕКРЕТНАЯ КАРТА")+'</strong>'+(mine?'<span class="'+(card.negative?"bad":"good")+'">'+(card.negative?"НЕГАТИВНАЯ КАРТА":"ПОЛЕЗНАЯ КАРТА")+'</span>':'<button class="btn secondary wide" data-reveal="'+card.category+'">РАСКРЫТЬ</button>')+'</div>';}).join("");
 var chatLog=$("chatLog"),wasAtBottom=chatLog.scrollHeight-chatLog.scrollTop-chatLog.clientHeight<40;chatLog.innerHTML=room.chat.map(function(m){return '<div class="msg '+(m.system?"system":"")+'"><b>'+escapeHtml(m.name)+(m.is_bot?" · 🤖":"")+'</b>'+escapeHtml(m.text)+'</div>';}).join("");if(wasAtBottom)chatLog.scrollTop=chatLog.scrollHeight;
 $("eventBox").classList.toggle("hidden",!room.event);if(room.event)$("eventBox").innerHTML="<b>"+escapeHtml(room.event.title)+"</b>"+escapeHtml(room.event.description);
 $("resultBox").classList.toggle("hidden",!room.result&&!room.status.includes("finished"));$("resultBox").textContent=room.result||"";
 var finished=room.status==="finished";$("eventBtn").classList.toggle("hidden",!room.is_host||finished);$("voteStartBtn").classList.toggle("hidden",!room.is_host||finished||!!(room.voting&&room.voting.open));$("resolveVoteBtn").classList.toggle("hidden",!room.is_host||finished||!room.voting||!room.voting.open);
 $("votePanel").classList.toggle("hidden",finished||!room.voting||!room.voting.open);
 if(finished){var winners=(room.survivors||room.players.filter(function(p){return p.alive;})).map(function(p){return p.name;});$("resultBox").textContent=["🏁 ПАРТИЯ ЗАВЕРШЕНА",room.result||"Бункер укомплектован.","Выжившие: "+(winners.join(", ")||"нет"),"Раундов проведено: "+Math.max(1,room.round-1)].join(String.fromCharCode(10)+String.fromCharCode(10));$("resultBox").style.whiteSpace="pre-line";}
 if(room.voting&&room.voting.open&&!finished){var votes=room.voting.votes||{},alive=room.players.filter(function(p){return p.alive;}),voted=alive.filter(function(p){return Object.prototype.hasOwnProperty.call(votes,String(p.user_id));}).length;var tied=room.voting.tied_targets||[];$("voteList").innerHTML='<p class="hint">'+(tied.length?"Повторное голосование из-за ничьей.":"Выбывает игрок с наибольшим числом голосов.")+" Голоса: "+voted+" / "+alive.length+".</p>"+alive.filter(function(p){return p.user_id!==room.my_user_id&&(!tied.length||tied.indexOf(p.user_id)!==-1);}).map(function(p){return '<button class="btn secondary vote-option" data-vote="'+p.user_id+'" '+(String(votes[String(room.my_user_id)])===String(p.user_id)?"disabled":"")+'>'+escapeHtml(p.name)+(p.is_bot?" · 🤖 БОТ":"")+(String(votes[String(room.my_user_id)])===String(p.user_id)?" · ВАШ ГОЛОС":"")+'</button>';}).join("");$("resolveVoteBtn").disabled=voted<alive.length;$("voteList").querySelectorAll("[data-vote]").forEach(function(b){b.onclick=function(){sendAction({type:"vote",target_user_id:Number(b.dataset.vote)},b);};});}
 $("myCards").querySelectorAll("[data-reveal]").forEach(function(b){b.onclick=function(){sendAction({type:"reveal",category:b.dataset.reveal},b);};});
 if(room.voting&&room.voting.open&&(room.voting.tied_targets||[]).length&&!finished){
  var tiedIds=room.voting.tied_targets;
  $("voteList").innerHTML="<p class='hint'>Ничья. Ведущий выбирает одного из участников с равным числом голосов решающим голосом.</p>"+(room.is_host?room.players.filter(function(p){return p.alive&&tiedIds.indexOf(p.user_id)!==-1;}).map(function(p){return '<button class=\"btn danger vote-option\" data-tiebreak=\"'+p.user_id+'\">Решающий голос: '+escapeHtml(p.name)+'</button>';}).join(""):"<p class='hint'>Ожидаем решения ведущего…</p>");
  $("voteList").querySelectorAll("[data-tiebreak]").forEach(function(b){b.onclick=function(){sendAction({type:"tie_break",target_user_id:Number(b.dataset.tiebreak)},b);};});
  $("resolveVoteBtn").disabled=true;
 }

}
async function refresh(){if(!roomCode||busy||actionPending||refreshPending||document.hidden)return;refreshPending=true;try{var r=await api("/api/bunker/rooms/"+encodeURIComponent(roomCode));pollFailures=0;setRoom(r.room);}catch(e){if(e.status===401||e.status===403||e.status===404){if(pollTimer)clearTimeout(pollTimer);pollTimer=null;localStorage.removeItem("bunkerOnlineRoom");roomCode="";room=null;lastRenderedSnapshot="";toast(e.message);showSection("home");}else{pollFailures++;if(pollFailures===3)toast("Связь с комнатой нестабильна. Продолжаю переподключение.");console.warn("[Biblio Bunker] Ошибка синхронизации:",e.message);}}finally{refreshPending=false;}}
async function sendAction(data,button){return withAction(button,async function(){try{var r=await post("/api/bunker/rooms/"+roomCode+"/action",data);setRoom(r.room);return true;}catch(e){toast(e.message);return false;}});}
async function ready(){return withAction($("readyBtn"),async function(){try{var r=await post("/api/bunker/rooms/"+roomCode+"/ready",{ready:!room.my_ready});setRoom(r.room);return true;}catch(e){toast(e.message);return false;}});}
function copyCode(){if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(roomCode).then(function(){toast("Код скопирован: "+roomCode);}).catch(function(){toast("Код комнаты: "+roomCode);});}else{toast("Код комнаты: "+roomCode);}}
function schedulePoll(delay){if(pollTimer)clearTimeout(pollTimer);if(!roomCode||document.hidden)return;pollTimer=setTimeout(async function(){await refresh();if(roomCode&&!document.hidden)schedulePoll(2500);},delay);}
function startPolling(){if(pollTimer)clearTimeout(pollTimer);schedulePoll(1500);}
document.addEventListener("visibilitychange",function(){if(document.hidden){if(pollTimer)clearTimeout(pollTimer);pollTimer=null;}else if(roomCode){refresh().finally(function(){schedulePoll(500);});}});
async function stop(){if(actionPending)return;if(pollTimer)clearTimeout(pollTimer);pollTimer=null;var code=roomCode;try{if(code)await post("/api/bunker/rooms/"+code+"/leave",{});}catch(e){}localStorage.removeItem("bunkerOnlineRoom");roomCode="";room=null;lastRenderedSnapshot="";showSection("home");}
window.addEventListener("pagehide",function(){if(pollTimer)clearTimeout(pollTimer);pollTimer=null;});
$("createRoom").onclick=createRoom;$("joinRoom").onclick=joinRoom;$("copyInvite").onclick=copyCode;$("readyBtn").onclick=ready;$("startBtn").onclick=function(){$("setupPanel").scrollIntoView({behavior:"smooth",block:"center"});};
$("confirmStart").onclick=startGame;$("leaveBtn").onclick=stop;$("backLobby").onclick=stop;
$("sendChat").onclick=function(){var input=$("chatInput"),v=input.value.trim();if(!v)return;sendAction({type:"chat",message:v},$("sendChat")).then(function(ok){if(ok&&input.value===v)input.value="";});};$("chatInput").addEventListener("keydown",function(e){if(e.key==="Enter")$("sendChat").click();});
$("eventBtn").onclick=function(){sendAction({type:"event"},$("eventBtn"));};$("voteStartBtn").onclick=function(){sendAction({type:"vote_start"},$("voteStartBtn"));};$("resolveVoteBtn").onclick=function(){sendAction({type:"resolve_vote"},$("resolveVoteBtn"));};
api("/api/me").then(async function(r){if(!r.user){showAuth();return;}var saved=localStorage.getItem("bunkerOnlineRoom");if(saved){try{var active=await api("/api/bunker/rooms/"+encodeURIComponent(saved));roomCode=saved;setRoom(active.room);startPolling();}catch(e){localStorage.removeItem("bunkerOnlineRoom");toast("Предыдущая комната больше недоступна.");}}}).catch(function(){showAuth();});
})();
