"""Build the SAAR idea-pitch deck (6 slides) in the Five_States / SIH visual language."""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

OUT = "/home/bhoomi/Desktop/whataspp summariser/SAAR_Idea_Presentation.pptx"

# ---------- palette (sampled from the reference deck) ----------
NAVY   = RGBColor(0x33, 0x36, 0x52)
BLUE   = RGBColor(0xE3, 0xF2, 0xFD)
CYAN   = RGBColor(0xE2, 0xF4, 0xF8)
PINK   = RGBColor(0xF4, 0xD7, 0xFF)
STEEL  = RGBColor(0x2E, 0x6C, 0x8B)
BARBLU = RGBColor(0x00, 0x70, 0xC0)
TXTBLU = RGBColor(0x1F, 0x49, 0x7D)
GRAY   = RGBColor(0x80, 0x80, 0x80)
LGRAY  = RGBColor(0xF2, 0xF2, 0xF2)
GREEN  = RGBColor(0x57, 0xC9, 0x9A)
DKGRN  = RGBColor(0x1E, 0x7A, 0x5A)
RED    = RGBColor(0xE6, 0x58, 0x53)
WHITE  = RGBColor(0xFF, 0xFF, 0xFF)
BLACK  = RGBColor(0x00, 0x00, 0x00)

SERIF, SANS = "Times New Roman", "Arial"
W, H = 13.333, 7.5
FOOT_Y, FOOT_H = 6.94, 0.56

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(W), Inches(H)
BLANK = prs.slide_layouts[6]


# ---------------------------------------------------------------- primitives
def _fmt(tf, lines, sz=9, bold=True, color=BLACK, align=PP_ALIGN.CENTER,
         font=SANS, anchor=MSO_ANCHOR.MIDDLE, space=0, line_sp=0.95,
         c=None, b=None, al=None, f=None, sp=None, ls=None, wrap=True):
    """lines: list of str, or dict(t=, sz=, b=, c=, al=, f=, sp=, ls=)."""
    if c is not None: color = c
    if b is not None: bold = b
    if al is not None: align = al
    if f is not None: font = f
    if sp is not None: space = sp
    if ls is not None: line_sp = ls
    tf.word_wrap = wrap
    tf.vertical_anchor = anchor
    for i, ln in enumerate(lines):
        d = {"t": ln} if isinstance(ln, str) else dict(ln)
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = d.get("al", align)
        p.space_after = Pt(d.get("sp", space))
        p.line_spacing = d.get("ls", line_sp)
        r = p.add_run()
        r.text = d["t"]
        r.font.size = Pt(d.get("sz", sz))
        r.font.bold = d.get("b", bold)
        r.font.name = d.get("f", font)
        r.font.color.rgb = d.get("c", color)
        if d.get("link"):
            # set the address first, then re-assert colour + underline so the
            # theme's default hyperlink style cannot override the deck palette
            r.hyperlink.address = d["link"]
            r.font.underline = True
            r.font.color.rgb = d.get("c", TXTBLU)
    return tf


def box(sl, x, y, w, h, fill=BLUE, lines=(), sz=9, rounded=True, radius=0.10,
        line=None, **kw):
    shp = sl.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE,
        Inches(x), Inches(y), Inches(w), Inches(h))
    if rounded:
        try:
            shp.adjustments[0] = radius
        except Exception:
            pass
    if fill is None:
        shp.fill.background()
    else:
        shp.fill.solid()
        shp.fill.fore_color.rgb = fill
    if line is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line
        shp.line.width = Pt(0.75)
    shp.shadow.inherit = False
    tf = shp.text_frame
    tf.margin_left = tf.margin_right = Inches(0.05)
    tf.margin_top = tf.margin_bottom = Inches(0.03)
    if lines:
        _fmt(tf, lines, sz=sz, **kw)
    return shp


def label(sl, x, y, w, h, lines, sz=9, **kw):
    tb = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tb.text_frame.margin_left = tb.text_frame.margin_right = Inches(0.02)
    tb.text_frame.margin_top = tb.text_frame.margin_bottom = 0
    _fmt(tb.text_frame, lines, sz=sz, **kw)
    return tb


def arrow(sl, x, y, w, h, shape=MSO_SHAPE.RIGHT_ARROW, color=NAVY):
    a = sl.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    a.fill.solid()
    a.fill.fore_color.rgb = color
    a.line.fill.background()
    a.shadow.inherit = False
    return a


def chevron(sl, x, y, w, h, lines, fill=BLUE, sz=10):
    s = sl.shapes.add_shape(MSO_SHAPE.CHEVRON, Inches(x), Inches(y),
                            Inches(w), Inches(h))
    s.fill.solid()
    s.fill.fore_color.rgb = fill
    s.line.fill.background()
    s.shadow.inherit = False
    s.text_frame.margin_left = Inches(0.14)
    s.text_frame.margin_right = Inches(0.06)
    _fmt(s.text_frame, lines, sz=sz)
    return s


