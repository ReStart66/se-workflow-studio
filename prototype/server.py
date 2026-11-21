#!/usr/bin/env python3
"""Design-spec to development-task workflow prototype."""
from __future__ import annotations

import contextlib
import json
import math
import mimetypes
import re
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "workflow.db"
RULES_PATH = BASE_DIR / "workflow_rules.json"
RUN_CONTEXTS: dict[str, dict] = {}
RUN_CONTEXT_LOCK = threading.Lock()


class APIError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class WorkflowCancelled(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def fetch_all(sql: str, params: tuple = ()) -> list[dict]:
    with contextlib.closing(db_conn()) as conn:
        return [dict(row) for row in conn.execute(sql, params).fetchall()]


def fetch_one(sql: str, params: tuple = ()) -> dict | None:
    rows = fetch_all(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: tuple = ()) -> int:
    with contextlib.closing(db_conn()) as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        return int(cur.lastrowid or 0)


def add_event(workflow_id: str, event_type: str, message: str, level: str = "info", payload: dict | None = None) -> None:
    execute(
        "INSERT INTO events(workflow_id,type,level,message,payload,created_at) VALUES(?,?,?,?,?,?)",
        (workflow_id, event_type, level, message, json.dumps(payload or {}, ensure_ascii=False), now_iso()),
    )


def load_rules() -> dict:
    return json.loads(RULES_PATH.read_text(encoding="utf-8"))


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with contextlib.closing(db_conn()) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS workflows (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, product_name TEXT NOT NULL,
                spec_text TEXT NOT NULL, status TEXT NOT NULL, pm_model TEXT NOT NULL,
                summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, task_key TEXT NOT NULL,
                name TEXT NOT NULL, role TEXT NOT NULL, phase TEXT NOT NULL,
                priority TEXT NOT NULL, estimate_hours INTEGER NOT NULL,
                dependencies_json TEXT NOT NULL, status TEXT NOT NULL,
                start_day REAL NOT NULL, end_day REAL NOT NULL, position INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id TEXT NOT NULL,
                type TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info',
                message TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_workflow ON tasks(workflow_id, position);
            CREATE INDEX IF NOT EXISTS idx_events_workflow ON events(workflow_id, id);
            """
        )
        conn.commit()


def find_profile(spec_text: str, rules: dict) -> dict:
    text = spec_text.lower()
    for profile in rules.get("profiles", []):
        if any(keyword.lower() in text for keyword in profile.get("keywords", [])):
            merged = dict(rules["default"])
            merged.update(profile)
            return merged
    return dict(rules["default"])


def build_tasks(profile: dict) -> list[dict]:
    tasks: list[dict] = []
    counter = 0

    def add(name: str, role: str, phase: str, priority: str, hours: int, deps: list[str]) -> str:
        nonlocal counter
        counter += 1
        key = f"T{counter:02d}"
        tasks.append({"task_key": key, "name": name, "role": role, "phase": phase, "priority": priority, "estimate_hours": hours, "dependencies": deps})
        return key

    req = add("需求分析与验收标准", "PM", "规划", "P0", 8, [])
    arch = add("技术方案与架构设计", "架构", "规划", "P0", 12, [req])
    data_api = add("数据模型与接口设计", "后端", "设计", "P0", 12, [arch])
    ui_flow = add("交互流程与页面规划", "前端", "设计", "P0", 10, [req])
    feature_tasks: list[str] = []
    for feature in profile.get("features", []):
        backend = add(f"{feature}后端服务", "后端", "开发", "P1", 16, [data_api])
        frontend = add(f"{feature}前端体验", "前端", "开发", "P1", 14, [ui_flow])
        feature_tasks.extend([backend, frontend])
    security = add("权限、安全与审计", "后端", "设计", "P0", 8, [data_api])
    qa = add("集成测试与验收测试", "QA", "测试", "P0", 16, feature_tasks)
    devops = add("部署、监控与发布", "DevOps", "发布", "P0", 8, [qa, security])
    add("需求验收与发布确认", "PM", "发布", "P0", 4, [devops])
    return tasks


def schedule_tasks(tasks: list[dict]) -> list[dict]:
    by_key = {task["task_key"]: task for task in tasks}
    for task in tasks:
        start = max((by_key[dep]["end_day"] for dep in task["dependencies"]), default=0)
        duration = max(1, math.ceil(task["estimate_hours"] / 8))
        task["start_day"] = start
        task["end_day"] = start + duration
    return tasks


def generate_workflow(spec_text: str) -> dict:
    spec_text = (spec_text or "").strip()
    if not spec_text:
        raise APIError(400, "请输入设计规格")
    if len(spec_text) > 6000:
        raise APIError(400, "设计规格不能超过 6000 个字符")
    rules = load_rules()
    profile = find_profile(spec_text, rules)
    tasks = schedule_tasks(build_tasks(profile))
    workflow_id = "wf-" + uuid.uuid4().hex[:8]
    task_count = len(tasks)
    total_hours = sum(task["estimate_hours"] for task in tasks)
    max_day = max(task["end_day"] for task in tasks)
    summary = f"PM Agent 识别为“{profile['product_name']}”，提取 {len(profile['features'])} 个核心功能域，生成 {task_count} 个开发任务，预计 {total_hours} 人时、{max_day:.0f} 个工作日。"
    execute("INSERT INTO workflows(id,title,product_name,spec_text,status,pm_model,summary,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (workflow_id, profile["title"], profile["product_name"], spec_text, "GENERATED", profile["pm_model"], summary, now_iso(), now_iso()))
    for index, task in enumerate(tasks, start=1):
        execute("INSERT INTO tasks(id,workflow_id,task_key,name,role,phase,priority,estimate_hours,dependencies_json,status,start_day,end_day,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (f"task-{workflow_id}-{index:02d}", workflow_id, task["task_key"], task["name"], task["role"], task["phase"], task["priority"], task["estimate_hours"], json.dumps(task["dependencies"], ensure_ascii=False), "PENDING", task["start_day"], task["end_day"], index))
    add_event(workflow_id, "PM_ANALYZED", f"PM Agent 完成需求分析：识别为“{profile['product_name']}”", payload={"features": profile["features"]})
    add_event(workflow_id, "TASKS_GENERATED", f"生成 {task_count} 个开发任务", payload={"task_count": task_count})
    add_event(workflow_id, "SCHEDULE_CREATED", f"生成 {max_day:.0f} 个工作日的执行编排", payload={"max_day": max_day})
    return get_workflow(workflow_id)


def task_to_dict(task: dict) -> dict:
    task = dict(task)
    task["dependencies"] = json.loads(task.pop("dependencies_json") or "[]")
    return task


def get_workflow(workflow_id: str) -> dict | None:
    workflow = fetch_one("SELECT * FROM workflows WHERE id=?", (workflow_id,))
    if not workflow:
        return None
    tasks = [task_to_dict(row) for row in fetch_all("SELECT * FROM tasks WHERE workflow_id=? ORDER BY position", (workflow_id,))]
    events = fetch_all("SELECT * FROM events WHERE workflow_id=? ORDER BY id", (workflow_id,))
    for event in events:
        try:
            event["payload"] = json.loads(event.get("payload") or "{}")
        except json.JSONDecodeError:
            event["payload"] = {}
    role_counts: dict[str, int] = {}
    for task in tasks:
        role_counts[task["role"]] = role_counts.get(task["role"], 0) + 1
    workflow["tasks"] = tasks
    workflow["events"] = events
    workflow["stats"] = {"task_count": len(tasks), "total_hours": sum(t["estimate_hours"] for t in tasks), "max_day": max((t["end_day"] for t in tasks), default=0), "role_counts": role_counts, "completed": len([t for t in tasks if t["status"] == "SUCCEEDED"])}
    return workflow


def list_workflows() -> list[dict]:
    rows = fetch_all("SELECT * FROM workflows ORDER BY created_at DESC LIMIT 20")
    for row in rows:
        tasks = fetch_all("SELECT status,estimate_hours,end_day FROM tasks WHERE workflow_id=?", (row["id"],))
        row["task_count"] = len(tasks)
        row["completed_count"] = len([t for t in tasks if t["status"] == "SUCCEEDED"])
        row["total_hours"] = sum(t["estimate_hours"] for t in tasks)
        row["max_day"] = max((t["end_day"] for t in tasks), default=0)
    return rows


def start_execution(workflow_id: str) -> dict:
    workflow = get_workflow(workflow_id)
    if not workflow:
        raise APIError(404, "工作流不存在")
    if workflow["status"] == "RUNNING":
        raise APIError(409, "工作流正在执行")
    execute("UPDATE tasks SET status='PENDING' WHERE workflow_id=?", (workflow_id,))
    execute("UPDATE workflows SET status='RUNNING', updated_at=? WHERE id=?", (now_iso(), workflow_id))
    add_event(workflow_id, "WORKFLOW_STARTED", "开始执行 PM Agent 生成的开发编排")
    with RUN_CONTEXT_LOCK:
        RUN_CONTEXTS[workflow_id] = {"cancel": threading.Event()}
    threading.Thread(target=simulate_execution, args=(workflow_id,), daemon=True).start()
    return get_workflow(workflow_id)


def cancel_execution(workflow_id: str) -> dict:
    workflow = get_workflow(workflow_id)
    if not workflow:
        raise APIError(404, "工作流不存在")
    with RUN_CONTEXT_LOCK:
        ctx = RUN_CONTEXTS.get(workflow_id)
        if ctx:
            ctx["cancel"].set()
    execute("UPDATE tasks SET status='CANCELLED' WHERE workflow_id=? AND status IN ('PENDING','RUNNING')", (workflow_id,))
    execute("UPDATE workflows SET status='CANCELLED', updated_at=? WHERE id=?", (now_iso(), workflow_id))
    add_event(workflow_id, "WORKFLOW_CANCELLED", "用户取消了本次编排执行", level="warning")
    return get_workflow(workflow_id)


def reset_workflow(workflow_id: str) -> dict:
    workflow = get_workflow(workflow_id)
    if not workflow:
        raise APIError(404, "工作流不存在")
    with RUN_CONTEXT_LOCK:
        ctx = RUN_CONTEXTS.get(workflow_id)
        if ctx:
            ctx["cancel"].set()
    time.sleep(0.1)
    execute("UPDATE tasks SET status='PENDING' WHERE workflow_id=?", (workflow_id,))
    execute("UPDATE workflows SET status='GENERATED', updated_at=? WHERE id=?", (now_iso(), workflow_id))
    execute("DELETE FROM events WHERE workflow_id=?", (workflow_id,))
    add_event(workflow_id, "WORKFLOW_RESET", "已恢复为未执行的初始编排")
    return get_workflow(workflow_id)


def simulate_execution(workflow_id: str) -> None:
    with RUN_CONTEXT_LOCK:
        ctx = RUN_CONTEXTS.get(workflow_id)
    if ctx is None:
        return
    cancel_event: threading.Event = ctx["cancel"]
    try:
        workflow = get_workflow(workflow_id)
        groups: dict[float, list[dict]] = {}
        for task in workflow["tasks"]:
            groups.setdefault(task["start_day"], []).append(task)
        for day in sorted(groups):
            if cancel_event.is_set():
                raise WorkflowCancelled()
            ids = [task["id"] for task in groups[day]]
            placeholders = ",".join("?" for _ in ids)
            execute(f"UPDATE tasks SET status='RUNNING' WHERE id IN ({placeholders})", tuple(ids))
            add_event(workflow_id, "TASKS_STARTED", f"开始执行第 {day:.0f} 天编排的 {len(ids)} 个并行任务")
            if cancel_event.wait(0.85):
                raise WorkflowCancelled()
            execute(f"UPDATE tasks SET status='SUCCEEDED' WHERE id IN ({placeholders})", tuple(ids))
            add_event(workflow_id, "TASKS_COMPLETED", f"完成 {len(ids)} 个任务")
        execute("UPDATE workflows SET status='COMPLETED', updated_at=? WHERE id=?", (now_iso(), workflow_id))
        add_event(workflow_id, "WORKFLOW_COMPLETED", "开发任务全部执行完成，工作流编排验证通过")
    except WorkflowCancelled:
        execute("UPDATE tasks SET status='CANCELLED' WHERE workflow_id=? AND status IN ('PENDING','RUNNING')", (workflow_id,))
        execute("UPDATE workflows SET status='CANCELLED', updated_at=? WHERE id=?", (now_iso(), workflow_id))
        add_event(workflow_id, "WORKFLOW_CANCELLED", "编排执行被取消", level="warning")
    except Exception as exc:
        execute("UPDATE workflows SET status='FAILED', updated_at=? WHERE id=?", (now_iso(), workflow_id))
        add_event(workflow_id, "WORKFLOW_FAILED", f"执行失败：{exc}", level="error")
    finally:
        with RUN_CONTEXT_LOCK:
            RUN_CONTEXTS.pop(workflow_id, None)


class Handler(BaseHTTPRequestHandler):
    server_version = "SEWorkflowPrototype/1.0"

    def send_json(self, payload, status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            raise APIError(400, "请求体不是有效 JSON")

    def handle_error(self, exc: Exception) -> None:
        if isinstance(exc, APIError):
            self.send_json({"error": exc.message}, exc.status)
        else:
            self.send_json({"error": f"服务器错误：{exc}"}, 500)

    def do_GET(self) -> None:
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/api/health":
                self.send_json({"ok": True}); return
            if path == "/api/workflows":
                self.send_json({"items": list_workflows()}); return
            m = re.fullmatch(r"/api/workflows/([^/]+)", path)
            if m:
                workflow = get_workflow(m.group(1))
                if not workflow:
                    raise APIError(404, "工作流不存在")
                self.send_json(workflow); return
            if path == "/api/rules":
                self.send_json(load_rules()); return
            self.serve_static(path)
        except Exception as exc:
            self.handle_error(exc)

    def do_POST(self) -> None:
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/api/workflows/generate":
                body = self.read_json()
                self.send_json(generate_workflow(body.get("spec_text", "")), 201); return
            m = re.fullmatch(r"/api/workflows/([^/]+)/run", path)
            if m:
                self.send_json(start_execution(m.group(1))); return
            m = re.fullmatch(r"/api/workflows/([^/]+)/cancel", path)
            if m:
                self.send_json(cancel_execution(m.group(1))); return
            m = re.fullmatch(r"/api/workflows/([^/]+)/reset", path)
            if m:
                self.send_json(reset_workflow(m.group(1))); return
            raise APIError(404, "接口不存在")
        except Exception as exc:
            self.handle_error(exc)

    def serve_static(self, path: str) -> None:
        if path in ("", "/"):
            file_path = STATIC_DIR / "index.html"
        else:
            file_path = (STATIC_DIR / path.lstrip("/")).resolve()
        root = STATIC_DIR.resolve()
        if root not in file_path.parents and file_path != root:
            raise APIError(404, "文件不存在")
        if not file_path.is_file():
            raise APIError(404, "文件不存在")
        content = file_path.read_bytes()
        mime, _ = mimetypes.guess_type(file_path.name)
        self.send_response(200)
        self.send_header("Content-Type", (mime or "application/octet-stream") + ("; charset=utf-8" if (mime or "").startswith("text/") else ""))
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, fmt: str, *args) -> None:
        print(f"[HTTP] {self.address_string()} - {fmt % args}")


def main() -> None:
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("SE Workflow prototype running: http://127.0.0.1:8000")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
