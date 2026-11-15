"""Made-up PDFs (generic sales data) in three layouts, like system exports."""
import os
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from reportlab.pdfgen import canvas
import sys
os.chdir(sys.argv[1] if len(sys.argv) > 1 else '.')
os.makedirs('monthly', exist_ok=True)
ST = getSampleStyleSheet()
def footer(c, doc): c.setFont('Helvetica', 8); c.drawString(500, 20, f"Page {doc.page} of 2")
# A) ruled tables, one region per page, header repeated, month in the file name, total row at the end
def ruled(path, mult):
    doc = SimpleDocTemplate(path, pagesize=letter); el = []
    for region, stores in [('North', ['Store A', 'Store B', 'Store C']), ('South', ['Store D', 'Store E'])]:
        el += [Paragraph('Monthly Sales Report', ST['Title']), Paragraph(f'Region: {region}', ST['Heading2']), Spacer(1, 8)]
        rows = [['Store', 'Orders', 'Revenue', 'Returns %']] + [[s, f'{(i + 1) * 10 * mult:,}', f'${(i + 1) * 1234.5 * mult:,.2f}', f'{2.5 + i}%'] for i, s in enumerate(stores)]
        if region == 'South': rows.append(['Total', f'{60 * mult + 30 * mult:,}', '', ''])
        t = Table(rows); t.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.5, colors.black), ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey)])); el += [t, PageBreak()]
    doc.build(el[:-1], onFirstPage=footer, onLaterPages=footer)
ruled('monthly/Sales_Report_MAR2026.pdf', 1); ruled('monthly/Sales_Report_APR2026.pdf', 2)
# B) text in columns, no lines; region lines between rows; a subtotal row; two pages
c = canvas.Canvas('aligned_report.pdf', pagesize=letter)
def head(y): 
    for x, h in [(60, 'Site'), (260, 'Enrolled'), (360, 'Capacity'), (460, 'Rate')]: c.drawString(x, y, h)
y = 740; c.setFont('Helvetica-Bold', 12); c.drawString(60, 760, 'Site Enrollment Report  Report Period: 03/01/2026 - 03/31/2026'); c.setFont('Helvetica', 10); head(y); y -= 20
data = [('Region East', None), ('Harbor', (120, 150, '80.0')), ('Lakeside', (95, 100, '95.0')), ('Subtotal', (215, 250, '86.0')), ('Region West', None), ('Mesa', (60, 80, '75.0'))]
for name, vals in data:
    if vals is None: c.setFont('Helvetica-Bold', 10); c.drawString(60, y, name); c.setFont('Helvetica', 10)
    else:
        c.drawString(60, y, name)
        for x, v in zip((260, 360, 460), vals): c.drawString(x, y, str(v))
    y -= 18
c.drawString(500, 30, 'Page 1 of 2'); c.showPage(); c.setFont('Helvetica', 10)
y = 740; head(y); y -= 20
for name, vals in [('Pine Ridge', (40, 50, '80.0')), ('Subtotal', (100, 130, '76.9'))]:
    c.drawString(60, y, name); [c.drawString(x, y, str(v)) for x, v in zip((260, 360, 460), vals)]; y -= 18
c.drawString(500, 30, 'Page 2 of 2'); c.save()
# C) label then numbers: one center per page, labelled rows with 3 month values
c = canvas.Canvas('label_report.pdf', pagesize=letter)
for center, contractor in [('Harbor', 'Pat Lee'), ('Mesa', 'Sam Diaz')]:
    c.setFont('Helvetica', 10); c.drawString(60, 760, f'Site: {center}'); c.drawString(300, 760, f'Manager: {contractor}')
    c.drawString(60, 730, 'Measure                         Jan      Feb      Mar')
    for i, label in enumerate(['New orders', 'Returns 30 days', 'Average days to ship']):
        c.drawString(60, 710 - i * 16, label)
        for j, x in enumerate((240, 300, 360)): c.drawString(x, 710 - i * 16, f'{(i + 1) * (j + 2) * (3 if center == "Mesa" else 1):,}')
    c.drawString(60, 640, 'Notes: values are provisional')
    c.showPage()
c.save()
print('made')
