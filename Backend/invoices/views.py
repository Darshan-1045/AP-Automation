import logging
from datetime import date
from decimal import Decimal, InvalidOperation
from uuid import uuid4

from django.http import FileResponse
from django.db import IntegrityError, transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import generics
from rest_framework.exceptions import (
    APIException,
    PermissionDenied,
    ValidationError,
)
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from django.shortcuts import get_object_or_404

from .audit import record_audit_event
from .models import (
    Invoice,
    InvoiceLineItem,
    InvoiceApprovalHistory,
    InvoiceMatchingResult,
    OCRFieldVerification,
    ApprovalRule,
    Payment,
    Vendor,
    VendorOnboardingHistory,
)
from .ocr_accuracy import OCR_TRACKED_FIELDS, record_ocr_verifications
from .serializers import InvoiceSerializer, PaymentSerializer, VendorSerializer
from .ocr_service import OCRDependencyError, extract_invoice_text
from .storage_backends import SupabaseStorageError
from .ai_extraction_service import extract_invoice_data
from .vendor_validation_service import validate_vendor_data
from .vendor_resolution import match_vendor, validate_resolved_invoice
from .matching_service import match_invoice

logger = logging.getLogger(__name__)


class InvoiceStorageUnavailable(APIException):
    status_code = http_status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "Invoice document storage is temporarily unavailable."
    default_code = "storage_unavailable"


class InvoiceDocumentDeletionFailed(APIException):
    status_code = http_status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = (
        "The invoice document could not be deleted. "
        "The invoice record was not removed; please try again."
    )
    default_code = "document_deletion_failed"


class InvoiceDeletionConflict(APIException):
    status_code = http_status.HTTP_409_CONFLICT
    default_detail = (
        "This invoice has payment records and cannot be deleted. "
        "Resolve its financial history before attempting deletion."
    )
    default_code = "invoice_has_payments"


class VendorDeletionConflict(APIException):
    status_code = http_status.HTTP_409_CONFLICT
    default_code = "vendor_deletion_conflict"


INVOICE_DOCUMENT_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}


def _approval_rules_for(invoice):
    amount = invoice.total_amount or Decimal("0")
    rules = list(
        ApprovalRule.objects.filter(
            is_active=True,
            minimum_amount__lte=amount,
        ).filter(
            Q(maximum_amount__isnull=True) | Q(maximum_amount__gte=amount)
        ).order_by("approval_level").values("approval_level")
    )
    return rules or [{"approval_level": 1}]


def safe_decimal(value):
    """Convert a value to Decimal without inventing missing values."""
    if value is None or value == "":
        return None

    try:
        result = Decimal(str(value))
        return result if result.is_finite() else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def safe_date(value):
    """Convert an ISO date string to a Python date."""
    if not value:
        return None

    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def _validate_invoice_for_payment(invoice):
    if invoice.status != Invoice.Status.APPROVED:
        raise ValidationError(
            {"invoice": "Only approved invoices can have payment requests."}
        )
    if invoice.validation_status != "VALID" or invoice.validation_errors:
        raise ValidationError(
            {"invoice": "The invoice must pass validation before payment."}
        )

    vendor_validation = validate_vendor_data(
        invoice.vendor_name,
        invoice.vendor_gstin,
        vendor=invoice.vendor,
    )
    if vendor_validation["status"] != "VERIFIED":
        raise ValidationError(
            {"invoice": "The vendor must be approved and verified before payment."}
        )

    if invoice.po_number or invoice.matching_results.exists():
        result = invoice.matching_results.filter(is_current=True).first()
        if result is None or result.status != InvoiceMatchingResult.Status.MATCHED:
            raise ValidationError(
                {"invoice": "A current successful PO/GRN match is required."}
            )


