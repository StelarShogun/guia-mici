const DEFAULT_COURSE = localStorage.getItem("activeCourse") || "mici";
const FONT_KEY = "studyFontPreference";
let activeCourse = DEFAULT_COURSE;
let currentExam = [];
let siteDataPromise;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const svgNS = "http://www.w3.org/2000/svg";

async function loadSiteData() {
  if (!siteDataPromise) {
    if (window.STUDY_SITE_DATA) {
      siteDataPromise = Promise.resolve(window.STUDY_SITE_DATA);
      return siteDataPromise;
    }
    siteDataPromise = fetch("data/site.json").then(response => {
      if (!response.ok) throw new Error("No se pudo cargar data/site.json");
      return response.json();
    });
  }
  return siteDataPromise;
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function getCourse(data, courseId) {
  const course = data.courses.find(item => item.id === courseId);
  if (!course) throw new Error("Materia no encontrada");
  return course;
}

function stripAnswer(question) {
  const { answer, keywords, correct_answer, ...safe } = question;
  return {
    ...safe,
    options: question.type === "choice" ? shuffle(question.options || []) : question.options || []
  };
}

function checkStaticAnswer(question, answer) {
  const value = String(answer || "").trim();
  if (question.type === "choice") {
    return value === String(question.answer);
  }
  const normalized = value.toLowerCase();
  return (question.keywords || []).some(keyword => normalized.includes(String(keyword).toLowerCase()));
}

function examLabel(score) {
  if (score >= 90) return "Excelente preparación.";
  if (score >= 75) return "Buen dominio, repasar detalles.";
  if (score >= 60) return "Requiere reforzar teoría y gráficos.";
  return "Repasar nuevamente las clases.";
}

async function api(path, options = {}) {
  const data = await loadSiteData();
  const method = (options.method || "GET").toUpperCase();
  const payload = options.body ? JSON.parse(options.body) : {};

  if (path === "/api/courses") return data.courses.map(({ modules, graphs, checklist, questions, ...course }) => course);

  const courseMatch = path.match(/^\/api\/courses\/([^/]+)(?:\/([^/]+))?$/);
  if (courseMatch) {
    const course = getCourse(data, courseMatch[1]);
    const section = courseMatch[2];
    if (!section) return { ...course, modules: course.modules.map(({ blocks, ...module }) => module) };
    if (section === "lessons") return course.modules;
    if (section === "questions") return course.questions.map(({ answer, keywords, ...question }) => question);
    if (section === "graphs") return course.graphs;
    if (section === "checklist") return course.checklist;
  }

  if (path === "/api/exams/generate" && method === "POST") {
    const course = getCourse(data, payload.course_id || activeCourse);
    const amount = Math.min(Number(payload.amount || 30), course.questions.length);
    const selected = shuffle(course.questions).slice(0, amount);
    return { course_id: course.id, amount, questions: selected.map(stripAnswer) };
  }

  if (path === "/api/exams/check" && method === "POST") {
    const course = getCourse(data, payload.course_id || activeCourse);
    const question = course.questions.find(item => item.id === payload.question_id);
    if (!question) throw new Error("Pregunta no encontrada");
    const correct = checkStaticAnswer(question, payload.answer);
    return {
      correct,
      expected: question.correct_answer,
      explanation: question.explanation || ""
    };
  }

  if (path === "/api/exams/grade" && method === "POST") {
    const course = getCourse(data, payload.course_id || activeCourse);
    const answers = payload.answers || [];
    let correct = 0;
    const items = answers.map(item => {
      const question = course.questions.find(q => q.id === item.question_id);
      const ok = question ? checkStaticAnswer(question, item.answer) : false;
      if (ok) correct += 1;
      return { question_id: item.question_id, correct: ok, explanation: question?.explanation || "" };
    });
    const total = Math.max(answers.length, 1);
    const score = Math.round((correct / total) * 100);
    return { score, correct, total: answers.length, label: examLabel(score), items };
  }

  if (path.startsWith("/api/admin/")) {
    throw new Error("El admin está desactivado en la versión estática de Vercel.");
  }

  throw new Error(`Ruta estática no soportada: ${path}`);
}

function setActiveNav() {
  const page = document.body.dataset.page;
  $$("[data-nav]").forEach(link => {
    if (link.dataset.nav === page) link.classList.add("active");
  });
}

const fontOptions = {
  atkinson: {
    label: "Atkinson Hyperlegible",
    family: '"Atkinson Hyperlegible", system-ui, "Segoe UI", Roboto, Arial, sans-serif',
    note: "Alta diferenciación de letras; útil para lectura clara y accesible."
  },
  lexend: {
    label: "Lexend",
    family: '"Lexend", "Atkinson Hyperlegible", system-ui, sans-serif',
    note: "Diseñada para reducir esfuerzo visual y mejorar fluidez de lectura."
  },
  system: {
    label: "Sistema legible",
    family: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    note: "Rápida y familiar en pantalla; buena para interfaces largas."
  },
  verdana: {
    label: "Verdana",
    family: 'Verdana, Geneva, "Atkinson Hyperlegible", sans-serif',
    note: "Diseñada para legibilidad en pantallas, con letras amplias."
  },
  georgia: {
    label: "Georgia",
    family: 'Georgia, "Times New Roman", serif',
    note: "Serif de pantalla; cómoda para lectura continua en bloques largos."
  }
};

function applyFont(fontId) {
  const option = fontOptions[fontId] || fontOptions.atkinson;
  document.documentElement.style.setProperty("--study-font", option.family);
  document.documentElement.dataset.font = fontId;
}

function initFontSelector() {
  const saved = localStorage.getItem(FONT_KEY) || "atkinson";
  applyFont(saved);
  const nav = $(".top-nav");
  if (!nav || $("#fontSelect")) return;
  const control = document.createElement("div");
  control.className = "font-control";
  control.innerHTML = `
    <label for="fontSelect">Tipografía</label>
    <select id="fontSelect" aria-label="Cambiar tipografía de estudio">
      ${Object.entries(fontOptions).map(([id, option]) => `<option value="${id}">${option.label}</option>`).join("")}
    </select>
  `;
  nav.appendChild(control);
  const select = $("#fontSelect");
  select.value = fontOptions[saved] ? saved : "atkinson";
  select.title = fontOptions[select.value].note;
  select.addEventListener("change", () => {
    localStorage.setItem(FONT_KEY, select.value);
    applyFont(select.value);
    select.title = fontOptions[select.value].note;
    notify("Tipografía actualizada", fontOptions[select.value].note, "success");
  });
}

async function loadCourseSelector() {
  const selector = $("#courseSelector");
  if (!selector) return;
  const courses = await api("/api/courses");
  selector.innerHTML = courses.map(course => `<option value="${course.id}">${course.title}</option>`).join("");
  selector.value = activeCourse;
  selector.addEventListener("change", () => {
    activeCourse = selector.value;
    localStorage.setItem("activeCourse", activeCourse);
    location.reload();
  });
}

function moduleName(moduleId) {
  return moduleId.replace("clase-", "Clase ");
}

function notify(title, text, icon = "info") {
  return window.Swal ? Swal.fire({ title, text, icon }) : alert(`${title}\n${text || ""}`);
}

function confetti() {
  for (let i = 0; i < 42; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = ["#8fc7ee", "#8ddfbd", "#ffd982", "#d8c4ff"][i % 4];
    piece.style.animationDelay = `${Math.random() * .4}s`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 1600);
  }
}

