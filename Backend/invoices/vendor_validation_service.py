from .models import Vendor


def normalize_vendor_name(value):
    """Normalize vendor names for comparison."""
    if not value:
        return ""

    return " ".join(value.strip().lower().split())


def normalize_gstin(value):
    """Normalize GSTIN for comparison."""
    if not value:
        return ""

    return value.strip().upper()


def validate_vendor_data(vendor_name, vendor_gstin, vendor=None):
    """
    Compare extracted invoice vendor details against
    the registered vendor master.
    """

    warnings = []

    invoice_name = normalize_vendor_name(vendor_name)
    invoice_gstin = normalize_gstin(vendor_gstin)

    # An explicitly selected relationship must be verified directly. Do not
    # silently validate against a different vendor that happens to match OCR.
    if vendor is not None:
        registered_name = normalize_vendor_name(vendor.vendor_name)
        if invoice_name and invoice_name != registered_name:
            warnings.append(
                "Vendor name does not match the selected registered vendor."
            )
        if invoice_gstin and normalize_gstin(vendor.gstin) != invoice_gstin:
            warnings.append(
                "Extracted GSTIN does not match the selected registered vendor."
            )
        if not invoice_gstin:
            warnings.append(
                "Vendor GSTIN is missing. Manual verification is required."
            )
        if not vendor.is_active:
            warnings.append("The matched vendor is inactive.")
        if vendor.onboarding_status != Vendor.OnboardingStatus.APPROVED:
            warnings.append(
                "The matched vendor has not completed onboarding approval."
            )
        return {
            "status": "REVIEW_REQUIRED" if warnings else "VERIFIED",
            "vendor": vendor,
            "warnings": warnings,
        }

    if not invoice_name and not invoice_gstin:
        warnings.append(
            "Vendor verification failed: vendor name and GSTIN "
            "could not be identified."
        )
        return {
            "status": "REVIEW_REQUIRED",
            "vendor": None,
            "warnings": warnings,
        }

    # First, try matching by GSTIN.
    if invoice_gstin:
        vendor = Vendor.objects.filter(
            gstin__iexact=invoice_gstin
        ).first()

        if vendor:
            registered_name = normalize_vendor_name(
                vendor.vendor_name
            )

            if invoice_name and invoice_name != registered_name:
                warnings.append(
                    "Vendor name does not match the registered "
                    "vendor associated with this GSTIN."
                )

            if not vendor.is_active:
                warnings.append(
                    "The matched vendor is inactive."
                )
            if vendor.onboarding_status != Vendor.OnboardingStatus.APPROVED:
                warnings.append(
                    "The matched vendor has not completed onboarding approval."
                )

            if warnings:
                return {
                    "status": "REVIEW_REQUIRED",
                    "vendor": vendor,
                    "warnings": warnings,
                }

            return {
                "status": "VERIFIED",
                "vendor": vendor,
                "warnings": [],
            }

    # If GSTIN did not match, check for one exact normalized vendor name.
    if invoice_name:
        matches = [
            candidate
            for candidate in Vendor.objects.only(
                "id",
                "vendor_name",
                "gstin",
                "is_active",
                "onboarding_status",
            )
            if normalize_vendor_name(candidate.vendor_name) == invoice_name
        ]
        vendor = matches[0] if len(matches) == 1 else None

        if vendor:
            if not invoice_gstin:
                warnings.append(
                    "Vendor name matches the registered vendor, "
                    "but GSTIN is missing. Manual verification required."
                )

            else:
                warnings.append(
                    "Extracted GSTIN does not match the registered "
                    "GSTIN for this vendor."
                )

            if not vendor.is_active:
                warnings.append(
                    "The matched vendor is inactive."
                )
            if vendor.onboarding_status != Vendor.OnboardingStatus.APPROVED:
                warnings.append(
                    "The matched vendor has not completed onboarding approval."
                )

            return {
                "status": "REVIEW_REQUIRED",
                "vendor": vendor,
                "warnings": warnings,
            }
        if len(matches) > 1:
            warnings.append(
                "Multiple vendors have the same normalized name. "
                "Select the correct vendor manually."
            )
            return {
                "status": "REVIEW_REQUIRED",
                "vendor": None,
                "warnings": warnings,
            }

    warnings.append(
        "Vendor is not registered in the vendor master."
    )

    return {
        "status": "REVIEW_REQUIRED",
        "vendor": None,
        "warnings": warnings,
    }