(() => {
  if (window.location.protocol === "file:") {
    window.location.replace("http://localhost:3001/");
    return;
  }

  const telegram = window.Telegram?.WebApp;
  telegram?.ready();
  telegram?.expand();
  telegram?.setHeaderColor?.("#fff7fb");
  telegram?.setBackgroundColor?.("#fff7fb");

  const CARD_STORAGE_KEY = "luma-member-card-v1";
  const TEMPLATES = [
    {
      title: "Тёплое знакомство",
      ru: "Рада познакомиться 🙂 Как мне к тебе обращаться и откуда ты сегодня пишешь?",
      en: "Nice to meet you 🙂 What should I call you, and where are you writing from today?",
    },
    {
      title: "Мягкое продолжение",
      ru: "Мне понравилось, как ты об этом рассказал. А что в этом тебе нравится больше всего?",
      en: "I liked the way you described that. What do you enjoy most about it?",
    },
    {
      title: "Благодарность",
      ru: "Спасибо за поддержку, мне правда очень приятно. Что тебе сегодня больше всего понравилось?",
      en: "Thank you for your support, I really appreciate it. What did you enjoy most today?",
    },
    {
      title: "Спокойная граница",
      ru: "Я хочу, чтобы нам обоим было комфортно. Давай продолжим разговор в рамках правил?",
      en: "I want this to feel comfortable for both of us. Shall we continue within the platform rules?",
    },
  ];
  const PLAN = [
    "Начните с контекста: имя, интересы и настроение, без допроса.",
    "Поддерживайте живой разговор: короткий ответ и уместный встречный вопрос.",
    "Перед сложным сообщением используйте фильтр и соблюдайте правила платформы.",
    "Сохраняйте только подтверждённые, несенситивные факты из диалога.",
  ];
  const state = { mode: "audit", language: "ru", files: [], result: null, panel: null, savedCard: loadCard() };
  const dialogue = document.querySelector("#dialogue");
  const screenshots = document.querySelector("#screenshots");
  const fileList = document.querySelector("#file-list");
  const analyzeButton = document.querySelector("#analyze");
  const status = document.querySelector("#status");
  const resultSection = document.querySelector("#result");
  const workspacePanel = document.querySelector("#workspace-panel");
  const inputTitle = document.querySelector("#input-title");

  function loadCard() {
    try {
      const saved = localStorage.getItem(CARD_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }

  function persistCard(card) {
    state.savedCard = card;
    try {
      if (card) localStorage.setItem(CARD_STORAGE_KEY, JSON.stringify(card));
      else localStorage.removeItem(CARD_STORAGE_KEY);
    } catch {
      setStatus("Не удалось сохранить карточку в браузере.", true);
    }
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.style.color = isError ? "#b63855" : "";
  }

  function renderFiles() {
    fileList.replaceChildren();
    state.files.forEach((file, index) => {
      const chip = document.createElement("div");
      chip.className = "file-chip";
      const name = document.createElement("span");
      name.textContent = `${index + 1}. ${file.name}`;
      const size = document.createElement("span");
      size.textContent = `${Math.max(1, Math.round(file.size / 1024))} KB`;
      chip.append(name, size);
      fileList.append(chip);
    });
  }

  screenshots.addEventListener("change", () => {
    const selected = [...screenshots.files];
    if (selected.length > 10) {
      setStatus("Можно добавить не больше 10 скриншотов.", true);
      screenshots.value = "";
      state.files = [];
    } else {
      state.files = selected;
      setStatus(selected.length ? `Добавлено: ${selected.length}` : "");
    }
    renderFiles();
  });

  function setMode(mode, focus = false) {
    state.mode = mode;
    document.querySelectorAll(".mode").forEach((item) => item.classList.toggle("active", item.dataset.mode === mode));
    document.querySelectorAll("[data-quick-mode]").forEach((item) => item.classList.toggle("active", item.dataset.quickMode === mode));
    const labels = {
      audit: ["Добавьте диалог", "Проверить диалог", "Вставьте переписку или добавьте скриншоты ниже…"],
      reply: ["Добавьте контекст", "Подготовить ответы", "Вставьте сообщение или диалог, на который нужен ответ…"],
      filter: ["Проверьте сообщение", "Проверить текст", "Вставьте текст, который хотите проверить перед отправкой…"],
    };
    const [title, buttonLabel, placeholder] = labels[mode];
    inputTitle.textContent = title;
    analyzeButton.querySelector("span").textContent = buttonLabel;
    dialogue.placeholder = placeholder;
    if (focus) dialogue.focus({ preventScroll: true });
  }

  document.querySelectorAll(".mode").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode, true));
  });

  function clearPanel() {
    workspacePanel.hidden = true;
    workspacePanel.replaceChildren();
    state.panel = null;
  }

  function panelHeading(title, note) {
    const heading = document.createElement("div");
    heading.className = "section-heading";
    const copy = document.createElement("div");
    copy.append(textElement("span", "step", "LUMA WORKSPACE"), textElement("h2", "", title));
    heading.append(copy);
    if (note) heading.append(textElement("span", "privacy-pill", note));
    return heading;
  }

  function showTemplates() {
    workspacePanel.replaceChildren(panelHeading("Готовые шаблоны", "RU + EN"));
    const grid = document.createElement("div");
    grid.className = "template-grid";
    TEMPLATES.forEach((template) => {
      const card = document.createElement("article");
      card.className = "template-card";
      const action = textElement("button", "copy", "Вставить");
      action.type = "button";
      action.addEventListener("click", () => {
        dialogue.value = template[state.language];
        clearPanel();
        setMode("reply", true);
        setStatus("Шаблон вставлен. При необходимости отредактируйте его перед проверкой.");
      });
      card.append(textElement("h3", "reply-title", template.title), textElement("p", "template-text", template[state.language]), action);
      grid.append(card);
    });
    workspacePanel.append(grid);
    workspacePanel.hidden = false;
    state.panel = "templates";
    workspacePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function cardSource() {
    if (state.savedCard) return state.savedCard;
    if (!state.result?.memberFacts?.length) return null;
    return { stage: state.result.stage, facts: state.result.memberFacts.filter((fact) => fact.confidence !== "low") };
  }

  function showCard() {
    workspacePanel.replaceChildren(panelHeading("Карточка клиента", "Только браузер"));
    const source = cardSource();
    if (!source?.facts?.length) {
      workspacePanel.append(textElement("p", "summary", "Карточка пока пуста. Сначала проведите аудит: в неё можно сохранить только подтверждённые факты из результата."));
    } else {
      workspacePanel.append(textElement("p", "summary", source.stage ? `Этап: ${source.stage}` : "Подтверждённые факты:"));
      const facts = document.createElement("div");
      facts.className = "fact-list";
      source.facts.slice(0, 12).forEach((fact) => facts.append(textElement("p", "fact", `${fact.field}: ${fact.value}`)));
      workspacePanel.append(facts);
      const controls = document.createElement("div");
      controls.className = "panel-controls";
      if (!state.savedCard && state.result?.memberFacts?.length) {
        const save = textElement("button", "secondary", "Сохранить в этом браузере");
        save.type = "button";
        save.addEventListener("click", () => { persistCard(source); showCard(); });
        controls.append(save);
      }
      if (state.savedCard) {
        const remove = textElement("button", "secondary danger", "Очистить карточку");
        remove.type = "button";
        remove.addEventListener("click", () => { persistCard(null); showCard(); });
        controls.append(remove);
      }
      workspacePanel.append(controls);
    }
    workspacePanel.append(textElement("p", "panel-note", "Карточка хранится только в памяти этого браузера. Никакой базы данных здесь нет."));
    workspacePanel.hidden = false;
    state.panel = "card";
    workspacePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function showPlan() {
    workspacePanel.replaceChildren(panelHeading("План диалога", "4 шага"));
    const list = document.createElement("ol");
    list.className = "plan-list";
    PLAN.forEach((item) => list.append(textElement("li", "", item)));
    workspacePanel.append(list, textElement("p", "panel-note", "Кнопки и шаблоны помогают оператору — ответы клиенту автоматически не отправляются."));
    workspacePanel.hidden = false;
    state.panel = "plan";
    workspacePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function showTranslate() {
    workspacePanel.replaceChildren(panelHeading("Онлайн-переводчик", "RU + EN"));
    const controls = document.createElement("div");
    controls.className = "translate-modes";
    const modes = [
      ["ru-en", "🇷🇺 → 🇬🇧"],
      ["en-ru", "🇬🇧 → 🇷🇺"],
      ["natural-en", "✨ Natural English"],
      ["smart", "🪄 Умный"],
    ];
    let selectedMode = "ru-en";
    const output = textElement("p", "translate-output", "");
    modes.forEach(([mode, label]) => {
      const button = textElement("button", `secondary ${mode === selectedMode ? "selected" : ""}`, label);
      button.type = "button";
      button.addEventListener("click", () => {
        selectedMode = mode;
        controls.querySelectorAll("button").forEach((item) => item.classList.toggle("selected", item === button));
      });
      controls.append(button);
    });
    const source = document.createElement("textarea");
    source.rows = 5;
    source.placeholder = "Вставьте текст для перевода…";
    const run = textElement("button", "primary", "Перевести");
    run.type = "button";
    run.addEventListener("click", async () => {
      if (!source.value.trim()) {
        output.textContent = "Сначала добавьте текст.";
        return;
      }
      run.disabled = true;
      output.textContent = "Переводим и проверяем безопасность…";
      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-telegram-init-data": telegram?.initData ?? "" },
          body: JSON.stringify({ text: source.value, mode: selectedMode }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Перевод недоступен");
        output.textContent = data.text;
        output.classList.toggle("unsafe", !data.safe);
      } catch (error) {
        output.textContent = error instanceof Error ? error.message : "Не удалось выполнить перевод";
        output.classList.add("unsafe");
      } finally {
        run.disabled = false;
      }
    });
    workspacePanel.append(controls, source, run, output, textElement("p", "panel-note", "Перевод не отправляет сообщения автоматически. Перед показом результат проходит проверку правил."));
    workspacePanel.hidden = false;
    state.panel = "translate";
    workspacePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function showUsage() {
    workspacePanel.replaceChildren(panelHeading("Лимит расходов", "Только оценка"));
    const output = textElement("p", "translate-output", "Загружаем текущий лимит…");
    workspacePanel.append(output, textElement("p", "panel-note", "Локальный лимит защищает от случайных трат. Точный расход всегда проверяйте в OpenAI Platform."));
    workspacePanel.hidden = false;
    state.panel = "usage";
    workspacePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    try {
      const response = await fetch("/api/usage", {
        headers: { "x-telegram-init-data": telegram?.initData ?? "" },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Статус недоступен");
      output.textContent = [
        `Сегодня: ~$${Number(data.estimatedUsd).toFixed(4)} из $${Number(data.limitUsd).toFixed(2)}`,
        `Осталось: ~$${Number(data.remainingUsd).toFixed(4)}`,
        `Аудиты: ${data.operations.audit} · Переводы: ${data.operations.translation} · Голосовые: ${data.operations.voice}`,
      ].join("\n");
    } catch (error) {
      output.textContent = error instanceof Error ? error.message : "Не удалось загрузить лимит";
      output.classList.add("unsafe");
    }
  }

  document.querySelectorAll("[data-quick-mode]").forEach((button) => {
    button.addEventListener("click", () => { clearPanel(); setMode(button.dataset.quickMode, true); });
  });
  document.querySelectorAll("[data-description-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      clearPanel();
      setMode("filter", true);
      inputTitle.textContent = "Проверьте описание";
      dialogue.placeholder = "Вставьте описание публикации или подпись к контенту…";
      setStatus("Режим описания: проверю язык, структуру и безопасность.");
    });
  });
  document.querySelectorAll("[data-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.dataset.panel;
      if (state.panel === panel) return clearPanel();
      if (panel === "templates") showTemplates();
      if (panel === "card") showCard();
      if (panel === "plan") showPlan();
      if (panel === "translate") showTranslate();
      if (panel === "usage") showUsage();
    });
  });

  document.querySelectorAll(".language").forEach((button) => {
    button.addEventListener("click", () => {
      state.language = button.dataset.language;
      document.querySelectorAll(".language").forEach((item) => item.classList.toggle("active", item === button));
      renderReplies();
    });
  });

  function textElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function renderIssues() {
    const container = document.querySelector("#issues");
    container.replaceChildren();
    const issues = state.result?.issues ?? [];
    if (!issues.length) {
      container.append(textElement("p", "summary", "Критических ошибок не обнаружено."));
      return;
    }

    issues.slice(0, 8).forEach((issue) => {
      const card = document.createElement("div");
      card.className = `issue ${issue.severity}`;
      card.append(
        textElement("strong", "", issue.category),
        textElement("p", "", `${issue.explanation} Решение: ${issue.howToFix}`),
      );
      container.append(card);
    });
  }

  function renderReplies() {
    const container = document.querySelector("#replies");
    container.replaceChildren();
    const replies = state.result?.replyVariants ?? [];

    replies.forEach((reply) => {
      const card = document.createElement("div");
      card.className = "reply-card";
      const top = document.createElement("div");
      top.className = "reply-top";
      const title = textElement("h3", "reply-title", reply.labelRu);
      const copy = textElement("button", "copy", "Копировать");
      copy.type = "button";
      const answer = reply[state.language];
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(answer);
        copy.textContent = "Скопировано";
        setTimeout(() => { copy.textContent = "Копировать"; }, 1500);
      });
      top.append(title, copy);
      card.append(top, textElement("p", "reply-text", answer));
      container.append(card);
    });
  }

  function renderResult() {
    document.querySelector("#score").textContent = `${state.result.score}`;
    document.querySelector("#stage").textContent = state.result.stage;
    document.querySelector("#summary").textContent = state.result.summary;
    const badge = document.querySelector("#safety-badge");
    badge.textContent = state.result.safeToSend ? "Проверено" : "Безопасная замена";
    badge.style.color = state.result.safeToSend ? "" : "#a56817";
    badge.style.background = state.result.safeToSend ? "" : "#fff0d8";
    renderIssues();
    renderReplies();
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  analyzeButton.addEventListener("click", async () => {
    if (!dialogue.value.trim() && !state.files.length) {
      setStatus("Добавьте текст или хотя бы один скриншот.", true);
      return;
    }

    const form = new FormData();
    form.append("text", dialogue.value);
    form.append("mode", state.mode);
    state.files.forEach((file) => form.append("screenshots", file));

    analyzeButton.disabled = true;
    resultSection.hidden = true;
    setStatus("Luma анализирует диалог…");

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "x-telegram-init-data": telegram?.initData ?? "" },
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ошибка анализа");
      state.result = data;
      setStatus("Готово");
      renderResult();
      if (state.panel === "card") showCard();
      telegram?.HapticFeedback?.notificationOccurred?.("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось выполнить анализ", true);
      telegram?.HapticFeedback?.notificationOccurred?.("error");
    } finally {
      analyzeButton.disabled = false;
    }
  });
})();
