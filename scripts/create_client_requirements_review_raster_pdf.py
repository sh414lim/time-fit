from pathlib import Path
import re
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/38-client-requirements-detailed-review.md'
OUTPUT = ROOT / 'output/pdf/timefit-client-requirements-detailed-review.pdf'
FONT_PATH = '/System/Library/Fonts/Supplemental/AppleGothic.ttf'
W, H, MARGIN = 1654, 2339, 125
BODY = ImageFont.truetype(FONT_PATH, 27)
SMALL = ImageFont.truetype(FONT_PATH, 22)
H1 = ImageFont.truetype(FONT_PATH, 45)
H2 = ImageFont.truetype(FONT_PATH, 34)
TITLE = ImageFont.truetype(FONT_PATH, 58)

def clean(text):
    text = re.sub(r'\[([^]]+)\]\([^)]+\)', r'\1', text)
    return text.replace('**', '').replace('`', '').strip()

def wrapped(draw, text, font, width):
    words = text.split(' ')
    lines, current = [], ''
    for word in words:
        proposal = f'{current} {word}'.strip()
        if draw.textlength(proposal, font=font) <= width:
            current = proposal
        else:
            if current: lines.append(current)
            if draw.textlength(word, font=font) <= width:
                current = word
            else:
                segment = ''
                for ch in word:
                    if draw.textlength(segment + ch, font=font) > width:
                        lines.append(segment); segment = ch
                    else: segment += ch
                current = segment
    if current: lines.append(current)
    return lines or ['']

def build():
    pages, image = [], Image.new('RGB', (W, H), 'white')
    draw, y, page_number = ImageDraw.Draw(image), MARGIN, 1
    def finish():
        nonlocal image, draw, y, page_number
        draw.line((MARGIN, H-105, W-MARGIN, H-105), fill='#dfe6ee', width=2)
        draw.text((MARGIN, H-78), 'TimeFit | 클라이언트 요구사항 상세 검토', font=SMALL, fill='#7b8794')
        draw.text((W-MARGIN-35, H-78), str(page_number), font=SMALL, fill='#7b8794')
        pages.append(image)
        image = Image.new('RGB', (W, H), 'white'); draw = ImageDraw.Draw(image); y = MARGIN; page_number += 1
    def ensure(height):
        nonlocal y
        if y + height > H - 145: finish()
    def paragraph(text, font=BODY, color='#333d4b', prefix=''):
        nonlocal y
        lines = wrapped(draw, prefix + clean(text), font, W - 2*MARGIN)
        line_height = int(font.size * 1.58)
        ensure(line_height * len(lines) + 12)
        for line in lines:
            draw.text((MARGIN, y), line, font=font, fill=color); y += line_height
        y += 9

    for raw in SOURCE.read_text(encoding='utf-8').splitlines():
        text = raw.strip()
        if not text or text == '---':
            y += 8; continue
        if text.startswith('|'):
            if re.fullmatch(r'[| :\-]+', text): continue
            paragraph(' | '.join(clean(cell) for cell in text.strip('|').split('|')), SMALL, '#526174', '• ')
        elif text.startswith('# '):
            ensure(180); draw.text((MARGIN, y), clean(text[2:]), font=TITLE, fill='#191f28'); y += 88
            draw.text((MARGIN, y), '급여 · 세무 · 알림 · 스케줄 운영 확장안', font=SMALL, fill='#6b7684'); y += 70
        elif text.startswith('## '):
            ensure(80); draw.text((MARGIN, y), clean(text[3:]), font=H1, fill='#191f28'); y += 70
        elif text.startswith('### '):
            ensure(60); draw.text((MARGIN, y), clean(text[4:]), font=H2, fill='#1b64d1'); y += 55
        elif text.startswith('> '): paragraph(text[2:], BODY, '#526174')
        elif re.match(r'^\d+\. ', text): paragraph(text, BODY, '#333d4b')
        elif text.startswith('- '): paragraph(text[2:], BODY, '#333d4b', '• ')
        else: paragraph(text)
    finish()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(OUTPUT, save_all=True, append_images=pages[1:], resolution=144.0)

if __name__ == '__main__': build()
