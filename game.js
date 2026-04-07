/* ============================================================
   PUZZLE GAME — Яндекс Игры (Единый файл)
   ============================================================ */

const CONFIG = {
    imageFolder: 'images/',
    imageExtension: '.jpg',
    forceTotalLevels: 0, // 0 = автопоиск, >0 = фиксированное число
    // Прогрессия: каждые 20 уровней меняется сетка. Последняя ступень = максимум.
    difficultyStages: [
        { count: 2, grid: [3, 3] }, // Уровни 1-20
        { count: 2, grid: [4, 3] }, // Уровни 21-40
        { count: 2, grid: [4, 4] }, // Уровни 41-60
        { count: 2, grid: [5, 4] }  // Уровни 61-80 и далее (кап сложности)
    ],
    boardMaxWidth: 500,
    boardMaxHeight: 750,
};

const state = {
    currentLevel: 1,
    totalLevels: 0,
    rows: 0,
    cols: 0,
    moves: 0,
    timerSeconds: 0,
    timerInterval: null,
    soundEnabled: true,
    completedLevels: new Set(),
    pieces: [],
    dragState: null,
    imageLoaded: false,
    imageSrc: '',
    pieceWidth: 0,
    pieceHeight: 0,
    boardEl: null,
};

let ysdk = null;
let player = null;
let audioCtx = null;

/* ======================== YANDEX SDK / LOCAL STORAGE ======================== */
async function initYandexSDK() {
    try {
        if (window.YaGames) {
            ysdk = await YaGames.init();
            try { player = await ysdk.getPlayer({ scopes: false }); } catch (e) {}
        }
    } catch (e) {
        console.log('Yandex SDK недоступен (локальный режим)');
    }
}

async function loadProgress() {
    // Всегда читаем локально
    const local = JSON.parse(localStorage.getItem('puzzle_save') || '{}');
    if (local.completedLevels) state.completedLevels = new Set(local.completedLevels);
    if (local.soundEnabled !== undefined) state.soundEnabled = local.soundEnabled;

    // Пытаемся подтянуть облако
    if (player) {
        try {
            const cloud = await player.getData();
            if (cloud.completedLevels) state.completedLevels = new Set(cloud.completedLevels);
        } catch (e) {}
    }
}

async function saveProgress() {
    const data = {
        completedLevels: Array.from(state.completedLevels),
        soundEnabled: state.soundEnabled
    };
    localStorage.setItem('puzzle_save', JSON.stringify(data));
    if (player) {
        try { await player.setData(data); } catch (e) {}
    }
}

/* ======================== AUDIO ======================== */
function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(type) {
    if (!state.soundEnabled) return;
    ensureAudio();
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    switch (type) {
        case 'pickup':
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
            break;
        case 'drop':
            osc.frequency.setValueAtTime(400, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.start(now); osc.stop(now + 0.08);
            break;
        case 'swap':
            osc.frequency.setValueAtTime(500, now);
            osc.frequency.exponentialRampToValueAtTime(700, now + 0.12);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.start(now); osc.stop(now + 0.12);
            break;
        case 'win':
            osc.type = 'sine';
            [523, 659, 784, 1047].forEach((f, i) => osc.frequency.setValueAtTime(f, now + i * 0.12));
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
            osc.start(now); osc.stop(now + 0.6);
            break;
        default:
            osc.frequency.setValueAtTime(800, now);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            osc.start(now); osc.stop(now + 0.05);
    }
}

/* ======================== UI HELPERS ======================== */
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    if (id) document.getElementById(id).classList.remove('hidden');
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 2000);
}

function getDifficulty(level) {
    let levelOffset = 0;
    for (const stage of CONFIG.difficultyStages) {
        if (level <= levelOffset + stage.count) {
            return stage.grid; // Возвращаем [rows, cols] текущей ступени
        }
        levelOffset += stage.count;
    }
    // Если уровень больше 80, возвращаем последнюю сетку (5×4)
    return CONFIG.difficultyStages[CONFIG.difficultyStages.length - 1].grid;
}

