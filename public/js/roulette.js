"use strict";
/* global App, formatCOP, showToast, escapeHtml */

(function () {
  const WHEEL_NUMBERS = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
  const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const CHIP_VALUES = [200,500,1000,2000,5000,10000,25000,50000,100000];
  const CHIP_COLORS = {
    200:{bg:"#64748b",border:"#94a3b8",text:"#fff"}, 500:{bg:"#ef4444",border:"#fca5a5",text:"#fff"},
    1000:{bg:"#3b82f6",border:"#93c5fd",text:"#fff"}, 2000:{bg:"#8b5cf6",border:"#c4b5fd",text:"#fff"},
    5000:{bg:"#f59e0b",border:"#fcd34d",text:"#000"}, 10000:{bg:"#10b981",border:"#6ee7b7",text:"#fff"},
    25000:{bg:"#ec4899",border:"#f9a8d4",text:"#fff"}, 50000:{bg:"#f97316",border:"#fdba74",text:"#fff"},
    100000:{bg:"#1a1a1a",border:"#d97706",text:"#d97706"},
  };
  const ROWS = [[3,6,9,12,15,18,21,24,27,30,33,36],[2,5,8,11,14,17,20,23,26,29,32,35],[1,4,7,10,13,16,19,22,25,28,31,34]];
  const ROWH = 44, COLS = 12;
  const DEG = 360 / WHEEL_NUMBERS.length;

  let selectedChip = 1000;
  let myBets = [];          // apuestas propias visibles localmente (espejo de lo confirmado por el server)
  let lastResult = null;
  let isSpinning = false;
  let baseRot = 0, ballBaseRot = 0;
  let socket = null;
  let phase = "waiting";

  function getColor(n) { if (n === 0) return "green"; return RED.has(n) ? "red" : "black"; }

  // ── Bet builders (deben coincidir EXACTO con lib/roulette.js del servidor) ──
  function straightBet(n, amt) { return { id: `straight-${n}`, type: "straight", numbers: [n], amount: amt, label: String(n) }; }
  function splitBet(a, b, amt) { const ns = [a,b].sort((x,y)=>x-y); return { id:`split-${ns[0]}-${ns[1]}`, type:"split", numbers:ns, amount:amt, label:`${ns[0]}/${ns[1]}` }; }
  function cornerBet(nums, amt) { const ns=[...nums].sort((x,y)=>x-y); return { id:`corner-${ns.join("-")}`, type:"corner", numbers:ns, amount:amt, label:ns.join("/") }; }
  function streetBet(nums, amt) { const ns=[...nums].sort((x,y)=>x-y); return { id:`street-${ns.join("-")}`, type:"street", numbers:ns, amount:amt, label:`Calle ${ns[0]}-${ns[2]}` }; }
  function lineBet(nums, amt) { const ns=[...nums].sort((x,y)=>x-y); return { id:`line-${ns.join("-")}`, type:"line", numbers:ns, amount:amt, label:`Línea ${ns[0]}-${ns[5]}` }; }
  function colorBet(c, amt) { const ns=Array.from({length:36},(_,i)=>i+1).filter(n=>getColor(n)===c); return { id:`color-${c}`, type:c, numbers:ns, amount:amt, label:c==="red"?"Rojo":"Negro" }; }
  function dozenBet(d, amt) { const start=(d-1)*12+1; const ns=Array.from({length:12},(_,i)=>start+i); return { id:`dozen-${d}`, type:"dozen", numbers:ns, amount:amt, label:`${start}-${start+11}` }; }
  function columnBet(c, amt) { const ns=[]; for(let r=1;r<=12;r++) ns.push(r*3-(3-c)); return { id:`col-${c}`, type:"column", numbers:ns, amount:amt, label:`Col ${c}` }; }
  function evenOddBet(t, amt) { const ns=Array.from({length:36},(_,i)=>i+1).filter(n=>t==="even"?n%2===0:n%2!==0); return { id:t, type:t, numbers:ns, amount:amt, label:t==="even"?"Par":"Impar" }; }
  function lowHighBet(t, amt) { const ns=t==="low"?Array.from({length:18},(_,i)=>i+1):Array.from({length:18},(_,i)=>i+19); return { id:t, type:t, numbers:ns, amount:amt, label:t==="low"?"1-18":"19-36" }; }

  function findMyBet(id) { return myBets.find((b) => b.id === id); }

  function placeBet(bet) {
    if (phase !== "betting") return;
    socket.emit("roulette:place_bet", bet);
  }

  // ── Render: rueda SVG ──
  function buildWheelSvg() {
    const svg = document.getElementById("wheel-svg");
    let html = `<circle cx="100" cy="100" r="100" fill="#111"/>`;
    WHEEL_NUMBERS.forEach((num, i) => {
      const sa = (i*DEG - DEG/2) * Math.PI/180, ea = ((i+1)*DEG - DEG/2) * Math.PI/180;
      const x1 = 100+98*Math.cos(sa), y1 = 100+98*Math.sin(sa);
      const x2 = 100+98*Math.cos(ea), y2 = 100+98*Math.sin(ea);
      const ma = (sa+ea)/2, tx = 100+78*Math.cos(ma), ty = 100+78*Math.sin(ma);
      const tr = (ma*180/Math.PI) + 90;
      const color = getColor(num);
      const fill = color === "red" ? "#dc2626" : color === "black" ? "#1a1a1a" : "#15803d";
      html += `<path d="M 100 100 L ${x1} ${y1} A 98 98 0 0 1 ${x2} ${y2} Z" fill="${fill}" stroke="#d97706" stroke-width="0.5"/>`;
      html += `<text x="${tx}" y="${ty}" font-size="7" fill="white" text-anchor="middle" dominant-baseline="middle" transform="rotate(${tr}, ${tx}, ${ty})" font-weight="bold">${num}</text>`;
    });
    html += `<circle cx="100" cy="100" r="18" fill="#1a1a1a" stroke="#d97706" stroke-width="2"/><circle cx="100" cy="100" r="10" fill="#d97706"/><circle cx="100" cy="100" r="4" fill="#0a0a0f"/>`;
    svg.innerHTML = html;
  }

  function animateSpin(result) {
    isSpinning = true;
    document.getElementById("wheel-result").classList.add("hidden");
    const spins = 6 + Math.floor(Math.random()*3);
    const target = baseRot + spins*360 + result.idx*DEG;
    baseRot = target;
    document.getElementById("wheel-spin").style.transform = `rotate(${target}deg)`;

    const desiredMod = (((result.idx*DEG + target) % 360) + 360) % 360;
    const ballSpins = 7 + Math.floor(Math.random()*3);
    let newBallRot = ballBaseRot - ballSpins*360;
    const currentMod = ((newBallRot % 360) + 360) % 360;
    newBallRot += (desiredMod - currentMod);
    ballBaseRot = newBallRot;
    document.getElementById("ball-spin").style.transform = `rotate(${newBallRot}deg)`;

    setTimeout(() => {
      isSpinning = false;
      lastResult = result;
      const wr = document.getElementById("wheel-result");
      const color = getColor(result.number);
      wr.innerHTML = `<div class="wr-circle wr-${color}">${result.number}</div>`;
      wr.classList.remove("hidden");
    }, 5800);
  }

  // ── Render: tablero de apuestas ──
  function buildBettingBoard() {
    const board = document.getElementById("betting-board");
    const splitsH = [], splitsV = [], corners = [], streets = [], lines = [];
    for (let r=0;r<3;r++) for (let c=0;c<COLS-1;c++) splitsH.push({ r, c, a: ROWS[r][c], b: ROWS[r][c+1] });
    for (let c=0;c<COLS;c++) for (let r=0;r<2;r++) splitsV.push({ r, c, a: ROWS[r][c], b: ROWS[r+1][c] });
    for (let r=0;r<2;r++) for (let c=0;c<COLS-1;c++) corners.push({ r, c, nums:[ROWS[r][c],ROWS[r][c+1],ROWS[r+1][c],ROWS[r+1][c+1]] });
    for (let c=0;c<COLS;c++) streets.push({ c, nums:[ROWS[0][c],ROWS[1][c],ROWS[2][c]] });
    for (let c=0;c<COLS-1;c++) lines.push({ c, nums:[ROWS[0][c],ROWS[1][c],ROWS[2][c],ROWS[0][c+1],ROWS[1][c+1],ROWS[2][c+1]] });

    const colPct = (c) => ((c+1)/COLS)*100;
    const colMidPct = (c) => ((c+0.5)/COLS)*100;

    let html = `<p class="bb-caption">Pleno · Medio · Esquina · Calle · Línea</p>`;
    html += `<div class="bb-zero-row">`;
    html += `<button class="bb-zero-btn" data-bet-id="straight-0" style="height:${ROWH*3}px" data-action="straight" data-n="0">0</button>`;
    html += `<div class="bb-grid-wrap" style="height:${ROWH*3}px">`;
    html += `<div class="bb-grid">`;
    ROWS.forEach((row) => row.forEach((n) => {
      const color = getColor(n);
      html += `<button class="bb-num-cell ${color}" data-bet-id="straight-${n}" data-action="straight" data-n="${n}">${n}</button>`;
    }));
    html += `</div>`; // bb-grid

    splitsH.forEach(({r,c,a,b}) => {
      const id = `split-${Math.min(a,b)}-${Math.max(a,b)}`;
      html += `<button class="bb-hotspot" style="left:${colPct(c)}%; top:${r*ROWH+ROWH/2}px; width:16px; height:30px;" data-bet-id="${id}" data-action="split" data-a="${a}" data-b="${b}" title="Medio ${a}/${b}"><span class="bb-hotspot-line"></span></button>`;
    });
    splitsV.forEach(({r,c,a,b}) => {
      const id = `split-${Math.min(a,b)}-${Math.max(a,b)}`;
      html += `<button class="bb-hotspot" style="left:${colMidPct(c)}%; top:${(r+1)*ROWH}px; width:30px; height:16px;" data-bet-id="${id}" data-action="split" data-a="${a}" data-b="${b}" title="Medio ${a}/${b}"><span class="bb-hotspot-line" style="width:66%;height:4px;"></span></button>`;
    });
    corners.forEach(({r,c,nums}) => {
      const id = `corner-${[...nums].sort((x,y)=>x-y).join("-")}`;
      html += `<button class="bb-hotspot circle" style="left:${colPct(c)}%; top:${(r+1)*ROWH}px; width:20px; height:20px;" data-bet-id="${id}" data-action="corner" data-nums="${nums.join(",")}" title="Esquina ${nums.join('/')}"><span class="bb-hotspot-dot"></span></button>`;
    });
    html += `</div>`; // bb-grid-wrap
    html += `</div>`; // bb-zero-row

    html += `<p class="bb-hint-label">↓ Calle (3 números)</p><div class="bb-street-row" style="margin-left:52px">`;
    streets.forEach(({c,nums}) => {
      const id = `street-${[...nums].sort((x,y)=>x-y).join("-")}`;
      html += `<button class="bb-street-btn" data-bet-id="${id}" data-action="street" data-nums="${nums.join(",")}" title="Calle ${nums.join('-')}"></button>`;
    });
    html += `</div>`;

    html += `<p class="bb-hint-label">↓ Línea (6 números)</p><div class="bb-line-row" style="margin-left:52px">`;
    lines.forEach(({c,nums}) => {
      const id = `line-${[...nums].sort((x,y)=>x-y).join("-")}`;
      html += `<button class="bb-line-btn" style="left:${colPct(c)}%; top:50%;" data-bet-id="${id}" data-action="line" data-nums="${nums.join(",")}" title="Línea ${nums.join(',')}"></button>`;
    });
    html += `</div>`;

    html += `<div class="bb-outside-row" style="margin-left:52px">`;
    [1,2,3].forEach((col) => { html += `<button class="bb-outside-btn" data-bet-id="col-${col}" data-action="column" data-c="${col}">2:1<small>Col ${col}</small></button>`; });
    html += `</div>`;
    html += `<div class="bb-outside-row" style="margin-left:52px">`;
    [1,2,3].forEach((d) => { html += `<button class="bb-outside-btn" data-bet-id="dozen-${d}" data-action="dozen" data-d="${d}">${(d-1)*12+1}-${d*12}<small>Docena</small></button>`; });
    html += `</div>`;
    html += `<div class="bb-outside-row" style="margin-left:52px">`;
    html += `<button class="bb-outside-btn" data-bet-id="low" data-action="low">1-18</button>`;
    html += `<button class="bb-outside-btn" data-bet-id="even" data-action="even">Par</button>`;
    html += `<button class="bb-outside-btn is-red" data-bet-id="color-red" data-action="color-red">🔴</button>`;
    html += `<button class="bb-outside-btn is-black" data-bet-id="color-black" data-action="color-black">⚫</button>`;
    html += `<button class="bb-outside-btn" data-bet-id="odd" data-action="odd">Impar</button>`;
    html += `<button class="bb-outside-btn" data-bet-id="high" data-action="high">19-36</button>`;
    html += `</div>`;

    html += `<div class="bb-total hidden" id="bb-total"></div>`;
    board.innerHTML = html;

    board.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        let bet;
        if (action === "straight") bet = straightBet(Number(btn.dataset.n), selectedChip);
        else if (action === "split") bet = splitBet(Number(btn.dataset.a), Number(btn.dataset.b), selectedChip);
        else if (action === "corner") bet = cornerBet(btn.dataset.nums.split(",").map(Number), selectedChip);
        else if (action === "street") bet = streetBet(btn.dataset.nums.split(",").map(Number), selectedChip);
        else if (action === "line") bet = lineBet(btn.dataset.nums.split(",").map(Number), selectedChip);
        else if (action === "column") bet = columnBet(Number(btn.dataset.c), selectedChip);
        else if (action === "dozen") bet = dozenBet(Number(btn.dataset.d), selectedChip);
        else if (action === "low" || action === "high") bet = lowHighBet(action, selectedChip);
        else if (action === "even" || action === "odd") bet = evenOddBet(action, selectedChip);
        else if (action === "color-red") bet = colorBet("red", selectedChip);
        else if (action === "color-black") bet = colorBet("black", selectedChip);
        if (bet) placeBet(bet);
      });
    });
  }

  function chipLabel(v) { if (v >= 1000000) return `$${v/1000000}M`; if (v >= 1000) return `$${v/1000}K`; return `$${v}`; }

  function buildChipSelector() {
    const el = document.getElementById("chip-selector");
    el.innerHTML = CHIP_VALUES.map((v) => {
      const c = CHIP_COLORS[v];
      return `<button class="chip-btn ${v===selectedChip?"selected":""}" data-val="${v}" style="background:radial-gradient(circle at 35% 35%, ${c.border}, ${c.bg}); border-color:${c.border}; color:${c.text}">${chipLabel(v)}</button>`;
    }).join("");
    el.querySelectorAll(".chip-btn").forEach((b) => {
      b.addEventListener("click", () => {
        selectedChip = Number(b.dataset.val);
        el.querySelectorAll(".chip-btn").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
        document.getElementById("chip-selected-value").textContent = formatCOP(selectedChip);
      });
    });
    document.getElementById("chip-selected-value").textContent = formatCOP(selectedChip);
    updateChipAffordability();
  }

  function updateChipAffordability() {
    const balance = App.player?.balance ?? 0;
    document.querySelectorAll(".chip-btn").forEach((b) => { b.disabled = Number(b.dataset.val) > balance; });
  }

  function renderHistory(history) {
    document.getElementById("history-dots").innerHTML = history.slice(0,15).map((h) =>
      `<div class="history-dot ${h.color}">${h.number}</div>`
    ).join("");
  }

  function renderBetsOnBoard() {
    document.querySelectorAll("[data-bet-id]").forEach((el) => {
      const bet = findMyBet(el.dataset.betId);
      const existingChip = el.querySelector(".bb-chip-stack");
      if (existingChip) existingChip.remove();
      el.classList.toggle("has-bet", !!bet);
      if (bet) {
        const entries = Object.entries(CHIP_COLORS).reverse();
        const found = entries.find(([v]) => bet.amount >= Number(v));
        const colors = found ? CHIP_COLORS[Number(found[0])] : CHIP_COLORS[200];
        const chip = document.createElement("div");
        chip.className = "bb-chip-stack";
        chip.style.background = colors.bg; chip.style.borderColor = colors.border; chip.style.color = colors.text;
        chip.textContent = bet.amount >= 1000 ? `${Math.round(bet.amount/1000)}k` : bet.amount;
        el.appendChild(chip);
      }
    });

    const total = myBets.reduce((s,b) => s + b.amount, 0);
    const totalEl = document.getElementById("bb-total");
    totalEl.classList.toggle("hidden", total <= 0);
    if (total > 0) totalEl.innerHTML = `Total apostado: <b>${formatCOP(total)}</b>`;

    const summary = document.getElementById("my-bets-summary");
    if (myBets.length > 0) {
      summary.classList.remove("hidden");
      summary.innerHTML = `<div class="mbs-head"><span>Mis apuestas (${myBets.length})</span><span>${formatCOP(total)}</span></div>
        <div class="mbs-chips">${myBets.map((b) => `<div class="mbs-chip"><span>${escapeHtml(b.label)}</span><b>${formatCOP(b.amount)}</b></div>`).join("")}</div>`;
    } else {
      summary.classList.add("hidden");
    }
  }

  function renderControls() {
    const phaseLabels = { waiting: "Esperando ronda...", betting: "⏱ Apostando", spinning: "🎰 ¡Girando!", settled: "Ronda terminada" };
    document.getElementById("roulette-phase-label").textContent = phaseLabels[phase] || phase;

    const startBtn = document.getElementById("btn-start-round");
    startBtn.classList.toggle("hidden", phase === "betting" || phase === "spinning");
    startBtn.disabled = !App.player?.isAdmin;
    startBtn.title = App.player?.isAdmin ? "" : "Solo el administrador puede iniciar la ronda";

    document.getElementById("btn-repeat-bet").classList.toggle("hidden", phase !== "betting");
    document.getElementById("btn-double-bet").classList.toggle("hidden", phase !== "betting");
    document.getElementById("btn-clear-bets").classList.toggle("hidden", phase !== "betting" || myBets.length === 0);

    const board = document.getElementById("betting-board");
    board.classList.toggle("betting-active", phase === "betting");
    document.getElementById("board-scroll").style.opacity = phase === "betting" ? "1" : ".6";
    document.getElementById("board-scroll").style.pointerEvents = phase === "betting" ? "auto" : "none";
    document.getElementById("mobile-bet-hint").classList.toggle("hidden", !(phase === "betting" && window.innerWidth < 640));
  }

  function renderMyBalanceBox() {
    const el = document.getElementById("my-balance-box");
    if (!App.player) return;
    el.innerHTML = `<div class="mb-avatar">${App.player.avatar}</div>
      <div class="mb-name">${escapeHtml(App.player.name)}</div>
      <div class="mb-amount">${formatCOP(App.player.balance)}</div>
      ${App.player.balance < 5000 ? '<div class="mb-low">Saldo bajo — pide recarga al admin</div>' : ""}`;
  }

  function renderSidePlayers() {
    document.getElementById("roulette-players").innerHTML = App.players.map((p) => `
      <div class="pl-row"><span>${p.avatar}</span><span>${escapeHtml(p.name)}</span><span class="pl-balance">${formatCOP(p.balance)}</span></div>
    `).join("");
  }

  function tickCountdown(endsAt) {
    const pill = document.getElementById("countdown-pill");
    if (!endsAt) { pill.classList.add("hidden"); return; }
    pill.classList.remove("hidden");
    function tick() {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      pill.textContent = `⏱ ${remaining}s para apostar`;
      if (remaining > 0 && phase === "betting") requestAnimationFrame(tick);
    }
    tick();
  }

  // ═══════════════════ EVENTOS DE SOCKET ═══════════════════
  function attachSocket(s) {
    socket = s;

    socket.on("roulette:state", (state) => {
      if (!state) return;
      phase = state.phase;
      myBets = (state.bets && state.bets[App.player?.id]) || [];
      renderHistory(state.history || []);
      renderBetsOnBoard();
      renderControls();
      tickCountdown(state.countdownEndsAt);

      if (state.lastResult && state.phase === "settled") {
        showRouletteResultToast(state.lastResult, state.lastPayouts?.[App.player?.id] || []);
      }
    });

    socket.on("roulette:spin", (result) => {
      phase = "spinning";
      renderControls();
      animateSpin(result);
    });

    socket.on("roulette:feed", (entry) => {
      const feed = document.getElementById("roulette-feed");
      const item = document.createElement("div");
      item.className = "feed-item";
      item.innerHTML = `<span>${entry.avatar}</span><span>${escapeHtml(entry.name)}</span><span class="fi-label">${escapeHtml(entry.label)}</span><span class="fi-amount">${formatCOP(entry.amount)}</span>`;
      feed.prepend(item);
      while (feed.children.length > 40) feed.removeChild(feed.lastChild);
    });
  }

  function showRouletteResultToast(result, payouts) {
    const net = payouts.reduce((s,p) => s + p.payout, 0);
    if (net > 0) showToast(`🎉 ¡Ganaste ${formatCOP(net)}!`, "success");
    else if (net < 0) showToast(`Perdiste ${formatCOP(Math.abs(net))}`, "error");
  }

  function onPlayers(players) {
    App.players = players;
    renderSidePlayers();
    renderMyBalanceBox();
    updateChipAffordability();
  }

  function onEnter() {
    buildWheelSvg();
    buildBettingBoard();
    buildChipSelector();
    renderSidePlayers();
    renderMyBalanceBox();
    renderControls();
  }

  document.getElementById("btn-start-round")?.addEventListener("click", () => socket.emit("roulette:start_round"));
  document.getElementById("btn-clear-bets")?.addEventListener("click", () => socket.emit("roulette:clear_bets"));
  document.getElementById("btn-repeat-bet")?.addEventListener("click", () => socket.emit("roulette:repeat_last"));
  document.getElementById("btn-double-bet")?.addEventListener("click", () => socket.emit("roulette:double"));

  window.addEventListener("resize", renderControls);

  window.Roulette = { attachSocket, onPlayers, onEnter };
})();
