"use strict";

let plotMarkers = [];
let plotBlips = [];
let plotObjects = [];
let plotStates = [];
let plotPositions = [];
let currentPlot = null;
let jobPromptActive = false;
let activeAction = null;

const markerColors = {
    available: [124, 194, 91, 120],
    growing: [255, 210, 64, 120],
    ready: [84, 255, 84, 160],
    cooldown: [252, 144, 58, 120],
    planting: [190, 220, 140, 140],
    harvesting: [252, 210, 92, 150],
    busy: [180, 180, 180, 100],
};

const blipColors = {
    available: 52,
    growing: 46,
    ready: 2,
    cooldown: 17,
    planting: 46,
    harvesting: 17,
    busy: 1,
};

const statePlantModels = {
    planting: { model: 'prop_veg_crop_01', zOffset: -0.9 },
    growing: { model: 'prop_veg_crop_04', zOffset: -0.9 },
    ready: { model: 'prop_veg_crop_02', zOffset: -0.9 },
    harvesting: { model: 'prop_veg_crop_02', zOffset: -0.9 },
};

function createMarkers(positions) {
    clearMarkers();
    plotPositions = positions.map(pos => new mp.Vector3(pos.x, pos.y, pos.z));
    plotStates = positions.map(() => ({ state: 'available', visualState: 'available' }));
    plotPositions.forEach((pos, index) => {
        const markerPos = new mp.Vector3(pos.x, pos.y, pos.z - 1);
        plotMarkers[index] = mp.markers.new(1, markerPos, 0.65, {
            color: markerColors.available,
        });
        plotBlips[index] = mp.blips.new(501, pos, {
            name: `Грядка ${index + 1}`,
            color: blipColors.available,
            shortRange: false,
            scale: 0.6,
        });
    });
}

function clearMarkers() {
    plotMarkers.forEach(marker => {
        if (marker && mp.markers.exists(marker)) marker.destroy();
    });
    plotBlips.forEach(blip => {
        if (blip && mp.blips.exists(blip)) blip.destroy();
    });
    plotObjects.forEach(info => {
        if (!info) return;
        const object = info.object;
        if (object && mp.objects.exists(object)) object.destroy();
    });
    plotMarkers = [];
    plotBlips = [];
    plotObjects = [];
    plotStates = [];
    plotPositions = [];
}

function updateMarker(index) {
    if (!plotPositions[index] || !plotStates[index]) return;
    const state = plotStates[index].visualState || plotStates[index].state;
    const color = markerColors[state] || markerColors.busy;
    const pos = plotPositions[index];
    if (plotMarkers[index] && mp.markers.exists(plotMarkers[index])) {
        plotMarkers[index].destroy();
    }
    plotMarkers[index] = mp.markers.new(1, new mp.Vector3(pos.x, pos.y, pos.z - 1), 0.65, {
        color,
    });
    const blip = plotBlips[index];
    if (blip && mp.blips.exists(blip)) {
        const blipColor = blipColors[state] || blipColors.busy;
        blip.setColour(blipColor);
        blip.setRoute(false);
    }
    updatePlotObject(index, state);
}

