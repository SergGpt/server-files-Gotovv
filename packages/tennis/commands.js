"use strict";

const notifications = call('notifications');

module.exports = {
    "/tennis": {
        access: 0,
        args: "",
        description: "Подсказка по теннисной площадке",
        handler: (player) => {
            if (!player.character) return;
            notifications.info(player, 'Подойдите к корту на пляже Веспуччи и нажмите E, чтобы начать тренировку.', 'Теннис');
        }
    }
};
