const KEY_INTERACT = 0x45; // E
const KEY_SWING = 0x01; // LMB
const CHARGE_TIME = 1200;
const SCORE_DISPLAY_TIME = 4000;
const HIT_TIMEOUT = 2500;

const state = {
    insideZone: false,
    active: false,
    awaitingHit: false,
    chargeStart: null,
    chargeProgress: 0,
    deadline: 0,
    lastScoreUpdate: 0,
    score: [0, 0],
    courtName: '',
    lastMessage: null,
    messageUntil: 0
};

if (mp.attachmentMngr) {
    mp.attachmentMngr.register('tennis_racket', 'prop_tennis_rack_01', 57005,
        new mp.Vector3(0.12, 0.02, 0.0), new mp.Vector3(-90.0, 0.0, 0.0));
}

function canUseKey() {
    if (mp.gui.cursor.visible) return false;
    if (mp.chat && typeof mp.chat.active !== 'undefined' && mp.chat.active) return false;
    return true;
}

function setPrompt(show, name) {
    state.insideZone = show;
    state.courtName = name || '';
    if (show) {
        const label = name ? `Нажмите <span>E</span>, чтобы начать тренировку (${name})` : 'Нажмите <span>E</span>, чтобы начать тренировку';
        if (mp.prompt && typeof mp.prompt.show === 'function') mp.prompt.show(label);
        else mp.events.call('prompt.show', label);
    } else {
        if (mp.prompt && typeof mp.prompt.hide === 'function') mp.prompt.hide();
        else mp.events.call('prompt.hide');
    }
}

function sendHit(power) {
    if (!state.active || !state.awaitingHit) return;
    mp.events.callRemote('tennis.hit', power);
}

mp.keys.bind(KEY_INTERACT, true, () => {
    if (!state.insideZone || state.active) return;
    if (!canUseKey()) return;
    mp.events.callRemote('tennis.startNpc');
});

mp.keys.bind(KEY_SWING, true, () => {
    if (!state.active || !state.awaitingHit) return;
    if (!canUseKey()) return;
    if (state.chargeStart !== null) return;
    state.chargeStart = Date.now();
    state.chargeProgress = 0;
});

mp.keys.bind(KEY_SWING, false, () => {
    if (!state.active || state.chargeStart === null) return;
    const elapsed = Date.now() - state.chargeStart;
    state.chargeStart = null;
    state.chargeProgress = 0;
    const power = Math.max(0, Math.min(elapsed / CHARGE_TIME, 1));
    sendHit(power);
});

mp.events.add('tennis:showPrompt', (show, name) => {
    if (state.active) return;
    setPrompt(show, name);
});

mp.events.add('tennis:matchStart', (courtName) => {
    state.active = true;
    state.awaitingHit = false;
    state.chargeStart = null;
    state.chargeProgress = 0;
    state.score = [0, 0];
    state.courtName = courtName || state.courtName;
    state.lastMessage = 'Матч начался!';
    state.messageUntil = Date.now() + SCORE_DISPLAY_TIME;
    if (mp.prompt && typeof mp.prompt.hide === 'function') mp.prompt.hide();
    else mp.events.call('prompt.hide');
    mp.gui.chat.push('~y~Теннис~w~: Матч начался. Держите ЛКМ, чтобы зарядить удар.');
});

mp.events.add('tennis:matchEnd', (playerWon, reason) => {
    const text = reason || (playerWon ? 'Вы выиграли тренировку.' : 'Тренировка завершена.');
    mp.gui.chat.push(`~y~Теннис~w~: ${text}`);
    state.active = false;
    state.awaitingHit = false;
    state.chargeStart = null;
    state.chargeProgress = 0;
    state.deadline = 0;
    state.lastMessage = text;
    state.messageUntil = Date.now() + SCORE_DISPLAY_TIME;
    if (state.insideZone) setPrompt(true, state.courtName);
});

mp.events.add('tennis:awaitHit', (deadline) => {
    if (!state.active) return;
    if (deadline > 0) {
        state.awaitingHit = true;
        state.deadline = deadline;
        state.lastMessage = 'Зажмите ЛКМ, чтобы замахнуться.';
        state.messageUntil = Date.now() + SCORE_DISPLAY_TIME;
    } else {
        state.awaitingHit = false;
        state.deadline = 0;
    }
});

mp.events.add('tennis:score', (playerScore, npcScore) => {
    state.score = [playerScore, npcScore];
    state.lastScoreUpdate = Date.now();
});

mp.events.add('tennis:message', (text) => {
    state.lastMessage = text;
    state.messageUntil = Date.now() + SCORE_DISPLAY_TIME;
});

mp.events.add('render', () => {
    if (state.chargeStart !== null) {
        const elapsed = Date.now() - state.chargeStart;
        state.chargeProgress = Math.max(0, Math.min(elapsed / CHARGE_TIME, 1));
    }

    if (!state.active) return;

    const resolution = mp.game.graphics.getScreenResolution(0, 0);
    const scaleX = resolution.x / 1920;
    const scaleY = resolution.y / 1080;

    const drawText = (text, x, y, scale, colour = [255, 255, 255, 210]) => {
        mp.game.graphics.drawText(text, [x, y], {
            font: 4,
            colour,
            scale: [scale * scaleX, scale * scaleY],
            outline: true,
            centre: true
        });
    };

    const now = Date.now();
    const scoreText = `Счёт ${state.score[0]} : ${state.score[1]}`;
    drawText(scoreText, 0.5, 0.82, 0.7);

    if (state.lastMessage && now < state.messageUntil) {
        drawText(state.lastMessage, 0.5, 0.86, 0.5, [255, 230, 150, 210]);
    }

    if (state.awaitingHit) {
        const hint = state.chargeStart === null ? 'Зажмите ЛКМ, чтобы выполнить удар' : 'Отпустите ЛКМ, чтобы отправить мяч';
        drawText(hint, 0.5, 0.9, 0.45, [200, 255, 200, 210]);
    }

    if (state.chargeStart !== null) {
        const width = 0.16;
        const height = 0.014;
        const x = 0.5;
        const y = 0.93;
        const progress = state.chargeProgress;
        mp.game.graphics.drawRect(x, y, width, height, 0, 0, 0, 120);
        mp.game.graphics.drawRect(x - width / 2 + progress * width / 2, y, progress * width, height * 0.7, 110, 200, 110, 210);
    }

    if (state.awaitingHit && state.deadline > 0) {
        const remaining = Math.max(0, state.deadline - now);
        const ratio = Math.min(1, remaining / HIT_TIMEOUT);
        const width = 0.12;
        const height = 0.01;
        const x = 0.5;
        const y = 0.95;
        mp.game.graphics.drawRect(x, y, width, height, 0, 0, 0, 120);
        mp.game.graphics.drawRect(x - width / 2 + ratio * width / 2, y, ratio * width, height * 0.7, 220, 120, 120, 210);
    }
});
