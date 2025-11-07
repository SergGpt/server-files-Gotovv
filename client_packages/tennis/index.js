const KEY_INTERACT = 0x45; // E
const KEY_SWING = 0x02; // RMB
const SCORE_DISPLAY_TIME = 4000;
const HIT_TIMEOUT = 2500;

const BALL_MODEL = mp.game.joaat('prop_tennis_ball');

let ballObj = null;
const ballState = {
    active: false,
    start: null,
    end: null,
    apex: 0,
    duration: 1,
    startTime: 0,
    lastPos: null,
    targetSide: null
};

const state = {
    insideZone: false,
    shopZone: false,
    active: false,
    awaitingHit: false,
    deadline: 0,
    lastScoreUpdate: 0,
    score: [0, 0],
    courtName: '',
    lastMessage: null,
    messageUntil: 0,
    zone: {
        active: false,
        position: new mp.Vector3(0, 0, 0),
        radius: 1.6,
        expire: 0
    }
};

function canUseKey() {
    if (mp.gui.cursor.visible) return false;
    if (mp.chat && typeof mp.chat.active !== 'undefined' && mp.chat.active) return false;
    return true;
}

function destroyBall() {
    if (ballObj && mp.objects && typeof mp.objects.exists === 'function' && mp.objects.exists(ballObj)) {
        ballObj.destroy();
    }
    ballObj = null;
    ballState.active = false;
    ballState.start = null;
    ballState.end = null;
    ballState.duration = 1;
    ballState.apex = 0;
    ballState.startTime = 0;
    ballState.lastPos = null;
    ballState.targetSide = null;
}

function ensureBallObject() {
    if (ballObj && mp.objects && typeof mp.objects.exists === 'function' && mp.objects.exists(ballObj)) {
        return ballObj;
    }
    if (!mp.game.streaming.isModelInCdimage(BALL_MODEL)) return null;
    mp.game.streaming.requestModel(BALL_MODEL);
    if (!mp.game.streaming.hasModelLoaded(BALL_MODEL)) return null;
    const player = mp.players.local;
    if (!player || !player.handle) return null;
    ballObj = mp.objects.new(BALL_MODEL, player.position, {
        dimension: player.dimension
    });
    if (ballObj) {
        if (ballState.lastPos) ballObj.position = ballState.lastPos;
        try { ballObj.setCollision(false, false); } catch (e) {}
    }
    return ballObj;
}

function getBallPositionAt(t) {
    if (!ballState.start || !ballState.end) return null;
    const clamped = Math.min(Math.max(t, 0), 1);
    const inv = 1 - clamped;
    const x = ballState.start.x * inv + ballState.end.x * clamped;
    const y = ballState.start.y * inv + ballState.end.y * clamped;
    const baseZ = ballState.start.z * inv + ballState.end.z * clamped;
    const z = baseZ + ballState.apex * Math.sin(Math.PI * clamped);
    return new mp.Vector3(x, y, z);
}

function updateBallFlightRender() {
    if (!ballState.active) {
        if (ballState.lastPos && ballObj && mp.objects && typeof mp.objects.exists === 'function' && mp.objects.exists(ballObj)) {
            ballObj.position = ballState.lastPos;
        }
        return;
    }
    const now = Date.now();
    const duration = Math.max(1, ballState.duration);
    let t = (now - ballState.startTime) / duration;
    if (t >= 1) t = 1;
    const pos = getBallPositionAt(t);
    if (pos) {
        ballState.lastPos = pos;
        const obj = ensureBallObject();
        if (obj && mp.objects && typeof mp.objects.exists === 'function' && mp.objects.exists(obj)) obj.position = pos;
    }
    if (t >= 1) {
        ballState.active = false;
        if (ballState.end) {
            ballState.lastPos = new mp.Vector3(ballState.end.x, ballState.end.y, ballState.end.z);
            if (ballObj && mp.objects && typeof mp.objects.exists === 'function' && mp.objects.exists(ballObj)) ballObj.position = ballState.lastPos;
        }
    }
}

function setPrompt(show, name) {
    state.insideZone = show;
    state.courtName = name || '';
    if (state.shopZone) {
        if (!show) return;
        // если одновременно показывается магазин, приоритет у магазина
        return;
    }
    if (show) {
        const label = name
            ? `Нажмите <span>E</span>, чтобы начать тренировку (${name}). Необходимо держать ракетку в руках.`
            : 'Нажмите <span>E</span>, чтобы начать тренировку. Необходимо держать ракетку в руках.';
        if (mp.prompt && typeof mp.prompt.show === 'function') mp.prompt.show(label);
        else mp.events.call('prompt.show', label);
    } else {
        if (mp.prompt && typeof mp.prompt.hide === 'function') mp.prompt.hide();
        else mp.events.call('prompt.hide');
    }
}

