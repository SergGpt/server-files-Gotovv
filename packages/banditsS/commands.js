// Команды под ваш terminal-формат.
// МОДУЛЬ ТОЛЬКО ЭКСПОРТИРУЕТ КОМАНДЫ. Ничего не делает сам.

let terminal = null;
try { terminal = call('terminal'); } catch {}

module.exports = {
  "/z_follow": {
    access: 1,
    description: "Ближайший зомби начинает следовать за вами.",
    args: "",
    handler: (player, args, out) => {
      try {
        mp.events.call('zombies:follow', player);
        if (out?.info) out.info(`${player.name} вызвал /z_follow`);
      } catch (e) {
        if (out?.error) out.error(`Ошибка /z_follow: ${e && e.message ? e.message : e}`, player);
      }
    }
  },

  "/z_come": {
    access: 1,
    description: "Все зомби идут к вам.",
    args: "",
    handler: (player, args, out) => {
      try {
        mp.events.call('zombies:come', player);
        if (out?.info) out.info(`${player.name} вызвал /z_come`);
      } catch (e) {
        if (out?.error) out.error(`Ошибка /z_come: ${e && e.message ? e.message : e}`, player);
      }
    }
  },

  "/z_respawn": {
    access: 2,
    description: "Пересоздать всех зомби в зонах.",
    args: "",
    handler: (player, args, out) => {
      try {
        mp.events.call('zombies:respawn', player);
        if (out?.info) out.info(`${player.name} вызвал /z_respawn (zones respawned)`);
      } catch (e) {
        if (out?.error) out.error(`Ошибка /z_respawn: ${e && e.message ? e.message : e}`, player);
      }
    }
  },
};
