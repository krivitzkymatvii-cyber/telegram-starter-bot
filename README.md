# Світло: сімейний бот Telegram + Viber

Графіки відключень ВОЕ для Дмитрівки, Пожарок і Рожища, сповіщення в Telegram і до 5 Viber-каналів,
повітряні тривоги (м. Рожище), погода, нагадування, облік світла й газу, казки й розваги.
Node.js + [grammY](https://grammy.dev). Запуск: `npm install && npm start`.

## Що де лежить
- `index.js`: запуск бота й Viber-каналів
- `viber.js`: робота з Viber (канали 1–5)
- `src/`: уся решта (меню `ui.js`, команди `commands.js`, сповіщення `scheduler.js`, тривоги `alarm.js`, лічильники `meter.js`, казки `tales.js` тощо)
- `.env.example`: перелік усіх змінних (значення задайте у панелі FadeHost)

## Як оновити з телефону
1. Розпакуйте архів. Завантажте файли на GitHub: **Add file → Upload files**, `src/*` у папку `src`, решту в корінь.
2. Видаліть із репозиторію все застаріле: усі `.js`-файли в корені, крім `index.js` і `viber.js`, а також `src/viber.js`,
   `viber (1).js`, `download`, `env.example` і папку `data/`.
3. **Commit changes**, потім перезапустіть бота на FadeHost.

## Команди
`/start` і `/menu` (меню кнопками), `/today`, `/tomorrow`, `/now`, `/stats`, `/alarm`, `/rates`, `/settings`,
`/meter`, `/tariff` (світло), `/gas`, `/gastariff` (газ), `/remind`, `/reminders`, `/monthly`, `/calendar`,
`/news`, `/history`, `/fact`, `/joke`, `/quiz`, `/riddle`, `/proverb`, `/kazka`, `/help`.

## Важливо
Бот не замінює офіційні сповіщення та сирени.
