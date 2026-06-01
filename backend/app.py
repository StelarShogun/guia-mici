from __future__ import annotations

import json
import os
import random
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
FRONTEND_DIR = ROOT / "frontend"
DB_PATH = DATA_DIR / "study_app.sqlite3"
SEED_PATH = DATA_DIR / "seed.json"
ADMIN_TOKEN = os.getenv("STUDY_ADMIN_TOKEN", "admin")

app = FastAPI(title="Study Platform API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")
app.mount("/vendor", StaticFiles(directory=ROOT / "vendor"), name="vendor")


def db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def load(value: str | None, fallback: Any = None) -> Any:
    if value is None:
        return fallback
    return json.loads(value)


def require_admin(x_admin_token: str | None) -> None:
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Admin token inválido")


def init_db() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    with db() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS courses (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              subtitle TEXT NOT NULL DEFAULT '',
              description TEXT NOT NULL DEFAULT '',
              meta_json TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS modules (
              id TEXT PRIMARY KEY,
              course_id TEXT NOT NULL,
              title TEXT NOT NULL,
              summary TEXT NOT NULL DEFAULT '',
              position INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS lesson_blocks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              module_id TEXT NOT NULL,
              title TEXT NOT NULL,
              content TEXT NOT NULL,
              position INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS questions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              course_id TEXT NOT NULL,
              module_id TEXT NOT NULL,
              type TEXT NOT NULL,
              prompt TEXT NOT NULL,
              options_json TEXT NOT NULL DEFAULT '[]',
              answer_json TEXT NOT NULL DEFAULT 'null',
              keywords_json TEXT NOT NULL DEFAULT '[]',
              explanation TEXT NOT NULL DEFAULT '',
              tags_json TEXT NOT NULL DEFAULT '[]',
              difficulty TEXT NOT NULL DEFAULT 'media'
            );
            CREATE TABLE IF NOT EXISTS graphs (
              id TEXT PRIMARY KEY,
              course_id TEXT NOT NULL,
              type TEXT NOT NULL,
              title TEXT NOT NULL,
              description TEXT NOT NULL,
              x_label TEXT NOT NULL,
              y_label TEXT NOT NULL,
              data_json TEXT NOT NULL,
              analysis_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS checklist_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              course_id TEXT NOT NULL,
              text TEXT NOT NULL,
              position INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        count = con.execute("SELECT COUNT(*) AS n FROM courses").fetchone()["n"]
        if count == 0:
            seed_database(con)


def seed_database(con: sqlite3.Connection) -> None:
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    for course in seed["courses"]:
        con.execute(
            "INSERT INTO courses (id, title, subtitle, description, meta_json) VALUES (?, ?, ?, ?, ?)",
            (course["id"], course["title"], course["subtitle"], course["description"], "{}"),
        )
        for module_pos, module in enumerate(course["modules"]):
            con.execute(
                "INSERT INTO modules (id, course_id, title, summary, position) VALUES (?, ?, ?, ?, ?)",
                (module["id"], course["id"], module["title"], module["summary"], module_pos),
            )
            for block_pos, block in enumerate(module["blocks"]):
                con.execute(
                    "INSERT INTO lesson_blocks (module_id, title, content, position) VALUES (?, ?, ?, ?)",
                    (module["id"], block["title"], block["content"], block_pos),
                )
        for question in course["questions"]:
            con.execute(
                """
                INSERT INTO questions
                (course_id, module_id, type, prompt, options_json, answer_json, keywords_json, explanation, tags_json, difficulty)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    course["id"],
                    question["module_id"],
                    question["type"],
                    question["prompt"],
                    dump(question.get("options", [])),
                    dump(question.get("answer")),
                    dump(question.get("keywords", [])),
                    question.get("explanation", ""),
                    dump(question.get("tags", [])),
                    question.get("difficulty", "media"),
                ),
            )
        for graph in course["graphs"]:
            con.execute(
                """
                INSERT INTO graphs
                (id, course_id, type, title, description, x_label, y_label, data_json, analysis_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    graph["id"],
                    course["id"],
                    graph["type"],
                    graph["title"],
                    graph["description"],
                    graph["x_label"],
                    graph["y_label"],
                    dump(graph["data"]),
                    dump(graph["analysis"]),
                ),
            )
        for pos, item in enumerate(course["checklist"]):
            con.execute(
                "INSERT INTO checklist_items (course_id, text, position) VALUES (?, ?, ?)",
                (course["id"], item, pos),
            )


@app.on_event("startup")
def startup() -> None:
    init_db()


def row_question(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": f"db:{row['id']}",
        "course_id": row["course_id"],
        "module_id": row["module_id"],
        "type": row["type"],
        "prompt": row["prompt"],
        "options": load(row["options_json"], []),
        "answer": load(row["answer_json"]),
        "keywords": load(row["keywords_json"], []),
        "explanation": row["explanation"],
        "tags": load(row["tags_json"], []),
        "difficulty": row["difficulty"],
    }


def public_question(question: dict[str, Any]) -> dict[str, Any]:
    item = {k: v for k, v in question.items() if k not in {"answer", "keywords"}}
    if item["type"] == "choice":
        item["options"] = random.sample(item.get("options", []), len(item.get("options", [])))
    return item


def bank_question(question: dict[str, Any]) -> dict[str, Any]:
    item = public_question(question)
    if question["type"] == "choice":
        item["correct_answer"] = question.get("answer")
    else:
        item["correct_answer"] = ", ".join(question.get("keywords", []))
    return item


def generated_questions(course_id: str) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []

    def add(q: dict[str, Any]) -> None:
        q["id"] = f"gen:{len(questions)}"
        q["course_id"] = course_id
        q.setdefault("module_id", "general")
        q.setdefault("difficulty", "media")
        q.setdefault("tags", [])
        questions.append(q)

    base = [
        ("¿Cuál es la fórmula básica para redactar un objetivo?", ["Verbo en infinitivo + qué + cómo + para qué", "Tema + opinión + conclusión", "Pregunta + hipótesis + bibliografía"], "Verbo en infinitivo + qué + cómo + para qué", "Un objetivo completo indica acción, objeto, procedimiento y propósito."),
        ("¿Qué error aparece en “Yo creo que mi programa es el mejor”?", ["Primera persona y juicio de valor", "Dato continuo", "Conector de contraste"], "Primera persona y juicio de valor", "Usa primera persona y una afirmación valorativa sin evidencia."),
        ("¿Qué ocurre si los objetivos están mal planteados?", ["Los datos pueden no responder al problema aunque sean correctos", "La estadística corrige automáticamente el diseño", "La muestra deja de importar"], "Los datos pueden no responder al problema aunque sean correctos", "La estadística no reemplaza un planteamiento claro del problema."),
        ("La desviación estándar se interpreta en:", ["Las mismas unidades de los datos", "Porcentajes obligatorios", "Categorías nominales"], "Las mismas unidades de los datos", "Es la raíz de la varianza y conserva unidades de medición."),
        ("Fabricar o manipular datos corresponde a:", ["Fraude científico", "Muestreo aleatorio", "Dato ordinal"], "Fraude científico", "Altera la confianza científica y la validez del estudio."),
        ("Presentar ideas o datos ajenos como propios es:", ["Plagio", "Varianza", "Exactitud"], "Plagio", "Debe darse crédito adecuado a fuentes, ideas y datos."),
        ("Antes de una figura en resultados debe existir:", ["Un párrafo descriptivo general", "Solo la imagen", "Una opinión personal"], "Un párrafo descriptivo general", "El texto introduce y contextualiza la figura."),
    ]
    for prompt, options, answer, explanation in base:
        add({"type": "choice", "prompt": prompt, "options": options, "answer": answer, "explanation": explanation})

    types = [
        ("Color de computadora", "Categórico nominal", "Es una categoría sin orden natural."),
        ("Sistema operativo instalado", "Categórico nominal", "Windows, Linux o macOS son nombres de categorías sin jerarquía."),
        ("Lenguaje de programación favorito", "Categórico nominal", "Las categorías no tienen orden cuantitativo."),
        ("Nivel de satisfacción bajo, medio, alto", "Categórico ordinal", "Las categorías tienen orden."),
        ("Prioridad de tarea: baja, normal, alta", "Categórico ordinal", "Las etiquetas tienen orden lógico."),
        ("Número de errores en un programa", "Numérico discreto", "Es un conteo entero."),
        ("Cantidad de usuarios conectados", "Numérico discreto", "Se cuenta en valores enteros."),
        ("Número de commits en un repositorio", "Numérico discreto", "Es una cantidad contable."),
        ("Tiempo de respuesta de un servidor", "Numérico continuo", "Puede tomar valores con decimales dentro de un intervalo."),
        ("Velocidad de descarga", "Numérico continuo", "Puede medirse con valores decimales."),
        ("Temperatura del procesador", "Numérico continuo", "Puede variar continuamente dentro de un rango."),
        ("Latencia de red en milisegundos", "Numérico continuo", "Es una magnitud medible en un intervalo."),
    ]
    for variable, answer, explanation in types:
        options = [answer, "Categórico nominal", "Categórico ordinal", "Numérico discreto", "Numérico continuo"]
        options = list(dict.fromkeys(options))
        add({"type": "choice", "prompt": f"Clasifique el dato: {variable}.", "options": options, "answer": answer, "explanation": explanation})

    connectors = [
        ("además", "Adición"), ("asimismo", "Adición"), ("también", "Adición"),
        ("sin embargo", "Contraste"), ("no obstante", "Contraste"), ("por el contrario", "Contraste"),
        ("por consiguiente", "Causa/efecto"), ("por lo tanto", "Causa/efecto"), ("en consecuencia", "Causa/efecto"),
        ("por ejemplo", "Ejemplificación"), ("es decir", "Ejemplificación"), ("a saber", "Ejemplificación"),
        ("en resumen", "Conclusión"), ("en síntesis", "Conclusión"), ("finalmente", "Conclusión"),
    ]
    for connector, answer in connectors:
        add({"type": "choice", "prompt": f"¿Qué tipo de conector es “{connector}”?", "options": [answer, "Adición", "Contraste", "Causa/efecto", "Ejemplificación", "Conclusión"], "answer": answer, "explanation": f"“{connector}” cumple función de {answer.lower()} en un texto académico."})

    datasets = [
        ([2, 4, 6, 8], "5", "5", "6"),
        ([10, 12, 14, 16, 18], "14", "14", "8"),
        ([5, 5, 7, 9], "6.5", "6", "4"),
        ([20, 25, 30, 35, 40], "30", "30", "20"),
        ([100, 120, 140], "120", "120", "40"),
        ([1, 3, 3, 5], "3", "3", "4"),
        ([50, 60, 70, 80, 90], "70", "70", "40"),
        ([7, 8, 9, 10, 11], "9", "9", "4"),
        ([15, 20, 20, 25], "20", "20", "10"),
        ([200, 220, 240, 260], "230", "230", "60"),
    ]
    for values, media, mediana, rango in datasets:
        label = ", ".join(map(str, values))
        add({"type": "short", "prompt": f"Calcule la media de: {label}.", "keywords": [media], "explanation": f"La media es {media}."})
        add({"type": "short", "prompt": f"Calcule la mediana de: {label}.", "keywords": [mediana], "explanation": f"La mediana es {mediana}."})
        add({"type": "short", "prompt": f"Calcule el rango de: {label}.", "keywords": [rango], "explanation": f"El rango es {rango}."})

    objective_parts = [
        ("Evaluar", "el rendimiento de una aplicación web", "mediante pruebas de carga", "para identificar cuellos de botella"),
        ("Comparar", "algoritmos de búsqueda", "mediante mediciones de tiempo de ejecución", "para seleccionar la opción más eficiente"),
        ("Describir", "los hábitos de estudio de estudiantes", "mediante un cuestionario estructurado", "para caracterizar patrones de preparación"),
        ("Analizar", "la usabilidad de una plataforma educativa", "mediante una escala de satisfacción", "para proponer mejoras de diseño"),
        ("Determinar", "la frecuencia de errores en un sistema", "mediante revisión de registros", "para priorizar acciones correctivas"),
        ("Medir", "la latencia de una red local", "mediante pruebas repetidas de conectividad", "para estimar su estabilidad"),
    ]
    for verb, what, how, why in objective_parts:
        full = f"{verb} {what} {how} {why}"
        add({"type": "choice", "prompt": f"En el objetivo “{full}”, ¿cuál es el verbo?", "options": [verb, what, how], "answer": verb, "explanation": "El verbo en infinitivo expresa la acción central."})
        add({"type": "choice", "prompt": f"En el objetivo “{full}”, ¿cuál parte corresponde al qué?", "options": [what, how, why], "answer": what, "explanation": "El qué indica el objeto o fenómeno investigado."})
        add({"type": "choice", "prompt": f"En el objetivo “{full}”, ¿cuál parte corresponde al cómo?", "options": [how, what, why], "answer": how, "explanation": "El cómo identifica método o procedimiento."})

    method_items = [
        ("ubicación geográfica o institucional", "Dónde", "El dónde ubica el estudio en un contexto espacial o institucional."),
        ("periodo de estudio o fechas de búsqueda", "Cuándo", "El cuándo define el marco temporal de la investigación."),
        ("herramientas e instrumentos usados", "Cómo", "El cómo describe procedimientos y recursos utilizados."),
        ("población, muestra y variables", "Con qué datos", "Identifica la base empírica del estudio."),
        ("bases de datos consultadas", "Revisión bibliográfica", "Una revisión debe declarar dónde buscó literatura."),
        ("palabras clave", "Revisión bibliográfica", "Permiten reproducir o evaluar la búsqueda."),
        ("criterios de inclusión y exclusión", "Revisión bibliográfica", "Definen qué fuentes entran y cuáles quedan fuera."),
        ("gestor bibliográfico usado", "Revisión bibliográfica", "Ayuda a organizar y citar fuentes."),
        ("software de análisis", "Metodología", "Debe reportarse si se usó para organizar o procesar datos."),
        ("motores de búsqueda", "Revisión bibliográfica", "Indican el canal usado para localizar documentos."),
        ("operadores AND, OR, NOT", "Operadores booleanos", "Permiten combinar, ampliar o excluir términos."),
        ("procedimiento de selección de artículos", "Metodología", "Explica cómo se llegó al conjunto final de fuentes."),
    ]
    for element, answer, explanation in method_items:
        add({"type": "choice", "prompt": f"En metodología, ¿a qué corresponde “{element}”?", "options": [answer, "Moda", "Título del eje Y", "Dato continuo"], "answer": answer, "explanation": explanation})

    precision_items = [
        ("Puntos agrupados cerca del centro", "Alta precisión y alta exactitud", "Están juntos y próximos al valor real."),
        ("Puntos agrupados lejos del centro", "Alta precisión y baja exactitud", "Son consistentes, pero no cercanos al valor real."),
        ("Puntos dispersos alrededor del centro", "Baja precisión y alta exactitud", "No están agrupados, pero rodean el valor real."),
        ("Puntos dispersos lejos del centro", "Baja precisión y baja exactitud", "No son consistentes ni cercanos al valor real."),
        ("Baja dispersión entre mediciones", "Precisión", "La precisión evalúa agrupación o consistencia."),
        ("Cercanía al valor real", "Exactitud", "La exactitud evalúa proximidad al valor verdadero."),
    ]
    for case, answer, explanation in precision_items:
        add({"type": "choice", "prompt": f"¿Qué concepto representa este caso: {case}?", "options": [answer, "Moda", "Operador booleano", "Categórico nominal"], "answer": answer, "explanation": explanation})

    graph_ethics = [
        ("Para comparar frecuencias de colores se usa mejor:", "Gráfico de barras", "Las barras comparan categorías nominales."),
        ("Si al aumentar X también aumenta Y, la relación visual parece:", "Positiva", "Ambas variables se mueven en la misma dirección."),
        ("En barras con error, mayor barra de error indica:", "Mayor variabilidad", "La desviación estándar resume dispersión."),
        ("Copiar texto sin citar es:", "Plagio", "Se presenta trabajo ajeno como propio."),
        ("Inventar resultados de una encuesta es:", "Fabricación de datos", "Los datos no fueron recolectados realmente."),
        ("Eliminar valores que contradicen la hipótesis sin justificarlo es:", "Manipulación de datos", "Se altera la evidencia para favorecer un resultado."),
        ("Citar correctamente una fuente usada es:", "Práctica ética", "Reconoce autoría y permite verificar fuentes."),
    ]
    for prompt, answer, explanation in graph_ethics:
        add({"type": "choice", "prompt": prompt, "options": [answer, "Muestreo aleatorio", "Dato ordinal", "Conector"], "answer": answer, "explanation": explanation})

    return questions


def all_questions(course_id: str) -> list[dict[str, Any]]:
    with db() as con:
        rows = con.execute("SELECT * FROM questions WHERE course_id = ?", (course_id,)).fetchall()
    return [row_question(row) for row in rows] + generated_questions(course_id)


def find_question(course_id: str, question_id: str) -> dict[str, Any]:
    for question in all_questions(course_id):
        if question["id"] == question_id:
            return question
    raise HTTPException(status_code=404, detail="Pregunta no encontrada")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/{page_name}.html")
def page(page_name: str) -> FileResponse:
    path = FRONTEND_DIR / f"{page_name}.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Página no encontrada")
    return FileResponse(path)


@app.get("/api/courses")
def list_courses() -> list[dict[str, Any]]:
    with db() as con:
        rows = con.execute("SELECT * FROM courses ORDER BY title").fetchall()
    return [dict(row) for row in rows]


@app.get("/api/courses/{course_id}")
def get_course(course_id: str) -> dict[str, Any]:
    with db() as con:
        course = con.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
        if not course:
            raise HTTPException(status_code=404, detail="Materia no encontrada")
        modules = con.execute("SELECT * FROM modules WHERE course_id = ? ORDER BY position", (course_id,)).fetchall()
    result = dict(course)
    result["modules"] = [dict(row) for row in modules]
    return result


@app.get("/api/courses/{course_id}/lessons")
def lessons(course_id: str) -> list[dict[str, Any]]:
    with db() as con:
        modules = con.execute("SELECT * FROM modules WHERE course_id = ? ORDER BY position", (course_id,)).fetchall()
        result = []
        for module in modules:
            blocks = con.execute("SELECT title, content FROM lesson_blocks WHERE module_id = ? ORDER BY position", (module["id"],)).fetchall()
            item = dict(module)
            item["blocks"] = [dict(block) for block in blocks]
            result.append(item)
    return result


@app.get("/api/courses/{course_id}/questions")
def question_bank(course_id: str) -> list[dict[str, Any]]:
    return [bank_question(q) for q in all_questions(course_id)]


@app.get("/api/courses/{course_id}/graphs")
def graphs(course_id: str) -> list[dict[str, Any]]:
    with db() as con:
        rows = con.execute("SELECT * FROM graphs WHERE course_id = ? ORDER BY id", (course_id,)).fetchall()
    return [
        {
            **dict(row),
            "data": load(row["data_json"], []),
            "analysis": load(row["analysis_json"], []),
        }
        for row in rows
    ]


@app.get("/api/courses/{course_id}/checklist")
def checklist(course_id: str) -> list[dict[str, Any]]:
    with db() as con:
        rows = con.execute("SELECT id, text, position FROM checklist_items WHERE course_id = ? ORDER BY position", (course_id,)).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/exams/generate")
async def generate_exam(request: Request) -> dict[str, Any]:
    payload = await request.json()
    course_id = payload.get("course_id", "mici")
    amount = int(payload.get("amount", 30))
    questions = all_questions(course_id)
    amount = min(amount, len(questions))
    selected = random.sample(questions, amount)
    return {"course_id": course_id, "amount": amount, "questions": [public_question(q) for q in selected]}


@app.post("/api/exams/check")
async def check_answer(request: Request) -> dict[str, Any]:
    payload = await request.json()
    course_id = payload.get("course_id", "mici")
    question = find_question(course_id, payload["question_id"])
    answer = str(payload.get("answer", "")).strip()
    if question["type"] == "choice":
        correct = answer == str(question.get("answer"))
        expected = question.get("answer")
    else:
        normalized = answer.lower()
        correct = any(str(keyword).lower() in normalized for keyword in question.get("keywords", []))
        expected = ", ".join(question.get("keywords", []))
    return {"correct": correct, "expected": expected, "explanation": question.get("explanation", "")}


@app.post("/api/exams/grade")
async def grade_exam(request: Request) -> dict[str, Any]:
    payload = await request.json()
    course_id = payload.get("course_id", "mici")
    answers = payload.get("answers", [])
    checked = []
    correct_count = 0
    for item in answers:
        question = find_question(course_id, item["question_id"])
        answer = str(item.get("answer", "")).strip()
        if question["type"] == "choice":
            correct = answer == str(question.get("answer"))
        else:
            correct = any(str(keyword).lower() in answer.lower() for keyword in question.get("keywords", []))
        correct_count += int(correct)
        checked.append({"question_id": item["question_id"], "correct": correct, "explanation": question.get("explanation", "")})
    total = max(len(answers), 1)
    score = round((correct_count / total) * 100)
    if score >= 90:
        label = "Excelente preparación."
    elif score >= 75:
        label = "Buen dominio, repasar detalles."
    elif score >= 60:
        label = "Requiere reforzar teoría y gráficos."
    else:
        label = "Repasar nuevamente las clases."
    return {"score": score, "correct": correct_count, "total": len(answers), "label": label, "items": checked}


@app.post("/api/admin/courses")
async def create_course(request: Request, x_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_admin(x_admin_token)
    payload = await request.json()
    with db() as con:
        con.execute(
            "INSERT INTO courses (id, title, subtitle, description, meta_json) VALUES (?, ?, ?, ?, ?)",
            (payload["id"], payload["title"], payload.get("subtitle", ""), payload.get("description", ""), "{}"),
        )
    return {"ok": True}


@app.post("/api/admin/modules")
async def create_module(request: Request, x_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_admin(x_admin_token)
    payload = await request.json()
    with db() as con:
        pos = con.execute("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM modules WHERE course_id = ?", (payload["course_id"],)).fetchone()["pos"]
        con.execute(
            "INSERT INTO modules (id, course_id, title, summary, position) VALUES (?, ?, ?, ?, ?)",
            (payload["id"], payload["course_id"], payload["title"], payload.get("summary", ""), pos),
        )
    return {"ok": True}


@app.post("/api/admin/questions")
async def create_question(request: Request, x_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_admin(x_admin_token)
    payload = await request.json()
    with db() as con:
        cur = con.execute(
            """
            INSERT INTO questions
            (course_id, module_id, type, prompt, options_json, answer_json, keywords_json, explanation, tags_json, difficulty)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["course_id"],
                payload.get("module_id", "general"),
                payload["type"],
                payload["prompt"],
                dump(payload.get("options", [])),
                dump(payload.get("answer")),
                dump(payload.get("keywords", [])),
                payload.get("explanation", ""),
                dump(payload.get("tags", [])),
                payload.get("difficulty", "media"),
            ),
        )
    return {"ok": True, "id": cur.lastrowid}


@app.post("/api/admin/lesson-blocks")
async def create_lesson_block(request: Request, x_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_admin(x_admin_token)
    payload = await request.json()
    with db() as con:
        pos = con.execute("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM lesson_blocks WHERE module_id = ?", (payload["module_id"],)).fetchone()["pos"]
        con.execute(
            "INSERT INTO lesson_blocks (module_id, title, content, position) VALUES (?, ?, ?, ?)",
            (payload["module_id"], payload["title"], payload["content"], pos),
        )
    return {"ok": True}


@app.post("/api/admin/checklist-items")
async def create_checklist_item(request: Request, x_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    require_admin(x_admin_token)
    payload = await request.json()
    with db() as con:
        pos = con.execute("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM checklist_items WHERE course_id = ?", (payload["course_id"],)).fetchone()["pos"]
        con.execute(
            "INSERT INTO checklist_items (course_id, text, position) VALUES (?, ?, ?)",
            (payload["course_id"], payload["text"], pos),
        )
    return {"ok": True}
