(() => {
  const telegram = window.Telegram?.WebApp;
  telegram?.ready();
  telegram?.expand();
  telegram?.setHeaderColor?.("#fff7fb");
  telegram?.setBackgroundColor?.("#fff7fb");

  const state = { mode: "audit", language: "ru", files: [], result: null };
  const dialogue = document.querySelector("#dialogue");
  const screenshots = document.querySelector("#screenshots");
  const fileList = document.querySelector("#file-list");
  const analyzeButton = document.querySelector("#analyze");
  const status = document.querySelector("#status");
  const resultSection = document.querySelector("#result");

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

  document.querySelectorAll(".mode").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      document.querySelectorAll(".mode").forEach((item) => item.classList.toggle("active", item === button));
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
      telegram?.HapticFeedback?.notificationOccurred?.("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось выполнить анализ", true);
      telegram?.HapticFeedback?.notificationOccurred?.("error");
    } finally {
      analyzeButton.disabled = false;
    }
  });
})();