async function renderHome() {
  const root = $("#courseCards");
  if (!root) return;
  const courses = await api("/api/courses");
  root.innerHTML = courses.map(course => `
    <article class="card">
      <div class="icon">M</div>
      <h3>${course.title}</h3>
      <p>${course.description}</p>
      <a class="btn primary" href="course.html?course=${course.id}">Estudiar materia</a>
    </article>
  `).join("");
}

async function renderCourse() {
  const root = $("#courseDashboard");
  if (!root) return;
  const id = new URLSearchParams(location.search).get("course") || activeCourse;
  activeCourse = id;
  localStorage.setItem("activeCourse", id);
  const course = await api(`/api/courses/${id}`);
  $("#courseTitle").textContent = course.title;
  $("#courseDescription").textContent = course.description;
  root.innerHTML = [
    ["T", "Teoría", "Estudia módulos, conceptos y ejemplos.", "teoria.html"],
    ["P", "Banco de preguntas", "Practica con respuestas sugeridas.", "preguntas.html"],
    ["G", "Laboratorio gráfico", "Interpreta visualizaciones y datos.", "graficas.html"],
    ["E", "Simulador", "Realiza intentos de 30 preguntas.", "simulador.html"],
    ["C", "Checklist", "Marca competencias dominadas.", "checklist.html"]
  ].map(([icon, title, desc, href]) => `
    <article class="card">
      <div class="icon">${icon}</div>
      <h3>${title}</h3>
      <p>${desc}</p>
      <a class="btn" href="${href}">Entrar</a>
    </article>
  `).join("");
}

