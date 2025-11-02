// ============================
// RAGE:MP — Zombies (Client) — raycast hits + forceRemove
// ============================

const DEBUG = true;
let VERBOSE = true;

const me = mp.players.local;
const zombies = new Map(); // zid -> { ped }

const STEP_SPEED = 1.35;
const STOP_DIST  = 1.6;
const FOLLOW_CD  = 350;
const STUCK_CD   = 1000;
const MIN_STEP   = 0.04;

function chatRaw(str){ try{ mp.gui.chat.push(str); }catch{} }
function chat(msg,color='#ffffff'){ chatRaw(`!{${color}}${msg}`); }
function dlog(msg){ if(DEBUG && VERBOSE) chat(`[ZDBG] ${msg}`,'#99ccff'); }

// ====== подготовка педа ======
function prepPed(ped){
    try{ mp.game.entity.setEntityAsMissionEntity(ped.handle,true,true);}catch{}
    try{ ped.setInvincible(false); }catch{}
    try{ ped.setCollision(true,true); }catch{}
    try{ ped.setBlockingOfNonTemporaryEvents(true); }catch{}
    try{ ped.setKeepTask(true); }catch{}
    try{ ped.setCanRagdoll(true); }catch{}
}

// ====== attach / detach ======
function attachIfZombie(ped){
    if(!ped || ped.type !== 'ped') return false;
    const zid = ped.getVariable('zid');
    const zoneId = ped.getVariable('zoneId');
    if (typeof zid !== 'number' || !zoneId) return false;

    if (!zombies.has(zid)) {
        zombies.set(zid, { ped });
        dlog(`✅ streamIn zid=${zid} total=${zombies.size}`);
    }
    prepPed(ped);
    return true;
}
function detachIfZombie(ped){
    if(!ped || ped.type !== 'ped') return;
    const zid = ped.getVariable('zid');
    if(typeof zid !== 'number') return;
    if(zombies.has(zid)){
        zombies.delete(zid);
        dlog(`❌ streamOut zid=${zid} total=${zombies.size}`);
    }
}

mp.events.add('entityStreamIn', (ent) => {
    try { if (ent && ent.type === 'ped') attachIfZombie(ent); } catch {}
});
mp.events.add('entityStreamOut', (ent) => {
    try { if (ent && ent.type === 'ped') detachIfZombie(ent); } catch {}
});

// принудительный первый проход
setTimeout(() => {
    try {
        mp.peds.forEach(ped => {
            try { attachIfZombie(ped); } catch {}
        });
        chat(`✅ Zombies client loaded (${zombies.size} peds)`, '#aaffaa');
    } catch (e) {
        chat(`❌ init err: ${e.message}`, '#ff6666');
    }
}, 1000);

// ====== контроллер ======
function isController(ped){
    const rid = ped.getVariable('controllerRid');
    return typeof rid === 'number' && rid === me.id;
}

// ====== события от сервера ======

// сервер говорит: "ты контроллер вот этого педа"
mp.events.add('z:assignController', (zid, ver, pedHandle) => {
    try{
        const ped = mp.peds.atHandle(pedHandle);
        if(!ped || !mp.peds.exists(ped)) return;

        attachIfZombie(ped);

        // подтвердить серверу
        setTimeout(() => {
            try { mp.events.callRemote('z:ctrlAck', zid, ver); } catch {}
        }, 100);

        // чуть толкнуть
        try {
            const p = me.position;
            ped.taskGoStraightToCoord(p.x, p.y, p.z, STEP_SPEED, 500, 0.0, 0.0);
        } catch {}
    }catch{}
});

// сервер говорит: "выполни команду"
mp.events.add('z:executeCommand', (zid, cmd, extraJson) => {
    try{
        const obj = zombies.get(zid);
        if(!obj) return;
        const ped = obj.ped;
        if(!mp.peds.exists(ped)) return;

        const extra = extraJson ? JSON.parse(extraJson) : {};

        switch (cmd) {
            case 'idle':
                try { ped.taskStandStill(500); } catch {}
                break;
            case 'follow': {
                let target = me;
                if (extra && typeof extra.rid === 'number') {
                    mp.players.forEach(p => { if (p.id === extra.rid) target = p; });
                }
                try { ped.taskFollowToOffsetOfEntity(target.handle, 0,0,0, STEP_SPEED, -1, STOP_DIST, true); } catch {}
                break;
            }
            case 'goMe': {
                let target = me;
                if (extra && typeof extra.rid === 'number') {
                    mp.players.forEach(p => { if (p.id === extra.rid) target = p; });
                }
                const p = target.position;
                try { ped.taskGoStraightToCoord(p.x,p.y,p.z, STEP_SPEED, -1, 0.0, 0.0); } catch {}
                break;
            }
        }
    }catch{}
});

