"use strict";

const tennis = require('./index');

module.exports = {
    "init": () => {
        tennis.init({
            notifications: call('notifications'),
            inventory: call('inventory'),
            money: call('money')
        });
        inited(__dirname);
    },
    "playerEnterColshape": (player, shape) => {
        if (!player.character || !shape || !shape.isTennisCourt) return;
        tennis.onEnterCourt(player, shape.courtId);
    },
    "playerExitColshape": (player, shape) => {
        if (!player.character || !shape || !shape.isTennisCourt) return;
        tennis.onExitCourt(player);
    },
    "tennis.startNpc": (player) => {
        tennis.startNpcMatch(player);
    },
    "tennis.hit": (player, power, x, y, z) => {
        tennis.handlePlayerHit(player, power, x, y, z);
    },
    "tennis.shop.open": (player) => {
        tennis.openShop(player);
    },
    "tennis.shop.buy": (player, index) => {
        tennis.buyShopItem(player, index);
    },
    "tennis.shop.close": (player) => {
        tennis.closeShop(player);
    },
    "playerQuit": (player) => {
        tennis.onPlayerQuit(player);
    },
    "playerDeath": (player) => {
        if (!player || !player.tennisMatch) return;
        player.tennisMatch.stopForced('Матч завершён.');
    }
};
