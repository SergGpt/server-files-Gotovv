"use strict";

const TICK_MS = 50;
const MATCH_POINT = 5;
const HIT_TIMEOUT = 2500;
const NPC_MISS_BASE = 0.18;
const NPC_MISS_PER_RALLY = 0.08;
const BALL_APEX_BASE = 2.2;
const BALL_APEX_POWER = 0.6;
const BALL_DURATION_BASE = 1500;
const BALL_DURATION_POWER = 450;
const PLAYER_ZONE_RADIUS = 2.4;
const TENNIS_BLIP = 122;
const SHOP_PED_MODEL = mp.joaat("a_m_y_business_02");
const RACKET_ITEM_ID = 200;
const BALL_ITEM_ID = 201;

const SHOP_ITEMS = [
    { name: "Теннисная ракетка", itemId: RACKET_ITEM_ID, price: 450, params: {} },
    { name: "Теннисный мяч", itemId: BALL_ITEM_ID, price: 25, params: {} }
];
const SHOP_POINT = { x: -1154.6, y: -1638.4, z: 4.37, heading: 95 };

const COURTS = [
    {
        id: 1,
        name: "Корт Веспуччи",
        center: { x: -1153.22, y: -1639.93, z: 4.37 },
        playerSpawn: { x: -1159.11, y: -1631.62, z: 4.37, heading: 215 },
        npcSpawn: { x: -1147.33, y: -1648.23, z: 4.37, heading: 35 },
        playerHit: { x: -1158.40, y: -1634.90, z: 4.37 },
        npcHit: { x: -1148.00, y: -1645.60, z: 4.37 }
    }
];

const RACKET_MODEL = mp.joaat("prop_tennis_rack_01");
const NPC_MODEL = mp.joaat("s_m_y_airworker");

const RACKET_ATTACH = {
    bone: 57005,
    pos: { x: 0.12, y: 0.02, z: 0.0 },
    rot: { x: -90.0, y: 0.0, z: 0.0 }
};

const matches = new Map();
let nextMatchId = 1;
let notifications = null;
let inventory = null;
let money = null;
let tickTimer = null;
let courtShapes = [];
let shopPoint = null;

function vectorToObject(vec) {
    return { x: vec.x, y: vec.y, z: vec.z };
}

function distance2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function distance3(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function computeHeading(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const heading = Math.atan2(dx, dy) * 180 / Math.PI;
    return heading < 0 ? heading + 360 : heading;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function ensureTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
        matches.forEach(match => match.tick(TICK_MS));
    }, TICK_MS);
}

function pushChat(player, message) {
    if (!player || !mp.players.exists(player)) return;
    try {
        player.call('chat.message.push', [message]);
    } catch (e) {}
}

class BallFlight {
    constructor(match) {
        this.match = match;
        this.active = false;
        this.start = null;
        this.end = null;
        this.elapsed = 0;
        this.duration = BALL_DURATION_BASE;
        this.apex = BALL_APEX_BASE;
        this.targetSide = null;
        this.currentPos = match.court ? { ...match.court.center } : { x: 0, y: 0, z: 0 };
    }

    launch(fromSide, toSide, power = 0.5) {
        const startPos = this.match.getHitPosition(fromSide);
        const endPos = this.match.getReceivePosition(toSide);
        const offsetX = (Math.random() - 0.5) * 1.4;
        const offsetY = (Math.random() - 0.5) * 1.6;
        const start = {
            x: startPos.x,
            y: startPos.y,
            z: startPos.z + 0.9
        };
        const end = {
            x: endPos.x + offsetX,
            y: endPos.y + offsetY,
            z: endPos.z + 0.35
        };
        this.start = start;
        this.end = end;
        this.elapsed = 0;
        this.duration = clamp(BALL_DURATION_BASE - power * BALL_DURATION_POWER, 900, 1900);
        this.apex = BALL_APEX_BASE + power * BALL_APEX_POWER;
        this.targetSide = toSide;
        this.active = true;
        this.currentPos = { ...start };
        if (typeof this.match.onBallLaunch === 'function') {
            this.match.onBallLaunch(fromSide, toSide, start, end, this.duration, this.apex);
        }
        this.match.emitBallFlight(start, end, this.duration, this.apex);
    }

