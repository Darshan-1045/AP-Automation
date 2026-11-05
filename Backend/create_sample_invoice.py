
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

file_name = "sample_invoice.pdf"

pdf = canvas.Canvas(file_name, pagesize=A4)
width, height = A4

pdf.setFont("Helvetica-Bold", 20)
pdf.drawString(50, height - 60, "SAMPLE TAX INVOICE")

pdf.setFont("Helvetica", 12)
lines = [
    "Invoice Number: INV-2026-TEST-001",
    "Vendor: ABC Technologies Pvt Ltd",
    "Invoice Date: 29-10-2026",
    "Due Date: 28-11-2026",
    "",
    "Description: Software Development Services",
    "Subtotal: INR 10000.00",
    "GST: INR 1800.00",
    "Total Amount: INR 11800.00",
    "Currency: INR",
]

y = height - 110
for line in lines:
    pdf.drawString(50, y, line)
    y -= 28

pdf.save()

print(f"Created {file_name}")
