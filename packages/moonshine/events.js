"use strict";

const moonshine = require('./index');
const notifs = call('notifications');

module.exports = {
    "init": () => {
        moonshine.init();
        inited(__dirname);
    },
    "shutdown": () => {
        moonshine.shutdown();
    },
    "characterInit.done": (player) => {
        moonshine.syncPlayer(player);
    },
    "playerQuit": (player) => {
        moonshine.cleanupPlayer(player);
    },
    "moonshine.menu.request": (player) => {
        if (!player || !player.character) return;
        if (player.moonshineVendorId !== moonshine.vendor.id) return notifs.error(player, 'Подойдите ближе к самогонщику', moonshine.vendor.title);
        moonshine.showMenu(player);
    },
    "moonshine.production.start": (player) => {
        moonshine.startProduction(player);
    },
    "moonshine.production.collect": (player) => {
        moonshine.collectProduction(player);
    },
    "moonshine.production.cancel": (player) => {
        moonshine.cancelProduction(player);
    },
};