async function renderLessons() {
  const root = $("#lessons");
  if (!root) return;
  const modules = await api(`/api/courses/${activeCourse}/lessons`);
  root.innerHTML = modules.map(module => `
    <article class="lesson-module">
      <span class="kicker">${module.id}</span>
      <h2>${module.title}</h2>
      <p>${module.summary}</p>
      ${module.blocks.map(block => `
        <section class="lesson-block">
          <h3>${block.title}</h3>
          <div class="lesson-content">${block.content}</div>
        </section>
      `).join("")}
    </article>
  `).join("");
}

async function renderQuestionBank() {
  const root = $("#questionBank");
  if (!root) return;
  const questions = await api(`/api/courses/${activeCourse}/questions`);
  const byModule = Object.groupBy ? Object.groupBy(questions, q => q.module_id) : groupBy(questions, q => q.module_id);
  root.innerHTML = Object.entries(byModule).map(([module, items]) => `
    <section class="panel">
      <h2>${moduleName(module)}</h2>
      ${items.map((q, index) => questionCard(q, index + 1, true)).join("")}
    </section>
  `).join("");
  bindAnswerButtons();
}

function groupBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);
    acc[key] ||= [];
    acc[key].push(item);
    return acc;
  }, {});
}

function questionCard(q, number, showAnswer) {
  const input = q.type === "choice"
    ? `<div class="options">${q.options.map(option => `<label class="option"><input type="radio" name="${q.id}-${number}" value="${option}"> ${option}</label>`).join("")}</div>`
    : `<textarea placeholder="Escriba su respuesta..."></textarea>`;
  return `
    <article class="question-card" data-question-id="${q.id}">
      <p><strong>${number}.</strong> ${q.prompt}</p>
      ${input}
      ${showAnswer ? `<button class="btn secondary answer-toggle" type="button">Ver respuesta correcta</button><div class="answer"><p><strong>Respuesta correcta:</strong> ${q.correct_answer || "Revisar explicación."}</p><p><strong>Por qué:</strong> ${q.explanation}</p></div>` : ""}
    </article>
  `;
}

function bindAnswerButtons() {
  $$(".answer-toggle").forEach(button => {
    button.addEventListener("click", () => {
      const answer = button.nextElementSibling;
      answer.classList.toggle("visible");
      button.textContent = answer.classList.contains("visible") ? "Ocultar respuesta correcta" : "Ver respuesta correcta";
    });
  });
}

