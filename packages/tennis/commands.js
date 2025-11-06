"use strict";

const notifications = call('notifications');

module.exports = {
    "/tennis": {
        access: 0,
        args: "",
        description: "Информация о теннисных кортах",
        handler: (player) => {
            if (!player.character) return;
            notifications.info(player, 'Используйте корты на пляже Венвуд и нажмите E для открытия меню.', 'Теннис');
        }
    }
};