// сервер говорит: "убери этого зомби"
mp.events.add('z:forceRemove', (zid) => {
    try {
        zid = parseInt(zid);
        const obj = zombies.get(zid);
        if(!obj) return;
        const ped = obj.ped;
        if (ped && mp.peds.exists(ped)) {
            try { ped.destroy(); } catch {}
        }
        zombies.delete(zid);
        dlog(`🗑 forceRemove zid=${zid}`);
    } catch {}
});

// сервер говорит: "анимка удара"
mp.events.add('npc:animHit', (zid, targetId) => {
    zid = parseInt(zid);
    const obj = zombies.get(zid);
    if(!obj) return;
    const ped = obj.ped;
    if(!mp.peds.exists(ped)) return;

    const dict='melee@unarmed@streamed_core', name='heavy_punch_a';
    mp.game.streaming.requestAnimDict(dict);
    let i=0; while(!mp.game.streaming.hasAnimDictLoaded(dict) && i++<50) mp.game.wait(10);

    let t = null;
    try { mp.players.forEach(p => { if (p.id === targetId) t = p; }); } catch {}
    if (t && t.handle) {
        try { ped.taskLookAt(t.handle, 300); } catch {}
        try { ped.taskTurnToFaceEntity(t.handle, 250); } catch {}
    }
    ped.taskPlayAnim(dict, name, 8.0, -8.0, 600, 0, 0.0, false, false, false);
});

// сервер: "упал"
mp.events.add('z:dead', (zid) => {
    zid = parseInt(zid);
    const obj = zombies.get(zid);
    if(!obj) return;
    const ped = obj.ped;
    if(!mp.peds.exists(ped)) return;
    try { ped.clearTasksImmediately(); } catch {}
    try { mp.game.ped.setPedToRagdoll(ped.handle, 5000, 5000, 0, false, false, false); } catch {}
    // дальше сервер сам его удалит через z:forceRemove
});

// ====== ДВИЖЕНИЕ У КОНТРОЛЛЕРА (как было) ======
setInterval(() => {
    zombies.forEach((obj, zid) => {
        const ped = obj.ped;
        if (!mp.peds.exists(ped)) return;
        if (!isController(ped)) return;

        // простое “иди ко мне”
        try {
            const dist = me.position.distanceTo(ped.position);
            const now = Date.now();
            if (dist > STOP_DIST) {
                ped.taskFollowToOffsetOfEntity(me.handle, 0,0,0, STEP_SPEED, -1, STOP_DIST, true);
            }
        } catch {}
    });
}, 400);

// ====== HIT: raycast по выстрелу ======

// вспомогательная — пуск луча
function raycastFromCam(dist){
    const camPos = mp.game.cam.getGameplayCamCoord();
    const camRot = mp.game.cam.getGameplayCamRot(2);
    const pitch = camRot.x * Math.PI / 180.0;
    const yaw   = camRot.z * Math.PI / 180.0;

    const dir = {
        x: -Math.sin(yaw) * Math.cos(pitch),
        y:  Math.cos(yaw) * Math.cos(pitch),
        z:  Math.sin(pitch)
    };

    const to = {
        x: camPos.x + dir.x * dist,
        y: camPos.y + dir.y * dist,
        z: camPos.z + dir.z * dist
    };

    // shapeTestRay
    const ray = mp.raycasting.testPointToPoint(camPos, to, [1, 16]); // 8 - ped?, но чаще берут вот так
    return ray;
}

// ловим выстрел
mp.events.add('playerWeaponShot', () => {
    try {
        const hit = raycastFromCam(60.0);
        if (!hit || !hit.entity || hit.entity.type !== 'ped') return;

        const zid = hit.entity.getVariable('zid');
        if (typeof zid !== 'number') return; // не наш

        // пока ставим фиксированный урон
        const dmg = 35;
        mp.events.callRemote('z:hit', zid, dmg);
        dlog(`→ shot raycast hit zid=${zid}, dmg=${dmg}`);
    } catch (e) {
        // ignore
    }
});

// ===== КЛАВИША: убить ближайшего зомби (для теста)
mp.keys.bind(0x6B, true, () => { // NumPad +
    let best = null, bestD = Infinity;
    zombies.forEach((obj, zid) => {
        if (!mp.peds.exists(obj.ped)) return;
        const d = me.position.distanceTo(obj.ped.position);
        if (d < bestD) { bestD = d; best = zid; }
    });
    if (best !== null) {
        chat(`→ kill request zid=${best}`, '#ffcc00');
        mp.events.callRemote('z:hit', best, 200); // гарантированно убьём
    } else {
        chat('нет зомби рядом', '#ff6666');
    }
});

// F7 — вкл/выкл логи
mp.keys.bind(0x76, true, () => {
    VERBOSE = !VERBOSE;
    chat(`[Z] LOGS: ${VERBOSE ? 'ON':'OFF'}`, '#cfc');
});