def bullets(head, pts, head_sz=11.5, sz=8.7, numbered=True, head_c=BLACK):
    out = [{"t": head, "sz": head_sz, "sp": 5, "c": head_c}]
    for i, p in enumerate(pts):
        pre = f"{i+1}.  " if numbered else "•  "
        out.append({"t": pre + p, "sz": sz, "b": False, "al": PP_ALIGN.LEFT,
                    "sp": 4, "ls": 0.95})
    return out


# ---------------------------------------------------------------- chrome
def logo(sl):
    o = sl.shapes.add_shape(MSO_SHAPE.OVAL, Inches(0.20), Inches(0.10),
                            Inches(0.95), Inches(0.95))
    o.fill.solid()
    o.fill.fore_color.rgb = NAVY
    o.line.color.rgb = GREEN
    o.line.width = Pt(2)
    o.shadow.inherit = False
    o.text_frame.margin_left = o.text_frame.margin_right = 0
    _fmt(o.text_frame,
         [{"t": "SAAR", "sz": 13, "c": WHITE, "sp": 0},
          {"t": "सार", "sz": 8, "c": GREEN, "sp": 0},
          {"t": "GROUP DIGEST", "sz": 4.5, "c": WHITE}],
         line_sp=0.9, wrap=False)


def slide(title, page, sub=None):
    sl = prs.slides.add_slide(BLANK)
    logo(sl)
    lines = [{"t": title, "sz": 31, "f": SERIF, "sp": 0}]
    if sub:
        lines.append({"t": sub, "sz": 20, "f": SERIF})
    label(sl, 1.30, 0.08, 10.7, 0.92, lines)
    bar = box(sl, 0, FOOT_Y, W, FOOT_H, fill=BARBLU, rounded=False)
    _fmt(bar.text_frame,
         ["@Idea Submission   |   Theme: Social Innovation & Inclusive Development"],
         sz=11, c=WHITE, b=False)
    label(sl, 12.50, FOOT_Y + 0.13, 0.62, 0.30, [str(page)],
          sz=13, c=WHITE, al=PP_ALIGN.RIGHT)
    return sl


# ================================================================ SLIDE 1
s = slide("TITLE PAGE", 1)
label(s, 0.55, 1.18, 6.80, 3.65, [
    {"t": "•  Problem Statement ID  –  <fill in>", "sp": 20},
    {"t": "•  Problem Statement Title  –  SAAR: an inclusive, private AI digest "
          "for the community WhatsApp groups people actually live in", "sp": 20},
    {"t": "•  Theme  –  Social Innovation & Inclusive Development", "sp": 20},
    {"t": "•  PS Category  –  Software", "sp": 20},
    {"t": "•  Team ID  –  <fill in>", "sp": 20},
    {"t": "•  Team Name  –  <fill in>", "sp": 0},
], sz=13.5, al=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, ls=1.15)

box(s, 0.55, 5.00, 6.80, 1.05, fill=CYAN, line=STEEL,
    lines=[{"t": "WORKING PROTOTYPE ALREADY RUNNING", "sz": 10.5, "c": STEEL, "sp": 4},
           {"t": "Ingestion → local SQLite store → chunked map-reduce summariser → "
                 "digest in self-chat → dashboard → jump-to-message extension",
            "sz": 8.7, "b": False}])
label(s, 0.60, 6.25, 6.80, 0.35,
      [{"t": "▶  Demo video link          🔗  Detailed flowchart", "sz": 13,
        "c": TXTBLU, "al": PP_ALIGN.LEFT}])

box(s, 7.55, 1.15, 5.55, 0.52, fill=NAVY,
    lines=[{"t": "500 unread messages   →   5 lines you can act on",
            "sz": 12.5, "c": WHITE}])
box(s, 7.55, 1.82, 2.35, 2.55, fill=LGRAY, line=GRAY,
    lines=[{"t": "School Parents Group", "sz": 9, "c": NAVY, "sp": 4},
           {"t": "487 unread", "sz": 16, "c": RED, "sp": 5},
           {"t": "forwards · stickers · good-morning\nimages · 6 voice notes · "
                 "one fee deadline buried at message 213",
            "sz": 8, "b": False, "sp": 5},
           {"t": "Scrolling is a privilege of time.", "sz": 8.5, "c": TXTBLU}])
arrow(s, 10.00, 2.85, 0.44, 0.50)
box(s, 10.55, 1.82, 2.55, 2.55, fill=CYAN, line=STEEL,
    lines=[{"t": "TODAY'S DIGEST", "sz": 9.5, "c": STEEL, "sp": 5},
           {"t": "1.  Fee of ₹1,200 due Fri 5 pm. [12]", "sz": 8, "al": PP_ALIGN.LEFT, "sp": 4},
           {"t": "2.  Sports day moved to 14 Aug. [31]", "sz": 8, "al": PP_ALIGN.LEFT, "sp": 4},
           {"t": "3.  Bring Aadhaar copy Monday. [44]", "sz": 8, "al": PP_ALIGN.LEFT, "sp": 4},
           {"t": "⚠  Fake \"scholarship\" link — ignore. [58]", "sz": 8,
            "al": PP_ALIGN.LEFT, "c": RED, "sp": 6},
           {"t": "Also delivered as a 40-second voice\nnote in the user's own language.",
            "sz": 8, "b": False, "c": TXTBLU}])

