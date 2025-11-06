const KEY_SWING = 0x01;
const KEY_MENU = 0x45;
const SCORE_DISPLAY_DURATION = 6000;

let tennisState = {
    active: false,
    side: null,
    serverSide: null,
    points: { a: 0, b: 0 },
    advantage: null,
    names: { a: 'Игрок A', b: 'Игрок B' },
    opponent: 'Соперник',
    opponentType: 'player',
    charging: false,
    chargeStart: 0,
    chargeProgress: 0,
    lastReason: null,
    lastReasonTime: 0,
    finished: false,
    finishUntil: 0,
    winnerSide: null,
    endReason: null
};

let keysBound = false;
let areaState = { inside: false, courtId: null, name: null };
let menuState = {
    open: null,
    mainItems: [],
    opponents: [],
    lastData: null,
    invite: null
};
let menusRegistered = false;

if (mp.attachmentMngr) {
    mp.attachmentMngr.register('tennis_racket', 'prop_tennis_rack_01', 'PH_R_Hand',
        { x: 0.03, y: 0.015, z: 0.0 }, { x: -90.0, y: 0.0, z: 90.0 });
}

function registerMenus() {
    if (menusRegistered) return;
    menusRegistered = true;
    const code = `
        (function(){
            if (typeof selectMenu === 'undefined' || !selectMenu.menus) return;
            function ensureMenu(name, header){
                if (selectMenu.menus[name]) return;
                selectMenu.menus[name] = {
                    name: name,
                    header: header,
                    items: [{ text: 'Загрузка...' }],
                    i: 0,
                    j: 0,
                    handler: function(eventName){
                        var item = this.items[this.i] || {};
                        var e = {
                            menuName: this.name,
                            itemName: item.text || '',
                            itemIndex: this.i,
                            itemValue: (item.i != null && item.values) ? item.values[item.i] : null,
                            valueIndex: item.i
                        };
                        mp.trigger('selectMenu.handler', this.name, eventName, JSON.stringify(e));
                    }
                };
            }
            ensureMenu('tennisMain', 'Теннис');
            ensureMenu('tennisOpponents', 'Выбор соперника');
            ensureMenu('tennisInvite', 'Приглашение в теннис');
        })();
    `;
    mp.callCEFV(code);
}

registerMenus();
mp.events.add('browserDomReady', registerMenus);