    updatePosition(delta) {
        if (!this.active || !this.start || !this.end) return;
        this.elapsed += delta;
        let t = this.duration <= 0 ? 1 : this.elapsed / this.duration;
        if (t >= 1) t = 1;
        const inv = 1 - t;
        const x = this.start.x * inv + this.end.x * t;
        const y = this.start.y * inv + this.end.y * t;
        const baseZ = this.start.z * inv + this.end.z * t;
        const z = baseZ + this.apex * Math.sin(Math.PI * t);
        this.currentPos = { x, y, z };
        if (t >= 1) {
            this.active = false;
            this.match.onBallArrived(this.targetSide);
        }
    }
}

class Match {
    constructor(player, court) {
        this.id = nextMatchId++;
        this.player = player;
        this.court = court;
        this.dimension = 17000 + this.id;
        this.score = { player: 0, npc: 0 };
        this.rally = 0;
        this.running = false;
        const deadline = this.hitDeadline;
        this.awaitingHit = false;
        this.hitDeadline = 0;
        this.npcPed = null;
        this.npcRacket = null;
        this.ballFlight = new BallFlight(this);
        this.backupState = null;
        this.serveSide = 'npc';
        this.playerZone = null;
        this.autoSwingUsed = false;
    }

    start() {
        if (!this.player || !mp.players.exists(this.player)) return;
        ensureTick();
        try { this.player.setVariable('tennisActive', true); } catch (e) {}
        this.running = true;
        this.player.tennisMatch = this;
        matches.set(this.id, this);
        this.prepareCourt();
        this.spawnNpc();
        this.player.call('tennis:ballCreate');
        this.player.call('tennis:hitZone', [false]);
        this.sendScore();
        this.message('Тренировка началась. Попробуйте выиграть розыгрыш до пяти очков.', true);
        this.player.call('tennis:matchStart', [this.court.name]);
        this.player.call('inventory.setHandsBlock', [true, true]);
        this.launchServe(this.serveSide);
    }

    prepareCourt() {
        const spawn = this.court.playerSpawn;
        this.backupState = {
            dimension: this.player.dimension,
            position: vectorToObject(this.player.position),
            heading: this.player.heading
        };
        this.player.dimension = this.dimension;
        this.player.position = new mp.Vector3(spawn.x, spawn.y, spawn.z);
        const heading = spawn.heading || computeHeading(spawn, this.court.center);
        this.player.heading = heading;
        this.player.call('prompt.hide');
        this.player.tennisShop = false;
        this.player.call('tennis:showShopPrompt', [false]);
        this.player.call('tennis:shopClose');
        if (inventory && inventory.getHandsItem && inventory.syncHandsItem) {
            const attemptResync = () => {
                if (!this.running) return;
                if (!this.player || !mp.players.exists(this.player)) return;
                try {
                    const refreshed = inventory.getHandsItem(this.player);
                    if (refreshed) inventory.syncHandsItem(this.player, refreshed);
                } catch (e) {}
            };
            try {
                const initial = inventory.getHandsItem(this.player);
                if (initial) inventory.syncHandsItem(this.player, initial);
            } catch (e) {}
            setTimeout(attemptResync, 350);
            setTimeout(attemptResync, 800);
            setTimeout(attemptResync, 1400);
        }
    }

    spawnNpc() {
        const spawn = this.court.npcSpawn;
        this.npcPed = mp.peds.new(NPC_MODEL, new mp.Vector3(spawn.x, spawn.y, spawn.z), {
            dimension: this.dimension,
            dynamic: true
        });
        if (this.npcPed) {
            this.npcPed.heading = spawn.heading || computeHeading(spawn, this.court.center);
            this.npcPed.setVariable('tennisTrainer', true);
            try { this.npcPed.setInvincible(true); } catch (e) {}
            try { this.npcPed.taskStandStill(-1); } catch (e) {}
        }
        this.npcRacket = mp.objects.new(RACKET_MODEL, new mp.Vector3(spawn.x, spawn.y, spawn.z), {
            dimension: this.dimension
        });
        setTimeout(() => {
            if (!this.npcPed || !mp.peds.exists(this.npcPed)) return;
            if (!this.npcRacket || !mp.objects.exists(this.npcRacket)) return;
            try {
                this.npcRacket.attachTo(this.npcPed.handle, RACKET_ATTACH.bone,
                    RACKET_ATTACH.pos.x, RACKET_ATTACH.pos.y, RACKET_ATTACH.pos.z,
                    RACKET_ATTACH.rot.x, RACKET_ATTACH.rot.y, RACKET_ATTACH.rot.z,
                    false, false, false, false, 2, true);
            } catch (e) {}
        }, 250);
    }

