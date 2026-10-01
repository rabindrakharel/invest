"""Design layer shared by the session-trace tools: one 256-color palette for both ANSI (print
mode) and curses (interactive), plus panels, stacked bars, sparklines and JSON highlighting.
Standard library only."""
import re
import shutil
import signal
import sys
import textwrap
import unicodedata

signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # `tool | head` exits quietly

# xterm-256 palette indices
C = dict(violet=141, cyan=117, blue=75, green=114, yellow=221, orange=215, red=210, pink=218,
         teal=79, grey=247, dim=243, faint=238, white=255, black=16, sel=237, head=235, track=236)

SPARK = "▁▂▃▄▅▆▇█"
# region glyphs keep bars readable without color: read █ · write ▓ · new ▒ · track ░
GLYPH = {"green": "█", "yellow": "▓", "red": "▒", "track": "░"}
ANSI_RE = re.compile(r"\033\[[0-9;]*m")
JSON_TOK = re.compile(r'("(?:[^"\\]|\\.)*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b|([{}\[\],])')


class Ansi:
    """Callable that colors text: a("x", "green", bold=True)."""

    def __init__(self, enabled):
        self.on = enabled

    def __call__(self, s, fg=None, bg=None, bold=False, dim=False, italic=False):
        if not self.on or not s:
            return s
        codes = [c for c, f in (("1", bold), ("2", dim), ("3", italic)) if f]
        if fg:
            codes.append("38;5;%d" % C[fg])
        if bg:
            codes.append("48;5;%d" % C[bg])
        return "\033[%sm%s\033[0m" % (";".join(codes), s) if codes else s

    def spans(self, spans):
        return "".join(self(t, fg, bold=b) for t, fg, b in spans)


def width(s):
    s = ANSI_RE.sub("", s)
    return sum(0 if unicodedata.combining(ch) else 2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in s)


def trunc(s, w):
    """Truncate plain text to display width w with an ellipsis."""
    if width(s) <= w:
        return s
    out, n = "", 0
    for ch in s:
        cw = 2 if unicodedata.east_asian_width(ch) in "WF" else 1
        if n + cw > w - 1:
            break
        out += ch
        n += cw
    return out + "…"


def pad(s, w):
    return s + " " * max(0, w - width(s))


def term_width(default=120):
    if sys.stdout.isatty():
        return max(80, min(220, shutil.get_terminal_size((default, 40)).columns))
    return default


def human(n):
    n = float(n)
    for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
        if abs(n) >= div:
            v = n / div
            s = "%.2f" % v if v < 10 else "%.1f" % v if v < 100 else "%.0f" % v
            return (s.rstrip("0").rstrip(".") if "." in s else s) + suf
    return "%d" % n


def spark(values):
    if not values:
        return ""
    lo, hi = min(values), max(values)
    rng = (hi - lo) or 1
    return "".join(SPARK[int((v - lo) / rng * (len(SPARK) - 1))] for v in values)


def wrap(text, w):
    out = []
    for raw in (text or "").split("\n"):
        out.extend(textwrap.wrap(raw, max(10, w), replace_whitespace=False, drop_whitespace=False,
                                 break_on_hyphens=False) or [""])
    return out


def alloc(parts, cells):
    """Split `cells` among (value, color) parts proportionally (largest remainder, ≥1 cell when non-zero)."""
    total = sum(v for v, _ in parts) or 1
    raw = [v * cells / total for v, _ in parts]
    got = [int(r) for r in raw]
    for i, (v, _) in enumerate(parts):
        if v and not got[i] and sum(got) < cells:
            got[i] = 1
    order = sorted(range(len(parts)), key=lambda i: raw[i] - int(raw[i]), reverse=True)
    for i in order:
        if sum(got) >= cells:
            break
        if parts[i][0]:
            got[i] += 1
    while sum(got) > cells:
        j = max(range(len(got)), key=lambda i: got[i])
        got[j] -= 1
    return got


def bar_spans(parts, cells, filled=None, track="·"):
    """Stacked bar as spans. `filled` cells (≤ cells) carry the parts; the rest is a faint track."""
    filled = cells if filled is None else max(0, min(cells, filled))
    spans = []
    for part, n in zip(parts, alloc([(pt[0], pt[1]) for pt in parts], filled)):
        if n:
            spans.append(((part[2] if len(part) > 2 else GLYPH.get(part[1], "█")) * n, part[1], False))
    if cells - filled:
        spans.append((track * (cells - filled), "faint", False))
    return spans


def token_bar(tok, scale, cells=14):
    """Prompt bar: length ∝ prompt size / scale, colored cache_read | cache_write | uncached input."""
    total = tok["input"] + tok["cache_write"] + tok["cache_read"]
    filled = max(1, round(cells * total / scale)) if scale and total else 0
    spans = [("▕", "faint", False)]
    spans += bar_spans([(tok["cache_read"], "green"), (tok["cache_write"], "yellow"), (tok["input"], "red")], cells, filled)
    spans += [("▏", "faint", False), (" %6s" % human(total), "grey", False), (" → ", "faint", False),
              ("%-5s" % human(tok["output"]), "cyan", False)]
    return spans


def json_spans(line, base="grey"):
    spans, pos = [], 0
    for m in JSON_TOK.finditer(line):
        if m.start() > pos:
            spans.append((line[pos:m.start()], base, False))
        if m.group(1):
            if m.group(2):
                spans.append((m.group(1), "violet", False))
                spans.append((m.group(2), "faint", False))
            else:
                spans.append((m.group(1), "green", False))
        elif m.group(3):
            spans.append((m.group(3), "orange", False))
        elif m.group(4):
            spans.append((m.group(4), "pink", False))
        else:
            spans.append((m.group(5), "dim", False))
        pos = m.end()
    if pos < len(line):
        spans.append((line[pos:], base, False))
    return spans


def panel(a, title, lines, w, color="violet", right=""):
    """Rounded box. `lines` are pre-colored strings that fit in w-4 columns."""
    inner = w - 4
    t = " %s " % title
    r = (" %s " % right) if right else ""
    top = a("╭─", color) + a(t, color, bold=True) + a("─" * max(0, w - 3 - width(t) - width(r)), color) + a(r, "grey") + a("╮", color)
    out = [top]
    for ln in lines:
        if ln == "---":
            out.append(a("├" + "─" * (w - 2) + "┤", color))
        elif isinstance(ln, tuple) and ln[0] == "---":
            lab = " %s " % ln[1]
            out.append(a("├─", color) + a(lab, ln[2] if len(ln) > 2 else color, bold=True)
                       + a("─" * max(0, w - 3 - width(lab)) + "┤", color))
        else:
            out.append(a("│ ", color) + pad(ln, inner) + a(" │", color))
    out.append(a("╰" + "─" * (w - 2) + "╯", color))
    return out


def rule(a, title, w, color="violet", right=""):
    t = "━━ %s " % title
    r = (" %s" % right) if right else ""
    return a(t, color, bold=True) + a("━" * max(0, w - width(t) - width(r)), color) + a(r, "grey")


def chip(a, text, fg="black", bg="violet"):
    return a(" %s " % text, fg, bg=bg, bold=True)
