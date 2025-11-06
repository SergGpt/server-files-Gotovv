"use strict";

const TICK_MS = 50;
const INVITE_TIMEOUT = 30000;
const NET_HEIGHT = 1.05;
const GRAVITY = 9.81;
const AIR_RESISTANCE = 0.991;
const BOUNCE_FRICTION = 0.82;
const GROUND_LEVEL_OFFSET = 0.02;

const COURTS = [
    {
        id: 1,
        name: "Vespucci Beach Court",
        aSpawn: new mp.Vector3(-1159.114990234375, -1631.624755859375, 4.373704433441162),
        bSpawn: new mp.Vector3(-1147.3255615234375, -1648.2315673828125, 4.37370491027832),
        center: new mp.Vector3(-1153.2202758789062, -1639.9281616210938, 4.373704671859741),
        bounds: {
            minX: -1165.6,
            maxX: -1141.0,
            minY: -1654.5,
            maxY: -1625.3,
            netY: -1639.9281616210938
        }
    }
];

const NET_MODEL = mp.joaat("prop_tennis_net_01");
const BALL_MODEL = mp.joaat("prop_tennis_ball");
const RACKET_MODEL = mp.joaat("prop_tennis_rack_01");
const NPC_MODEL = mp.joaat("s_m_y_airworker");
const TENNIS_BLIP = 122;

const invites = new Map();
const matches = new Map();
const courtShapes = new Map();

let notifications;
let inviteTimer = null;
let nextMatchId = 1;

const vectorToObject = (vec) => ({ x: vec.x, y: vec.y, z: vec.z });
const clonePosition = (pos) => ({ x: pos.x, y: pos.y, z: pos.z });

function toVector3(obj) {
    return new mp.Vector3(obj.x, obj.y, obj.z);
}

