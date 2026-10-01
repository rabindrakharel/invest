"""Interactive tree engine for the session-trace tools (curses, 256 colors, mouse) and the matching
ANSI print renderer. Nodes reveal children / exact content only when unfolded."""
import curses

from ui import C, Ansi, json_spans, trunc, width, wrap

# kind → (icon, color, bold)
KIND = {
    "session": ("◆", "violet", True), "agent": ("◎", "pink", True), "user": ("●", "green", True),
    "notify": ("⚑", "yellow", True), "system": ("⚠", "orange", False), "api": ("◇", "cyan", False),
    "text": ("¶", "white", False), "thinking": ("∴", "dim", False), "tool": ("▶", "blue", True),
    "result": ("◀", "teal", False), "call": ("◇", "cyan", True), "req": ("⇡", "blue", True),
    "resp": ("⇣", "green", True), "field": ("•", "cyan", False), "new": ("✚", "yellow", True),
    "umsg": ("●", "yellow", False), "amsg": ("●", "green", False), "block": ("▪", "grey", False),
    "json": ("❴", "white", True), "note": ("!", "orange", False), "info": ("·", "dim", False),
}


class TNode:
    """label: text (searchable) · spans: optional rich label · right: spans drawn right-aligned
    body: str/callable shown inline when unfolded · detail: str/callable shown in the inspector
    loader: builds children lazily on first unfold."""

    def __init__(self, label, kind="info", body=None, children=None, loader=None, detail=None,
                 right=None, spans=None, json=False, expanded=False):
        self.label, self.kind, self.right, self.spans, self.json = label, kind, right, spans, json
        self._body, self._detail, self._children, self.loader = body, detail, children, loader
        self.expanded = expanded
        self.parent = None
        self._wrap = None
        for ch in children or []:
            ch.parent = self

    def expandable(self):
        return bool(self._body) or bool(self._children) or self.loader is not None

    def children(self):
        if self._children is None:
            self._children = self.loader() if self.loader else []
            for ch in self._children:
                ch.parent = self
        return self._children

    def body(self):
        if callable(self._body):
            self._body = self._body()
        return self._body or ""

    def detail(self):
        if callable(self._detail):
            self._detail = self._detail()
        return self._detail or self.body() or self.label

    def wrapped(self, w):
        if not self._wrap or self._wrap[0] != w:
            self._wrap = (w, wrap(self.body(), w))
        return self._wrap[1]

    def path(self):
        out, n = [], self
        while n:
            out.append(n)
            n = n.parent
        return out[::-1]


def build_rows(roots, w):
    """Flatten visible tree into rows (node, guide, body_line_or_None)."""
    rows = []

    def walk(n, prefix, last, top):
        rows.append((n, "" if top else prefix + ("└─" if last else "├─"), None))
        cp = "" if top else prefix + ("  " if last else "│ ")
        if n.expanded:
            kids = n.children()
            if n.body():
                bp = cp + ("│ " if kids else "  ") + "┆ "
                for ln in n.wrapped(max(20, w - width(bp) - 2)):
                    rows.append((n, bp, ln))
            for i, ch in enumerate(kids):
                walk(ch, cp, i == len(kids) - 1, False)

    for r in roots:
        walk(r, "", True, True)
    return rows


def row_spans(n, guide, line, avail):
    """(left spans, right spans) for one row, label truncated to fit `avail` columns."""
    if line is not None:
        return [(guide, "faint", False)] + (json_spans(line) if n.json else [(line, "grey", False)]), []
    icon, color, bold = KIND.get(n.kind, KIND["info"])
    mark = ("▾ " if n.expanded else "▸ ") if n.expandable() else "  "
    head = [(guide, "faint", False), (mark, "dim" if not n.expandable() else color, False), (icon + " ", color, bold)]
    right = n.right or []
    rw = sum(width(t) for t, _, _ in right)
    room = avail - sum(width(t) for t, _, _ in head) - (rw + 2 if right else 0)
    if room < 12 and right:
        right, room = [], avail - sum(width(t) for t, _, _ in head)
    label = n.spans or [(n.label, color, bold)]
    out, used = [], 0
    for t, c, b in label:
        if used >= room:
            break
        t = trunc(t, room - used) if width(t) > room - used else t
        out.append((t, c, b))
        used += width(t)
    return head + out, right