async function renderGraphs() {
  const root = $("#graphs");
  if (!root) return;
  const graphs = await api(`/api/courses/${activeCourse}/graphs`);
  root.innerHTML = graphs.map(graph => `
    <article class="graph-card">
      <h2 class="figure-title">${graph.title}</h2>
      <p>${graph.description}</p>
      <div class="chart-wrap"><svg class="chart" id="graph-${graph.id}"></svg></div>
      <h3>Preguntas de análisis</h3>
      <ol>${graph.analysis.map(item => `<li>${item.question}</li>`).join("")}</ol>
      <button class="btn secondary answer-toggle" type="button">Ver respuesta sugerida</button>
      <div class="answer"><ol>${graph.analysis.map(item => `<li>${item.answer}</li>`).join("")}</ol></div>
    </article>
  `).join("");
  graphs.forEach(graph => drawGraph($(`#graph-${graph.id}`), graph));
  bindAnswerButtons();
}

function svgEl(name, attrs = {}, text = "") {
  const node = document.createElementNS(svgNS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  if (text) node.textContent = text;
  return node;
}

function clearSvg(svg, width = 760, height = 410) {
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width, height, fill: "#0d1b2d" }));
}

function wrappedSvgText(svg, text, attrs, maxWidth, lineHeight = 17) {
  const node = svgEl("text", attrs);
  const words = String(text).split(/\s+/);
  let line = [];
  let tspan = svgEl("tspan", { x: attrs.x, dy: 0 });
  node.appendChild(tspan);
  svg.appendChild(node);

  words.forEach(word => {
    line.push(word);
    tspan.textContent = line.join(" ");
    if (line.length > 1 && tspan.getComputedTextLength && tspan.getComputedTextLength() > maxWidth) {
      line.pop();
      tspan.textContent = line.join(" ");
      line = [word];
      tspan = svgEl("tspan", { x: attrs.x, dy: lineHeight });
      tspan.textContent = word;
      node.appendChild(tspan);
    }
  });

  return node;
}

function drawAxes(svg, cfg) {
  const { width, height, left, right, top, bottom, title, xLabel, yLabel } = cfg;
  svg.appendChild(svgEl("line", { x1: left, y1: height - bottom, x2: width - right, y2: height - bottom, stroke: "#8fc7ee", "stroke-width": 1.5 }));
  svg.appendChild(svgEl("line", { x1: left, y1: top, x2: left, y2: height - bottom, stroke: "#8fc7ee", "stroke-width": 1.5 }));
  svg.appendChild(svgEl("text", { x: (left + width - right) / 2, y: height - 16, "text-anchor": "middle", fill: "#a9bed0", "font-size": 13, "font-weight": 700 }, xLabel));
  svg.appendChild(svgEl("text", { x: 18, y: (top + height - bottom) / 2, "text-anchor": "middle", fill: "#a9bed0", "font-size": 13, "font-weight": 700, transform: `rotate(-90 18 ${(top + height - bottom) / 2})` }, yLabel));
}

function drawGraph(svg, graph) {
  if (!svg) return;
  if (graph.type === "targets") return drawTargets(svg, graph);
  const width = 760, height = 410, left = 82, right = 34, top = 62, bottom = 86;
  clearSvg(svg, width, height);
  drawAxes(svg, { width, height, left, right, top, bottom, title: graph.title, xLabel: graph.x_label, yLabel: graph.y_label });
  if (graph.type === "bar") drawBars(svg, graph.data, { width, height, left, right, top, bottom });
  if (graph.type === "line") drawLine(svg, graph.data, { width, height, left, right, top, bottom });
  if (graph.type === "scatter") drawScatter(svg, graph.data, { width, height, left, right, top, bottom });
  if (graph.type === "errorbar") drawErrorBars(svg, graph.data, { width, height, left, right, top, bottom });
}

function drawBars(svg, data, cfg) {
  const max = Math.max(...data.map(d => d.value));
  const plotH = cfg.height - cfg.top - cfg.bottom;
  const plotW = cfg.width - cfg.left - cfg.right;
  const slot = plotW / data.length;
  data.forEach((d, i) => {
    const barW = slot * .48, x = cfg.left + i * slot + (slot - barW) / 2;
    const h = (d.value / max) * (plotH - 16), y = cfg.height - cfg.bottom - h;
    svg.appendChild(svgEl("rect", { x, y, width: barW, height: h, rx: 5, fill: ["#d8c4ff", "#ffb7ad", "#dce6ea", "#8ddfbd"][i % 4] }));
    svg.appendChild(svgEl("text", { x: x + barW / 2, y: y - 8, "text-anchor": "middle", fill: "#edf6fb", "font-size": 12, "font-weight": 800 }, d.value));
    svg.appendChild(svgEl("text", { x: x + barW / 2, y: cfg.height - cfg.bottom + 24, "text-anchor": "middle", fill: "#a9bed0", "font-size": 12 }, d.label));
  });
}

