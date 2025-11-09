"use strict";

let vendorId = null;
let vendorTitle = '';
let spawned = false;

function ensurePed(config) {
    if (spawned || !config || !config.ped) return;
    mp.events.call('NPC.create', config.ped);
    spawned = true;
}

function showPrompt() {
    if (!vendorId) return;
    const title = vendorTitle || 'Самогонщик';
    mp.prompt.show(`Нажмите <span>E</span>, чтобы поговорить с «${title}»`);
}

mp.events.add({
    'moonshine.init': (json) => {
        if (!json) return;
        let data;
        try {
            data = JSON.parse(json);
        } catch (e) {
            mp.console.logInfo(`moonshine.init parse error: ${e.message}`);
            return;
        }
        ensurePed(data);
    },
    'moonshine.prompt': (id, title) => {
        if (!id) {
            vendorId = null;
            vendorTitle = '';
            mp.prompt.hide();
            return;
        }
        vendorId = id;
        vendorTitle = title || 'Самогонщик';
        showPrompt();
    },
    'moonshine.menu.show': (json) => {
        if (!json) return;
        if (mp.busy && mp.busy.add) mp.busy.add('moonshine', false);
        mp.prompt.hide();
        mp.callCEFV(`selectMenu.menus['moonshine'].init(${json});`);
        mp.events.call('selectMenu.show', 'moonshine');
    },
    'moonshine.menu.update': (json) => {
        if (!json) return;
        mp.callCEFV(`if (selectMenu.menus['moonshine']) selectMenu.menus['moonshine'].update(${json});`);
    },
    'moonshine.menu.hide': () => {
        mp.callCEFV(`if (selectMenu.menu && selectMenu.menu.name === 'moonshine') selectMenu.show = false;`);
        if (mp.busy && mp.busy.remove) mp.busy.remove('moonshine');
        if (vendorId) showPrompt();
        else mp.prompt.hide();
    },
    'moonshine.menu.closed': () => {
        mp.events.call('moonshine.menu.hide');
    },
});

mp.keys.bind(0x45, true, () => {
    if (!vendorId) return;
    if (mp.busy && mp.busy.includes && mp.busy.includes()) return;
    mp.events.callRemote('moonshine.menu.request');
    mp.prompt.hide();
});

mp.events.add('playerQuit', () => {
    vendorId = null;
    vendorTitle = '';
    if (mp.busy && mp.busy.remove) mp.busy.remove('moonshine');
    mp.prompt.hide();
});