    getHitPosition(side) {
        return side === 'player' ? this.court.playerHit : this.court.npcHit;
    }

    getReceivePosition(side) {
        if (side === 'player') return this.court.playerHit;
        return this.court.npcHit;
    }

    launchServe(side) {
        this.awaitingHit = false;
        this.hitDeadline = 0;
        this.autoSwingUsed = false;
        this.ballFlight.launch(side, side === 'player' ? 'npc' : 'player', side === 'player' ? 0.7 : 0.4);
    }

    onBallLaunch(fromSide, toSide, start, end, duration, apex) {
        if (toSide === 'player') {
            this.playerZone = {
                x: end.x,
                y: end.y,
                z: end.z,
                radius: PLAYER_ZONE_RADIUS,
                expire: Date.now() + duration + HIT_TIMEOUT
            };
            this.sendHitZone(true, this.playerZone);
        } else if (fromSide === 'player') {
            this.playerZone = null;
            this.sendHitZone(false);
        }
    }

    onBallArrived(side) {
        if (!this.running) return;
        if (side === 'player') {
            this.awaitingHit = true;
            this.hitDeadline = Date.now() + HIT_TIMEOUT;
            this.autoSwingUsed = false;
            this.player.call('tennis:awaitHit', [this.hitDeadline]);
            if (this.playerZone) this.playerZone.expire = this.hitDeadline;
            this.sendHitZone(true, this.playerZone);
            this.message('Подойдите в отмеченную зону и нажмите ПКМ, чтобы отбить мяч.');
        } else {
            setTimeout(() => this.npcHit(), 300);
        }
    }

    npcHit() {
        if (!this.running) return;
        if (Math.random() < NPC_MISS_BASE + this.rally * NPC_MISS_PER_RALLY) {
            this.awardPoint('player', 'Тренер ошибся.');
            return;
        }
        this.rally += 1;
        this.ballFlight.launch('npc', 'player', 0.45 + Math.random() * 0.25);
    }