function drawLine(svg, data, cfg) {
  const values = data.map(d => d.value);
  const min = Math.min(...values) - 10, max = Math.max(...values) + 10;
  const plotW = cfg.width - cfg.left - cfg.right, plotH = cfg.height - cfg.top - cfg.bottom;
  const points = data.map((d, i) => ({ ...d, x: cfg.left + (i / (data.length - 1)) * plotW, y: cfg.height - cfg.bottom - ((d.value - min) / (max - min)) * plotH }));
  svg.appendChild(svgEl("polyline", { points: points.map(p => `${p.x},${p.y}`).join(" "), fill: "none", stroke: "#8ddfbd", "stroke-width": 3 }));
  points.forEach(p => {
    svg.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: 6, fill: "#ffd982", stroke: "#07111f", "stroke-width": 1.4 }));
    svg.appendChild(svgEl("text", { x: p.x, y: p.y - 12, "text-anchor": "middle", fill: "#edf6fb", "font-size": 12, "font-weight": 800 }, p.value));
    svg.appendChild(svgEl("text", { x: p.x, y: cfg.height - cfg.bottom + 24, "text-anchor": "middle", fill: "#a9bed0", "font-size": 12 }, p.label));
  });
}

function drawScatter(svg, data, cfg) {
  const xs = data.map(d => d.x), ys = data.map(d => d.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys) - 5, maxY = Math.max(...ys) + 5;
  const plotW = cfg.width - cfg.left - cfg.right, plotH = cfg.height - cfg.top - cfg.bottom;
  data.forEach(d => {
    const x = cfg.left + ((d.x - minX) / (maxX - minX)) * plotW;
    const y = cfg.height - cfg.bottom - ((d.y - minY) / (maxY - minY)) * plotH;
    svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 7, fill: "#8fc7ee" }));
  });
}

function drawErrorBars(svg, data, cfg) {
  const max = Math.max(...data.map(d => d.mean + d.sd)) + 20;
  const plotH = cfg.height - cfg.top - cfg.bottom, plotW = cfg.width - cfg.left - cfg.right, slot = plotW / data.length;
  data.forEach((d, i) => {
    const barW = slot * .44, x = cfg.left + i * slot + (slot - barW) / 2;
    const h = (d.mean / max) * plotH, y = cfg.height - cfg.bottom - h;
    const errTop = cfg.height - cfg.bottom - ((d.mean + d.sd) / max) * plotH;
    const errBottom = cfg.height - cfg.bottom - ((d.mean - d.sd) / max) * plotH;
    svg.appendChild(svgEl("rect", { x, y, width: barW, height: h, rx: 5, fill: ["#d8c4ff", "#8fc7ee", "#8ddfbd", "#ffd982"][i % 4] }));
    svg.appendChild(svgEl("line", { x1: x + barW / 2, y1: errTop, x2: x + barW / 2, y2: errBottom, stroke: "#edf6fb", "stroke-width": 2 }));
    svg.appendChild(svgEl("line", { x1: x + barW / 2 - 12, y1: errTop, x2: x + barW / 2 + 12, y2: errTop, stroke: "#edf6fb", "stroke-width": 2 }));
    svg.appendChild(svgEl("text", { x: x + barW / 2, y: cfg.height - cfg.bottom + 24, "text-anchor": "middle", fill: "#a9bed0", "font-size": 11 }, d.label));
  });
}

