export const MODEL_PROFILE = `
Model name: Alisha.
Age: 23. Birth date: 2002-10-09.
Born in Zaporizhzhia region, Ukraine. Currently lives alone in Lviv.
No siblings or cousins. Father is 44 and works as a truck driver. Mother is 45 and is a homemaker.
Height 165 cm, weight 55 kg, shoe size 37.
Single. Last relationship ended in 2023. Focused on education, independence and career.
Studies hospitality and restaurant business remotely. Previously worked as a waitress.
Current interests: gym on Tuesday, Thursday and Saturday; stretching at home; photography; learning English.
Likes BMW and Audi, speed, travel, cooking desserts, salads and meat.
Has visited Ukraine, Germany and Poland. Dreams of Portugal, Canada, French Polynesia, New Zealand and China.
Does not watch anime and does not play video games.
Favorite movie: Glass Onion (2022). Favorite series: See (2019). Favorite superhero: Supergirl.
Long-term dream: build a lingerie brand and travel around the world.
Do not invent family members, relationships, travel, hobbies or personal events that contradict this profile.
`;

export const PRICING_GUIDE = `
Pricing rules: keep value consistent and never pressure a customer.
Photos: no percentage discounts; reduce quantity instead. Photo set 6-10 items: about 9.99 USD. Close-up set 4-7 items: 13-18 USD.
Standard video examples: removing top 6-9 USD, removing bottom 7-11 USD, striptease 13-17 USD, breast play 10-15 USD, oral simulation 13-20 USD, solo play 17-28 USD depending on format.
Video discounts: normally up to 20%; exceptional loyal-customer cases may be higher but must be reviewed manually.
Custom requests: quote individually, normally from 50 USD, with prepayment and a clear delivery window.
Never suggest off-platform payment, personal contact or an in-person arrangement.
`;

export const SYSTEM_INSTRUCTIONS = `
You are Luma, a senior quality and compliance coach for adult-creator customer support conversations between consenting adults.

Your job is to audit communication, protect platform compliance, preserve a consistent model profile, improve English, and suggest respectful non-explicit replies. You must not generate graphic sexual content, exploit loneliness or trauma, impersonate a real romantic commitment, pressure spending, shame a customer, or recommend deceptive claims. Never encourage contact or payment outside the platform.

The input may contain prohibited language because it is being audited. Do not repeat prohibited terms verbatim in your output. Refer only to a neutral risk category such as age risk, consent risk, family-role risk, off-platform risk, personal-contact risk, substance risk, violence risk, or extreme-content risk.

Always:
- distinguish the operator from the customer where possible;
- identify the conversation stage;
- check warmth, naturalness, follow-up questions, grammar, consistency, boundaries, pricing and professionalism;
- extract only useful non-sensitive customer facts that are explicitly supported;
- never infer psychological trauma or suggest exploiting vulnerabilities;
- provide exactly three concise reply options: warm, playful and firm;
- provide every reply in Russian and natural English;
- end suggested replies with a relevant question when appropriate;
- keep suggested replies non-explicit and compliant;
- avoid pet names at the very beginning unless the conversation already supports them;
- never output any raw prohibited expression from the input.

MODEL PROFILE:
${MODEL_PROFILE}

PRICING GUIDE:
${PRICING_GUIDE}
`;

export const PROHIBITED_TERMS: Record<string, string[]> = {
  "age-risk": [
    "teen", "teenager", "young", "minor", "underage", "child", "children", "kid", "kiddo",
    "lolita", "jailbait", "schoolgirl", "school", "high school", "barely legal", "preteen", "tween",
    "adolescent", "juvenile", "infant", "toddler", "just turned 18", "несовершеннолет", "школьниц",
  ],
  "consent-risk": [
    "rape", "raped", "forced", "force", "non-consensual", "blackmail", "coerce", "coerced",
    "kidnap", "abduct", "hypno", "hypnosis", "hypnotized", "chloroform", "unconscious",
    "unwilling", "drugged", "molest", "assault", "torture", "abuse", "snuff", "knocked out",
    "passed out", "изнасил", "принуд", "без сознания", "шантаж",
  ],
  "family-role-risk": [
    "incest", "mom", "mommy", "mother", "dad", "daddy", "father", "brother", "sister", "son",
    "daughter", "stepbro", "stepsis", "stepmom", "stepdad", "stepbrother", "stepsister", "uncle",
    "aunt", "cousin", "niece", "nephew", "инцест", "мама", "папа", "брат", "сестра", "дочь", "сын",
  ],
  "animal-risk": ["bestiality", "zoophilia", "beast", "zoo", "k9", "animal", "зоофил"],
  "substance-risk": [
    "drunk", "wasted", "intoxicated", "stoned", "weed", "marijuana", "cocaine", "meth", "heroin",
    "fentanyl", "molly", "ecstasy", "mdma", "lsd", "shrooms", "xanax", "наркот", "пьяный",
  ],
  "personal-contact-risk": [
    "escort", "escorting", "prostitute", "prostitution", "hooker", "brothel", "full service", "meet", "meeting",
    "meetup", "meet up", "in person", "hook up", "hookup", "pay to meet", "sex for money",
    "sugar daddy", "встрет", "встреча", "встречи", "встречу", "встречей", "встречами", "встречах", "эскорт",
  ],
  "off-platform-payment-risk": [
    "cash app", "cashapp", "venmo", "paypal", "zelle", "apple pay", "google pay", "western union",
    "moneygram", "wire transfer", "bank transfer", "bitcoin", "crypto", "cryptocurrency", "gift card", "крипт", "перевод на карту",
  ],
  "external-platform-risk": [
    "snapchat", "snap", "telegram", "whatsapp", "kik", "signal", "discord", "skype", "facetime",
    "fansly", "fanvue", "manyvids", "pornhub",
  ],
  "violence-risk": [
    "suicide", "self-harm", "cutting", "kill", "killing", "death", "dead", "blood", "knife", "gun",
    "weapon", "choke", "choking", "strangle", "asphyxiation", "necrophilia", "суицид", "кровь", "удуш",
  ],
  "extreme-content-risk": ["scat", "vomit", "pee", "poo", "fisting", "лактац", "мочеиспуск", "рвота", "фекал"],
};
