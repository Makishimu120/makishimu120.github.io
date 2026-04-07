/* ============================================================
   PUZZLE GAME — Яндекс Игры
   Картинки: images/1.png, images/2.png, ...
   ============================================================ */

const CONFIG = {
    imageFolder: 'images/',
    imageExtension: '.jpg',
    // Сложность по уровням: [rows, cols]
    difficulties: [
        [2, 2],  // Уровень 1: 4 куска
        [3, 3],  // Уровень 2: 9 кусков
        [3, 4],  // Уровень 3: 12 кусков
        [4, 4],  // Уровень 4: 16 кусков
        [4, 5],  // Уровень 5: 20 кусков
        [5, 5],  // Уровень 6: 25 кусков
        [5, 6],  // Уровень 7: 30 кусков
        [6, 6],  // Уровень 8: 36 кусков
        [6, 7],  // Уровень 9: 42 куска
        [7, 7],  // Уровень 10: 49 кусков
        [7, 8],  // Уровень 11: 56 кусков
        [8, 8],  // Уровень 12: 64 куска
    ],
    boardMaxWidth: 500,
    boardMaxHeight: 500,
};

/* ======================== GAME STATE ======================== */
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
    pieces: [],       // { el, correctRow, correctCol, currentRow, currentCol, bgX, bgY }
    dragState: null,  // { piece, startX, startY, startPieceRow, startPieceCol }
    imageLoaded: false,
    imageSrc: '',
    pieceWidth: 0,
    pieceHeight: 0,
    boardEl: null,
    previewImg: null,
    hintImg: null,
};

/* ======================== YANDEX SDK ======================== */
let ysdk = null;
let player = null;

async function initYandexSDK() {
    try {
        ysdk = await YaGames.init();
        console.log('Yandex SDK initialized');

        // Авторизация
        try {
            player = await ysdk.getPlayer({ scopes: false });
        } catch (e) {
            console.log('Player not authorized:', e);
        }

        // Загрузка сохранений
        await loadProgress();
    } catch (e) {
        console.log('Yandex SDK not available:', e);
    }
}

async function loadProgress() {
    if (!player) return;
    try {
        const data = await player.getData();
        if (data.completedLevels) {
            state.completedLevels = new Set(data.completedLevels);
        }
        if (data.soundEnabled !== undefined) {
            state.soundEnabled = data.soundEnabled;
        }
    } catch (e) {
        console.log('Failed to load progress:', e);
    }
}

async function saveProgress() {
    if (!player) return;
    try {
        await player.setData({
            completedLevels: Array.from(state.completedLevels),
            soundEnabled: state.soundEnabled,
        });
    } catch (e) {
        console.log('Failed to save progress:', e);
    }
}

/* ======================== AUDIO ======================== */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function ensureAudio() {
    if (!audioCtx) audioCtx = new AudioCtx();
}

function playSound(type) {
    if (!state.soundEnabled) return;
    ensureAudio();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    switch (type) {
        case 'pickup':
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
            break;

        case 'drop':
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.08);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
            osc.start(now);
            osc.stop(now + 0.08);
            break;

        case 'swap':
            osc.frequency.setValueAtTime(500, now);
            osc.frequency.exponentialRampToValueAtTime(700, now + 0.12);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.start(now);
            osc.stop(now + 0.12);
            break;

        case 'correct':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523, now);
            osc.frequency.setValueAtTime(659, now + 0.1);
            osc.frequency.setValueAtTime(784, now + 0.2);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
            break;

        case 'win':
            osc.type = 'sine';
            const notes = [523, 659, 784, 1047];
            notes.forEach((freq, i) => {
                const t = now + i * 0.15;
                osc.frequency.setValueAtTime(freq, t);
            });
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
            osc.start(now);
            osc.stop(now + 0.7);
            break;

        case 'click':
            osc.frequency.setValueAtTime(800, now);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
            break;
    }
}

/* ======================== SCREENS ======================== */
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const screen = document.getElementById(id);
    if (screen) screen.classList.remove('hidden');
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2000);
}

