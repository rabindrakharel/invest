// A question from an agent, as a card: checkboxes for a multi-select, radios for a single choice, a free-text escape
// hatch, and a distinct look for permission and spend requests. `submit(answers)` sends them; it may throw, and the
// card stays open with the error.

import { el } from "./ui.js";

const KIND_LABEL = { question: "Needs your input", permission: "Permission", spend: "Spends money" };

export function hitlCard(event, { submit }) {
  const form = el("form", { class: `hitl ${event.kind}` });
  form.append(el("div", { class: "head" }, el("span", { class: "tag", text: KIND_LABEL[event.kind] }), event.agent ? el("span", { class: "from", text: `from ${event.agent}` }) : null));
  const fields = event.questions.map((question, qi) => {
    const group = el("fieldset", {}, el("legend", { text: question.header ? `${question.header}: ${question.question}` : question.question }));
    const name = `q${event.id}-${qi}`;
    for (const option of question.options) {
      group.append(el("label", { class: "opt" }, el("input", { type: question.multiSelect ? "checkbox" : "radio", name, value: option.label }),
        el("span", {}, el("span", { class: "l", text: option.label }), option.description ? el("span", { class: "d", text: option.description }) : null)));
    }
    const other = el("input", { class: "other", type: "text", placeholder: question.options.length ? "Or type something else…" : "Type your answer…", "aria-label": "Your own answer", maxlength: "4000" });
    group.append(other);
    return { name, other, group };
  });
  const error = el("span", { class: "err", role: "alert" });
  const button = el("button", { class: `btn ${event.kind === "spend" ? "danger" : "primary"}`, type: "submit", text: event.kind === "spend" ? "Submit decision" : "Submit" });
  for (const field of fields) form.append(field.group);
  form.append(el("div", { class: "actions" }, button, error));
  form.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const answers = fields.map((field) => {
      const text = field.other.value.trim();
      return text ? { text } : { picked: [...form.querySelectorAll(`input[name="${field.name}"]:checked`)].map((input) => input.value) };
    });
    if (answers.some((answer) => !answer.text && !answer.picked.length)) { error.textContent = "Choose an option or type an answer."; return; }
    button.disabled = true; error.textContent = "";
    try {
      await submit(answers);
      markAnswered(form, answers.map((answer) => answer.text ?? answer.picked.join(", ")).join(" · "));
    } catch (failure) { button.disabled = false; error.textContent = failure.message; }
  });
  setTimeout(() => form.querySelector("input")?.focus({ preventScroll: true }), 50);
  return form;
}

/** `summary`: the answer given, or null (answered elsewhere), or "Cancelled". */
export function markAnswered(card, summary) {
  card.className = "hitl done";
  card.replaceChildren(el("span", { text: summary === null ? "Answered." : summary === "Cancelled" ? "Cancelled." : `Answered: ${summary}` }));
}
