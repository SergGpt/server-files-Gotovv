"use strict";

const request = require("request");

let weather = {};
weather.isSet = false;

const API_KEY = "780c6411-0e39-4d67-8e1e-ef3788643629"; // твой ключ
const LAT = 56.8519; // Екатеринбург
const LON = 60.6122;
const DEFAULT_SUMMARY = "Ясно";
const DEFAULT_TEMPERATURE = 20;
const DEFAULT_ICON = "clear";
const REQUEST_TIME = 60 * 60 * 1000; // повторный запрос через 1 час при ошибке

let weatherForecast = [];
let customTemperature;
let timer = call('timer');
let utils = call('utils');

let conditionTranslate = {
    "clear": "Ясно",
    "partly-cloudy": "Малооблачно",
    "cloudy": "Облачно с прояснениями",
    "overcast": "Пасмурно",
    "drizzle": "Морось",
    "light-rain": "Небольшой дождь",
    "rain": "Дождь",
    "moderate-rain": "Умеренный дождь",
    "heavy-rain": "Сильный дождь",
    "showers": "Ливень",
    "wet-snow": "Дождь со снегом",
    "light-snow": "Небольшой снег",
    "snow": "Снег",
    "snow-showers": "Снегопад",
    "hail": "Град",
    "thunderstorm": "Гроза",
    "thunderstorm-with-rain": "Дождь с грозой",
    "thunderstorm-with-hail": "Гроза с градом"
};

module.exports = {
  customWeather: false,
  customWeatherType: 'winter',
  currentWeatherName: 'CLEAR',

  init() {
    this.requestWeather();
  },

  requestWeather() {
    request({
      url: `https://api.weather.yandex.ru/v2/forecast?lat=${LAT}&lon=${LON}&lang=ru_RU&hours=true`,
      headers: { "X-Yandex-API-Key": API_KEY },
      json: true
    },
    (err, res, body) => {
      if (err || res.statusCode !== 200) {
        console.log("[WEATHER] Ошибка загрузки:", err || res.statusCode);
        return this.repeatWeatherRequest();
      }

      try {
        weatherForecast = body.forecasts[0].hours.map(h => ({
          time: parseInt(h.hour),
          summary: h.condition,
          temperature: h.temp,
          icon: h.condition
        }));
      } catch (e) {
        console.log("[WEATHER] Ошибка парсинга:", e);
        return this.repeatWeatherRequest();
      }

      console.log("[WEATHER] Прогноз загружен с Яндекс.Погоды");
      if (!weather.isSet) this.setWeather();
    });
  },

  repeatWeatherRequest() {
    if (!weather.isSet) this.setWeather();
    console.log(`[WEATHER] Повтор запроса через ${REQUEST_TIME / (60 * 1000)} мин.`);
    timer.add(this.requestWeather, REQUEST_TIME);
  },

  getForecastDataByHour(hours) {
    if (this.customWeather) return this.generateCustomWeather(hours);
    const item = weatherForecast.find(f => f.time === hours);
    return item || { summary: DEFAULT_SUMMARY, temperature: DEFAULT_TEMPERATURE, icon: DEFAULT_ICON };
  },

  setWeather() {
    weather.isSet = true;
    const now = new Date();
    weather.current = this.getForecastDataByHour(now.getHours());
    weather.current.summary = conditionTranslate[weather.current.icon] || weather.current.summary;
    console.log(`[WEATHER] Текущая погода: ${JSON.stringify(weather.current)}`);

    const weatherName = this.getGameWeatherByIcon(weather.current.icon);
    this.currentWeatherName = weatherName;
    mp.world.weather = weatherName;

    const forecast = { ...weather.current, temperature: customTemperature ?? weather.current.temperature };
    mp.players.forEach(p => p.call('weather.info.update', [forecast]));

    timer.add(() => {
      try { this.setWeather(); } catch (e) { console.log(e); }
    }, (60 - now.getMinutes()) * 60 * 1000);

    console.log(`[WEATHER] Следующее обновление через ${60 - now.getMinutes()} мин`);
  },

  setCustomTemperature(temp) {
    customTemperature = temp;
    mp.players.forEach(p => p.call('weather.info.update', [this.getCurrentWeather()]));
  },

  resetCustomTemperature() {
    customTemperature = null;
    mp.players.forEach(p => p.call('weather.info.update', [this.getCurrentWeather()]));
  },

  getCurrentWeather() {
    let current = {};
    if (!weather.current) {
      current.summary = DEFAULT_SUMMARY;
      current.temperature = DEFAULT_TEMPERATURE;
      current.icon = DEFAULT_ICON;
    } else {
      Object.assign(current, weather.current);
    }
    if (customTemperature != null) current.temperature = customTemperature;
    return current;
  },

  getGameWeatherByIcon(icon) {
    return weatherConfig[icon] || "SMOG";
  },

  generateCustomWeather(hours) {
    let w = {};
    if (this.customWeatherType === 'winter') {
      w.summary = 'Снег';
      w.temperature = hours > 6 && hours < 23
        ? utils.randomInteger(-10, -5)
        : utils.randomInteger(-15, -10);
      w.icon = 'snow';
    }
    return w;
  }
};