# ---------------------------------------------------------------- ANSI print mode

def print_tree(roots, w, color=True, expand_depth=None):
    """Print the tree with the same look as the TUI. expand_depth: unfold that many levels first."""
    a = Ansi(color)
    if expand_depth is not None:
        def ex(n, d):
            n.expanded = d < expand_depth and n.expandable() and not n._body
            if n.expanded:
                for ch in n.children():
                    ex(ch, d + 1)
        for r in roots:
            ex(r, 0)
    for n, guide, line in build_rows(roots, w):
        left, right = row_spans(n, guide, line, w)
        s = a.spans(left)
        if right:
            s += " " * max(1, w - width(s) - sum(width(t) for t, _, _ in right)) + a.spans(right)
        print(s)


# ---------------------------------------------------------------- curses viewer

HELP = [
    ("↑ ↓  j k  wheel", "move"), ("PgUp PgDn  g G", "page / top / bottom"),
    ("> → l Enter  dbl-click", "unfold — reveal children / exact content"),
    ("< ← h", "fold; on a folded line jump to parent"), ("x", "fold everything"),
    ("i", "toggle inspector pane"), ("J K", "scroll inspector"), ("d", "full-screen detail of selection"),
    ("/  n  N", "search unfolded lines"), ("r", "reload (session still running)"), ("q", "quit / close"),
]


class Painter:
    def __init__(self, scr):
        self.scr = scr
        self.pairs = {}
        self.rich = curses.COLORS >= 256
        basic = dict(violet=curses.COLOR_MAGENTA, pink=curses.COLOR_MAGENTA, cyan=curses.COLOR_CYAN,
                     blue=curses.COLOR_BLUE, green=curses.COLOR_GREEN, teal=curses.COLOR_CYAN,
                     yellow=curses.COLOR_YELLOW, orange=curses.COLOR_YELLOW, red=curses.COLOR_RED,
                     white=curses.COLOR_WHITE, grey=curses.COLOR_WHITE, dim=curses.COLOR_WHITE,
                     faint=curses.COLOR_WHITE, black=curses.COLOR_BLACK, sel=curses.COLOR_BLUE,
                     head=curses.COLOR_BLACK, track=curses.COLOR_BLACK)
        self.col = (lambda n: C[n]) if self.rich else (lambda n: basic[n])

    def attr(self, fg, bg=None, bold=False):
        key = (fg, bg)
        if key not in self.pairs:
            n = len(self.pairs) + 1
            curses.init_pair(n, self.col(fg) if fg else -1, self.col(bg) if bg else -1)
            self.pairs[key] = curses.color_pair(n)
        a = self.pairs[key]
        if bold:
            a |= curses.A_BOLD
        if not self.rich and fg in ("dim", "faint"):
            a |= curses.A_DIM
        return a

    def put(self, y, x, text, fg="white", bg=None, bold=False, maxx=None):
        h, w = self.scr.getmaxyx()
        maxx = min(maxx or w, w)
        if y < 0 or y >= h or x >= maxx:
            return x
        text = trunc(text, maxx - x) if width(text) > maxx - x else text
        try:
            self.scr.addstr(y, x, text, self.attr(fg, bg, bold))
        except curses.error:
            pass
        return x + width(text)

    def spans(self, y, x, spans, bg=None, maxx=None):
        for t, fg, b in spans:
            x = self.put(y, x, t, fg, bg, b, maxx)
        return x

    def fill(self, y, x0, x1, bg):
        self.put(y, x0, " " * max(0, x1 - x0), "white", bg, maxx=x1)