function updatePrompt() {
    if (!currentPlot) {
        if (jobPromptActive) {
            mp.prompt.show('Нажмите <span>E</span>, чтобы устроиться фермером');
        } else {
            mp.prompt.hide();
        }
        return;
    }
    const action = currentPlot.action;
    const state = currentPlot.state;
    const visualState = currentPlot.visualState || state;
    const timeLeft = currentPlot.timeLeft;
    if (action === 'plant') {
        mp.prompt.show('Нажмите <span>E</span>, чтобы посадить семя');
    } else if (action === 'harvest') {
        mp.prompt.show('Нажмите <span>E</span>, чтобы собрать урожай');
    } else if (state === 'growing' && timeLeft) {
        const seconds = Math.ceil(timeLeft / 1000);
        mp.prompt.show(`Грядка созревает (~${seconds} сек.)`);
    } else if (state === 'cooldown' && timeLeft) {
        const seconds = Math.ceil(timeLeft / 1000);
        mp.prompt.show(`Грядка восстанавливается (~${seconds} сек.)`);
    } else if (state === 'planting' && timeLeft) {
        const seconds = Math.ceil(timeLeft / 1000);
        mp.prompt.show(`Посадка в процессе (~${seconds} сек.)`);
    } else if (state === 'harvesting' && timeLeft) {
        const seconds = Math.ceil(timeLeft / 1000);
        mp.prompt.show(`Сбор урожая (~${seconds} сек.)`);
    } else if (state === 'busy') {
        if (visualState === 'growing') {
            mp.prompt.show('Грядка занята: посевы растут');
        } else if (visualState === 'planting') {
            mp.prompt.show('Грядка занята: идет посадка');
        } else if (visualState === 'harvesting') {
            mp.prompt.show('Грядка занята: урожай собирают');
        } else {
            mp.prompt.show('Грядка занята другим фермером');
        }
    } else {
        mp.prompt.hide();
    }
}

function applyPlotUpdate(index, data) {
    if (!plotStates[index]) plotStates[index] = {};
    const update = Object.assign({}, plotStates[index], data || {});
    if (!data || !Object.prototype.hasOwnProperty.call(data, 'timeLeft')) update.timeLeft = null;
    if (!data || !Object.prototype.hasOwnProperty.call(data, 'action')) update.action = null;
    plotStates[index] = update;
    updateMarker(index);
    if (currentPlot && currentPlot.index === index) {
        currentPlot = Object.assign({}, currentPlot, data || {});
        if (!data || !Object.prototype.hasOwnProperty.call(data, 'timeLeft')) currentPlot.timeLeft = null;
        if (!data || !Object.prototype.hasOwnProperty.call(data, 'action')) currentPlot.action = null;
        updatePrompt();
    }
}

function updatePlotObject(index, state) {
    if (!plotPositions[index]) return;
    const info = plotObjects[index];
    const desired = statePlantModels[state];
    if (!desired) {
        if (info && info.object && mp.objects.exists(info.object)) info.object.destroy();
        plotObjects[index] = null;
        return;
    }
    if (info && info.model === desired.model && info.object && mp.objects.exists(info.object)) {
        return;
    }
    if (info && info.object && mp.objects.exists(info.object)) info.object.destroy();
    const pos = plotPositions[index];
    const spawnPos = new mp.Vector3(pos.x, pos.y, pos.z + (desired.zOffset || 0));
    const object = mp.objects.new(mp.game.joaat(desired.model), spawnPos, { rotation: new mp.Vector3(0, 0, 0) });
    plotObjects[index] = { object, model: desired.model };
}

function clearAction() {
    if (!activeAction) return;
    if (activeAction.timer) mp.timer.remove(activeAction.timer);
    if (mp.busy.includes('farm.action')) mp.busy.remove('farm.action');
    mp.utils.disablePlayerMoving(false);
    mp.players.local.clearTasksImmediately();
    activeAction = null;
}

function createPeds() {
    [
        {
            model: "a_m_m_farmer_01",
            position: { x: 2025.118, y: 4985.632, z: 41.054 },
            heading: 52.0,
        },
        {
            model: "ig_old_man1a",
            position: { x: 2020.612, y: 4978.941, z: 41.054 },
            heading: 220.0,
        }
    ].forEach(data => mp.events.call('NPC.create', data));
}