    completePlayerHit(rawPower, playerPos, options = {}) {
        if (!this.running) return false;
        if (!this.awaitingHit) {
            this.debug(`hit ignored: awaitingHit=${this.awaitingHit}`);
            return false;
        }
        if (!this.player || !mp.players.exists(this.player)) return false;
        const player = this.player;
        if (inventory && typeof inventory.getHandsItem === 'function') {
            const handsItem = inventory.getHandsItem(player);
            const handsItemId = handsItem && typeof handsItem.itemId !== 'undefined' ? Number(handsItem.itemId) : null;
            if (handsItemId !== RACKET_ITEM_ID) {
                this.awaitingHit = false;
                this.player.call('tennis:awaitHit', [0]);
                this.awardPoint('npc', 'Вы выпустили ракетку из рук.');
                this.debug('hit rejected: racket not in hand');
                return false;
            }
        }

        const resolvedPos = playerPos || vectorToObject(player.position);
        const px = Number(resolvedPos.x) || 0;
        const py = Number(resolvedPos.y) || 0;
        const pz = Number(resolvedPos.z) || 0;
        this.debug(`hit received from=${options.auto ? 'auto' : 'player'} rawPower=${rawPower} pos=${px.toFixed(3)},${py.toFixed(3)},${pz.toFixed(3)}`);

        const power = clamp(Number(rawPower) || 0, 0, 1);
        const zone = this.playerZone;
        const toleranceBase = zone ? (Number(zone.radius) || PLAYER_ZONE_RADIUS) : PLAYER_ZONE_RADIUS;
        const tolerance = toleranceBase + 2.6;
        let validStrike = !!options.forceAccept;

        if (!validStrike && zone) {
            const flatDist = distance2(resolvedPos, zone);
            const zx = Number(zone.x) || 0;
            const zy = Number(zone.y) || 0;
            const zz = Number(zone.z) || 0;
            this.debug(`zonePos=${zx.toFixed(3)},${zy.toFixed(3)},${zz.toFixed(3)} flatDist=${flatDist.toFixed(3)} tol=${tolerance.toFixed(3)}`);
            if (flatDist <= tolerance) validStrike = true;
        }

        if (!validStrike && this.ballFlight && this.ballFlight.currentPos) {
            const ballPos = this.ballFlight.currentPos;
            const bx = Number(ballPos.x) || 0;
            const by = Number(ballPos.y) || 0;
            const bz = Number(ballPos.z) || 0;
            const ballGap = distance3(resolvedPos, ballPos);
            this.debug(`ballPos=${bx.toFixed(3)},${by.toFixed(3)},${bz.toFixed(3)} gap=${ballGap.toFixed(3)} tol=${(tolerance + 1).toFixed(3)}`);
            if (ballGap <= tolerance + 1) validStrike = true;
        }

        if (!validStrike) {
            this.awaitingHit = false;
            this.player.call('tennis:awaitHit', [0]);
            this.awardPoint('npc', 'Вы промахнулись по мячу.');
            this.debug('hit failed: validation did not pass');
            return false;
        }

        this.awaitingHit = false;
        this.hitDeadline = 0;
        this.autoSwingUsed = true;
        this.player.call('tennis:awaitHit', [0]);
        this.playerZone = null;
        this.sendHitZone(false);

        this.rally += 1;
        const timingFactor = clamp(1 - Math.max(deadline - Date.now(), 0) / HIT_TIMEOUT, 0, 1);
        const finalPower = clamp(0.45 + (power * 0.4) + timingFactor * 0.2, 0.45, 1);
        this.debug(`hit success: source=${options.auto ? 'auto' : 'player'} power=${power.toFixed(2)} finalPower=${finalPower.toFixed(2)}`);
        this.ballFlight.launch('player', 'npc', finalPower);
        return true;
    }

    handlePlayerHit(player, rawPower, hitX, hitY, hitZ) {
        if (!this.running || player !== this.player) return;
        let playerPos = null;
        const hx = Number(hitX);
        const hy = Number(hitY);
        const hz = Number(hitZ);
        if (Number.isFinite(hx) && Number.isFinite(hy)) {
            playerPos = { x: hx, y: hy, z: Number.isFinite(hz) ? hz : player.position.z };
        }
        if (!playerPos) playerPos = vectorToObject(player.position);
        this.completePlayerHit(rawPower, playerPos, { auto: false });
    }