def run(title, roots, chips=None, inspector=False, reload=None):
    """chips(): list of (text, fg) shown in the header. reload(): returns new roots."""
    state = {"roots": roots}

    def main(scr):
        curses.curs_set(0)
        curses.use_default_colors()
        curses.mousemask(curses.ALL_MOUSE_EVENTS | curses.REPORT_MOUSE_POSITION)
        curses.mouseinterval(200)
        p = Painter(scr)
        cur, top, itop, query = 0, 0, 0, ""
        show_insp = inspector
        status = ""
        wheel_dn = getattr(curses, "BUTTON5_PRESSED", 0x200000)

        while True:
            h, w = scr.getmaxyx()
            split = show_insp and w >= 100
            lw = int(w * 0.56) if split else w
            rows = build_rows(state["roots"], lw)
            cur = max(0, min(cur, len(rows) - 1))
            bh = h - 3
            top = cur if cur < top else (cur - bh + 1 if cur >= top + bh else top)
            scr.erase()

            # header: title chip + stat chips
            p.fill(0, 0, w, "head")
            x = p.put(0, 0, " ◆ %s " % title, "black", "violet", True)
            for text, fg in (chips() if chips else []):
                x = p.put(0, x + 1, " %s " % text, fg, "track", True)
            # breadcrumb
            sel = rows[cur][0] if rows else None
            crumbs = [trunc(n.label, 28) for n in (sel.path() if sel else [])]
            p.put(1, 0, " " + "  ›  ".join(crumbs), "dim", maxx=w)

            # tree pane
            for i, (n, guide, line) in enumerate(rows[top: top + bh]):
                y = i + 2
                bg = "sel" if top + i == cur else None
                if bg:
                    p.fill(y, 0, lw, bg)
                left, right = row_spans(n, guide, line, lw - 1)
                p.spans(y, 0, left, bg, maxx=lw)
                if right:
                    rw = sum(width(t) for t, _, _ in right)
                    p.spans(y, lw - rw - 1, right, bg, maxx=lw)

            # inspector pane
            if split and sel:
                for y in range(2, h - 1):
                    p.put(y, lw, "│", "faint")
                icon, color, _ = KIND.get(sel.kind, KIND["info"])
                p.put(2, lw + 2, "%s %s" % (icon, trunc(sel.label, w - lw - 5)), color, bold=True)
                body = wrap(sel.detail(), w - lw - 4)
                itop = max(0, min(itop, len(body) - 1))
                is_json = sel.json or sel.detail().lstrip().startswith(("{", "["))
                for j, ln in enumerate(body[itop: itop + h - 5]):
                    p.spans(j + 3, lw + 2, json_spans(ln) if is_json else [(ln, "grey", False)], maxx=w)
                if len(body) > h - 5:
                    p.put(h - 2, w - 18, " %d-%d/%d " % (itop + 1, min(itop + h - 5, len(body)), len(body)), "dim")

            # footer
            p.fill(h - 1, 0, w, "head")
            x = 0
            for k, d in ((">", "unfold"), ("<", "fold"), ("i", "inspector"), ("d", "detail"), ("/", "search"), ("?", "help"), ("q", "quit")):
                x = p.put(h - 1, x + 1, " %s " % k, "black", "cyan", True)
                x = p.put(h - 1, x, " %s" % d, "grey", "head")
            msg = status or "%d/%d" % (cur + 1, len(rows))
            p.put(h - 1, max(x + 2, w - width(msg) - 2), msg, "yellow" if status else "dim", "head")
            scr.refresh()

            k = scr.getch()
            n, guide, line = rows[cur] if rows else (None, "", None)
            status = ""
            if k == curses.KEY_MOUSE:
                try:
                    _, mx, my, _, bs = curses.getmouse()
                except curses.error:
                    continue
                if bs & curses.BUTTON4_PRESSED:
                    if split and mx > lw:
                        itop -= 3
                    else:
                        cur -= 3
                elif bs & wheel_dn:
                    if split and mx > lw:
                        itop += 3
                    else:
                        cur += 3
                elif 2 <= my < 2 + bh and mx < lw and top + my - 2 < len(rows):
                    cur, itop = top + my - 2, 0
                    n, guide, line = rows[cur]
                    on_marker = line is None and width(guide) <= mx <= width(guide) + 1
                    if line is None and n.expandable() and (on_marker or bs & curses.BUTTON1_DOUBLE_CLICKED):
                        n.expanded = not n.expanded
                continue
            if k == ord("q"):
                return
            elif k in (curses.KEY_DOWN, ord("j")):
                cur, itop = cur + 1, 0
            elif k in (curses.KEY_UP, ord("k")):
                cur, itop = cur - 1, 0
            elif k == curses.KEY_NPAGE:
                cur += bh
            elif k == curses.KEY_PPAGE:
                cur -= bh
            elif k == ord("g"):
                cur = 0
            elif k == ord("G"):
                cur = len(rows) - 1
            elif k == ord("J"):
                itop += 3
            elif k == ord("K"):
                itop -= 3
            elif k in (ord(">"), curses.KEY_RIGHT, ord("l"), 10, 13, curses.KEY_ENTER):
                if n and line is None and n.expandable():
                    n.expanded = True
            elif k in (ord("<"), curses.KEY_LEFT, ord("h")):
                target = n if (line is not None or n.expanded) else n.parent
                if target is not None:
                    target.expanded = False
                    cur = next(i for i, r in enumerate(build_rows(state["roots"], lw)) if r[0] is target and r[2] is None)
            elif k == ord("x"):
                stack = list(state["roots"])
                while stack:
                    m = stack.pop()
                    m.expanded = False
                    stack.extend(m._children or [])
                for r in state["roots"]:
                    r.expanded = True
                cur = 0
            elif k == ord("i"):
                show_insp = not show_insp
            elif k == ord("d") and n:
                pager(p, n)
            elif k == ord("?"):
                help_screen(p)
            elif k == ord("r") and reload:
                state["roots"] = reload()
                status = "reloaded"
            elif k == ord("/"):
                curses.echo()
                curses.curs_set(1)
                p.fill(h - 1, 0, w, "head")
                p.put(h - 1, 0, " search: ", "black", "yellow", True)
                query = scr.getstr(h - 1, 10, 200).decode("utf-8", "replace").strip().lower()
                curses.noecho()
                curses.curs_set(0)
                k = ord("n")
            if k in (ord("n"), ord("N")) and query:
                hits = [i for i, (m, _, ln) in enumerate(rows) if query in (ln if ln is not None else m.label).lower()]
                if not hits:
                    status = "no match among unfolded lines: %s" % query
                    continue
                cur = next((i for i in hits if i > cur), hits[0]) if k == ord("n") else \
                    next((i for i in reversed(hits) if i < cur), hits[-1])
                status = "match %d/%d · %s" % (hits.index(cur) + 1, len(hits), query)

    curses.wrapper(main)


