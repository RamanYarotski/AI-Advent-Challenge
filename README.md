# AI Advent Challenge

Один локальный web-интерфейс для пяти заданий первой недели AI Advent Challenge.

## Запуск

1. Установить зависимости:

```bash
npm install
```

2. Создать `.env.local` по примеру:

```bash
cp .env.example .env.local
```

3. Заполнить ключ и модели:

```bash
OPENAI_COMPATIBLE_BASE_URL=https://openrouter.ai/api/v1
OPENAI_COMPATIBLE_API_KEY=your_key
DEFAULT_MODEL=openai/gpt-4o
MODEL_WEAK=meta-llama/llama-3.2-1b-instruct
MODEL_MEDIUM=qwen/qwen3-32b
MODEL_STRONG=qwen/qwen3-235b-a22b-thinking-2507
NEXT_PUBLIC_MODEL_WEAK=meta-llama/llama-3.2-1b-instruct
NEXT_PUBLIC_MODEL_MEDIUM=qwen/qwen3-32b
NEXT_PUBLIC_MODEL_STRONG=qwen/qwen3-235b-a22b-thinking-2507
```

4. Запустить приложение:

```bash
npm run dev
```

Открыть `http://localhost:3000`.

## Что есть в проекте

- `Day 1 API`: первый запрос к LLM через OpenAI-compatible API.
- `Day 2 Format`: сравнение ответа без ограничений и с контролем формата.
- `Day 3 Reasoning`: четыре способа рассуждения для одной задачи.
- `Day 4 Temperature`: сравнение `temperature = 0`, `0.7`, `1.2`.
- `Day 5 Models`: сравнение слабой, средней и сильной модели по качеству, скорости, токенам и стоимости.

## Проверка перед видео

```bash
npm run lint
npm run build
```

Для видео достаточно показать выбранный день, prompt, запуск, ответы и метрики.

## Коммиты

По договоренности коммит делается после проверки каждого задания:

- `day 1: add llm api chat baseline`
- `day 2: add response format controls`
- `day 3: add reasoning strategy comparison`
- `day 4: add temperature comparison`
- `day 5: add model version comparison`
