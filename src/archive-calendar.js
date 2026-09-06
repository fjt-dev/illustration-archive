// Match the local dates used by the archive's date display.
export function calendarDateKey(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) || localDateKey(date) !== value ? "" : value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : localDateKey(date);
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function calendarCounts(works, field) {
  const counts = new Map();
  let unknown = 0;
  for (const work of works) {
    const key = calendarDateKey(work[field]);
    if (!key) { unknown += 1; continue; }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { counts, unknown };
}

export function calendarMonth(year, month, counts) {
  const days = new Date(year, month + 1, 0).getDate();
  const entries = Array.from({ length: days }, (_, index) => {
    const key = localDateKey(new Date(year, month, index + 1));
    return { key, day: index + 1, count: counts.get(key) || 0 };
  });
  const max = Math.max(1, ...entries.map(day => day.count));
  return {
    offset: new Date(year, month, 1).getDay(),
    total: entries.reduce((sum, day) => sum + day.count, 0),
    days: entries.map(day => ({ ...day, ...calendarCircle(day.count, max) }))
  };
}

export function calendarCircle(count, max) {
  if (count <= 0) return { size: 0, opacity: 0 };
  // Logarithmic steps keep quieter days distinguishable when a month has a large spike.
  const level = max <= 1 ? 1 : Math.min(5, 1 + Math.floor(Math.log(count) / Math.log(max) * 4));
  return { size: 16 + (level - 1) * 7, opacity: 0.1 + (level - 1) * 0.12 };
}

export function createArchiveCalendar(root, onChange) {
  const fieldInput = root.querySelector("[data-calendar-field]");
  const monthInput = root.querySelector("[data-calendar-month]");
  const grid = root.querySelector("[data-calendar-days]");
  const status = root.querySelector("[data-calendar-status]");
  const clear = root.querySelector("[data-calendar-clear]");
  let field = "archivedAt";
  let selected = "";
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let data = { counts: new Map(), unknown: 0 };
  let items = [];

  function render() {
    const focusedDate = grid.contains(document.activeElement) ? document.activeElement.dataset.date : "";
    monthInput.value = localDateKey(month).slice(0, 7);
    const model = calendarMonth(month.getFullYear(), month.getMonth(), data.counts);
    const today = localDateKey(new Date());
    const cells = Array.from({ length: model.offset }, () => {
      const spacer = document.createElement("span");
      spacer.setAttribute("aria-hidden", "true");
      return spacer;
    });
    for (const day of model.days) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-day";
      button.dataset.date = day.key;
      button.setAttribute("aria-label", `${day.key}：${day.count}作品`);
      button.title = `${day.count}作品`;
      button.setAttribute("aria-pressed", String(selected === day.key));
      if (day.key === today) button.setAttribute("aria-current", "date");
      button.style.setProperty("--circle-size", `${day.size}px`);
      button.style.setProperty("--circle-opacity", day.opacity);
      const label = document.createElement("span");
      label.textContent = day.day;
      button.append(label);
      button.addEventListener("click", () => {
        selected = selected === day.key ? "" : day.key;
        render();
        grid.querySelector(`[data-date="${day.key}"]`)?.focus();
        onChange();
      });
      cells.push(button);
    }
    grid.replaceChildren(...cells);
    if (focusedDate) grid.querySelector(`[data-date="${focusedDate}"]`)?.focus();
    clear.hidden = !selected;
    clear.textContent = selected ? `${Number(selected.slice(5, 7))}/${Number(selected.slice(8))} 選択中・解除 ×` : "日付の絞り込みを解除";
    status.textContent = `${model.total}作品`
      + (data.unknown ? ` / 日付不明 ${data.unknown}件` : "");
  }

  function changeMonth(next) {
    month = next;
    selected = "";
    render();
    onChange();
  }
  root.querySelector("[data-calendar-prev]").addEventListener("click", () => {
    if (month.getFullYear() === 1000 && month.getMonth() === 0) return;
    changeMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
  });
  root.querySelector("[data-calendar-next]").addEventListener("click", () => {
    if (month.getFullYear() === 9999 && month.getMonth() === 11) return;
    changeMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  });
  root.querySelector("[data-calendar-today]").addEventListener("click", () => {
    const now = new Date();
    changeMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  monthInput.addEventListener("change", () => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput.value) || !monthInput.validity.valid) {
      render();
      return;
    }
    const [year, monthNumber] = monthInput.value.split("-").map(Number);
    changeMonth(new Date(year, monthNumber - 1, 1));
  });
  fieldInput.addEventListener("change", () => {
    field = fieldInput.value === "postedAt" ? "postedAt" : "archivedAt";
    selected = "";
    data = calendarCounts(items, field);
    render();
    onChange();
  });
  clear.addEventListener("click", () => {
    selected = "";
    render();
    monthInput.focus();
    onChange();
  });
  return {
    update(works) {
      items = works;
      data = calendarCounts(items, field);
      render();
    },
    matches(work) { return !selected || calendarDateKey(work[field]) === selected; }
  };
}

export function bindCalendarToggle(button, panel) {
  function position() {
    if (panel.hidden) return;
    const anchor = button.getBoundingClientRect();
    const width = panel.getBoundingClientRect().width;
    const height = panel.getBoundingClientRect().height;
    const gap = 8;
    const beside = anchor.right + gap + width <= window.innerWidth - gap;
    const left = beside ? anchor.right + gap : Math.max(gap, Math.min(anchor.left, window.innerWidth - width - gap));
    const top = beside ? anchor.top : anchor.bottom + gap;
    panel.style.setProperty("left", `${left}px`);
    panel.style.setProperty("top", `${Math.max(gap, Math.min(top, window.innerHeight - height - gap))}px`);
  }
  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    const label = open ? "カレンダーを閉じる" : "カレンダーを開く";
    button.setAttribute("aria-label", label);
    position();
  }
  for (const target of [button, panel]) {
    target.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      button.focus();
      setOpen(false);
    });
  }
  setOpen(false);
  button.addEventListener("click", () => setOpen(panel.hidden));
  document.addEventListener("pointerdown", (event) => {
    if (!button.contains(event.target) && !panel.contains(event.target)) setOpen(false);
  });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(position).observe(panel);
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
}
