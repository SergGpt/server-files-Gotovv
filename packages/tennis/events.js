"use strict";

const tennis = require('./index');

module.exports = {
    "init": () => {
        tennis.init({ notifications: call('notifications') });
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
    "tennis.hit": (player, power) => {
        tennis.handlePlayerHit(player, power);
    },
    "playerQuit": (player) => {
        tennis.onPlayerQuit(player);
    },
    "playerDeath": (player) => {
        if (!player || !player.tennisMatch) return;
        player.tennisMatch.stopForced('Матч завершён.');
    }
};
