const autoRobber = require('./index');

module.exports = {
    init: () => {
        autoRobber.init();
        inited(__dirname);
    },
    playerEnterColshape: (player, shape) => {
        if (!player.character) return;
        if (shape === autoRobber.startColshape) {
            autoRobber.onStartColshapeEnter(player);
        }
        if (shape === autoRobber.deliveryColshape) {
            autoRobber.completeOrder(player);
        }
    },
    playerExitColshape: (player, shape) => {
        if (!player.character) return;
        if (shape === autoRobber.startColshape) {
            autoRobber.onStartColshapeExit(player);
        }
    },
    'autoroober.order.request': (player) => {
        autoRobber.createOrder(player);
    },
    'autoroober.order.expired': (player) => {
        autoRobber.expireOrder(player, 'time');
    },
    playerQuit: (player) => {
        autoRobber.cleanupPlayer(player);
    },
    'death.spawn': (player) => {
        autoRobber.cleanupPlayer(player);
    },
    playerStartEnterVehicle: (player, vehicle, seat) => {
        if (seat !== 0) return;
        autoRobber.onVehicleStartEnter(player, vehicle);
    },
    playerEnterVehicle: (player, vehicle, seat) => {
        autoRobber.onVehicleEnter(player, vehicle, seat);
    },
};
