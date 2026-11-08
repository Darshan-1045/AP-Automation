from collections import defaultdict
from decimal import Decimal

from django.db.models import Count, Q, Sum, Window
from django.db.models.functions import RowNumber
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AuditEvent, Invoice, OCRFieldVerification, Payment


class DashboardAPIView(APIView):
    def get(self, request):
        today = timezone.localdate()
        invoices = list(Invoice.objects.all().order_by("-created_at"))
        quick_summary = {
            "review_required_count": 0,
            "validation_issue_count": 0,
            "processing_error_count": 0,
            "uploaded_count": 0,
        }

        def has_validation_items(value):
            if value is None:
                return False
            if isinstance(value, str):
                return bool(value.strip())
            try:
                return len(value) > 0
            except TypeError:
                return bool(value)

        for invoice in invoices:
            processing_error = (invoice.processing_error or "").strip()

            if (
                invoice.status == Invoice.Status.REVIEW_REQUIRED
                or invoice.validation_status == "REVIEW_REQUIRED"
            ):
                quick_summary["review_required_count"] += 1

            if (
                has_validation_items(invoice.validation_warnings)
                or has_validation_items(invoice.validation_errors)
                or invoice.validation_status == "INVALID"
            ):
                quick_summary["validation_issue_count"] += 1

            if processing_error:
                quick_summary["processing_error_count"] += 1

            if (
                invoice.status in {
                    Invoice.Status.UPLOADED,
                    Invoice.Status.PROCESSING,
                }
                and not processing_error
            ):
                quick_summary["uploaded_count"] += 1

        paid_by_invoice = dict(
            Payment.objects.filter(status=Payment.Status.PAID)
            .values("invoice_id")
            .annotate(paid_total=Sum("amount"))
            .values_list("invoice_id", "paid_total")
        )
        status_breakdown = defaultdict(int)
        vendor_metrics = {}
        currency_totals = defaultdict(lambda: {
            "invoice_value": Decimal("0"),
            "paid_value": Decimal("0"),
            "outstanding_value": Decimal("0"),
        })
        aging = {
            "Current": 0,
            "1-30 days": 0,
            "31-60 days": 0,
            "61-90 days": 0,
            "Over 90 days": 0,
            "Unknown": 0,
        }
        overdue_count = 0
        pending_approval = 0
        for invoice in invoices:
            status_breakdown[invoice.status] += 1
            currency = invoice.currency or "INR"
            amount = invoice.total_amount or Decimal("0")
            bucket = currency_totals[currency]
            bucket["invoice_value"] += amount
            recorded_paid = paid_by_invoice.get(invoice.pk, Decimal("0"))
            if invoice.status == Invoice.Status.PAID and recorded_paid == 0:
                recorded_paid = amount
            paid_amount = min(recorded_paid, amount)
            bucket["paid_value"] += paid_amount
            if invoice.status != Invoice.Status.REJECTED:
                bucket["outstanding_value"] += max(
                    amount - paid_amount,
                    Decimal("0"),
                )

            if invoice.status in {
                Invoice.Status.VALIDATED,
                Invoice.Status.PENDING_APPROVAL,
                Invoice.Status.ESCALATED,
            }:
                pending_approval += 1
            if invoice.status not in {
                Invoice.Status.PAID,
                Invoice.Status.REJECTED,
            }:
                if invoice.due_date is None:
                    aging["Unknown"] += 1
                else:
                    days_overdue = (today - invoice.due_date).days
                    if days_overdue <= 0:
                        aging["Current"] += 1
                    else:
                        overdue_count += 1
                        if days_overdue <= 30:
                            aging["1-30 days"] += 1
                        elif days_overdue <= 60:
                            aging["31-60 days"] += 1
                        elif days_overdue <= 90:
                            aging["61-90 days"] += 1
                        else:
                            aging["Over 90 days"] += 1

            vendor_name = invoice.vendor_name or "Unknown vendor"
            vendor_key = (vendor_name, currency)
            vendor = vendor_metrics.setdefault(vendor_key, {
                "vendor_name": vendor_name,
                "invoice_count": 0,
                "paid_amount": Decimal("0"),
                "outstanding_amount": Decimal("0"),
                "currency": currency,
            })
            vendor["invoice_count"] += 1
            vendor["paid_amount"] += paid_amount
            if invoice.status != Invoice.Status.REJECTED:
                vendor["outstanding_amount"] += max(
                    amount - paid_amount,
                    Decimal("0"),
                )

        validation_events = list(
            AuditEvent.objects.filter(
                action="invoice.validation_performed",
            ).order_by("created_at").values("entity_id", "created_at")
        )
        invoice_created = {
            str(invoice.pk): invoice.created_at
            for invoice in invoices
        }
        first_validation = {}
        for event in validation_events:
            entity_id = event["entity_id"]
            if entity_id in invoice_created and entity_id not in first_validation:
                first_validation[entity_id] = event["created_at"]
        turnaround_minutes = [
            (finished - invoice_created[entity_id]).total_seconds() / 60
            for entity_id, finished in first_validation.items()
            if finished >= invoice_created[entity_id]
        ]

        payment_breakdown = {
            status: Payment.objects.filter(status=status).count()
            for status, _ in Payment.Status.choices
        }
        recent_activity = list(
            AuditEvent.objects.order_by("-created_at")
            .values(
                "actor",
                "action",
                "entity_type",
                "entity_id",
                "created_at",
            )[:10]
        )
        for event in recent_activity:
            event["created_at"] = event["created_at"].isoformat()

        latest_verifications = (
            OCRFieldVerification.objects.annotate(
                verification_rank=Window(
                    expression=RowNumber(),
                    partition_by=["invoice_id", "field_name"],
                    order_by=["-verified_at", "-pk"],
                ),
            )
            .filter(verification_rank=1)
            .values("field_name")
            .annotate(
                total=Count("pk"),
                correct=Count("pk", filter=Q(is_correct=True)),
            )
            .order_by("field_name")
        )
        field_labels = dict(OCRFieldVerification.FieldName.choices)
        ocr_fields = []
        total_verified = 0
        total_correct = 0
        for field in latest_verifications:
            verified = field["total"]
            correct = field["correct"]
            total_verified += verified
            total_correct += correct
            ocr_fields.append({
                "field_name": field["field_name"],
                "label": field_labels[field["field_name"]],
                "total_verified_fields": verified,
                "correct_fields": correct,
                "incorrect_fields": verified - correct,
                "accuracy": round(correct / verified * 100, 1),
            })

        total_incorrect = total_verified - total_correct
        accuracy_value = (
            round(total_correct / total_verified * 100, 1)
            if total_verified else None
        )

        return Response({
            "invoice_count": len(invoices),
            "quick_summary": quick_summary,
            "pending_approval_count": pending_approval,
            "overdue_invoice_count": overdue_count,
            "status_breakdown": dict(status_breakdown),
            "aging": [
                {"bucket": name, "count": count}
                for name, count in aging.items()
            ],
            "currency_totals": {
                currency: {key: str(value) for key, value in totals.items()}
                for currency, totals in currency_totals.items()
            },
            "vendor_analytics": [
                {
                    **vendor,
                    "paid_amount": str(vendor["paid_amount"]),
                    "outstanding_amount": str(vendor["outstanding_amount"]),
                }
                for vendor in sorted(
                    vendor_metrics.values(),
                    key=lambda row: row["outstanding_amount"],
                    reverse=True,
                )[:10]
            ],
            "payment_status_breakdown": payment_breakdown,
            "processing_turnaround": {
                "average_minutes": (
                    round(sum(turnaround_minutes) / len(turnaround_minutes), 2)
                    if turnaround_minutes else None
                ),
                "sample_count": len(turnaround_minutes),
                "definition": (
                    "Invoice creation to first successful validation event."
                ),
            },
            "ocr_accuracy": {
                "value": accuracy_value,
                "label": (
                    f"{accuracy_value:.1f}%"
                    if accuracy_value is not None
                    else "Unavailable"
                ),
                "definition": (
                    "Based on the latest verified value for each invoice field."
                ),
                "total_verified_fields": total_verified,
                "correct_fields": total_correct,
                "incorrect_fields": total_incorrect,
                "by_field_type": ocr_fields,
            },
            "recent_activity": recent_activity,
        })
