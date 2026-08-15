export interface StarterTemplate {
  id: "welcome" | "followup" | "thanks" | "boundary";
  title: string;
  ru: string;
  en: string;
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: "welcome",
    title: "Тёплое знакомство",
    ru: "Рада познакомиться 🙂 Как мне к тебе обращаться и откуда ты сегодня пишешь?",
    en: "Nice to meet you 🙂 What should I call you, and where are you writing from today?",
  },
  {
    id: "followup",
    title: "Мягкое продолжение",
    ru: "Мне понравилось, как ты об этом рассказал. А что в этом тебе нравится больше всего?",
    en: "I liked the way you described that. What do you enjoy most about it?",
  },
  {
    id: "thanks",
    title: "Благодарность",
    ru: "Спасибо за поддержку, мне правда очень приятно. Что тебе сегодня больше всего понравилось?",
    en: "Thank you for your support, I really appreciate it. What did you enjoy most today?",
  },
  {
    id: "boundary",
    title: "Спокойная граница",
    ru: "Я хочу, чтобы нам обоим было комфортно. Давай останемся в рамках платформы и продолжим разговор здесь?",
    en: "I want this to feel comfortable for both of us. Let’s keep things on the platform and continue our conversation here?",
  },
];

export function findTemplate(id: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((template) => template.id === id);
}

export const WORKFLOW_STAGES = [
  "1. Начните с контекста: имя, интересы и настроение, без допроса.",
  "2. Поддерживайте живой диалог: короткий ответ + уместный встречный вопрос.",
  "3. Перед любым предложением проверьте текст фильтром и соблюдайте правила платформы.",
  "4. После анализа сохраните только полезные, несенситивные факты в карточке.",
] as const;