mp.events.add({
    'characterInit.done': () => {
        createPeds();
    },
    'farms.plots.init': (positions) => {
        if (!Array.isArray(positions)) positions = [];
        createMarkers(positions);
    },
    'farms.plot.update': (index, info) => {
        index = parseInt(index);
        if (isNaN(index)) return;
        applyPlotUpdate(index, info);
    },
    'farms.plot.enter': (index, info) => {
        index = parseInt(index);
        if (isNaN(index)) return;
        currentPlot = Object.assign({ index }, info || {});
        updatePrompt();
    },
    'farms.plot.exit': () => {
        currentPlot = null;
        updatePrompt();
    },
    'farms.plot.ready': (index) => {
        index = parseInt(index);
        if (isNaN(index) || !plotStates[index]) return;
        plotStates[index].state = 'ready';
        plotStates[index].visualState = 'ready';
        updateMarker(index);
    },
    'farms.menu.show': (data) => {
        mp.callCEFV(`selectMenu.menus['farmsMain'].init(${JSON.stringify(data)})`);
        mp.callCEFV(`selectMenu.showByName('farmsMain')`);
    },
    'farms.vendor.show': (data) => {
        mp.callCEFV(`selectMenu.menus['farmsVendor'].init(${JSON.stringify(data)})`);
        mp.callCEFV(`selectMenu.showByName('farmsVendor')`);
    },
    'farms.menu.update': (data) => {
        mp.callCEFV(`(function(){var info=${JSON.stringify(data)};if(selectMenu.menus['farmsMain'])selectMenu.menus['farmsMain'].update(info);if(selectMenu.menus['farmsVendor'])selectMenu.menus['farmsVendor'].update(info);})()`);
    },
    'farms.menu.hide': () => {
        mp.callCEFV(`if (selectMenu.current && selectMenu.current.name === 'farmsMain') selectMenu.show = false;`);
    },
    'farms.vendor.hide': () => {
        mp.callCEFV(`if (selectMenu.current && selectMenu.current.name === 'farmsVendor') selectMenu.show = false;`);
    },
    'farms.reset': () => {
        clearMarkers();
        currentPlot = null;
        jobPromptActive = false;
        mp.prompt.hide();
        clearAction();
    },
    'farms.job.prompt': (state) => {
        jobPromptActive = !!state;
        updatePrompt();
    },
    'farms.action.start': (type, duration) => {
        clearAction();
        if (!mp.busy.add('farm.action', false)) return;
        mp.utils.disablePlayerMoving(true);
        const scenario = type === 'harvest' ? 'WORLD_HUMAN_GARDENER_LEAF_BLOWER' : 'WORLD_HUMAN_GARDENER_PLANT';
        mp.players.local.taskStartScenarioInPlace(scenario, 0, true);
        let ms = parseInt(duration);
        if (isNaN(ms) || ms <= 0) ms = 3000;
        activeAction = {
            timer: mp.timer.add(() => {
                mp.players.local.clearTasksImmediately();
                mp.utils.disablePlayerMoving(false);
                if (mp.busy.includes('farm.action')) mp.busy.remove('farm.action');
                activeAction = null;
            }, ms + 150),
        };
    },
    'farms.action.stop': (wasCanceled) => {
        if (activeAction && activeAction.timer) mp.timer.remove(activeAction.timer);
        if (mp.busy.includes('farm.action')) mp.busy.remove('farm.action');
        mp.utils.disablePlayerMoving(false);
        mp.players.local.clearTasksImmediately();
        if (wasCanceled) mp.prompt.hide();
        activeAction = null;
        updatePrompt();
    }
});

mp.keys.bind(0x45, true, () => {
    if (mp.busy.includes()) return;
    if (jobPromptActive && !currentPlot) {
        mp.events.callRemote('farms.job.join');
        return;
    }
    if (!currentPlot) return;
    if (currentPlot.action === 'plant') {
        mp.events.callRemote('farms.plot.plant', currentPlot.index);
        mp.prompt.hide();
    } else if (currentPlot.action === 'harvest') {
        mp.events.callRemote('farms.plot.harvest', currentPlot.index);
        mp.prompt.hide();
    }
});

mp.events.add('playerQuit', () => {
    currentPlot = null;
    jobPromptActive = false;
    mp.prompt.hide();
    clearAction();
});
