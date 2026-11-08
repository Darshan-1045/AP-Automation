from django.db.models import Q

from .invoice_validation_service import validate_invoice_data
from .models import Invoice, Vendor
from .vendor_validation_service import (
    normalize_gstin,
    normalize_vendor_name,
    validate_vendor_data,
)


def match_vendor(vendor_name, vendor_gstin):
    """Match by GSTIN first, then by exact normalized name only."""
    normalized_gstin = normalize_gstin(vendor_gstin)
    if normalized_gstin:
        vendor = Vendor.objects.filter(gstin__iexact=normalized_gstin).first()
        if vendor:
            return vendor, (
                Invoice.VendorResolutionStatus.MATCHED
                if vendor.is_active
                else Invoice.VendorResolutionStatus.INACTIVE
            )

    normalized_name = normalize_vendor_name(vendor_name)
    if normalized_name:
        matches = [
            vendor
            for vendor in Vendor.objects.only("id", "vendor_name", "is_active")
            if normalize_vendor_name(vendor.vendor_name) == normalized_name
        ]
        if len(matches) == 1:
            vendor = matches[0]
            if normalized_gstin:
                return None, Invoice.VendorResolutionStatus.AMBIGUOUS
            return vendor, (
                Invoice.VendorResolutionStatus.MATCHED
                if vendor.is_active
                else Invoice.VendorResolutionStatus.INACTIVE
            )
        if len(matches) > 1:
            return None, Invoice.VendorResolutionStatus.AMBIGUOUS

    if normalized_name or normalized_gstin:
        return None, Invoice.VendorResolutionStatus.NEW_VENDOR
    return None, Invoice.VendorResolutionStatus.UNRESOLVED


def find_duplicate_invoice(invoice):
    if not invoice.invoice_number or not invoice.vendor_name:
        return False

    candidates = Invoice.objects.filter(
        invoice_number__iexact=invoice.invoice_number,
    ).exclude(pk=invoice.pk)

    identity = Q(vendor_id=invoice.vendor_id) if invoice.vendor_id else Q()
    if invoice.vendor_gstin:
        identity |= Q(vendor_gstin__iexact=invoice.vendor_gstin)
        identity |= (
            Q(vendor__isnull=True)
            & Q(vendor_name__iexact=invoice.vendor_name)
            & (Q(vendor_gstin__isnull=True) | Q(vendor_gstin=""))
        )
    else:
        identity |= Q(vendor_name__iexact=invoice.vendor_name)

    return candidates.filter(identity).exists()


def validate_resolved_invoice(invoice, extracted_data=None):
    if (
        invoice.vendor_id is None
        and invoice.vendor_resolution_status == Invoice.VendorResolutionStatus.PENDING
    ):
        vendor, resolution_status = match_vendor(
            invoice.vendor_name,
            invoice.vendor_gstin,
        )
        invoice.vendor = vendor
        invoice.vendor_resolution_status = resolution_status

    if extracted_data is None:
        line_items = [
            {
                "description": item.description,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "amount": item.amount,
            }
            for item in invoice.line_items.all()
        ]
        extracted_data = {
            "invoice_number": invoice.invoice_number,
            "vendor_name": invoice.vendor_name,
            "vendor_gstin": invoice.vendor_gstin,
            "invoice_date": (
                invoice.invoice_date.isoformat() if invoice.invoice_date else None
            ),
            "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
            "subtotal": invoice.subtotal,
            "tax_amount": invoice.tax_amount,
            "shipping": invoice.shipping,
            "total_amount": invoice.total_amount,
            "currency": invoice.currency,
            "line_items": line_items,
        }
    validation = validate_invoice_data(extracted_data)

    if invoice.vendor_id:
        vendor_validation = validate_vendor_data(
            invoice.vendor_name,
            invoice.vendor_gstin,
            vendor=invoice.vendor,
        )
        validation["warnings"].extend(vendor_validation["warnings"])
        if vendor_validation["status"] != "VERIFIED":
            validation["status"] = "REVIEW_REQUIRED"
            validation["is_valid"] = False
    elif invoice.vendor_resolution_status == Invoice.VendorResolutionStatus.NEW_VENDOR:
        validation["warnings"].append(
            "New vendor detected. Please register or verify vendor details to continue."
        )
        validation["status"] = "REVIEW_REQUIRED"
        validation["is_valid"] = False
    elif invoice.vendor_resolution_status == Invoice.VendorResolutionStatus.AMBIGUOUS:
        validation["warnings"].append(
            "The vendor name matches but the GSTIN could not be verified, or multiple vendors share the name. Select the correct vendor manually."
        )
        validation["status"] = "REVIEW_REQUIRED"
        validation["is_valid"] = False
    elif invoice.vendor_resolution_status == Invoice.VendorResolutionStatus.PENDING:
        validation["warnings"].append(
            "Select or register a vendor to continue invoice validation."
        )
        validation["status"] = "REVIEW_REQUIRED"
        validation["is_valid"] = False
    elif invoice.vendor_resolution_status == Invoice.VendorResolutionStatus.UNRESOLVED:
        validation["warnings"].append(
            "Vendor details could not be identified. Select or register a vendor."
        )
        validation["status"] = "REVIEW_REQUIRED"
        validation["is_valid"] = False

    if find_duplicate_invoice(invoice):
        validation["errors"].append(
            "Duplicate invoice number found for this vendor."
        )
        validation["status"] = "INVALID"
        validation["is_valid"] = False

    invoice.validation_status = validation["status"]
    invoice.validation_errors = validation["errors"]
    invoice.validation_warnings = validation["warnings"]
    invoice.status = (
        Invoice.Status.VALIDATED
        if validation["status"] == "VALID"
        else Invoice.Status.REVIEW_REQUIRED
    )
    invoice.processing_error = ""
    invoice.save(update_fields=[
        "vendor",
        "vendor_resolution_status",
        "validation_status",
        "validation_errors",
        "validation_warnings",
        "status",
        "processing_error",
        "updated_at",
    ])
    return validation