def pager(p, node):
    scr = p.scr
    top = 0
    is_json = node.json or node.detail().lstrip().startswith(("{", "["))
    while True:
        h, w = scr.getmaxyx()
        lines = wrap(node.detail(), w - 4)
        top = max(0, min(top, max(0, len(lines) - (h - 2))))
        scr.erase()
        icon, color, _ = KIND.get(node.kind, KIND["info"])
        p.fill(0, 0, w, "head")
        p.put(0, 0, " %s %s " % (icon, trunc(node.label, w - 4)), "black", color, True)
        for i, ln in enumerate(lines[top: top + h - 2]):
            p.spans(i + 1, 2, json_spans(ln) if is_json else [(ln, "grey", False)])
        p.fill(h - 1, 0, w, "head")
        p.put(h - 1, 1, "%d-%d/%d   ↑↓ PgUp PgDn g G · q back" % (top + 1, min(top + h - 2, len(lines)), len(lines)), "dim", "head")
        scr.refresh()
        k = scr.getch()
        if k in (ord("q"), 27, curses.KEY_LEFT, ord("<"), ord("d")):
            return
        top += {curses.KEY_DOWN: 1, ord("j"): 1, curses.KEY_UP: -1, ord("k"): -1,
                curses.KEY_NPAGE: h - 2, ord(" "): h - 2, curses.KEY_PPAGE: -(h - 2)}.get(k, 0)
        if k == ord("g"):
            top = 0
        elif k == ord("G"):
            top = len(lines)


def help_screen(p):
    scr = p.scr
    scr.erase()
    p.put(1, 2, " ◆ keys & mouse ", "black", "violet", True)
    for i, (k, d) in enumerate(HELP):
        p.put(3 + i, 4, "%-24s" % k, "cyan", bold=True)
        p.put(3 + i, 30, d, "grey")
    p.put(5 + len(HELP), 4, "mouse: click selects · click ▸/▾ or double-click toggles · wheel scrolls (inspector too)", "dim")
    p.put(6 + len(HELP), 4, "tip: hold Shift while dragging to select text in most terminals", "dim")
    p.put(8 + len(HELP), 4, "press any key", "yellow")
    scr.refresh()
    scr.getch()
