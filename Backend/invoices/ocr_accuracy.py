from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from .models import OCRFieldVerification


OCR_TRACKED_FIELDS = {
    field.value
    for field in OCRFieldVerification.FieldName
}
OCR_DECIMAL_FIELDS = {
    OCRFieldVerification.FieldName.SUBTOTAL,
    OCRFieldVerification.FieldName.TAX_AMOUNT,
    OCRFieldVerification.FieldName.SHIPPING,
    OCRFieldVerification.FieldName.TOTAL_AMOUNT,
}


def serialize_ocr_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _normalized_value(field_name, value):
    if value is None or value == "":
        return None

    if field_name in OCR_DECIMAL_FIELDS:
        try:
            return Decimal(str(value)).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError, TypeError):
            pass

    return " ".join(str(value).split()).casefold()


def ocr_values_match(field_name, original_value, verified_value):
    return _normalized_value(field_name, original_value) == _normalized_value(
        field_name,
        verified_value,
    )


def record_ocr_verifications(invoice, original_values, verified_fields, user):
    for field_name in verified_fields:
        original_value = serialize_ocr_value(original_values[field_name])
        verified_value = serialize_ocr_value(getattr(invoice, field_name))
        latest = (
            OCRFieldVerification.objects.filter(
                invoice=invoice,
                field_name=field_name,
            )
            .order_by("-verified_at", "-pk")
            .first()
        )

        if latest and ocr_values_match(
            field_name,
            latest.verified_value,
            verified_value,
        ):
            continue

        if latest:
            original_value = latest.original_value

        OCRFieldVerification.objects.create(
            invoice=invoice,
            field_name=field_name,
            original_value=original_value,
            verified_value=verified_value,
            is_correct=ocr_values_match(
                field_name,
                original_value,
                verified_value,
            ),
            verified_by=user if user and user.is_authenticated else None,
        )