box(s, 7.55, 4.52, 5.55, 0.78, fill=PINK,
    lines=[{"t": "Runs silently as a linked device — on the user's own phone or a ₹0 cloud box.",
            "sz": 9.5, "sp": 3},
           {"t": "No bot in the group  ·  no admin permission  ·  no new app to learn  ·  "
                 "data stays on the device", "sz": 8.7, "b": False}])
box(s, 7.55, 5.45, 5.55, 1.40, fill=BLUE,
    lines=[{"t": "WHY THIS IS SOCIAL INNOVATION", "sz": 10.5, "c": TXTBLU, "sp": 4},
           {"t": "WhatsApp is India's real notice-board — for schemes, school, crops "
                 "and health. Today its value goes to whoever has the time, literacy "
                 "and eyesight to scroll. SAAR removes that filter, without asking "
                 "anyone to change the app they already trust.",
            "sz": 9, "b": False, "ls": 1.0}])

# ================================================================ SLIDE 2
s = slide("SAAR", 2, sub="PROPOSED SOLUTION")
LX, LW = 0.22, 3.95
MX, MW = 4.32, 4.45
RX, RW = 8.92, 4.19

box(s, LX, 1.05, LW, 1.95, fill=CYAN,
    lines=[{"t": "What is SAAR?", "sz": 13.5, "sp": 3},
           {"t": "Where India's real notice-board meets AI", "sz": 9.5, "c": TXTBLU, "sp": 6},
           {"t": "A silent AI assistant that reads the WhatsApp groups a person "
                 "already belongs to, and hands back a short, cited, spoken digest "
                 "of what actually matters to them.", "sz": 9.2, "b": False, "sp": 5},
           {"t": "Built for the 500 mn Indians whose civic life runs on WhatsApp.",
            "sz": 9, "c": TXTBLU}])

box(s, LX, 3.10, LW, 3.75, fill=BLUE, anchor=MSO_ANCHOR.TOP,
    lines=[{"t": "How It Addresses the Problem", "sz": 12.5, "sp": 5},
           {"t": "Panchayat notices, scheme deadlines, school fees, crop advisories "
                 "and job leads all arrive in groups that push 300+ messages a day.",
            "sz": 9, "b": False, "sp": 6},
           {"t": "Catch-up digest", "sz": 10, "c": TXTBLU, "al": PP_ALIGN.LEFT, "sp": 1},
           {"t": "Summarises only what arrived since you last caught up.",
            "sz": 9, "b": False, "al": PP_ALIGN.LEFT, "sp": 5},
           {"t": "Spoken, not just written", "sz": 10, "c": TXTBLU, "al": PP_ALIGN.LEFT, "sp": 1},
           {"t": "Voice-note digests in 22 languages — literacy stops being the gate.",
            "sz": 9, "b": False, "al": PP_ALIGN.LEFT, "sp": 5},
           {"t": "Action, not just information", "sz": 10, "c": TXTBLU, "al": PP_ALIGN.LEFT, "sp": 1},
           {"t": "Dates, fees and documents become reminders you cannot miss.",
            "sz": 9, "b": False, "al": PP_ALIGN.LEFT, "sp": 5},
           {"t": "Only what concerns you", "sz": 10, "c": TXTBLU, "al": PP_ALIGN.LEFT, "sp": 1},
           {"t": "A priority filter pings you when your name, child, crop or scheme "
                 "comes up.", "sz": 9, "b": False, "al": PP_ALIGN.LEFT, "sp": 5},
           {"t": "Trust by citation", "sz": 10, "c": TXTBLU, "al": PP_ALIGN.LEFT, "sp": 1},
           {"t": "Every line links to the real message, so nothing is taken on faith.",
            "sz": 9, "b": False, "al": PP_ALIGN.LEFT}])