function renderLevelsGrid() {
    const grid = document.getElementById('levels-grid');
    grid.innerHTML = '';
    for (let i = 1; i <= state.totalLevels; i++) {
        const btn = document.createElement('button');
        btn.className = 'level-btn' + (state.completedLevels.has(i) ? ' completed' : '');
        const d = getDifficulty(i);
        btn.innerHTML = `<span>${i}</span><span class="level-grid-info">${d[0]}×${d[1]}</span>`;
        btn.onclick = () => { playSound('click'); startLevel(i); };
        grid.appendChild(btn);
    }
}

/* ======================== LEVEL DETECTION & DEMO ======================== */
async function detectTotalLevels() {
    if (CONFIG.forceTotalLevels > 0) return CONFIG.forceTotalLevels;
    let count = 0;
    for (let i = 1; i <= 15; i++) {
        const ok = await new Promise(res => {
            const img = new Image();
            const t = setTimeout(() => res(false), 300);
            img.onload = () => { clearTimeout(t); res(true); };
            img.onerror = () => { clearTimeout(t); res(false); };
            img.src = `${CONFIG.imageFolder}${i}${CONFIG.imageExtension}?v=${Date.now()}`;
        });
        if (ok) count = i; else break;
    }
    return count;
}

function createDemoImage() {
    const c = document.createElement('canvas'); c.width = 400; c.height = 400;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0,0,400,400);
    g.addColorStop(0,'#667eea'); g.addColorStop(1,'#764ba2');
    ctx.fillStyle = g; ctx.fillRect(0,0,400,400);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 32px Arial'; ctx.textAlign = 'center';
    ctx.fillText('🧩 ДЕМО', 200, 160);
    ctx.font = '14px Arial';
    ctx.fillText('Добавьте файлы images/1.png и т.д.', 200, 200);
    ctx.fillText('и запустите через локальный сервер.', 200, 225);
    const data = c.toDataURL('image/png');
    state.imageSrc = data;
    state.imageLoaded = true;
    state.totalLevels = 1;
    CONFIG.forceTotalLevels = 1;
    return data;
}

/* ======================== CORE: START LEVEL ======================== */
async function startLevel(level) {
    state.currentLevel = level;
    const diff = getDifficulty(level);
    state.rows = diff[0];
    state.cols = diff[1];
    state.moves = 0;
    state.timerSeconds = 0;
    state.pieces = [];
    clearInterval(state.timerInterval);

    // Показываем загрузку
    document.getElementById('loading-screen').classList.remove('hidden');
    showScreen(null);

    const src = `${CONFIG.imageFolder}${level}${CONFIG.imageExtension}`;
    state.imageSrc = src;

    try {
        const img = await loadImage(src);
        state.imageLoaded = true;
    } catch (e) {
        console.warn('Картинка не найдена/заблокирована. Демо-режим.');
        createDemoImage();
    }

    document.getElementById('loading-screen').classList.add('hidden');
    showScreen('game-screen');

    document.getElementById('level-title').textContent = `Ур. ${level} (${state.rows}×${state.cols})`;
    updateMoveCounter();
    resetTimerDisplay();

    document.getElementById('preview-img').src = state.imageSrc;
    document.getElementById('hint-img').src = state.imageSrc;

    // Если демо-режим, создаём Image из dataURL
    let imgObj;
    if (state.imageSrc.startsWith('data:')) {
        imgObj = new Image(); imgObj.src = state.imageSrc;
    } else {
        imgObj = new Image(); imgObj.src = state.imageSrc;
        await new Promise(r => imgObj.onload = r);
    }

    buildBoard(imgObj);
    shufflePieces();
    startTimer();
}

function loadImage(src) {
    return new Promise((res, rej) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('Не удалось загрузить ' + src));
        img.src = src;
    });
}