function distanceBetween(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalise(vec) {
    const length = Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z);
    if (length <= 0.0001) return { x: 0, y: 0, z: 0 };
    return { x: vec.x / length, y: vec.y / length, z: vec.z / length };
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function courtById(id) {
    return COURTS.find(c => c.id === id) || null;
}

function findNearestCourt(position, maxDist = 80) {
    let result = null;
    let best = maxDist;
    COURTS.forEach(court => {
        const dist = distanceBetween(vectorToObject(position), vectorToObject(court.center));
        if (dist < best) {
            best = dist;
            result = court;
        }
    });
    return result;
}

function isCourtBusy(courtId) {
    for (const match of matches.values()) {
        if (!match.finished && match.court.id === courtId) return true;
    }
    return false;
}

function computeHeading(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const heading = Math.atan2(dx, dy) * 180 / Math.PI;
    return heading < 0 ? heading + 360 : heading;
}

function resolvePlayerName(player, fallback) {
    if (player && player.character && player.character.name) return player.character.name;
    if (player && player.name) return player.name;
    return fallback;
}

function cleanInvites() {
    const now = Date.now();
    invites.forEach((invite, targetId) => {
        const target = mp.players.at(targetId);
        const from = mp.players.at(invite.fromId);
        const expired = invite.expires <= now;
        if (!target || !mp.players.exists(target) || !target.character || (from && !mp.players.exists(from))) {
            invites.delete(targetId);
            if (target && mp.players.exists(target)) target.call('tennis.invite.hide');
            return;
        }
        if (expired) {
            invites.delete(targetId);
            target.call('tennis.invite.hide');
            notifications.info(target, 'Приглашение на теннис истекло', 'Теннис');
            if (from && mp.players.exists(from)) {
                notifications.info(from, `${target.character.name} не ответил на приглашение`, 'Теннис');
            }
        }
    });
}

class Match {
    constructor(court, sideA, sideB) {
        this.id = nextMatchId++;
        this.court = court;
        this.dimension = 15000 + this.id;
        this.participants = {
            a: sideA,
            b: sideB
        };
        this.points = { a: 0, b: 0 };
        this.advantage = null;
        this.serverSide = 'a';
        this.finished = false;
        this.playerStates = new Map();
        this.ball = {
            pos: vectorToObject(court.center),
            prevPos: vectorToObject(court.center),
            vel: { x: 0, y: 0, z: 0 },
            inPlay: false,
            lastHit: null,
            lastHitTime: 0,
            lastBounceSide: null,
            bounceCount: 0
        };
        this.ballObj = null;
        this.netObj = null;
        this.interval = null;
        this.npcData = null;
    }

    otherSide(side) {
        return side === 'a' ? 'b' : 'a';
    }

    getParticipant(side) {
        return this.participants[side] || null;
    }

    getPlayer(side) {
        const participant = this.getParticipant(side);
        if (!participant || participant.type !== 'player') return null;
        const player = participant.player;
        return player && mp.players.exists(player) ? player : null;
    }

    getNpc(side) {
        const participant = this.getParticipant(side);
        if (!participant || participant.type !== 'npc') return null;
        if (!participant.ped || !mp.peds.exists(participant.ped)) return null;
        return participant;
    }

    getDisplayName(side) {
        const participant = this.getParticipant(side);
        if (!participant) return side === 'a' ? 'Игрок A' : 'Игрок B';
        if (participant.type === 'player') {
            const player = this.getPlayer(side);
            if (player) return resolvePlayerName(player, side === 'a' ? 'Игрок A' : 'Игрок B');
            return participant.cachedName || (side === 'a' ? 'Игрок A' : 'Игрок B');
        }
        return participant.name || 'NPC';
    }

    start() {
        matches.set(this.id, this);
        this.prepareParticipant('a', this.participants.a, this.court.aSpawn, this.court.bSpawn);
        this.prepareParticipant('b', this.participants.b, this.court.bSpawn, this.court.aSpawn);
        this.spawnNet();
        this.spawnBall();
        this.resetForServe();
        this.broadcastMatchStart();
        const server = this.serverSide === 'a' ? this.getDisplayName('a') : this.getDisplayName('b');
        this.broadcastScore(`Матч начался! Подаёт ${server}.`);
        this.interval = setInterval(() => {
            try {
                this.update();
            } catch (e) {
                console.log('[TENNIS] Tick error', e);
                this.finish(null, 'Ошибка матча');
            }
        }, TICK_MS);
    }

    prepareParticipant(side, participant, spawn, opponentSpawn) {
        if (!participant) return;
        if (participant.type === 'player') {
            const player = participant.player;
            if (!player || !mp.players.exists(player)) return;
            participant.cachedName = resolvePlayerName(player, side === 'a' ? 'Игрок A' : 'Игрок B');
            this.playerStates.set(player.id, {
                position: clonePosition(player.position),
                heading: player.heading,
                dimension: player.dimension
            });
            const heading = computeHeading(spawn, opponentSpawn);
            player.removeAllWeapons();
            player.position = new mp.Vector3(spawn.x, spawn.y, spawn.z);
            player.dimension = this.dimension;
            player.heading = heading;
            player.tennisMatch = this;
            player.tennisSide = side;
            player.addAttachment('tennis_racket');
        } else if (participant.type === 'npc') {
            const heading = computeHeading(spawn, opponentSpawn);
            const ped = mp.peds.new(participant.model || NPC_MODEL, new mp.Vector3(spawn.x, spawn.y, spawn.z), {
                dynamic: true
            });
            ped.dimension = this.dimension;
            ped.heading = heading;
            participant.ped = ped;
            participant.spawn = clonePosition(spawn);
            participant.heading = heading;
            participant.name = participant.name || 'Тренер NPC';
            this.npcData = {
                side,
                nextServeTime: Date.now() + 1200,
                lastSwing: 0,
                moveSpeed: 3.2
            };
            try {
                participant.racket = mp.objects.new(RACKET_MODEL, new mp.Vector3(spawn.x, spawn.y, spawn.z), {
                    dimension: this.dimension
                });
                const bone = ped.getBoneIndex(60309);
                participant.racket.attachTo(ped.handle, bone, 0.02, 0.02, 0.0, -90.0, 0.0, 90.0, false, false, false, false, 2, true);
            } catch (err) {
                console.log('[TENNIS] NPC racket attach failed', err.message);
                if (participant.racket && mp.objects.exists(participant.racket)) participant.racket.destroy();
                participant.racket = null;
            }
        }
    }

    spawnNet() {
        const position = new mp.Vector3(this.court.center.x, this.court.bounds.netY, this.court.center.z);
        this.netObj = mp.objects.new(NET_MODEL, position, {
            dimension: this.dimension
        });
    }

    spawnBall() {
        const position = new mp.Vector3(this.court.center.x, this.court.center.y, this.court.center.z + 1.0);
        this.ballObj = mp.objects.new(BALL_MODEL, position, {
            dimension: this.dimension
        });
    }

    updateBallObject() {
        if (mp.objects.exists(this.ballObj)) {
            this.ballObj.position = new mp.Vector3(this.ball.pos.x, this.ball.pos.y, this.ball.pos.z);
        }
    }

    broadcast(event, payload) {
        ['a', 'b'].forEach(side => {
            const player = this.getPlayer(side);
            if (player) {
                player.call(event, [JSON.stringify(payload)]);
            }
        });
    }

    broadcastMatchStart() {
        ['a', 'b'].forEach(side => {
            const player = this.getPlayer(side);
            if (!player) return;
            const opponentPart = this.getParticipant(this.otherSide(side));
            const payload = {
                matchId: this.id,
                side,
                court: {
                    id: this.court.id,
                    name: this.court.name,
                    bounds: this.court.bounds,
                    center: vectorToObject(this.court.center)
                },
                opponent: this.getDisplayName(this.otherSide(side)),
                opponentType: opponentPart ? opponentPart.type : 'player',
                serverSide: this.serverSide,
                points: this.points,
                players: {
                    a: this.getDisplayName('a'),
                    b: this.getDisplayName('b')
                }
            };
            player.call('tennis.match.start', [JSON.stringify(payload)]);
        });
    }

    broadcastScore(reason, winnerSide = null) {
        const payload = {
            matchId: this.id,
            reason,
            serverSide: this.serverSide,
            points: this.points,
            players: {
                a: this.getDisplayName('a'),
                b: this.getDisplayName('b')
            },
            advantage: this.advantage,
            finished: winnerSide != null,
            winnerSide
        };
        this.broadcast('tennis.score.update', payload);
    }

    sendPointNotifications(winnerSide, reason) {
        const winner = this.getPlayer(winnerSide);
        const loser = this.getPlayer(this.otherSide(winnerSide));
        if (winner) notifications.success(winner, `Очко за вами (${reason})`, 'Теннис');
        if (loser) notifications.warning(loser, `Очко сопернику (${reason})`, 'Теннис');
    }

    update() {
        if (this.finished) return;
        if (!this.ball.inPlay) {
            this.updateBallObject();
            this.updateNpc(TICK_MS / 1000);
            return;
        }

        this.ball.vel.x *= AIR_RESISTANCE;
        this.ball.vel.y *= AIR_RESISTANCE;

        const dt = TICK_MS / 1000;
        const prev = { ...this.ball.pos };
        this.ball.prevPos = prev;

        this.ball.vel.z -= GRAVITY * dt;
        this.ball.pos.x += this.ball.vel.x * dt;
        this.ball.pos.y += this.ball.vel.y * dt;
        this.ball.pos.z += this.ball.vel.z * dt;

        if (this.checkNet(prev)) return;
        if (this.checkOut()) return;

        const groundLevel = this.court.center.z + GROUND_LEVEL_OFFSET;
        if (this.ball.pos.z <= groundLevel) {
            if (this.ball.vel.z < 0) {
                this.ball.pos.z = groundLevel;
                this.ball.vel.z = -this.ball.vel.z * 0.55;
                this.ball.vel.x *= BOUNCE_FRICTION;
                this.ball.vel.y *= BOUNCE_FRICTION;
                this.handleBounce();
                if (this.finished) return;
            } else {
                this.ball.pos.z = groundLevel;
            }
        }

        this.updateBallObject();

        if (Math.abs(this.ball.vel.x) < 0.05) this.ball.vel.x = 0;
        if (Math.abs(this.ball.vel.y) < 0.05) this.ball.vel.y = 0;
        if (Math.abs(this.ball.vel.z) < 0.05 && this.ball.pos.z <= groundLevel + 0.05) {
            const side = this.ball.lastBounceSide || (this.ball.pos.y >= this.court.bounds.netY ? 'a' : 'b');
            this.registerPoint(this.otherSide(side), 'Мяч остановился');
        }

        this.updateNpc(dt);
    }

    updateNpc(dt) {
        if (!this.npcData) return;
        const npc = this.getNpc(this.npcData.side);
        if (!npc) return;
        const ped = npc.ped;
        const side = this.npcData.side;
        const spawn = npc.spawn;
        const bounds = this.court.bounds;
        const pos = ped.position;
        const desiredX = clamp(this.ball.pos.x, bounds.minX + 1.0, bounds.maxX - 1.0);
        const maxMove = this.npcData.moveSpeed * dt;
        const dx = desiredX - pos.x;
        const moveX = clamp(dx, -maxMove, maxMove);
        const newX = pos.x + moveX;
        const baseY = spawn.y;
        const yOffset = this.ball.inPlay ? clamp((this.ball.pos.y - baseY) * 0.2, -1.2, 1.2) : 0;
        const targetY = clamp(baseY + yOffset, bounds.minY + 0.8, bounds.maxY - 0.8);
        ped.position = new mp.Vector3(newX, targetY, spawn.z);
        const opponentSpawn = side === 'a' ? this.court.bSpawn : this.court.aSpawn;
        ped.heading = computeHeading(ped.position, opponentSpawn);

        if (!this.ball.inPlay && this.serverSide === side) {
            if (Date.now() >= this.npcData.nextServeTime) {
                const aimY = side === 'a' ? -1 : 1;
                this.strike(ped, side, 0.75, 0, aimY, 0);
                this.npcData.nextServeTime = Date.now() + 2500;
                this.npcData.lastSwing = Date.now();
            }
            return;
        }

        if (!this.ball.inPlay) return;
        if (Date.now() - this.ball.lastHitTime < 250) return;

        const ballSide = this.ball.pos.y >= bounds.netY ? 'a' : 'b';
        if (ballSide !== side) return;
        if (this.ball.pos.z > this.court.center.z + 3.0) return;

        const npcPos = vectorToObject(ped.position);
        const dist = distanceBetween(npcPos, this.ball.pos);
        if (dist > 5.0) return;
        if (Date.now() - this.npcData.lastSwing < 700) return;

        const targetX = clamp(this.court.center.x + (Math.random() - 0.5) * (bounds.maxX - bounds.minX) * 0.6, bounds.minX + 1.2, bounds.maxX - 1.2);
        const targetY = side === 'a' ? bounds.minY + 1.4 : bounds.maxY - 1.4;
        const aim = normalise({
            x: targetX - this.ball.pos.x,
            y: targetY - this.ball.pos.y,
            z: 0
        });
        const power = 0.6 + Math.random() * 0.5;
        this.strike(ped, side, power, aim.x, aim.y, aim.z);
        this.npcData.lastSwing = Date.now();
        this.broadcast('tennis.npc.swing', { side });
    }

    checkNet(prev) {
        const netY = this.court.bounds.netY;
        const from = prev.y - netY;
        const to = this.ball.pos.y - netY;
        if (from === 0 && to === 0) return false;
        if ((from > 0 && to < 0) || (from < 0 && to > 0) || from === 0 || to === 0) {
            if (this.ball.pos.z < this.court.center.z + NET_HEIGHT) {
                const winner = this.otherSide(this.ball.lastHit || this.serverSide);
                this.registerPoint(winner, 'Соперник попал в сетку');
                return true;
            }
        }
        return false;
    }

    checkOut() {
        const { minX, maxX, minY, maxY } = this.court.bounds;
        if (this.ball.pos.x < minX || this.ball.pos.x > maxX || this.ball.pos.y < minY || this.ball.pos.y > maxY) {
            const winner = this.otherSide(this.ball.lastHit || this.serverSide);
            this.registerPoint(winner, 'Аут');
            return true;
        }
        return false;
    }

    getServePosition(entity, side) {
        const origin = vectorToObject(entity.position);
        const offsetY = side === 'a' ? 0.75 : -0.75;
        return {
            x: origin.x,
            y: origin.y + offsetY,
            z: this.court.center.z + 1.05
        };
    }

    strike(entity, side, charge, aimX, aimY, aimZ) {
        const power = clamp(Number(charge) || 0, 0.15, 1.4);
        let aim = normalise({ x: aimX, y: aimY, z: aimZ });
        if (Math.abs(aim.x) < 0.001 && Math.abs(aim.y) < 0.001) {
            aim = { x: 0, y: side === 'a' ? -1 : 1, z: 0 };
        }
        aim.y = Math.abs(aim.y) * (side === 'a' ? -1 : 1);

        const isServe = !this.ball.inPlay;
        const baseSpeed = isServe ? 14 : 17;
        const speed = baseSpeed + power * 8.5;
        const vertical = isServe ? 6 + power * 3 : 5 + power * 4.5;

        if (isServe && entity) {
            const servePos = this.getServePosition(entity, side);
            this.ball.pos = servePos;
        }

        this.ball.inPlay = true;
        this.ball.lastHit = side;
        this.ball.lastHitTime = Date.now();
        this.ball.lastBounceSide = null;
        this.ball.bounceCount = 0;
        this.ball.vel = {
            x: aim.x * speed,
            y: aim.y * speed,
            z: vertical
        };
        this.updateBallObject();
    }

    serve(entity, side, charge, aimX, aimY, aimZ) {
        this.strike(entity, side, charge, aimX, aimY, aimZ);
    }

    handleSwing(player, charge, aimX, aimY, aimZ) {
        if (this.finished) return;
        const side = player.tennisSide;
        if (!side) return;

        const now = Date.now();
        if (this.ball.lastHit === side && now - this.ball.lastHitTime < 350) return;

        if (!this.ball.inPlay) {
            if (side !== this.serverSide) {
                notifications.warning(player, 'Сейчас подаёт соперник', 'Теннис');
                return;
            }
            this.serve(player, side, charge, aimX, aimY, aimZ);
            return;
        }

        const playerPos = vectorToObject(player.position);
        const dist = distanceBetween(playerPos, this.ball.pos);
        if (dist > 4.5) {
            notifications.warning(player, 'Мяч слишком далеко', 'Теннис');
            return;
        }

        const ballSide = this.ball.pos.y >= this.court.bounds.netY ? 'a' : 'b';
        if (ballSide !== side && (this.ball.pos.z - this.court.center.z) < 0.6) {
            notifications.warning(player, 'Дождитесь пока мяч перелетит сетку', 'Теннис');
            return;
        }

        this.strike(player, side, charge, aimX, aimY, aimZ);
    }

    registerPoint(winnerSide, reason) {
        if (this.finished) return;
        this.sendPointNotifications(winnerSide, reason);

        const loserSide = this.otherSide(winnerSide);
        this.points[winnerSide] += 1;

        if (this.points[winnerSide] >= 4 && this.points[winnerSide] - this.points[loserSide] >= 2) {
            this.finish(winnerSide, reason);
            return;
        }

        if (this.points[winnerSide] >= 3 && this.points[loserSide] >= 3) {
            if (this.points[winnerSide] === this.points[loserSide]) {
                this.advantage = null;
            } else if (this.points[winnerSide] > this.points[loserSide]) {
                this.advantage = winnerSide;
            }
        } else {
            this.advantage = null;
        }

        this.swapServer();
        this.resetForServe();
        this.broadcastScore(reason);
    }

    swapServer() {
        this.serverSide = this.otherSide(this.serverSide);
    }

    resetForServe() {
        this.ball.inPlay = false;
        this.ball.lastHit = null;
        this.ball.lastBounceSide = null;
        this.ball.bounceCount = 0;
        this.ball.pos = vectorToObject(this.court.center);
        this.ball.vel = { x: 0, y: 0, z: 0 };
        this.updateBallObject();
        if (this.npcData && this.npcData.side === this.serverSide) {
            this.npcData.nextServeTime = Date.now() + 1400;
        }
        this.broadcast('tennis.state.update', { serverSide: this.serverSide });
    }

    handleBounce() {
        if (this.finished) return;
        const side = this.ball.pos.y >= this.court.bounds.netY ? 'a' : 'b';
        if (this.ball.lastBounceSide === side) {
            this.ball.bounceCount += 1;
        } else {
            this.ball.lastBounceSide = side;
            this.ball.bounceCount = 1;
        }

        if (this.ball.lastHit === side && this.ball.bounceCount === 1) {
            this.registerPoint(this.otherSide(side), 'Мяч приземлился на вашей стороне');
            return;
        }

        if (this.ball.bounceCount > 1) {
            this.registerPoint(this.otherSide(side), 'Двойной отскок');
        }
    }

    stopByPlayer(player) {
        if (this.finished) return;
        const side = player.tennisSide;
        const winner = this.otherSide(side);
        this.finish(winner, `${resolvePlayerName(player, 'Игрок')} покинул матч`);
    }

    finish(winnerSide, reason) {
        if (this.finished) return;
        this.finished = true;
        clearInterval(this.interval);
        this.interval = null;

        if (winnerSide) {
            this.broadcastScore(reason, winnerSide);
        }
        ['a', 'b'].forEach(side => {
            const player = this.getPlayer(side);
            if (player) {
                player.call('tennis.match.end', [JSON.stringify({ winnerSide, reason })]);
            }
        });

        setTimeout(() => this.stop(), 1500);
    }

    stop() {
        if (mp.objects.exists(this.ballObj)) this.ballObj.destroy();
        if (mp.objects.exists(this.netObj)) this.netObj.destroy();

        ['a', 'b'].forEach(side => {
            const participant = this.getParticipant(side);
            if (!participant) return;
            if (participant.type === 'player') {
                const player = this.getPlayer(side);
                if (!player) return;
                const state = this.playerStates.get(player.id);
                if (state) {
                    player.dimension = state.dimension;
                    player.position = toVector3(state.position);
                    player.heading = state.heading;
                }
                player.addAttachment('tennis_racket', true);
                player.tennisMatch = null;
                player.tennisSide = null;
                player.call('tennis.match.cleanup');
            } else if (participant.type === 'npc') {
                if (participant.racket && mp.objects.exists(participant.racket)) {
                    participant.racket.destroy();
                }
                if (participant.ped && mp.peds.exists(participant.ped)) {
                    participant.ped.destroy();
                }
            }
        });

        matches.delete(this.id);
    }
}

function makePlayerSide(player) {
    return { type: 'player', player };
}

function makeNpcSide() {
    return { type: 'npc', model: NPC_MODEL, name: 'Тренер NPC' };
}

function setupCourtInteraction(court) {
    const blip = mp.blips.new(TENNIS_BLIP, new mp.Vector3(court.center.x, court.center.y, court.center.z), {
        name: 'Теннис',
        color: 2,
        shortRange: true
    });
    const shape = mp.colshapes.newSphere(court.center.x, court.center.y, court.center.z, 5);
    shape.isTennisCourt = true;
    shape.courtId = court.id;
    courtShapes.set(shape, { court, blip });
}

function startMatch(court, playerA, sideB) {
    const match = new Match(court, makePlayerSide(playerA), sideB);
    match.start();
    return match;
}

module.exports = {
    COURTS,
    init(deps) {
        notifications = deps.notifications;
        COURTS.forEach(setupCourtInteraction);
        if (!inviteTimer) inviteTimer = setInterval(cleanInvites, 5000);
    },
    onEnterCourt(player, courtId) {
        const court = courtById(courtId);
        if (!court) return;
        player.tennisCourtId = court.id;
        player.call('tennis.area.enter', [JSON.stringify({ courtId: court.id, name: court.name })]);
    },
    onExitCourt(player, courtId) {
        if (player.tennisCourtId === courtId) delete player.tennisCourtId;
        player.call('tennis.area.exit');
    },
    openMenu(player) {
        if (!player.character) return;
        const courtId = player.tennisCourtId;
        const court = courtId ? courtById(courtId) : findNearestCourt(player.position, 12);
        if (!court) {
            notifications.error(player, 'Рядом нет теннисного корта', 'Теннис');
            return;
        }
        const match = player.tennisMatch;
        const invite = invites.get(player.id) || null;
        const availablePlayers = [];
        mp.players.forEachInRange(court.center, 25, player.dimension, (candidate) => {
            if (!candidate.character) return;
            if (candidate.id === player.id) return;
            if (candidate.tennisMatch) return;
            const existingInvite = invites.get(candidate.id);
            if (existingInvite && existingInvite.fromId === player.id) return;
            availablePlayers.push({ id: candidate.id, name: candidate.character.name });
        });
        let inviteInfo = null;
        if (invite) {
            const fromPlayer = mp.players.at(invite.fromId);
            inviteInfo = {
                fromId: invite.fromId,
                name: resolvePlayerName(fromPlayer, 'Игрок')
            };
        }
        const payload = {
            court: { id: court.id, name: court.name },
            matchActive: Boolean(match),
            incomingInvite: inviteInfo,
            players: availablePlayers
        };
        player.call('tennis.menu.open', [JSON.stringify(payload)]);
    },
    handleMenuAction(player, action, value) {
        if (!player.character) return;
        switch (action) {
            case 'invitePlayer': {
                this.handleInvite(player, value);
                break;
            }
            case 'playNpc': {
                const courtId = player.tennisCourtId;
                const court = courtId ? courtById(courtId) : findNearestCourt(player.position, 12);
                if (!court) {
                    notifications.error(player, 'Рядом нет теннисного корта', 'Теннис');
                    return;
                }
                if (player.tennisMatch) {
                    notifications.warning(player, 'Вы уже участвуете в матче', 'Теннис');
                    return;
                }
                if (isCourtBusy(court.id)) {
                    notifications.warning(player, 'Корт уже занят', 'Теннис');
                    return;
                }
                startMatch(court, player, makeNpcSide());
                notifications.success(player, 'Матч с тренером начался', 'Теннис');
                break;
            }
            case 'acceptInvite': {
                this.handleAccept(player);
                break;
            }
            case 'declineInvite': {
                const invite = invites.get(player.id);
                if (invite) {
                    invites.delete(player.id);
                    const from = mp.players.at(invite.fromId);
                    if (from && mp.players.exists(from)) notifications.info(from, `${player.character.name} отклонил приглашение`, 'Теннис');
                    player.call('tennis.invite.hide');
                }
                break;
            }
            case 'leaveMatch': {
                this.handleLeave(player);
                break;
            }
        }
    },
    handleInvite(player, targetId) {
        const id = parseInt(targetId, 10);
        if (isNaN(id)) {
            notifications.error(player, 'Укажите ID игрока', 'Теннис');
            return;
        }
        const target = mp.players.at(id);
        if (!target || !mp.players.exists(target) || !target.character) {
            notifications.error(player, 'Игрок не найден', 'Теннис');
            return;
        }
        if (target === player) {
            notifications.error(player, 'Нельзя пригласить себя', 'Теннис');
            return;
        }
        if (player.tennisMatch || target.tennisMatch) {
            notifications.error(player, 'Кто-то из вас уже играет', 'Теннис');
            return;
        }
        const courtId = player.tennisCourtId;
        const court = courtId ? courtById(courtId) : findNearestCourt(player.position, 12);
        if (!court) {
            notifications.error(player, 'Рядом нет свободного корта', 'Теннис');
            return;
        }
        if (isCourtBusy(court.id)) {
            notifications.warning(player, 'Корт уже занят', 'Теннис');
            return;
        }
        invites.set(target.id, {
            fromId: player.id,
            courtId: court.id,
            expires: Date.now() + INVITE_TIMEOUT
        });
        notifications.success(player, `Приглашение отправлено ${target.character.name}`, 'Теннис');
        target.call('tennis.invite.show', [JSON.stringify({ fromId: player.id, name: resolvePlayerName(player, 'Игрок'), courtName: court.name })]);
    },
    handleAccept(player) {
        const invite = invites.get(player.id);
        if (!invite) {
            notifications.error(player, 'У вас нет приглашений', 'Теннис');
            return;
        }
        const from = mp.players.at(invite.fromId);
        invites.delete(player.id);
        player.call('tennis.invite.hide');
        if (!from || !mp.players.exists(from) || !from.character) {
            notifications.error(player, 'Пригласивший игрок недоступен', 'Теннис');
            return;
        }
        if (player.tennisMatch || from.tennisMatch) {
            notifications.error(player, 'Кто-то из вас уже играет', 'Теннис');
            return;
        }
        const court = courtById(invite.courtId);
        if (!court) {
            notifications.error(player, 'Корт недоступен', 'Теннис');
            return;
        }
        if (isCourtBusy(court.id)) {
            notifications.warning(player, 'Корт уже занят', 'Теннис');
            return;
        }
        startMatch(court, from, makePlayerSide(player));
    },
    handleLeave(player) {
        const match = player.tennisMatch;
        if (!match) {
            notifications.error(player, 'Вы не участвуете в матче', 'Теннис');
            return;
        }
        match.stopByPlayer(player);
    },
    handleSwing(player, charge, aimX, aimY, aimZ) {
        const match = player.tennisMatch;
        if (!match) return;
        match.handleSwing(player, charge, aimX, aimY, aimZ);
    },
    onPlayerQuit(player) {
        invites.forEach((invite, targetId) => {
            if (invite.fromId === player.id || targetId === player.id) {
                const target = mp.players.at(targetId);
                if (target && mp.players.exists(target)) target.call('tennis.invite.hide');
                invites.delete(targetId);
            }
        });
        const match = player.tennisMatch;
        if (match) match.stopByPlayer(player);
    }
};

module.exports.matches = matches;