label(s, MX, 1.05, MW, 0.30, [{"t": "KEY FEATURES", "sz": 12.5}])
feats = [
    ("1", "Catch-up digest", "Only what you missed"),
    ("2", "Voice-note digest", "Text-to-speech, your dialect"),
    ("3", "22 Indian languages", "Reads Hinglish and code-mix"),
    ("4", "Voice notes read too", "Speech-to-text on group audio"),
    ("5", "Action extractor", "Dates, fees, documents"),
    ("6", "Scam & rumour shield", "Flags fraud links and forwards"),
    ("7", "Priority alerts", "Ping only if it concerns you"),
    ("8", "★ Save-to-vault", "Circulars kept after chat clears"),
    ("9", "Ask my groups", "\"When is the fee due?\""),
    ("10", "Cited digests", "Tap a line, see the message"),
    ("11", "Offline mode", "On-device model, zero cloud"),
    ("12", "Caregiver relay", "Digest for elders, one tap"),
]
cw, ch = (MW - 0.12) / 2, 0.50
for i, (n, t, d) in enumerate(feats):
    cx = MX + (i % 2) * (cw + 0.12)
    cy = 1.42 + (i // 2) * (ch + 0.11)
    box(s, cx, cy, cw, ch, fill=BLUE if i % 2 == 0 else PINK, radius=0.22,
        lines=[{"t": t, "sz": 9, "sp": 0, "ls": 0.85},
               {"t": d, "sz": 7.2, "b": False, "ls": 0.85}])
    o = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - 0.06), Inches(cy + 0.10),
                           Inches(0.32), Inches(0.32))
    o.fill.solid(); o.fill.fore_color.rgb = NAVY
    o.line.fill.background(); o.shadow.inherit = False
    o.text_frame.margin_left = o.text_frame.margin_right = 0
    _fmt(o.text_frame, [n], sz=8, c=WHITE, wrap=False)

box(s, MX, 5.10, MW, 1.75, fill=CYAN, line=STEEL, anchor=MSO_ANCHOR.TOP,
    lines=[{"t": "WHAT ALREADY WORKS TODAY", "sz": 10.5, "c": STEEL, "sp": 5},
           {"t": "Live + historical message ingestion from every group, into a local "
                 "encrypted SQLite store.", "sz": 8.7, "b": False, "al": PP_ALIGN.LEFT, "sp": 3},
           {"t": "Chunked map-reduce summariser with [n] citations mapped back to real "
                 "message ids.", "sz": 8.7, "b": False, "al": PP_ALIGN.LEFT, "sp": 3},
           {"t": "Commands typed in your own chat: /sum  /unread  /topics  /saved  "
                 "/schedule.", "sz": 8.7, "b": False, "al": PP_ALIGN.LEFT, "sp": 3},
           {"t": "★ save-to-vault, daily scheduler, PWA dashboard and jump-to-message "
                 "extension.", "sz": 8.7, "b": False, "al": PP_ALIGN.LEFT}])

box(s, RX, 1.05, RW, 3.55, fill=PINK, anchor=MSO_ANCHOR.TOP,
    lines=[{"t": "Innovation & Uniqueness", "sz": 12.5, "sp": 6},
           {"t": "Zero-onboarding by design", "sz": 10, "c": TXTBLU, "al": PP_ALIGN.LEFT, "sp": 1},
           {"t": "Lives inside WhatsApp's own \"Message Yourself\" chat. No download, "
                 "no sign-up, no new screen to learn — the reason it can reach people "
                 "an app never would.", "sz": 9, "b": False, "al": PP_ALIGN.LEFT, "sp": 6},
           {"t": "Invisible to the group", "sz": 10, "c": TXTBLU, "al": PP_ALIGN.LEFT, "sp": 1},
           {"t": "A linked device, not a bot. No admin rights, so no gatekeeper can "
                 "decide who gets to be included.", "sz": 9, "b": False,
            "al": PP_ALIGN.LEFT, "sp": 6},
           {"t": "Local-first and consent-first", "sz": 10, "c": TXTBLU, "al": PP_ALIGN.LEFT, "sp": 1},
           {"t": "Runs on the user's own device with an on-device model. Their chats "
                 "never become someone else's dataset.", "sz": 9, "b": False,
            "al": PP_ALIGN.LEFT, "sp": 6},
           {"t": "Cite-or-omit summarisation", "sz": 10, "c": TXTBLU, "al": PP_ALIGN.LEFT, "sp": 1},
           {"t": "Any claim the model cannot trace to a real message is dropped, "
                 "not printed.", "sz": 9, "b": False, "al": PP_ALIGN.LEFT}])

box(s, RX, 4.72, RW, 2.13, fill=CYAN, anchor=MSO_ANCHOR.TOP,
    lines=[{"t": "Who It Includes", "sz": 12.5, "sp": 6},
           {"t": "Parents in school groups who cannot scroll 400 messages a day",
            "sz": 9, "b": False, "al": PP_ALIGN.LEFT, "sp": 4},
           {"t": "Farmers and SHG women following advisory, mandi and loan groups",
            "sz": 9, "b": False, "al": PP_ALIGN.LEFT, "sp": 4},
           {"t": "Low-literacy and first-time smartphone users — the digest is spoken",
            "sz": 9, "b": False, "al": PP_ALIGN.LEFT, "sp": 4},
           {"t": "Blind and low-vision users — a screen-reader-first dashboard",
            "sz": 9, "b": False, "al": PP_ALIGN.LEFT, "sp": 4},
           {"t": "Elderly members — a family caregiver can relay their digest",
            "sz": 9, "b": False, "al": PP_ALIGN.LEFT, "sp": 4},
           {"t": "ASHA, anganwadi and panchayat workers juggling 20+ groups",
            "sz": 9, "b": False, "al": PP_ALIGN.LEFT}])