const drawText = (text, x, y, scale, color = [255, 255, 255, 255], font = 4) => {
    mp.game.graphics.drawText(text, [x, y], {
        font,
        colour: color,
        scale: [scale, scale],
        outline: true,
        centre: true
    });
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const bindKeys = (state) => {
    if (state && !keysBound) {
        keysBound = true;
        mp.keys.bind(KEY_SWING, true, onSwingStart);
        mp.keys.bind(KEY_SWING, false, onSwingEnd);
    } else if (!state && keysBound) {
        keysBound = false;
        mp.keys.unbind(KEY_SWING, true, onSwingStart);
        mp.keys.unbind(KEY_SWING, false, onSwingEnd);
    }
};

function resetState() {
    bindKeys(false);
    if (mp.busy.includes('tennis')) mp.busy.remove('tennis');
    tennisState = {
        active: false,
        side: null,
        serverSide: null,
        points: { a: 0, b: 0 },
        advantage: null,
        names: { a: 'Игрок A', b: 'Игрок B' },
        opponent: 'Соперник',
        opponentType: 'player',
        charging: false,
        chargeStart: 0,
        chargeProgress: 0,
        lastReason: null,
        lastReasonTime: 0,
        finished: false,
        finishUntil: 0,
        winnerSide: null,
        endReason: null
    };
}

function closeTennisMenu() {
    if (menuState.open) {
        mp.events.call('selectMenu.hide');
        menuState.open = null;
    }
    if (areaState.inside && !tennisState.active) {
        mp.prompt.show('Нажмите <span>E</span>, чтобы открыть меню тенниса');
    } else if (!tennisState.active) {
        mp.prompt.hide();
    }
}

function onSwingStart() {
    if (!tennisState.active || tennisState.finished) return;
    if (mp.game.ui.isPauseMenuActive()) return;
    if (mp.busy.includes() && !mp.busy.includes('tennis')) return;
    tennisState.charging = true;
    tennisState.chargeStart = Date.now();
}

function onSwingEnd() {
    if (!tennisState.active || tennisState.finished) return;
    if (!tennisState.charging) return;

    tennisState.charging = false;
    const hold = (Date.now() - tennisState.chargeStart) / 1000;
    const power = clamp(hold / 0.9, 0.18, 1.4);
    tennisState.chargeProgress = 0;

    const forward = mp.players.local.getForwardVector();
    const aim = forward ? forward : { x: 0, y: 0, z: 0 };

    mp.events.callRemote('tennis.swing', power, aim.x, aim.y, aim.z || 0);
}

function formatScore(points, advantage, names) {
    const map = ['0', '15', '30', '40'];
    let scoreA = map[Math.min(points.a, 3)] || '40';
    let scoreB = map[Math.min(points.b, 3)] || '40';
    let status = '';

    if (points.a >= 3 && points.b >= 3) {
        if (points.a === points.b) {
            scoreA = '40';
            scoreB = '40';
            status = 'Дьюс';
        } else if (advantage === 'a') {
            scoreA = 'AD';
            scoreB = '40';
            const name = names?.a || 'Игрок A';
            status = `Преимущество: ${name}`;
        } else if (advantage === 'b') {
            scoreA = '40';
            scoreB = 'AD';
            const name = names?.b || 'Игрок B';
            status = `Преимущество: ${name}`;
        }
    }

    return { scoreA, scoreB, status };
}

function renderScoreboard() {
    if (!tennisState.active) return;

    const { scoreA, scoreB, status } = formatScore(tennisState.points, tennisState.advantage, tennisState.names);
    const mySide = tennisState.side || 'a';
    const opponentSide = mySide === 'a' ? 'b' : 'a';
    const myName = tennisState.names[mySide] || mp.players.local.name;
    const opponentName = tennisState.names[opponentSide] || tennisState.opponent || 'Соперник';
    const myScore = mySide === 'a' ? scoreA : scoreB;
    const opponentScore = mySide === 'a' ? scoreB : scoreA;

    mp.game.graphics.drawRect(0.5, 0.09, 0.24, 0.09, 0, 0, 0, 150);

    drawText(`${myName}: ${myScore}`, 0.5, 0.06, 0.42);
    drawText(`${opponentName}: ${opponentScore}`, 0.5, 0.09, 0.42);

    if (status) {
        drawText(status, 0.5, 0.12, 0.36, [255, 215, 120, 255]);
    } else {
        const serverText = tennisState.serverSide === mySide ? 'Вы подаёте' : `${opponentName} подаёт`;
        drawText(serverText, 0.5, 0.12, 0.36, [180, 200, 255, 255]);
    }

    if (tennisState.lastReason && Date.now() - tennisState.lastReasonTime < 4000) {
        drawText(tennisState.lastReason, 0.5, 0.145, 0.32, [200, 255, 200, 220]);
    }

    if (tennisState.finished && tennisState.finishUntil) {
        const color = tennisState.winnerSide === tennisState.side ? [120, 255, 120, 255] : [255, 120, 120, 255];
        const resultText = tennisState.winnerSide === tennisState.side ? 'Вы победили' : 'Вы проиграли';
        drawText(`${resultText}${tennisState.endReason ? ` (${tennisState.endReason})` : ''}`, 0.5, 0.17, 0.34, color);
    }
}

function renderCharge() {
    if (!tennisState.active) return;
    if (!tennisState.charging) {
        tennisState.chargeProgress = Math.max(tennisState.chargeProgress - 0.03, 0);
        if (tennisState.chargeProgress <= 0.01) return;
    }

    if (tennisState.charging) {
        const hold = (Date.now() - tennisState.chargeStart) / 1000;
        tennisState.chargeProgress = clamp(hold / 0.9, 0, 1);
    }

    const width = 0.16;
    const height = 0.018;
    const x = 0.5;
    const y = 0.82;

    mp.game.graphics.drawRect(x, y, width + 0.01, height + 0.012, 0, 0, 0, 140);
    mp.game.graphics.drawRect(x, y, width * tennisState.chargeProgress, height, 120, 230, 120, 200);
    drawText('Мощность удара', x, y - 0.025, 0.32);
}

mp.events.add('render', () => {
    if (!tennisState.active) return;

    mp.game.controls.disableControlAction(0, 24, true);
    mp.game.controls.disableControlAction(0, 257, true);
    mp.game.controls.disableControlAction(0, 140, true);
    mp.game.controls.disableControlAction(0, 141, true);
    mp.game.controls.disableControlAction(0, 142, true);

    renderScoreboard();
    renderCharge();

    if (tennisState.finished && tennisState.finishUntil && Date.now() > tennisState.finishUntil) {
        resetState();
    }
});

function openMainMenu(data) {
    menuState.lastData = data;
    menuState.mainItems = [];
    menuState.opponents = data.players || [];

    const items = [];
    if (data.matchActive) {
        items.push({ id: 'leaveMatch', text: 'Завершить матч' });
    } else {
        if (data.incomingInvite) {
            items.push({ id: 'acceptInvite', text: `Принять приглашение (${data.incomingInvite.name})` });
            items.push({ id: 'declineInvite', text: 'Отклонить приглашение' });
        }
        if (menuState.opponents.length) {
            items.push({ id: 'showPlayers', text: 'Играть с игроком', values: [`Доступно: ${menuState.opponents.length}`] });
        } else {
            items.push({ id: 'noPlayers', text: 'Играть с игроком', values: ['Свободных игроков нет'] });
        }
        items.push({ id: 'playNpc', text: 'Играть с NPC' });
    }
    items.push({ id: 'close', text: 'Закрыть' });

    const cefItems = items.map(item => {
        const entry = { text: item.text };
        if (item.values) entry.values = item.values;
        return entry;
    });

    mp.callCEFV(`selectMenu.setItems('tennisMain', ${JSON.stringify(cefItems)})`);
    mp.events.call('selectMenu.show', 'tennisMain');
    menuState.mainItems = items;
    menuState.open = 'main';
}

function showOpponentsMenu() {
    if (!menuState.opponents.length) {
        mp.notify.warning('Свободных игроков поблизости нет.');
        return;
    }
    const items = menuState.opponents.map(op => ({ text: op.name, values: [`ID: ${op.id}`] }));
    items.push({ text: 'Назад' });
    mp.callCEFV(`selectMenu.setItems('tennisOpponents', ${JSON.stringify(items)})`);
    mp.events.call('selectMenu.show', 'tennisOpponents');
    menuState.open = 'opponents';
}

function showInviteMenu(data) {
    menuState.invite = data;
    const items = [
        { text: `Принять приглашение от ${data.name}` },
        { text: 'Отклонить приглашение' }
    ];
    mp.callCEFV(`selectMenu.setItems('tennisInvite', ${JSON.stringify(items)})`);
    mp.events.call('selectMenu.show', 'tennisInvite');
    menuState.open = 'invite';
}

function hideInviteMenu() {
    if (menuState.open === 'invite') {
        mp.events.call('selectMenu.hide');
    }
    menuState.invite = null;
    if (areaState.inside && !tennisState.active) {
        mp.prompt.show('Нажмите <span>E</span>, чтобы открыть меню тенниса');
    }
    menuState.open = null;
}

function handleMainMenu(eventName, e) {
    if (!menuState.mainItems.length) return;
    if (eventName === 'onItemSelected') {
        const item = menuState.mainItems[e.itemIndex];
        if (!item) return;
        switch (item.id) {
            case 'leaveMatch':
                mp.events.callRemote('tennis.menu.action', 'leaveMatch');
                closeTennisMenu();
                break;
            case 'acceptInvite':
                mp.events.callRemote('tennis.menu.action', 'acceptInvite');
                closeTennisMenu();
                break;
            case 'declineInvite':
                mp.events.callRemote('tennis.menu.action', 'declineInvite');
                closeTennisMenu();
                break;
            case 'showPlayers':
                showOpponentsMenu();
                break;
            case 'noPlayers':
                mp.notify.warning('Свободных игроков для игры не найдено.');
                break;
            case 'playNpc':
                mp.events.callRemote('tennis.menu.action', 'playNpc');
                closeTennisMenu();
                break;
            case 'close':
                closeTennisMenu();
                break;
        }
    }
    if (eventName === 'onBackspacePressed' || eventName === 'onEscapePressed') {
        closeTennisMenu();
    }
}

function handleOpponentsMenu(eventName, e) {
    if (eventName === 'onItemSelected') {
        if (e.itemIndex === menuState.opponents.length) {
            openMainMenu(menuState.lastData || { players: [] });
            return;
        }
        const opponent = menuState.opponents[e.itemIndex];
        if (!opponent) return;
        mp.events.callRemote('tennis.menu.action', 'invitePlayer', opponent.id);
        closeTennisMenu();
    }
    if (eventName === 'onBackspacePressed' || eventName === 'onEscapePressed') {
        openMainMenu(menuState.lastData || { players: [] });
    }
}

function handleInviteMenu(eventName, e) {
    if (eventName === 'onItemSelected') {
        const accepted = e.itemIndex === 0;
        mp.events.callRemote('tennis.invite.response', accepted);
        closeTennisMenu();
    }
    if (eventName === 'onBackspacePressed' || eventName === 'onEscapePressed') {
        mp.events.callRemote('tennis.invite.response', false);
        closeTennisMenu();
    }
}

mp.events.add('tennis.menu.handle', (menuName, eventName, data) => {
    if (menuName === 'tennisMain') handleMainMenu(eventName, data);
    else if (menuName === 'tennisOpponents') handleOpponentsMenu(eventName, data);
    else if (menuName === 'tennisInvite') handleInviteMenu(eventName, data);
});

mp.events.add('tennis.menu.open', (json) => {
    try {
        const data = JSON.parse(json);
        mp.prompt.hide();
        openMainMenu(data);
    } catch (err) {
        mp.console.logInfo(`tennis.menu.open error: ${err.message}`);
    }
});

mp.events.add('tennis.invite.show', (json) => {
    try {
        const data = JSON.parse(json);
        mp.prompt.hide();
        showInviteMenu(data);
        mp.notify.info(`${data.name} приглашает вас сыграть в теннис.`);
    } catch (err) {
        mp.console.logInfo(`tennis.invite.show error: ${err.message}`);
    }
});

mp.events.add('tennis.invite.hide', () => {
    hideInviteMenu();
});

mp.events.add('tennis.area.enter', (json) => {
    try {
        const data = JSON.parse(json);
        areaState = { inside: true, courtId: data.courtId, name: data.name };
        if (!menuState.open && !tennisState.active) {
            mp.prompt.show('Нажмите <span>E</span>, чтобы открыть меню тенниса');
        }
    } catch (err) {
        mp.console.logInfo(`tennis.area.enter error: ${err.message}`);
    }
});

mp.events.add('tennis.area.exit', () => {
    areaState = { inside: false, courtId: null, name: null };
    if (!tennisState.active) mp.prompt.hide();
});

mp.keys.bind(KEY_MENU, true, () => {
    if (menuState.open && menuState.open !== 'invite') return;
    if (!tennisState.active && !areaState.inside) return;
    if (mp.busy.includes() && !mp.busy.includes('tennis')) return;
    if (tennisState.active && menuState.open === 'invite') return;
    mp.events.callRemote('tennis.menu.open');
});

mp.events.add('tennis.match.start', (json) => {
    try {
        const data = JSON.parse(json);
        tennisState.active = true;
        tennisState.side = data.side;
        tennisState.serverSide = data.serverSide;
        tennisState.points = data.points || { a: 0, b: 0 };
        tennisState.advantage = null;
        tennisState.opponent = data.opponent || 'Соперник';
        tennisState.opponentType = data.opponentType || 'player';
        tennisState.names = data.players || tennisState.names;
        tennisState.finished = false;
        tennisState.finishUntil = 0;
        tennisState.lastReason = 'Матч начался';
        tennisState.lastReasonTime = Date.now();
        tennisState.winnerSide = null;
        tennisState.endReason = null;
        bindKeys(true);
        mp.busy.add('tennis', false, true);
        mp.notify.info('Матч по теннису начался. Используйте ЛКМ для удара.');
        closeTennisMenu();
        mp.prompt.hide();
    } catch (e) {
        mp.console.logInfo(`tennis.match.start error: ${e.message}`);
    }
});

mp.events.add('tennis.score.update', (json) => {
    try {
        const data = JSON.parse(json);
        tennisState.points = data.points || tennisState.points;
        tennisState.advantage = data.advantage || null;
        tennisState.serverSide = data.serverSide || tennisState.serverSide;
        if (data.players) tennisState.names = data.players;
        if (data.reason) {
            tennisState.lastReason = data.reason;
            tennisState.lastReasonTime = Date.now();
        }
        if (data.finished) {
            tennisState.finished = true;
            tennisState.winnerSide = data.winnerSide;
            tennisState.finishUntil = Date.now() + SCORE_DISPLAY_DURATION;
        }
    } catch (e) {
        mp.console.logInfo(`tennis.score.update error: ${e.message}`);
    }
});

mp.events.add('tennis.state.update', (json) => {
    try {
        const data = JSON.parse(json);
        if (data.serverSide) tennisState.serverSide = data.serverSide;
    } catch (e) {
        mp.console.logInfo(`tennis.state.update error: ${e.message}`);
    }
});

mp.events.add('tennis.match.end', (json) => {
    try {
        const data = JSON.parse(json);
        tennisState.finished = true;
        tennisState.winnerSide = data.winnerSide;
        tennisState.endReason = data.reason || tennisState.endReason;
        tennisState.finishUntil = Date.now() + SCORE_DISPLAY_DURATION;
        bindKeys(false);
        if (mp.busy.includes('tennis')) mp.busy.remove('tennis');
    } catch (e) {
        mp.console.logInfo(`tennis.match.end error: ${e.message}`);
    }
});

mp.events.add('tennis.match.cleanup', () => {
    if (!tennisState.finished) {
        tennisState.finishUntil = Date.now() + 1500;
        tennisState.finished = true;
    }
    bindKeys(false);
    if (mp.busy.includes('tennis')) mp.busy.remove('tennis');
    if (areaState.inside) mp.prompt.show('Нажмите <span>E</span>, чтобы открыть меню тенниса');
});
