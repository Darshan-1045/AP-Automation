import csv
from datetime import date
from decimal import Decimal
from io import StringIO

from django.db.models import Prefetch
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.response import Response
from rest_framework.views import APIView

from .audit import record_audit_event
from .models import AuditEvent, Invoice, InvoiceMatchingResult, Payment
from .permissions import IsAdminOrAPManager


class ReportContentNegotiation(DefaultContentNegotiation):
    def select_renderer(self, request, renderers, format_suffix=None):
        if request.query_params.get("format") == "csv":
            format_suffix = "json"
        return super().select_renderer(request, renderers, format_suffix)


class ReportAPIView(APIView):
    content_negotiation_class = ReportContentNegotiation

    def get_permissions(self):
        if self.request.query_params.get("type") == "audit":
            return [IsAdminOrAPManager()]
        return super().get_permissions()

    report_types = {
        "aging",
        "invoice_status",
        "pending_approval",
        "payments",
        "vendors",
        "exceptions",
        "tax",
        "po_matching",
        "audit",
    }

    def get(self, request):
        report_type = request.query_params.get("type", "invoice_status")
        if report_type not in self.report_types:
            return Response(
                {"type": f"Choose one of: {', '.join(sorted(self.report_types))}."},
                status=400,
            )

        invoices = Invoice.objects.prefetch_related(
            "line_items",
            Prefetch(
                "matching_results",
                queryset=InvoiceMatchingResult.objects.filter(is_current=True),
                to_attr="current_matching_results",
            ),
        )
        from_date = self._date_filter(request.query_params.get("from_date"))
        to_date = self._date_filter(request.query_params.get("to_date"))
        if from_date is False or to_date is False:
            return Response({"date": "Dates must use YYYY-MM-DD format."}, status=400)
        if from_date and to_date and from_date > to_date:
            return Response(
                {"date": "The from date must be on or before the to date."},
                status=400,
            )
        if report_type == "audit":
            events = AuditEvent.objects.all()
            if from_date:
                events = events.filter(created_at__date__gte=from_date)
            if to_date:
                events = events.filter(created_at__date__lte=to_date)
            action_filter = request.query_params.get("action")
            entity_filter = request.query_params.get("entity_type")
            if action_filter:
                events = events.filter(action=action_filter)
            if entity_filter:
                events = events.filter(entity_type=entity_filter)
            rows = [{
                "event_id": event.pk,
                "actor": event.actor,
                "action": event.action,
                "entity_type": event.entity_type,
                "entity_id": event.entity_id,
                "timestamp": event.created_at.isoformat(),
                "details": event.details,
            } for event in events]
            summary = {"record_count": len(rows), "total_amount": "0"}
            if request.query_params.get("format") == "csv":
                response = self._csv_response(report_type, rows, summary)
                record_audit_event(
                    request,
                    "report.csv_exported",
                    "report",
                    report_type,
                    {"record_count": len(rows)},
                )
                return response
            return Response({
                "report_type": report_type,
                "summary": summary,
                "results": rows,
            })
        if from_date:
            invoices = invoices.filter(invoice_date__gte=from_date)
        if to_date:
            invoices = invoices.filter(invoice_date__lte=to_date)
        vendor_name = request.query_params.get("vendor")
        if vendor_name:
            invoices = invoices.filter(vendor_name__iexact=vendor_name)
        status_filter = request.query_params.get("status")
        if status_filter and report_type != "payments":
            invoices = invoices.filter(status=status_filter)

        rows = self._rows(report_type, invoices, status_filter=status_filter)
        amount_field = (
            "tax_amount" if report_type == "tax"
            else "payment_amount" if report_type == "payments"
            else "total_amount"
        )
        summary_amounts = (
            Decimal(str(row.get(amount_field) or 0))
            for row in rows
        )
        summary = {
            "record_count": len(rows),
            "total_amount": str(sum(summary_amounts, Decimal("0"))),
        }
        if request.query_params.get("format") == "csv":
            response = self._csv_response(report_type, rows, summary)
            record_audit_event(
                request,
                "report.csv_exported",
                "report",
                report_type,
                {"record_count": len(rows)},
            )
            return response
        return Response({
            "report_type": report_type,
            "summary": summary,
            "results": rows,
        })

    @staticmethod
    def _date_filter(value):
        if not value:
            return None
        try:
            return date.fromisoformat(value)
        except (ValueError, TypeError):
            return False

    def _rows(self, report_type, invoices, status_filter=None):
        today = timezone.localdate()
        if report_type == "po_matching":
            matching_results = InvoiceMatchingResult.objects.filter(
                invoice__in=invoices,
                is_current=True,
            ).select_related("invoice", "purchase_order", "goods_receipt")
            return [{
                "invoice_number": result.invoice.invoice_number,
                "vendor_name": result.invoice.vendor_name,
                "po_number": result.purchase_order.po_number if result.purchase_order else "",
                "grn_number": result.goods_receipt.grn_number if result.goods_receipt else "",
                "matching_status": result.status,
                "exceptions": result.exceptions,
                "total_amount": str(result.invoice.total_amount or ""),
                "created_at": result.created_at.isoformat(),
            } for result in matching_results]

        records = list(invoices.order_by("-created_at"))
        if report_type == "aging":
            rows = []
            for invoice in records:
                # Until paid, every non-rejected invoice remains an outstanding AP item.
                if invoice.status in {Invoice.Status.PAID, Invoice.Status.REJECTED}:
                    continue
                overdue_days = (
                    max((today - invoice.due_date).days, 0)
                    if invoice.due_date else None
                )
                if overdue_days is None:
                    bucket = "Unknown"
                elif overdue_days == 0:
                    bucket = "Current"
                elif overdue_days <= 30:
                    bucket = "1-30 days"
                elif overdue_days <= 60:
                    bucket = "31-60 days"
                elif overdue_days <= 90:
                    bucket = "61-90 days"
                else:
                    bucket = "Over 90 days"
                rows.append(self._invoice_row(
                    invoice,
                    aging_bucket=bucket,
                    overdue_days=overdue_days,
                ))
            return rows
        if report_type == "pending_approval":
            records = [
                item for item in records
                if item.status in {
                    Invoice.Status.VALIDATED,
                    Invoice.Status.PENDING_APPROVAL,
                    Invoice.Status.ESCALATED,
                }
            ]
        if report_type == "payments":
            payments = Payment.objects.filter(
                invoice__in=invoices,
            ).select_related("invoice").order_by("-created_at", "-id")
            if status_filter:
                payments = payments.filter(status=status_filter)
            rows = [{
                "payment_id": payment.pk,
                "invoice_id": payment.invoice_id,
                "invoice_number": payment.invoice.invoice_number or "",
                "vendor_name": payment.invoice.vendor_name or "",
                "payment_amount": str(payment.amount),
                "currency": payment.invoice.currency,
                "status": payment.status,
                "payment_method": payment.payment_method,
                "payment_reference": payment.payment_reference,
                "payment_date": (
                    payment.payment_date.isoformat()
                    if payment.payment_date else ""
                ),
                "created_at": payment.created_at.isoformat(),
            } for payment in payments]
            legacy = invoices.none()
            if not status_filter or status_filter == Payment.Status.PAID:
                legacy = invoices.filter(
                    status=Invoice.Status.PAID,
                ).exclude(
                    payments__status=Payment.Status.PAID,
                ).distinct()
            rows.extend({
                "payment_id": f"legacy-{invoice.pk}",
                "invoice_id": invoice.pk,
                "invoice_number": invoice.invoice_number or "",
                "vendor_name": invoice.vendor_name or "",
                "payment_amount": str(invoice.total_amount or 0),
                "currency": invoice.currency,
                "status": Payment.Status.PAID,
                "payment_method": invoice.payment_method,
                "payment_reference": invoice.payment_reference,
                "payment_date": (
                    invoice.payment_date.isoformat()
                    if invoice.payment_date else ""
                ),
                "created_at": invoice.updated_at.isoformat(),
            } for invoice in legacy)
            return rows
        if report_type == "exceptions":
            rows = []
            for invoice in records:
                current_match = next(iter(invoice.current_matching_results), None)
                validation_errors = invoice.validation_errors or []
                validation_warnings = invoice.validation_warnings or []
                matching_exceptions = (
                    current_match.exceptions or [] if current_match else []
                )
                exception_reasons = [
                    f"Validation error: {self._exception_text(item)}"
                    for item in validation_errors
                ]
                exception_reasons.extend(
                    f"Validation warning: {self._exception_text(item)}"
                    for item in validation_warnings
                )
                exception_reasons.extend(
                    self._exception_text(item) for item in matching_exceptions
                )
                if current_match and (
                    current_match.status != InvoiceMatchingResult.Status.MATCHED
                    and not matching_exceptions
                ):
                    exception_reasons.append(
                        f"PO/GRN matching status: {current_match.status}."
                    )

                if invoice.status == Invoice.Status.REVIEW_REQUIRED and not exception_reasons:
                    exception_reasons.append("Invoice requires manual review.")

                if exception_reasons:
                    rows.append({
                        "invoice_id": invoice.id,
                        "invoice_number": invoice.invoice_number or "",
                        "vendor_name": invoice.vendor_name or "",
                        "exception_reason": "; ".join(exception_reasons),
                        "invoice_date": (
                            invoice.invoice_date.isoformat()
                            if invoice.invoice_date else ""
                        ),
                        "total_amount": str(invoice.total_amount or ""),
                        "currency": invoice.currency,
                        "status": invoice.status,
                        "validation_errors": validation_errors,
                        "validation_warnings": validation_warnings,
                        "matching_exceptions": matching_exceptions,
                    })
            return rows
        if report_type == "vendors":
            grouped = {}
            for invoice in records:
                name = invoice.vendor_name or "Unknown vendor"
                item = grouped.setdefault(name, {
                    "vendor_name": name,
                    "invoice_count": 0,
                    "total_amount": Decimal("0"),
                    "paid_amount": Decimal("0"),
                    "outstanding_amount": Decimal("0"),
                })
                amount = invoice.total_amount or Decimal("0")
                item["invoice_count"] += 1
                item["total_amount"] += amount
                if invoice.status == Invoice.Status.PAID:
                    item["paid_amount"] += amount
                elif invoice.status != Invoice.Status.REJECTED:
                    item["outstanding_amount"] += amount
            return [{
                **item,
                "total_amount": str(item["total_amount"]),
                "paid_amount": str(item["paid_amount"]),
                "outstanding_amount": str(item["outstanding_amount"]),
            } for item in grouped.values()]
        if report_type == "tax":
            return [self._invoice_row(item, tax_amount=str(item.tax_amount or "")) for item in records]
        if report_type == "invoice_status":
            return [self._invoice_row(item) for item in records]
        if report_type == "pending_approval":
            return [self._invoice_row(
                item,
                submitted_at=item.created_at.isoformat(),
                approval_level=item.approval_level,
            ) for item in records]
        return []

    @staticmethod
    def _invoice_row(invoice, **extra):
        return {
            "invoice_id": invoice.id,
            "invoice_number": invoice.invoice_number or "",
            "vendor_name": invoice.vendor_name or "",
            "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else "",
            "due_date": invoice.due_date.isoformat() if invoice.due_date else "",
            "status": invoice.status,
            "total_amount": str(invoice.total_amount or ""),
            "currency": invoice.currency,
            **extra,
        }

    @staticmethod
    def _exception_text(item):
        if isinstance(item, dict):
            return str(item.get("message") or item.get("detail") or item.get("code") or item)
        return str(item)

    @staticmethod
    def _csv_response(report_type, rows, summary):
        output = StringIO()
        columns = list(dict.fromkeys(key for row in rows for key in row))
        if not columns:
            columns = [
                "invoice_number",
                "vendor_name",
                "total_amount",
                "status",
            ]
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        writer.writerows({
            key: value if not isinstance(value, (dict, list)) else str(value)
            for key, value in row.items()
        } for row in rows)

        amount_column = (
            "tax_amount" if report_type == "tax"
            else "payment_amount" if report_type == "payments"
            else "total_amount"
        )
        total_row = {column: "" for column in columns}
        label_column = "vendor_name" if "vendor_name" in columns else columns[0]
        total_row[label_column] = f"Total ({summary['record_count']} records)"
        if amount_column in columns:
            total_row[amount_column] = summary["total_amount"]
        writer.writerow(total_row)
        response = HttpResponse(output.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{report_type}.csv"'
        return response