# ================================================================ SLIDE 3
s = slide("TECHNICAL APPROACH", 3)
NC, GAP, X0 = 7, 0.20, 0.22
CWD = (12.89 - GAP * (NC - 1)) / NC
CXS = [X0 + i * (CWD + GAP) for i in range(NC)]
SY, SH, SG = 1.34, 0.50, 0.11
SYS = [SY + i * (SH + SG) for i in range(7)]

heads = ["1 · CAPTURE", "2 · INGEST", "3 · MULTILINGUAL INTAKE",
         "4 · LOCAL STORE", "5 · SUMMARISE", "6 · AI LAYER", "7 · DELIVER & ACT"]
for i, hd in enumerate(heads):
    box(s, CXS[i], 1.02, CWD, 0.28, fill=NAVY, radius=0.30,
        lines=[{"t": hd, "sz": 8, "c": WHITE}])

COLS = [
    [(BLUE, "User's own WhatsApp\naccount, on their phone"),
     (BLUE, "One-time QR scan\n→ Linked Device"),
     (BLUE, "Baileys v7 socket\n(WhatsApp Web protocol)"),
     (BLUE, "Session keys stored\nlocally in auth/"),
     (PINK, "No bot joins the group.\nNo admin rights needed."),
     (PINK, "Never marks as read —\nphone alerts stay intact."),
     (PINK, "Runs on a phone, an old\nlaptop or a ₹0 cloud box")],
    [(BLUE, "Live messages\n(messages.upsert)"),
     (BLUE, "History sync of\nolder messages"),
     (BLUE, "Edits · deletes ·\nreactions tracked"),
     (BLUE, "★ reaction by user →\nmedia downloaded"),
     (BLUE, "Sender + group\nmetadata (JIDs)"),
     (PINK, "Only groups the user\nopts in, one by one."),
     (PINK, "Read-only ingest —\nzero messages sent out")],
    [(BLUE, "Text, type, sender\nand timestamp parsed"),
     (BLUE, "Voice note → text\n(Whisper / Bhashini ASR)"),
     (BLUE, "Image · PDF → OCR\n(circulars, forms)"),
     (BLUE, "Language detect:\n22 languages + Hinglish"),
     (BLUE, "Code-mix normalise\nand transliterate"),
     (BLUE, "Translate on demand\n(IndicTrans2 / NLLB)"),
     (BLUE, "Local glossary: scheme,\ncrop and exam terms")],
    [(NAVY, "SQLite on device\nWAL · encrypted at rest"),
     (BLUE, "messages · chats"),
     (BLUE, "catch-up markers ·\ntopic profiles"),
     (BLUE, "★ vault: docs and media\nkept after chat clears"),
     (BLUE, "vector index for\n\"Ask my groups\""),
     (PINK, "Nothing uploaded.\nNo member is profiled."),
     (PINK, "One tap erases a\ngroup's stored history")],
    [(BLUE, "Window: since last\ncatch-up, or a date range"),
     (BLUE, "Token-aware chunking"),
     (BLUE, "MAP: summarise\neach chunk"),
     (BLUE, "REDUCE: merge into\none digest"),
     (BLUE, "Extract actions, dates,\nfees, documents"),
     (BLUE, "Classify scam links\nand viral rumours"),
     (GREEN, "Cite each line as\n[n] → message id")],
    [(NAVY, "Model router"),
     (BLUE, "Offline: Ollama /\nGemma on the device"),
     (BLUE, "Online: Claude / GPT\nfor long context"),
     (BLUE, "Grounded prompt —\ncite or omit"),
     (BLUE, "Self-check pass drops\nuncited claims"),
     (BLUE, "Reading level tuned\nto the user"),
     (PINK, "Cost: about ₹1 per\ngroup per day")],
    [(BLUE, "Digest into the user's\nown Message-Yourself chat"),
     (BLUE, "Spoken digest (TTS)\nfor low-literacy users"),
     (BLUE, "Priority alert if name,\nchild, crop or scheme cited"),
     (BLUE, "Deadlines become\nreminders"),
     (BLUE, "Dashboard PWA —\nscreen-reader first"),
     (BLUE, "Tap a citation → jump\nto the real message"),
     (GREEN, "Daily or weekly digest,\non a schedule")],
]
for ci, items in enumerate(COLS):
    for si, (fill, txt) in enumerate(items):
        box(s, CXS[ci], SYS[si], CWD, SH, fill=fill, radius=0.20,
            lines=[{"t": txt, "sz": 7.5, "c": WHITE if fill is NAVY else BLACK,
                    "ls": 0.88}])

for i in range(NC - 1):                                  # stage-to-stage flow
    arrow(s, CXS[i] + CWD + 0.025, SYS[0] + 0.17, GAP - 0.05, 0.17)
