from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/38-client-requirements-detailed-review.md'
OUTPUT = ROOT / 'output/pdf/timefit-client-requirements-detailed-review.pdf'

pdfmetrics.registerFont(TTFont('NotoSansGothic', '/System/Library/Fonts/Supplemental/NotoSansGothic-Regular.ttf'))
FONT = 'NotoSansGothic'

styles = getSampleStyleSheet()
title = ParagraphStyle('title', parent=styles['Title'], fontName=FONT, fontSize=23, leading=32, textColor=colors.HexColor('#191f28'), alignment=TA_CENTER, spaceAfter=14)
subtitle = ParagraphStyle('subtitle', parent=styles['Normal'], fontName=FONT, fontSize=10, leading=16, textColor=colors.HexColor('#6b7684'), alignment=TA_CENTER, spaceAfter=24)
h1 = ParagraphStyle('h1', parent=styles['Heading1'], fontName=FONT, fontSize=17, leading=25, textColor=colors.HexColor('#191f28'), spaceBefore=15, spaceAfter=10)
h2 = ParagraphStyle('h2', parent=styles['Heading2'], fontName=FONT, fontSize=13, leading=20, textColor=colors.HexColor('#1b64d1'), spaceBefore=12, spaceAfter=7)
body = ParagraphStyle('body', parent=styles['BodyText'], fontName=FONT, fontSize=9.5, leading=16, textColor=colors.HexColor('#333d4b'), spaceAfter=6)
bullet = ParagraphStyle('bullet', parent=body, leftIndent=14, firstLineIndent=-9, bulletIndent=0, spaceAfter=4)

def inline(text):
    text = re.sub(r'`([^`]+)`', r'<font color="#1265d8">\1</font>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', text)
    return text.replace('&', '&amp;').replace('&amp;lt;', '&lt;').replace('&amp;gt;', '&gt;')

def add_table(rows, story):
    cells = [[Paragraph(inline(cell.strip()), body) for cell in row] for row in rows]
    widths = [170 * mm / len(rows[0])] * len(rows[0])
    table = Table(cells, colWidths=widths, repeatRows=1, hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eaf3ff')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1b64d1')),
        ('FONTNAME', (0, 0), (-1, -1), FONT),
        ('GRID', (0, 0), (-1, -1), 0.35, colors.HexColor('#d9e2ec')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.extend([table, Spacer(1, 8)])

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#e5e8eb'))
    canvas.line(20*mm, 15*mm, 190*mm, 15*mm)
    canvas.setFont(FONT, 8)
    canvas.setFillColor(colors.HexColor('#8b95a1'))
    canvas.drawString(20*mm, 9*mm, 'TimeFit | 클라이언트 요구사항 상세 검토')
    canvas.drawRightString(190*mm, 9*mm, f'{doc.page}')
    canvas.restoreState()

def build():
    lines = SOURCE.read_text(encoding='utf-8').splitlines()
    story = []
    table_rows = []
    index = 0
    while index < len(lines):
        raw = lines[index].strip()
        if raw.startswith('|'):
            row = [part.strip() for part in raw.strip('|').split('|')]
            if not all(re.fullmatch(r'[-: ]+', cell) for cell in row):
                table_rows.append(row)
            index += 1
            continue
        if table_rows:
            add_table(table_rows, story)
            table_rows = []
        if not raw or raw == '---':
            story.append(Spacer(1, 6))
        elif raw.startswith('# '):
            story.extend([Paragraph(inline(raw[2:]), title), Paragraph('급여 · 세무 · 알림 · 스케줄 운영 확장안', subtitle)])
        elif raw.startswith('## '):
            story.append(Paragraph(inline(raw[3:]), h1))
        elif raw.startswith('### '):
            story.append(Paragraph(inline(raw[4:]), h2))
        elif raw.startswith('> '):
            story.append(Paragraph(inline(raw[2:]), body))
        elif re.match(r'^\d+\. ', raw):
            story.append(Paragraph(inline(raw), bullet, bulletText='•'))
        elif raw.startswith('- '):
            story.append(Paragraph(inline(raw[2:]), bullet, bulletText='•'))
        else:
            story.append(Paragraph(inline(raw), body))
        index += 1
    if table_rows:
        add_table(table_rows, story)
    doc = SimpleDocTemplate(str(OUTPUT), pagesize=A4, leftMargin=20*mm, rightMargin=20*mm, topMargin=20*mm, bottomMargin=22*mm, title='TimeFit 클라이언트 요구사항 상세 검토')
    doc.build(story, onFirstPage=footer, onLaterPages=footer)

if __name__ == '__main__':
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    build()
