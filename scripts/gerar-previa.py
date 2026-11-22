# Gera a imagem de prévia do link (1200x630) do Tela ao Vivo
# Uso: python3 scripts/gerar-previa.py web/previa.png   (precisa do Pillow e da fonte Inter)
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
L, A = 1200, 630
img = Image.new('RGB', (L, A), '#0f1115')
d = ImageDraw.Draw(img)
fonte = '/usr/share/fonts/opentype/inter/'
titulo = ImageFont.truetype(fonte + 'Inter-Bold.otf', 96)
sub = ImageFont.truetype(fonte + 'Inter-Regular.otf', 40)
selo = ImageFont.truetype(fonte + 'Inter-Medium.otf', 28)

# "Telas" decorativas à direita (grade 2x2), como numa sala
cores = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b']
x0, y0, w, h, g = 760, 150, 180, 112, 20
for i, c in enumerate(cores):
    x = x0 + (i % 2) * (w + g); y = y0 + (i // 2) * (h + g + 30)
    d.rounded_rectangle([x, y, x + w, y + h], 14, fill='#181b22', outline='#2c313c', width=2)
    d.rounded_rectangle([x + 10, y + 10, x + w - 10, y + h - 10], 8, fill=c)
    d.rounded_rectangle([x, y + h + 6, x + w, y + h + 26], 6, fill='#20242d')

# Bolinha "ao vivo" com brilho
brilho = Image.new('RGBA', (L, A), (0, 0, 0, 0))
ImageDraw.Draw(brilho).ellipse([60, 168, 140, 248], fill=(239, 68, 68, 140))
img.paste(brilho.filter(ImageFilter.GaussianBlur(18)), (0, 0), brilho.filter(ImageFilter.GaussianBlur(18)))
d = ImageDraw.Draw(img)
d.ellipse([80, 188, 120, 228], fill='#ef4444')

d.text((140, 155), 'Tela ao Vivo', font=titulo, fill='#e8eaef')
d.text((84, 290), 'Assista e compartilhe telas', font=sub, fill='#c4c9d4')
d.text((84, 342), 'ao vivo com até 8 pessoas', font=sub, fill='#c4c9d4')

x = 84
for t in ['Grátis', 'Sem instalar', 'Nada é gravado']:
    lw = d.textlength(t, font=selo) + 40
    d.rounded_rectangle([x, 450, x + lw, 500], 25, fill='#181b22', outline='#2c313c', width=2)
    d.text((x + 20, 459), t, font=selo, fill='#9aa1ad')
    x += lw + 14
img.save(sys.argv[1], optimize=True)
