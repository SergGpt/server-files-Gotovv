"use strict";

let notifs = call("notifications");
let money = call("money");
let jobs = call("jobs");
let timer = call("timer");

const JOB_ID = 12;

const ACTION_DURATION = 3000;

module.exports = {
    jobId: JOB_ID,
    harvestPerSeed: 1,
    seedsPrice: 25,
    exchangeRateRange: [45, 95],
    exchangeChangeInterval: 60 * 60 * 1000,
    baseGrowthRange: [60 * 1000, 120 * 1000],
    baseCooldownRange: [60 * 1000, 120 * 1000],
    levelReductionMs: 2000,
    minProcessTime: 10 * 1000,
    harvestsPerLevel: 100,
    maxLevel: 20,
    farmMenuPos: new mp.Vector3(2024.585, 4985.102, 41.054 - 1),
    vendorPos: new mp.Vector3(2019.842, 4978.912, 41.054 - 1),
    fieldConfig: {
        origin: new mp.Vector3(2030.0, 4994.0, 41.054),
        rows: 6,
        cols: 6,
        spacing: 2.0,
        heading: 0.0,
    },
    plotsData: [],

    plots: [],
    exchangeRate: 60,
    exchangeTimer: null,

    init() {
        this.generatePlots();
        this.createFarmMenuZone();
        this.createVendorZone();
        this.createPlots();
        this.updateExchangeRate(true);
        this.exchangeTimer = timer.addInterval(() => this.updateExchangeRate(), this.exchangeChangeInterval);

        mp.players.forEach(player => {
            if (!player || !player.character) return;
            if (player.character.job === this.jobId) {
                this.startJob(player);
            }
        });
    },

    shutdown() {
        if (this.exchangeTimer) timer.remove(this.exchangeTimer);
        this.plots.forEach(plot => {
            if (plot.growthTimer) timer.remove(plot.growthTimer);
            if (plot.cooldownTimer) timer.remove(plot.cooldownTimer);
        });
    },

    createFarmMenuZone() {
        const pos = this.farmMenuPos;
        mp.markers.new(1, pos, 0.75, { color: [120, 200, 80, 120] });
        const colshape = mp.colshapes.newSphere(pos.x, pos.y, pos.z, 1.5);
        colshape.onEnter = (player) => {
            if (!player || !player.character) return;
            if (!this.isFarmer(player)) {
                player.call('farms.job.prompt', [true]);
                return;
            }
            this.showMainMenu(player);
        };
        colshape.onExit = (player) => {
            if (!player || !player.character) return;
            player.call('farms.menu.hide');
            player.call('farms.job.prompt', [false]);
        };
        mp.blips.new(501, this.adjustBlipPos(pos), {
            name: "Ферма",
            color: 25,
            shortRange: true,
            scale: 0.9
        });
    },

    createVendorZone() {
        const pos = this.vendorPos;
        mp.markers.new(1, pos, 0.75, { color: [200, 140, 40, 120] });
        const colshape = mp.colshapes.newSphere(pos.x, pos.y, pos.z, 1.5);
        colshape.onEnter = (player) => {
            if (!this.isFarmer(player)) {
                if (player && player.character) notifs.warning(player, 'Устройтесь фермером, чтобы продать урожай', 'Ферма');
                return;
            }
            this.showVendorMenu(player);
        };
        colshape.onExit = (player) => {
            if (!player || !player.character) return;
            player.call('farms.vendor.hide');
        };
        mp.blips.new(431, this.adjustBlipPos(pos), {
            name: "Скупщик урожая",
            color: 11,
            shortRange: true,
            scale: 0.9
        });
    },

    adjustBlipPos(pos) {
        return new mp.Vector3(pos.x, pos.y, pos.z + 1.5);
    },

    generatePlots() {
        const config = this.fieldConfig;
        this.plotsData = [];
        if (!config || !config.rows || !config.cols) return;
        const rows = Math.max(1, parseInt(config.rows));
        const cols = Math.max(1, parseInt(config.cols));
        const spacing = parseFloat(config.spacing) || 2.0;
        const heading = (parseFloat(config.heading) || 0) * Math.PI / 180;
        const base = config.origin || new mp.Vector3(0, 0, 0);
        const forwardX = Math.cos(heading) * spacing;
        const forwardY = Math.sin(heading) * spacing;
        const rightX = -Math.sin(heading) * spacing;
        const rightY = Math.cos(heading) * spacing;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = base.x + forwardX * row + rightX * col;
                const y = base.y + forwardY * row + rightY * col;
                this.plotsData.push({ x, y, z: base.z });
            }
        }
    },

    createPlots() {
        this.plots = this.plotsData.map((plotData, index) => {
            const position = new mp.Vector3(plotData.x, plotData.y, plotData.z);
            const colshape = mp.colshapes.newSphere(position.x, position.y, position.z, 1.2);
            colshape.farmPlotId = index;
            colshape.onEnter = (player) => this.onPlotEnter(player, index);
            colshape.onExit = (player) => this.onPlotExit(player, index);

            return {
                index,
                position,
                state: 'empty',
                ownerId: null,
                ownerName: null,
                readyAt: null,
                cooldownAt: null,
                colshape,
                growthTimer: null,
                cooldownTimer: null,
                actionEndsAt: null,
                actionId: null,
            };
        });
    },

    startJob(player) {
        const data = this.ensureJobData(player);
        data.seeds = data.seeds || 0;
        data.harvest = data.harvest || 0;
        player.call('farms.job.prompt', [false]);
        this.syncPlotsForPlayer(player);
        this.sendMenuUpdate(player);
        notifs.info(player, 'Вы приступили к работе фермера', 'Ферма');
    },

    stopJob(player) {
        if (!player) return;
        this.cancelPlayerAction(player, true);
        this.releasePlayerPlots(player);
        if (player.farmJob) delete player.farmJob;
        player.call('farms.reset');
        player.call('farms.menu.hide');
        player.call('farms.vendor.hide');
        player.call('farms.job.prompt', [false]);
    },

    cleanupPlayer(player) {
        if (!player) return;
        this.cancelPlayerAction(player, true);
        this.releasePlayerPlots(player);
    },

    releasePlayerPlots(player) {
        if (!player) return;
        this.plots.forEach((plot, index) => {
            if (plot.ownerId === player.id) {
                if (plot.growthTimer) timer.remove(plot.growthTimer);
                plot.growthTimer = null;
                if (plot.cooldownTimer) timer.remove(plot.cooldownTimer);
                plot.cooldownTimer = null;
                if (plot.actionId) {
                    plot.actionId = null;
                    plot.actionEndsAt = null;
                }
                plot.ownerId = null;
                plot.ownerName = null;
                plot.readyAt = null;
                plot.cooldownAt = null;
                plot.state = 'empty';
                this.broadcastPlotUpdate(index);
            }
            if (plot.state === 'planting' || plot.state === 'harvesting') {
                plot.state = 'empty';
                plot.ownerId = null;
                plot.ownerName = null;
                plot.actionEndsAt = null;
                plot.actionId = null;
                this.broadcastPlotUpdate(index);
            }
        });
    },

    ensureJobData(player) {
        if (!player.farmJob) {
            player.farmJob = {
                seeds: 0,
                harvest: 0,
            };
        }
        return player.farmJob;
    },

    requestJob(player) {
        if (!player || !player.character) return;
        if (player.character.job === this.jobId) {
            this.showMainMenu(player);
            return;
        }

        mp.events.call('jobs.set', player, this.jobId);

        if (player.character.job === this.jobId) {
            player.call('farms.job.prompt', [false]);
            this.showMainMenu(player);
        }
    },

    isFarmer(player) {
        return player && player.character && player.character.job === this.jobId;
    },

    onPlotEnter(player, index) {
        if (!this.isFarmer(player)) return;
        const plot = this.plots[index];
        if (!plot) return;
        const info = this.serializePlotForPlayer(plot, player);
        player.call('farms.plot.enter', [index, info]);
    },

    onPlotExit(player, index) {
        if (!player || !player.character) return;
        player.call('farms.plot.exit', [index]);
    },

    plantSeed(player, index) {
        if (!this.isFarmer(player)) return;
        const plot = this.plots[index];
        if (!plot) return notifs.error(player, 'Грядка не найдена', 'Ферма');
        if (player.farmAction) return notifs.warning(player, 'Завершите текущее действие', 'Ферма');
        if (plot.state !== 'empty') {
            if (plot.state === 'growing') return notifs.warning(player, 'Эта грядка уже занята посевами', 'Ферма');
            if (plot.state === 'ready') return notifs.warning(player, 'Сначала соберите урожай с этой грядки', 'Ферма');
            if (plot.state === 'cooldown') return notifs.warning(player, 'Грядка восстанавливается', 'Ферма');
            if (plot.state === 'planting' || plot.state === 'harvesting') return notifs.warning(player, 'Грядка сейчас занята', 'Ферма');
            return notifs.warning(player, 'Эта грядка недоступна', 'Ферма');
        }

        const data = this.ensureJobData(player);
        if (!data.seeds || data.seeds <= 0) return notifs.warning(player, 'У вас нет семян', 'Ферма');

        data.seeds--;
        plot.state = 'planting';
        plot.ownerId = player.id;
        plot.ownerName = player.name;
        plot.actionEndsAt = Date.now() + ACTION_DURATION;
        plot.actionId = null;
        this.sendMenuUpdate(player);
        this.refreshPlayerPlots(player);

        const complete = (actionPlayer) => {
            const levelOwner = actionPlayer && actionPlayer.character ? this.getPlayerLevel(actionPlayer) : 0;
            const growthTime = this.getProcessTime(this.baseGrowthRange, levelOwner);

            plot.state = 'growing';
            plot.readyAt = Date.now() + growthTime;
            plot.actionEndsAt = null;
            plot.actionId = null;
            plot.growthTimer = timer.add(() => this.setPlotReady(index), growthTime);

            this.broadcastPlotUpdate(index);
            if (actionPlayer && actionPlayer.character) {
                notifs.info(actionPlayer, `Семя посажено. Время роста ~ ${Math.round(growthTime / 1000)} сек.`, 'Ферма');
                this.refreshPlayerPlots(actionPlayer);
            }
        };

        const cancel = (actionPlayer, _plotRef, silentCancel) => {
            plot.state = 'empty';
            plot.ownerId = null;
            plot.ownerName = null;
            plot.actionEndsAt = null;
            plot.actionId = null;
            if (actionPlayer && actionPlayer.character) {
                const jobData = this.ensureJobData(actionPlayer);
                jobData.seeds = (jobData.seeds || 0) + 1;
                this.sendMenuUpdate(actionPlayer);
                this.refreshPlayerPlots(actionPlayer);
                if (!silentCancel) notifs.warning(actionPlayer, 'Посадка прервана', 'Ферма');
            }
            this.broadcastPlotUpdate(index);
        };

        this.beginPlotAction(player, index, 'plant', complete, cancel);
    },

    setPlotReady(index) {
        const plot = this.plots[index];
        if (!plot) return;
        plot.growthTimer = null;
        if (plot.state !== 'growing') return;

        plot.state = 'ready';
        plot.readyAt = null;
        const owner = this.getPlotOwner(plot.ownerId);
        if (owner) {
            notifs.success(owner, `Грядка №${index + 1} готова к сбору`, 'Ферма');
            owner.call('farms.plot.ready', [index]);
        }
        this.broadcastPlotUpdate(index);
    },

    harvestPlot(player, index) {
        if (!this.isFarmer(player)) return;
        const plot = this.plots[index];
        if (!plot) return notifs.error(player, 'Грядка не найдена', 'Ферма');
        if (player.farmAction) return notifs.warning(player, 'Завершите текущее действие', 'Ферма');
        if (plot.state !== 'ready') {
            if (plot.state === 'growing') return notifs.warning(player, 'Урожай еще созревает', 'Ферма');
            if (plot.state === 'cooldown') return notifs.warning(player, 'Грядка восстанавливается', 'Ферма');
            if (plot.state === 'planting' || plot.state === 'harvesting') return notifs.warning(player, 'Грядка сейчас занята', 'Ферма');
            return notifs.warning(player, 'Эта грядка пока недоступна', 'Ферма');
        }
        if (plot.ownerId !== player.id) return notifs.error(player, 'Вы не сажали эту грядку', 'Ферма');

        plot.state = 'harvesting';
        plot.actionEndsAt = Date.now() + ACTION_DURATION;
        plot.actionId = null;

        const complete = (actionPlayer) => {
            plot.ownerId = null;
            plot.ownerName = null;
            const levelOwner = actionPlayer && actionPlayer.character ? this.getPlayerLevel(actionPlayer) : 0;
            const cooldownTime = this.getProcessTime(this.baseCooldownRange, levelOwner);
            plot.cooldownAt = Date.now() + cooldownTime;
            if (plot.cooldownTimer) timer.remove(plot.cooldownTimer);
            plot.cooldownTimer = timer.add(() => this.resetPlot(index), cooldownTime);
            plot.state = 'cooldown';
            plot.actionEndsAt = null;
            plot.actionId = null;

            if (actionPlayer && actionPlayer.character) {
                this.registerHarvest(actionPlayer, this.harvestPerSeed);
            }
            this.broadcastPlotUpdate(index);
            if (actionPlayer && actionPlayer.character) {
                notifs.success(actionPlayer, 'Вы собрали урожай', 'Ферма');
                this.refreshPlayerPlots(actionPlayer);
            }
        };

        const cancel = (actionPlayer, _plotRef, silentCancel) => {
            plot.state = 'ready';
            plot.actionEndsAt = null;
            plot.actionId = null;
            if (actionPlayer && actionPlayer.character) {
                this.refreshPlayerPlots(actionPlayer);
                if (!silentCancel) notifs.warning(actionPlayer, 'Сбор урожая прерван', 'Ферма');
            }
            this.broadcastPlotUpdate(index);
        };

        this.beginPlotAction(player, index, 'harvest', complete, cancel);
    },

    resetPlot(index) {
        const plot = this.plots[index];
        if (!plot) return;
        plot.cooldownTimer = null;
        plot.cooldownAt = null;
        if (plot.state !== 'cooldown') return;
        plot.state = 'empty';
        this.broadcastPlotUpdate(index);
    },

    registerHarvest(player, amount) {
        const data = this.ensureJobData(player);
        data.harvest = (data.harvest || 0) + amount;

        const skill = jobs.getJobSkill(player, this.jobId);
        if (skill) {
            const harvestExp = this.getHarvestExp(amount);
            const maxExp = this.maxLevel * this.getExpPerLevel();
            const oldExp = skill.exp;
            const desired = Math.min(maxExp, oldExp + harvestExp);
            const target = oldExp + (desired - oldExp) / jobs.bonusSkill;
            jobs.setJobExp(player, skill, target);
        }
        this.sendMenuUpdate(player);
    },

    getHarvestExp(amount) {
        return amount * (this.getExpPerLevel() / this.harvestsPerLevel);
    },

    buySeeds(player, amount) {
        if (!this.isFarmer(player)) return;
        amount = parseInt(amount);
        if (isNaN(amount) || amount <= 0) return notifs.error(player, 'Некорректное количество семян', 'Ферма');
        amount = Math.clamp(amount, 1, 100);
        const price = amount * this.seedsPrice;
        money.removeCash(player, price, (res) => {
            if (!res) return notifs.error(player, 'Недостаточно наличных', 'Ферма');
            const data = this.ensureJobData(player);
            data.seeds = (data.seeds || 0) + amount;
            this.sendMenuUpdate(player);
            this.refreshPlayerPlots(player);
            notifs.success(player, `Куплено ${amount} семян`, 'Ферма');
        }, 'Покупка семян');
    },

    sellHarvest(player) {
        if (!this.isFarmer(player)) return;
        const data = this.ensureJobData(player);
        if (!data.harvest || data.harvest <= 0) return notifs.warning(player, 'У вас нет урожая для продажи', 'Ферма');
        const amount = data.harvest;
        const payout = amount * this.exchangeRate;
        money.addCash(player, payout, (res) => {
            if (!res) return notifs.error(player, 'Не удалось выдать деньги', 'Ферма');
            data.harvest = 0;
            this.sendMenuUpdate(player);
            notifs.success(player, `Вы продали ${amount} ед. урожая за $${payout}`, 'Ферма');
        }, 'Продажа урожая');
    },

    showMainMenu(player) {
        if (!this.isFarmer(player)) return;
        this.sendMenuUpdate(player);
        player.call('farms.menu.show', [this.collectMenuData(player)]);
    },

    showVendorMenu(player) {
        if (!this.isFarmer(player)) return;
        this.sendMenuUpdate(player);
        player.call('farms.vendor.show', [this.collectMenuData(player)]);
    },

    syncPlotsForPlayer(player) {
        if (!this.isFarmer(player)) return;
        const positions = this.plotsData.map(plot => ({ x: plot.x, y: plot.y, z: plot.z }));
        player.call('farms.plots.init', [positions]);
        this.refreshPlayerPlots(player);
    },

    refreshPlayerPlots(player) {
        if (!this.isFarmer(player)) return;
        this.plots.forEach((plot, index) => {
            const info = this.serializePlotForPlayer(plot, player);
            player.call('farms.plot.update', [index, info]);
        });
    },

    broadcastPlotUpdate(index) {
        const plot = this.plots[index];
        if (!plot) return;
        mp.players.forEach(player => {
            if (!this.isFarmer(player)) return;
            const info = this.serializePlotForPlayer(plot, player);
            player.call('farms.plot.update', [index, info]);
        });
    },

    serializePlotForPlayer(plot, player) {
        const result = {
            state: 'busy',
            action: null,
            timeLeft: null,
            owner: plot.ownerName,
            visualState: plot.state,
        };
        if (!plot) return result;
        const now = Date.now();
        switch (plot.state) {
            case 'empty':
                result.state = 'available';
                result.owner = null;
                result.action = this.ensureJobData(player).seeds > 0 ? 'plant' : null;
                result.visualState = 'available';
                break;
            case 'growing':
                if (plot.ownerId === player.id) {
                    result.state = 'growing';
                    result.owner = null;
                    result.timeLeft = Math.max(0, plot.readyAt - now);
                } else {
                    result.state = 'busy';
                }
                result.visualState = 'growing';
                break;
            case 'ready':
                if (plot.ownerId === player.id) {
                    result.state = 'ready';
                    result.owner = null;
                    result.action = 'harvest';
                } else {
                    result.state = 'busy';
                }
                result.visualState = 'ready';
                break;
            case 'planting':
                if (plot.ownerId === player.id) {
                    result.state = 'planting';
                    result.owner = null;
                    result.timeLeft = Math.max(0, (plot.actionEndsAt || now) - now);
                } else {
                    result.state = 'busy';
                }
                result.visualState = 'planting';
                break;
            case 'harvesting':
                if (plot.ownerId === player.id) {
                    result.state = 'harvesting';
                    result.owner = null;
                    result.timeLeft = Math.max(0, (plot.actionEndsAt || now) - now);
                } else {
                    result.state = 'busy';
                }
                result.visualState = 'harvesting';
                break;
            case 'cooldown':
                result.state = 'cooldown';
                result.owner = null;
                result.timeLeft = Math.max(0, (plot.cooldownAt || now) - now);
                result.visualState = 'cooldown';
                break;
            default:
                result.state = 'busy';
                result.visualState = 'busy';
                break;
        }
        return result;
    },

    getPlotOwner(ownerId) {
        if (ownerId == null) return null;
        return mp.players.at(ownerId);
    },

    getProcessTime(range, level) {
        const min = range[0];
        const max = range[1];
        const randomTime = Math.floor(Math.random() * (max - min + 1)) + min;
        const reduced = randomTime - level * this.levelReductionMs;
        return Math.max(this.minProcessTime, reduced);
    },

    getPlayerLevel(player) {
        const skill = jobs.getJobSkill(player, this.jobId);
        if (!skill) return 0;
        const expPerLevel = this.getExpPerLevel();
        return Math.min(this.maxLevel, Math.floor(skill.exp / expPerLevel));
    },

    getExpPerLevel() {
        return 100 / this.maxLevel;
    },

    collectMenuData(player) {
        const data = this.ensureJobData(player);
        const skill = jobs.getJobSkill(player, this.jobId);
        const exp = skill ? skill.exp : 0;
        const expPerLevel = this.getExpPerLevel();
        const level = Math.min(this.maxLevel, Math.floor(exp / expPerLevel));
        const nextLevelExp = Math.min(this.maxLevel * expPerLevel, (level + 1) * expPerLevel);
        const progress = level >= this.maxLevel ? 1 : (exp - level * expPerLevel) / expPerLevel;
        const totalHarvest = Math.floor(exp / this.getHarvestExp(1));
        const toNext = level >= this.maxLevel ? 0 : Math.max(0, (level + 1) * this.harvestsPerLevel - totalHarvest);

        return {
            level,
            maxLevel: this.maxLevel,
            progress: Math.round(progress * 100),
            seeds: data.seeds || 0,
            harvest: data.harvest || 0,
            totalHarvest: totalHarvest,
            toNext,
            exchangeRate: this.exchangeRate,
            seedPrice: this.seedsPrice,
            estimatedReward: (data.harvest || 0) * this.exchangeRate,
            expPercent: Math.round((exp / (this.maxLevel * expPerLevel)) * 100),
        };
    },

    sendMenuUpdate(player) {
        if (!this.isFarmer(player)) return;
        const info = this.collectMenuData(player);
        player.call('farms.menu.update', [info]);
    },

    updateExchangeRate(initial = false) {
        const [min, max] = this.exchangeRateRange;
        this.exchangeRate = Math.floor(Math.random() * (max - min + 1)) + min;
        if (!initial) {
            mp.players.forEach(player => {
                if (!this.isFarmer(player)) return;
                notifs.info(player, `Курс скупщика обновился: $${this.exchangeRate}`, 'Ферма');
                this.sendMenuUpdate(player);
            });
        }
    },

    beginPlotAction(player, plotIndex, type, onComplete, onCancel) {
        if (!player || !player.character) return;
        const plot = this.plots[plotIndex];
        if (!plot) return;
        if (player.farmAction) {
            notifs.warning(player, 'Вы уже заняты', 'Ферма');
            return;
        }

        const action = {
            playerId: player.id,
            plotIndex,
            type,
            finishAt: Date.now() + ACTION_DURATION,
            onComplete,
            onCancel,
            finished: false,
            timer: null,
            timerId: null,
        };

        action.timer = timer.add(() => this.finishPlotAction(action), ACTION_DURATION);
        if (action.timer) action.timerId = action.timer.id;
        plot.actionEndsAt = action.finishAt;
        plot.actionId = action.timerId;
        player.farmAction = action;
        player.call('farms.action.start', [type, ACTION_DURATION, plotIndex]);
        this.broadcastPlotUpdate(plotIndex);
    },

    finishPlotAction(action, canceled = false) {
        if (!action || action.finished) return;
        action.finished = true;
        const plot = this.plots[action.plotIndex];
        if (plot && plot.actionId === action.timerId) {
            plot.actionId = null;
            plot.actionEndsAt = null;
        }

        const player = mp.players.at(action.playerId);
        if (player && player.farmAction === action) {
            delete player.farmAction;
        }

        if (player) {
            player.call('farms.action.stop', [canceled && !action.silent]);
        }

        if (canceled) {
            if (typeof action.onCancel === 'function') action.onCancel(player, plot, action.silent);
        } else {
            if (typeof action.onComplete === 'function') action.onComplete(player, plot);
        }
    },

    cancelPlayerAction(player, silent = false) {
        if (!player || !player.farmAction) return;
        player.farmAction.silent = silent;
        this.finishPlotAction(player.farmAction, true);
    },
};
