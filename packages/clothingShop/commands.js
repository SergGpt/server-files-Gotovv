module.exports = {
    '/loadcshops': {
        args: '',
        description: 'Загрузка магазов одежды',
        access: 6,
        handler: (player, args) => {
            let data = [ ]
            data.forEach(async (current) => {
                let type;
                switch (current.subclass) {
                    case 'binco': type = 0; break;
                    case 'discount': type = 1; break;
                    case 'suburban': type = 2; break;
                    case 'ponsonbys': type = 3; break;
                }

                await db.Models.ClothingShop.create({
                    class: current.class + 1,
                    bType: type,
                    x: current.pos[0],
                    y: current.pos[1],
                    z: current.pos[2],
                    placeX: current.clothes[0][5][0],
                    placeY: current.clothes[0][5][1],
                    placeZ: current.clothes[0][5][2],
                    placeH: current.clothes[0][6],
                    cameraX: current.clothes[0][7][0],
                    cameraY: current.clothes[0][7][1],
                    cameraZ: current.clothes[0][7][2],
                });
            });
        }
    },

    '/setclshape': {
        args: '[id]',
        description: 'Учстановить колшейп магазина одежды',
        access: 6,
        handler: async (player, args, out) => {
            let id = parseInt(args[0]);
            let shape = mp.colshapes.toArray().find(x => x.clothingShopId === id);
            if (!shape) return out.error('Магазин не найден', player);

            shape.destroy();

            let shop = await db.Models.ClothingShop.findOne({ where: { id } });

            await shop.update({
                x: player.position.x,
                y: player.position.y,
                z: player.position.z - 1.3
            });

            shape = mp.colshapes.newSphere(shop.x, shop.y, shop.z, 1.8);
            shape.isClothingShop = true;
            shape.clothingShopId = id;

            mp.markers.new(1, new mp.Vector3(shop.x, shop.y, shop.z - 0.1), 0.8, {
                color: [50, 168, 82, 128],
                visible: true,
                dimension: 0
            });
        }
    },

    '/testtops': {
        args: '[variation]',
        description: 'Тест топов (компонент 11)',
        access: 6,
        handler: (player, args, out) => {
            let variation = parseInt(args[0]);
            if (isNaN(variation)) {
                return out.error("Используй: /testtops [variation]", player);
            }
            player.setClothes(11, variation, 0, 0);
            out.info(`Установлен топ variation=${variation}, texture=0`, player);
        }
    },

        '/scantops': {
        args: '[from] [to]',
        description: 'Перебор топов (компонент 11)',
        access: 6,
        handler: (player, args, out) => {
            let from = parseInt(args[0]);
            let to = parseInt(args[1]);

            if (isNaN(from) || isNaN(to) || from > to) {
                return out.error("Используй: /scantops [from] [to]", player);
            }

            // если уже идет перебор — предупредим и остановим старый
            if (scanIntervals.has(player.id)) {
                let old = scanIntervals.get(player.id);
                clearInterval(old.interval);
                scanIntervals.delete(player.id);
                out.info("Предыдущий перебор остановлен.", player);
            }

            out.info(`Начинаю перебор топов с ${from} по ${to}`, player);
            console.log(`[CMD] ${player.name} started scantops ${from}-${to}`);

            let current = from;
            const interval = setInterval(() => {
                try {
                    if (!player || !player.handle) {
                        clearInterval(interval);
                        scanIntervals.delete(player.id);
                        console.log(`[CMD] scantops stopped: player disconnected`);
                        return;
                    }

                    // ставим одежду
                    try {
                        player.setClothes(11, current, 0, 0);
                    } catch (errSet) {
                        // лог ошибки, но не прерываем перебор
                        console.log(`[CMD_ERROR] setClothes failed for ${player.name} variation=${current}:`, errSet);
                    }

                    player.outputChatBox(`~y~[SCAN]~s~ Проверка variation: ${current}`);
                    // также логируем в серверную консоль
                    console.log(`[SCAN] ${player.name} variation=${current}`);

                    current++;
                    if (current > to) {
                        clearInterval(interval);
                        scanIntervals.delete(player.id);
                        out.info(`Перебор завершён (${from}-${to})`, player);
                        console.log(`[CMD] ${player.name} finished scantops ${from}-${to}`);
                    }
                } catch (e) {
                    console.log(`[CMD_ERROR] scantops loop`, e);
                    clearInterval(interval);
                    scanIntervals.delete(player.id);
                    out.error(`Ошибка во время перебора: ${e.message}`, player);
                }
            }, 1200); // 1.2s между сменами

            scanIntervals.set(player.id, { interval, from, to, current: from });
        }
    },

    '/stopscantops': {
        args: '',
        description: 'Остановить перебор топов',
        access: 6,
        handler: (player, args, out) => {
            if (!scanIntervals.has(player.id)) return out.info('Перебор не запущен', player);
            let obj = scanIntervals.get(player.id);
            clearInterval(obj.interval);
            scanIntervals.delete(player.id);
            out.info('Перебор остановлен', player);
            console.log(`[CMD] ${player.name} stopped scantops`);
        }
    },
};