function setShopPrompt(show) {
    state.shopZone = show;
    if (show) {
        const label = 'Нажмите <span>E</span>, чтобы купить теннисное снаряжение';
        if (mp.prompt && typeof mp.prompt.show === 'function') mp.prompt.show(label);
        else mp.events.call('prompt.show', label);
    } else {
        if (state.active) {
            if (mp.prompt && typeof mp.prompt.hide === 'function') mp.prompt.hide();
            else mp.events.call('prompt.hide');
            return;
        }
        if (state.insideZone && state.courtName) {
            setPrompt(true, state.courtName);
        } else {
            if (mp.prompt && typeof mp.prompt.hide === 'function') mp.prompt.hide();
            else mp.events.call('prompt.hide');
        }
    }
}

function sendHit(power) {
    if (!state.active || !state.awaitingHit) return;
    mp.events.callRemote('tennis.hit', power);
}

mp.keys.bind(KEY_INTERACT, true, () => {
    if (!canUseKey()) return;
    if (state.shopZone) {
        mp.events.callRemote('tennis.shop.open');
        return;
    }
    if (!state.insideZone || state.active) return;
    mp.events.callRemote('tennis.startNpc');
});

function playSwingAnim() {
    const player = mp.players.local;
    if (!player || !player.handle) return;
    const dict = 'amb@world_human_tennis_forehand@male@base';
    const anim = 'base';
    if (!mp.game.streaming.hasAnimDictLoaded(dict)) {
        mp.game.streaming.requestAnimDict(dict);
    }
    if (mp.game.streaming.hasAnimDictLoaded(dict)) {
        player.taskPlayAnim(dict, anim, 8.0, -8.0, 600, 0, 0, false, false, false);
    }
}

function attemptHit() {
    if (!state.active || !state.awaitingHit) return;
    if (!canUseKey()) return;
    const zone = state.zone;
    if (!zone.active) return;
    const player = mp.players.local;
    if (!player || !player.position) return;
    const now = Date.now();
    if (zone.expire && now > zone.expire + 150) return;
    const dist = mp.game.gameplay.getDistanceBetweenCoords(
        player.position.x, player.position.y, player.position.z,
        zone.position.x, zone.position.y, zone.position.z,
        true
    );
    if (dist > zone.radius + 0.8) {
        mp.gui.chat.push('~y~Теннис~w~: Подойдите ближе к зоне удара.');
        return;
    }
    const remaining = Math.max(0, state.deadline - now);
    const timeRatio = HIT_TIMEOUT > 0 ? 1 - Math.min(remaining / HIT_TIMEOUT, 1) : 1;
    const distRatio = 1 - Math.min(dist / (zone.radius + 0.5), 1);
    const power = Math.max(0.2, Math.min(timeRatio * 0.6 + distRatio * 0.4, 1));
    playSwingAnim();
    state.awaitingHit = false;
    sendHit(power);
}

mp.keys.bind(KEY_SWING, true, attemptHit);

mp.events.add('tennis:showPrompt', (show, name) => {
    if (state.active) return;
    setPrompt(show, name);
});

mp.events.add('tennis:showShopPrompt', (show) => {
    if (state.active && show) return;
    setShopPrompt(!!show);
});

mp.events.add('tennis:matchStart', (courtName) => {
    state.active = true;
    state.awaitingHit = false;
    state.score = [0, 0];
    state.courtName = courtName || state.courtName;
    state.lastMessage = 'Матч начался!';
    state.messageUntil = Date.now() + SCORE_DISPLAY_TIME;
    setShopPrompt(false);
    if (mp.prompt && typeof mp.prompt.hide === 'function') mp.prompt.hide();
    else mp.events.call('prompt.hide');
    mp.gui.chat.push('~y~Теннис~w~: Матч начался. Отбивайте мячи в отмеченной зоне (ПКМ).');
    state.zone.active = false;
    state.zone.expire = 0;
    if (mp.busy && mp.busy.add) mp.busy.add('tennis', false);
});