for ci in (0, 4):                                        # sequential pipelines
    for si in range(len(COLS[ci]) - 1):
        arrow(s, CXS[ci] + CWD / 2 - 0.06, SYS[si] + SH + 0.005, 0.12, SG - 0.01,
              shape=MSO_SHAPE.DOWN_ARROW, color=DKGRN)

box(s, X0, 5.62, 12.89, 0.30, fill=PINK, radius=0.45,
    lines=[{"t": "FEEDBACK LOOP   ·   user rates a digest  →  catch-up marker advances, "
                 "topic profile and priority filters retrain  →  the next digest is "
                 "shorter, sharper and more personal", "sz": 8.5}])

stack = [
    ("Runtime", "Node.js 22 · TypeScript strict ESM"),
    ("WhatsApp", "Baileys v7 linked device · no Business-API fee"),
    ("Data", "better-sqlite3 (WAL) · local-first · encrypted"),
    ("AI", "Claude / GPT cloud · Ollama-Gemma offline · Whisper"),
    ("Bharat stack", "Bhashini ASR + TTS · IndicTrans2 · 22 languages"),
    ("Delivery", "PWA dashboard (node:http) · Chrome MV3 extension"),
]
tw = (12.89 - 0.12 * 5) / 6
for i, (t, d) in enumerate(stack):
    box(s, X0 + i * (tw + 0.12), 6.02, tw, 0.80, fill=STEEL, radius=0.16,
        lines=[{"t": t, "sz": 9, "c": WHITE, "sp": 1},
               {"t": d, "sz": 7.5, "b": False, "c": WHITE, "ls": 0.9}])