    tick(delta) {
        if (!this.running) return;
        this.ballFlight.updatePosition(delta);
        if (this.awaitingHit) {
            if (this.playerZone && this.player && mp.players.exists(this.player) && !this.autoSwingUsed) {
                const zone = this.playerZone;
                const mpPos = this.player.position;
                if (mpPos) {
                    const playerPos = vectorToObject(mpPos);
                    const flatDist = distance2(playerPos, zone);
                    const tolerance = (Number(zone.radius) || PLAYER_ZONE_RADIUS) + 1.4;
                    const ballPos = this.ballFlight && this.ballFlight.currentPos ? this.ballFlight.currentPos : null;
                    const ballGap = ballPos ? distance3(playerPos, ballPos) : Number.POSITIVE_INFINITY;
                    if (flatDist <= tolerance && ballGap <= tolerance + 1.4) {
                        const now = Date.now();
                        const remaining = this.hitDeadline > 0 ? Math.max(0, this.hitDeadline - now) : 0;
                        const timingFactor = clamp(1 - Math.min(remaining / HIT_TIMEOUT, 1), 0, 1);
                        const autoPower = clamp(0.5 + timingFactor * 0.35, 0.45, 0.95);
                        this.debug(`auto swing: flatDist=${flatDist.toFixed(3)} ballGap=${ballGap.toFixed(3)} remain=${remaining}`);
                        if (this.completePlayerHit(autoPower, playerPos, { auto: true, forceAccept: true })) {
                            return;
                        }
                    }
                }
            }
        if (this.awaitingHit && Date.now() > this.hitDeadline) {
            this.awaitingHit = false;
            this.player.call('tennis:awaitHit', [0]);
            this.awardPoint('npc', 'Вы не успели ударить по мячу.');
            this.debug('hit failed: deadline exceeded');
        }
    }

    awardPoint(winner, reason = null) {
        if (!this.running) return;
        if (winner === 'player') this.score.player += 1;
        else this.score.npc += 1;
        this.rally = 0;
        this.playerZone = null;
        this.sendHitZone(false);
        if (reason) this.message(reason, true);
        this.autoSwingUsed = false;
        this.debug(`point -> winner=${winner} score=${this.score.player}:${this.score.npc} reason=${reason || 'n/a'}`);
        this.sendScore();
        if (this.score.player >= MATCH_POINT || this.score.npc >= MATCH_POINT) {
            const playerWon = this.score.player > this.score.npc;
            this.finish(playerWon, playerWon ? 'Вы выиграли тренировку!' : 'Тренер оказался сильнее.');
            return;
        }
        this.serveSide = winner === 'player' ? 'player' : 'npc';
        setTimeout(() => {
            if (!this.running) return;
            this.launchServe(this.serveSide);
        }, 600);
    }

    sendScore() {
        this.player.call('tennis:score', [this.score.player, this.score.npc]);
        this.message(`Счёт ${this.score.player} : ${this.score.npc}`);
    }

    message(text, notify = false) {
        if (!this.player || !mp.players.exists(this.player)) return;
        if (notify && notifications) notifications.info(this.player, text, 'Теннис');
        this.player.call('tennis:message', [text]);
    }

    debug(text) {
        if (!text) return;
        if (!this.player || !mp.players.exists(this.player)) return;
        const payload = String(text);
        pushChat(this.player, `!{#d6ff9a}[Теннис] ${payload}`);
        try { this.player.call('tennis:debug', [payload]); } catch (e) {}
    }

    finish(playerWon, reason) {
        if (!this.running) return;
        this.running = false;
        this.player.call('tennis:matchEnd', [playerWon, reason]);
        this.cleanup();
    }

    stopForced(reason) {
        if (!this.running) return;
        this.player.call('tennis:matchEnd', [false, reason || 'Матч завершён.']);
        this.cleanup();
    }

    cleanup() {
        this.running = false;
        this.awaitingHit = false;
        this.hitDeadline = 0;
        matches.delete(this.id);
        if (this.player && mp.players.exists(this.player)) {
            try { this.player.setVariable('tennisActive', false); } catch (e) {}
            const player = this.player;
            if (this.backupState) {
                this.player.dimension = this.backupState.dimension;
                this.player.position = new mp.Vector3(this.backupState.position.x, this.backupState.position.y, this.backupState.position.z);
                this.player.heading = this.backupState.heading;
            }
            this.player.tennisMatch = null;
            this.player.call('tennis:ballDestroy');
            this.player.call('tennis:hitZone', [false]);
            this.player.call('inventory.setHandsBlock', [false, true]);
            setTimeout(() => {
                if (player && mp.players.exists(player)) {
                    player.call('tennis:showPrompt', [true, this.court.name]);
                    if (inventory && inventory.getHandsItem && inventory.syncHandsItem) {
                        try {
                            const refreshed = inventory.getHandsItem(player);
                            if (refreshed) inventory.syncHandsItem(player, refreshed);
                        } catch (e) {}
                    }
                }
            }, 300);
        } else if (this.player) {
            try { this.player.setVariable('tennisActive', false); } catch (e) {}
        }
        if (this.npcRacket && mp.objects.exists(this.npcRacket)) this.npcRacket.destroy();
        if (this.npcPed && mp.peds.exists(this.npcPed)) this.npcPed.destroy();
    }

    emitBallFlight(start, end, duration, apex) {
        if (!this.player || !mp.players.exists(this.player)) return;
        this.player.call('tennis:ballFlight', [
            start.x, start.y, start.z,
            end.x, end.y, end.z,
            duration,
            apex,
            this.ballFlight.targetSide
        ]);
    }

    sendHitZone(active, zone = null) {
        if (!this.player || !mp.players.exists(this.player)) return;
        if (!active || !zone) {
            this.debug('zone cleared');
            this.player.call('tennis:hitZone', [false]);
            return;
        }
        const zx = Number(zone.x) || 0;
        const zy = Number(zone.y) || 0;
        const zz = Number(zone.z) || 0;
        const zr = Number(zone.radius || 0);
        this.debug(`zone set: (${zx.toFixed(3)},${zy.toFixed(3)},${zz.toFixed(3)}) r=${zr.toFixed(2)} expire=${zone.expire}`);
        this.player.call('tennis:hitZone', [
            true,
            zone.x,
            zone.y,
            zone.z,
            zone.radius,
            zone.expire
        ]);
    }
}

function setupCourts() {
    courtShapes.forEach(item => {
        if (item.shape && mp.colshapes.exists(item.shape)) item.shape.destroy();
        if (item.marker && mp.markers.exists(item.marker)) item.marker.destroy();
        if (item.blip && mp.blips.exists(item.blip)) item.blip.destroy();
        if (item.label && mp.labels.exists(item.label)) item.label.destroy();
    });
    courtShapes = [];

    COURTS.forEach(court => {
        const center = court.center;
        const blip = mp.blips.new(TENNIS_BLIP, new mp.Vector3(center.x, center.y, center.z), {
            name: 'Теннисный корт',
            color: 25,
            shortRange: true
        });
        const marker = mp.markers.new(1, new mp.Vector3(center.x, center.y, center.z - 1.0), 1.8, {
            color: [255, 255, 255, 120],
            visible: true,
            dimension: 0
        });
        const label = mp.labels.new('Теннисный корт', new mp.Vector3(center.x, center.y, center.z + 1.0), {
            dimension: 0,
            los: true,
            drawDistance: 10
        });
        const shape = mp.colshapes.newSphere(center.x, center.y, center.z, 2.5);
        shape.isTennisCourt = true;
        shape.courtId = court.id;
        courtShapes.push({ court, blip, marker, label, shape });
    });
}

function setupShop() {
    if (shopPoint) {
        const { marker, shape, ped, label } = shopPoint;
        if (marker && mp.markers.exists(marker)) marker.destroy();
        if (shape && mp.colshapes.exists(shape)) shape.destroy();
        if (ped && mp.peds.exists(ped)) ped.destroy();
        if (label && mp.labels.exists(label)) label.destroy();
    }

    const pos = SHOP_POINT;
    const marker = mp.markers.new(1, new mp.Vector3(pos.x, pos.y, pos.z - 1.0), 1.2, {
        color: [120, 200, 255, 120],
        visible: true,
        dimension: 0
    });
    const shape = mp.colshapes.newSphere(pos.x, pos.y, pos.z, 2.0);
    shape.onEnter = (player) => {
        player.tennisShop = true;
        player.call('tennis:showShopPrompt', [true]);
    };
    shape.onExit = (player) => {
        player.tennisShop = false;
        player.call('tennis:showShopPrompt', [false]);
        player.call('tennis:shopClose');
    };
    const ped = mp.peds.new(SHOP_PED_MODEL, new mp.Vector3(pos.x, pos.y, pos.z), {
        heading: pos.heading || 0,
        dimension: 0,
        dynamic: true
    });
    if (ped) {
        try { ped.heading = pos.heading || 0; } catch (e) {}
        try { ped.freezePosition(true); } catch (e) {}
        try { ped.setInvincible(true); } catch (e) {}
    }
    const label = mp.labels.new('Теннисный магазин', new mp.Vector3(pos.x, pos.y, pos.z + 1.0), {
        dimension: 0,
        drawDistance: 10,
        los: true
    });

    shopPoint = { marker, shape, ped, label };
}

function courtById(id) {
    return COURTS.find(c => c.id === id) || null;
}

function isCourtBusy(courtId) {
    for (const match of matches.values()) {
        if (match.running && match.court && match.court.id === courtId) return true;
    }
    return false;
}

module.exports = {
    init(deps) {
        notifications = deps.notifications || notifications || call('notifications');
        inventory = deps.inventory || inventory || call('inventory');
        money = deps.money || money || call('money');
        setupCourts();
        setupShop();
        ensureTick();
    },
    onEnterCourt(player, courtId) {
        const court = courtById(courtId);
        if (!court) return;
        player.call('tennis:showPrompt', [true, court.name]);
    },
    onExitCourt(player) {
        player.call('tennis:showPrompt', [false]);
    },
    startNpcMatch(player) {
        if (!player.character) return;
        if (player.tennisMatch) {
            if (notifications) notifications.error(player, 'Вы уже играете в теннис.', 'Теннис');
            return;
        }
        const handsItem = inventory && inventory.getHandsItem ? inventory.getHandsItem(player) : null;
        if (!handsItem || handsItem.itemId !== RACKET_ITEM_ID) {
            if (notifications) notifications.error(player, 'Возьмите в руки теннисную ракетку, чтобы начать матч.', 'Теннис');
            return;
        }
        const court = COURTS[0];
        if (isCourtBusy(court.id)) {
            if (notifications) notifications.error(player, 'Корт сейчас занят. Попробуйте чуть позже.', 'Теннис');
            return;
        }
        if (player.vehicle) {
            if (notifications) notifications.error(player, 'Выйдите из транспорта, чтобы начать тренировку.', 'Теннис');
            return;
        }
        const match = new Match(player, court);
        match.start();
    },
    handlePlayerHit(player, power, hitX, hitY, hitZ) {
        const match = player.tennisMatch;
        if (!match) {
            const debugMsg = 'server: hit received без активного матча';
            pushChat(player, `!{#d6ff9a}[Теннис] ${debugMsg}`);
            try { player.call('tennis:debug', [debugMsg]); } catch (e) {}
            return;
        }
        match.handlePlayerHit(player, power, hitX, hitY, hitZ);
    },
    onPlayerQuit(player) {
        if (!player.tennisMatch) return;
        player.tennisMatch.stopForced('Соперник покинул игру.');
    },
    openShop(player) {
        if (!player.character) return;
        if (!player.tennisShop) {
            if (notifications) notifications.error(player, 'Подойдите ближе к продавцу тенниса.', 'Теннис');
            return;
        }
        const menuItems = SHOP_ITEMS.map((item, index) => ({
            text: `${item.name} [$${item.price}]`,
            buyIndex: index
        }));
        menuItems.push({ text: 'Закрыть' });
        player.call('tennis:shopOpen', [JSON.stringify(menuItems)]);
    },
    buyShopItem(player, rawIndex) {
        if (!player.character) return;
        if (!player.tennisShop) {
            if (notifications) notifications.error(player, 'Вы далеко от продавца.', 'Теннис');
            return;
        }
        const index = parseInt(rawIndex, 10);
        if (Number.isNaN(index) || index < 0 || index >= SHOP_ITEMS.length) return;
        const entry = SHOP_ITEMS[index];
        if (!entry) return;
        if (!inventory || !money) return;
        if (player.character.cash < entry.price) {
            if (notifications) notifications.error(player, 'Недостаточно наличных средств.', 'Теннис');
            return;
        }
        const cantAdd = inventory.cantAdd(player, entry.itemId, entry.params || {});
        if (cantAdd) {
            if (notifications) notifications.error(player, cantAdd, 'Теннис');
            return;
        }
        money.removeCash(player, entry.price, (success) => {
            if (!success) {
                if (notifications) notifications.error(player, 'Ошибка списания наличных.', 'Теннис');
                return;
            }
            inventory.addItem(player, entry.itemId, entry.params || {}, (error) => {
                if (error) {
                    if (notifications) notifications.error(player, error, 'Теннис');
                    return;
                }
                if (notifications) notifications.success(player, `Вы приобрели ${entry.name}.`, 'Теннис');
            });
        }, `Покупка теннисного снаряжения #${entry.itemId}`);
    },
    closeShop(player) {
        if (player) player.call('selectMenu.hide');
    }
};

module.exports.matches = matches;