def _process_invoice_document(invoice, request):
    invoice.status = Invoice.Status.PROCESSING
    invoice.save(update_fields=["status", "updated_at"])
    try:
            with invoice.document.open("rb") as document:
                extracted_text = extract_invoice_text(document)
            if not extracted_text or not extracted_text.strip():
                raise ValueError("No readable text found in the document.")

            invoice.extracted_text = extracted_text
            invoice.save(update_fields=["extracted_text", "updated_at"])
            record_audit_event(
                request,
                "invoice.ocr_completed",
                "invoice",
                invoice.pk,
                {"extracted_character_count": len(extracted_text)},
            )

            extracted_data = extract_invoice_data(extracted_text)
            if not isinstance(extracted_data, dict):
                raise ValueError("AI returned an invalid invoice structure.")

            with transaction.atomic():
                invoice.invoice_number = extracted_data.get("invoice_number")
                invoice.vendor_name = extracted_data.get("vendor_name")
                invoice.vendor_gstin = extracted_data.get("vendor_gstin") or None
                invoice.po_number = extracted_data.get("po_number") or ""
                invoice.invoice_date = safe_date(extracted_data.get("invoice_date"))
                invoice.due_date = safe_date(extracted_data.get("due_date"))
                invoice.subtotal = safe_decimal(extracted_data.get("subtotal"))
                invoice.tax_amount = safe_decimal(extracted_data.get("tax_amount"))
                invoice.shipping = safe_decimal(extracted_data.get("shipping"))
                invoice.total_amount = safe_decimal(extracted_data.get("total_amount"))
                invoice.currency = extracted_data.get("currency") or invoice.currency

                invoice.extracted_vendor_details = {
                    field: extracted_data.get(source).strip()
                    if isinstance(extracted_data.get(source), str)
                    else ""
                    for field, source in (
                        ("address", "vendor_address"),
                        ("email", "vendor_email"),
                        ("phone", "vendor_phone"),
                    )
                }
                vendor, resolution_status = match_vendor(
                    invoice.vendor_name,
                    invoice.vendor_gstin,
                )
                invoice.vendor = vendor
                invoice.vendor_resolution_status = resolution_status
                invoice.save()

                invoice.line_items.all().delete()
                line_items = extracted_data.get("line_items", [])
                if isinstance(line_items, list):
                    InvoiceLineItem.objects.bulk_create([
                        InvoiceLineItem(
                            invoice=invoice,
                            item_code=item.get("item_code"),
                            description=item.get("description"),
                            quantity=safe_decimal(item.get("quantity")),
                            unit_price=safe_decimal(item.get("unit_price")),
                            amount=safe_decimal(item.get("amount")),
                        )
                        for item in line_items
                        if isinstance(item, dict)
                    ])

                validation = validate_resolved_invoice(invoice, extracted_data)
                record_audit_event(
                    request,
                    "invoice.validation_performed",
                    "invoice",
                    invoice.pk,
                    {
                        "status": validation["status"],
                        "error_count": len(validation["errors"]),
                        "warning_count": len(validation["warnings"]),
                    },
                )
    except Exception as exc:
            logger.exception("Invoice processing failed for invoice ID %s", invoice.pk)
            invoice.status = Invoice.Status.REVIEW_REQUIRED
            invoice.processing_error = (
                str(exc)
                if isinstance(exc, OCRDependencyError)
                else "Automatic processing failed. Please review the document or retry processing."
            )
            invoice.save(update_fields=["status", "processing_error", "updated_at"])
            record_audit_event(
                request,
                "invoice.processing_failed",
                "invoice",
                invoice.pk,
                {"stage": "ocr_or_extraction"},
            )


class InvoiceListCreateAPIView(generics.ListCreateAPIView):

    queryset = Invoice.objects.all().order_by("-created_at")
    serializer_class = InvoiceSerializer

    parser_classes = [MultiPartParser, FormParser]

    def perform_create(self, serializer):
        try:
            invoice = serializer.save()
        except SupabaseStorageError as exc:
            raise InvoiceStorageUnavailable() from exc

        document_name = invoice.document.name or ""
        uploaded_document = serializer.validated_data.get("document")
        record_audit_event(
            getattr(self, "request", None),
            "invoice.uploaded",
            "invoice",
            invoice.pk,
            {
                "file_type": document_name.rsplit(".", 1)[-1].lower()
                if "." in document_name else "",
                "file_size": uploaded_document.size if uploaded_document else 0,
            },
        )
        _process_invoice_document(invoice, self.request)


class InvoiceDocumentAPIView(APIView):
    def get(self, request, pk):
            invoice = get_object_or_404(Invoice, pk=pk)
            if not invoice.document:
                return Response(
                    {"detail": "No document is available for this invoice."},
                    status=http_status.HTTP_404_NOT_FOUND,
                )

            filename = invoice.document.name.rsplit("/", 1)[-1]
            extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            content_type = INVOICE_DOCUMENT_CONTENT_TYPES.get(
                f".{extension}",
                "application/octet-stream",
            )
            try:
                document = invoice.document.open("rb")
            except FileNotFoundError:
                return Response(
                    {"detail": "The stored invoice document is unavailable."},
                    status=http_status.HTTP_404_NOT_FOUND,
                )
            except SupabaseStorageError as exc:
                raise InvoiceStorageUnavailable() from exc

            response = FileResponse(
                document,
                content_type=content_type,
                as_attachment=False,
                filename=filename,
            )
            response["Cache-Control"] = "private, no-store"
            response["X-Content-Type-Options"] = "nosniff"
            return response


