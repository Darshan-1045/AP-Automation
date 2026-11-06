
from io import BytesIO
from pathlib import Path
import shutil

import pytesseract
from PIL import Image
from pdf2image import convert_from_bytes
from pypdf import PdfReader


SUPPORTED_IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".tiff", ".tif"
}


class OCRDependencyError(RuntimeError):
    """Raised when an OCR system executable is unavailable."""


def _read_document(file_source):
    if isinstance(file_source, bytes):
        return file_source
    if hasattr(file_source, "read"):
        file_source.seek(0)
        content = file_source.read()
        file_source.seek(0)
        return content
    return Path(file_source).read_bytes()


def _require_tesseract():
    if shutil.which(pytesseract.pytesseract.tesseract_cmd) is None:
        raise OCRDependencyError(
            "Tesseract OCR is unavailable in the backend runtime."
        )


def _require_poppler():
    if (
        shutil.which("pdfinfo") is None
        or (
            shutil.which("pdftoppm") is None
            and shutil.which("pdftocairo") is None
        )
    ):
        raise OCRDependencyError(
            "Poppler is unavailable in the backend runtime for scanned PDF OCR."
        )


def extract_text_from_image(file_path):
    """Extract text from an invoice image using Tesseract OCR."""
    _require_tesseract()
    with Image.open(file_path) as image:
        return pytesseract.image_to_string(image)


def extract_text_from_pdf(file_path):
    """Extract selectable text and OCR scanned PDF pages."""
    pdf_content = _read_document(file_path)
    reader = PdfReader(BytesIO(pdf_content))
    extracted_pages = []

    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""

        if text.strip():
            extracted_pages.append(text)
        else:
            _require_tesseract()
            _require_poppler()
            images = convert_from_bytes(
                pdf_content,
                first_page=page_number,
                last_page=page_number,
                dpi=200,
                use_pdftocairo=(
                    shutil.which("pdftoppm") is None
                    and shutil.which("pdftocairo") is not None
                ),
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
    file_name = getattr(file_path, "name", file_path)
    extension = Path(file_name).suffix.lower()
    content = _read_document(file_path)

    if extension in SUPPORTED_IMAGE_EXTENSIONS:
        return extract_text_from_image(BytesIO(content))

    if extension == ".pdf":
        return extract_text_from_pdf(content)

    raise ValueError(
        f"Unsupported invoice file type: {extension}"
    )