# ================================================================ SLIDE 4
s = slide("FEASIBILITY AND VIABILITY", 4)
fx, fw, fgap, fy, fh = 0.22, 3.03, 0.14, 1.05, 2.80
feas = [
    (PINK, "TECHNICAL FEASIBILITY", [
        "Working prototype already runs: ingestion, local store, chunked map-reduce "
        "summariser, self-chat commands, dashboard.",
        "Linked-device pairing is a one-time QR scan — no root, no custom ROM, no "
        "app install.",
        "Summariser is model-agnostic; a 4 GB on-device model is enough for daily digests.",
        "Speech and translation ride on proven stacks: Whisper, Bhashini, IndicTrans2.",
        "Runs on a ₹0 cloud tier, an old laptop or a Raspberry Pi.",
    ]),
    (BLUE, "OPERATIONAL FEASIBILITY", [
        "The interface is a chat the user already opens daily — training cost is near zero.",
        "One volunteer or ASHA worker can set up devices for a whole community in an "
        "afternoon.",
        "Works on 2G-grade connectivity: a digest is a few KB of text and a short "
        "audio clip.",
        "Degrades gracefully — if the model is unreachable, plain catch-up lists still arrive.",
        "Scales one group at a time; no institution has to adopt it first.",
    ]),
    (BLUE, "ECONOMIC FEASIBILITY", [
        "No WhatsApp Business API cost, no per-message fee, no server per user.",
        "Cloud model spend is about ₹1 per group per day; offline mode costs ₹0.",
        "Free forever for individuals; schools, NGOs and panchayats fund the hosted tier.",
        "One shared community box can serve a whole village or ward.",
        "Open-source core keeps the cost of inclusion off the user.",
    ]),
    (PINK, "LEGAL, ETHICAL & SOCIAL", [
        "Only the user's own account and own messages — no scraping of third parties.",
        "Consent-first: summarisation is opt-in per group, and members are never profiled.",
        "DPDP Act 2023 aligned by design: local storage, purpose limits, one-tap erase.",
        "No content is ever sent back into a group, so no one can be impersonated.",
        "Institutional deployments can migrate to the official WhatsApp Cloud API.",
    ]),
]
for i, (fill, title, pts) in enumerate(feas):
    box(s, fx + (i % 2) * (fw + fgap), fy + (i // 2) * (fh + 0.20), fw, fh,
        fill=fill, lines=bullets(title, pts), anchor=MSO_ANCHOR.TOP)

rx = fx + 2 * (fw + fgap)
rw = 13.11 - rx
label(s, rx, 1.05, rw, 0.30,
      [{"t": "CHALLENGES  →  HOW WE OVERCOME THEM", "sz": 12}])
risks = [
    ("Unofficial WhatsApp protocol may change or rate-limit",
     "Never send to groups, never mark read, human-like pacing. An adapter layer lets "
     "us swap to the official Cloud API without touching the app."),
    ("A summary could distort or invent a decision",
     "Cite-or-omit: uncited lines are dropped before delivery. Every digest links to "
     "the real message, and users rate each one."),
    ("Privacy of the other group members",
     "On-device processing, no member profiling, no export of anyone's text. In "
     "offline mode chats never leave the phone."),
    ("Code-mixed and dialect speech is hard to transcribe",
     "Bhashini and IndicTrans2 for Indian languages, plus a community-editable "
     "glossary of local scheme, crop and exam terms."),
    ("Low-end phones and patchy data",
     "Digests are a few KB plus a short audio clip; the heavy work runs on a shared "
     "community box or a free cloud tier."),
]
ry, rh = 1.42, 1.02
for i, (c, m) in enumerate(risks):
    yy = ry + i * (rh + 0.05)
    chevron(s, rx, yy, rw * 0.44, rh, [{"t": c, "sz": 8.7, "ls": 0.92}],
            fill=BLUE if i % 2 == 0 else PINK)
    box(s, rx + rw * 0.455, yy, rw * 0.545, rh, fill=LGRAY, line=GRAY, radius=0.12,
        lines=[{"t": m, "sz": 8.2, "b": False, "al": PP_ALIGN.LEFT, "ls": 0.93}])

# ================================================================ SLIDE 5
s = slide("IMPACT AND BENEFITS", 5)
hdrs = ["What the user actually gets", "SAAR", "Scrolling it yourself",
        "A group bot / assistant", "Built-in chat AI"]
tbl = [
    ["Effort to catch up on 400 messages", "One line to read or hear", "20–40 minutes",
     "Group must add the bot", "Manual, one chat at a time"],
    ["Works for a low-literacy user", "Yes — spoken digest", "No",
     "No — text only", "No — text only"],
    ["What the group members see", "Nothing at all", "—",
     "Bot is visible to all", "Varies"],
    ["Needs admin permission", "No", "No", "Yes", "No"],
    ["Data leaves the device", "Optional — offline mode", "No",
     "Yes, to the bot host", "Yes, to the vendor"],
    ["Every claim traceable to a message", "Yes, cited [n]", "You are the source",
     "Rarely", "Rarely"],
]
tx, tw2 = 0.22, 12.89
colw = [3.15] + [(tw2 - 3.15) / 4] * 4
ty, hh, rh2 = 1.05, 0.36, 0.35
for j, hd in enumerate(hdrs):
    box(s, tx + sum(colw[:j]), ty, colw[j] - 0.02, hh, fill=NAVY, rounded=False,
        lines=[{"t": hd, "sz": 9.5, "c": WHITE}])
for i, row in enumerate(tbl):
    yy = ty + hh + i * rh2
    for j, cell in enumerate(row):
        fill = PINK if j == 0 else (CYAN if j == 1 else (WHITE if i % 2 else LGRAY))
        box(s, tx + sum(colw[:j]), yy, colw[j] - 0.02, rh2 - 0.02, fill=fill,
            rounded=False, line=GRAY,
            lines=[{"t": cell, "sz": 8.5, "b": j <= 1,
                    "al": PP_ALIGN.LEFT if j == 0 else PP_ALIGN.CENTER,
                    "c": STEEL if j == 1 else BLACK}])

bands = [
    ("Social", [
        "A parent, farmer or SHG member stops missing the deadlines that decide "
        "money, school and health.",
        "Literacy and eyesight stop being the price of admission — the digest is "
        "spoken and screen-reader ready.",
        "Scam links and viral rumours are flagged before they reach first-time "
        "digital users.",
    ]),
    ("Economic", [
        "Missed fee, subsidy and scheme deadlines turn into money kept instead of "
        "money lost.",
        "Frontline workers reclaim close to an hour a day from scrolling 20 groups.",
        "Zero licence and zero per-message fee — one NGO box can cover a whole village.",
    ]),
    ("Environmental & Systemic", [
        "Small on-device models replace repeated cloud calls, cutting compute and "
        "energy per digest.",
        "Fewer \"kya hua?\" re-forwards means less network traffic and less storage churn.",
        "The ★ vault keeps one copy of a circular instead of it being re-shared fifty times.",
    ]),
]
bwd = (12.89 - 0.24) / 3
for i, (t, pts) in enumerate(bands):
    cx = 0.22 + i * (bwd + 0.12)
    box(s, cx, 3.64, bwd, 0.46, fill=NAVY, radius=0.16,
        lines=[{"t": t, "sz": 14.5, "c": WHITE}])
    for j, p in enumerate(pts):
        box(s, cx, 4.16 + j * 0.93, bwd, 0.83, fill=BLUE, radius=0.12,
            lines=[{"t": p, "sz": 8.7, "ls": 0.95}])

# ================================================================ SLIDE 6
s = slide("RESEARCH  AND REFERENCES", 6)
box(s, 0.22, 1.05, 12.89, 2.30, fill=CYAN, radius=0.05)
label(s, 0.42, 1.15, 12.49, 0.28,
      [{"t": "Evidence base and prior art  —  every title below is a live link",
        "sz": 11, "c": STEEL, "al": PP_ALIGN.LEFT}])
gw = (12.49 - 0.30) / 3
groups = [
    ("The problem, in data", [
        ("IAMAI–Kantar — Internet in India 2024", "https://www.iamai.in"),
        ("NFHS-5 2019–21, IIPS / MoHFW — India report",
         "https://dhsprogram.com/pubs/pdf/FR375/FR375.pdf"),
        ("Garimella & Tyson — WhatsApp group data, ICWSM 2018",
         "https://arxiv.org/abs/1804.01473"),
        ("Garimella & Eckles — WhatsApp misinformation, 2020",
         "https://arxiv.org/abs/2005.09784"),
        ("Reis et al. — limiting message forwarding, 2019",
         "https://arxiv.org/abs/1909.08740"),
    ]),
    ("Summarising real conversation", [
        ("Gliwa et al. — SAMSum dialogue corpus, 2019",
         "https://arxiv.org/abs/1911.12237"),
        ("Zhong et al. — DialogLM, long dialogue, AAAI 2022",
         "https://arxiv.org/abs/2109.02492"),
        ("Wu et al. — recursive map-reduce summarising, 2021",
         "https://arxiv.org/abs/2109.10862"),
        ("Feng et al. — dialogue summarisation survey, 2022",
         "https://arxiv.org/abs/2107.03175"),
        ("Lewis et al. — RAG, NeurIPS 2020 (Ask my groups)",
         "https://arxiv.org/abs/2005.11401"),
    ]),
    ("Speech, language and access", [
        ("Radford et al. — Whisper speech-to-text, ICML 2023",
         "https://arxiv.org/abs/2212.04356"),
        ("Gala et al. — IndicTrans2, all 22 languages, 2023",
         "https://arxiv.org/abs/2305.16307"),
        ("Zhang et al. — PEGASUS summarisation, ICML 2020",
         "https://arxiv.org/abs/1912.08777"),
        ("W3C — WCAG 2.2 accessibility guidelines",
         "https://www.w3.org/TR/WCAG22/"),
        ("MeitY — Digital Personal Data Protection Act 2023",
         "https://prsindia.org/billtrack/digital-personal-data-protection-bill-2023"),
    ]),
]
for i, (t, refs) in enumerate(groups):
    lines = [{"t": t, "sz": 10.5, "c": TXTBLU, "al": PP_ALIGN.LEFT, "sp": 6}]
    for txt, url in refs:
        lines.append({"t": "›  " + txt, "sz": 9, "b": False,
                      "al": PP_ALIGN.LEFT, "sp": 7, "link": url})
    label(s, 0.42 + i * (gw + 0.15), 1.55, gw, 1.70, lines, anchor=MSO_ANCHOR.TOP)

bottoms = [
    ("ADOPTION & SUSTAINABILITY", [
        "Free forever for individuals.",
        "Community box for schools, NGOs and panchayats: ₹499–₹4,999 a month.",
        "Open-source core — any state or NGO can self-host and audit it.",
    ]),
    ("VALIDATION PLAN", [
        "8-week pilot: 3 school, 2 SHG and 1 panchayat group.",
        "Measured: deadlines caught, minutes saved, trust rating.",
        "Tested with screen readers and with non-reading users.",
    ]),
    ("STANDARDS & COMPLIANCE", [
        "DPDP Act 2023 — consent, purpose limits, erasure.",
        "WCAG 2.2 AA dashboard; RPwD Act 2016.",
        "No outbound message to any group, ever.",
    ]),
]
bwd = (12.89 - 0.36) / 4
for i, (t, pts) in enumerate(bottoms):
    box(s, 0.22 + i * (bwd + 0.12), 3.55, bwd, 2.05, fill=PINK,
        lines=bullets(t, pts, head_sz=10.5, sz=9, numbered=False),
        anchor=MSO_ANCHOR.TOP)

# fourth card: the stack we build on, as direct links
tools = [
    ("Baileys — WhatsApp Web library", "https://github.com/WhiskeySockets/Baileys"),
    ("Ollama — on-device models", "https://ollama.com"),
    ("Bhashini — Indian-language APIs", "https://bhashini.gov.in"),
    ("WhatsApp Cloud API — migration path",
     "https://developers.facebook.com/docs/whatsapp"),
]
tlines = [{"t": "BUILT ON  (open links)", "sz": 10.5, "sp": 5}]
for txt, url in tools:
    tlines.append({"t": "•  " + txt, "sz": 9, "b": False, "al": PP_ALIGN.LEFT,
                   "sp": 6, "link": url})
box(s, 0.22 + 3 * (bwd + 0.12), 3.55, bwd, 2.05, fill=PINK, lines=tlines,
    anchor=MSO_ANCHOR.TOP)

box(s, 0.22, 5.82, 12.89, 0.85, fill=NAVY,
    lines=[{"t": "Every line of a SAAR digest is traceable to a real message.",
            "sz": 13, "c": WHITE, "sp": 3},
           {"t": "Inclusion without asking anyone to trust a black box — or to leave "
                 "the app they already use.", "sz": 10.5, "b": False, "c": WHITE}])

prs.save(OUT)
print("saved", OUT)
