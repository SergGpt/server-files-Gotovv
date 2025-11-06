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
const TENNIS_BLIP = 122;

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

const BALL_MODEL = mp.joaat("prop_tennis_ball");
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
let tickTimer = null;
let courtShapes = [];

function vectorToObject(vec) {
    return { x: vec.x, y: vec.y, z: vec.z };
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
        this.updatePosition(0);
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
        const obj = this.match.ballObj;
        if (obj && mp.objects.exists(obj)) {
            obj.position = new mp.Vector3(x, y, z);
        }
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
        this.awaitingHit = false;
        this.hitDeadline = 0;
        this.npcPed = null;
        this.npcRacket = null;
        this.ballObj = null;
        this.ballFlight = new BallFlight(this);
        this.backupState = null;
        this.serveSide = 'npc';
    }

    start() {
        if (!this.player || !mp.players.exists(this.player)) return;
        ensureTick();
        this.running = true;
        this.player.tennisMatch = this;
        matches.set(this.id, this);
        this.prepareCourt();
        this.spawnNpc();
        this.spawnBall();
        this.sendScore();
        this.message('Тренировка началась. Попробуйте выиграть розыгрыш до пяти очков.', true);
        this.player.call('tennis:matchStart', [this.court.name]);
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
        if (typeof this.player.addAttachment === 'function') {
            this.player.addAttachment('tennis_racket');
        }
        this.player.call('prompt.hide');
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
            this.npcPed.freezePosition(true);
            try { this.npcPed.setInvincible(true); } catch (e) {}
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

    spawnBall() {
        const center = this.court.center;
        this.ballObj = mp.objects.new(BALL_MODEL, new mp.Vector3(center.x, center.y, center.z + 1.0), {
            dimension: this.dimension
        });
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
        this.ballFlight.launch(side, side === 'player' ? 'npc' : 'player', side === 'player' ? 0.7 : 0.4);
    }

    onBallArrived(side) {
        if (!this.running) return;
        if (side === 'player') {
            this.awaitingHit = true;
            this.hitDeadline = Date.now() + HIT_TIMEOUT;
            this.player.call('tennis:awaitHit', [this.hitDeadline]);
            this.message('Зажмите и отпустите ЛКМ, чтобы ударить по мячу.');
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

    handlePlayerHit(player, rawPower) {
        if (!this.running || player !== this.player) return;
        if (!this.awaitingHit) return;
        const power = clamp(Number(rawPower) || 0, 0, 1);
        const ballPos = this.ballFlight.currentPos;
        const playerPos = vectorToObject(this.player.position);
        const dist = distance3(ballPos, playerPos);
        this.awaitingHit = false;
        this.player.call('tennis:awaitHit', [0]);
        if (dist > 3.2) {
            this.awardPoint('npc', 'Вы промахнулись по мячу.');
            return;
        }
        this.rally += 1;
        this.ballFlight.launch('player', 'npc', 0.5 + power * 0.5);
    }

    tick(delta) {
        if (!this.running) return;
        this.ballFlight.updatePosition(delta);
        if (this.awaitingHit && Date.now() > this.hitDeadline) {
            this.awaitingHit = false;
            this.player.call('tennis:awaitHit', [0]);
            this.awardPoint('npc', 'Вы не успели ударить по мячу.');
        }
    }

    awardPoint(winner, reason = null) {
        if (!this.running) return;
        if (winner === 'player') this.score.player += 1;
        else this.score.npc += 1;
        this.rally = 0;
        if (reason) this.message(reason, true);
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
            const player = this.player;
            if (typeof this.player.addAttachment === 'function') {
                this.player.addAttachment('tennis_racket', true);
            }
            if (this.backupState) {
                this.player.dimension = this.backupState.dimension;
                this.player.position = new mp.Vector3(this.backupState.position.x, this.backupState.position.y, this.backupState.position.z);
                this.player.heading = this.backupState.heading;
            }
            this.player.tennisMatch = null;
            setTimeout(() => {
                if (player && mp.players.exists(player)) {
                    player.call('tennis:showPrompt', [true, this.court.name]);
                }
            }, 300);
        }
        if (this.ballObj && mp.objects.exists(this.ballObj)) this.ballObj.destroy();
        if (this.npcRacket && mp.objects.exists(this.npcRacket)) this.npcRacket.destroy();
        if (this.npcPed && mp.peds.exists(this.npcPed)) this.npcPed.destroy();
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
        notifications = deps.notifications;
        setupCourts();
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
    handlePlayerHit(player, power) {
        const match = player.tennisMatch;
        if (!match) return;
        match.handlePlayerHit(player, power);
    },
    onPlayerQuit(player) {
        if (!player.tennisMatch) return;
        player.tennisMatch.stopForced('Соперник покинул игру.');
    }
};

module.exports.matches = matches;
