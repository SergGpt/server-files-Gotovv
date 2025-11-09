"use strict";

module.exports = {
    init: async () => {
        inited(__dirname);
    },
    getPricePerKilometer: () => 10,
    doesClientHaveOrders: () => false,
    addOrder: () => {},
    getOrders: () => [],
    getOrderById: () => null,
    deleteOrder: () => {},
    getRentPrice: () => 0,
    calculatePrice: () => 0,
    calculateComission: () => 0.1,
    deletePlayerOrders: () => {},
    getRespawnTimeout: () => 600000,
};