function drawTargets(svg, graph) {
  clearSvg(svg, 760, 410);
  const panels = [
    [142, 150, "A. Alta precisión y alta exactitud", [[-4, -3], [4, 2], [1, -5], [-2, 4], [3, -1]]],
    [315, 150, "B. Alta precisión y baja exactitud", [[28, -23], [33, -19], [29, -16], [36, -22], [31, -27]]],
    [488, 150, "C. Baja precisión y alta exactitud", [[-26, -2], [23, 9], [-8, 29], [15, -22], [0, 6]]],
    [658, 150, "D. Baja precisión y baja exactitud", [[-39, 12], [31, -34], [42, 25], [-28, -31], [13, 39]]]
  ];
  panels.forEach(([cx, cy, label, pts]) => drawTarget(svg, cx, cy, label, pts));
}

function drawTarget(svg, cx, cy, label, pts) {
  [48, 34, 20, 6].forEach((r, i) => svg.appendChild(svgEl("circle", { cx, cy, r, fill: i % 2 ? "#14263b" : "#1b344f", stroke: "#8fc7ee" })));
  svg.appendChild(svgEl("circle", { cx, cy, r: 3.5, fill: "#ffd982" }));
  pts.forEach(p => svg.appendChild(svgEl("circle", { cx: cx + p[0], cy: cy + p[1], r: 4.2, fill: "#8ddfbd", stroke: "#07111f" })));
  svg.appendChild(svgEl("text", { x: cx, y: cy + 78, "text-anchor": "middle", fill: "#edf6fb", "font-size": 11, "font-weight": 800 }, label));
}

async function renderExam() {
  const start = $("#startExam");
  const area = $("#examArea");
  if (!start || !area) return;
  start.addEventListener("click", async () => {
    const exam = await api("/api/exams/generate", { method: "POST", body: JSON.stringify({ course_id: activeCourse, amount: 30 }) });
    currentExam = exam.questions;
    area.innerHTML = currentExam.map((q, i) => examQuestion(q, i + 1)).join("") + `<button id="finishExam" class="btn primary" type="button">Calcular puntaje final</button>`;
    bindExamChecks();
    $("#finishExam").addEventListener("click", finishExam);
    notify("Simulador iniciado", "Se generaron 30 preguntas mezcladas.", "success");
  });
}

function examQuestion(q, number) {
  const input = q.type === "choice"
    ? `<div class="options">${q.options.map(option => `<label class="option"><input type="radio" name="exam-${number}" value="${option}"> ${option}</label>`).join("")}</div>`
    : `<input class="short-answer" type="text" placeholder="Respuesta corta...">`;
  return `<article class="question-card" data-question-id="${q.id}"><p><strong>${number}.</strong> ${q.prompt}</p>${input}<button class="btn secondary check-answer" type="button">Revisar respuesta</button><div class="feedback"></div></article>`;
}

function bindExamChecks() {
  $$(".check-answer").forEach(button => {
    button.addEventListener("click", async () => {
      const card = button.closest(".question-card");
      const answer = $("input[type='radio']:checked", card)?.value || $(".short-answer", card)?.value || "";
      const result = await api("/api/exams/check", { method: "POST", body: JSON.stringify({ course_id: activeCourse, question_id: card.dataset.questionId, answer }) });
      card.dataset.correct = result.correct ? "1" : "0";
      const fb = $(".feedback", card);
      fb.className = `feedback ${result.correct ? "ok" : "no"}`;
      fb.textContent = `${result.correct ? "Correcto." : "Revisar."} ${result.explanation}`;
      notify(result.correct ? "Correcto" : "Revisar", result.explanation, result.correct ? "success" : "warning");
    });
  });
}

async function finishExam() {
  const answers = $$("#examArea .question-card").map(card => ({
    question_id: card.dataset.questionId,
    answer: $("input[type='radio']:checked", card)?.value || $(".short-answer", card)?.value || ""
  }));
  const result = await api("/api/exams/grade", { method: "POST", body: JSON.stringify({ course_id: activeCourse, answers }) });
  const box = $("#scoreBox");
  box.style.display = "block";
  box.innerHTML = `<h2>Puntaje final: ${result.score}%</h2><p>${result.correct} de ${result.total} respuestas correctas. ${result.label}</p>`;
  if (result.score >= 75) confetti();
  notify("Resultado final", `${result.score}% - ${result.label}`, result.score >= 75 ? "success" : "warning");
}

