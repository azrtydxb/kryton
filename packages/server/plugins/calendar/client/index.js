const { React } = window.__mnemoPluginDeps;
const { createElement: h, useState, useEffect } = React;
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
function toISODate(year, month, day) {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
function today() {
  const d = /* @__PURE__ */ new Date();
  return toISODate(d.getFullYear(), d.getMonth(), d.getDate());
}
function isoWeekday(date) {
  return (date.getDay() + 6) % 7;
}
function buildGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = isoWeekday(firstDay);
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function activate(api) {
  function CalendarPanel() {
    const now = /* @__PURE__ */ new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth());
    const [existingDates, setExistingDates] = useState(/* @__PURE__ */ new Set());
    const todayStr = today();
    useEffect(() => {
      api.api.fetch(`/daily?year=${year}&month=${month + 1}`).then((res) => res.ok ? res.json() : []).then((dates) => {
        setExistingDates(new Set(Array.isArray(dates) ? dates : []));
      }).catch(() => {
      });
    }, [year, month]);
    function prevMonth() {
      if (month === 0) {
        setYear((y) => y - 1);
        setMonth(11);
      } else setMonth((m) => m - 1);
    }
    function nextMonth() {
      if (month === 11) {
        setYear((y) => y + 1);
        setMonth(0);
      } else setMonth((m) => m + 1);
    }
    function goToday() {
      const n = /* @__PURE__ */ new Date();
      setYear(n.getFullYear());
      setMonth(n.getMonth());
    }
    function handleDateClick(day) {
      const dateStr = toISODate(year, month, day);
      api.api.fetch(`/daily/${dateStr}`, { method: "POST" }).catch(() => {
      });
    }
    const grid = buildGrid(year, month);
    return h(
      "div",
      { className: "flex flex-col p-2 select-none" },
      // Header row: prev / title / next
      h(
        "div",
        { className: "flex items-center justify-between mb-2 px-1" },
        h("button", {
          onClick: prevMonth,
          className: "p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-bold",
          title: "Previous month"
        }, "\u2039"),
        h(
          "span",
          { className: "text-sm font-semibold text-gray-800 dark:text-gray-200" },
          `${MONTH_NAMES[month]} ${year}`
        ),
        h("button", {
          onClick: nextMonth,
          className: "p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-bold",
          title: "Next month"
        }, "\u203A")
      ),
      // Day-of-week labels
      h(
        "div",
        { className: "grid grid-cols-7 mb-1" },
        DAY_LABELS.map(
          (label) => h("div", {
            key: label,
            className: "text-center text-xs font-medium text-gray-400 dark:text-gray-500 py-1"
          }, label)
        )
      ),
      // Date grid
      h(
        "div",
        { className: "grid grid-cols-7 gap-y-0.5" },
        grid.map((day, idx) => {
          if (day === null) {
            return h("div", { key: `empty-${idx}` });
          }
          const dateStr = toISODate(year, month, day);
          const isToday = dateStr === todayStr;
          const hasNote = existingDates.has(dateStr);
          let cellClass = "relative flex items-center justify-center rounded text-xs cursor-pointer h-7 w-full transition-colors ";
          if (isToday) {
            cellClass += "bg-violet-500 text-white font-bold hover:bg-violet-600 ";
          } else {
            cellClass += "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 ";
          }
          return h(
            "button",
            {
              key: dateStr,
              onClick: () => handleDateClick(day),
              className: cellClass,
              title: dateStr
            },
            day,
            hasNote && !isToday ? h("span", {
              className: "absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-violet-400"
            }) : null
          );
        })
      ),
      // Today button
      h(
        "div",
        { className: "mt-2 flex justify-center" },
        h("button", {
          onClick: goToday,
          className: "text-xs text-gray-400 dark:text-gray-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors"
        }, "Today")
      )
    );
  }
  api.ui.registerSidebarPanel(CalendarPanel, {
    id: "calendar",
    title: "Calendar",
    icon: "calendar",
    order: 20
  });
}
function deactivate() {
}
export {
  activate,
  deactivate
};
