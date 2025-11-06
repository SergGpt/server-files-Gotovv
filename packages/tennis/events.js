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
        tennis.onExitCourt(player, shape.courtId);
    },
    "tennis.menu.open": (player) => {
        tennis.openMenu(player);
    },
    "tennis.menu.action": (player, action, value) => {
        tennis.handleMenuAction(player, action, value);
    },
    "tennis.invite.response": (player, accepted) => {
        if (accepted) tennis.handleAccept(player);
        else tennis.handleMenuAction(player, 'declineInvite');
    },
    "tennis.swing": (player, charge, aimX, aimY, aimZ) => {
        if (!player.character) return;
        tennis.handleSwing(player, charge, aimX, aimY, aimZ);
    },
    "playerQuit": (player) => {
        tennis.onPlayerQuit(player);
    },
    "playerDeath": (player) => {
        if (!player.tennisMatch) return;
        player.tennisMatch.stopByPlayer(player);
    }
};