/* ======================== BOARD & PIECES ======================== */
function buildBoard(img) {
    const board = document.getElementById('puzzle-board');
    board.innerHTML = '';
    state.boardEl = board;

    const maxW = Math.min(CONFIG.boardMaxWidth, window.innerWidth * 0.85);
    const maxH = Math.min(CONFIG.boardMaxHeight, window.innerHeight * 0.55);
    const aspect = img.naturalWidth / img.naturalHeight;
    const boardW = maxW / maxH > aspect ? maxH * aspect : maxW;
    const boardH = boardW / aspect;

    state.pieceWidth = boardW / state.cols;
    state.pieceHeight = boardH / state.rows;

    board.style.gridTemplateColumns = `repeat(${state.cols}, ${state.pieceWidth}px)`;
    board.style.gridTemplateRows = `repeat(${state.rows}, ${state.pieceHeight}px)`;
    board.style.width = `${boardW}px`;
    board.style.height = `${boardH}px`;

    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            const p = document.createElement('div');
            p.className = 'puzzle-piece';
            p.style.backgroundImage = `url(${state.imageSrc})`;
            p.style.backgroundSize = `${boardW}px ${boardH}px`;
            p.style.backgroundPosition = `-${c * state.pieceWidth}px -${r * state.pieceHeight}px`;
            p.dataset.r = r; p.dataset.c = c;
            p.addEventListener('pointerdown', onPointerDown);
            p.addEventListener('contextmenu', e => e.preventDefault());
            board.appendChild(p);
            state.pieces.push({ el: p, correctRow: r, correctCol: c, currentRow: r, currentCol: c });
        }
    }
}

function shufflePieces() {
    const pos = state.pieces.map(p => ({ r: p.currentRow, c: p.currentCol }));
    for (let i = pos.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pos[i], pos[j]] = [pos[j], pos[i]];
    }
    // Проверка на случайную победу
    if (pos.every((p, i) => p.r === state.pieces[i].correctRow && p.c === state.pieces[i].correctCol)) {
        [pos[0], pos[1]] = [pos[1], pos[0]];
    }
    state.pieces.forEach((p, i) => {
        p.currentRow = pos[i].r; p.currentCol = pos[i].c;
        placePiece(p);
    });
}

function placePiece(p) {
    p.el.style.gridRow = p.currentRow + 1;
    p.el.style.gridColumn = p.currentCol + 1;
    p.el.classList.toggle('correct', p.currentRow === p.correctRow && p.currentCol === p.correctCol);
    p.el.classList.toggle('wrong', !(p.currentRow === p.correctRow && p.currentCol === p.correctCol));
}

/* ======================== DRAG & DROP ======================== */
function onPointerDown(e) {
    e.preventDefault();
    const el = e.currentTarget;
    const piece = state.pieces.find(p => p.el === el);
    if (!piece) return;
    playSound('pickup');
    el.classList.add('dragging');
    state.dragState = { piece, startX: e.clientX, startY: e.clientY, overEl: null };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
    if (!state.dragState) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.puzzle-piece');
    if (state.dragState.overEl !== el) {
        if (state.dragState.overEl) state.dragState.overEl.style.outline = '';
        if (el && el !== state.dragState.piece.el) {
            el.style.outline = '3px solid #ffd700';
            state.dragState.overEl = el;
        } else {
            state.dragState.overEl = null;
        }
    }
}

function onPointerUp(e) {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    const { piece, overEl } = state.dragState;
    piece.el.classList.remove('dragging');
    if (overEl) overEl.style.outline = '';

    const target = state.pieces.find(p => p.el === overEl);
    if (target && target !== piece) {
        [piece.currentRow, target.currentRow] = [target.currentRow, piece.currentRow];
        [piece.currentCol, target.currentCol] = [target.currentCol, piece.currentCol];
        placePiece(piece); placePiece(target);
        state.moves++; updateMoveCounter();
        playSound('swap');
        if (piece.currentRow === piece.correctRow && piece.currentCol === piece.correctCol) playSound('pickup');
        checkWin();
    } else {
        playSound('drop');
    }
    state.dragState = null;
}

/* ======================== WIN & TIMER ======================== */
function checkWin() {
    if (state.pieces.every(p => p.currentRow === p.correctRow && p.currentCol === p.correctCol)) {
        clearInterval(state.timerInterval);
        state.completedLevels.add(state.currentLevel);
        saveProgress();
        setTimeout(() => {
            playSound('win');
            showWinScreen();
            launchConfetti();
        }, 200);
    }
}

