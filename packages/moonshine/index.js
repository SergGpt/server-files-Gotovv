"use strict";

const money = call('money');
const notifs = call('notifications');
const timer = call('timer');

const TITLE = 'Самогонщик';

module.exports = {
    vendor: {
        id: 'moonshine_vendor',
        title: TITLE,
        ped: {
            model: 'a_m_m_hillbilly_01',
            position: { x: 1393.939, y: 3613.354, z: 37.939 },
            heading: 205.0,
            defaultScenario: 'WORLD_HUMAN_SMOKING',
            marker: {
                x: 1394.187,
                y: 3611.945,
                z: 36.939,
                color: [200, 160, 60, 120],
            },
            blip: {
                sprite: 93,
                position: { x: 1394.187, y: 3611.945, z: 36.939 },
                color: 46,
                name: TITLE,
            },
        },
        interactionRadius: 1.6,
    },

    rewardPerBatch: 600,
    brewTimeRange: [4 * 60 * 1000, 6 * 60 * 1000],

    players: new Map(),
    clientConfig: null,
    vendorMarker: null,
    vendorColshape: null,
    vendorBlip: null,

    init() {
        this.createVendorZone();
        this.prepareClientConfig();
        mp.players.forEach(player => this.syncPlayer(player));
    },

    shutdown() {
        this.destroyVendorZone();
        this.players.forEach(state => this.clearState(state));
        this.players.clear();
        this.clientConfig = null;
    },

    prepareClientConfig() {
        const vendor = this.vendor;
        const data = {
            id: vendor.id,
            title: vendor.title,
            ped: {
                model: vendor.ped.model,
                position: vendor.ped.position,
                heading: vendor.ped.heading,
                defaultScenario: vendor.ped.defaultScenario,
                marker: vendor.ped.marker,
                blip: vendor.ped.blip,
            },
        };
        this.clientConfig = JSON.stringify(data);
    },

    syncPlayer(player) {
        if (!player || !player.call) return;
        if (!this.clientConfig) this.prepareClientConfig();
        player.call('moonshine.init', [this.clientConfig]);
    },

    createVendorZone() {
        const pedData = this.vendor.ped;
        if (pedData.marker) {
            const pos = new mp.Vector3(pedData.marker.x, pedData.marker.y, pedData.marker.z);
            this.vendorMarker = mp.markers.new(1, pos, 0.75, { color: pedData.marker.color || [200, 160, 60, 120] });
        }
        const radius = this.vendor.interactionRadius || 1.5;
        const targetPos = pedData.marker ? pedData.marker : pedData.position;
        this.vendorColshape = mp.colshapes.newSphere(targetPos.x, targetPos.y, targetPos.z, radius);
        this.vendorColshape.onEnter = (player) => this.onEnter(player);
        this.vendorColshape.onExit = (player) => this.onExit(player);
        const blipData = pedData.blip;
        if (blipData) {
            const blipPos = new mp.Vector3(blipData.position.x, blipData.position.y, blipData.position.z);
            this.vendorBlip = mp.blips.new(blipData.sprite || 93, blipPos, {
                name: blipData.name || TITLE,
                color: blipData.color || 46,
                shortRange: true,
                scale: 0.9,
            });
        }
    },

    destroyVendorZone() {
        if (this.vendorMarker) {
            this.vendorMarker.destroy();
            this.vendorMarker = null;
        }
        if (this.vendorColshape) {
            this.vendorColshape.destroy();
            this.vendorColshape = null;
        }
        if (this.vendorBlip) {
            this.vendorBlip.destroy();
            this.vendorBlip = null;
        }
    },

    onEnter(player) {
        if (!player || !player.character) return;
        player.moonshineVendorId = this.vendor.id;
        player.call('moonshine.prompt', [this.vendor.id, this.vendor.title]);
    },

    onExit(player) {
        if (!player) return;
        if (player.moonshineVendorId === this.vendor.id) delete player.moonshineVendorId;
        player.call('moonshine.prompt');
        player.call('moonshine.menu.hide');
    },

    ensureState(player) {
        let state = this.players.get(player.id);
        if (!state) {
            state = {
                playerId: player.id,
                active: false,
                ready: false,
                timer: null,
                startedAt: null,
                readyAt: null,
                duration: 0,
                completed: 0,
            };
            this.players.set(player.id, state);
        }
        return state;
    },

    clearState(state) {
        if (!state) return;
        if (state.timer) {
            timer.remove(state.timer);
            state.timer = null;
        }
    },

    cleanupPlayer(player) {
        if (!player) return;
        const state = this.players.get(player.id);
        if (state) {
            this.clearState(state);
            this.players.delete(player.id);
        }
        if (player.moonshineVendorId) delete player.moonshineVendorId;
    },

    randomDuration() {
        const [min, max] = this.brewTimeRange;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    collectMenuData(player) {
        const state = this.ensureState(player);
        const now = Date.now();
        const timeLeft = state.active && state.readyAt ? Math.max(0, state.readyAt - now) : 0;
        let status = 'Производство остановлено';
        if (state.ready) status = 'Партия готова';
        else if (state.active) status = 'Перегонка в процессе';
        return {
            status,
            timeLeft,
            active: state.active,
            ready: state.ready,
            reward: this.rewardPerBatch,
            completed: state.completed || 0,
        };
    },

    showMenu(player) {
        const data = this.collectMenuData(player);
        player.call('moonshine.menu.show', [JSON.stringify(data)]);
    },

    updateMenu(player) {
        const data = this.collectMenuData(player);
        player.call('moonshine.menu.update', [JSON.stringify(data)]);
    },

    startProduction(player) {
        if (!player || !player.character) return;
        if (player.moonshineVendorId !== this.vendor.id) return notifs.error(player, 'Подойдите ближе к самогонщику', this.vendor.title);
        const state = this.ensureState(player);
        if (state.ready) return notifs.warning(player, 'Заберите готовую партию', this.vendor.title);
        if (state.active) return notifs.warning(player, 'Перегонка уже запущена', this.vendor.title);

        const duration = this.randomDuration();
        state.active = true;
        state.ready = false;
        state.startedAt = Date.now();
        state.readyAt = state.startedAt + duration;
        state.duration = duration;
        this.clearState(state);
        const weakPlayer = player;
        state.timer = timer.add(() => {
            if (!weakPlayer || !mp.players.exists(weakPlayer)) {
                state.active = false;
                state.ready = true;
                state.timer = null;
                state.readyAt = Date.now();
                return;
            }
            this.finishProduction(weakPlayer);
        }, duration);

        notifs.info(player, `Перегонка запущена (~${Math.ceil(duration / 60000)} мин.)`, this.vendor.title);
        this.updateMenu(player);
    },

    finishProduction(player) {
        const state = this.ensureState(player);
        state.active = false;
        state.ready = true;
        state.timer = null;
        state.readyAt = Date.now();
        notifs.success(player, 'Партия самогона готова', this.vendor.title);
        this.updateMenu(player);
    },

    collectProduction(player) {
        if (!player || !player.character) return;
        if (player.moonshineVendorId !== this.vendor.id) return notifs.error(player, 'Подойдите ближе к самогонщику', this.vendor.title);
        const state = this.ensureState(player);
        if (!state.ready) return notifs.warning(player, 'Партия еще не готова', this.vendor.title);

        const reward = this.rewardPerBatch;
        money.addCash(player, reward, (res) => {
            if (!res) return notifs.error(player, 'Не удалось выдать деньги', this.vendor.title);
            state.ready = false;
            state.active = false;
            state.startedAt = null;
            state.readyAt = null;
            state.duration = 0;
            state.completed = (state.completed || 0) + 1;
            notifs.success(player, `Вы получили $${reward} за партию самогона`, this.vendor.title);
            this.updateMenu(player);
        }, 'Продажа самогона');
    },

    cancelProduction(player) {
        if (!player || !player.character) return;
        if (player.moonshineVendorId !== this.vendor.id) return notifs.error(player, 'Подойдите ближе к самогонщику', this.vendor.title);
        const state = this.ensureState(player);
        if (!state.active && !state.ready) return notifs.info(player, 'Производство не запущено', this.vendor.title);

        this.clearState(state);
        state.active = false;
        state.ready = false;
        state.startedAt = null;
        state.readyAt = null;
        state.duration = 0;
        notifs.info(player, 'Вы остановили производство самогона', this.vendor.title);
        this.updateMenu(player);
    },
};