mp.events.add('tennis:matchEnd', (playerWon, reason) => {
    const text = reason || (playerWon ? 'Вы выиграли тренировку.' : 'Тренировка завершена.');
    mp.gui.chat.push(`~y~Теннис~w~: ${text}`);
    state.active = false;
    state.awaitingHit = false;
    state.deadline = 0;
    state.lastMessage = text;
    state.messageUntil = Date.now() + SCORE_DISPLAY_TIME;
    destroyBall();
    state.zone.active = false;
    state.zone.expire = 0;
    if (mp.busy && mp.busy.remove) mp.busy.remove('tennis');
    if (state.insideZone) setPrompt(true, state.courtName);
});

mp.events.add('tennis:ballCreate', () => {
    ensureBallObject();
});

mp.events.add('tennis:ballFlight', (sx, sy, sz, ex, ey, ez, duration, apex, targetSide) => {
    ballState.start = { x: sx, y: sy, z: sz };
    ballState.end = { x: ex, y: ey, z: ez };
    ballState.duration = Math.max(200, Number(duration) || 1000);
    ballState.apex = Number(apex) || 0;
    ballState.startTime = Date.now();
    ballState.active = true;
    ballState.targetSide = targetSide;
    const pos = getBallPositionAt(0);
    ballState.lastPos = pos || (ballState.start ? new mp.Vector3(ballState.start.x, ballState.start.y, ballState.start.z) : null);
    if (ballState.lastPos) {
        const obj = ensureBallObject();
        if (obj && mp.objects && typeof mp.objects.exists === 'function' && mp.objects.exists(obj)) obj.position = ballState.lastPos;
    }
    if (targetSide === 'player') {
        state.zone.active = true;
        state.zone.position = new mp.Vector3(ex, ey, ez);
        state.zone.radius = 1.6;
        state.zone.expire = Date.now() + Math.max(Number(duration) || 0, 0) + HIT_TIMEOUT;
    } else if (targetSide === 'npc') {
        state.zone.active = false;
        state.zone.expire = 0;
    }
});

mp.events.add('tennis:ballDestroy', () => {
    destroyBall();
    state.zone.active = false;
    state.zone.expire = 0;
});

mp.events.add('tennis:shopOpen', (itemsJson) => {
    let items;
    try {
        items = JSON.parse(itemsJson);
    } catch (e) {
        return;
    }
    if (!Array.isArray(items)) return;
    const payload = JSON.stringify(items);
    mp.callCEFV(`selectMenu.menus['tennisShop'].items = ${payload};`);
    mp.callCEFV(`selectMenu.menus['tennisShop'].i = 0; selectMenu.menus['tennisShop'].j = 0;`);
    mp.callCEFV(`selectMenu.menu = cloneObj(selectMenu.menus['tennisShop']);`);
    mp.callCEFV(`selectMenu.show = true;`);
});

mp.events.add('tennis:shopClose', () => {
    mp.callCEFV('selectMenu.show = false;');
});

mp.events.add('tennis:awaitHit', (deadline) => {
    if (!state.active) return;
    if (deadline > 0) {
        state.awaitingHit = true;
        state.deadline = deadline;
        state.lastMessage = 'Подойдите в зону и нажмите ПКМ, чтобы выполнить удар.';
        state.messageUntil = Date.now() + SCORE_DISPLAY_TIME;
        if (state.zone.active) state.zone.expire = Math.max(state.zone.expire, deadline);
    } else {
        state.awaitingHit = false;
        state.deadline = 0;
    }
});

mp.events.add('tennis:hitZone', (active, x, y, z, radius, expireTs) => {
    if (!active) {
        state.zone.active = false;
        state.zone.expire = 0;
        return;
    }
    state.zone.active = true;
    state.zone.position = new mp.Vector3(x, y, z);
    state.zone.radius = typeof radius === 'number' ? radius : 1.6;
    state.zone.expire = expireTs || (Date.now() + HIT_TIMEOUT);
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
    updateBallFlightRender();
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

    if (state.zone.active && now <= state.zone.expire + 100) {
        mp.game.graphics.drawMarker(1,
            state.zone.position.x,
            state.zone.position.y,
            state.zone.position.z - 1,
            0, 0, 0,
            0, 0, 0,
            state.zone.radius * 2,
            state.zone.radius * 2,
            0.4,
            120, 220, 255, 120,
            false, false, 2, false, '', '', false
        );
    }

    if (state.awaitingHit) {
        const hint = 'Подойдите в зону и нажмите ПКМ, чтобы отбить мяч';
        drawText(hint, 0.5, 0.9, 0.45, [200, 255, 200, 210]);
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