class InvoiceBulkUploadAPIView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    max_files = 20

    def post(self, request):
        documents = request.FILES.getlist("documents")
        if not documents:
            return Response(
                {"documents": "Upload at least one invoice document."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if len(documents) > self.max_files:
            return Response(
                {"documents": f"A maximum of {self.max_files} files can be uploaded at once."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        processor = InvoiceListCreateAPIView()
        processor.request = request
        results = []
        for document in documents:
            serializer = InvoiceSerializer(data={"document": document})
            if not serializer.is_valid():
                errors = serializer.errors
                message = "; ".join(
                    f"{field}: {', '.join(str(item) for item in messages)}"
                    for field, messages in errors.items()
                )
                results.append({
                    "filename": document.name,
                    "success": False,
                    "error": message,
                })
                continue

            try:
                processor.perform_create(serializer)
                results.append({
                    "filename": document.name,
                    "success": True,
                    "invoice": serializer.data,
                })
            except Exception:
                logger.exception("Bulk invoice upload failed.")
                results.append({
                    "filename": document.name,
                    "success": False,
                    "error": "The document could not be saved. Please try again.",
                })

        return Response({"results": results}, status=http_status.HTTP_200_OK)


class InvoiceVendorResolutionAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        invoice = get_object_or_404(
            Invoice.objects.select_for_update().select_related("vendor"),
            pk=pk,
        )
        if invoice.status in {
            Invoice.Status.PENDING_APPROVAL,
            Invoice.Status.APPROVED,
            Invoice.Status.ESCALATED,
            Invoice.Status.REJECTED,
            Invoice.Status.PAID,
        } or invoice.payments.exists():
            return Response(
                {"detail": "Vendor resolution is unavailable after financial approval or payment."},
                status=http_status.HTTP_409_CONFLICT,
            )

        vendor_id = request.data.get("vendor_id")
        vendor_data = request.data.get("vendor")
        if vendor_id is not None and vendor_data is not None:
            return Response(
                {"detail": "Choose an existing vendor or register a new one, not both."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        created_vendor = False
        if vendor_id is not None:
            vendor = get_object_or_404(
                Vendor.objects.select_for_update(),
                pk=vendor_id,
            )
        elif isinstance(vendor_data, dict):
            allowed_fields = {
                "vendor_name",
                "gstin",
                "address",
                "email",
                "phone",
                "bank_account_name",
                "bank_account_number",
                "bank_ifsc",
            }
            registration_data = {
                key: value
                for key, value in vendor_data.items()
                if key in allowed_fields
            }
            if not registration_data.get("gstin"):
                registration_data["gstin"] = None
            if not str(registration_data.get("vendor_name") or "").strip():
                return Response(
                    {"vendor_name": "Vendor name is required."},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )

            vendor, match_status = match_vendor(
                registration_data.get("vendor_name"),
                registration_data.get("gstin"),
            )
            if (
                match_status == Invoice.VendorResolutionStatus.AMBIGUOUS
                and not registration_data.get("gstin")
            ):
                return Response(
                    {
                        "detail": (
                            "The vendor name is ambiguous without a GSTIN. "
                            "Select the correct existing vendor or provide a verified GSTIN."
                        )
                    },
                    status=http_status.HTTP_409_CONFLICT,
                )
            if vendor is None:
                serializer = VendorSerializer(data=registration_data)
                serializer.is_valid(raise_exception=True)
                try:
                    with transaction.atomic():
                        vendor = serializer.save(
                            is_active=True,
                            onboarding_status=Vendor.OnboardingStatus.PENDING,
                        )
                except IntegrityError:
                    logger.exception(
                        "Vendor registration conflicted with a concurrent vendor write."
                    )
                    return Response(
                        {
                            "detail": (
                                "A vendor with these details was registered concurrently. "
                                "Select the existing vendor and retry."
                            )
                        },
                        status=http_status.HTTP_409_CONFLICT,
                    )
                VendorOnboardingHistory.objects.create(
                    vendor=vendor,
                    previous_status="",
                    new_status=vendor.onboarding_status,
                    actor_username=request.user.get_username(),
                )
                record_audit_event(
                    request,
                    "vendor.created",
                    "vendor",
                    vendor.pk,
                    {"fields": sorted(serializer.validated_data.keys())},
                )
                created_vendor = True
        else:
            return Response(
                {"detail": "Provide vendor_id or vendor registration details."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        invoice.vendor = vendor
        invoice.vendor_resolution_status = (
            Invoice.VendorResolutionStatus.MATCHED
            if vendor.is_active
            else Invoice.VendorResolutionStatus.INACTIVE
        )
        invoice.save(update_fields=[
            "vendor",
            "vendor_resolution_status",
            "updated_at",
        ])
        validation = validate_resolved_invoice(invoice)

        matching_result = None
        if invoice.po_number:
            matching_result = match_invoice(invoice)

        record_audit_event(
            request,
            "invoice.vendor_resolved",
            "invoice",
            invoice.pk,
            {
                "vendor_id": vendor.pk,
                "created_vendor": created_vendor,
                "validation_status": validation["status"],
                "matching_status": matching_result.status if matching_result else "",
            },
        )
        message = (
            "Vendor registered and associated with this invoice. "
            "Vendor onboarding approval is still required before approval or payment."
            if created_vendor
            else "Vendor associated with this invoice and validation resumed."
        )
        return Response(
            {
                "message": message,
                "invoice": InvoiceSerializer(
                    invoice,
                    context={"request": request},
                ).data,
            },
            status=http_status.HTTP_200_OK,
        )


class RetryInvoiceProcessingAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        invoice = get_object_or_404(
            Invoice.objects.select_for_update(),
            pk=pk,
        )
        if invoice.status in {
            Invoice.Status.PENDING_APPROVAL,
            Invoice.Status.APPROVED,
            Invoice.Status.ESCALATED,
            Invoice.Status.REJECTED,
            Invoice.Status.PAID,
        }:
            return Response(
                {"detail": "Invoice processing cannot be retried after approval workflow begins."},
                status=http_status.HTTP_409_CONFLICT,
            )
        if not invoice.document:
            return Response(
                {"detail": "No stored invoice document is available to process."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        record_audit_event(
            request,
            "invoice.processing_retry_requested",
            "invoice",
            invoice.pk,
            {},
        )
        _process_invoice_document(invoice, request)
        return Response(
            InvoiceSerializer(invoice, context={"request": request}).data,
            status=http_status.HTTP_200_OK,
        )


class InvoiceDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Invoice.objects.prefetch_related("line_items").all()
    serializer_class = InvoiceSerializer

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self.perform_destroy(instance)
        return Response(
            {"message": "Invoice deleted successfully."},
            status=http_status.HTTP_200_OK,
        )

    def perform_destroy(self, instance):
        instance = Invoice.objects.select_for_update().get(pk=instance.pk)
        user = self.request.user
        is_admin = (
            user.is_staff
            or user.is_superuser
            or user.groups.filter(name="Admin").exists()
        )

        if (
            instance.status == Invoice.Status.PAID
            or instance.payment_date
            or instance.payment_reference
            or instance.payments.exists()
        ):
            raise InvoiceDeletionConflict()

        deletable_statuses = {
            Invoice.Status.UPLOADED,
            Invoice.Status.PROCESSING,
            Invoice.Status.REVIEW_REQUIRED,
        }
        if not is_admin and instance.status not in deletable_statuses:
            raise PermissionDenied(
                "Only an administrator can delete an invoice after it enters "
                "the approval workflow."
            )

        document_name = instance.document.name if instance.document else ""
        shared_document = bool(
            document_name
            and Invoice.objects.filter(document=document_name)
            .exclude(pk=instance.pk)
            .exists()
        )
        if document_name and not shared_document:
            try:
                instance.document.storage.delete(document_name)
            except (SupabaseStorageError, OSError) as exc:
                logger.exception(
                    "Invoice document deletion failed for invoice ID %s",
                    instance.pk,
                )
                raise InvoiceDocumentDeletionFailed() from exc

        approval_history = [
            {
                "action": entry.action,
                "remarks": entry.remarks,
                "actor_username": entry.actor_username,
                "approval_level": entry.approval_level,
                "created_at": entry.created_at.isoformat(),
            }
            for entry in instance.approval_history.all()
        ]
        record_audit_event(
            self.request,
            "invoice.deleted",
            "invoice",
            instance.pk,
            {
                "invoice_number": instance.invoice_number,
                "vendor_name": instance.vendor_name,
                "status": instance.status,
                "document_deleted": bool(document_name and not shared_document),
                "approval_history": approval_history,
            },
        )
        instance.delete()

    @transaction.atomic
    def perform_update(self, serializer):
        existing = self.get_object()
        if existing.status in {
            Invoice.Status.APPROVED,
            Invoice.Status.REJECTED,
            Invoice.Status.PAID,
        }:
            raise ValidationError(
                "Approved, rejected, and paid invoices cannot be edited."
            )
        changed_fields = sorted(serializer.validated_data.keys())
        verified_fields = (
            OCR_TRACKED_FIELDS.intersection(serializer.validated_data.keys())
        )
        original_values = {
            field_name: getattr(existing, field_name)
            for field_name in verified_fields
        }
        invoice = serializer.save()
        record_ocr_verifications(
            invoice,
            original_values,
            verified_fields,
            self.request.user,
        )
        record_audit_event(
            self.request,
            "invoice.manually_edited",
            "invoice",
            invoice.pk,
            {"fields": changed_fields},
        )
        InvoiceMatchingResult.objects.filter(
            invoice=invoice,
            is_current=True,
        ).update(is_current=False)

        validation = validate_resolved_invoice(invoice)
        invoice.approval_level = 0
        invoice.save(update_fields=["approval_level", "updated_at"])
        record_audit_event(
            self.request,
            "invoice.validation_performed",
            "invoice",
            invoice.pk,
            {
                "status": validation["status"],
                "error_count": len(validation["errors"]),
                "warning_count": len(validation["warnings"]),
            },
        )



class InvoiceApprovalActionAPIView(APIView):

    action = None

    @transaction.atomic
    def post(self, request, pk):

        invoice = get_object_or_404(
            Invoice.objects.select_for_update(),
            pk=pk,
        )

        if self.action == Invoice.Status.APPROVED:
            if (
                invoice.status not in {
                    Invoice.Status.VALIDATED,
                    Invoice.Status.PENDING_APPROVAL,
                    Invoice.Status.ESCALATED,
                }
                or invoice.validation_status != "VALID"
                or invoice.validation_errors
            ):
                return Response(
                    {
                        "error": "Only successfully validated invoices can be approved.",
                        "current_status": invoice.status,
                    },
                    status=http_status.HTTP_400_BAD_REQUEST,
                )

            vendor_validation = validate_vendor_data(
                invoice.vendor_name,
                invoice.vendor_gstin,
                vendor=invoice.vendor,
            )
            if vendor_validation["status"] != "VERIFIED":
                return Response(
                    {
                        "error": "The vendor must be verified, approved, and active before approval.",
                        "vendor_warnings": vendor_validation["warnings"],
                    },
                    status=http_status.HTTP_400_BAD_REQUEST,
                )

            rules = _approval_rules_for(invoice)
            next_rule = next(
                (
                    rule for rule in rules
                    if rule["approval_level"] > invoice.approval_level
                ),
                None,
            )
            if next_rule is None:
                return Response(
                    {"error": "The invoice has already completed all approval levels."},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            remarks = request.data.get("remarks", "")
            if remarks is None:
                remarks = ""
            if not isinstance(remarks, str):
                return Response(
                    {"error": "Remarks must be a string."},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )

            if invoice.po_number or invoice.matching_results.exists():
                matching_result = invoice.matching_results.filter(
                    is_current=True
                ).first()
                if (
                    matching_result is None
                    or matching_result.status != InvoiceMatchingResult.Status.MATCHED
                ):
                    return Response(
                        {
                            "error": (
                                "An invoice with a PO reference requires a current "
                                "successful PO/GRN match before approval."
                            ),
                            "matching_status": (
                                matching_result.status if matching_result else "STALE"
                            ),
                        },
                        status=http_status.HTTP_400_BAD_REQUEST,
                    )

            following_rule = next(
                (
                    rule for rule in rules
                    if rule["approval_level"] > next_rule["approval_level"]
                ),
                None,
            )
            invoice.approval_level = next_rule["approval_level"]
            invoice.status = (
                Invoice.Status.PENDING_APPROVAL
                if following_rule
                else Invoice.Status.APPROVED
            )
            invoice.save(update_fields=[
                "status",
                "approval_level",
                "updated_at",
            ])

            history = InvoiceApprovalHistory.objects.create(
                invoice=invoice,
                action=InvoiceApprovalHistory.Action.APPROVED,
                remarks=remarks.strip(),
                actor_username=request.user.get_username(),
                approval_level=next_rule["approval_level"],
            )
            record_audit_event(
                request,
                "invoice.approved" if not following_rule else "invoice.approval_level_completed",
                "invoice",
                invoice.pk,
                {
                    "approval_history_id": history.pk,
                    "approval_level": next_rule["approval_level"],
                    "final_approval": following_rule is None,
                },
            )
            return Response(
                {
                    "message": (
                        "Invoice approved successfully."
                        if not following_rule
                        else "Approval level completed; further approval is required."
                    ),
                    "invoice": InvoiceSerializer(invoice).data,
                    "approval_history": {
                        "id": history.pk,
                        "action": history.action,
                        "remarks": history.remarks,
                        "approval_level": history.approval_level,
                        "actor_username": history.actor_username,
                        "created_at": history.created_at,
                    },
                },
                status=http_status.HTTP_200_OK,
            )

        elif invoice.status in {
            Invoice.Status.APPROVED,
            Invoice.Status.REJECTED,
            Invoice.Status.PAID,
        }:
            return Response(
                {
                    "error": "This invoice can no longer be rejected.",
                    "current_status": invoice.status,
                },
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        if (
            self.action == Invoice.Status.APPROVED
            and (invoice.po_number or invoice.matching_results.exists())
        ):
            matching_result = invoice.matching_results.filter(
                is_current=True
            ).first()
            if (
                matching_result is None
                or matching_result.status != InvoiceMatchingResult.Status.MATCHED
            ):
                return Response(
                    {
                        "error": (
                            "An invoice with a PO reference requires a current "
                            "successful PO/GRN match before approval."
                        ),
                        "matching_status": (
                            matching_result.status if matching_result else "STALE"
                        ),
                    },
                    status=http_status.HTTP_400_BAD_REQUEST,
                )

        remarks = request.data.get("remarks", "")

        if remarks is None:
            remarks = ""

        if not isinstance(remarks, str):
            return Response(
                {"error": "Remarks must be a string."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        remarks = remarks.strip()
        if self.action == Invoice.Status.REJECTED and not remarks:
            return Response(
                {"error": "A rejection reason is required."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        # Update invoice status.
        invoice.status = self.action
        invoice.save(update_fields=["status", "updated_at"])

        # Record approval/rejection history.
        history = InvoiceApprovalHistory.objects.create(
            invoice=invoice,
            action=self.action,
            remarks=remarks,
            actor_username=request.user.get_username(),
            approval_level=invoice.approval_level,
        )
        record_audit_event(
            request,
            f"invoice.{self.action.lower()}",
            "invoice",
            invoice.pk,
            {"approval_history_id": history.pk},
        )

        return Response(
            {
                "message": f"Invoice {self.action.lower()} successfully.",
                "invoice": InvoiceSerializer(invoice).data,
                "approval_history": {
                    "id": history.id,
                    "action": history.action,
                    "remarks": history.remarks,
                    "created_at": history.created_at,
                },
            },
            status=http_status.HTTP_200_OK,
        )


class ApproveInvoiceAPIView(InvoiceApprovalActionAPIView):
    action = Invoice.Status.APPROVED


class RejectInvoiceAPIView(InvoiceApprovalActionAPIView):
    action = Invoice.Status.REJECTED


class MarkInvoicePaidAPIView(APIView):
    @transaction.atomic
    def post(self, request, pk):
        invoice = get_object_or_404(
            Invoice.objects.select_for_update(),
            pk=pk,
        )

        if invoice.status != Invoice.Status.APPROVED:
            return Response(
                {
                    "error": "Only approved invoices can be marked as paid.",
                    "current_status": invoice.status,
                },
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        if invoice.validation_status != "VALID" or invoice.validation_errors:
            return Response(
                {"error": "Invoice validation must be current and successful before payment."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        vendor_validation = validate_vendor_data(
            invoice.vendor_name,
            invoice.vendor_gstin,
            vendor=invoice.vendor,
        )
        if vendor_validation["status"] != "VERIFIED":
            return Response(
                {"error": "The vendor must be verified and active before payment."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        if invoice.po_number or invoice.matching_results.exists():
            matching_result = invoice.matching_results.filter(
                is_current=True
            ).first()
            if (
                matching_result is None
                or matching_result.status != InvoiceMatchingResult.Status.MATCHED
            ):
                return Response(
                    {
                        "error": "A current successful PO/GRN match is required before payment.",
                        "matching_status": (
                            matching_result.status if matching_result else "STALE"
                        ),
                    },
                    status=http_status.HTTP_400_BAD_REQUEST,
                )

        payment_date = request.data.get("payment_date")
        payment_reference = request.data.get("payment_reference", "")
        payment_method = request.data.get("payment_method")

        if not payment_date or not payment_reference or not payment_method:
            return Response(
                {
                    "error": "Payment date, reference and method are required."
                },
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        try:
            parsed_payment_date = date.fromisoformat(payment_date)
        except (ValueError, TypeError):
            return Response(
                {"error": "Payment date must use YYYY-MM-DD format."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        payment_reference = payment_reference.strip()

        if not payment_reference:
            return Response(
                {"error": "Payment reference cannot be empty."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        valid_methods = [choice.value for choice in Invoice.PaymentMethod]

        if payment_method not in valid_methods:
            return Response(
                {"error": "Invalid payment method."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        invoice.payment_date = parsed_payment_date
        invoice.payment_reference = payment_reference
        invoice.payment_method = payment_method
        invoice.status = Invoice.Status.PAID

        invoice.save(
            update_fields=[
                "payment_date",
                "payment_reference",
                "payment_method",
                "status",
                "updated_at",
            ]
        )
        Payment.objects.create(
            invoice=invoice,
            amount=invoice.total_amount,
            status=Payment.Status.PAID,
            payment_method=payment_method,
            payment_reference=payment_reference,
            payment_date=parsed_payment_date,
            created_by=request.user.get_username(),
        )
        record_audit_event(
            request,
            "payment.status_changed",
            "invoice",
            invoice.pk,
            {
                "status": Invoice.Status.PAID,
                "payment_date": parsed_payment_date.isoformat(),
                "payment_method": payment_method,
            },
        )

        return Response(
            {
                "message": "Invoice marked as paid successfully.",
                "invoice": InvoiceSerializer(invoice).data,
            },
            status=http_status.HTTP_200_OK,
        )

class VendorListCreateAPIView(generics.ListCreateAPIView):
    queryset = Vendor.objects.all()
    serializer_class = VendorSerializer

    def perform_create(self, serializer):
        vendor = serializer.save()
        VendorOnboardingHistory.objects.create(
            vendor=vendor,
            previous_status="",
            new_status=vendor.onboarding_status,
            actor_username=self.request.user.get_username(),
        )
        record_audit_event(
            self.request,
            "vendor.created",
            "vendor",
            vendor.pk,
            {"fields": sorted(serializer.validated_data.keys())},
        )


class VendorChoiceListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        vendors = Vendor.objects.order_by("vendor_name").values(
            "id",
            "vendor_name",
            "gstin",
            "is_active",
        )
        return Response(list(vendors), status=http_status.HTTP_200_OK)


class VendorDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Vendor.objects.all()
    serializer_class = VendorSerializer
    permission_classes = [IsAuthenticated]

    def perform_update(self, serializer):
        existing = self.get_object()
        old_status = existing.onboarding_status
        updated_fields = set(serializer.validated_data.keys())
        vendor = serializer.save()
        if old_status != vendor.onboarding_status:
            VendorOnboardingHistory.objects.create(
                vendor=vendor,
                previous_status=old_status,
                new_status=vendor.onboarding_status,
                actor_username=self.request.user.get_username(),
            )
        record_audit_event(
            self.request,
            (
                "vendor.bank_details_updated"
                if updated_fields.intersection({
                    "bank_account_name",
                    "bank_account_number",
                    "bank_ifsc",
                })
                else "vendor.onboarding_status_changed"
                if "onboarding_status" in updated_fields
                else "vendor.updated"
            ),
            "vendor",
            vendor.pk,
            {"fields": sorted(updated_fields)},
        )

    @transaction.atomic
    def perform_destroy(self, instance):
        user = self.request.user
        can_delete_vendor = (
            user.is_staff
            or user.is_superuser
            or user.groups.filter(name__in=["Admin", "AP Manager"]).exists()
        )
        if not can_delete_vendor:
            raise PermissionDenied(
                "Only an administrator or AP Manager can delete vendors."
            )

        instance = Vendor.objects.select_for_update().get(pk=instance.pk)
        if instance.is_active:
            raise VendorDeletionConflict(
                "Active vendors cannot be deleted. Deactivate the vendor first."
            )

        purchase_orders = instance.purchase_orders.all()
        purchase_order_numbers = purchase_orders.values_list(
            "po_number",
            flat=True,
        )
        invoice_filter = Q(po_number__in=purchase_order_numbers)
        if instance.gstin:
            invoice_filter |= (
                Q(vendor_gstin__iexact=instance.gstin)
                | (
                    Q(vendor_name__iexact=instance.vendor_name)
                    & (
                        Q(vendor_gstin__isnull=True)
                        | Q(vendor_gstin="")
                        | Q(vendor_gstin__iexact=instance.gstin)
                    )
                )
            )
        else:
            invoice_filter |= Q(vendor_name__iexact=instance.vendor_name)
        invoices = Invoice.objects.filter(
            invoice_filter | Q(vendor=instance)
        )

        if purchase_orders.exists() or invoices.exists():
            raise VendorDeletionConflict(
                "This vendor has invoice, payment, purchase order, or goods "
                "receipt history and cannot be permanently deleted. Keep the "
                "vendor inactive to retain its financial history."
            )
        record_audit_event(
            self.request,
            "vendor.deleted",
            "vendor",
            instance.pk,
        )
        instance.delete()


class PaymentListCreateAPIView(generics.ListCreateAPIView):
    serializer_class = PaymentSerializer
    queryset = Payment.objects.select_related("invoice").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        invoice_id = self.request.query_params.get("invoice")
        if invoice_id:
            queryset = queryset.filter(invoice_id=invoice_id)
        payment_status = self.request.query_params.get("status")
        if payment_status:
            queryset = queryset.filter(status=payment_status)
        return queryset

    @transaction.atomic
    def perform_create(self, serializer):
        invoice = Invoice.objects.select_for_update().get(
            pk=serializer.validated_data["invoice"].pk
        )
        _validate_invoice_for_payment(invoice)
        amount = serializer.validated_data["amount"]
        if invoice.payments.filter(
            amount=amount,
            status__in=[
                Payment.Status.PENDING,
                Payment.Status.APPROVED,
                Payment.Status.PROCESSING,
            ],
        ).exists():
            raise ValidationError(
                {"amount": "An active payment request already exists for this amount."}
            )
        paid_amount = invoice.payments.filter(
            status=Payment.Status.PAID,
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
        requested_amount = invoice.payments.filter(
            status__in=[
                Payment.Status.PENDING,
                Payment.Status.APPROVED,
                Payment.Status.PROCESSING,
            ],
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")
        if (
            paid_amount + requested_amount + serializer.validated_data["amount"]
            > invoice.total_amount
        ):
            raise ValidationError({
                "amount": "Payment amount exceeds the invoice's outstanding balance."
            })
        payment = serializer.save(
            created_by=self.request.user.get_username(),
        )
        record_audit_event(
            self.request,
            "payment.requested",
            "payment",
            payment.pk,
            {
                "invoice_id": invoice.pk,
                "amount": str(payment.amount),
                "status": payment.status,
            },
        )


class PaymentActionAPIView(APIView):
    @transaction.atomic
    def post(self, request, pk):
        payment = get_object_or_404(
            Payment.objects.select_for_update().select_related("invoice"),
            pk=pk,
        )
        invoice = get_object_or_404(
            Invoice.objects.select_for_update(),
            pk=payment.invoice_id,
        )
        payment.invoice = invoice
        new_status = request.data.get("status")
        transitions = {
            Payment.Status.PENDING: {
                Payment.Status.APPROVED,
                Payment.Status.REJECTED,
                Payment.Status.CANCELLED,
            },
            Payment.Status.APPROVED: {
                Payment.Status.PROCESSING,
                Payment.Status.CANCELLED,
            },
            Payment.Status.PROCESSING: {
                Payment.Status.PAID,
                Payment.Status.FAILED,
            },
        }
        if new_status not in transitions.get(payment.status, set()):
            return Response(
                {
                    "error": "Invalid payment status transition.",
                    "current_status": payment.status,
                },
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        rejection_reason = ""
        if new_status == Payment.Status.REJECTED:
            rejection_reason = request.data.get("rejection_reason", "")
            if not isinstance(rejection_reason, str) or not rejection_reason.strip():
                return Response(
                    {"error": "A rejection reason is required."},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            rejection_reason = rejection_reason.strip()
        elif new_status == Payment.Status.FAILED:
            failure_reason = request.data.get("failure_reason", "")
            if not isinstance(failure_reason, str) or not failure_reason.strip():
                return Response(
                    {"error": "A failure reason is required."},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )

        if new_status in {Payment.Status.APPROVED, Payment.Status.PROCESSING}:
            try:
                _validate_invoice_for_payment(invoice)
            except ValidationError as exc:
                return Response(
                    exc.detail,
                    status=http_status.HTTP_400_BAD_REQUEST,
                )

        if new_status == Payment.Status.PAID:
            supplied_reference = request.data.get("payment_reference", "")
            if not isinstance(supplied_reference, str):
                supplied_reference = ""
            reference = supplied_reference.strip()
            supplied_date = request.data.get("payment_date")
            payment_date = safe_date(supplied_date)
            if bool(reference) != bool(supplied_date) or (
                supplied_date and payment_date is None
            ):
                return Response(
                    {
                        "error": "Provide both a valid payment date and reference, or neither for simulated completion."
                    },
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            if not reference:
                reference = f"SIM-PAY-{payment.pk}-{uuid4().hex[:10].upper()}"
                payment_date = timezone.localdate()
            if Payment.objects.filter(
                payment_reference=reference,
                status=Payment.Status.PAID,
            ).exclude(pk=payment.pk).exists():
                return Response(
                    {"error": "This payment reference has already been recorded."},
                    status=http_status.HTTP_409_CONFLICT,
                )
            payment.payment_reference = reference
            payment.payment_date = payment_date

        previous_status = payment.status
        payment.status = new_status
        if new_status == Payment.Status.REJECTED:
            payment.rejection_reason = rejection_reason
        payment.save(update_fields=[
            "status",
            "payment_reference",
            "payment_date",
            "rejection_reason",
            "updated_at",
        ])
        if new_status == Payment.Status.PAID:
            paid_amount = sum(
                invoice.payments.filter(status=Payment.Status.PAID)
                .values_list("amount", flat=True),
                Decimal("0"),
            )
            if invoice.total_amount is not None and paid_amount >= invoice.total_amount:
                invoice.status = Invoice.Status.PAID
                invoice.payment_date = payment.payment_date
                invoice.payment_reference = payment.payment_reference
                invoice.payment_method = payment.payment_method
                invoice.save(update_fields=[
                    "status",
                    "payment_date",
                    "payment_reference",
                    "payment_method",
                    "updated_at",
                ])
        record_audit_event(
            request,
            "payment.status_changed",
            "payment",
            payment.pk,
            {
                "invoice_id": invoice.pk,
                "previous_status": previous_status,
                "status": payment.status,
                "payment_reference": (
                    payment.payment_reference if payment.status == Payment.Status.PAID else ""
                ),
                "reason": (
                    rejection_reason
                    if payment.status == Payment.Status.REJECTED
                    else request.data.get("failure_reason", "")
                    if payment.status == Payment.Status.FAILED
                    else ""
                ),
            },
        )
        return Response(PaymentSerializer(payment).data)


class PaymentAdviceAPIView(APIView):
    def get(self, request, pk):
        payment = get_object_or_404(
            Payment.objects.select_related("invoice"),
            pk=pk,
        )
        invoice = payment.invoice
        return Response({
            "payment_id": payment.pk,
            "vendor_name": invoice.vendor_name or "",
            "vendor_gstin": invoice.vendor_gstin or "",
            "invoice_number": invoice.invoice_number or "",
            "amount": str(payment.amount),
            "currency": invoice.currency,
            "payment_date": payment.payment_date.isoformat() if payment.payment_date else "",
            "payment_reference": payment.payment_reference,
            "payment_method": payment.payment_method,
            "payment_status": payment.status,
        })