function showWinScreen() {
    const stars = state.moves <= state.rows * state.cols * 1.5 ? '⭐⭐⭐' : state.moves <= state.rows * state.cols * 2.5 ? '⭐⭐' : '⭐';
    document.getElementById('win-moves').textContent = state.moves;
    document.getElementById('win-time').textContent = formatTime(state.timerSeconds);
    document.getElementById('win-stars').textContent = stars;

    const nextBtn = document.getElementById('btn-next-level');
    if (state.currentLevel >= state.totalLevels) {
        nextBtn.textContent = '🏆 Все уровни пройдены!';
        nextBtn.onclick = () => { playSound('click'); showScreen('menu-screen'); };
    } else {
        nextBtn.textContent = 'Следующий уровень →';
        nextBtn.onclick = () => { playSound('click'); startLevel(state.currentLevel + 1); };
    }
    showScreen('win-screen');
}

function startTimer() {
    clearInterval(state.timerInterval);
    state.timerSeconds = 0;
    state.timerInterval = setInterval(() => {
        state.timerSeconds++;
        document.getElementById('timer').textContent = '⏱ ' + formatTime(state.timerSeconds);
    }, 1000);
}

function resetTimerDisplay() {
    clearInterval(state.timerInterval);
    state.timerSeconds = 0;
    document.getElementById('timer').textContent = '⏱ 00:00';
}

function formatTime(sec) {
    return `${Math.floor(sec/60).toString().padStart(2,'0')}:${(sec%60).toString().padStart(2,'0')}`;
}

function updateMoveCounter() {
    document.getElementById('move-counter').textContent = `Ходы: ${state.moves}`;
}

function launchConfetti() {
    const colors = ['#ffd700','#ff6b6b','#4ecdc4','#45b7d1','#96c93d','#ff9ff3','#fff'];
    for (let i = 0; i < 50; i++) {
        const c = document.createElement('div');
        c.className = 'confetti-piece';
        c.style.cssText = `left:${Math.random()*100}vw; background:${colors[i%colors.length]}; width:${Math.random()*8+6}px; height:${Math.random()*8+6}px; animation-duration:${Math.random()*2+2}s; animation-delay:${Math.random()}s;`;
        document.body.appendChild(c);
        setTimeout(() => c.remove(), 5000);
    }
}

function showHint() {
    const o = document.getElementById('hint-overlay');
    o.classList.remove('hidden');
    const hide = () => { o.classList.add('hidden'); o.removeEventListener('pointerup', hide); };
    o.addEventListener('pointerup', hide);
}

/* ======================== EVENT LISTENERS ======================== */
function setupUI() {
    document.getElementById('btn-play').onclick = () => {
        playSound('click');
        const next = Array.from({length: state.totalLevels}, (_, i) => i + 1).find(l => !state.completedLevels.has(l)) || 1;
        startLevel(next);
    };
    document.getElementById('btn-levels').onclick = () => { playSound('click'); renderLevelsGrid(); showScreen('levels-screen'); };
    document.getElementById('btn-back-menu').onclick = () => { playSound('click'); showScreen('menu-screen'); };
    document.getElementById('btn-back').onclick = () => { playSound('click'); clearInterval(state.timerInterval); showScreen('menu-screen'); };
    document.getElementById('btn-hint').onclick = () => { playSound('click'); showHint(); };
    document.getElementById('btn-shuffle').onclick = () => { playSound('click'); shufflePieces(); state.moves = 0; updateMoveCounter(); resetTimerDisplay(); startTimer(); showToast('Перемешано!'); };
    document.getElementById('btn-sound').onclick = () => { state.soundEnabled = !state.soundEnabled; document.getElementById('btn-sound').textContent = state.soundEnabled ? '🔊' : '🔇'; saveProgress(); };
    document.getElementById('btn-win-menu').onclick = () => { playSound('click'); showScreen('menu-screen'); };
}

/* ======================== INIT ======================== */
async function init() {
    console.log('🚀 Инициализация...');
    document.getElementById('loading-screen').classList.add('hidden'); // Скрываем сразу на всякий случай

    await initYandexSDK();
    await loadProgress();
    document.getElementById('btn-sound').textContent = state.soundEnabled ? '🔊' : '🔇';

    state.totalLevels = await detectTotalLevels();
    if (state.totalLevels === 0) createDemoImage();

    setupUI();
    showScreen('menu-screen');
    console.log('✅ Игра готова. Уровней:', state.totalLevels);
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', () => {
    if (state.imageLoaded && !document.getElementById('game-screen').classList.contains('hidden')) {
        const img = new Image(); img.src = state.imageSrc;
        img.onload = () => buildBoard(img);
    }
});