/* ======================== LEVELS ======================== */
function getDifficulty(level) {
    if (level <= CONFIG.difficulties.length) {
        return CONFIG.difficulties[level - 1];
    }
    // Генерируем сложность для уровней больше заданных
    const base = CONFIG.difficulties[CONFIG.difficulties.length - 1];
    const extra = level - CONFIG.difficulties.length;
    const extraRows = Math.floor(extra / 2);
    const extraCols = extra % 2;
    return [base[0] + extraRows, base[1] + extraCols];
}

function detectTotalLevels() {
    // Считаем, сколько картинок доступно
    // Пробуем загрузить картинки до тех пор, пока не получим ошибку
    return new Promise((resolve) => {
        let count = 0;
        let pending = 0;

        function tryImage(num) {
            const img = new Image();
            img.onload = () => {
                count = Math.max(count, num);
                tryNext(num + 1);
            };
            img.onerror = () => {
                // Проверяем несколько подряд, чтобы убедиться что картинки закончились
                if (pending <= 0 && count > 0) {
                    resolve(count);
                }
            };
            pending++;
            img.src = CONFIG.imageFolder + num + CONFIG.imageExtension;
        }

        function tryNext(num) {
            pending--;
            if (num <= 20) { // максимум 20 уровней
                tryImage(num);
            } else if (pending <= 0) {
                resolve(Math.max(count, 1));
            }
        }

        tryImage(1);
    });
}

function renderLevelsGrid() {
    const grid = document.getElementById('levels-grid');
    grid.innerHTML = '';

    for (let i = 1; i <= state.totalLevels; i++) {
        const btn = document.createElement('button');
        btn.className = 'level-btn';
        const diff = getDifficulty(i);
        btn.innerHTML = `
            <span>${i}</span>
            <span class="level-grid-info">${diff[0]}×${diff[1]}</span>
        `;

        if (state.completedLevels.has(i)) {
            btn.classList.add('completed');
        }

        if (i > 1 && !state.completedLevels.has(i - 1) && !state.completedLevels.has(i)) {
            // Разблокируем все уровни (можно убрать это условие для прогрессии)
            // btn.classList.add('locked');
        }

        btn.addEventListener('click', () => {
            playSound('click');
            startLevel(i);
        });

        grid.appendChild(btn);
    }
}

