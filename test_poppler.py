from pdf2image import convert_from_path

pdf_path = "sample.pdf"

try:
    images = convert_from_path(pdf_path, dpi=150)
    print(f"Success! Converted {len(images)} PDF page(s).")

    for i, image in enumerate(images, start=1):
        image.save(f"page_{i}.png", "PNG")
        print(f"Saved page_{i}.png")

except Exception as e:
    print(f"Error: {e}")