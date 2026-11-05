from decimal import Decimal

from .models import (
    GoodsReceiptNote,
    Invoice,
    InvoiceMatchingResult,
    PurchaseOrder,
)


def _add_exception(exceptions, code, message):
    exceptions.append({"code": code, "message": message})


def _description(value):
    return " ".join((value or "").casefold().split())


def _money(value):
    if value is None:
        return None
    return Decimal(value).quantize(Decimal("0.01"))


def match_invoice(invoice, purchase_order=None, goods_receipt=None, tolerance=Decimal("0.00")):
    exceptions = []

    if purchase_order is None and invoice.po_number:
        purchase_order = PurchaseOrder.objects.filter(
            po_number__iexact=invoice.po_number.strip()
        ).first()

    if purchase_order is None:
        _add_exception(exceptions, "PO_NOT_FOUND", "No purchase order was found for this invoice.")
        InvoiceMatchingResult.objects.filter(invoice=invoice, is_current=True).update(
            is_current=False
        )
        return InvoiceMatchingResult.objects.create(
            invoice=invoice,
            status=InvoiceMatchingResult.Status.NOT_FOUND,
            exceptions=exceptions,
            amount_tolerance=tolerance,
        )

    if invoice.po_number and invoice.po_number.strip().casefold() != purchase_order.po_number.casefold():
        _add_exception(exceptions, "PO_NUMBER_MISMATCH", "Invoice PO number does not match the selected purchase order.")

    po_vendor = purchase_order.vendor
    if invoice.vendor_gstin and po_vendor.gstin:
        vendor_matches = invoice.vendor_gstin.strip().casefold() == po_vendor.gstin.casefold()
    else:
        vendor_matches = (invoice.vendor_name or "").strip().casefold() == po_vendor.vendor_name.strip().casefold()
    if not vendor_matches:
        _add_exception(exceptions, "VENDOR_MISMATCH", "Invoice vendor does not match the purchase order vendor.")

    if _money(invoice.subtotal) is None:
        _add_exception(exceptions, "INVOICE_SUBTOTAL_MISSING", "Invoice subtotal is missing.")
    elif abs(_money(invoice.subtotal) - _money(purchase_order.subtotal)) > tolerance:
        _add_exception(exceptions, "SUBTOTAL_MISMATCH", "Invoice subtotal differs from the purchase order.")

    if _money(invoice.tax_amount) is None:
        _add_exception(exceptions, "INVOICE_TAX_MISSING", "Invoice tax amount is missing.")
    elif abs(_money(invoice.tax_amount) - _money(purchase_order.tax_amount)) > tolerance:
        _add_exception(exceptions, "TAX_MISMATCH", "Invoice tax differs from the purchase order.")

    if _money(invoice.total_amount) is None:
        _add_exception(exceptions, "INVOICE_TOTAL_MISSING", "Invoice total amount is missing.")
    elif abs(_money(invoice.total_amount) - _money(purchase_order.total_amount)) > tolerance:
        _add_exception(exceptions, "TOTAL_MISMATCH", "Invoice total differs from the purchase order.")

    po_items = list(purchase_order.items.all())
    invoice_items = list(invoice.line_items.all())
    matched_po_item_ids = set()
    item_matches = {}

    for invoice_item in invoice_items:
        candidate = next((
            item for item in po_items
            if item.id not in matched_po_item_ids
            and _description(item.description) == _description(invoice_item.description)
        ), None)
        if candidate is None:
            _add_exception(
                exceptions,
                "ITEM_NOT_FOUND",
                f"Invoice item '{invoice_item.description or 'Unspecified'}' was not found on the purchase order.",
            )
            continue

        matched_po_item_ids.add(candidate.id)
        item_matches[candidate.id] = invoice_item
        if invoice_item.quantity is None or invoice_item.quantity != candidate.quantity:
            _add_exception(exceptions, "QUANTITY_MISMATCH", f"Quantity mismatch for '{candidate.description}'.")
        if _money(invoice_item.unit_price) is None or _money(invoice_item.unit_price) != _money(candidate.unit_price):
            _add_exception(exceptions, "PRICE_MISMATCH", f"Unit price mismatch for '{candidate.description}'.")
    for item in po_items:
        if item.id not in matched_po_item_ids:
            _add_exception(exceptions, "PO_ITEM_MISSING", f"Purchase order item '{item.description}' is missing from the invoice.")

    if goods_receipt is None:
        goods_receipt = GoodsReceiptNote.objects.filter(
            purchase_order=purchase_order
        ).order_by("-received_date", "-id").first()
    if goods_receipt and goods_receipt.purchase_order_id != purchase_order.id:
        _add_exception(exceptions, "GRN_PO_MISMATCH", "Goods receipt note belongs to a different purchase order.")
        goods_receipt = None

    if goods_receipt is None:
        _add_exception(exceptions, "GRN_NOT_FOUND", "No goods receipt note was found for this purchase order.")
    else:
        receipt_quantities = {
            item.purchase_order_item_id: item.accepted_quantity
            for item in goods_receipt.items.all()
        }
        for po_item in po_items:
            invoice_item = item_matches.get(po_item.id)
            received = receipt_quantities.get(po_item.id)
            if received is None:
                _add_exception(exceptions, "RECEIPT_ITEM_MISSING", f"No accepted receipt quantity was recorded for '{po_item.description}'.")
            elif invoice_item and invoice_item.quantity is not None and invoice_item.quantity != received:
                code = "EXCESS_INVOICED_QUANTITY" if invoice_item.quantity > received else "RECEIVED_QUANTITY_MISMATCH"
                _add_exception(exceptions, code, f"Invoiced quantity for '{po_item.description}' differs from accepted quantity.")

    blocking_exceptions = [
        item for item in exceptions if item["code"] != "GRN_NOT_FOUND"
    ]
    if not blocking_exceptions and exceptions:
        status = InvoiceMatchingResult.Status.PARTIALLY_MATCHED
    elif exceptions:
        status = InvoiceMatchingResult.Status.MISMATCHED
    else:
        status = InvoiceMatchingResult.Status.MATCHED

    InvoiceMatchingResult.objects.filter(invoice=invoice, is_current=True).update(is_current=False)
    return InvoiceMatchingResult.objects.create(
        invoice=invoice,
        purchase_order=purchase_order,
        goods_receipt=goods_receipt,
        status=status,
        exceptions=exceptions,
        amount_tolerance=tolerance,
    )