/* ======================== GAME INIT ======================== */
async function startLevel(level) {
    state.currentLevel = level;
    const diff = getDifficulty(level);
    state.rows = diff[0];
    state.cols = diff[1];
    state.moves = 0;
    state.timerSeconds = 0;
    state.pieces = [];
    state.imageLoaded = false;

    // Показать загрузку
    document.getElementById('loading-screen').classList.remove('hidden');
    showScreen(null);

    // Загрузить картинку
    const imageSrc = `${CONFIG.imageFolder}${level}${CONFIG.imageExtension}`;
    state.imageSrc = imageSrc;

    const img = await loadImage(imageSrc);
    state.imageLoaded = true;

    document.getElementById('loading-screen').classList.add('hidden');
    showScreen('game-screen');

    document.getElementById('level-title').textContent = `Уровень ${level} (${state.rows}×${state.cols})`;
    updateMoveCounter();
    resetTimer();

    // Превью
    document.getElementById('preview-img').src = imageSrc;
    document.getElementById('hint-img').src = imageSrc;

    buildBoard(img);
    shufflePieces();
    startTimer();
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Не удалось загрузить: ${src}`));
        img.src = src;
    });
}

/* ======================== BUILD BOARD ======================== */
function buildBoard(img) {
    const board = document.getElementById('puzzle-board');
    board.innerHTML = '';
    state.boardEl = board;

    // Рассчитать размер доски
    const maxW = Math.min(CONFIG.boardMaxWidth, window.innerWidth * 0.85);
    const maxH = Math.min(CONFIG.boardMaxHeight, window.innerHeight * 0.55);

    const aspectRatio = img.naturalWidth / img.naturalHeight;
    let boardW, boardH;

    if (maxW / maxH > aspectRatio) {
        boardH = maxH;
        boardW = boardH * aspectRatio;
    } else {
        boardW = maxW;
        boardH = boardW / aspectRatio;
    }

    const pieceW = boardW / state.cols;
    const pieceH = boardH / state.rows;

    board.style.gridTemplateColumns = `repeat(${state.cols}, ${pieceW}px)`;
    board.style.gridTemplateRows = `repeat(${state.rows}, ${pieceH}px)`;
    board.style.width = `${boardW}px`;
    board.style.height = `${boardH}px`;

    state.pieceWidth = pieceW;
    state.pieceHeight = pieceH;

    // Создать кусочки
    state.pieces = [];
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            const piece = document.createElement('div');
            piece.className = 'puzzle-piece';
            piece.style.width = `${pieceW}px`;
            piece.style.height = `${pieceH}px`;
            piece.style.backgroundImage = `url(${state.imageSrc})`;
            piece.style.backgroundSize = `${boardW}px ${boardH}px`;
            piece.style.backgroundPosition = `-${c * pieceW}px -${r * pieceH}px`;

            const pieceData = {
                el: piece,
                correctRow: r,
                correctCol: c,
                currentRow: r,
                currentCol: c,
                bgX: -c * pieceW,
                bgY: -r * pieceH,
            };

            piece.dataset.row = r;
            piece.dataset.col = c;

            // Events
            piece.addEventListener('pointerdown', onPointerDown);
            piece.addEventListener('contextmenu', e => e.preventDefault());

            board.appendChild(piece);
            state.pieces.push(pieceData);
        }
    }

    // Показать номер уровня на каждом кусочке (опционально, можно убрать)
    if (state.rows * state.cols <= 20) {
        state.pieces.forEach(p => {
            p.el.style.backgroundSize = `${state.cols * 100}%, ${state.rows * 100}%`;
        });
    }
}

/* ======================== SHUFFLE ======================== */
function shufflePieces() {
    // Перемешиваем позиции кусочков
    const positions = state.pieces.map(p => ({ r: p.currentRow, c: p.currentCol }));

    // Fisher-Yates shuffle позиций
    for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    // Убедиться, что не собралось случайно
    const allCorrect = positions.every((pos, idx) => {
        const p = state.pieces[idx];
        return pos.r === p.correctRow && pos.c === p.correctCol;
    });

    if (allCorrect) {
        // Поменять местами два случайных
        if (positions.length >= 2) {
            [positions[0], positions[1]] = [positions[1], positions[0]];
        }
    }

    // Применить перемешанные позиции
    state.pieces.forEach((piece, idx) => {
        piece.currentRow = positions[idx].r;
        piece.currentCol = positions[idx].c;
        placePiece(piece);
    });
}

function placePiece(piece) {
    piece.el.style.gridRow = piece.currentRow + 1;
    piece.el.style.gridColumn = piece.currentCol + 1;

    // Обновить классы
    piece.el.classList.remove('correct', 'wrong');
    if (piece.currentRow === piece.correctRow && piece.currentCol === piece.correctCol) {
        piece.el.classList.add('correct');
    } else {
        piece.el.classList.add('wrong');
    }
}

/* ======================== DRAG & DROP ======================== */
function onPointerDown(e) {
    e.preventDefault();
    const pieceEl = e.currentTarget;
    const piece = state.pieces.find(p => p.el === pieceEl);
    if (!piece) return;

    playSound('pickup');

    pieceEl.classList.add('dragging');

    state.dragState = {
        piece: piece,
        startX: e.clientX,
        startY: e.clientY,
        startRow: piece.currentRow,
        startCol: piece.currentCol,
        overPiece: null,
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
    if (!state.dragState) return;

    // Найти элемент под курсором
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const pieceEl = el ? el.closest('.puzzle-piece') : null;

    if (state.dragState.overPiece !== pieceEl) {
        // Снять подсветку с предыдущего
        if (state.dragState.overPiece) {
            state.dragState.overPiece.style.outline = '';
        }

        if (pieceEl && pieceEl !== state.dragState.piece.el) {
            pieceEl.style.outline = '3px solid #ffd700';
            state.dragState.overPiece = pieceEl;
        } else {
            state.dragState.overPiece = null;
        }
    }
}

function onPointerUp(e) {
    if (!state.dragState) return;

    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);

    const { piece, overPiece } = state.dragState;
    piece.el.classList.remove('dragging');

    // Снять подсветку
    if (overPiece) {
        overPiece.style.outline = '';
    }

    // Найти кусочек под курсором
    const targetPiece = state.pieces.find(p => p.el === overPiece);

    if (targetPiece && targetPiece !== piece) {
        // Поменять местами
        swapPieces(piece, targetPiece);
        playSound('swap');

        state.moves++;
        updateMoveCounter();

        // Проверить правильность
        if (piece.currentRow === piece.correctRow && piece.currentCol === piece.correctCol) {
            playSound('correct');
        }
        if (targetPiece.currentRow === targetPiece.correctRow && targetPiece.currentCol === targetPiece.correctCol) {
            playSound('correct');
        }

        // Проверить победу
        checkWin();
    } else {
        playSound('drop');
    }

    state.dragState = null;
}

function swapPieces(a, b) {
    // Поменять currentRow/currentCol
    [a.currentRow, b.currentRow] = [b.currentRow, a.currentRow];
    [a.currentCol, b.currentCol] = [b.currentCol, a.currentCol];

    placePiece(a);
    placePiece(b);
}

/* ======================== WIN CHECK ======================== */
function checkWin() {
    const allCorrect = state.pieces.every(p =>
        p.currentRow === p.correctRow && p.currentCol === p.correctCol
    );

    if (allCorrect) {
        clearInterval(state.timerInterval);

        // Убрать подсветку correct/wrong
        state.pieces.forEach(p => {
            p.el.classList.remove('correct', 'wrong');
        });

        // Сохранить прогресс
        state.completedLevels.add(state.currentLevel);
        saveProgress();

        setTimeout(() => {
            playSound('win');
            showWinScreen();
            launchConfetti();
        }, 300);
    }
}

function showWinScreen() {
    const stars = calculateStars();

    document.getElementById('win-moves').textContent = state.moves;
    document.getElementById('win-time').textContent = formatTime(state.timerSeconds);
    document.getElementById('win-stars').textContent = stars;

    const nextBtn = document.getElementById('btn-next-level');
    if (state.currentLevel >= state.totalLevels) {
        nextBtn.textContent = '🏆 Все уровни пройдены!';
        nextBtn.onclick = () => {
            playSound('click');
            showScreen('menu-screen');
        };
    } else {
        nextBtn.textContent = 'Следующий уровень →';
        nextBtn.onclick = () => {
            playSound('click');
            startLevel(state.currentLevel + 1);
        };
    }

    showScreen('win-screen');
}

function calculateStars() {
    const totalPieces = state.rows * state.cols;
    const minMoves = totalPieces; // теоретический минимум

    if (state.moves <= minMoves * 1.5) return '⭐⭐⭐';
    if (state.moves <= minMoves * 2.5) return '⭐⭐';
    return '⭐';
}

/* ======================== TIMER ======================== */
function startTimer() {
    clearInterval(state.timerInterval);
    state.timerSeconds = 0;
    state.timerInterval = setInterval(() => {
        state.timerSeconds++;
        document.getElementById('timer').textContent = formatTime(state.timerSeconds);
    }, 1000);
}

function resetTimer() {
    clearInterval(state.timerInterval);
    state.timerSeconds = 0;
    document.getElementById('timer').textContent = '⏱ 00:00';
}

function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function updateMoveCounter() {
    document.getElementById('move-counter').textContent = `Ходы: ${state.moves}`;
}

/* ======================== CONFETTI ======================== */
function launchConfetti() {
    const colors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96c93d', '#ff9ff3', '#fff'];

    for (let i = 0; i < 60; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + 'vw';
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.width = (Math.random() * 10 + 5) + 'px';
        piece.style.height = (Math.random() * 10 + 5) + 'px';
        piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
        piece.style.animationDuration = (Math.random() * 2 + 2) + 's';
        piece.style.animationDelay = (Math.random() * 1) + 's';
        document.body.appendChild(piece);

        setTimeout(() => piece.remove(), 5000);
    }
}

/* ======================== HINT ======================== */
function showHint() {
    const overlay = document.getElementById('hint-overlay');
    overlay.classList.remove('hidden');

    const hideHint = () => {
        overlay.classList.add('hidden');
        overlay.removeEventListener('pointerup', hideHint);
        overlay.removeEventListener('pointercancel', hideHint);
    };

    overlay.addEventListener('pointerup', hideHint);
    overlay.addEventListener('pointercancel', hideHint);
}

/* ======================== EVENT LISTENERS ======================== */
document.getElementById('btn-play').addEventListener('click', () => {
    playSound('click');
    // Найти первый незавершённый уровень
    let startLevel = 1;
    for (let i = 1; i <= state.totalLevels; i++) {
        if (!state.completedLevels.has(i)) {
            startLevel = i;
            break;
        }
        startLevel = i + 1;
    }
    if (startLevel > state.totalLevels) startLevel = 1;
    startLevel = Math.min(startLevel, state.totalLevels);
    startLevel(startLevel);
});

document.getElementById('btn-levels').addEventListener('click', () => {
    playSound('click');
    renderLevelsGrid();
    showScreen('levels-screen');
});

document.getElementById('btn-back-menu').addEventListener('click', () => {
    playSound('click');
    showScreen('menu-screen');
});

document.getElementById('btn-back').addEventListener('click', () => {
    playSound('click');
    clearInterval(state.timerInterval);
    showScreen('menu-screen');
});

document.getElementById('btn-hint').addEventListener('click', () => {
    playSound('click');
    showHint();
});

document.getElementById('btn-shuffle').addEventListener('click', () => {
    playSound('click');
    shufflePieces();
    state.moves = 0;
    updateMoveCounter();
    resetTimer();
    startTimer();
    showToast('Пазл перемешан заново!');
});

document.getElementById('btn-sound').addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    document.getElementById('btn-sound').textContent = state.soundEnabled ? '🔊' : '🔇';
    if (state.soundEnabled) playSound('click');
    saveProgress();
});

document.getElementById('btn-win-menu').addEventListener('click', () => {
    playSound('click');
    showScreen('menu-screen');
});

/* ======================== INIT ======================== */
async function init() {
    // Инициализация Yandex SDK
    await initYandexSDK();

    // Обновить кнопку звука
    document.getElementById('btn-sound').textContent = state.soundEnabled ? '🔊' : '🔇';

    // Определить количество уровней
    state.totalLevels = await detectTotalLevels();
    console.log(`Найдено ${state.totalLevels} уровней`);

    // Если картинки не найдены, используем демо-данные
    if (state.totalLevels === 0) {
        console.warn('Картинки не найдены! Использую демо-режим.');
        state.totalLevels = 1;
        // Генерируем демо-картинку
        generateDemoImage();
    }

    showScreen('menu-screen');
}

function generateDemoImage() {
    // Создаём canvas-картинку для демо
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    // Градиентный фон
    const grad = ctx.createLinearGradient(0, 0, 400, 400);
    grad.addColorStop(0, '#667eea');
    grad.addColorStop(1, '#764ba2');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 400, 400);

    // Текст
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ПАЗЛ 1', 200, 200);
    ctx.font = '24px Arial';
    ctx.fillText('Добавьте свои картинки', 200, 250);
    ctx.font = '16px Arial';
    ctx.fillText('в папку images/', 200, 280);

    // Рамка
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 360, 360);

    const dataUrl = canvas.toDataURL('image/png');

    // Переопределить loadImage для демо
    const origLoadImage = loadImage;
    window.loadImage = (src) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = dataUrl;
        });
    };

    CONFIG.imageFolder = '';
    CONFIG.imageExtension = '';
    state.imageSrc = dataUrl;
}

// Запуск
window.addEventListener('DOMContentLoaded', init);

// Обработка изменения размера окна
window.addEventListener('resize', () => {
    if (state.imageLoaded && document.getElementById('game-screen').classList.contains('hidden') === false) {
        // Перестроить доску
        loadImage(state.imageSrc).then(img => {
            buildBoard(img);
            // Восстановить позиции
            state.pieces.forEach(p => placePiece(p));
        });
    }
});