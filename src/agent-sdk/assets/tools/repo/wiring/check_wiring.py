#!/usr/bin/env python3
"""Verify that every skill is wired to the one data layout and to each other.

    python3 src/agent-sdk/assets/tools/repo/wiring/check_wiring.py          # prints problems, exits 1 if any

Checks, over src/agent-sdk/assets/skills/**, src/agent-sdk/assets/tools/repo, CLAUDE.md, README.md and docs/:
  skills     every skill has SKILL.md whose name matches its folder and a "Report contract";
             CLAUDE.md's skills table lists exactly the skills on disk
  commands   every `python3 <script>` a document mentions exists, and every --flag used
             with it is defined by that script; every `pnpm q <name>` has sql/queries/<name>.sql;
             every `pnpm task:<x>` is a package.json script
  paths      every data/... path in a document sits in an area data/README.md defines;
             concrete example paths (no placeholders) exist on disk
  scripts    every script under assets/tools/repo/<area>/ never hard-codes a data path; it imports lib/paths.py
             (pure-computation modules and tests are exempt)
Run it after changing any skill, script, or the data layout.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

REPO = Path(__file__).resolve().parents[6]
SDK = REPO / "src" / "agent-sdk"
SKILLS = SDK / "assets" / "skills"
TOOLS = SDK / "assets" / "tools" / "repo"
DOCS = sorted(SKILLS.rglob("*.md")) + sorted(SKILLS.rglob("*.html")) + [REPO / "CLAUDE.md", REPO / "README.md", *sorted((REPO / "docs").glob("*.md"))]
PKG = json.loads((REPO / "package.json").read_text())["scripts"]
AREA = re.compile(r"^data/(README\.md$|corpus(/|$)|rendered(/|$)|market(/|$)|cache(/|$)|reports(/|$)|ledger(/|$)|runs(/|$)|"
                  r"probes/(corpus|runway|runs)(/|$)|probes/?$|research(/?$|/[^/]+/?$|/[^/]+/(macro|themes|sentiment|outlook|tickers)(/|$)|/[^/]+/\{[a-z,]+\}))")
# Layers the design names that stay empty until their stage runs (the price provider is not wired yet).
MAY_BE_ABSENT = {"data/corpus/prices"}
PLACEHOLDER = re.compile(r"[<>{}*|]|YYYY|\.\.\.")
# Modules that compute from inputs handed to them, and tests, need no paths import.
PURE = {"catalog.py", "forward_metrics.py"}

problems: list[str] = []


def rel(p: Path) -> str:
    return str(p.relative_to(REPO))


def check_skills() -> None:
    on_disk = sorted(d.name for d in SKILLS.iterdir() if d.is_dir())
    for name in on_disk:
        sk = SKILLS / name / "SKILL.md"
        if not sk.exists():
            problems.append(f"skills: {name} has no SKILL.md")
            continue
        s = sk.read_text()
        m = re.search(r"^name:\s*(\S+)", s, re.M)
        if not m or m.group(1) != name:
            problems.append(f"skills: {rel(sk)} frontmatter name != folder '{name}'")
        if "## Report contract" not in s:
            problems.append(f"skills: {rel(sk)} has no '## Report contract' section")
    table = set(re.findall(r"^\| `/([a-z-]+)` \|", (REPO / "CLAUDE.md").read_text(), re.M))
    for n in sorted(set(on_disk) - table):
        problems.append(f"skills: /{n} is on disk but missing from CLAUDE.md's skills table")
    for n in sorted(table - set(on_disk)):
        problems.append(f"skills: CLAUDE.md lists /{n}, which has no skill folder")


def commands_in(text: str) -> list[str]:
    """Shell commands, with backslash continuations joined."""
    text = re.sub(r"\\\n\s*", " ", text)
    return [ln for ln in text.splitlines() if "python3 " in ln or "pnpm " in ln]


def check_commands() -> None:
    for doc in DOCS:
        for line in commands_in(doc.read_text()):
            for m in re.finditer(r"python3 (src/agent-sdk/assets/[\w./-]+\.py)([^`\n|&;]*)", line):
                script = REPO / m.group(1)
                if not script.exists():
                    problems.append(f"commands: {rel(doc)} runs missing script {m.group(1)}")
                    continue
                src = script.read_text()
                for flag in re.findall(r"(?<![\w-])(--[a-z][\w-]*)", m.group(2)):
                    if f'"{flag}"' not in src and f"'{flag}'" not in src:
                        problems.append(f"commands: {rel(doc)} passes {flag} to {m.group(1)}, which does not define it")
            for m in re.finditer(r"pnpm (?:-s )?q ([a-z][\w-]*)", line):
                if not (REPO / "sql" / "queries" / f"{m.group(1)}.sql").exists():
                    problems.append(f"commands: {rel(doc)} runs pnpm q {m.group(1)}, but sql/queries/{m.group(1)}.sql is missing")
            for m in re.finditer(r"pnpm (?:-s )?(task:[\w-]+|rebuild|repl|test|typecheck|lint)\b", line):
                if m.group(1) not in PKG:
                    problems.append(f"commands: {rel(doc)} runs pnpm {m.group(1)}, which is not in package.json")


def check_paths() -> None:
    for doc in DOCS:
        for m in re.finditer(r"(?<![\w/.-])(data/[\w<>{}*|.,=/-]*)", doc.read_text()):
            path = m.group(1).rstrip(".,/") or "data"
            if path == "data":
                continue
            if not AREA.match(path) and not AREA.match(path + "/"):
                problems.append(f"paths: {rel(doc)} mentions {path}, outside the areas data/README.md defines")
            elif not PLACEHOLDER.search(path) and "=" not in path and path not in MAY_BE_ABSENT and not (REPO / path).exists():
                problems.append(f"paths: {rel(doc)} names {path}, which does not exist")


def check_scripts() -> None:
    files = sorted(TOOLS.glob("*/*.py"))
    for f in files:
        if f.name.startswith("test_") or f.name in ("paths.py", "check_wiring.py"):
            continue
        src = f.read_text()
        # Skip the module docstring: it documents paths, the code must not hard-code them.
        body = src.split('"""', 2)[-1] if '"""' in src[:400] else src
        for m in re.finditer(r"""["'](data/[^"']*|analysis_output[^"']*)["']""", body):
            problems.append(f"scripts: {rel(f)} hard-codes '{m.group(1)}'; resolve it through paths.py")
        if f.name not in PURE and "import paths" not in src and "from paths" not in src:
            needs = re.search(r"\b(open|read_text|write_text|glob|mkdir)\b", body)
            if needs:
                problems.append(f"scripts: {rel(f)} reads or writes files but does not import paths.py")


def main() -> None:
    check_skills()
    check_commands()
    check_paths()
    check_scripts()
    if problems:
        print(f"{len(problems)} wiring problem(s):")
        for p in problems:
            print("  - " + p)
        sys.exit(1)
    n = len([d for d in SKILLS.iterdir() if d.is_dir()])
    print(f"wiring ok: {n} skills, {len(DOCS)} documents, every command, flag, query and data path resolves")


if __name__ == "__main__":
    main()
