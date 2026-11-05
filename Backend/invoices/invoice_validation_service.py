from datetime import date
from decimal import Decimal, InvalidOperation


def validate_invoice_data(data):
    errors = []
    warnings = []

    required_fields = [
        "invoice_number",
        "vendor_name",
        "invoice_date",
        "subtotal",
        "total_amount",
        "currency",
    ]

    for field in required_fields:
        if data.get(field) is None or data.get(field) == "":
            warnings.append(f"{field} is missing.")

    # Validate dates.
    invoice_date = None
    due_date = None

    try:
        if data.get("invoice_date"):
            invoice_date = date.fromisoformat(data["invoice_date"])
    except (ValueError, TypeError):
        errors.append("Invalid invoice date. Expected YYYY-MM-DD.")

    try:
        if data.get("due_date"):
            due_date = date.fromisoformat(data["due_date"])
    except (ValueError, TypeError):
        errors.append("Invalid due date. Expected YYYY-MM-DD.")

    if invoice_date and due_date and due_date < invoice_date:
        errors.append("Due date cannot be earlier than invoice date.")

    # Validate monetary fields.
    monetary_fields = [
        "subtotal",
        "tax_amount",
        "shipping",
        "total_amount",
    ]

    amounts = {}

    for field in monetary_fields:
        value = data.get(field)

        # Unknown values remain unknown. Do not assume zero.
        if value is None or value == "":
            continue

        try:
            amount = Decimal(str(value))

            if not amount.is_finite() or amount < 0:
                raise InvalidOperation

            amounts[field] = amount

        except (InvalidOperation, ValueError, TypeError):
            errors.append(
                f"{field} must be a valid non-negative number."
            )

    # Missing tax means the total cannot be fully reconciled.
    if data.get("tax_amount") is None:
        warnings.append("Tax amount could not be identified.")

    # Compare totals only when every component is known.
    required_amounts = [
        "subtotal",
        "tax_amount",
        "shipping",
        "total_amount",
    ]

    if all(field in amounts for field in required_amounts):
        expected_total = (
            amounts["subtotal"]
            + amounts["tax_amount"]
            + amounts["shipping"]
        )

        if expected_total.quantize(Decimal("0.01")) != (
            amounts["total_amount"].quantize(Decimal("0.01"))
        ):
            errors.append(
                f"Total mismatch. Expected {expected_total}, "
                f"received {amounts['total_amount']}."
            )

    # Validate line items.
    line_items = data.get("line_items", [])

    if not isinstance(line_items, list):
        errors.append("Line items must be a list.")

    else:
        for index, item in enumerate(line_items, start=1):

            if not isinstance(item, dict):
                errors.append(f"Line item {index} must be an object.")
                continue

            for field in [
                "description",
                "quantity",
                "unit_price",
                "amount",
            ]:
                if item.get(field) is None or item.get(field) == "":
                    warnings.append(
                        f"Line item {index}: {field} is missing."
                    )

            values = [
                item.get("quantity"),
                item.get("unit_price"),
                item.get("amount"),
            ]

            if all(value is not None and value != "" for value in values):
                try:
                    quantity = Decimal(str(values[0]))
                    unit_price = Decimal(str(values[1]))
                    amount = Decimal(str(values[2]))

                    if not all(
                        value.is_finite() and value >= 0
                        for value in [quantity, unit_price, amount]
                    ):
                        raise InvalidOperation

                    expected_amount = (
                        quantity * unit_price
                    ).quantize(Decimal("0.01"))

                    if expected_amount != amount.quantize(
                        Decimal("0.01")
                    ):
                        errors.append(
                            f"Line item {index}: amount does not equal "
                            "quantity multiplied by unit price."
                        )

                except (InvalidOperation, ValueError, TypeError):
                    errors.append(
                        f"Line item {index}: invalid numeric values."
                    )

    if errors:
        status = "INVALID"
    elif warnings:
        status = "REVIEW_REQUIRED"
    else:
        status = "VALID"

    return {
        "status": status,
        "is_valid": status == "VALID",
        "errors": errors,
        "warnings": warnings,
    }