async function renderChecklist() {
  const root = $("#checklist");
  if (!root) return;
  const items = await api(`/api/courses/${activeCourse}/checklist`);
  const key = `checklist:${activeCourse}`;
  const saved = JSON.parse(localStorage.getItem(key) || "[]");
  root.innerHTML = items.map((item, i) => `<label class="check-row"><input type="checkbox" data-index="${i}" ${saved[i] ? "checked" : ""}> ${item.text}</label>`).join("");
  function update() {
    const checks = $$("#checklist input");
    const values = checks.map(c => c.checked);
    localStorage.setItem(key, JSON.stringify(values));
    const done = values.filter(Boolean).length;
    $("#checkProgress").textContent = `Progreso: ${done} de ${checks.length} completado`;
    $("#progressBar").style.width = `${(done / checks.length) * 100}%`;
  }
  $$("#checklist input").forEach(input => input.addEventListener("change", update));
  update();
}

async function renderAdmin() {
  if (!$("#adminArea")) return;
  const notice = document.createElement("div");
  notice.className = "warning";
  notice.innerHTML = "<strong>Versión estática:</strong> en Vercel el admin no guarda cambios permanentes. Para cambiar contenido, edita <code>data/site.json</code> y vuelve a desplegar.";
  $("#adminArea").prepend(notice);
  bindAdminForm("#adminCourseForm", "/api/admin/courses", () => ({
    id: $("#courseId").value,
    title: $("#courseTitleInput").value,
    subtitle: $("#courseSubtitle").value,
    description: $("#courseDescriptionInput").value
  }), "Materia guardada");
  bindAdminForm("#adminModuleForm", "/api/admin/modules", () => ({
    id: $("#moduleId").value,
    course_id: $("#moduleCourse").value || activeCourse,
    title: $("#moduleTitle").value,
    summary: $("#moduleSummary").value
  }), "Módulo guardado");
  bindAdminForm("#adminLessonForm", "/api/admin/lesson-blocks", () => ({
    module_id: $("#lessonModule").value,
    title: $("#lessonTitle").value,
    content: $("#lessonContent").value
  }), "Bloque de teoría guardado");
  bindAdminForm("#adminChecklistForm", "/api/admin/checklist-items", () => ({
    course_id: $("#checkCourse").value || activeCourse,
    text: $("#checkText").value
  }), "Checklist actualizado");
  bindAdminForm("#adminQuestionForm", "/api/admin/questions", () => ({
    course_id: $("#qCourse").value || activeCourse,
    module_id: $("#qModule").value || "general",
    type: $("#qType").value,
    prompt: $("#qPrompt").value,
    options: $("#qOptions").value.split("\n").map(x => x.trim()).filter(Boolean),
    answer: $("#qAnswer").value,
    keywords: $("#qKeywords").value.split(",").map(x => x.trim()).filter(Boolean),
    explanation: $("#qExplanation").value
  }), "Pregunta guardada");
}

function bindAdminForm(selector, endpoint, buildPayload, successTitle) {
  const form = $(selector);
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const token = $("#adminToken").value;
    try {
      await api(endpoint, { method: "POST", headers: { "X-Admin-Token": token }, body: JSON.stringify(buildPayload()) });
      form.reset();
      if ($("#adminToken")) $("#adminToken").value = token;
      notify(successTitle, "El contenido quedó guardado.", "success");
    } catch (error) {
      notify("Admin no disponible", error.message, "warning");
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  setActiveNav();
  initFontSelector();
  await loadCourseSelector();
  await renderHome();
  await renderCourse();
  await renderLessons();
  await renderQuestionBank();
  await renderGraphs();
  await renderExam();
  await renderChecklist();
  await renderAdmin();
});
