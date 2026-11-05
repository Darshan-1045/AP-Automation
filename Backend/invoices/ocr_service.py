
from pathlib import Path

import pytesseract
from PIL import Image
from pdf2image import convert_from_path
from pypdf import PdfReader


SUPPORTED_IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".tiff", ".tif"
}


def extract_text_from_image(file_path):
    """Extract text from an invoice image using Tesseract OCR."""
    with Image.open(file_path) as image:
        return pytesseract.image_to_string(image)


def extract_text_from_pdf(file_path):
    """Extract selectable text and OCR scanned PDF pages."""
    reader = PdfReader(file_path)
    extracted_pages = []

    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""

        if text.strip():
            extracted_pages.append(text)
        else:
            # OCR this page if it contains no selectable text.
            images = convert_from_path(
                str(file_path),
                first_page=page_number,
                last_page=page_number,
                dpi=200,
            )

            if images:
                try:
                    text = pytesseract.image_to_string(images[0])
                    extracted_pages.append(text)
                finally:
                    images[0].close()
            else:
                extracted_pages.append("")

    return "\n".join(extracted_pages)


def extract_invoice_text(file_path):
    """Extract text from supported invoice image or PDF files."""
    extension = Path(file_path).suffix.lower()

    if extension in SUPPORTED_IMAGE_EXTENSIONS:
        return extract_text_from_image(file_path)

    if extension == ".pdf":
        return extract_text_from_pdf(file_path)

    raise ValueError(
        f"Unsupported invoice file type: {extension}"
    )
