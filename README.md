# Облака — задачи и заметки

Доска в духе Keep: облака-заметки со списками задач, общий список «Задачи»,
теги, сроки, архив и корзина. Одна общая доска с ролями (просмотр, редактор,
администратор, владелец), работа офлайн с последующей синхронизацией.

Стек: Next.js на [vinext](https://github.com/cloudflare/vinext) (Vite), Cloudflare Workers + D1, вход через Cloudflare Access.

- **Публикация:** [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md): шаги, которые можно пройти с телефона.
- **Офлайн и синхронизация:** [docs/offline.md](docs/offline.md).

## Разработка

```sh
npm ci
npm run dev        # http://127.0.0.1:5173
```

Тестовый вход (только локально): `http://127.0.0.1:5173/signin-with-chatgpt?return_to=/`.
Локальная база D1 (`.wrangler/state`) создаётся пустой: таблицы из `drizzle/` к ней нужно применить вручную.

Проверки:

```sh
npx tsc --noEmit
node --experimental-strip-types --test tests/*.test.mjs
npm run build
```

## Как устроено

- `app/page.tsx`: доска и редактор; `app/admin/page.tsx`: пользователи, права и перенос доски.
- `app/auth.ts`, `app/access-jwt.ts`: вход. В production сайт принимает только проверенный токен Cloudflare Access.
- `app/access-store.ts`: роли и привязка аккаунтов.
- `app/board-*.ts`, `app/sync-store.ts`, `app/offline-*.ts`: модель доски, слияние изменений, офлайн-очередь.
- `drizzle/`: миграции D1. Применяются при публикации автоматически.
- `scripts/cloudflare/deploy.mjs` и `.github/workflows/deploy.yml`: публикация.

Вся доска хранится одной строкой D1, а D1 принимает строку до 2 МБ. Приложение не даёт доске вырасти больше 1,9 МБ.
